import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';

const out = new URL('../output/diagnostico-producao/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
for (const width of [390, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 844 } });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/functions/v1/commercial-diagnostic', route => route.fulfill({ status: 200, contentType: 'application/json', body: '{"success":true}' }));
  const response = await page.goto('https://app.plataformalotti.com.br/diagnostico?utm_source=verificacao');
  assert.equal(response?.status(), 200);
  await page.getByRole('button', { name: 'Começar diagnóstico' }).click();
  await page.getByText('Hoje você atua como:').waitFor();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  assert.deepEqual(errors, []);
  await page.screenshot({ path: fileURLToPath(new URL(`producao-${width}.png`, out)), fullPage: true });
  await page.close();
}
await browser.close();
console.log('Rota pública em produção validada em 390 e 1440 px.');
