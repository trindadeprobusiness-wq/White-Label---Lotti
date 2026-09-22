export const MAX_ATTACHMENT_BYTES=100*1024*1024;
const allowed:Record<string,{kind:'image'|'video'|'audio'|'document';mime:string[]}>= {
 pdf:{kind:'document',mime:['application/pdf']},doc:{kind:'document',mime:['application/msword']},docx:{kind:'document',mime:['application/vnd.openxmlformats-officedocument.wordprocessingml.document']},
 xls:{kind:'document',mime:['application/vnd.ms-excel']},xlsx:{kind:'document',mime:['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']},ppt:{kind:'document',mime:['application/vnd.ms-powerpoint']},pptx:{kind:'document',mime:['application/vnd.openxmlformats-officedocument.presentationml.presentation']},
 txt:{kind:'document',mime:['text/plain']},csv:{kind:'document',mime:['text/csv','application/vnd.ms-excel']},zip:{kind:'document',mime:['application/zip','application/x-zip-compressed']},
 jpg:{kind:'image',mime:['image/jpeg']},jpeg:{kind:'image',mime:['image/jpeg']},png:{kind:'image',mime:['image/png']},webp:{kind:'image',mime:['image/webp']},gif:{kind:'image',mime:['image/gif']},
 mp4:{kind:'video',mime:['video/mp4']},webm:{kind:'video',mime:['video/webm','audio/webm']},mov:{kind:'video',mime:['video/quicktime']},
 mp3:{kind:'audio',mime:['audio/mpeg']},ogg:{kind:'audio',mime:['audio/ogg']},m4a:{kind:'audio',mime:['audio/mp4','audio/x-m4a']},wav:{kind:'audio',mime:['audio/wav','audio/x-wav']},
};
export function validateAttachment(file:{name:string;type:string;size:number}){
 if(file.size<1||file.size>MAX_ATTACHMENT_BYTES)throw Error('file_too_large');
 const ext=file.name.toLowerCase().split('.').pop()||'';const rule=allowed[ext];
 if(!rule||!rule.mime.includes(file.type.toLowerCase()))throw Error('unsupported_file');
 return {kind:rule.kind,mime:file.type.toLowerCase()};
}
export function safeAttachmentName(name:string){return name.normalize('NFKD').replace(/[^a-zA-Z0-9._-]+/g,'-').replace(/^-+|-+$/g,'').slice(-140)||'arquivo';}
