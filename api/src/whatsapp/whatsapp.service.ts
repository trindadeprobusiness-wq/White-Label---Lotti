import {HttpException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { SupabaseClaims, TenantDb } from '../prisma/tenant-db';
import { BridgeDto } from './whatsapp.dto';

type Tx = Prisma.TransactionClient;
type JsonRow = { row: Record<string, unknown> };
type ParsedBridgeRequest = BridgeDto & { phone?: string };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const FILE_TYPES: Record<string, string[]> = {
  pdf:['application/pdf'],doc:['application/msword'],docx:['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  xls:['application/vnd.ms-excel'],xlsx:['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],ppt:['application/vnd.ms-powerpoint'],
  pptx:['application/vnd.openxmlformats-officedocument.presentationml.presentation'],txt:['text/plain'],csv:['text/csv','application/vnd.ms-excel'],
  zip:['application/zip','application/x-zip-compressed'],jpg:['image/jpeg'],jpeg:['image/jpeg'],png:['image/png'],webp:['image/webp'],gif:['image/gif'],
  mp4:['video/mp4'],webm:['video/webm','audio/webm'],mov:['video/quicktime'],mp3:['audio/mpeg'],ogg:['audio/ogg'],m4a:['audio/mp4','audio/x-m4a'],wav:['audio/wav','audio/x-wav'],
};
const jsonRows = (rows: JsonRow[]) => rows.map((r) => r.row);
const one = (rows: Array<{ value: unknown }>) => rows[0]?.value;

function invalid(error: string): never { throw new HttpException({ error }, 400); }
function parseBridgeRequest(body: BridgeDto): ParsedBridgeRequest {
  if (body.action === 'prepare_upload') {
    const name = String(body.name ?? '').trim();
    const mime = String(body.mime ?? '').toLowerCase();
    const size = Number(body.size);
    const ext = name.toLowerCase().split('.').pop() ?? '';
    if (!UUID.test(String(body.request_id ?? '')) || name.length < 1 || name.length > 180 ||
      !FILE_TYPES[ext]?.includes(mime) || !Number.isInteger(size) || size < 1 || size > 100 * 1024 * 1024) invalid('invalid_file');
    return { ...body, name, mime, size };
  }
  if (body.action !== 'start') return body;
  let phone = String(body.phone ?? '').replace(/\D/g, '');
  if (phone.length === 10 || phone.length === 11) phone = `55${phone}`;
  if (phone.length < 12 || phone.length > 15) invalid('invalid_phone');
  const text = String(body.text ?? '').trim();
  if (!text || text.length > 8000) invalid('invalid_text');
  if (!UUID.test(String(body.request_id ?? ''))) invalid('invalid_request_id');
  const name = String(body.name ?? '').trim();
  if (name.length > 120) invalid('invalid_name');
  return { ...body, phone, text, ...(name ? { name } : {}) };
}

function attachmentPath(body: ParsedBridgeRequest, ownerId: string): string {
  const safe = String(body.name).normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(-140) || 'arquivo';
  return `${ownerId}/${body.request_id}/${safe}`;
}

export type FiltroStatusConversa = 'open' | 'closed' | 'all';

/** Valor de ?status= da lista; qualquer outra coisa (ou nada) é 'all', o comportamento de antes. */
export function filtroStatusConversa(valor: unknown): FiltroStatusConversa {
  return valor === 'open' || valor === 'closed' ? valor : 'all';
}

@Injectable()
export class WhatsappService {
  private readonly logger = new Logger('WhatsappPonte');
  constructor(private readonly db: TenantDb) {}

  /**
   * As 100 conversas com mensagem mais recente (como no WhatsApp e no Clix): fechar, pausar ou o runtime
   * mexer na linha não reordena a lista. `status`: 'open' (Abertas, padrão do Inbox), 'closed' (Fechadas)
   * ou 'all' (sem filtro, o comportamento antigo). Conversa só com histórico importado não entra (so_historico).
   */
  listarConversas(claims: SupabaseClaims, status: FiltroStatusConversa = 'all') {
    return this.db.run(claims, async (tx) => jsonRows(await tx.$queryRaw<JsonRow[]>`
      select to_jsonb(x) - 'ordem' as row from (
        select c.id,c.phone,c.cliente_id,c.mode,c.status,c.updated_at,c.qualification,c.last_error,
          c.contact_name,c.opted_out_at,c.pausa_ia_ate,c.closed_by,c.closed_at,c.closed_reason,lm.created_at as last_message_at,
          case when cl.id is null then null else jsonb_build_object('nome',cl.nome) end as clientes,
          coalesce(lm.created_at,c.updated_at) as ordem
        from public.lotti_agent_conversations c left join public.clientes cl on cl.id=c.cliente_id
        left join lateral (select m.created_at from public.lotti_agent_messages m
          where m.conversation_id=c.id order by m.created_at desc limit 1) lm on true
        where c.archived_at is null and not c.so_historico and (${status}::text='all' or c.status=${status}::text)
        order by ordem desc, c.id limit 100
      ) x`));
  }

  /** Total e por situação, para o rodapé e os botões Abertas/Fechadas do Inbox. */
  contarConversas(claims: SupabaseClaims) {
    return this.db.run(claims, async (tx) => {
      const [r] = await tx.$queryRaw<Array<{ total: bigint; abertas: bigint; fechadas: bigint }>>`
        select count(*)::bigint total,
          count(*) filter (where status<>'closed')::bigint abertas,
          count(*) filter (where status='closed')::bigint fechadas
        from public.lotti_agent_conversations where archived_at is null and not so_historico`;
      return { total: Number(r?.total ?? 0n), abertas: Number(r?.abertas ?? 0n), fechadas: Number(r?.fechadas ?? 0n) };
    });
  }

  ultimasMensagens(claims: SupabaseClaims) {
    return this.db.run(claims, async (tx) => jsonRows(await tx.$queryRaw<JsonRow[]>`
      select to_jsonb(x) as row from (select conversation_id,direction,created_at,content from public.lotti_agent_latest_messages) x`));
  }

  mensagens(claims: SupabaseClaims, id: string) {
    return this.db.run(claims, async (tx) => jsonRows(await tx.$queryRaw<JsonRow[]>`
      select to_jsonb(x) as row from (select id,direction,sender,content,media_path,created_at,external_id,quoted_external_id,quoted_content,quoted_from_me
      from public.lotti_agent_messages where conversation_id=${id}::uuid order by created_at desc limit 200) x`).reverse());
  }

  eventos(claims: SupabaseClaims, id: string) {
    return this.db.run(claims, async (tx) => jsonRows(await tx.$queryRaw<JsonRow[]>`
      select to_jsonb(x) as row from (select id,kind,from_label,to_label,subject_label,actor_label,created_at
      from public.lotti_inbox_events where conversation_id=${id}::uuid order by created_at desc limit 200) x`).reverse());
  }

  private rpc(claims: SupabaseClaims, work: (tx: Tx) => Promise<Array<{ value: unknown }>>) {
    return this.db.run(claims, async (tx) => one(await work(tx)));
  }

  modo(claims: SupabaseClaims, id: string, mode: string) { return this.rpc(claims, (tx) => tx.$queryRaw`select public.lotti_agent_set_mode(${id}::uuid,${mode}) as value`); }
  reconciliar(claims: SupabaseClaims, id: string, chegou: boolean) { return this.rpc(claims, (tx) => tx.$queryRaw`select public.lotti_agent_reconciliar_envio(${id}::uuid,${chegou}) as value`); }
  limparOptOut(claims: SupabaseClaims, id: string) { return this.rpc(claims, (tx) => tx.$queryRaw`select public.lotti_inbox_clear_opt_out(${id}::uuid) as value`); }
  atualizarContato(claims: SupabaseClaims, id: string, name: string, phone: string) { return this.rpc(claims, (tx) => tx.$queryRaw`select public.lotti_inbox_update_contact(${id}::uuid,${name},${phone}) as value`); }
  mesclar(claims: SupabaseClaims, keep: string, drop: string) { return this.rpc(claims, (tx) => tx.$queryRaw`select public.lotti_inbox_merge_conversations(${keep}::uuid,${drop}::uuid) as value`); }
  status(claims: SupabaseClaims, id: string, status: string) { return this.rpc(claims, (tx) => tx.$queryRaw`select public.lotti_inbox_set_status(${id}::uuid,${status}) as value`); }

  canal(claims: SupabaseClaims, phone: string) {
    return this.db.run(claims, async (tx) => (await tx.$queryRaw<JsonRow[]>`
      select to_jsonb(x) row from (select id,instance,enabled,sandbox,account_phone,company_name,account_bound_at
      from public.lotti_agent_channels where account_phone=${phone} and archived_at is null limit 1) x`)[0]?.row ?? null);
  }
  empresa(claims: SupabaseClaims, phone: string, name: string) { return this.rpc(claims, (tx) => tx.$queryRaw`select public.lotti_channel_set_company_name(${phone},${name}) as value`); }

  configuracoes(claims: SupabaseClaims) {
    return this.db.run(claims, async (tx) => (await tx.$queryRaw<Array<{ settings: Record<string, unknown> }>>`
      select settings from public.lotti_agent_settings limit 1`)[0]?.settings ?? null);
  }
  salvarConfiguracoes(claims: SupabaseClaims, settings: Record<string, unknown>) { return this.rpc(claims, (tx) => tx.$queryRaw`select public.lotti_agent_save_settings(${JSON.stringify(settings)}::jsonb) as value`); }

  listarCampanhas(claims: SupabaseClaims) {
    return this.db.run(claims, async (tx) => jsonRows(await tx.$queryRaw<JsonRow[]>`
      select to_jsonb(x) row from (select c.*,coalesce((select jsonb_object_agg(s.status,s.total) from
      (select status,count(*)::int total from public.lotti_broadcast_deliveries d where d.campaign_id=c.id group by status)s),'{}'::jsonb) counts
      from public.lotti_broadcast_campaigns c order by updated_at desc limit 100)x`));
  }
  campanha(claims: SupabaseClaims, id: string) {
    return this.db.run(claims, async (tx) => {
      const campaign=(await tx.$queryRaw<JsonRow[]>`select to_jsonb(c) row from public.lotti_broadcast_campaigns c where id=${id}::uuid`)[0]?.row;
      if(!campaign) throw new HttpException({error:'forbidden'},403);
      const deliveries=jsonRows(await tx.$queryRaw<JsonRow[]>`select to_jsonb(x) row from (select d.id,d.status,d.reason,d.scheduled_at,d.updated_at,
        coalesce(nullif(cl.nome,'Contato WhatsApp'),c.contact_name,'Contato sem nome') contact from public.lotti_broadcast_deliveries d
        join public.lotti_agent_conversations c on c.id=d.conversation_id left join public.clientes cl on cl.id=c.cliente_id
        where d.campaign_id=${id}::uuid order by d.scheduled_at limit 300)x`);
      const events=jsonRows(await tx.$queryRaw<JsonRow[]>`select to_jsonb(x) row from (select id,kind,actor_label,created_at,detail
        from public.lotti_broadcast_events where campaign_id=${id}::uuid order by created_at desc limit 50)x`);
      return {campaign,deliveries,events};
    });
  }
  salvarCampanha(claims: SupabaseClaims,c:Record<string,unknown>){return this.rpc(claims,(tx)=>tx.$queryRaw`select public.lotti_broadcast_save(${JSON.stringify(c)}::jsonb) as value`);}
  previewCampanha(claims: SupabaseClaims,c:Record<string,unknown>){return this.rpc(claims,(tx)=>tx.$queryRaw`select public.lotti_broadcast_preview(${JSON.stringify(c)}::jsonb) as value`);}
  ativarCampanha(claims: SupabaseClaims,id:string){return this.rpc(claims,(tx)=>tx.$queryRaw`select public.lotti_broadcast_activate(${id}::uuid) as value`);}
  controlarCampanha(claims: SupabaseClaims,id:string,action:string){return this.rpc(claims,(tx)=>tx.$queryRaw`select public.lotti_broadcast_control(${id}::uuid,${action}) as value`);}
  duplicarCampanha(claims: SupabaseClaims,id:string){return this.rpc(claims,(tx)=>tx.$queryRaw`select public.lotti_broadcast_duplicate(${id}::uuid) as value`);}
  apagarRascunho(claims: SupabaseClaims,id:string){return this.rpc(claims,(tx)=>tx.$queryRaw`select public.lotti_broadcast_delete_draft(${id}::uuid) as value`);}
  async automacaoOnline(claims:SupabaseClaims){return this.db.run(claims,async tx=>{const r=await tx.$queryRaw<Array<{online:boolean}>>`select coalesce(max(seen_at)>now()-interval '2 minutes',false) online from public.lotti_automation_heartbeat`;return r[0]?.online??false;});}

  async esperando(claims: SupabaseClaims) {
    return this.db.run(claims, async tx => (await tx.$queryRaw<Array<{ esperando:number; urgentes:number }>>`
      with conversations as (select id,mode,qualification from public.lotti_agent_conversations limit 100),
      latest as (select distinct on(conversation_id) conversation_id,direction,created_at from public.lotti_agent_messages order by conversation_id,created_at desc,id desc),
      waiting as (select c.*,l.direction,l.created_at from conversations c join latest l on l.conversation_id=c.id
        where c.mode<>'ai' and l.direction='in')
      select count(*)::int esperando,count(*) filter(where coalesce(qualification->>'priority','')='alta' or created_at<=now()-interval '60 minutes')::int urgentes
      from waiting`)[0]??{esperando:0,urgentes:0});
  }

  async ponte(claims: SupabaseClaims, body: BridgeDto) {
    body = parseBridgeRequest(body);
    const owner = await this.db.run(claims, async tx => (await tx.$queryRaw<Array<{id:string;status:string}>>`
      select id::text,status::text from public.corretores where user_id=${claims.sub}::uuid limit 1`)[0]);
    if(!owner) throw new HttpException({error:'account_not_found'},403);
    if(owner.status==='suspenso') throw new HttpException({error:'account_suspended'},403);
    if(body.action==='prepare_upload') return {storage_path:attachmentPath(body,owner.id)};
    let conversationId: string|undefined;
    let payload: Record<string,unknown>={action:body.action,corretor_id:owner.id};
    if(body.action==='start'){
      const phone=String(body.phone);
      conversationId=String(await this.rpc(claims,tx=>tx.$queryRaw`select public.lotti_inbox_start_conversation(${phone},${body.name??null}) as value`));
      payload={action:'send',corretor_id:owner.id,conversation_id:conversationId,request_id:body.request_id,kind:'text',text:body.text};
    } else if(body.action==='send') payload={...payload,...body};
    const url=process.env.LOTTI_CHANNEL_BRIDGE_URL?.trim(),token=process.env.LOTTI_CHANNEL_BRIDGE_TOKEN?.trim();
    if(!url||!token)throw new HttpException({error:'bridge_not_configured'},503);
    let response:Response;
    try{response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-lotti-connect':token},body:JSON.stringify(payload),signal:AbortSignal.timeout(25000)});}catch{
      if(body.action==='start'&&conversationId)return {sendStatus:'uncertain',conversationId};
      this.logger.warn({codigo:'bridge_unreachable',acao:body.action});
      throw new HttpException({error:'bridge_unreachable'},503);
    }
    if(!response.ok){this.logger.warn({codigo:'bridge_rejected',acao:body.action,upstream:response.status});throw new HttpException({error:'bridge_rejected',upstream:response.status},503);}
    const result=await response.json() as Record<string,unknown>;
    if(body.action==='send'||body.action==='start'){
      const sendStatus=String(result.sendStatus??'');
      if(!['sent','sending','uncertain','failed','busy'].includes(sendStatus))throw new HttpException({error:'send_unavailable'},503);
      return {sendStatus,...(conversationId?{conversationId}:{})};
    }
    if(!['connected','connecting','disconnected'].includes(String(result.state))){this.logger.warn({codigo:'bridge_bad_state',estado:String(result.state).slice(0,40)});throw new HttpException({error:'bridge_bad_state'},503);}
    const phone=String(result.phone??result.ownerJid??'').split('@')[0].replace(/\D/g,'');
    const connectedAt=typeof result.connectedAt==='string'&&!Number.isNaN(Date.parse(result.connectedAt))?result.connectedAt:undefined;
    const qr=typeof result.qr==='string'&&result.qr.startsWith('data:image/png;base64,')?result.qr:undefined;
    return {state:result.state,agentEnabled:result.agentEnabled===true,...(phone.length>=8&&phone.length<=15?{phone}:{}),
      ...(connectedAt?{connectedAt}:{}),...(qr?{qr,qrExpiresAt:result.qrExpiresAt,qrGeneration:result.qrGeneration}:{})};
  }
}

