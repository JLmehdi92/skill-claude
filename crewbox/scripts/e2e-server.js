// Starts Crewbox on a fresh, throwaway data folder for the end-to-end tests, next to two fakes:
// a small company website for Foreman to read (E2E_PORT + 1) and a Resend API that records the
// emails it receives (E2E_PORT + 2, GET /__calls lists them).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

const PORT = Number(process.env.E2E_PORT || 4810);
const SITE_PORT = PORT + 1, RESEND_PORT = PORT + 2;
process.env.CREWBOX_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'crewbox-e2e-'));
process.env.CREWBOX_PORT = String(PORT);
process.env.CREWBOX_OFFLINE_ICONS = '1';
process.env.CREWBOX_API_BASE_RESEND = `http://127.0.0.1:${RESEND_PORT}`;
delete process.env.ANTHROPIC_API_KEY;
delete process.env.CLAUDE_CODE_OAUTH_TOKEN;

const PAGES = {
  '/': `<!doctype html><html lang="fr"><head><title>Facturo | Relances de factures automatiques</title><meta name="description" content="Facturo relance vos factures impayées pour les agences et les freelances.">
    <script src="https://js.stripe.com/v3/"></script></head><body><h1>Vos factures payées à temps</h1><h2>Pour les agences de 5 à 50 personnes</h2>
    <a href="/tarifs">Tarifs</a> <a href="/a-propos">À propos</a> <a href="https://www.linkedin.com/company/facturo">LinkedIn</a></body></html>`,
  '/tarifs': '<html><head><title>Tarifs | Facturo</title></head><body><h1>Tarifs</h1><p>Solo 19 € par mois. Équipe 49 € par mois.</p></body></html>',
  '/a-propos': '<html><head><title>À propos | Facturo</title></head><body><h1>Notre mission</h1><p>Fondé à Lyon par deux anciens DAF.</p></body></html>',
};
http.createServer((req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  if (!PAGES[p]) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(PAGES[p]);
}).listen(SITE_PORT, '127.0.0.1');

const calls = [];
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
    if (req.url === '/__calls') return res.end(JSON.stringify(calls));
    calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
    res.end(req.url === '/emails' ? JSON.stringify({ id: `em_${calls.length}` }) : JSON.stringify({ data: [{ id: 'dom_1', name: 'facturo.fr', status: 'verified' }] }));
  });
}).listen(RESEND_PORT, '127.0.0.1');

await import('./ensure-ui.js');
const { start } = await import('../src/cli.js');
await start();
// Most specs work on an existing workspace; the onboarding spec brings the welcome back itself.
const { callTool } = await import('../src/service.js');
await callTool('onboarding_skip', {});
