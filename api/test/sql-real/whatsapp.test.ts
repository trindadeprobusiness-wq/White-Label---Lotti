import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { criarBanco } from './harness';
import { WhatsappService } from '../../src/whatsapp/whatsapp.service';

test('WhatsApp respeita RLS e mantém as RPCs como fonte de verdade',async()=>{
 const b=await criarBanco();
 try{
  const channelA=randomUUID(),channelB=randomUUID(),conversationA=randomUUID(),conversationB=randomUUID();
  await b.inserir('lotti_agent_channels',{id:channelA,corretor_id:b.corretorA,instance:'teste-a',enabled:true,sandbox:true});
  await b.inserir('lotti_agent_channels',{id:channelB,corretor_id:b.corretorB,instance:'teste-b',enabled:true,sandbox:true});
  await b.inserir('lotti_agent_conversations',{id:conversationA,channel_id:channelA,corretor_id:b.corretorA,phone:'5511999990001',mode:'human',qualification:{priority:'alta'}});
  await b.inserir('lotti_agent_conversations',{id:conversationB,channel_id:channelB,corretor_id:b.corretorB,phone:'5511999990002',mode:'human'});
  await b.inserir('lotti_agent_messages',{conversation_id:conversationA,external_id:'msg-a',direction:'in',sender:'lead',content:'teste'});
  await b.inserir('lotti_agent_messages',{conversation_id:conversationB,external_id:'msg-b',direction:'in',sender:'lead',content:'teste'});
  const service=new WhatsappService(b.db);
  const rows=await service.listarConversas(b.claimsA) as Array<{id:string}>;
  assert.deepEqual(rows.map(r=>r.id),[conversationA]);
  assert.deepEqual(await service.esperando(b.claimsA),{esperando:1,urgentes:1});
  // Número antigo arquivado e conversa só de histórico importado não contam como esperando resposta.
  for(const extra of [{archived_at:new Date().toISOString()},{so_historico:true}]){
   const id=randomUUID();
   await b.inserir('lotti_agent_conversations',{id,channel_id:channelA,corretor_id:b.corretorA,phone:'55119999'+String(Math.random()).slice(2,7),mode:'human',...extra});
   await b.inserir('lotti_agent_messages',{conversation_id:id,external_id:'msg-'+id,direction:'in',sender:'lead',content:'teste'});
   // A mensagem ao vivo tira o so_historico (gatilho); o histórico importado é marcado depois, como na importação.
   if(extra.so_historico)await b.sqlSuperusuario('update public.lotti_agent_conversations set so_historico=true where id=$1',[id]);
  }
  assert.deepEqual(await service.esperando(b.claimsA),{esperando:1,urgentes:1});
  assert.equal(await service.modo(b.claimsA,conversationA,'paused'),true);
  await assert.rejects(service.modo(b.claimsA,conversationB,'paused'),/forbidden/i);
  const state=await b.sqlSuperusuario<{id:string;mode:string}>('select id::text,mode from public.lotti_agent_conversations order by id');
  assert.equal(state.find(x=>x.id===conversationA)?.mode,'paused');
  assert.equal(state.find(x=>x.id===conversationB)?.mode,'human');
 }finally{await b.fechar();}
});


