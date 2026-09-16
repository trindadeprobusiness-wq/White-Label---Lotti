// Teste do bundle com os headers de produção; não acessa contas reais.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../', import.meta.url));
const dist = resolve(root, 'dist');
const config = JSON.parse(await readFile(resolve(root, 'vercel.json'), 'utf8'));
const headers = Object.fromEntries(config.headers.find(h => h.source === '/(.*)').headers.map(h => [h.key, h.value]));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
const server = createServer(async (req, res) => {
  try {
    let file = resolve(dist, `.${new URL(req.url, 'http://localhost').pathname}`);
    if (file !== dist && !file.startsWith(dist + sep)) { res.writeHead(403).end(); return; }
    if (!(await stat(file).catch(() => null))?.isFile()) file = resolve(dist, 'index.html');
    res.writeHead(200, { ...headers, 'Content-Type': mime[extname(file)] || 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(500).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Analytics/fontes e Supabase não precisam de rede real para esta verificação.
  await page.route('**/*', route => new URL(route.request().url()).origin === origin ? route.continue() : route.fulfill({ status: 200, body: '', contentType: 'text/plain' }));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${origin}/auth`);
  await page.getByRole('button', { name: 'Entrar', exact: true }).waitFor();
  assert.equal(await page.locator('input[type="password"]').count(), 1);
  const blocked = await page.evaluate(async () => {
    const violations = [];
    document.addEventListener('securitypolicyviolation', e => violations.push(e.violatedDirective));
    const script = document.createElement('script');
    script.textContent = 'window.__injected = true';
    document.body.append(script);
    await new Promise(r => setTimeout(r, 100));
    return { executed: window.__injected === true, violations };
  });
  assert.equal(blocked.executed, false);
  assert.ok(blocked.violations.includes('script-src-elem'));
  await page.goto(`${origin}/rotina`);
  await page.waitForURL('**/auth');
  assert.deepEqual(errors, []);
  console.log('PASS: login, proteção de rota e bloqueio de script inline com CSP; nenhum erro de execução.');
} finally {
  await browser?.close();
  await new Promise(resolve => server.close(resolve));
}
