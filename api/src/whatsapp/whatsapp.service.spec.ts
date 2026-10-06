import { WhatsappService } from './whatsapp.service';

describe('WhatsappService',()=>{
 it('não chama a ponte quando a configuração está ausente',async()=>{
  const db={run:jest.fn(async(_claims,work)=>work({$queryRaw:jest.fn().mockResolvedValue([{id:'c',status:'ativo'}])}))};
  const oldUrl=process.env.LOTTI_CHANNEL_BRIDGE_URL,oldToken=process.env.LOTTI_CHANNEL_BRIDGE_TOKEN;
  delete process.env.LOTTI_CHANNEL_BRIDGE_URL;delete process.env.LOTTI_CHANNEL_BRIDGE_TOKEN;
  await expect(new WhatsappService(db as never).ponte({sub:'u',role:'authenticated'},{action:'status'})).rejects.toMatchObject({status:503});
  if(oldUrl)process.env.LOTTI_CHANNEL_BRIDGE_URL=oldUrl;if(oldToken)process.env.LOTTI_CHANNEL_BRIDGE_TOKEN=oldToken;
 });
 it('repassa à ponte somente a identidade obtida no banco',async()=>{
  const db={run:jest.fn(async(_claims,work)=>work({$queryRaw:jest.fn().mockResolvedValue([{id:'corretor-real',status:'ativo'}])}))};
  process.env.LOTTI_CHANNEL_BRIDGE_URL='https://bridge.example/webhook';process.env.LOTTI_CHANNEL_BRIDGE_TOKEN='segredo-de-teste';
  const fetchMock=jest.spyOn(global,'fetch').mockResolvedValue(new Response(JSON.stringify({state:'connected',agentEnabled:true}),{status:200}));
  await new WhatsappService(db as never).ponte({sub:'u',role:'authenticated'},{action:'status'});
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({action:'status',corretor_id:'corretor-real'});
  fetchMock.mockRestore();delete process.env.LOTTI_CHANNEL_BRIDGE_URL;delete process.env.LOTTI_CHANNEL_BRIDGE_TOKEN;
 });
 it('normaliza início e não repassa campos de identidade fornecidos pelo cliente',async()=>{
  const query=jest.fn().mockResolvedValueOnce([{id:'corretor-real',status:'ativo'}]).mockResolvedValueOnce([{value:'e6c6ed0c-1dbc-45e7-9d91-febf70555cab'}]);
  const db={run:jest.fn(async(_claims,work)=>work({$queryRaw:query}))};
  process.env.LOTTI_CHANNEL_BRIDGE_URL='https://bridge.example/webhook';process.env.LOTTI_CHANNEL_BRIDGE_TOKEN='segredo-de-teste';
  const fetchMock=jest.spyOn(global,'fetch').mockResolvedValue(new Response(JSON.stringify({sendStatus:'sent'}),{status:200}));
  const result=await new WhatsappService(db as never).ponte({sub:'u',role:'authenticated'},
    {action:'start',phone:'(11) 99999-0000',name:'Teste',text:'Olá',request_id:'68c19c0d-169e-464d-8759-54e5dcd6a16a'} as never);
  expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body))).toEqual({action:'send',corretor_id:'corretor-real',conversation_id:'e6c6ed0c-1dbc-45e7-9d91-febf70555cab',request_id:'68c19c0d-169e-464d-8759-54e5dcd6a16a',kind:'text',text:'Olá'});
  expect(result).toEqual({sendStatus:'sent',conversationId:'e6c6ed0c-1dbc-45e7-9d91-febf70555cab'});
  fetchMock.mockRestore();delete process.env.LOTTI_CHANNEL_BRIDGE_URL;delete process.env.LOTTI_CHANNEL_BRIDGE_TOKEN;
 });
 it('prepara caminho do Garage sem chamar a ponte',async()=>{
  const db={run:jest.fn(async(_claims,work)=>work({$queryRaw:jest.fn().mockResolvedValue([{id:'corretor-real',status:'ativo'}])}))};
  const fetchMock=jest.spyOn(global,'fetch');
  await expect(new WhatsappService(db as never).ponte({sub:'u',role:'authenticated'},
    {action:'prepare_upload',request_id:'68c19c0d-169e-464d-8759-54e5dcd6a16a',name:'contrato final.pdf',mime:'application/pdf',size:42} as never))
    .resolves.toEqual({storage_path:'corretor-real/68c19c0d-169e-464d-8759-54e5dcd6a16a/contrato-final.pdf'});
  expect(fetchMock).not.toHaveBeenCalled();fetchMock.mockRestore();
 });
});