test('fechar conversa como no Clix: carimba quem fechou, não pausa a IA, some das Abertas e o cliente reabre',async()=>{
 const b=await criarBanco();
 try{
  const canal=randomUUID(),antiga=randomUUID(),recente=randomUUID();
  await b.inserir('lotti_agent_channels',{id:canal,corretor_id:b.corretorA,instance:'teste-fechar',enabled:true,sandbox:true});
  await b.inserir('lotti_agent_conversations',{id:antiga,channel_id:canal,corretor_id:b.corretorA,phone:'5511999990011',mode:'ai'});
  await b.inserir('lotti_agent_conversations',{id:recente,channel_id:canal,corretor_id:b.corretorA,phone:'5511999990012',mode:'ai'});
  await b.inserir('lotti_agent_messages',{conversation_id:antiga,external_id:'f-1',direction:'in',sender:'lead',content:'oi',created_at:new Date(Date.now()-3*3600_000).toISOString()});
  await b.inserir('lotti_agent_messages',{conversation_id:recente,external_id:'f-2',direction:'in',sender:'lead',content:'oi',created_at:new Date(Date.now()-60_000).toISOString()});
  const service=new WhatsappService(b.db);
  const ids=async(status:'open'|'closed'|'all')=>((await service.listarConversas(b.claimsA,status)) as Array<{id:string}>).map(r=>r.id);

  // Ordem pela última mensagem, não por quem mexeu na linha por último.
  await b.sqlSuperusuario(`update public.lotti_agent_conversations set updated_at=now() where id=$1`,[antiga]);
  assert.deepEqual(await ids('all'),[recente,antiga]);

  // Vendedor fecha: carimbo 'humano', IA continua no modo em que estava, sai das Abertas.
  await service.status(b.claimsA,recente,'closed');
  const [fechada]=await b.sqlSuperusuario<{status:string;mode:string;closed_by:string|null;closed_at:string|null}>(
   `select status,mode,closed_by,closed_at::text from public.lotti_agent_conversations where id=$1`,[recente]);
  assert.equal(fechada.status,'closed'); assert.equal(fechada.mode,'ai'); assert.equal(fechada.closed_by,'humano'); assert.ok(fechada.closed_at);
  assert.deepEqual(await ids('open'),[antiga]);
  assert.deepEqual(await ids('closed'),[recente]);
  assert.deepEqual(await service.contarConversas(b.claimsA),{total:2,abertas:1,fechadas:1});
  // Fechar a mesma de novo não gera outro evento.
  await service.status(b.claimsA,recente,'closed');

  // Mensagem antiga (histórico importado) não reabre.
  await b.inserir('lotti_agent_messages',{conversation_id:recente,external_id:'f-3',direction:'in',sender:'lead',content:'velha',created_at:new Date(Date.now()-2*86400_000).toISOString()});
  assert.equal((await b.sqlSuperusuario<{status:string}>(`select status from public.lotti_agent_conversations where id=$1`,[recente]))[0].status,'closed');

  // Cliente escreve agora: reabre, apaga o carimbo e a linha do tempo diz que foi o cliente.
  await b.inserir('lotti_agent_messages',{conversation_id:recente,external_id:'f-4',direction:'in',sender:'lead',content:'voltei'});
  const [reaberta]=await b.sqlSuperusuario<{status:string;closed_by:string|null;closed_at:string|null}>(
   `select status,closed_by,closed_at::text from public.lotti_agent_conversations where id=$1`,[recente]);
  assert.deepEqual(reaberta,{status:'open',closed_by:null,closed_at:null});
  const eventos=await b.sqlSuperusuario<{to_label:string;actor_label:string}>(
   `select to_label,actor_label from public.lotti_inbox_events where conversation_id=$1 and kind='status' order by created_at,id`,[recente]);
  assert.equal(eventos.length,2);
  assert.equal(eventos[0].to_label,'Fechada'); assert.notEqual(eventos[0].actor_label,'Cliente');
  assert.deepEqual(eventos[1],{to_label:'Aberta',actor_label:'Cliente'});

  // Acompanhamento automático que termina sem resposta: fecha como 'silencio'.
  await b.sqlSuperusuario(`update public.lotti_agent_conversations set revision=7,followup_revision=7 where id=$1`,[antiga]);
  const [ok]=await b.sqlSuperusuario<{ok:boolean}>(`select public.lotti_agent_followup_close($1::uuid,null,7,true,null) as ok`,[antiga]);
  assert.equal(ok.ok,true);
  const [silencio]=await b.sqlSuperusuario<{status:string;closed_by:string|null}>(`select status,closed_by from public.lotti_agent_conversations where id=$1`,[antiga]);
  assert.deepEqual(silencio,{status:'closed',closed_by:'silencio'});
  const [evento]=await b.sqlSuperusuario<{actor_label:string}>(
   `select actor_label from public.lotti_inbox_events where conversation_id=$1 and kind='status' order by created_at desc,id desc limit 1`,[antiga]);
  assert.equal(evento.actor_label,'acompanhamento sem resposta');
 }finally{await b.fechar();}
});

