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

