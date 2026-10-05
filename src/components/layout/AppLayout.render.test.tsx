// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, expect, it, vi } from 'vitest';
import { AppLayout } from './AppLayout';

vi.mock('./AppSidebar', () => ({ AppSidebar: () => null }));
vi.mock('./MobileTopBar', () => ({ MobileTopBar: () => null }));
vi.mock('../onboarding/OnboardingTour', () => ({ OnboardingTour: () => null }));
vi.mock('@/hooks/routine/useGoogleCalendarReturn', () => ({ useGoogleCalendarReturn: () => undefined }));
vi.mock('../ai/AIChatWidget', () => ({ AIChatWidget: () => <div>Assistente flutuante</div> }));
vi.mock('@/components/admin/SuporteBoundary', () => ({ SuporteBanner: () => null }));

afterEach(cleanup);

it('não renderiza o assistente flutuante dentro do Inbox', () => {
  render(<MemoryRouter initialEntries={['/whatsapp']}><Routes><Route element={<AppLayout />}><Route path="/whatsapp" element={<div>Inbox</div>} /></Route></Routes></MemoryRouter>);
  expect(screen.queryByText('Assistente flutuante')).toBeNull();
});
