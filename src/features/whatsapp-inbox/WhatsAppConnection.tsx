import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { QrCode, CheckCircle2 } from 'lucide-react';
import { useWhatsAppConnectionQuery, type WhatsAppConnectionState } from './useWhatsAppConnection';
import {MENSAGEM_DA_PONTE} from './bridgeError';
type WhatsAppConnectionProps={autoStart?:boolean;previewPairing?:boolean};
const previewQr=`data:image/svg+xml,${encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 21 21"><rect width="21" height="21" fill="white"/><path fill="#111827" d="M1 1h7v7H1zm2 2v3h3V3zm10-2h7v7h-7zm2 2v3h3V3zM1 13h7v7H1zm2 2v3h3v-3zm7-14h2v2h-2zm0 4h2v4h-2zm0 6h3v2h-3zm5-1h2v3h-2zm3 1h2v2h-2zm-8 4h2v5h-2zm4 0h2v2h-2zm4 0h2v5h-4v-2h2z"/></svg>')}`;
export function WhatsAppConnection({autoStart=false,previewPairing=false}:WhatsAppConnectionProps={}){
 const {user}=useAuth();const [pairing,setPairing]=useState(previewPairing);
 const cache=useQueryClient();
 const [visibleQr,setVisibleQr]=useState<{src:string;expiresAt:number}|null>(null);
 const [expired,setExpired]=useState(false);
 const [starting,setStarting]=useState(false);const [startError,setStartError]=useState(false);
 const attempt=useRef(0);const [now,setNow]=useState(Date.now());
 const autoStarted=useRef(false);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[]);
 useEffect(()=>()=>{attempt.current++},[user?.id]);
 const connection=useWhatsAppConnectionQuery(user?.id);
 useEffect(()=>{setVisibleQr(null)},[user?.id]);
 useEffect(()=>{
   const src=connection.data?.qr;const expiresAt=Number(connection.data?.qrExpiresAt);
   if(src&&expiresAt>Date.now())setVisibleQr(current=>current?.src===src&&current.expiresAt===expiresAt?current:{src,expiresAt});
 },[connection.data?.qr,connection.data?.qrExpiresAt]);
 const connected=connection.data?.state==='connected';
 const begin=useCallback(async()=>{if(starting)return;const id=++attempt.current;setStarting(true);setExpired(false);setStartError(false);try{const {data,error}=await supabase.functions.invoke<WhatsAppConnectionState>('lotti-whatsapp',{body:{action:'connect'}});if(id!==attempt.current)return;if(error||!data)throw error??new Error('connection_unavailable');cache.setQueryData(['whatsapp-connection',user?.id],data);setPairing(data.state!=='connected');}catch{if(id===attempt.current)setStartError(true);}finally{if(id===attempt.current)setStarting(false);}},[cache,starting,user?.id]);
 // Only a confirmed disconnected session starts pairing. While WhatsApp is reconnecting
 // a new connect would make the bridge log the paired number out.
 // A QR already waiting to be scanned (page reopened mid-pairing) is shown again once,
 // without asking for a new connection; Cancel keeps it closed.
 const pendingQr=connection.data?.state==='connecting'&&!!connection.data?.qr&&Number(connection.data?.qrExpiresAt)>now;
 const resumed=useRef(false);
 useEffect(()=>{if(pendingQr&&!pairing&&!previewPairing&&!resumed.current){resumed.current=true;setPairing(true);}},[pendingQr,pairing,previewPairing]);
 const reconnecting=connection.data?.state==='connecting'&&!pairing&&!pendingQr;
 useEffect(()=>{if(!autoStart||previewPairing||connection.isPending||connection.data?.state!=='disconnected'||autoStarted.current)return;autoStarted.current=true;void begin();},[autoStart,previewPairing,connection.isPending,connection.data?.state,begin]);
 useEffect(()=>{
   if(!pairing||previewPairing)return;
   if(connected){setPairing(false);return;}
   const timer=setTimeout(()=>{setPairing(false);setExpired(true);},120000);
   return()=>clearTimeout(timer);
 },[pairing,connected,previewPairing]);
 return <section aria-label="Conexão com WhatsApp" className="rounded-xl border bg-card p-5">
   <div className="flex flex-wrap items-center gap-3">{connected?<CheckCircle2 className="h-6 w-6 text-emerald-600"/>:<QrCode className="h-6 w-6 text-primary"/>}
     <div className="mr-auto"><h2 className="font-semibold">{connected?'WhatsApp conectado':'Conecte ao WhatsApp'}</h2>
     <p className="mt-1 text-sm text-muted-foreground">{connected?(connection.data?.agentEnabled?'O agente está liberado para atender conforme o seu plano.':'Seu número está conectado. O atendimento automático aguarda liberação.'):reconnecting?'O WhatsApp está reconectando. Não é preciso escanear o QR de novo.':'Conecte o número de atendimento para receber as conversas nesta conta.'}</p></div>
     {/* Com autoStart a tela não oferecia botão nenhum: se o connect falhasse,
         sumia o único caminho de conectar. Enquanto não houver pareamento em
         curso, sempre sobra como pedir o QR de novo. */}
     {!connected&&!pairing&&!starting&&<Button disabled={connection.isPending} onClick={begin}>{autoStart?'Gerar QR Code':'Conectar WhatsApp'}</Button>}
   </div>
   {/* São dois erros diferentes: falhar ao consultar o estado e falhar ao pedir
       o QR. Tentar de novo precisa refazer o que falhou — repetir o status
       depois de um connect recusado não muda nada e parece defeito. */}
   {startError&&<p role="alert" className="mt-3 text-sm text-destructive">Não foi possível gerar o QR Code agora. <button className="underline" disabled={starting} onClick={()=>void begin()}>Tentar de novo</button></p>}
   {connection.isError&&!startError&&<p role="alert" className="mt-3 text-sm text-destructive">{MENSAGEM_DA_PONTE[(connection.error as {codigo?:string}|null)?.codigo??'']??'Não foi possível consultar a conexão agora.'} <button className="underline" onClick={()=>connection.refetch()}>Tentar novamente</button></p>}
   {expired&&!connected&&<p role="alert" className="mt-3 text-sm text-destructive">O WhatsApp não confirmou a conexão em dois minutos. A tentativa nesta tela foi encerrada. Clique em Conectar WhatsApp para iniciar outra tentativa.</p>}
   {pairing&&!connected&&<div className="mt-5 grid gap-4 sm:grid-cols-[280px_1fr]">
     <div className="grid min-h-56 place-items-center rounded-xl bg-white p-4">{previewPairing?<img className="w-64 max-w-full" src={previewQr} alt="QR Code de demonstração para conectar seu WhatsApp"/>:visibleQr&&visibleQr.expiresAt>now?<img className="w-64 max-w-full" src={visibleQr.src} alt="QR Code atualizado para conectar seu WhatsApp"/>:<p role="status" className="text-center text-sm text-slate-600">{connection.isError?'Código indisponível no momento.':'Preparando QR Code…'}</p>}</div>
     <div className="self-center space-y-3 text-sm"><p>No celular, abra <strong>WhatsApp → Configurações → Aparelhos conectados → Conectar aparelho</strong>.</p><p className="text-muted-foreground">Escaneie uma vez e aguarde a confirmação no celular. O código se renova enquanto aguarda; isso não significa que você precisa escanear novamente. Esta tentativa dura até dois minutos.</p>{!previewPairing&&<Button variant="outline" onClick={()=>{attempt.current++;setPairing(false);setStarting(false);setVisibleQr(null)}}>Cancelar</Button>}</div>
   </div>}
 </section>;
}
