/**
 * Captura de tela das rotas autenticadas, para validação visual do redesign.
 *
 * Não toca no banco: injeta uma sessão de teste no localStorage e intercepta
 * TODA chamada ao Supabase, devolvendo dados de exemplo. Nada aqui vai para o
 * app — é ferramenta de inspeção, roda fora de src/.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = process.env.BASE_URL || 'http://localhost:8087';
const REF = 'dqlolypbmsjgqrvdesev';
const OUT = process.argv[2] || './shots';
mkdirSync(OUT, { recursive: true });

const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const UID = '11111111-1111-4111-8111-111111111111';
const exp = Math.floor(Date.now() / 1000) + 60 * 60 * 8;
// JWT sem assinatura válida — o supabase-js decodifica no cliente e não verifica.
const jwt = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({
  sub: UID, role: 'authenticated', exp, aud: 'authenticated',
  email: 'evandro@exemplo.test',
})}.assinatura-de-teste`;

const sessao = {
  access_token: jwt,
  refresh_token: 'refresh-de-teste',
  expires_at: exp,
  expires_in: 28800,
  token_type: 'bearer',
  user: {
    id: UID, aud: 'authenticated', role: 'authenticated',
    email: 'evandro@exemplo.test', created_at: '2026-01-10T12:00:00Z',
    app_metadata: {}, user_metadata: { nome: 'Evandro Lopes' },
  },
};

const corretor = [{
  id: 'c0000000-0000-4000-8000-000000000001', user_id: UID,
  nome: 'Evandro Lopes', email: 'evandro@exemplo.test', telefone: '(62) 99462-9401',
  creci: '12345', creci_estado: 'GO', status: 'ativo',
  created_at: '2026-01-10T12:00:00Z', updated_at: '2026-08-01T12:00:00Z',
  preferencias: {},
}];

const etapas = ['QUALIFICACAO', 'VISITA_PROPOSTA', 'DOCUMENTACAO', 'FECHADO_GANHO'];
const clientes = Array.from({ length: 26 }, (_, i) => ({
  id: `cli-${i}`, corretor_id: corretor[0].id,
  nome: ['Ana Beatriz Moraes', 'Admar Alves Rodrigues', 'Carmen Emília de Oliveira',
         'Diego Vinícius Mendes', 'Rafael Souza Lima', 'Juliana Prado'][i % 6] + (i > 5 ? ` ${i}` : ''),
  telefone: `(62) 9${String(9000 + i).slice(0, 4)}-${String(1000 + i).slice(0, 4)}`,
  email: `contato${i}@exemplo.test`,
  // 25 em qualificação e 1 fechado — reproduz a distribuição da referência.
  status_funil: i === 25 ? 'FECHADO_GANHO' : etapas[0],
  tipo_interesse: 'COMPRA', ultimo_contato: '2026-08-11T10:00:00Z',
  proximo_followup: i < 3 ? '2026-08-16T10:00:00Z' : null,
  created_at: '2026-07-01T10:00:00Z', cliente_imovel: [],
}));

const imoveis = Array.from({ length: 27 }, (_, i) => ({
  id: `imo-${i}`, corretor_id: corretor[0].id,
  titulo: ['Sobrado com 3 suítes, suíte master com varanda',
           'Avenida Santos Dumont, nº 326, Quadra 05, Lote 02',
           'Rua Vítor de Azevedo, Apto 1.204',
           'Rua Presidente Kennedy, nº 70'][i % 4],
  tipo: 'CASA', valor: i % 4 === 1 ? 0 : [450000, 1900, 2300, 890000][i % 4],
  area_m2: 120 + i, dormitorios: 3, garagem: 2,
  endereco: i % 4 === 1 ? '' : `Rua Exemplo, ${100 + i}`,
  bairro: 'Jundiaí', cidade: 'Anápolis', estado: 'GO',
  proprietario_nome: 'Proprietário Exemplo', ativo: true,
  status_venda: 'DISPONIVEL', anunciado: true, created_at: '2026-06-01T10:00:00Z',
}));

const alertas = [
  { id: 'al-1', corretor_id: corretor[0].id,
    mensagem: 'Recebimento de R$ 2.300,00 de Diego Vinícius Mendes (2026-08)',
    tipo: 'PAGAMENTO', prioridade: 'MEDIA', lido: false,
    origem: 'asaas', entidade_tipo: 'fatura', entidade_id: 'f-1',
    metadata: { valor: 2300 }, created_at: new Date(Date.now() - 20*60000).toISOString() },
  { id: 'al-2', corretor_id: corretor[0].id,
    mensagem: 'Repasse de R$ 1.840,00 confirmado para Carmen Emília de Oliveira',
    tipo: 'TRANSFERENCIA', prioridade: 'MEDIA', lido: false,
    origem: 'asaas', entidade_tipo: 'repasse', entidade_id: 'r-1',
    metadata: { valor: 1840 }, created_at: new Date(Date.now() - 3*3600000).toISOString() },
  { id: 'al-3', corretor_id: corretor[0].id,
    mensagem: 'Repasse de R$ 970,00 para Admar Alves Rodrigues NÃO foi concluído',
    tipo: 'TRANSFERENCIA', prioridade: 'ALTA', lido: false,
    origem: 'asaas', entidade_tipo: 'repasse', entidade_id: 'r-2',
    metadata: { valor: 970 }, created_at: new Date(Date.now() - 26*3600000).toISOString() },
  { id: 'al-4', corretor_id: corretor[0].id,
    mensagem: 'Contrato de locação vence em 15 dias — Rua Vítor de Azevedo, Apto 1.204',
    tipo: 'GERAL', prioridade: 'ALTA', lido: true, origem: 'sistema',
    created_at: new Date(Date.now() - 4*86400000).toISOString() },
  // Lidas e mais antigas: exercitam as quebras "Esta semana" / "Este mês" do
  // painel, que só aparecem com histórico de mais de um dia.
  { id: 'al-5', corretor_id: corretor[0].id,
    mensagem: 'Recebimento de R$ 4.150,00 de Ana Beatriz Moraes (2026-07)',
    tipo: 'PAGAMENTO', prioridade: 'MEDIA', lido: true,
    origem: 'asaas', entidade_tipo: 'fatura', entidade_id: 'f-2',
    metadata: { valor: 4150 }, created_at: new Date(Date.now() - 12*86400000).toISOString() },
  { id: 'al-6', corretor_id: corretor[0].id,
    mensagem: 'Documento pendente de assinatura — Juliana Prado',
    tipo: 'DOCUMENTO', prioridade: 'BAIXA', lido: true, origem: 'sistema',
    entidade_tipo: 'cliente', entidade_id: 'cli-5',
    created_at: new Date(Date.now() - 40*86400000).toISOString() },
];

const TABELAS = {
  corretores: corretor, clientes, imoveis, alertas,
  contratos: [], documentos: [], lancamentos_financeiros: [],
  crm_etapas: [], crm_oportunidades: [], crm_tarefas: [],
  fachadas: [{
    id: 'fac-1', corretor_id: corretor[0].id, imovel_id: 'imo-0',
    tipo_negocio: 'VENDA', template_id: 'venda-classica', cta_principal: 'WHATSAPP',
    modo_conversao: true, ativo: true,
    total_escaneamentos: 19, total_leads: 9,
    foto_principal_url: null, created_at: '2026-07-01T10:00:00Z',
    imoveis: { titulo: 'Sobrado com 3 suítes, suíte master com varanda',
               endereco: 'Rua Tocantins, bairro de Lourdes, quadra 46, lote 9',
               bairro: 'Anápolis' },
  }],
  fachada_leads: [], fachada_escaneamentos: [], videos: [], imovel_fotos: [],
  faturas_aluguel: [], repasses_proprietario: [], subscriptions: [],
};

const ROTAS = [
  { nome: '01-inicio', path: '/', abrirSino: true },
  { nome: '02-funil', path: '/crm' },
  { nome: '03-financeiro', path: '/financeiro' },
  { nome: '04-juridico', path: '/juridico' },
  { nome: '05-midias', path: '/midias' },
  { nome: '06-fachadas', path: '/fachadas' },
  { nome: '07-clientes', path: '/clientes' },
  { nome: '08-assistente', path: '/assistente' },
];

const VIEWPORTS = [
  { nome: '1600x900', width: 1600, height: 900 },
  { nome: '1280x800', width: 1280, height: 800 },
  { nome: '390x844', width: 390, height: 844 },
];

const alvo = process.env.VIEWPORTS
  ? VIEWPORTS.filter((v) => process.env.VIEWPORTS.split(',').includes(v.nome))
  : VIEWPORTS;

const navegador = await chromium.launch();
const erros = [];

for (const vp of alvo) {
  const ctx = await navegador.newContext({
    viewport: { width: vp.width, height: vp.height },
    deviceScaleFactor: 1,
    locale: 'pt-BR',
  });

  await ctx.addInitScript(
    ([chave, valor]) => window.localStorage.setItem(chave, valor),
    [`sb-${REF}-auth-token`, JSON.stringify(sessao)],
  );

  // Intercepta tudo que sai para o Supabase. Qualquer rota não mapeada devolve
  // [] em vez de erro, para a tela renderizar seu empty state de verdade.
  await ctx.route('**/*.supabase.co/**', async (route) => {
    const url = route.request().url();
    if (url.includes('/auth/v1/')) {
      return route.fulfill({ status: 200, contentType: 'application/json',
        body: JSON.stringify(url.includes('user') ? sessao.user : sessao) });
    }
    const m = url.match(/\/rest\/v1\/([a-z_]+)/);
    const dados = m ? (TABELAS[m[1]] ?? []) : [];
    return route.fulfill({
      status: 200, contentType: 'application/json',
      headers: { 'content-range': `0-${Math.max(dados.length - 1, 0)}/${dados.length}` },
      body: JSON.stringify(dados),
    });
  });

  const page = await ctx.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') erros.push(`[${vp.nome}] ${msg.text().slice(0, 160)}`);
  });
  page.on('pageerror', (e) => erros.push(`[${vp.nome}] PAGEERROR ${e.message.slice(0, 160)}`));

  for (const rota of ROTAS) {
    await page.goto(`${BASE}${rota.path}`, { waitUntil: 'networkidle' });
    await page.waitForTimeout(700);

    if (rota.abrirSino) {
      const sino = page.locator('button[aria-label*="Notifica"]').first();
      if (await sino.count()) { await sino.click(); await page.waitForTimeout(500); }
    }

    // Detecta rolagem horizontal acidental — critério explícito do pedido.
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1,
    );
    if (overflow) erros.push(`[${vp.nome}] OVERFLOW-X em ${rota.path}`);

    await page.screenshot({
      path: join(OUT, `${rota.nome}_${vp.nome}.png`),
      fullPage: vp.width < 500,
    });
    console.log(`ok ${rota.nome} @ ${vp.nome}${overflow ? '  <-- OVERFLOW-X' : ''}`);
  }

  await ctx.close();
}

await navegador.close();

if (erros.length) {
  console.log('\n--- ERROS DE CONSOLE / OVERFLOW ---');
  [...new Set(erros)].slice(0, 25).forEach((e) => console.log(e));
} else {
  console.log('\nNenhum erro de console e nenhum overflow horizontal.');
}
