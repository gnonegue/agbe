import i18n from '../i18n';
import { api } from '../api/client';

/** Devise d'affichage des montants. Les soldes, prix et paiements restent en FCFA côté serveur : seule la présentation change. */
export type Currency = 'XOF' | 'EUR' | 'USD';
export const CURRENCIES: Currency[] = ['XOF', 'EUR', 'USD'];

const KEY = 'agbe.currency';
let current: Currency = read();
/** FCFA pour 1 unité de devise (réglage « fx.rates » de l'admin, via le catalogue public). */
let rates: Record<string, number> = {};
let loading: Promise<void> | null = null;

function read(): Currency {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'EUR' || v === 'USD' ? v : 'XOF';
  } catch {
    return 'XOF';
  }
}

export const getCurrency = (): Currency => current;

/** Écrans d'administration : toujours en FCFA, quelle que soit la devise choisie pour jouer. */
let forceXof = false;
export function holdFcfa(on: boolean): void {
  forceXof = on;
}

/** Redessine les écrans déjà affichés (ils se mettent à jour comme pour un changement de langue). */
function refresh(): void {
  i18n.emit('languageChanged', i18n.language);
}

export function setCurrency(c: Currency): void {
  current = c;
  try {
    localStorage.setItem(KEY, c);
  } catch {
    /* stockage indisponible : la devise vaut pour cette session */
  }
  if (c !== 'XOF') void loadRates();
  refresh();
}

/** Taux du catalogue public, chargés une seule fois. */
export function loadRates(): Promise<void> {
  if (!loading) {
    loading = api<{ fx: Record<string, number> }>('/catalog')
      .then((c) => {
        rates = c.fx ?? {};
        refresh();
      })
      .catch(() => {
        loading = null;
      });
  }
  return loading;
}

/** Montant en FCFA converti dans la devise choisie, « 12 € » ; null si FCFA ou si le taux n'est pas connu. */
export function convertedText(n: bigint): string | null {
  if (current === 'XOF' || forceXof) return null;
  const rate = rates[current];
  if (!rate) return null;
  const value = Number(n) / rate;
  // Lisible : deux décimales seulement pour les petits montants (0,46 €), entiers au-delà (755 €), séparateur de milliers
  const small = Math.abs(value) < 10;
  return new Intl.NumberFormat(i18n.language === 'en' ? 'en-US' : 'fr-FR', {
    style: 'currency',
    currency: current,
    maximumFractionDigits: small ? 2 : 0,
    minimumFractionDigits: small ? 2 : 0,
  }).format(value);
}
