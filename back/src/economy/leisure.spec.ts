import { describe, expect, it } from 'vitest';
import { leisureLast, TV_HOUSING } from './leisure';

describe('leisureLast', () => {
  it('lit la date du loisir demandé', () => {
    expect(leisureLast({ tv: '2026-01-01T00:00:00.000Z' }, 'tv')).toBe(Date.UTC(2026, 0, 1));
    expect(leisureLast({ tv: '2026-01-01T00:00:00.000Z' }, 'read')).toBeNull();
  });
  it('ignore les valeurs illisibles', () => {
    expect(leisureLast(null, 'tv')).toBeNull();
    expect(leisureLast([], 'tv')).toBeNull();
    expect(leisureLast({ tv: 'pas une date' }, 'tv')).toBeNull();
    expect(leisureLast({ tv: 42 }, 'tv')).toBeNull();
  });
  it("le studio n'a pas de télé", () => {
    expect(TV_HOUSING).not.toContain('ENTRER_COUCHER');
    expect(TV_HOUSING).toContain('VILLA');
  });
});