test('agente encerra como no Clix: só a conversa que a IA deixou, carimbo "cliente" e motivo; o cliente reabre',async()=>{
 const b=await criarBanco();
 try{
  const canal=randomUUID(),ok=randomUUID(),voltou=randomUUID(),humano=randomUUID();
  await b.inserir('lotti_agent_channels',{id:canal,corretor_id:b.corretorA,instance:'teste-encerrar',enabled:true,sandbox:true});
  await b.inserir('lotti_agent_conversations',{id:ok,channel_id:canal,corretor_id:b.corretorA,phone:'5511999990021',mode:'ai'});
  await b.inserir('lotti_agent_conversations',{id:voltou,channel_id:canal,corretor_id:b.corretorA,phone:'5511999990022',mode:'ai'});
  await b.inserir('lotti_agent_conversations',{id:humano,channel_id:canal,corretor_id:b.corretorA,phone:'5511999990023',mode:'human'});
  await b.sqlSuperusuario(`update public.lotti_agent_conversations set revision=3,processed_revision=3 where id in ($1,$2,$3)`,[ok,voltou,humano]);
  // O cliente escreveu de novo depois da despedida: revision andou.
  await b.sqlSuperusuario(`update public.lotti_agent_conversations set revision=4 where id=$1`,[voltou]);
  const encerrar=async(id:string)=>(await b.sqlSuperusuario<{r:boolean}>(`select public.lotti_agent_end_conversation($1::uuid,3,$2) as r`,[id,'  cliente disse que era só isso  ']))[0].r;
  assert.equal(await encerrar(ok),true);
  assert.equal(await encerrar(voltou),false);
  assert.equal(await encerrar(humano),false);
  const estado=await b.sqlSuperusuario<{id:string;status:string;closed_by:string|null;closed_reason:string|null}>(
   `select id::text,status,closed_by,closed_reason from public.lotti_agent_conversations where id in ($1,$2,$3)`,[ok,voltou,humano]);
  assert.deepEqual(estado.find(x=>x.id===ok),{id:ok,status:'closed',closed_by:'cliente',closed_reason:'cliente disse que era só isso'});
  assert.equal(estado.find(x=>x.id===voltou)?.status,'open');
  assert.equal(estado.find(x=>x.id===humano)?.status,'open');
  const [evento]=await b.sqlSuperusuario<{to_label:string;actor_label:string}>(
   `select to_label,actor_label from public.lotti_inbox_events where conversation_id=$1 and kind='status'`,[ok]);
  assert.deepEqual(evento,{to_label:'Fechada',actor_label:'IA'});
  // Fechada não fecha de novo; o motivo aparece na lista do corretor.
  assert.equal(await encerrar(ok),false);
  const service=new WhatsappService(b.db);
  const [linha]=(await service.listarConversas(b.claimsA,'closed')) as Array<{id:string;closed_by:string;closed_reason:string}>;
  assert.deepEqual([linha.id,linha.closed_by,linha.closed_reason],[ok,'cliente','cliente disse que era só isso']);
  // Cliente volta a escrever: reabre e o motivo some.
  await b.inserir('lotti_agent_messages',{conversation_id:ok,external_id:'e-1',direction:'in',sender:'lead',content:'esqueci uma coisa'});
  const [reaberta]=await b.sqlSuperusuario<{status:string;closed_by:string|null;closed_reason:string|null}>(
   `select status,closed_by,closed_reason from public.lotti_agent_conversations where id=$1`,[ok]);
  assert.deepEqual(reaberta,{status:'open',closed_by:null,closed_reason:null});
 }finally{await b.fechar();}
});

