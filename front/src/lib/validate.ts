// Validation côté client (le serveur revalide tout).
export const E164 = /^\+[1-9]\d{7,14}$/;
export const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,189}\.[^\s@]{2,63}$/;
export const NAME_RE = /^[\p{L}][\p{L} '\-]{1,23}$/u;
export const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const OTP = /^\d{6}$/;
/** Connexion avec la 2FA : code à 6 chiffres de l'application, ou code de secours à usage unique (10 chiffres). */
export const MFA_CODE = /^\d{6}$|^\d{10}$/;
/** Nom d'utilisateur : 3 à 20 caractères, minuscules, chiffres, « _ » ou « . » (comme le serveur). */
export const USERNAME = /^[a-z0-9_.]{3,20}$/;
export const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const isPasswordOk = (p: string) => p.length >= 10 && p.length <= 128;

/** Âge révolu, calculé en UTC exactement comme le back (auth/age.ts) ; null si date invalide ou future. */
export function ageFrom(iso: string, now = new Date()): number | null {
  if (!ISO_DATE.test(iso)) return null;
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  if (y < 1900 || dt.getTime() > now.getTime()) return null;
  let age = now.getUTCFullYear() - y;
  const beforeBirthday = now.getUTCMonth() < m - 1 || (now.getUTCMonth() === m - 1 && now.getUTCDate() < d);
  if (beforeBirthday) age--;
  return age;
}

/** Normalise un numéro saisi (espaces, points, tirets, parenthèses retirés). */
export const normalizePhone = (s: string) => s.trim().replace(/[\s.()\-]/g, '');

/** Identifiant de connexion : e-mail en minuscules, ou téléphone normalisé comme à l'inscription. */
export function normalizeIdentifier(s: string): string {
  const t = s.trim();
  if (t.includes('@')) return t.toLowerCase();
  const p = normalizePhone(t);
  return /^\+?\d+$/.test(p) ? p : t;
}

// Caractères de contrôle bidirectionnels / invisibles (usurpation visuelle d'un texte).
const INVISIBLE = /[\u061C\u200B-\u200F\u2028-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
/** Retire les caractères bidi/invisibles et les caractères de contrôle C0/C1. */
export function stripInvisible(s: string): string {
  return s.replace(INVISIBLE, '').replace(/[\u0000-\u001f\u007f-\u009f]/g, '');
}

/** Montant entier strictement positif (chiffres uniquement), sinon null. */
export function parseAmount(s: string, max = 100_000_000): number | null {
  const t = s.replace(/[\s  ]/g, '');
  if (!/^\d{1,9}$/.test(t)) return null;
  const n = Number(t);
  return Number.isSafeInteger(n) && n >= 1 && n <= max ? n : null;
}

/** Normalise un nom comme le serveur (trim + espaces multiples). */
export const normalizeName = (s: string) => s.trim().replace(/\s+/g, ' ');
