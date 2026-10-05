import { Prisma } from '@prisma/client';
import { erroDe } from '../fachadas.service.spec';
import { EnviarLeadDto } from './fachadas-publico.dto';
import { FachadasPublicoService } from './fachadas-publico.service';

const FACHADA = '11111111-1111-4111-8111-111111111111';
const lead = () => Object.assign(new EnviarLeadDto(), { nome: 'Ana Souza', telefone: '(11) 99999-8888' });

const pg = (code: string, mensagem: string) => new Prisma.PrismaClientKnownRequestError('x', {
  code: 'P2010', clientVersion: 'teste', meta: { code, message: `ERROR: ${mensagem}` },
});

function montar() {
  const repo = {
    verFachada: jest.fn(),
    registrarEscaneamento: jest.fn(async () => undefined),
    criarLead: jest.fn(async () => undefined),
  };
  return { repo, servico: new FachadasPublicoService(repo as never) };
}

describe('FachadasPublicoService P1', () => {
  it('devolve { fachada, fotos } como a Edge Function', async () => {
    const { repo, servico } = montar();
    repo.verFachada.mockResolvedValueOnce({ fachada: { id: FACHADA }, fotos: [{ id: 'f1' }] });
    expect(await servico.verFachada(FACHADA)).toEqual({ fachada: { id: FACHADA }, fotos: [{ id: 'f1' }] });
    expect(repo.verFachada).toHaveBeenCalledWith(FACHADA);
  });

  it('sem linha ativa dá 404 fachada_indisponivel', async () => {
    const { repo, servico } = montar();
    repo.verFachada.mockResolvedValueOnce(null);
    expect(await erroDe(servico.verFachada(FACHADA))).toEqual({
      status: 404,
      corpo: { statusCode: 404, codigo: 'fachada_indisponivel', message: 'Esta placa não está mais disponível.' },
    });
  });

  it('42501 na leitura também vira 404, sem revelar se a fachada existe', async () => {
    const { repo, servico } = montar();
    repo.verFachada.mockRejectedValueOnce(pg('42501', 'permission denied for table corretores'));
    expect(await erroDe(servico.verFachada(FACHADA))).toMatchObject({ status: 404, corpo: { codigo: 'fachada_indisponivel' } });
  });
});

describe('FachadasPublicoService P2', () => {
  it('repassa o user_agent recebido e não devolve corpo', async () => {
    const { repo, servico } = montar();
    expect(await servico.registrarEscaneamento(FACHADA, 'Mozilla/5.0')).toBeUndefined();
    expect(repo.registrarEscaneamento).toHaveBeenCalledWith(FACHADA, 'Mozilla/5.0');
  });

  it('fachada inativa dá 404 fachada_indisponivel (gatilho)', async () => {
    const { repo, servico } = montar();
    repo.registrarEscaneamento.mockRejectedValueOnce(pg('P0001', 'Fachada indisponível'));
    expect(await erroDe(servico.registrarEscaneamento(FACHADA, null))).toMatchObject({
      status: 404, corpo: { codigo: 'fachada_indisponivel' },
    });
  });

  it('limite estourado dá 429 muitas_tentativas', async () => {
    const { repo, servico } = montar();
    repo.registrarEscaneamento.mockRejectedValueOnce(pg('P0001', 'Muitas tentativas. Aguarde alguns minutos.'));
    expect(await erroDe(servico.registrarEscaneamento(FACHADA, null))).toMatchObject({
      status: 429, corpo: { codigo: 'muitas_tentativas' },
    });
  });
});

describe('FachadasPublicoService P3', () => {
  it('devolve { registrado: true } e nunca a linha', async () => {
    const { repo, servico } = montar();
    expect(await servico.enviarLead(FACHADA, lead())).toEqual({ registrado: true });
    expect(repo.criarLead).toHaveBeenCalledWith(FACHADA, lead());
  });

  it('erros do gatilho viram o código certo', async () => {
    const casos: Array<[string, number, string]> = [
      ['Fachada indisponível', 404, 'fachada_indisponivel'],
      ['Dados de contato inválidos', 400, 'contato_invalido'],
      ['Telefone inválido', 400, 'telefone_invalido'],
      ['Muitas tentativas. Aguarde alguns minutos.', 429, 'muitas_tentativas'],
    ];
    for (const [mensagem, status, codigo] of casos) {
      const { repo, servico } = montar();
      repo.criarLead.mockRejectedValueOnce(pg('P0001', mensagem));
      expect(await erroDe(servico.enviarLead(FACHADA, lead()))).toMatchObject({ status, corpo: { codigo } });
    }
  });

  it('Configuração de limite inválida sobe como veio (500 do Nest)', async () => {
    const { repo, servico } = montar();
    const e = pg('P0001', 'Configuração de limite inválida');
    repo.criarLead.mockRejectedValueOnce(e);
    await expect(servico.enviarLead(FACHADA, lead())).rejects.toBe(e);
  });
});
