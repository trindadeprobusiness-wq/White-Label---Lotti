// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';

const { baixar } = vi.hoisted(() => ({ baixar: vi.fn() }));
vi.mock('@/lib/api', () => ({ apiDisponivel: () => true }));
vi.mock('@/lib/api/arquivos', () => ({ baixarInboxApi: baixar }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { storage: { from: () => ({ createSignedUrl: vi.fn() }) } } }));

import { CartaoChamada, ehAudio, ehChamada, PlayerAudio } from './MidiaDaConversa';

afterEach(() => { cleanup(); baixar.mockReset(); });

it('reconhece ligação e áudio pelo texto que o runtime grava', () => {
  expect(ehChamada('📞 Chamada de voz perdida')).toBe(true);
  expect(ehChamada('📹 Chamada de vídeo · 2 min')).toBe(true);
  expect(ehChamada('Chamada amanhã?')).toBe(false);
  expect(ehAudio('🎤 Áudio')).toBe(true);
  expect(ehAudio('Áudio')).toBe(true);
  expect(ehAudio('Áudio do imóvel em anexo')).toBe(false);
});

it('cartão de ligação: perdida em vermelho, atendida com duração', () => {
  render(<CartaoChamada texto="📞 Chamada de voz perdida" direcao="in" />);
  expect(screen.getByText('Chamada de voz')).not.toBeNull();
  expect(screen.getByText('Perdida').className).toContain('text-red-500');
  cleanup();
  render(<CartaoChamada texto="📹 Chamada de vídeo · 2 min" direcao="out" />);
  expect(screen.getByText('Chamada de vídeo')).not.toBeNull();
  expect(screen.getByText('2 min')).not.toBeNull();
});

it('áudio com arquivo: player com botão tocar; sem arquivo: aviso claro', async () => {
  baixar.mockResolvedValue('blob:audio');
  render(<PlayerAudio caminho="c1/in/M1.ogg" />);
  expect(screen.getByTestId('player-audio')).not.toBeNull();
  await waitFor(() => expect(baixar).toHaveBeenCalledWith('lotti-inbox-audio', 'c1/in/M1.ogg'));
  expect(screen.getByRole('button', { name: 'Tocar áudio' })).not.toBeNull();
  cleanup();
  render(<PlayerAudio caminho={null} />);
  expect(screen.getByText('Ouça no WhatsApp do celular')).not.toBeNull();
});

it('áudio que não baixa mostra indisponível', async () => {
  baixar.mockRejectedValue(new Error('403'));
  render(<PlayerAudio caminho="c1/in/M2.ogg" />);
  await waitFor(() => expect(screen.getByText('Indisponível no momento')).not.toBeNull());
});
