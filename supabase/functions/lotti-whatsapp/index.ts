import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
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
   const body=await req.json();
   if(!['status','connect'].includes(body.action))return json({error:'invalid_action'},400);
   // Identity comes from verified Auth, never a caller-supplied account/instance.
   const {data:owner,error}=await db.from('corretores').select('id,status').eq('user_id',auth.user.id).single();
   if(error||!owner)return json({error:'account_not_found'},403);
   if(owner.status==='suspenso')return json({error:'account_suspended'},403);
   const url=Deno.env.get('LOTTI_CHANNEL_BRIDGE_URL'),secret=Deno.env.get('LOTTI_CHANNEL_BRIDGE_TOKEN');
   if(!url||!secret)return json({error:'connection_service_unavailable'},503);
   const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','x-lotti-connect':secret,'ngrok-skip-browser-warning':'1'},body:JSON.stringify({action:body.action,corretor_id:owner.id}),signal:AbortSignal.timeout(25000)});
   if(!response.ok)return json({error:'connection_service_unavailable'},503);
   const result=await response.json();
   if(!['connected','connecting','disconnected'].includes(result.state))return json({error:'connection_service_unavailable'},503);
   return json({state:result.state,agentEnabled:result.agentEnabled===true,...(typeof result.qr==='string'&&result.qr.startsWith('data:image/png;base64,')?{qr:result.qr,qrExpiresAt:result.qrExpiresAt,qrGeneration:result.qrGeneration}:{})});
 }catch{return json({error:'connection_service_unavailable'},503);}
});
