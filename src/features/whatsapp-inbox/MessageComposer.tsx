import {useEffect,useRef,useState} from 'react';
import {supabase} from '@/integrations/supabase/client';
import {Button} from '@/components/ui/button';
import {Mic,Paperclip,Send,Square,Trash2} from 'lucide-react';
import {safeAttachmentName,validateAttachment} from './attachments';
type PreviewSend={kind:'text'|'file'|'audio';content:string};
type Props={conversationId:string;onSent:()=>void;preview?:boolean;onPreviewSend?:(message:PreviewSend)=>void};
export function MessageComposer({conversationId,onSent,preview:previewMode=false,onPreviewSend}:Props){
 const [text,setText]=useState(''),[audio,setAudio]=useState<Blob>(),[attachment,setAttachment]=useState<File>(),[preview,setPreview]=useState('');
 const [demoAudioReady,setDemoAudioReady]=useState(false);
 const [recording,setRecording]=useState(false),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
 const recorder=useRef<MediaRecorder>(),stream=useRef<MediaStream>(),timer=useRef<ReturnType<typeof setTimeout>>(),alive=useRef(true);
 const fileInput=useRef<HTMLInputElement>(null);
 const messageInput=useRef<HTMLTextAreaElement>(null);
 const pending=useRef<Record<string,unknown>>();
 useEffect(()=>{alive.current=true;return()=>{alive.current=false;clearTimeout(timer.current);if(recorder.current?.state==='recording')recorder.current.stop();stream.current?.getTracks().forEach(t=>t.stop());}},[]);
 useEffect(()=>{if(!audio){setPreview('');return;}const url=URL.createObjectURL(audio);setPreview(url);return()=>URL.revokeObjectURL(url)},[audio]);
 const stop=()=>{if(previewMode){setRecording(false);setDemoAudioReady(true);setNotice('Áudio de demonstração pronto para enviar.');return;}clearTimeout(timer.current);if(recorder.current?.state==='recording')recorder.current.stop();stream.current?.getTracks().forEach(t=>t.stop());};
 async function record(){
  if(previewMode){setRecording(true);setDemoAudioReady(false);setNotice('Gravação simulada: clique novamente para finalizar.');return;}
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
  }catch(error){stream.current?.getTracks().forEach(t=>t.stop());if(alive.current)setNotice(error instanceof DOMException&&['NotAllowedError','SecurityError'].includes(error.name)?'No Chrome, clique no ícone de controles à esquerda do endereço, escolha Microfone → Permitir e recarregue a página.':'Não foi possível iniciar a gravação. Você também pode anexar um arquivo de áudio.');}
 }
 async function send(){
  if(previewMode){
   if(attachment)onPreviewSend?.({kind:'file',content:attachment.name});
   else if(demoAudioReady)onPreviewSend?.({kind:'audio',content:'Áudio de demonstração'});
   else if(text.trim())onPreviewSend?.({kind:'text',content:text.trim()});
   else return;
   if(!attachment)setText('');setAttachment(undefined);setDemoAudioReady(false);setNotice('Mensagem simulada. Nada foi enviado ao WhatsApp.');return;
  }
  if(busy)return;setBusy(true);setNotice('');
  try{
   if(!pending.current){
    if(!audio&&!attachment&&!text.trim())return;
    if(audio&&audio.size>4194304){setNotice('O áudio deve ter até 4 MB.');return;}
    let encoded:string|undefined;
    if(audio)encoded=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.onerror=reject;reader.readAsDataURL(audio)});
    const requestId=crypto.randomUUID();
    if(attachment){
     const meta=validateAttachment(attachment);const {data:prepared,error:prepareError}=await supabase.functions.invoke('lotti-whatsapp',{body:{action:'prepare_upload',request_id:requestId,name:attachment.name,mime:meta.mime,size:attachment.size}});
     if(prepareError||!prepared?.path||!prepared?.token)throw Error('upload_prepare_failed');
     const {error:uploadError}=await supabase.storage.from('lotti-inbox-files').uploadToSignedUrl(prepared.path,prepared.token,attachment,{contentType:meta.mime});if(uploadError)throw Error('upload_failed');
     pending.current={action:'send',conversation_id:conversationId,request_id:requestId,kind:'file',name:attachment.name,mime:meta.mime,size:attachment.size,storage_path:prepared.path};
    }else pending.current={action:'send',conversation_id:conversationId,request_id:requestId,kind:audio?'audio':'text',...(audio?{audio:encoded,mime:audio.type.split(';')[0]}:{text:text.trim()})};
   }
   const {data,error}=await supabase.functions.invoke('lotti-whatsapp',{body:pending.current});
   if(!alive.current)return;
   if(error||!data)throw Error('unknown');
   if(data.sendStatus==='sent'){pending.current=undefined;if(!attachment)setText('');setAudio(undefined);setAttachment(undefined);setNotice('Enviado. Você assumiu esta conversa.');onSent();}
   else if(['failed','busy'].includes(data.sendStatus)){pending.current=undefined;setNotice(data.sendStatus==='busy'?'Há uma entrega em andamento. Aguarde antes de enviar.':'Não foi enviado. Verifique a conexão e tente novamente.');}
   else setNotice('Envio sem confirmação. Confira no WhatsApp antes de tentar uma nova mensagem.');
  }catch{if(alive.current)setNotice('A confirmação demorou. Use Verificar envio para consultar sem duplicar a mensagem.');}
  finally{if(alive.current)setBusy(false);}
 }
 const locked=busy||!!pending.current;
 const canSend=!!text.trim()||!!audio||!!attachment||demoAudioReady||!!pending.current;
 return <footer className="space-y-2 border-t border-[#e9ebf3] bg-white px-[14px] pb-[14px] pt-[11px]">
  {(preview||attachment||demoAudioReady)&&<div className="flex items-center gap-2 rounded-lg border px-3 py-2 text-sm">{preview?<audio controls src={preview} className="h-10 min-w-0 flex-1"/>:<span className="min-w-0 flex-1 truncate">{demoAudioReady?'Áudio de demonstração':`${attachment?.name} · ${attachment&&Math.ceil(attachment.size/1024/1024)} MB`}</span>}<Button aria-label="Descartar anexo" variant="ghost" disabled={locked} onClick={()=>{setAudio(undefined);setAttachment(undefined);setDemoAudioReady(false)}}><Trash2 className="h-4 w-4"/></Button></div>}
  <div className="flex min-h-12 items-end gap-1 rounded-xl border border-[#d6dae6] bg-[#fbfcfe] px-2 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.75)] focus-within:ring-2 focus-within:ring-primary/25">
   <input ref={fileInput} aria-label="Anexar arquivo" className="sr-only" type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.csv,.zip,.jpg,.jpeg,.png,.webp,.gif,.mp4,.webm,.mov,.mp3,.ogg,.m4a,.wav" disabled={locked||recording} onChange={e=>{const f=e.target.files?.[0];if(f)try{validateAttachment(f);setAttachment(new File([f],safeAttachmentName(f.name),{type:f.type}));setAudio(undefined);setDemoAudioReady(false);setNotice('');messageInput.current?.focus()}catch(error){setNotice(error instanceof Error&&error.message==='file_too_large'?'O arquivo deve ter até 100 MB.':'Este tipo de arquivo não é permitido por segurança.')}e.target.value='';}}/>
   <Button type="button" aria-label="Anexar arquivo" title="Anexar arquivo" variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full text-muted-foreground" disabled={locked||recording} onClick={()=>fileInput.current?.click()}><Paperclip className="h-5 w-5"/></Button>
   {!audio&&<textarea ref={messageInput} aria-label="Mensagem" placeholder="Digite uma mensagem" value={text} maxLength={8000} rows={1} disabled={locked||recording} onChange={e=>setText(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(canSend&&!busy&&!recording)void send();}}} className="max-h-28 min-h-9 flex-1 resize-none border-0 bg-transparent px-2 py-2 text-sm shadow-none outline-none placeholder:text-muted-foreground focus:ring-0"/>}
   {canSend?<Button type="button" aria-label={busy?'Enviando':pending.current?'Verificar envio':'Enviar'} title={pending.current?'Verificar envio':'Enviar'} variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full text-primary" disabled={busy||recording} onClick={send}><Send className="h-5 w-5"/></Button>
    :<Button type="button" aria-label={recording?'Parar gravação':'Gravar áudio'} title={recording?'Parar gravação':'Gravar áudio'} variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-full text-muted-foreground" disabled={locked||!!audio} onClick={recording?stop:record}>{recording?<Square className="h-4 w-4"/>:<Mic className="h-5 w-5"/>}</Button>}
  </div>
  {notice&&<p role="status" className="px-1 text-[11px] text-muted-foreground">{notice}</p>}
 </footer>;
}
export function AudioMessage({path}:{path:string}){
 const [url,setUrl]=useState('');const [failed,setFailed]=useState(false);
 useEffect(()=>{let live=true;async function refresh(){const {data,error}=await supabase.storage.from('lotti-inbox-audio').createSignedUrl(path,3600);if(live){setUrl(data?.signedUrl||'');setFailed(!!error);}}void refresh();const timer=setInterval(refresh,3000000);return()=>{live=false;clearInterval(timer)}},[path]);
 return url?<audio controls preload="metadata" src={url} className="max-w-full"/>:<span className="text-xs">{failed?'Áudio indisponível no momento.':'Carregando áudio…'}</span>;
}
