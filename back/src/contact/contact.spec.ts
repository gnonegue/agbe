import { describe, expect, it } from 'vitest';
import { normalizeWhatsapp } from './contact.module';

describe('normalizeWhatsapp', () => {
  it('garde les chiffres et l’indicatif', () => {
    expect(normalizeWhatsapp('+228 90 00 00 00')).toBe('22890000000');
    expect(normalizeWhatsapp('0022890000000')).toBe('22890000000');
    expect(normalizeWhatsapp('+33 6 12 34 56 78')).toBe('33612345678');
  });
  it('ajoute 228 à un numéro togolais à 8 chiffres', () => {
    expect(normalizeWhatsapp('90-00-00-00')).toBe('22890000000');
  });
  it('refuse un numéro impossible', () => {
    expect(normalizeWhatsapp('12345')).toBeNull();
    expect(normalizeWhatsapp('abc 90 00 00 00')).toBeNull();
    expect(normalizeWhatsapp('+228 90 00 00 00 00 00 00 00')).toBeNull();
  });
});
