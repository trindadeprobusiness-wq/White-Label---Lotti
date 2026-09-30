import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { bridgeUnreachable, buildAttachmentPath, buildStartBridgeRequest, parseLottiRequest, resolveBridgeUrl, sanitizeConnectionPhone, sanitizeConnectionTimestamp, startRefusal, type StartRequest, type UploadRequest } from './request.ts';
const cors={ 'Access-Control-Allow-Origin':'https://app.plataformalotti.com.br', 'Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods':'POST, OPTIONS', 'Cache-Control':'no-store' };
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
 if(req.method!=='POST')return json({error:'method_not_allowed'},405);
 const token=req.headers.get('Authorization')?.replace(/^Bearer\s+/i,'');
 if(!token)return json({error:'unauthorized'},401);
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:auth,error:authError}=await db.auth.getUser(token);
 if(authError||!auth.user)return json({error:'unauthorized'},401);
 try {
   if(Number(req.headers.get('Content-Length')||0)>6000000)return json({error:'payload_too_large'},413);
   let body:Record<string,unknown>;
   try{body=parseLottiRequest(await req.json())}catch(error){return json({error:error instanceof Error?error.message:'invalid_request'},400)}
   if(!['status','connect','disconnect','send','start','prepare_upload'].includes(String(body.action)))return json({error:'invalid_action'},400);
   // Identity comes from verified Auth, never a caller-supplied account/instance.
   const {data:owner,error}=await db.from('corretores').select('id,status').eq('user_id',auth.user.id).single();
   if(error||!owner)return json({error:'account_not_found'},403);
   if(owner.status==='suspenso')return json({error:'account_suspended'},403);
   if(body.action==='prepare_upload'){
    const path=buildAttachmentPath(body as UploadRequest,owner.id);const {data,error:uploadError}=await db.storage.from('lotti-inbox-files').createSignedUploadUrl(path);
    return uploadError||!data?json({error:'upload_unavailable'},503):json({path:data.path,token:data.token});
   }
   // A missing table or row (migration not applied yet) falls back to the secret.
   const {data:bridge}=await db.from('lotti_agent_bridge_endpoint').select('host').maybeSingle();
   const url=resolveBridgeUrl(Deno.env.get('LOTTI_CHANNEL_BRIDGE_URL'),bridge?.host),secret=Deno.env.get('LOTTI_CHANNEL_BRIDGE_TOKEN');
   if(!url||!secret)return json({error:'connection_service_unavailable'},503);
   let bridgeBody:Record<string,unknown>={action:body.action,corretor_id:owner.id,...(body.action==='send'?{conversation_id:body.conversation_id,request_id:body.request_id,kind:body.kind,text:body.text,audio:body.audio,mime:body.mime,name:body.name,size:body.size,storage_path:body.storage_path}:{})};
   let conversationId:string|undefined;
   if(body.action==='start'){
    const start=body as StartRequest;
    const userDb=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_ANON_KEY')!,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data,error:startError}=await userDb.rpc('lotti_inbox_start_conversation',{p_phone:start.phone,p_name:start.name??null});
    if(startError||typeof data!=='string'){const reason=startRefusal(startError);return json({error:'conversation_unavailable',...(reason?{reason}:{})},409);}
    conversationId=data;bridgeBody=buildStartBridgeRequest(start,owner.id,conversationId);
   }
   let response:Response;
   try{response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-lotti-connect':secret,'ngrok-skip-browser-warning':'1'},body:JSON.stringify(bridgeBody),signal:AbortSignal.timeout(25000)});}
   catch{const failure=bridgeUnreachable(body.action,conversationId);return json(failure.body,failure.status);}
   if(!response.ok)return json({error:'connection_service_unavailable'},503);
   const result=await response.json();
   if(body.action==='send'||body.action==='start')return ['sent','sending','uncertain','failed','busy'].includes(result.sendStatus)?json({sendStatus:result.sendStatus,...(conversationId?{conversationId}:{})}):json({error:'send_unavailable'},503);
   if(!['connected','connecting','disconnected'].includes(result.state))return json({error:'connection_service_unavailable'},503);
   const phone=sanitizeConnectionPhone(result.phone??result.ownerJid);
   const connectedAt=sanitizeConnectionTimestamp(result.connectedAt);
   return json({state:result.state,agentEnabled:result.agentEnabled===true,...(phone?{phone}:{}),...(connectedAt?{connectedAt}:{}),...(typeof result.qr==='string'&&result.qr.startsWith('data:image/png;base64,')?{qr:result.qr,qrExpiresAt:result.qrExpiresAt,qrGeneration:result.qrGeneration}:{})});
 }catch{return json({error:'connection_service_unavailable'},503);}
});
