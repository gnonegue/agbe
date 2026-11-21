// Modération automatique du chat (fonctions pures, testées).
// Leçon de Lagos Life : les annonces « monnaie du jeu contre argent réel, paiement d'avance » doivent être bloquées.

/** Texte nettoyé : espaces normalisés, caractères de contrôle et invisibles retirés. */
export function cleanText(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Forme comparable : minuscules, sans accents, chiffres « leet » ramenés aux lettres, sans séparateurs. */
export function squash(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[0]/g, 'o')
    .replace(/[1!|]/g, 'i')
    .replace(/[3]/g, 'e')
    .replace(/[4@]/g, 'a')
    .replace(/[5$]/g, 's')
    .replace(/[^a-z]/g, '');
}

// Vente de monnaie du jeu contre de l'argent réel : mots du mobile money et de l'argent « réel »
const REAL_MONEY = [
  'argentreel', 'vraiargent', 'realmoney', 'realcash', 'momo', 'mobilemoney', 'tmoney', 'floozmoney', 'flooz', 'moovmoney',
  'orangemoney', 'mtnmoney', 'wave', 'paypal', 'westernunion', 'moneygram', 'payementdabord', 'paiementdabord', 'paymentfirst', 'payfirst',
];

/** Numéro de téléphone (8 chiffres ou plus, séparés ou non) : contact hors jeu, souvent pour une arnaque. */
const PHONE = /(?:\+?\d[\s.\-]?){8,}/;
/** Lien externe. */
const LINK = /\b(?:https?:\/\/|www\.)|\b[a-z0-9-]+\.(?:com|net|org|tg|io|me|ly|gg|xyz|link)\b/i;

export type FilterVerdict = { ok: true; text: string } | { ok: false; code: 'chat_empty' | 'chat_too_long' | 'chat_real_money' | 'chat_contact' | 'chat_blocked_word' };

export function checkMessage(raw: string, opts: { maxLength: number; blockedWords: string[] }): FilterVerdict {
  const text = cleanText(raw);
  if (text.length === 0) return { ok: false, code: 'chat_empty' };
  if ([...text].length > opts.maxLength) return { ok: false, code: 'chat_too_long' };
  const flat = squash(text);
  if (REAL_MONEY.some((w) => flat.includes(w))) return { ok: false, code: 'chat_real_money' };
  if (PHONE.test(text) || LINK.test(text)) return { ok: false, code: 'chat_contact' };
  if (opts.blockedWords.some((w) => w.length >= 3 && flat.includes(squash(w)))) return { ok: false, code: 'chat_blocked_word' };
  return { ok: true, text };
}

export const REPORT_REASONS = ['scam', 'real_money', 'insult', 'harassment', 'spam', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
