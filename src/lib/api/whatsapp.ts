import { chamarApi } from '@/lib/api';
import { lerJson } from './http';

async function json<T>(path:string,init:RequestInit={},fallback='Não foi possível concluir a operação.'):Promise<T>{
 const res=await chamarApi(path,init);return lerJson<T>(res,fallback);
}
const body=(value:unknown):RequestInit=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
const patch=(value:unknown):RequestInit=>({method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
export const whatsappBridgeApi=<T>(value:Record<string,unknown>)=>json<T>('/api/whatsapp/bridge',body(value),'Não foi possível acessar a ponte do WhatsApp.');
export const listarConversasApi=<T>(status?:'open'|'closed'|'all')=>json<T[]>(status?`/api/whatsapp/conversas?status=${status}`:'/api/whatsapp/conversas');
export const contarConversasApi=()=>json<{total:number;abertas:number;fechadas:number}>('/api/whatsapp/conversas/contagem');
export const ultimasMensagensApi=<T>()=>json<T[]>('/api/whatsapp/mensagens/ultimas');
export const mensagensApi=<T>(id:string)=>json<T[]>(`/api/whatsapp/conversas/${encodeURIComponent(id)}/mensagens`);
export const eventosApi=<T>(id:string)=>json<T[]>(`/api/whatsapp/conversas/${encodeURIComponent(id)}/eventos`);
export const modoApi=(id:string,mode:string)=>json(`/api/whatsapp/conversas/${id}/modo`,patch({mode}));
export const reconciliarApi=(id:string,chegou:boolean)=>json(`/api/whatsapp/conversas/${id}/reconciliar`,body({chegou}));
export const limparOptOutApi=(id:string)=>json(`/api/whatsapp/conversas/${id}/limpar-opt-out`,body({}));
export const atualizarContatoApi=<T>(id:string,name:string,phone:string)=>json<T>(`/api/whatsapp/conversas/${id}/contato`,patch({name,phone}));
export const mesclarConversasApi=<T>(keep:string,drop:string)=>json<T>('/api/whatsapp/conversas/mesclar',body({keep,drop}));
// A API devolve o status como texto puro ("open"), não JSON: ler como JSON acusava erro com a conversa já reaberta.
export const statusConversaApi=async(id:string,status:string)=>{const res=await chamarApi(`/api/whatsapp/conversas/${id}/status`,patch({status}));if(!res.ok)return lerJson(res,'Não foi possível alterar o estado da conversa.');return status;};
export const canalApi=<T>(phone:string)=>json<T|null>(`/api/whatsapp/canal?phone=${encodeURIComponent(phone)}`);
export const empresaCanalApi=(phone:string,name:string)=>json('/api/whatsapp/canal/empresa?phone='+encodeURIComponent(phone),patch({name}));
export const configuracoesAgenteApi=<T>()=>json<T|null>('/api/whatsapp/configuracoes');
export const salvarConfiguracoesAgenteApi=<T>(settings:unknown)=>json<T>('/api/whatsapp/configuracoes',{...body({settings}),method:'PUT'});
export const listarCampanhasApi=<T>()=>json<T[]>('/api/whatsapp/broadcasts');
export const campanhaApi=<T>(id:string)=>json<T>(`/api/whatsapp/broadcasts/${id}`);
export const salvarCampanhaApi=<T>(campaign:unknown)=>json<T>('/api/whatsapp/broadcasts/salvar',body({campaign}));
export const previewCampanhaApi=<T>(campaign:unknown)=>json<T>('/api/whatsapp/broadcasts/preview',body({campaign}));
export const ativarCampanhaApi=<T>(id:string)=>json<T>(`/api/whatsapp/broadcasts/${id}/ativar`,body({}));
export const controlarCampanhaApi=<T>(id:string,action:string)=>json<T>(`/api/whatsapp/broadcasts/${id}/controlar`,body({action}));
export const duplicarCampanhaApi=<T>(id:string)=>json<T>(`/api/whatsapp/broadcasts/${id}/duplicar`,body({}));
export const apagarCampanhaApi=<T>(id:string)=>json<T>(`/api/whatsapp/broadcasts/${id}`,{method:'DELETE'});
export const automacaoOnlineApi=()=>json<{online:boolean}>('/api/whatsapp/broadcasts/automacao');
export const conversasEsperandoApi=<T>()=>json<T>('/api/whatsapp/esperando');
