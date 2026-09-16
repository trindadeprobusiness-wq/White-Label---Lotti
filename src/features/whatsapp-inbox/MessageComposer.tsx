import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {Button} from '@/components/ui/button';
import {Mic,Send,Square,Trash2} from 'lucide-react';
type Props={conversationId:string;onSent:()=>void};
export function MessageComposer({conversationId,onSent}:Props){
 const [text,setText]=useState(''),[audio,setAudio]=useState<Blob>(),[preview,setPreview]=useState('');
 const [recording,setRecording]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const recorder=useRef<MediaRecorder>(),stream=useRef<MediaStream>(),timer=useRef<ReturnType<typeof setTimeout>>(),alive=useRef(true);
 const pending=useRef<Record<string,unknown>>();
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;clearTimeout(timer.current);if(recorder.current?.state==='recording')recorder.current.stop();stream.current?.getTracks().forEach(t=>t.stop());}},[]);
 useEffect(()=>{if(!audio){setPreview('');return;}const url=URL.createObjectURL(audio);setPreview(url);return()=>URL.revokeObjectURL(url)},[audio]);
 const stop=()=>{clearTimeout(timer.current);if(recorder.current?.state==='recording')recorder.current.stop();stream.current?.getTracks().forEach(t=>t.stop());};
 async function record(){
  setNotice('');try{
   if(!navigator.mediaDevices?.getUserMedia||typeof MediaRecorder==='undefined')throw Error('unsupported');
   const input=await navigator.mediaDevices.getUserMedia({audio:true});if(!alive.current){input.getTracks().forEach(t=>t.stop());return;}
   stream.current=input;const mime=['audio/webm;codecs=opus','audio/ogg;codecs=opus','audio/mp4'].find(m=>MediaRecorder.isTypeSupported(m));
   if(!mime){input.getTracks().forEach(t=>t.stop());throw Error('unsupported');}
   const r=new MediaRecorder(input,{mimeType:mime,audioBitsPerSecond:64000});recorder.current=r;const chunks:BlobPart[]=[];
   r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
   r.onstop=()=>{input.getTracks().forEach(t=>t.stop());if(alive.current){setRecording(false);setAudio(new Blob(chunks,{type:mime.split(';')[0]}));}};
   r.onerror=()=>{stop();if(alive.current)setNotice('Não foi possível gravar. Verifique o microfone.');};
   r.start();setRecording(true);timer.current=setTimeout(stop,90000);
  }catch{stream.current?.getTracks().forEach(t=>t.stop());if(alive.current)setNotice('Permita o microfone para gravar ou anexe um arquivo de áudio.');}
 }
 async function send(){
  if(busy)return;setBusy(true);setNotice('');
  try{
   if(!pending.current){
    if(!audio&&!text.trim())return;
    if(audio&&audio.size>4194304){setNotice('O áudio deve ter até 4 MB.');return;}
    let encoded:string|undefined;
    if(audio)encoded=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(audio)});
    pending.current={action:'send',conversation_id:conversationId,request_id:crypto.randomUUID(),kind:audio?'audio':'text',...(audio?{audio:encoded,mime:audio.type.split(';')[0]}:{text:text.trim()})};
   }
   const {data,error}=await supabase.functions.invoke('lotti-whatsapp',{body:pending.current});
   if(!alive.current)return;
   if(error||!data)throw Error('unknown');
   if(data.sendStatus==='sent'){pending.current=undefined;setText('');setAudio(undefined);setNotice('Enviado. Você assumiu esta conversa.');onSent();}
   else if(['failed','busy'].includes(data.sendStatus)){pending.current=undefined;setNotice(data.sendStatus==='busy'?'Há uma entrega em andamento. Aguarde antes de enviar.':'Não foi enviado. Verifique a conexão e tente novamente.');}
   else setNotice('Envio sem confirmação. Confira no WhatsApp antes de tentar uma nova mensagem.');
  }catch{if(alive.current)setNotice('A confirmação demorou. Use Verificar envio para consultar sem duplicar a mensagem.');}
  finally{if(alive.current)setBusy(false);}
 }
 const locked=busy||!!pending.current;
 return <footer className="space-y-3 border-t bg-card p-3">
  {notice&&<p role="status" className="text-xs text-muted-foreground">{notice}</p>}
  {preview&&<div className="flex items-center gap-2"><audio controls src={preview} className="h-10 min-w-0 flex-1"/><Button aria-label="Descartar áudio" variant="ghost" disabled={locked} onClick={()=>setAudio(undefined)}><Trash2 className="h-4 w-4"/></Button></div>}
  {!audio&&<textarea aria-label="Mensagem" placeholder="Escreva uma mensagem…" value={text} maxLength={8000} disabled={locked||recording} onChange={e=>setText(e.target.value)} className="min-h-20 w-full resize-y rounded-lg border bg-background p-3 text-sm"/>}
  <div className="flex flex-wrap items-center gap-2">
   <Button variant="outline" disabled={locked||!!audio} onClick={recording?stop:record}>{recording?<Square className="mr-2 h-4 w-4"/>:<Mic className="mr-2 h-4 w-4"/>}{recording?'Parar gravação':'Gravar áudio'}</Button>
   <label className="text-xs underline">Anexar áudio<input aria-label="Anexar áudio" className="block max-w-44 text-xs" type="file" accept="audio/webm,audio/ogg,audio/mp4,audio/mpeg" disabled={locked||recording} onChange={e=>{const f=e.target.files?.[0];if(f&&f.size<=4194304){setAudio(f);setNotice('')}else setNotice('Selecione um áudio de até 4 MB.');e.target.value='';}}/></label>
   <Button className="ml-auto" disabled={busy||recording||(!text.trim()&&!audio&&!pending.current)} onClick={send}><Send className="mr-2 h-4 w-4"/>{busy?'Enviando…':pending.current?'Verificar envio':'Enviar'}</Button>
  </div><p className="text-[11px] text-muted-foreground">Ao enviar, você assume o atendimento e pausa a IA nesta conversa. Gravações de até 90 segundos.</p>
 </footer>;
}
export function AudioMessage({path}:{path:string}){
 const [url,setUrl]=useState('');const [failed,setFailed]=useState(false);
 useEffect(()=>{let live=true;async function refresh(){const {data,error}=await supabase.storage.from('lotti-inbox-audio').createSignedUrl(path,3600);if(live){setUrl(data?.signedUrl||'');setFailed(!!error);}}void refresh();const timer=setInterval(refresh,3000000);return()=>{live=false;clearInterval(timer)}},[path]);
 return url?<audio controls preload="metadata" src={url} className="max-w-full"/>:<span className="text-xs">{failed?'Áudio indisponível no momento.':'Carregando áudio…'}</span>;
}
