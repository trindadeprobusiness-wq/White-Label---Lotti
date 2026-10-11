import { useCallback, useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { QrCode, CheckCircle2 } from 'lucide-react';
import { useWhatsAppConnectionQuery, type WhatsAppConnectionState } from './useWhatsAppConnection';
import { apiDisponivel } from '@/lib/api';
import { whatsappBridgeApi } from '@/lib/api/whatsapp';
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
 const renovacoes=useRef(0);
 // Muda a cada renovação: reinicia o prazo de 2 min mesmo quando o QR novo chega no mesmo instante.
 const [rodada,setRodada]=useState(0);
 useEffect(()=>{const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer)},[]);
 useEffect(()=>()=>{attempt.current++},[user?.id]);
 const connection=useWhatsAppConnectionQuery(user?.id);
 useEffect(()=>{setVisibleQr(null)},[user?.id]);
 useEffect(()=>{
   const src=connection.data?.qr;const expiresAt=Number(connection.data?.qrExpiresAt);
   if(src&&expiresAt>Date.now())setVisibleQr(current=>current?.src===src&&current.expiresAt===expiresAt?current:{src,expiresAt});
 },[connection.data?.qr,connection.data?.qrExpiresAt]);
 const connected=connection.data?.state==='connected';
 const begin=useCallback(async()=>{if(starting)return;const id=++attempt.current;setStarting(true);setExpired(false);setStartError(false);try{let data:WhatsAppConnectionState|undefined;if(apiDisponivel())data=await whatsappBridgeApi<WhatsAppConnectionState>({action:'connect'});else{const result=await supabase.functions.invoke<WhatsAppConnectionState>('lotti-whatsapp',{body:{action:'connect'}});if(result.error)throw result.error;data=result.data??undefined;}if(id!==attempt.current)return;if(!data)throw new Error('connection_unavailable');cache.setQueryData(['whatsapp-connection',user?.id],data);setPairing(data.state!=='connected');}catch{if(id===attempt.current)setStartError(true);}finally{if(id===attempt.current)setStarting(false);}},[cache,starting,user?.id]);
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
   // Venceu os 2 minutos com a tela aberta e visível: gera outro QR sozinho (até 10 minutos no
   // total), sem a pessoa precisar clicar. Aba escondida ou limite batido: para e mostra o aviso.
   const timer=setTimeout(()=>{
     setPairing(false);
     const visivel=typeof document==='undefined'||document.visibilityState==='visible';
     if(visivel&&renovacoes.current<4){renovacoes.current++;setRodada(r=>r+1);void begin();}
     else setExpired(true);
   },120000);
   return()=>clearTimeout(timer);
 },[pairing,connected,previewPairing,begin,rodada]);
 useEffect(()=>{if(connected)renovacoes.current=0;},[connected]);
 const cancelar=()=>{attempt.current++;renovacoes.current=0;setPairing(false);setStarting(false);setVisibleQr(null)};
 const restante=visibleQr?Math.max(0,Math.ceil((visibleQr.expiresAt-now)/1000)):0;
 const passos=['Abra o WhatsApp no celular.','Toque em Configurações (ou nos três pontinhos). Entre em Aparelhos conectados.','Toque em Conectar aparelho.','Aponte a câmera para este código.'];
 // Visual no estilo do WhatsApp Web: passos de um lado, o código grande do outro. O fluxo (gerar,
 // retomar o QR pendente, expirar em 2 min, cancelar) é o mesmo de antes.
 return <section aria-label="Conexão com WhatsApp" className="overflow-hidden rounded-2xl border bg-card shadow-sm">
   <div className="flex flex-wrap items-center gap-3 border-b bg-[#f7faf8] px-6 py-4">
     <span className={`flex h-10 w-10 items-center justify-center rounded-full ${connected?'bg-emerald-100 text-emerald-700':'bg-primary/10 text-primary'}`}>{connected?<CheckCircle2 className="h-5 w-5"/>:<QrCode className="h-5 w-5"/>}</span>
     <div className="mr-auto min-w-0"><h2 className="text-base font-semibold">{connected?'WhatsApp conectado':'Conecte seu WhatsApp'}</h2>
     <p className="mt-0.5 text-sm text-muted-foreground">{connected?(connection.data?.agentEnabled?'O agente está liberado para atender conforme o seu plano.':'Seu número está conectado. O atendimento automático aguarda liberação.'):reconnecting?'O WhatsApp está reconectando. Não é preciso escanear o QR de novo.':'Conecte o número de atendimento para receber as conversas nesta conta.'}</p></div>
     {/* Com autoStart a tela não oferecia botão nenhum: se o connect falhasse,
         sumia o único caminho de conectar. Enquanto não houver pareamento em
         curso, sempre sobra como pedir o QR de novo. */}
     {!connected&&!pairing&&!starting&&<Button disabled={connection.isPending} onClick={()=>{renovacoes.current=0;void begin();}}>{autoStart?'Gerar QR Code':'Conectar WhatsApp'}</Button>}
   </div>
   {/* São dois erros diferentes: falhar ao consultar o estado e falhar ao pedir
       o QR. Tentar de novo precisa refazer o que falhou — repetir o status
       depois de um connect recusado não muda nada e parece defeito. */}
   {(startError||connection.isError||(expired&&!connected))&&<div className="space-y-2 px-6 pt-4">
     {startError&&<p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">Não foi possível gerar o QR Code agora. <button className="font-medium underline" disabled={starting} onClick={()=>void begin()}>Tentar de novo</button></p>}
     {connection.isError&&!startError&&<p role="alert" className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">{MENSAGEM_DA_PONTE[(connection.error as {codigo?:string}|null)?.codigo??'']??'Não foi possível consultar a conexão agora.'} <button className="font-medium underline" onClick={()=>connection.refetch()}>Tentar novamente</button></p>}
     {expired&&!connected&&<p role="alert" className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">O WhatsApp não confirmou a conexão em dois minutos. A tentativa nesta tela foi encerrada. Clique em Gerar QR Code para iniciar outra tentativa.</p>}
   </div>}
   {(pairing||starting)&&!connected&&<div className="grid gap-8 p-6 md:grid-cols-[1fr_auto] md:items-center">
     <div className="space-y-5">
       <ol className="space-y-4">{passos.map((passo,n)=><li key={n} className="flex items-start gap-3 text-[15px] leading-snug"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">{n+1}</span><span className="pt-0.5">{passo}</span></li>)}</ol>
       <p className="text-sm text-muted-foreground">Escaneie uma vez e aguarde a confirmação no celular. O código se renova sozinho enquanto aguarda; não precisa escanear de novo.</p>
       {!previewPairing&&<Button variant="outline" onClick={cancelar}>Cancelar</Button>}
     </div>
     <div className="mx-auto flex flex-col items-center gap-3">
       <div className="relative grid h-[280px] w-[280px] place-items-center rounded-2xl border-2 border-[#e2e8e4] bg-white p-3 shadow-sm">
         {previewPairing?<img className="h-full w-full" src={previewQr} alt="QR Code de demonstração para conectar seu WhatsApp"/>
          :visibleQr&&visibleQr.expiresAt>now?<img className="h-full w-full" src={visibleQr.src} alt="QR Code atualizado para conectar seu WhatsApp"/>
          :<div role="status" className="flex flex-col items-center gap-3 text-center text-sm text-slate-600"><span aria-hidden className="h-10 w-10 animate-spin rounded-full border-4 border-primary/20 border-t-primary"/>{connection.isError?'Código indisponível no momento.':'Preparando QR Code…'}</div>}
       </div>
       {!previewPairing&&visibleQr&&visibleQr.expiresAt>now&&<p className="text-xs tabular-nums text-muted-foreground">Este código se renova em {restante}s</p>}
     </div>
   </div>}
 </section>;
}
