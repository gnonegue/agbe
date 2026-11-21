import { describe, expect, it } from 'vitest';
import { SETTING_DEFAULTS, SETTING_SCHEMAS } from './settings.service';

describe('réglages de jeu par défaut', () => {
  it('chaque valeur par défaut respecte son schéma zod', () => {
    const bad: string[] = [];
    for (const key of Object.keys(SETTING_SCHEMAS) as (keyof typeof SETTING_SCHEMAS)[]) {
      const r = SETTING_SCHEMAS[key].safeParse((SETTING_DEFAULTS as Record<string, unknown>)[key]);
      if (!r.success) bad.push(`${key} → ${r.error.issues[0]?.path.join('.')}: ${r.error.issues[0]?.message}`);
    }
    expect(bad).toEqual([]);
  });
});
