import { describe, expect, it } from 'vitest';
import { ageAt } from './age';
import { encryptSecret, decryptSecret, safeEqual } from '../common/crypto';
import { randomBytes } from 'node:crypto';

describe('ageAt', () => {
  const now = new Date(Date.UTC(2026, 9, 18));
  it('computes full years', () => {
    expect(ageAt('2008-10-18', now)).toBe(18);
    expect(ageAt('2008-10-19', now)).toBe(17);
    expect(ageAt('1990-01-01', now)).toBe(36);
  });
  it('rejects impossible or future dates', () => {
    expect(ageAt('2001-02-30', now)).toBeNull();
    expect(ageAt('2030-01-01', now)).toBeNull();
    expect(ageAt('1850-01-01', now)).toBeNull();
    expect(ageAt("2000-01-01' OR 1=1", now)).toBeNull();
  });
});

describe('crypto', () => {
  const key = randomBytes(32).toString('base64');
  it('round-trips AES-GCM and detects tampering', () => {
    const enc = encryptSecret('JBSWY3DPEHPK3PXP', key);
    expect(decryptSecret(enc, key)).toBe('JBSWY3DPEHPK3PXP');
    const parts = enc.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    expect(() => decryptSecret(parts.join('.'), key)).toThrow();
  });
  it('compares in constant time', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abd')).toBe(false);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});
