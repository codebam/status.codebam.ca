import { HISTORY_DAYS, DAY_MS, utcDate } from './probe.js';

const CSS = `
:root { color-scheme: dark; }
* { box-sizing: border-box; }
body { margin: 0; background: #0b0f14; color: #e6edf3;
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
main { max-width: 880px; margin: 0 auto; padding: 32px 20px 48px; }
header h1 { margin: 0 0 4px; font-size: 26px; }
header p { margin: 0; color: #8b949e; }
.banner { margin: 24px 0; padding: 14px 18px; border-radius: 10px; font-weight: 600;
  display: flex; align-items: center; gap: 10px; }
.banner.ok { background: #0f2c1c; color: #3fb950; border: 1px solid #238636; }
.banner.bad { background: #2d1214; color: #f85149; border: 1px solid #da3633; }
.service { background: #11161d; border: 1px solid #21282f; border-radius: 12px;
  padding: 18px 20px; margin-bottom: 18px; }
.service .row { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.service h2 { margin: 0; font-size: 17px; }
.service h2 a { color: inherit; text-decoration: none; }
.service h2 a:hover { text-decoration: underline; }
.dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; }
.dot.up { background: #3fb950; box-shadow: 0 0 8px #3fb95088; }
.dot.degraded { background: #d29922; box-shadow: 0 0 8px #d2992288; }
.dot.down { background: #f85149; box-shadow: 0 0 8px #f8514988; }
.dot.unknown { background: #484f58; }
.state { font-weight: 600; }
.state.up { color: #3fb950; } .state.degraded { color: #d29922; }
.state.down { color: #f85149; } .state.unknown { color: #8b949e; }
.meta { color: #8b949e; font-size: 13px; margin-top: 2px; }
.bars { display: flex; gap: 2px; margin-top: 12px; }
.bars .bar { flex: 1; height: 28px; border-radius: 3px; background: #21262d; }
.bars .bar.ok { background: #2ea043; } .bars .bar.warn { background: #bb8009; }
.bars .bar.bad { background: #da3633; }
.spark { margin-top: 12px; width: 100%; height: 60px; display: block; }
.grid { display: flex; justify-content: space-between; color: #6e7681; font-size: 12px; margin-top: 4px; }
footer { margin-top: 28px; color: #6e7681; font-size: 13px; }
code { background: #1c2128; padding: 1px 5px; border-radius: 4px; }
`;

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])
  );
}

function fmtTime(ms) {
  return new Date(ms).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}

function uptimeLabel(s) {
  return s.uptime === null ? '—' : `${s.uptime.toFixed(3)}%`;
}

function barTitle(day) {
  if (!day.checks) return `${day.date}: no data`;
  const parts = [];
  if (day.up) parts.push(`${day.up} up`);
  if (day.degraded) parts.push(`${day.degraded} degraded`);
  if (day.down) parts.push(`${day.down} down`);
  return `${day.date}: ${parts.join(', ')} (${Math.round(day.avgMs)}ms avg)`;
}

function bars(svc) {
  return svc.days
    .map((d) => {
      let cls = '';
      if (!d.checks) cls = '';
      else if (d.down > 0) cls = 'bad';
      else if (d.degraded > 0) cls = 'warn';
      else cls = 'ok';
      return `<div class="bar ${cls}" title="${esc(barTitle(d))}"></div>`;
    })
    .join('');
}

function sparkline(entries) {
  if (!entries.length) return '';
  const w = 840, h = 60, pad = 2;
  const max = Math.max(...entries.map((e) => e.ms), 1);
  const bw = (w - pad * 2) / entries.length;
  const rects = entries
    .map((e, i) => {
      const bh = Math.max(2, (e.ms / max) * (h - 10));
      const color = e.state === 'up' ? '#3fb950' : e.state === 'degraded' ? '#d29922' : '#f85149';
      const t = fmtTime(e.ts);
      return `<rect x="${(pad + i * bw).toFixed(1)}" y="${(h - bh).toFixed(1)}" width="${Math.max(bw - 1.5, 1).toFixed(1)}" height="${bh.toFixed(1)}" fill="${color}"><title>${esc(t)} — ${esc(e.detail)} in ${e.ms}ms</title></rect>`;
    })
    .join('');
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" role="img" aria-label="response time, last 24 hours">${rects}</svg>
  <div class="grid"><span>24h ago (peak ${max}ms)</span><span>now</span></div>`;
}

function stateOf(svc) {
  return svc.latest ? svc.latest.state : 'unknown';
}

function serviceCard(svc) {
  const st = stateOf(svc);
  const labels = {
    up: 'Operational', degraded: 'Degraded', down: 'Outage', unknown: 'Pending first check',
  };
  const detail = svc.latest
    ? `last check ${fmtTime(svc.latest.ts)} · ${svc.latest.detail} · ${svc.latest.ms}ms`
    : 'waiting for the next scheduled check';
  return `
<section class="service">
  <div class="row">
    <h2><span class="dot ${st}"></span><a href="${esc(svc.target.url)}">${esc(svc.target.name)}</a></h2>
    <span class="state ${st}">${labels[st]}</span>
  </div>
  <div class="meta">${esc(detail)}</div>
  <div class="bars">${bars(svc)}</div>
  <div class="grid"><span>${HISTORY_DAYS}-day uptime: <b style="color:#e6edf3">${uptimeLabel(svc)}</b></span><span>${esc(svc.target.url)}</span></div>
  ${sparkline(svc.recent)}
</section>`;
}

export function renderPage(status) {
  const states = status.services.map(stateOf);
  const bad = states.filter((s) => s !== 'up').length;
  const banner =
    bad === 0
      ? `<div class="banner ok"><span class="dot up"></span>All systems operational</div>`
      : `<div class="banner bad"><span class="dot down"></span>${bad} service${bad > 1 ? 's' : ''} not fully operational</div>`;
  const firstDate = status.services[0]?.days[0]?.date ?? utcDate(status.now);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>codebam status</title>
<meta name="description" content="Live status of seanbehan.ca and codebam.ca, checked every 15 minutes.">
<style>${CSS}</style>
</head>
<body>
<main>
<header>
  <h1>codebam status</h1>
  <p>seanbehan.ca · codebam.ca — probed every 15 minutes</p>
</header>
${banner}
${status.services.map(serviceCard).join('')}
<footer>
  As of ${fmtTime(status.now)}. History since ${esc(firstDate)}.
  JSON endpoint: <code>/api/status</code>.
</footer>
</main>
</body>
</html>`;
}