test('transferência para a equipe aparece com o motivo, não como "Sistema"',async()=>{
 const b=await criarBanco();
 try{
  const canal=randomUUID(),cv=randomUUID();
  await b.inserir('lotti_agent_channels',{id:canal,corretor_id:b.corretorA,instance:'teste-handoff',enabled:true,sandbox:true});
  await b.inserir('lotti_agent_conversations',{id:cv,channel_id:canal,corretor_id:b.corretorA,phone:'5511999990031',mode:'ai'});
  await b.sqlSuperusuario(`update public.lotti_agent_conversations set revision=2,processed_revision=2 where id=$1`,[cv]);
  const [r]=await b.sqlSuperusuario<{ok:boolean}>(`select public.lotti_agent_handoff($1::uuid,null,2,null,null,false) as ok`,[cv]);
  assert.equal(r.ok,true);
  const [ev]=await b.sqlSuperusuario<{to_label:string;actor_label:string}>(`select to_label,actor_label from public.lotti_inbox_events where conversation_id=$1 and kind='mode'`,[cv]);
  assert.deepEqual(ev,{to_label:'Equipe',actor_label:'transferência automática para a equipe'});
  // Quem religa continua aparecendo pelo nome (o autor da transferência não vaza para o evento seguinte).
  const service=new WhatsappService(b.db);
  await service.modo(b.claimsA,cv,'ai');
  const eventos=await b.sqlSuperusuario<{to_label:string;actor_label:string}>(`select to_label,actor_label from public.lotti_inbox_events where conversation_id=$1 and kind='mode' order by created_at,id`,[cv]);
  assert.equal(eventos.at(-1)?.to_label,'IA');
  assert.notEqual(eventos.at(-1)?.actor_label,'transferência automática para a equipe');
 }finally{await b.fechar();}
});

test('IA parada com motivo: resposta pelo celular desliga a IA (sem "em espera"); mídia do celular e envio pelo Inbox dizem quem',async()=>{
 const b=await criarBanco();
 try{
  const canal=randomUUID(),cv=randomUUID(),semCliente=randomUUID(),midia=randomUUID(),inbox=randomUUID();
  await b.inserir('lotti_agent_channels',{id:canal,corretor_id:b.corretorA,instance:'teste-motivo',enabled:true,sandbox:false});
  for(const [id,fone] of [[cv,'5511999990041'],[semCliente,'5511999990042'],[midia,'5511999990043'],[inbox,'5511999990044']] as const){
   await b.inserir('lotti_agent_conversations',{id,channel_id:canal,corretor_id:b.corretorA,phone:fone,mode:'ai'});
  }
  for(const id of [cv,midia,inbox])await b.inserir('lotti_agent_messages',{conversation_id:id,external_id:'in-'+id,direction:'in',sender:'lead',content:'oi'});
  const ingest=(fone:string,ext:string,extra:Record<string,unknown>={})=>b.sqlSuperusuario(`select public.lotti_agent_ingest($1::jsonb)`,
   [JSON.stringify({instance:'teste-motivo',external_id:ext,phone:fone,from_me:true,text:'resposta da equipe',...extra})]);
  const eventos=(id:string)=>b.sqlSuperusuario<{kind:string;to_label:string;subject_label:string|null;actor_label:string}>(
   `select kind,to_label,subject_label,actor_label from public.lotti_inbox_events where conversation_id=$1 order by created_at,id`,[id]);

  // Celular: a IA desliga de vez (modo equipe), um evento só mesmo com duas respostas, sem "em espera".
  await ingest('5511999990041','cel-1');
  await ingest('5511999990041','cel-2');
  assert.deepEqual(await eventos(cv),[{kind:'mode',to_label:'Equipe',subject_label:'respondeu_whatsapp',actor_label:'a equipe'}]);
  const [estado]=await b.sqlSuperusuario<{mode:string;pausa:string|null}>(`select mode,pausa_ia_ate as pausa from public.lotti_agent_conversations where id=$1`,[cv]);
  assert.deepEqual(estado,{mode:'human',pausa:null});

  // Conversa que a equipe começou pelo celular: a IA também fica desligada.
  await ingest('5511999990042','cel-3');
  const [comecada]=await b.sqlSuperusuario<{mode:string}>(`select mode from public.lotti_agent_conversations where id=$1`,[semCliente]);
  assert.equal(comecada.mode,'human');

  // Mídia mandada pelo celular desliga de vez: o evento diz que foi a equipe pelo WhatsApp, não "Sistema".
  await ingest('5511999990043','cel-4',{unsupported:true,text:'📷 Foto'});
  assert.deepEqual(await eventos(midia),[{kind:'mode',to_label:'Equipe',subject_label:'respondeu_whatsapp',actor_label:'a equipe'}]);

  // Inbox: quem enviou aparece pelo nome, com o motivo; o nome não vaza para a troca seguinte.
  const [dono]=await b.sqlSuperusuario<{nome:string}>(`select nome from public.corretores where id=$1`,[b.corretorA]);
  await b.sqlSuperusuario(`select public.lotti_manual_begin($1::uuid,$2::uuid,$3::uuid,'fp','olá',null)`,[b.corretorA,inbox,randomUUID()]);
  assert.deepEqual(await eventos(inbox),[{kind:'mode',to_label:'Equipe',subject_label:'assumiu_inbox',actor_label:dono.nome}]);
  await b.sqlSuperusuario(`update public.lotti_manual_sends set status='sent' where conversation_id=$1`,[inbox]);
  await new WhatsappService(b.db).modo(b.claimsA,inbox,'ai');
  const depois=await eventos(inbox);
  assert.deepEqual(depois.at(-1),{kind:'mode',to_label:'IA',subject_label:null,actor_label:dono.nome});

  // Nome e motivo não vazam para outra troca de modo na MESMA transação (o begin zera os dois).
  await b.sqlSuperusuario(`do $$ begin
    perform public.lotti_manual_begin('${b.corretorA}'::uuid,'${inbox}'::uuid,'${randomUUID()}'::uuid,'fp2','de novo',null);
    update public.lotti_agent_conversations set mode='paused' where id='${inbox}'::uuid;
  end $$`);
  const mesmaTransacao=(await eventos(inbox)).slice(-2).sort((x,y)=>x.to_label.localeCompare(y.to_label)); // mesmo created_at: a ordem entre os dois não importa
  assert.deepEqual(mesmaTransacao,[
   {kind:'mode',to_label:'Equipe',subject_label:'assumiu_inbox',actor_label:dono.nome},
   {kind:'mode',to_label:'Pausada',subject_label:null,actor_label:'Sistema'},
  ]);

  // Conversa fechada: o desligamento também aparece (se o cliente reabrir, a linha do tempo explica o silêncio).
  const fechada=randomUUID();
  await b.inserir('lotti_agent_conversations',{id:fechada,channel_id:canal,corretor_id:b.corretorA,phone:'5511999990045',mode:'ai'});
  await b.inserir('lotti_agent_messages',{conversation_id:fechada,external_id:'in-fechada',direction:'in',sender:'lead',content:'oi'});
  await b.sqlSuperusuario(`update public.lotti_agent_conversations set status='closed',closed_by='cliente' where id=$1`,[fechada]);
  await ingest('5511999990045','cel-5');
  assert.deepEqual((await eventos(fechada)).filter(e=>e.kind!=='status'),[{kind:'mode',to_label:'Equipe',subject_label:'respondeu_whatsapp',actor_label:'a equipe'}]);
 }finally{await b.fechar();}
});

