// @vitest-environment jsdom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { ConversationStatusDialog, NewConversationDialog, RenameContactDialog } from './InboxActionDialogs';

it('valida e envia os dados mínimos de nova conversa', () => {
  const submit=vi.fn();
  render(<NewConversationDialog open onOpenChange={()=>{}} onSubmit={submit} pending={false} />);
  fireEvent.change(screen.getByLabelText('Telefone'),{target:{value:'(62) 99999-8888'}});
  fireEvent.change(screen.getByLabelText('Nome (opcional)'),{target:{value:'Maria'}});
  fireEvent.change(screen.getByLabelText('Mensagem inicial'),{target:{value:'Olá Maria'}});
  fireEvent.click(screen.getByRole('button',{name:'Enviar mensagem'}));
  expect(submit).toHaveBeenCalledWith({phone:'5562999998888',name:'Maria',text:'Olá Maria'});
});

it('edita o nome atual', () => {
  const submit=vi.fn();
  render(<RenameContactDialog open initialName="Maria" onOpenChange={()=>{}} onSubmit={submit} pending={false} />);
  fireEvent.change(screen.getByLabelText('Nome do cliente'),{target:{value:'Maria Silva'}});
  fireEvent.click(screen.getByRole('button',{name:'Salvar nome'}));
  expect(submit).toHaveBeenCalledWith('Maria Silva');
});

it('confirma fechamento e reabertura com textos explícitos', () => {
  const confirm=vi.fn(); const {rerender}=render(<ConversationStatusDialog open status="open" onOpenChange={()=>{}} onConfirm={confirm} pending={false} />);
  expect(screen.getByRole('heading',{name:'Fechar conversa?'})).not.toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Fechar'})); expect(confirm).toHaveBeenCalledWith('closed');
  rerender(<ConversationStatusDialog open status="closed" onOpenChange={()=>{}} onConfirm={confirm} pending={false} />);
  expect(screen.getByRole('heading',{name:'Reabrir conversa?'})).not.toBeNull();
});
