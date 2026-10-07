import {
  BadRequestException, ConflictException, HttpException, Inject, Injectable, ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { createHash, createHmac, randomBytes, randomUUID } from 'node:crypto';
import * as bcrypt from 'bcryptjs';
import { AppEnv, ENV } from '../config/env';
import { FORMATO_TOKEN_SENHA, hashTokenSenha } from './token-senha';
import { emitirAccessToken } from './tokens';
import { UsuarioAuth, UsuariosRepo } from './usuarios.repo';

/** Sessão emitida: o access token vai no corpo, o refresh cru vira cookie HttpOnly. */
export interface SessaoEmitida {
  accessToken: string;
  /** Opaco, aleatório. O banco guarda só o hash; isto vai para o cookie e some. */
  refreshToken: string;
  /** Vida do access token, em segundos (para o front agendar o refresh). */
  accessTtl: number;
  /** Vida do refresh token, em segundos (para o Max-Age do cookie). */
  refreshTtl: number;
}

/**
 * Hash bcrypt fixo e inofensivo usado como alvo do compare quando a conta não
 * existe ou não tem senha. Mantém o tempo de resposta parecido com o de uma
 * conta real, para o login não virar um oráculo de "este e-mail existe".
 * (bcrypt de uma senha aleatória; nunca corresponde a nada.)
 */
const HASH_FALSO = '$2a$10$CwTycUXWue0Thq9StjUM0uJ8Dqz9lk7q4m0b3w1q6b0cQF5F2fK2.';

const MENSAGEM_LOGIN = 'E-mail ou senha incorretos. Verifique os dados e tente novamente.';
const MENSAGEM_RECUPERACAO = 'Se existir uma conta com esse e-mail, enviaremos instruções.';
const MENSAGEM_EMAIL_EM_USO = 'Não foi possível criar a conta com este e-mail. Se ele já é seu, entre ou use "Esqueci minha senha".';
const MENSAGEM_LIMITE = 'Muitas tentativas em pouco tempo. Aguarde alguns minutos e tente de novo.';

/** Mesmo custo do bcrypt do Supabase ($2a$10$), o que o login já confere. */
const CUSTO_BCRYPT = 10;
/** Cadastros por IP por hora (escritório atrás de um NAT cabe folgado) e teto global por minuto. */
const LIMITE_CADASTRO_IP = 10;
const JANELA_CADASTRO_IP_S = 3600;
const LIMITE_CADASTRO_GLOBAL = 60;
const JANELA_CADASTRO_GLOBAL_S = 60;
/** Definir senha pelo link: 20 tentativas por IP por hora e um teto global por minuto. */
const LIMITE_DEFINIR_SENHA_IP = 20;
const JANELA_DEFINIR_SENHA_IP_S = 3600;
const LIMITE_DEFINIR_SENHA_GLOBAL = 120;
const JANELA_DEFINIR_SENHA_GLOBAL_S = 60;
const MENSAGEM_LINK_INVALIDO = 'Este link expirou ou já foi usado. Peça um novo.';

/** O que o cadastro recebe (já validado pelo CadastroDto). */
export interface DadosCadastro {
  email: string;
  senha: string;
  nome: string;
  cnpj: string;
  telefone: string;
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(ENV) private readonly env: AppEnv,
    private readonly repo: UsuariosRepo,
  ) {}

  /** O login próprio só funciona com a chave configurada; sem ela, 503. */
  private exigirSecret(): string {
    if (!this.env.authJwtSecret) {
      throw new ServiceUnavailableException('Login próprio ainda não disponível.');
    }
    return this.env.authJwtSecret;
  }

  private normalizar(email: string): string {
    return email.trim().toLowerCase();
  }

  /**
   * Confere e-mail + senha e emite a sessão. Resposta e tempo são os mesmos para
   * conta inexistente, sem senha, inativa ou senha errada: sempre o compare roda
   * (contra o hash real ou o falso) e o erro é único e genérico.
   */
  async login(email: string, senha: string): Promise<SessaoEmitida> {
    this.exigirSecret();
    const usuario = await this.repo.buscarPorEmail(this.normalizar(email));
    const hashAlvo = usuario?.passwordHash ?? HASH_FALSO;
    const confere = await bcrypt.compare(senha, hashAlvo);
    if (!usuario || !usuario.passwordHash || usuario.status !== 'ativo' || !confere) {
      throw new UnauthorizedException(MENSAGEM_LOGIN);
    }
    return this.emitirSessao(usuario);
  }

  /**
   * Cadastro pela API (substitui o supabase.auth.signUp). Cria auth.users (o gatilho de sempre
   * monta corretor, organização e etapas) e public.usuarios numa transação, e já devolve a
   * sessão, como o login: o e-mail entra confirmado, porque o e-mail transacional ainda não existe.
   *
   * Limite por IP (e um teto global) antes de tocar no bcrypt ou no banco da conta. A chave do
   * IP é um HMAC com o segredo do login: a tabela de limites nunca guarda um IP reversível.
   */
  async cadastrar(dados: DadosCadastro, ip: string | null): Promise<SessaoEmitida> {
    const segredo = this.exigirSecret();
    const chaveIp = createHmac('sha256', segredo).update(`cadastro:${ip ?? 'sem-ip'}`).digest('hex');
    const dentroDoLimite = await this.repo.consumirLimite('auth-cadastro-ip', chaveIp, LIMITE_CADASTRO_IP, JANELA_CADASTRO_IP_S)
      && await this.repo.consumirLimite('auth-cadastro-global', 'global', LIMITE_CADASTRO_GLOBAL, JANELA_CADASTRO_GLOBAL_S);
    if (!dentroDoLimite) {
      throw new HttpException({ statusCode: 429, codigo: 'muitas_tentativas', message: MENSAGEM_LIMITE }, 429);
    }

    const passwordHash = await bcrypt.hash(dados.senha, CUSTO_BCRYPT);
    const usuario = await this.repo.criarConta({
      email: this.normalizar(dados.email),
      passwordHash,
      nome: dados.nome.trim(),
      cnpj: dados.cnpj.trim(),
      telefone: dados.telefone.trim(),
    });
    if (!usuario) {
      throw new ConflictException({ statusCode: 409, codigo: 'email_em_uso', message: MENSAGEM_EMAIL_EM_USO });
    }
    return this.emitirSessao(usuario);
  }

  /**
   * Cria (ou troca) a senha pelo link de uso único (checkout do site; depois, a recuperação).
   * Limite por IP e global antes de tocar no bcrypt ou no banco. Token inexistente, usado,
   * vencido ou de conta inativa: o MESMO 400 genérico. Sucesso grava o bcrypt, incrementa
   * session_version (derruba as sessões antigas) e já devolve a sessão, como o login.
   */
  async definirSenha(token: string, senha: string, ip: string | null): Promise<SessaoEmitida> {
    const segredo = this.exigirSecret();
    const chaveIp = createHmac('sha256', segredo).update(`definir-senha:${ip ?? 'sem-ip'}`).digest('hex');
    const dentroDoLimite = await this.repo.consumirLimite('auth-definir-senha-ip', chaveIp, LIMITE_DEFINIR_SENHA_IP, JANELA_DEFINIR_SENHA_IP_S)
      && await this.repo.consumirLimite('auth-definir-senha-global', 'global', LIMITE_DEFINIR_SENHA_GLOBAL, JANELA_DEFINIR_SENHA_GLOBAL_S);
    if (!dentroDoLimite) {
      throw new HttpException({ statusCode: 429, codigo: 'muitas_tentativas', message: MENSAGEM_LIMITE }, 429);
    }
    const linkInvalido = new BadRequestException({ statusCode: 400, codigo: 'link_invalido', message: MENSAGEM_LINK_INVALIDO });
    if (!FORMATO_TOKEN_SENHA.test(token)) throw linkInvalido;

    const passwordHash = await bcrypt.hash(senha, CUSTO_BCRYPT);
    const usuario = await this.repo.consumirTokenSenha(hashTokenSenha(token), passwordHash);
    if (!usuario) throw linkInvalido;
    return this.emitirSessao(usuario);
  }

  /** Emite access + refresh novos para uma família nova (chamado pelo login e pelo cadastro). */
  private async emitirSessao(usuario: UsuarioAuth): Promise<SessaoEmitida> {
    const familyId = randomUUID();
    return this.gerarPar(usuario.id, usuario.email, usuario.sessionVersion, familyId);
  }

  /** Gera o par access/refresh de uma família (nova no login, mantida no refresh). */
  private async gerarPar(userId: string, email: string, sessionVersion: number, familyId: string): Promise<SessaoEmitida> {
    const segredo = this.exigirSecret();
    const accessToken = await emitirAccessToken(
      { sub: userId, email, sessionVersion },
      { segredo, issuer: this.env.authIssuer, ttlSegundos: this.env.authAccessTtl },
    );
    const refreshToken = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + this.env.authRefreshTtl * 1000);
    await this.repo.inserirRefreshToken({
      userId, familyId, tokenHash: hashRefresh(refreshToken), sessionVersion, expiresAt,
    });
    return { accessToken, refreshToken, accessTtl: this.env.authAccessTtl, refreshTtl: this.env.authRefreshTtl };
  }

  /**
   * Rotação obrigatória. Erros são genéricos (401). Reuso de um refresh já usado
   * ou já revogado derruba a FAMÍLIA inteira: é o sinal clássico de token
   * roubado. Troca de senha (session_version diferente) também invalida.
   */
  async refresh(refreshTokenRaw: string | undefined): Promise<SessaoEmitida> {
    this.exigirSecret();
    if (!refreshTokenRaw) throw new UnauthorizedException('Sessão expirada.');

    const registro = await this.repo.buscarRefreshPorHash(hashRefresh(refreshTokenRaw));
    if (!registro) throw new UnauthorizedException('Sessão expirada.');

    const derrubar = async (): Promise<never> => {
      await this.repo.revogarFamilia(registro.familyId);
      throw new UnauthorizedException('Sessão expirada.');
    };

    // Reuso: um refresh já usado ou já revogado chegando de novo = família comprometida.
    if (registro.usedAt || registro.revokedAt) await derrubar();
    if (registro.expiresAt.getTime() <= Date.now()) await derrubar();

    const usuario = await this.repo.buscarPorId(registro.userId);
    // Conta sumiu, inativa, ou senha trocada (session_version avançou): família cai.
    if (!usuario || usuario.status !== 'ativo' || usuario.sessionVersion !== registro.sessionVersion) await derrubar();

    // Consome este refresh; se a marcação não pegou (corrida/reuso), derruba a família.
    const marcados = await this.repo.marcarUsado(registro.id);
    if (marcados !== 1) await derrubar();

    return this.gerarPar(usuario!.id, usuario!.email, usuario!.sessionVersion, registro.familyId);
  }

  /** Logout: revoga a família do refresh apresentado. Idempotente e sempre silencioso. */
  async logout(refreshTokenRaw: string | undefined): Promise<void> {
    if (!refreshTokenRaw) return;
    const registro = await this.repo.buscarRefreshPorHash(hashRefresh(refreshTokenRaw));
    if (registro) await this.repo.revogarFamilia(registro.familyId);
  }

  /**
   * Recuperação de senha. Enquanto o e-mail (Resend) não existir, NUNCA envia nem
   * revela se a conta existe: resposta genérica 200 sempre. Nada é instanciado.
   */
  async forgotPassword(_email: string): Promise<{ mensagem: string }> {
    // emailHabilitado === false nesta fase: o adaptador Resend nem é tocado.
    return { mensagem: MENSAGEM_RECUPERACAO };
  }

  /**
   * Reset de senha. Desabilitado enquanto o e-mail não existir (503 neutro): sem
   * e-mail não há como emitir o token de reset, então não há o que consumir.
   */
  async resetPassword(_token: string, _senha: string): Promise<never> {
    if (!this.env.emailHabilitado) {
      throw new ServiceUnavailableException('Recuperação de senha ainda não disponível.');
    }
    // Quando o e-mail entrar, aqui valida o token, grava o novo bcrypt, incrementa
    // session_version (derruba sessões) e revoga os refresh tokens do usuário.
    throw new ServiceUnavailableException('Recuperação de senha ainda não disponível.');
  }
}

/** SHA-256 hex do refresh cru. O banco só conhece o hash, nunca o token. */
export function hashRefresh(refreshTokenRaw: string): string {
  return createHash('sha256').update(refreshTokenRaw).digest('hex');
}