test('última mensagem de cada conversa (prévia do Inbox): só a mais recente e só das conversas da conta',async()=>{
 const b=await criarBanco();
 try{
  const canalA=randomUUID(),canalB=randomUUID(),cvA=randomUUID(),cvB=randomUUID();
  await b.inserir('lotti_agent_channels',{id:canalA,corretor_id:b.corretorA,instance:'teste-previa-a',enabled:true,sandbox:true});
  await b.inserir('lotti_agent_channels',{id:canalB,corretor_id:b.corretorB,instance:'teste-previa-b',enabled:true,sandbox:true});
  await b.inserir('lotti_agent_conversations',{id:cvA,channel_id:canalA,corretor_id:b.corretorA,phone:'5511999990051',mode:'ai'});
  await b.inserir('lotti_agent_conversations',{id:cvB,channel_id:canalB,corretor_id:b.corretorB,phone:'5511999990052',mode:'ai'});
  await b.inserir('lotti_agent_messages',{conversation_id:cvA,external_id:'p-1',direction:'in',sender:'lead',content:'primeira',created_at:'2026-10-09T10:00:00Z'});
  await b.inserir('lotti_agent_messages',{conversation_id:cvA,external_id:'p-2',direction:'out',sender:'human',content:'última',created_at:'2026-10-09T11:00:00Z'});
  await b.inserir('lotti_agent_messages',{conversation_id:cvB,external_id:'p-3',direction:'in',sender:'lead',content:'de outra conta',created_at:'2026-10-09T12:00:00Z'});
  const linhas=await new WhatsappService(b.db).ultimasMensagens(b.claimsA) as Array<{conversation_id:string;direction:string;content:string}>;
  assert.deepEqual(linhas.map(l=>[l.conversation_id,l.direction,l.content]),[[cvA,'out','última']]);
 }finally{await b.fechar();}
});

