// Texte traduit d'une annonce reçue en direct.
import type { TFunction } from 'i18next';
import type { Announce } from './live';
import { fcfa } from './format';

export function announceText(a: Announce, t: TFunction, lang: string, venueName: (id: string) => string): string {
  if (a.kind === 'job') return t('announce.job', { company: a.company, role: lang === 'en' ? a.roleEn : a.roleFr, gross: fcfa(Number(a.gross)) });
  if (a.kind === 'conference') return t(a.when === 'now' ? 'announce.conferenceNow' : 'announce.conferenceSoon', { emoji: a.emoji, title: lang === 'en' ? a.titleEn : a.titleFr, speaker: a.speaker, place: venueName(String(a.venueId)), hour: a.hour });
  if (a.kind === 'tontine') return t('announce.tontine', { name: a.name, amount: fcfa(Number(a.amount)), days: a.days, max: a.max });
  return t('announce.ceremony', { host: a.host, ceremony: t(`ceremony.kinds.${a.ceremony}`), place: venueName(String(a.venueId)), day: a.day });
}

/** Appli à ouvrir pour répondre à une annonce. */
export const announceApp = (a: Announce) => (a.kind === 'job' ? 'work' : a.kind === 'tontine' ? 'tontine' : a.kind === 'conference' ? 'study' : 'family') as 'work' | 'tontine' | 'study' | 'family';
