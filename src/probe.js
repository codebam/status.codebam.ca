export const TARGETS = [
  { id: 'seanbehan-ca', name: 'seanbehan.ca', url: 'https://seanbehan.ca/' },
  { id: 'codebam-ca', name: 'codebam.ca', url: 'https://codebam.ca/' },
  { id: 'stream-codebam-ca', name: 'stream.codebam.ca', url: 'https://stream.codebam.ca/' },
];

export const CHECK_TIMEOUT_MS = 10_000;
export const HISTORY_DAYS = 90;

export const DAY_MS = 86_400_000;
const DAY_KEY_TTL_S = 8 * 86_400; // per-check data kept ~8 days for the 24h chart

export function utcDate(ts) {
  return new Date(ts).toISOString().slice(0, 10);
}

export function lastNDates(n, nowMs) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) out.push(utcDate(nowMs - i * DAY_MS));
  return out;
}

async function probe(target, ts) {
  const start = Date.now();
  try {
    const res = await fetch(target.url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'User-Agent': 'codebam-status-bot/1.0 (+https://status.codebam.ca)',
        'Cache-Control': 'no-cache',
      },
      signal: AbortSignal.timeout(CHECK_TIMEOUT_MS),
    });
    const ms = Date.now() - start;
    let state = 'up';
    if (res.status >= 500 || res.status === 0) state = 'down';
    else if (res.status >= 400) state = 'degraded';
    return { ts, state, status: res.status, ms, detail: `HTTP ${res.status}` };
  } catch (err) {
    return {
      ts,
      state: 'down',
      status: 0,
      ms: Date.now() - start,
      detail: `${err?.name ?? 'Error'}: ${String(err?.message ?? err).slice(0, 200)}`,
    };
  }
}

function summarize(entries) {
  const sum = { checks: entries.length, up: 0, degraded: 0, down: 0, avgMs: 0, maxMs: 0 };
  let total = 0;
  for (const e of entries) {
    sum[e.state] += 1;
    total += e.ms;
    if (e.ms > sum.maxMs) sum.maxMs = e.ms;
  }
  sum.avgMs = entries.length ? Math.round(total / entries.length) : 0;
  return sum;
}

export async function runChecks(env, scheduledTime) {
  const now = scheduledTime ?? Date.now();
  const ts = Math.floor(now / (15 * 60_000)) * (15 * 60_000);
  const date = utcDate(now);
  const results = await Promise.all(TARGETS.map((t) => probe(t, ts)));

  await Promise.all(
    TARGETS.map(async (target, i) => {
      const entry = results[i];
      const dayKey = `day:${target.id}:${date}`;
      const existing = (await env.STATUS_KV.get(dayKey, { type: 'json' })) ?? [];
      const merged = [...existing.filter((e) => e.ts !== entry.ts), entry].sort(
        (a, b) => a.ts - b.ts
      );
      const histKey = `hist:${target.id}`;
      const hist = (await env.STATUS_KV.get(histKey, { type: 'json' })) ?? [];
      const summary = { date, ...summarize(merged) };
      const mergedHist = [...hist.filter((d) => d.date !== date), summary]
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .slice(-HISTORY_DAYS);

      await Promise.all([
        env.STATUS_KV.put(dayKey, JSON.stringify(merged), { expirationTtl: DAY_KEY_TTL_S }),
        env.STATUS_KV.put(histKey, JSON.stringify(mergedHist)),
        env.STATUS_KV.put(`latest:${target.id}`, JSON.stringify(entry)),
      ]);
    })
  );
  return results;
}

async function loadService(env, target, dates, now) {
  const today = utcDate(now);
  const yesterday = utcDate(now - DAY_MS);
  const [latest, hist, todayDay, yesterdayDay] = await Promise.all([
    env.STATUS_KV.get(`latest:${target.id}`, { type: 'json' }),
    env.STATUS_KV.get(`hist:${target.id}`, { type: 'json' }),
    env.STATUS_KV.get(`day:${target.id}:${today}`, { type: 'json' }),
    env.STATUS_KV.get(`day:${target.id}:${yesterday}`, { type: 'json' }),
  ]);

  const byDate = new Map((hist ?? []).map((d) => [d.date, d]));
  const days = dates.map((d) => byDate.get(d) ?? { date: d, checks: 0 });

  const checks = days.reduce((n, d) => n + d.checks, 0);
  const downs = days.reduce((n, d) => n + (d.down ?? 0), 0);
  const uptime = checks ? ((checks - downs) / checks) * 100 : null;

  const recentEntries = [...(todayDay ?? []), ...(yesterdayDay ?? [])].sort((a, b) => a.ts - b.ts);

  return { target, latest, uptime, days, recent: recentEntries.slice(-96) };
}

export async function loadStatus(env) {
  const now = Date.now();
  const dates = lastNDates(HISTORY_DAYS, now);
  const needsCheck = !(await env.STATUS_KV.get(`latest:${TARGETS[0].id}`, { type: 'json' }));
  return { now, needsCheck, services: await Promise.all(TARGETS.map((t) => loadService(env, t, dates, now))) };
}
