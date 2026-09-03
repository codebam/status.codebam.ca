// Fast smoke test without wrangler/workerd: exercises the real src modules
// (probe.js, page.js) against an in-memory KV stand-in.
// The first section makes live requests to the monitored sites.
import { pathToFileURL } from 'node:url';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const src = (f) => pathToFileURL(path.join(root, 'src', f)).href;

const { runChecks, loadStatus } = await import(src('probe.js'));
const { renderPage } = await import(src('page.js'));

class FakeKV {
  constructor() { this.m = new Map(); }
  async get(k, o) {
    if (!this.m.has(k)) return null;
    const v = this.m.get(k);
    return o?.type === 'json' ? JSON.parse(v) : v;
  }
  async put(k, v) { this.m.set(k, String(v)); }
}
const env = { STATUS_KV: new FakeKV() };
const assert = (c, msg) => { if (!c) { console.error('FAIL:', msg); process.exit(1); } console.log('ok  -', msg); };

const t0 = Date.UTC(2026, 8, 3, 12, 0, 0);
await runChecks(env, t0);
let st = await loadStatus(env);
assert(st.services.every((s) => s.latest.state === 'up' && s.latest.status === 200), 'live sites all report up');
assert(st.services.every((s) => s.uptime === 100), 'uptime 100% after first check');
assert(st.services[0].days.length === 90, '90 day bars present');
assert(st.services[0].recent.length === 1, '24h chart has entries');

globalThis.fetch = async (url) => {
  if (String(url).includes('seanbehan')) return new Response('oops', { status: 500 });
  if (String(url).includes('stream')) throw Object.assign(new Error('connection reset'), { name: 'ConnectionError' });
  return new Response('hi', { status: 200 });
};
await runChecks(env, t0 + 900_000);
st = await loadStatus(env);
const byName = Object.fromEntries(st.services.map((s) => [s.target.name, s.latest.state]));
assert(byName['seanbehan.ca'] === 'down' && byName['stream.codebam.ca'] === 'down', '500 and thrown error => down');
assert(byName['codebam.ca'] === 'up', '200 => up');
const sb = st.services.find((s) => s.target.name === 'seanbehan.ca');
assert(sb.uptime > 0 && sb.uptime < 100, `uptime recalculated from history (${sb.uptime.toFixed(2)}%)`);
assert(sb.days[89].checks === 2 && sb.days[89].down === 1, 'same-slot re-run deduped + rolled up');

globalThis.fetch = async () => new Response('gone', { status: 404 });
await runChecks(env, t0 + 1_800_000);
st = await loadStatus(env);
assert(st.services[0].latest.state === 'degraded', '404 => degraded');

const html = renderPage(st);
assert(html.includes('not fully operational'), 'outage banner renders');
assert(!html.includes('undefined>') && !html.includes('NaN'), 'no undefined/NaN leaks in HTML');
console.log('\nALL TESTS PASSED');
