import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const origens = new Set(['https://app.plataformalotti.com.br','https://olivercrm.vercel.app'])
const claims = (jwt: string) => JSON.parse(atob(jwt.split('.')[1].replace(/-/g,'+').replace(/_/g,'/')))

serve(async (req) => {
  const origin=req.headers.get('origin') ?? ''
  const aceita=origens.has(origin) || /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)
  const cors={
    'Access-Control-Allow-Origin':aceita?origin:'',
    'Access-Control-Allow-Headers':'authorization,apikey,content-type,x-client-info,x-upsert,prefer,range,accept-profile,content-profile,x-supabase-api-version,cache-control',
    'Access-Control-Allow-Methods':'GET,HEAD,POST,PATCH,PUT,DELETE,OPTIONS',
    'Access-Control-Expose-Headers':'content-range,range',Vary:'Origin','Cache-Control':'no-store',
  }
  const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}})
  if (req.method==='OPTIONS') return new Response(null,{headers:cors})
  if (origin && !aceita) return json({error:'Origem não permitida.'},403)
  const token=req.headers.get('authorization')?.replace(/^Bearer\s+/i,'')
  if (!token) return json({error:'Não autenticado.'},401)
  const url=Deno.env.get('SUPABASE_URL')!
  const key=Deno.env.get('SUPABASE_ANON_KEY')!
  const userClient=createClient(url,key,{global:{headers:{Authorization:`Bearer ${token}`}},auth:{persistSession:false,autoRefreshToken:false}})
  const admin=createClient(url,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}})
  let emitido:string|null=null
  try {
    const {data:auth,error:authError}=await userClient.auth.getUser(token)
    if (authError || !auth.user) return json({error:'Não autenticado.'},401)
    const parametros=new URL(req.url).searchParams
    const path=parametros.get('path')
    if (path) {
      const id=parametros.get('sessao') ?? ''
      if (!uuid.test(id) || !/^\/(rest|storage|functions)\/v1\/[a-zA-Z0-9_-]/.test(path)) return json({error:'Destino inválido.'},400)
      const destino=new URL(path,url)
      if (destino.origin!==new URL(url).origin || destino.pathname==='/functions/v1/admin-suporte' ||
          !/^\/(rest|storage|functions)\/v1\/[a-zA-Z0-9_-]/.test(destino.pathname)) return json({error:'Destino inválido.'},400)
      const {data:s,error}=await admin.rpc('suporte_obter_credenciais',{p_sessao:id,p_ator:auth.user.id})
      if (error || !s) return json({error:'Atendimento encerrado ou acesso revogado.'},403)
      // Falha fechada se o JWT do projeto expirar antes dos 30 minutos.
      if (claims(s.access_token).exp*1000<=Date.now()) return json({error:'Atendimento expirado. Abra uma nova sessão.'},403)
      const headers=new Headers()
      for (const h of ['content-type','prefer','range','accept','accept-profile','content-profile','x-upsert','x-client-info']) {
        const v=req.headers.get(h); if (v) headers.set(h,v)
      }
      headers.set('Authorization',`Bearer ${s.access_token}`)
      headers.set('apikey',key)
      if (/^\/(functions|storage)\//.test(destino.pathname) && !['GET','HEAD'].includes(req.method)) {
        const {error:auditError}=await admin.from('admin_auditoria').insert({
          ator_user_id:auth.user.id,acao:'suporte_requisicao',entidade:'corretores',entidade_id:s.corretor_id,
          dados_depois:{sessao_id:id,servico:destino.pathname.split('/')[1],recurso:destino.pathname.split('/')[3],metodo:req.method},
        })
        if (auditError) throw auditError
      }
      const resposta=await fetch(destino,{method:req.method,headers,
        body:['GET','HEAD'].includes(req.method)?undefined:await req.arrayBuffer(),redirect:'error'})
      const resultadoHeaders=new Headers(cors)
      for (const h of ['content-type','content-range','range']) {
        const v=resposta.headers.get(h); if (v) resultadoHeaders.set(h,v)
      }
      return new Response(resposta.body,{status:resposta.status,headers:resultadoHeaders})
    }
    if (req.method!=='POST') return json({error:'Método inválido.'},405)
    const body=await req.json()
    if (body.acao==='encerrar') {
      if (!uuid.test(body.sessao_id ?? '')) return json({error:'Sessão inválida.'},400)
      const {data:access,error}=await admin.rpc('suporte_encerrar_sessao',{p_sessao:body.sessao_id,p_ator:auth.user.id})
      if (error) return json({error:'Não foi possível encerrar o atendimento.'},403)
      if (access) await admin.auth.admin.signOut(access,'local')
      return json({ok:true})
    }
    if (body.acao!=='abrir' || !uuid.test(body.corretor_id ?? '')) return json({error:'Conta inválida.'},400)
    const {data:alvo,error:alvoError}=await userClient.rpc('admin_preparar_suporte',{p_corretor_id:body.corretor_id})
    if (alvoError || !alvo) return json({error:alvoError?.message ?? 'Acesso negado.'},403)
    const {data:target,error:targetError}=await admin.auth.admin.getUserById(alvo.user_id)
    if (targetError || !target.user?.email || !target.user.email_confirmed_at) return json({error:'A conta ainda precisa confirmar o e-mail.'},409)
    const {data:factors,error:factorError}=await admin.auth.admin.mfa.listFactors({userId:alvo.user_id})
    if (factorError || factors?.factors.some(f=>f.status==='verified')) return json({error:'Esta conta usa autenticação em duas etapas e exige atendimento acompanhado pelo titular.'},409)
    const {data:link,error:linkError}=await admin.auth.admin.generateLink({type:'magiclink',email:target.user.email})
    if (linkError || !link.properties?.hashed_token) throw new Error('Sessão indisponível')
    const isolado=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}})
    const {data:verified,error:verifyError}=await isolado.auth.verifyOtp({token_hash:link.properties.hashed_token,type:'magiclink'})
    if (verifyError || !verified.session || verified.user?.id!==alvo.user_id) throw new Error('Autenticação indisponível')
    emitido=verified.session.access_token
    const {data:s,error:sessionError}=await admin.rpc('suporte_criar_sessao',{
      p_ator:auth.user.id,p_corretor:body.corretor_id,p_auth_session:claims(emitido).session_id,
      p_access:emitido,
    })
    if (sessionError || !s) throw new Error('Registro indisponível')
    emitido=null
    return json({id:s.id,corretor_id:s.corretor_id,nome:alvo.nome,expira_em:s.expira_em,
      user:{id:target.user.id,email:target.user.email,aud:'authenticated',role:'authenticated',
        app_metadata:{},user_metadata:target.user.user_metadata,created_at:target.user.created_at}})
  } catch (e) {
    if (emitido) await admin.auth.admin.signOut(emitido,'local')
    console.error('admin-suporte: falha',e instanceof Error?e.name:'unknown')
    return json({error:'Não foi possível concluir o atendimento. Tente novamente.'},500)
  }
})