test('responder citando: o envio guarda a citação (mesmo com o eco antes), recusa citação inválida e a citação do cliente aparece',async()=>{
 const b=await criarBanco();
 try{
  const canal=randomUUID(),cv=randomUUID(),outra=randomUUID();
  await b.inserir('lotti_agent_channels',{id:canal,corretor_id:b.corretorA,instance:'teste-cita',enabled:true,sandbox:false});
  await b.inserir('lotti_agent_conversations',{id:cv,channel_id:canal,corretor_id:b.corretorA,phone:'5511999990061',mode:'human'});
  await b.inserir('lotti_agent_conversations',{id:outra,channel_id:canal,corretor_id:b.corretorA,phone:'5511999990062',mode:'human'});
  const citada=randomUUID(),deOutra=randomUUID(),ligacao=randomUUID();
  await b.inserir('lotti_agent_messages',{id:citada,conversation_id:cv,external_id:'WA-1',direction:'in',sender:'lead',content:'Tem com 3 quartos?'});
  await b.inserir('lotti_agent_messages',{id:deOutra,conversation_id:outra,external_id:'WA-9',direction:'in',sender:'lead',content:'oi'});
  await b.inserir('lotti_agent_messages',{id:ligacao,conversation_id:cv,external_id:'call-1',direction:'in',sender:'lead',content:'Ligação'});
  const begin=(req:string,quote:string|null)=>b.sqlSuperusuario<{r:Record<string,unknown>}>(`select public.lotti_manual_begin(p_owner=>$1::uuid,p_conversation=>$2::uuid,p_request=>$3::uuid,p_fingerprint=>'fp',p_content=>'Tem sim!',p_media=>null,p_quote=>$4::uuid) as r`,[b.corretorA,cv,req,quote]);
  // Chamada de hoje do runtime (6 argumentos nomeados) continua funcionando.
  const sem=randomUUID();
  await b.sqlSuperusuario(`select public.lotti_manual_begin(p_owner=>$1::uuid,p_conversation=>$2::uuid,p_request=>$3::uuid,p_fingerprint=>'fp0',p_content=>'x',p_media=>null)`,[b.corretorA,cv,sem]);
  await b.sqlSuperusuario(`select public.lotti_manual_finish($1::uuid,'sent','WA-0')`,[sem]);

  await assert.rejects(begin(randomUUID(),deOutra),/invalid_quote/);
  await assert.rejects(begin(randomUUID(),ligacao),/invalid_quote/);
  const req=randomUUID();
  const [{r}]=await begin(req,citada);
  assert.deepEqual(r.quote,{external_id:'WA-1',from_me:false,content:'Tem com 3 quartos?'});
  // Reenvio do mesmo pedido com outra citação é conflito, não reaproveita a citação antiga.
  await assert.rejects(begin(req,null),/request_conflict/);
  // O eco do WhatsApp chega antes do finish (sem citação); o finish completa sem apagar nada.
  await b.inserir('lotti_agent_messages',{conversation_id:cv,external_id:'WA-2',direction:'out',sender:'human',content:'Tem sim!'});
  await b.sqlSuperusuario(`select public.lotti_manual_finish($1::uuid,'sent','WA-2')`,[req]);
  const [enviada]=await b.sqlSuperusuario<Record<string,unknown>>(`select quoted_external_id,quoted_content,quoted_from_me from public.lotti_agent_messages where conversation_id=$1 and external_id='WA-2'`,[cv]);
  assert.deepEqual(enviada,{quoted_external_id:'WA-1',quoted_content:'Tem com 3 quartos?',quoted_from_me:false});

  // Cliente cita a nossa resposta: o texto vem da própria conversa.
  await b.inserir('lotti_agent_messages',{conversation_id:cv,external_id:'WA-3',direction:'in',sender:'lead',content:'Quanto custa?'});
  const [{ok}]=await b.sqlSuperusuario<{ok:boolean}>(`select public.lotti_agent_set_quote('teste-cita','WA-3','WA-2','texto do celular',true) as ok`);
  assert.equal(ok,true);
  const msgs=await new WhatsappService(b.db).mensagens(b.claimsA,cv) as Array<Record<string,unknown>>;
  const resposta=msgs.find(m=>m.external_id==='WA-3');
  assert.equal(resposta?.quoted_content,'Tem sim!');
  assert.equal(resposta?.quoted_from_me,true);
 }finally{await b.fechar();}
});

