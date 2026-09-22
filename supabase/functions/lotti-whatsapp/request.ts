export type StartRequest={action:'start';phone:string;name?:string;text:string;request_id:string};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function parseLottiRequest(value:unknown):Record<string,unknown>|StartRequest{
 if(!value||typeof value!=='object')throw Error('invalid_request');
 const body=value as Record<string,unknown>;
 if(body.action!=='start')return body;
 let phone=String(body.phone??'').replace(/\D/g,'');
 if(phone.length===10||phone.length===11)phone=`55${phone}`;
 if(phone.length<12||phone.length>15)throw Error('invalid_phone');
 const text=String(body.text??'').trim();
 if(!text||text.length>8000)throw Error('invalid_text');
 if(!uuid.test(String(body.request_id??'')))throw Error('invalid_request_id');
 const name=String(body.name??'').trim();
 if(name.length>120)throw Error('invalid_name');
 return {action:'start',phone,...(name?{name}:{}),text,request_id:String(body.request_id)};
}

export function buildStartBridgeRequest(request:StartRequest,ownerId:string,conversationId:string){
 return {action:'send',corretor_id:ownerId,conversation_id:conversationId,request_id:request.request_id,kind:'text',text:request.text};
}

export function sanitizeConnectionPhone(value:unknown){
 const phone=String(value??'').split('@')[0].replace(/\D/g,'');
 return phone.length>=8&&phone.length<=15?phone:undefined;
}

export function sanitizeConnectionTimestamp(value:unknown){
 return typeof value==='string'&&!Number.isNaN(Date.parse(value))?value:undefined;
}
