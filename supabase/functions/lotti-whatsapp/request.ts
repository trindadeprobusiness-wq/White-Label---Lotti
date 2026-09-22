export type StartRequest={action:'start';phone:string;name?:string;text:string;request_id:string};
export type UploadRequest={action:'prepare_upload';request_id:string;name:string;mime:string;size:number};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fileTypes:Record<string,string[]>={pdf:['application/pdf'],doc:['application/msword'],docx:['application/vnd.openxmlformats-officedocument.wordprocessingml.document'],xls:['application/vnd.ms-excel'],xlsx:['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],ppt:['application/vnd.ms-powerpoint'],pptx:['application/vnd.openxmlformats-officedocument.presentationml.presentation'],txt:['text/plain'],csv:['text/csv','application/vnd.ms-excel'],zip:['application/zip','application/x-zip-compressed'],jpg:['image/jpeg'],jpeg:['image/jpeg'],png:['image/png'],webp:['image/webp'],gif:['image/gif'],mp4:['video/mp4'],webm:['video/webm','audio/webm'],mov:['video/quicktime'],mp3:['audio/mpeg'],ogg:['audio/ogg'],m4a:['audio/mp4','audio/x-m4a'],wav:['audio/wav','audio/x-wav']};

export function parseLottiRequest(value:unknown):Record<string,unknown>|StartRequest|UploadRequest{
 if(!value||typeof value!=='object')throw Error('invalid_request');
 const body=value as Record<string,unknown>;
 if(body.action==='prepare_upload'){
  const name=String(body.name??'').trim(),mime=String(body.mime??'').toLowerCase(),size=Number(body.size),request_id=String(body.request_id??'');
  const ext=name.toLowerCase().split('.').pop()||'';
  if(!uuid.test(request_id)||name.length<1||name.length>180||!fileTypes[ext]?.includes(mime)||!Number.isInteger(size)||size<1||size>100*1024*1024)throw Error('invalid_file');
  return {action:'prepare_upload',request_id,name,mime,size};
 }
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
export function buildAttachmentPath(request:UploadRequest,ownerId:string){const safe=request.name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(-140)||'arquivo';return `${ownerId}/${request.request_id}/${safe}`;}

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
