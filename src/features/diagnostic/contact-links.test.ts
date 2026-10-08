import { describe, expect, it } from 'vitest';
import { diagnosticContactLinks } from './contact-links';
describe('diagnostic contact actions', () => {
  it('prepares a WhatsApp conversation and email draft with valid contact data', () => {
    const links = diagnosticContactLinks({ name: 'Pessoa QA', phone: '+55 (62) 99999-9999', email: 'person+qa@example.test' });
    expect(links.whatsapp).toMatch(/^https:\/\/wa.me\/5562999999999\?text=/);
    expect(decodeURIComponent(links.whatsapp!)).toContain('Olá, Pessoa!');
    expect(links.email).toContain('mailto:person%2Bqa%40example.test');
    expect(decodeURIComponent(links.email!)).toContain('Seu diagnóstico de crescimento');
  });
  it('does not turn invalid or injected values into actionable links', () => {
    expect(diagnosticContactLinks({ phone: 'javascript:alert(1)', email: 'a@example.test?bcc=other@example.test' })).toEqual({ whatsapp: null, email: null });
    expect(diagnosticContactLinks({ email: 'a@example.test\r\nBcc:other@example.test' }).email).toBeNull();
    expect(diagnosticContactLinks({})).toEqual({ whatsapp: null, email: null });
  });
});
