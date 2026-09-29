// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { ConversationStatusDialog, NewConversationDialog, RenameContactDialog } from './InboxActionDialogs';

afterEach(cleanup);

it('valida e envia os dados mínimos de nova conversa', () => {
  const submit=vi.fn();
  render(<NewConversationDialog open onOpenChange={()=>{}} onSubmit={submit} pending={false} />);
  fireEvent.change(screen.getByLabelText('Telefone'),{target:{value:'(62) 99999-8888'}});
  fireEvent.change(screen.getByLabelText('Nome (opcional)'),{target:{value:'Maria'}});
  fireEvent.change(screen.getByLabelText('Mensagem inicial'),{target:{value:'Olá Maria'}});
  fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));
  expect(submit).toHaveBeenCalledWith({phone:'5562999998888',name:'Maria',text:'Olá Maria',request_id:expect.stringMatching(/^[0-9a-f-]{36}$/)});
});

function novaConversa(outcome?:{requestId:string;status:string}){
  const submit=vi.fn();
  const view=render(<NewConversationDialog open onOpenChange={()=>{}} onSubmit={submit} pending={false} outcome={outcome} />);
  const enviar=(phone:string,text:string)=>{fireEvent.change(screen.getByLabelText('Telefone'),{target:{value:phone}});fireEvent.change(screen.getByLabelText('Mensagem inicial'),{target:{value:text}});fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));return submit.mock.lastCall![0].request_id as string};
  return {submit,enviar,rerender:(o?:{requestId:string;status:string})=>view.rerender(<NewConversationDialog open onOpenChange={()=>{}} onSubmit={submit} pending={false} outcome={o} />)};
}

it('tentar de novo a mesma mensagem reaproveita o request_id, para a ponte não enviar duas vezes', () => {
  const {enviar,rerender}=novaConversa();
  const first=enviar('(62) 98123-4567','Olá');
  rerender({requestId:first,status:'uncertain'});
  expect(enviar('(62) 98123-4567','Olá')).toBe(first);
  rerender({requestId:first,status:'busy'});
  expect(enviar('(62) 98123-4567','Olá')).toBe(first);
  expect(enviar('(62) 98123-4567','Olá, tudo bem?')).not.toBe(first);
});

it('depois de enviada ou recusada, a mesma mensagem é um envio novo', () => {
  const {enviar,rerender}=novaConversa();
  const first=enviar('(62) 98123-4567','Olá');
  rerender({requestId:first,status:'failed'});
  const second=enviar('(62) 98123-4567','Olá');
  expect(second).not.toBe(first);
  rerender({requestId:second,status:'sent'});
  expect(enviar('(62) 98123-4567','Olá')).not.toBe(second);
});

it('oferece a saída junto do erro do contato', () => {
  const unir=vi.fn();
  render(<RenameContactDialog open initialName="Maria" initialPhone="5562999998888" onOpenChange={()=>{}} onSubmit={()=>{}} pending={false} error="Este telefone já está em outra conversa." action={{label:'Unir conversas',onClick:unir}} />);
  fireEvent.click(screen.getByRole('button',{name:'Unir conversas'}));
  expect(unir).toHaveBeenCalled();
});

it('edita o nome e o telefone atuais', () => {
  const submit=vi.fn();
  render(<RenameContactDialog open initialName="Maria" initialPhone="5562999998888" onOpenChange={()=>{}} onSubmit={submit} pending={false} />);
  fireEvent.change(screen.getByLabelText('Nome do cliente'),{target:{value:'Maria Silva'}});
  expect((screen.getByLabelText('Telefone') as HTMLInputElement).value).toBe('5562999998888');
  fireEvent.change(screen.getByLabelText('Telefone'),{target:{value:'(62) 98888-7777'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar contato'}));
  expect(submit).toHaveBeenCalledWith({name:'Maria Silva',phone:'5562988887777'});
});

it('renomeia contato com número oculto sem permitir digitar telefone', () => {
  const submit=vi.fn();
  render(<RenameContactDialog open initialName="Paula" initialPhone="" phoneHidden onOpenChange={()=>{}} onSubmit={submit} pending={false} />);
  expect(screen.getByText(/WhatsApp não mostrou o número/i)).not.toBeNull();
  expect((screen.getByLabelText('Telefone') as HTMLInputElement).disabled).toBe(true);
  fireEvent.change(screen.getByLabelText('Nome do cliente'),{target:{value:'Paula Lima'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar contato'}));
  expect(submit).toHaveBeenCalledWith({name:'Paula Lima',phone:''});
});

it('explica telefone inválido antes de tentar salvar o contato', () => {
  render(<RenameContactDialog open initialName="Maria" initialPhone="5562999998888" onOpenChange={()=>{}} onSubmit={()=>{}} pending={false} />);
  fireEvent.change(screen.getByLabelText('Telefone'),{target:{value:'123'}});
  expect(screen.getByText(/telefone com DDD/i)).not.toBeNull();
  expect((screen.getByRole('button',{name:'Salvar contato'}) as HTMLButtonElement).disabled).toBe(true);
});

it('confirma fechamento e reabertura com textos explícitos', () => {
  const confirm=vi.fn(); const {rerender}=render(<ConversationStatusDialog open status="open" onOpenChange={()=>{}} onConfirm={confirm} pending={false} />);
  expect(screen.getByRole('heading',{name:'Fechar conversa?'})).not.toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Fechar'})); expect(confirm).toHaveBeenCalledWith('closed');
  rerender(<ConversationStatusDialog open status="closed" onOpenChange={()=>{}} onConfirm={confirm} pending={false} />);
  expect(screen.getByRole('heading',{name:'Reabrir conversa?'})).not.toBeNull();
});
