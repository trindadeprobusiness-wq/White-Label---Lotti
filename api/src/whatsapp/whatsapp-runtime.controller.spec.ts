import { WhatsappRuntimeController } from './whatsapp-runtime.controller';

describe('WhatsappRuntimeController', () => {
  it('inspeciona e assina somente os buckets do Inbox', async () => {
    const storage = {
      existe: jest.fn().mockResolvedValue({ contentLength: 42, contentType: 'application/pdf' }),
      assinarLeitura: jest.fn().mockResolvedValue('http://garage.internal/arquivo-assinado'),
      enviar: jest.fn(),
    };
    const controller = new WhatsappRuntimeController(storage as never);
    await expect(controller.inspect('lotti-inbox-files', { '0': 'conta/pedido/a.pdf' })).resolves.toEqual({ size: 42, mime: 'application/pdf' });
    await expect(controller.sign('lotti-inbox-files', { '0': 'conta/pedido/a.pdf' }, { expiresIn: 999 })).resolves.toEqual({ url: 'http://garage.internal/arquivo-assinado' });
    expect(storage.assinarLeitura).toHaveBeenCalledWith('lotti-inbox-files', 'conta/pedido/a.pdf', 300);
    await expect(controller.inspect('documentos', { '0': 'a.pdf' })).rejects.toMatchObject({ status: 400 });
  });
});
