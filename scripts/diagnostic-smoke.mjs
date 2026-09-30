import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const out = new URL('../output/diagnostico-smoke/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ headless: true });
const errors = [];
let submission;

for (const width of [375, 390, 430, 1440]) {
  const page = await browser.newPage({ viewport: { width, height: 844 }, deviceScaleFactor: 1 });
  page.on('pageerror', error => errors.push(`${width}: ${error.message}`));
  await page.route('**/functions/v1/commercial-diagnostic', async route => {
    const data = route.request().postDataJSON();
    if (data.action === 'submit') submission = data;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data.action === 'submit' ? { success: true, result: { dominant_problem: 'ATENDIMENTO' } } : { success: true }) });
  });
  await page.goto('http://127.0.0.1:8085/diagnostico?utm_source=smoke&utm_campaign=teste');
  await page.getByRole('button', { name: 'Começar diagnóstico' }).click();
  assert.equal(await page.getByText('Hoje você atua como:').count(), 1);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
  assert.equal(overflow, false, `overflow horizontal em ${width}px`);
  if (width === 375) await page.screenshot({ path: fileURLToPath(new URL('mobile-375.png', out)), fullPage: true });
  if (width === 390) await page.screenshot({ path: fileURLToPath(new URL('mobile-390.png', out)), fullPage: true });
  if (width === 430) await page.screenshot({ path: fileURLToPath(new URL('mobile-430.png', out)), fullPage: true });
  if (width === 1440) await page.screenshot({ path: fileURLToPath(new URL('desktop-1440.png', out)), fullPage: true });

  if (width === 390) {
    await page.getByRole('button', { name: 'Continuar' }).click();
    assert.equal(await page.getByRole('alert').count(), 1);
    await page.getByRole('button', { name: 'Imobiliária' }).click();
    await page.getByRole('button', { name: 'Continuar' }).click();
    assert.equal(await page.getByText('Quantos corretores fazem parte da operação?').count(), 1);
    await page.getByRole('button', { name: 'Voltar' }).click();
    assert.equal(await page.getByRole('button', { name: 'Imobiliária' }).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', { name: 'Continuar' }).click();
    const answers = [
      '6–15', 'Anúncios pagos', 'Aproveitar melhor os contatos que chegam', '101–250', '51–100',
      'R$ 3–10 mil', 'Às vezes demora ou fica sem resposta', 'Muitos contatos ficam sem retorno',
      'CRM', 'Demora no atendimento', 'Responder e converter melhor', 'Nos próximos 30 dias', 'Eu decido',
    ];
    for (const answer of answers) {
      await page.getByRole('button', { name: answer, exact: true }).click();
      await page.getByRole('button', { name: 'Continuar' }).click();
      if (answer === 'CRM') {
        await page.getByPlaceholder('Nome do CRM (opcional)').fill('CRM atual');
        await page.getByRole('button', { name: 'Continuar' }).click();
      }
    }
    await page.getByLabel('Nome *').fill('Pessoa de Teste');
    await page.getByLabel('WhatsApp com DDD *').fill('(11) 99999-9999');
    await page.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Ver diagnóstico' }).click();
    await page.getByText('Entendemos o momento da sua operação.').waitFor();
    assert.equal(submission.attribution.utm_source, 'smoke');
    assert.equal(submission.answers.team, '6–15');
    assert.equal(submission.answers.crm, 'CRM atual');
    await page.screenshot({ path: fileURLToPath(new URL('resultado-mobile-390.png', out)), fullPage: true });
  }
  await page.close();
}
await browser.close();
assert.deepEqual(errors, []);
console.log('Smoke visual e jornada completa aprovados em 375, 390, 430 e 1440 px.');
