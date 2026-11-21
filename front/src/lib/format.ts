import type { Locale } from '../api/types';
import i18n from '../i18n';
import { convertedText } from './currency';

/** « 75 000 FCFA » — accepte nombre ou chaîne (BigInt sérialisé). */
export function fcfa(amount: number | string | bigint): string {
  let n: bigint;
  try {
    n = typeof amount === 'bigint' ? amount : BigInt(typeof amount === 'number' ? Math.trunc(amount) : amount);
  } catch {
    n = 0n;
  }
  const conv = convertedText(n);
  if (conv) return conv;
  const neg = n < 0n;
  const digits = (neg ? -n : n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return i18n.t('app.currency', { amount: (neg ? '−' : '') + digits });
}

export function signed(n: number): string {
  return n > 0 ? `+${n}` : n < 0 ? `−${Math.abs(n)}` : '0';
}

export function localName(o: { nameFr: string; nameEn: string }, lang: string): string {
  return (lang as Locale) === 'en' ? o.nameEn : o.nameFr;
}

export function hhmm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Durée en heures de jeu → texte. */
export function gameDuration(hours: number): string {
  const totalMin = Math.max(0, Math.ceil(hours * 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? i18n.t('time.hours', { h, m }) : i18n.t('time.minutes', { m });
}

/** Durée courte pour un bouton : « 3 h 58 ». */
export function shortDuration(hours: number): string {
  const totalMin = Math.max(0, Math.ceil(hours * 60));
  return i18n.t('time.short', { h: Math.floor(totalMin / 60), m: String(totalMin % 60).padStart(2, '0') });
}

/** Ouvert à cette heure ? [o, c] en heures de jeu ; c < o = ouvert la nuit ; absent ou [0, 24] = toujours ouvert. */
export function isOpenAt(h: [number, number] | undefined, hour: number): boolean {
  if (!h) return true;
  const [o, c] = h;
  if (o === c || (o === 0 && c === 24)) return true;
  return o < c ? hour >= o && hour < c : hour >= o || hour < c;
}
