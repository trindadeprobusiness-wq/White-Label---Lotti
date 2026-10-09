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