test('conversa nova (mensagem de número desconhecido) chega com a IA desligada',async()=>{
 const b=await criarBanco();
 try{
  await b.inserir('lotti_agent_channels',{id:randomUUID(),corretor_id:b.corretorA,instance:'teste-nova',enabled:true,sandbox:true});
  await b.sqlSuperusuario(`select public.lotti_agent_ingest($1::jsonb)`,[JSON.stringify({instance:'teste-nova',external_id:'N-1',phone:'5511999990071',from_me:false,text:'Oi, vi o anúncio'})]);
  const [cv]=await b.sqlSuperusuario<{mode:string}>(`select mode from public.lotti_agent_conversations where phone='5511999990071'`);
  assert.equal(cv.mode,'human');
 }finally{await b.fechar();}
});

test('IA avança o lead no funil pela posição da etapa: nunca volta, nunca mexe em Proposta/fechado',async()=>{
 const b=await criarBanco();
 try{
  const etapas=await b.sqlSuperusuario<{id:string;nome:string}>(`select id,nome from public.crm_etapas where corretor_id=$1 and ativo and tipo='ABERTA' order by ordem,id`,[b.corretorA]);
  assert.ok(etapas.length>=6,'conta com as etapas padrão');
  const canal=randomUUID(),cv=randomUUID(),token=randomUUID();
  const cliente=(await b.inserir('clientes',{corretor_id:b.corretorA,nome:'Lead Funil',telefone:'62981230001'})).id as string;
  await b.inserir('lotti_agent_channels',{id:canal,corretor_id:b.corretorA,instance:'teste-funil',enabled:true,sandbox:false});
  await b.inserir('lotti_agent_conversations',{id:cv,channel_id:canal,corretor_id:b.corretorA,phone:'5562981230001',mode:'ai',cliente_id:cliente});
  const responder=async(stage:string,extra:Record<string,unknown>={})=>{
   await b.sqlSuperusuario(`update public.lotti_agent_conversations set lease_token=$2,lease_until=now()+interval '1 minute' where id=$1`,[cv,token]);
   const [{revision}]=await b.sqlSuperusuario<{revision:string}>(`select revision from public.lotti_agent_conversations where id=$1`,[cv]);
   await b.sqlSuperusuario(`select public.lotti_agent_prepare($1,$2,$3,$4::jsonb)`,[cv,token,revision,JSON.stringify({response:'ok',stage,humanRequested:false,...extra})]);
  };
  const etapa=async()=>(await b.sqlSuperusuario<{nome:string}>(`select e.nome from public.crm_oportunidades o join public.crm_etapas e on e.id=o.etapa_id where o.cliente_id=$1 and o.fechada_em is null`,[cliente]))[0]?.nome;
  await responder('pre_qualificacao');
  assert.equal(await etapa(),etapas[1].nome,'começou a atender: 2ª etapa');
  await responder('qualificando');
  assert.equal(await etapa(),etapas[2].nome);
  await responder('pre_qualificacao');
  assert.equal(await etapa(),etapas[2].nome,'nunca volta');
  await responder('qualificado_visita');
  assert.equal(await etapa(),etapas[3].nome,'quer visitar sem dia e hora: Qualificado, não Visita agendada');
  await responder('qualificando',{visitRequest:{date:'2026-10-20',time:'10:00'}});
  assert.equal(await etapa(),etapas[4].nome,'pediu visita: 5ª etapa');
  // A equipe levou para a 6ª (Proposta): a IA não mexe mais.
  await b.sqlSuperusuario(`update public.crm_oportunidades set etapa_id=$2 where cliente_id=$1`,[cliente,etapas[5].id]);
  await responder('qualificado_visita');
  assert.equal(await etapa(),etapas[5].nome);
 }finally{await b.fechar();}
});
