import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Garde-fou : chaque code d'erreur que le serveur peut renvoyer a un texte clair pour le joueur, en français ET en anglais
 * (sinon l'appli n'affiche qu'un message générique). Couvre les exceptions écrites en dur et les codes renvoyés par les
 * fonctions de contrôle (inscription aux études, chat, garde-robe, cuisine). Les codes construits avec un lieu
 * (`go_to_…`, `work_at_…`, `buy_at_…`, `sell_at_…`) ont un texte générique avec le nom du lieu côté appli.
 */
const SRC = join(__dirname, '..');
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : p.endsWith('.ts') && !p.includes('.spec.') ? [p] : [];
  });

function serverCodes(): Set<string> {
  const codes = new Set<string>();
  for (const f of files(SRC)) {
    const t = readFileSync(f, 'utf8');
    for (const m of t.matchAll(/(?:BadRequest|NotFound|Conflict|Forbidden|Unauthorized|UnprocessableEntity|ServiceUnavailable|Gone)Exception\(\s*'([a-z0-9_]+)'/g)) codes.add(m[1]!);
    // Codes passés en argument à un contrôle (ex. cuisine : this.take(…, 'missing_ingredient'))
    for (const m of t.matchAll(/this\.take\([^)]*,\s*'([a-z0-9_]+)'\)/g)) codes.add(m[1]!);
    // Fonctions de contrôle qui renvoient un code d'erreur
    if (/export function (enrollBlock|checkMessage|outfitError)\b/.test(t)) {
      for (const m of t.matchAll(/return '([a-z0-9_]+)'/g)) codes.add(m[1]!);
      for (const m of t.matchAll(/code: '([a-z0-9_]+)'/g)) codes.add(m[1]!);
    }
  }
  return codes;
}

describe('codes d’erreur du serveur', () => {
  const codes = serverCodes();
  for (const lang of ['fr', 'en']) {
    it(`ont tous un texte pour le joueur en ${lang}`, () => {
      const errors = (JSON.parse(readFileSync(join(SRC, '..', '..', 'front', 'src', 'i18n', `${lang}.json`), 'utf8')) as { errors: Record<string, string> }).errors;
      const missing = [...codes].filter((c) => !(c in errors)).sort();
      expect(missing).toEqual([]);
    });
  }
  it('le filtre d’erreurs renvoie des codes connus', () => {
    expect(codes.size).toBeGreaterThan(300);
  });
});
