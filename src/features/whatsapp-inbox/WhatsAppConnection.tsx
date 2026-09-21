import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { QrCode, CheckCircle2 } from 'lucide-react';
import { useWhatsAppConnectionQuery, type WhatsAppConnectionState } from './useWhatsAppConnection';
export function WhatsAppConnection(){
 const {user}=useAuth();const [pairing,setPairing]=useState(false);
 const cache=useQueryClient();
 const [expired,setExpired]=useState(false);
 const [starting,setStarting]=useState(false);const [startError,setStartError]=useState(false);
 const attempt=useRef(0);const [now,setNow]=useState(Date.now());
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[]);
 useEffect(()=>()=>{attempt.current++},[user?.id]);
 const connection=useWhatsAppConnectionQuery(user?.id);
 const connected=connection.data?.state==='connected';
 const begin=async()=>{if(starting)return;const id=++attempt.current;setStarting(true);setExpired(false);setStartError(false);try{const {data,error}=await supabase.functions.invoke<WhatsAppConnectionState>('lotti-whatsapp',{body:{action:'connect'}});if(id!==attempt.current)return;if(error||!data)throw error??new Error('connection_unavailable');cache.setQueryData(['whatsapp-connection',user?.id],data);setPairing(data.state!=='connected');}catch{if(id===attempt.current)setStartError(true);}finally{if(id===attempt.current)setStarting(false);}};
 useEffect(()=>{
   if(!pairing)return;
   if(connected){setPairing(false);return;}
   const timer=setTimeout(()=>{setPairing(false);setExpired(true);},120000);
   return()=>clearTimeout(timer);
 },[pairing,connected]);
 return <section aria-label="Conexão com WhatsApp" className="rounded-xl border bg-card p-5">
   <div className="flex flex-wrap items-center gap-3">{connected?<CheckCircle2 className="h-6 w-6 text-emerald-600"/>:<QrCode className="h-6 w-6 text-primary"/>}
     <div className="mr-auto"><h2 className="font-semibold">{connected?'WhatsApp conectado':'Conecte ao WhatsApp'}</h2>
     <p className="mt-1 text-sm text-muted-foreground">{connected?(connection.data?.agentEnabled?'O agente está liberado para atender conforme o seu plano.':'Seu número está conectado. O atendimento automático aguarda liberação.'): 'Conecte o número de atendimento para receber as conversas nesta conta.'}</p></div>
     {!connected&&!pairing&&<Button disabled={connection.isPending||starting} onClick={begin}>Conectar WhatsApp</Button>}
   </div>
   {(connection.isError||startError)&&<p role="alert" className="mt-3 text-sm text-destructive">Não foi possível consultar a conexão agora. <button className="underline" onClick={()=>connection.refetch()}>Tentar novamente</button></p>}
   {expired&&!connected&&<p role="alert" className="mt-3 text-sm text-destructive">O WhatsApp não confirmou a conexão em dois minutos. A tentativa nesta tela foi encerrada. Clique em Conectar WhatsApp para iniciar outra tentativa.</p>}
   {pairing&&!connected&&<div className="mt-5 grid gap-4 sm:grid-cols-[280px_1fr]">
     <div className="grid min-h-56 place-items-center rounded-xl bg-white p-4">{connection.data?.qr&&Number(connection.data.qrExpiresAt)>now&&!connection.isError?<img className="w-64 max-w-full" src={connection.data.qr} alt="QR Code atualizado para conectar seu WhatsApp"/>:<p role="status" className="text-center text-sm text-slate-600">{connection.isError?'Código indisponível no momento.':'Preparando QR Code…'}</p>}</div>
     <div className="self-center space-y-3 text-sm"><p>No celular, abra <strong>WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho</strong>.</p><p className="text-muted-foreground">Escaneie uma vez e aguarde a confirmação no celular. O código se renova enquanto aguarda; isso não significa que você precisa escanear novamente. Esta tentativa dura até dois minutos.</p><Button variant="outline" onClick={()=>{attempt.current++;setPairing(false);setStarting(false)}}>Cancelar</Button></div>
   </div>}
 </section>;
}
