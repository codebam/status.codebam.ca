# status.codebam.ca

Cloudflare Worker that monitors **seanbehan.ca**, **codebam.ca**, and
**stream.codebam.ca** every 15 minutes and serves a status dashboard.

## How it works

- A cron trigger (`*/15 * * * *`) runs `scheduled()` in `src/index.js`, which
  probes each target (GET, redirects followed, 10s timeout) and records:
  - `up` for 2xx/3xx, `degraded` for 4xx, `down` for 5xx / timeout / network error
- Results go to a Workers KV namespace:
  - `day:<id>:<date>` — raw per-check entries, expire after ~8 days (drives the 24h chart)
  - `hist:<id>` — permanent rolling 90-day rollups (drive the uptime bars)
  - `latest:<id>` — most recent check, shown on the dashboard
- The same Worker serves:
  - `/` — the dashboard (dark-mode HTML, no external assets, inline SVG chart)
  - `/api/status` — machine-readable JSON
- On the very first page load (empty KV) a check is kicked off immediately so you
  don't wait for the next cron slot.

## Deploy

Prereqs: Node 18+, a Cloudflare account with the `codebam.ca` zone, and a
`wrangler login` session.

```sh
npm install

# 1. Create the KV namespace and paste the printed id into wrangler.toml
npx wrangler kv namespace create STATUS_KV

# 2. Deploy (registers the cron + the status.codebam.ca custom domain)
npx wrangler deploy
```

That's it — no CI or extra infrastructure needed. Cron triggers only fire on the
deployed Worker, so deploys from your machine are enough.

## Local development

```sh
npm run dev          # http://localhost:8787 (local KV emulation)
```

Manually fire the cron handler while `wrangler dev` is running:

```sh
curl "http://localhost:8787/cdn-cgi/handler/scheduled?cron=*/15+*+*+*+*"
```

Note: the page also auto-triggers a first check on load, so simply visiting the
local URL after `npm run dev` is the easiest smoke test.

## Cost

Well within Cloudflare's free plan: 4 cron invocations/hour (~96/day),
3 subrequests each, plus a handful of KV reads per dashboard visit.

## Customizing

- Add/remove services: edit `TARGETS` in `src/probe.js`.
- Change cadence: edit `crons` in `wrangler.toml` (mind `*/N` limits — minutes
  must divide evenly into the hour) and the `15 * 60_000` bucket rounding in
  `runChecks`.
- Change history window: `HISTORY_DAYS` in `src/probe.js`.
