import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import {
  AtualizarPedidoDto, BuscarContaDto, BuscarPedidoDto, ConcluirEventoDto, CriarPedidoDto, LimiteDto, LinkSenhaDto,
  PagamentoDto, ReservarEventoDto,
} from './checkout.dto';
import { CheckoutService } from './checkout.service';
import { CheckoutTokenGuard } from './checkout-token.guard';

/**
 * Checkout do site institucional (Lotti-Site, Next.js na Vercel), servidor a servidor. Substitui
 * o acesso do site ao Supabase (Secret Key): tabela checkout_orders, RPCs consume_checkout_rate_limit,
 * claim/finish_asaas_checkout_event, apply_checkout_payment, claim_checkout_order_provisioning e o
 * Supabase Auth (convite/recuperação), que virou conta no login próprio + link de criar senha.
 * Autenticação: cabeçalho x-lotti-checkout = CHECKOUT_API_TOKEN (CheckoutTokenGuard).
 */
@Controller('checkout')
@UseGuards(CheckoutTokenGuard)
export class CheckoutController {
  constructor(private readonly servico: CheckoutService) {}

  /** consume_checkout_rate_limit com a chave HMAC do IP feita pelo site. 503 sem a página de senha. */
  @Post('limite')
  @HttpCode(200)
  limite(@Body() dto: LimiteDto) {
    return this.servico.consumirLimite(dto.chave);
  }

  @Post('pedidos')
  @HttpCode(201)
  criar(@Body() dto: CriarPedidoDto) {
    return this.servico.criarPedido(dto);
  }

  /** Pedido pela assinatura do Asaas (?assinatura=sub_...). 404 quando não há. */
  @Get('pedidos')
  porAssinatura(@Query() dto: BuscarPedidoDto) {
    return this.servico.buscarPorAssinatura(dto.assinatura);
  }

  @Get('pedidos/:id')
  obter(@Param('id') id: string) {
    return this.servico.obterPedido(id);
  }

  @Patch('pedidos/:id')
  atualizar(@Param('id') id: string, @Body() dto: AtualizarPedidoDto) {
    return this.servico.atualizarPedido(id, dto);
  }

  /** apply_checkout_payment na conta já ligada ao pedido (renovação, atraso, estorno). */
  @Post('pedidos/:id/pagamento')
  @HttpCode(200)
  pagamento(@Param('id') id: string, @Body() dto: PagamentoDto) {
    return this.servico.aplicarPagamento(id, dto);
  }

  /** claim_checkout_order_provisioning. */
  @Post('pedidos/:id/provisionamento/reservar')
  @HttpCode(200)
  reservarProvisionamento(@Param('id') id: string) {
    return this.servico.reservarProvisionamento(id);
  }

  /** Reserva + conta (login próprio, sem senha) + pagamento + pedido marcado, de uma vez. */
  @Post('pedidos/:id/provisionar')
  @HttpCode(200)
  provisionar(@Param('id') id: string, @Body() dto: PagamentoDto) {
    return this.servico.provisionar(id, dto);
  }

  /** Link de criar senha para a tela de sucesso (o token de status do navegador é conferido de novo). */
  @Post('pedidos/:id/link-senha')
  @HttpCode(200)
  linkSenha(@Param('id') id: string, @Body() dto: LinkSenhaDto) {
    return this.servico.linkSenha(id, dto.token);
  }

  /** claim_asaas_checkout_event. */
  @Post('eventos/reservar')
  @HttpCode(200)
  reservarEvento(@Body() dto: ReservarEventoDto) {
    return this.servico.reservarEvento(dto.id, dto.event_type, dto.payment_id ?? null);
  }

  /** finish_asaas_checkout_event. */
  @Post('eventos/concluir')
  @HttpCode(200)
  concluirEvento(@Body() dto: ConcluirEventoDto) {
    return this.servico.concluirEvento(dto.id, dto.status, dto.error_code ?? null);
  }

  /** Conta pelo e-mail (login; ou só o perfil, com email_confere false). 404 quando não há. */
  @Get('contas')
  conta(@Query() dto: BuscarContaDto) {
    return this.servico.buscarConta(dto.email);
  }
}
