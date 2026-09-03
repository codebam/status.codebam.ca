import { runChecks, loadStatus } from './probe.js';
import { renderPage } from './page.js';

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === '/api/status') {
      const status = await loadStatus(env);
      return new Response(JSON.stringify(status, null, 2), {
        headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (url.pathname === '/' || url.pathname === '/index.html') {
      const status = await loadStatus(env);
      if (status.needsCheck) ctx.waitUntil(runChecks(env));
      return new Response(renderPage(status), {
        headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
      });
    }

    if (url.pathname === '/favicon.ico') {
      return new Response(null, { status: 204 });
    }

    return new Response('Not Found', { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runChecks(env, event.scheduledTime));
  },
};
