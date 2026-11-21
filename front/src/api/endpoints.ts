// Fonctions d'accès à l'API, une par route du contrat.
import { getCurrency, type Currency } from '../lib/currency';
import { api, ApiError, setAccessToken } from './client';
import { setHadSession } from '../lib/prefs';
import type { GarmentDef, Wear } from '../game/kit';
import type {
  Bill, Housing,
  ActionResponse, Catalog, Condition, BirthMode, HistoryEntry, Locale, Me, MfaChallenge,
  BoardOffer, Candidate, CompanyForm, Employee, MyOffers, PlayerJob, Payroll, Profile, Purchase, Region, State, TokenResponse, TransportMode,
} from './types';

export interface RegisterInput {
  username: string;
  email: string;
  phone: string;
  password: string;
  birthDate: string;
  acceptTerms: true;
  locale: Locale;
}

/** Session ouverte : jeton en mémoire + indicateur non sensible pour le refresh au prochain démarrage. */
function opened(r: TokenResponse): void {
  setAccessToken(r.accessToken);
  setHadSession(true);
}
/** Session fermée côté serveur : on efface le jeton mémoire et l'indicateur. */
function closed(): void {
  setAccessToken(null);
  setHadSession(false);
}

export async function register(input: RegisterInput): Promise<void> {
  opened(await api<TokenResponse>('/auth/register', { method: 'POST', body: { ...input, currency: getCurrency() } }));
}

/** Disponibilité d'un nom d'utilisateur, vérifiée pendant la saisie à l'inscription. */
export const usernameAvailable = (username: string) => api<{ available: boolean }>(`/auth/username-available?username=${encodeURIComponent(username)}`);

/** Jouer sans compte : contrôle d'âge et conditions, session sur cet appareil. */
export async function playAsGuest(birthDate: string, locale: Locale): Promise<void> {
  opened(await api<TokenResponse>('/auth/guest', { method: 'POST', body: { birthDate, acceptTerms: true, locale, currency: getCurrency() } }));
}
/** Un invité crée son compte et garde sa partie. */
export const upgradeAccount = (username: string, email: string, phone: string, password: string) => api<void>('/auth/upgrade', { method: 'POST', body: { username, email, phone, password }, auth: true });

/** Renvoie `null` si connecté, sinon le jeton du défi 2FA. */
export async function login(identifier: string, password: string): Promise<string | null> {
  const r = await api<TokenResponse | MfaChallenge>('/auth/login', { method: 'POST', body: { identifier, password } });
  if ('mfaRequired' in r && r.mfaRequired) return r.mfaToken;
  opened(r as TokenResponse);
  return null;
}

/** Session déjà ouverte côté serveur (retour de Google) : on marque l'appareil pour que le démarrage restaure la session. */
export const markSession = (): void => setHadSession(true);

export async function verifyMfa(mfaToken: string, code: string): Promise<void> {
  opened(await api<TokenResponse>('/auth/mfa', { method: 'POST', body: { mfaToken, code } }));
}

/** Moyens de connexion proposés par ce serveur (le bouton Google n'apparaît que s'il est configuré). */
export const getProviders = () => api<{ google: boolean }>('/auth/providers');
/** Adresse qui envoie vers la page de choix de compte Google (navigation complète : aucun script Google n'est chargé). */
export const googleStartUrl = (lang: Locale) => `/api/auth/google/start?lang=${lang}`;
/** Suite à donner après le retour de Google : finir l'inscription, confirmer son mot de passe, ou saisir le code 2FA. */
export interface GooglePending {
  kind: 'signup' | 'link' | 'mfa';
  email?: string;
  name?: string;
  mfaToken?: string;
}
export const googlePending = () => api<GooglePending>('/auth/google/pending', { method: 'POST' });
export const googleDone = () => api<void>('/auth/google/done', { method: 'POST' });
export async function googleComplete(input: { username: string; phone: string; birthDate: string; acceptTerms: true; locale: Locale }): Promise<void> {
  opened(await api<TokenResponse>('/auth/google/complete', { method: 'POST', body: { ...input, currency: getCurrency() } }));
}
/** Lie Google à un compte existant. Renvoie `null` si connecté, sinon le jeton du défi 2FA. */
export async function googleLink(password: string): Promise<string | null> {
  const r = await api<TokenResponse | MfaChallenge>('/auth/google/link', { method: 'POST', body: { password } });
  if ('mfaRequired' in r && r.mfaRequired) return r.mfaToken;
  opened(r as TokenResponse);
  return null;
}

/** Mot de passe oublié : toujours 204, que l'adresse ait un compte ou non. */
export const forgotPassword = (email: string) => api<void>('/auth/forgot-password', { method: 'POST', body: { email } });
/** Nouveau mot de passe avec le jeton reçu par e-mail (toutes les sessions sont fermées). */
export const resetPasswordWithToken = (token: string, password: string) => api<void>('/auth/reset-password', { method: 'POST', body: { token, password } });

/** Déconnexion : le jeton mémoire n'est effacé QU'APRÈS succès (sinon l'erreur remonte et l'on reste connecté). */
export async function logout(): Promise<void> {
  try {
    await api<void>('/auth/logout', { method: 'POST' });
  } catch (e) {
    // 401 : la session n'existe déjà plus côté serveur → c'est bien une déconnexion. Tout le reste remonte.
    if (!(e instanceof ApiError && e.status === 401)) throw e;
  }
  closed();
}
export async function logoutAll(): Promise<void> {
  await api<void>('/auth/logout-all', { method: 'POST', auth: true });
  closed();
}

/** Changement de mot de passe : toutes les sessions sont révoquées (204) → reconnexion. */
export async function changePassword(current: string, next: string): Promise<void> {
  await api<void>('/auth/password', { method: 'POST', body: { current, next }, auth: true });
  closed();
}
export const totpSetup = (password: string) =>
  api<{ otpauthUrl: string; secret: string }>('/auth/totp/setup', { method: 'POST', body: { password }, auth: true });
/** Activation 2FA : des codes de secours à usage unique sont montrés une seule fois ; toutes les sessions sont ensuite révoquées → reconnexion. */
export async function totpEnable(code: string): Promise<{ backupCodes: string[] }> {
  const r = await api<{ backupCodes: string[] }>('/auth/totp/enable', { method: 'POST', body: { code }, auth: true });
  closed();
  return r;
}
/** Nouveaux codes de secours (les anciens cessent de fonctionner) ; la session en cours reste active. */
export const regenerateBackupCodes = (password: string) =>
  api<{ backupCodes: string[] }>('/auth/totp/backup-codes', { method: 'POST', body: { password }, auth: true });
/** Désactivation volontaire de la 2FA : toutes les sessions sont révoquées (204) → reconnexion. */
export async function totpDisable(password: string): Promise<void> {
  await api<void>('/auth/totp/disable', { method: 'POST', body: { password }, auth: true });
  closed();
}

export const getMe = () => api<Me>('/me', { auth: true });
export const setCurrencyPref = (currency: Currency) => api<{ currency: Currency }>('/me/currency', { method: 'PATCH', body: { currency }, auth: true });
export const setLocale = (locale: Locale) => api<{ locale: Locale }>('/me/locale', { method: 'PATCH', body: { locale }, auth: true });
export const exportData = () => api<unknown>('/me/export', { auth: true });
export async function deleteAccount(password: string): Promise<void> {
  await api<void>('/me', { method: 'DELETE', body: { password }, auth: true });
  closed();
}

export const getCatalog = () => api<Catalog>('/catalog');
export const getPayroll = (gross: number) => api<Payroll>(`/economy/payroll?gross=${encodeURIComponent(String(gross))}`);

export interface CreateCharacterInput {
  name: string;
  profile: Profile;
  region: Region;
  mode: BirthMode;
  condition?: Condition;
}
export const createCharacter = (input: CreateCharacterInput) =>
  api<State>('/character', { method: 'POST', body: input, auth: true, idempotent: true });
/** Conditions de départ encore choisissables (plafond par condition). */
export const getConditionAvailability = () => api<Record<Condition, boolean>>('/character/conditions', { auth: true });
export const getCharacter = () => api<State>('/character', { auth: true });
export const getHistory = (limit = 30) => api<HistoryEntry[]>(`/character/history?limit=${limit}`, { auth: true });

const act = <R = Record<string, unknown>>(path: string, body?: unknown, paid = false, idemKey?: string) =>
  api<ActionResponse<R>>(`/character/${path}`, { method: 'POST', body, auth: true, idempotent: paid, ...(idemKey ? { idemKey } : {}) });

export const buyFreezer = () => act<{ paid: number }>('freezer/buy', undefined, true);
export const stockFreezer = (id: string, qty: number) => act<{ paid: string }>('freezer/stock', { id, qty }, true);
export const eatFromFreezer = (id: string) => act<{ food: string }>('freezer/eat', { id });
export const eat = (id: string) => act<{ paid: number; replay?: boolean }>('eat', { id }, true);
export const takeJob = (id: string) => act('job', { id });
/** Urgence : appeler le SAMU (santé basse) ; transfert à l'hôpital puis facture. */
export const callSamu = () => act<{ hospital: string; until: string }>('samu');
export const payMedicalBill = () => act<{ paid: number; covered: number }>('samu/pay', undefined, true);
export const quitJob = (id?: string) => act('job/quit', id ? { id } : undefined);
export const work = () => act<{ paid: number; incident: unknown; replay?: boolean }>('work', undefined, true);
export const rest = () => act('rest');
export const sleep = () => act<{ sleepUntil: string }>('sleep');
export const wake = () => act<{ energyGain: number }>('wake');
export const watchTv = () => act<{ moraleGain: number; energyGain: number }>('tv');
export const readBook = () => act<{ moraleGain: number; energyGain: number }>('read');
export const listenMusic = () => act<{ moraleGain: number; energyGain: number }>('music');
export const wash = () => act<{ paid: number; replay?: boolean }>('wash', undefined, true);
export const payAmu = () => act<{ paid: number; replay?: boolean }>('amu', undefined, true);
export const payRent = () => act<{ paid: number; replay?: boolean }>('rent', undefined, true);
export const payBill = (bill: Bill) => act<{ paid: number; replay?: boolean }>('bills', { bill }, true);
/** Joueur retrouvé par son nom d'utilisateur : permet d'envoyer de l'argent à distance. */
export const lookupRecipient = (username: string) => api<{ characterId: string; name: string; username: string }>(`/character/lookup?username=${encodeURIComponent(username)}`, { auth: true });
export interface RecipientMatch { characterId: string; name: string; username: string }
/** Suggestions de destinataires (nom d'utilisateur commençant par la saisie, ou identifiant exact). */
export const searchRecipients = (q: string) => api<RecipientMatch[]>(`/character/search?q=${encodeURIComponent(q)}`, { auth: true });
export const transfer = (toCharacterId: string, amount: number, memo: string | undefined, idemKey: string) =>
  act<{ amount: number | string; fee: number | string; replay?: boolean }>('transfer', memo ? { toCharacterId, amount, memo } : { toCharacterId, amount }, true, idemKey);

/** Concession, carburant, entretien et revente des véhicules personnels. */
export interface VehicleModel { id: string; kind: 'MOTO' | 'CAR'; nameFr: string; nameEn: string; emoji: string; descFr: string; descEn: string; price: number; tankL: number; mlPerKm: number; serviceEveryKm: number; serviceCost: number; repairCost: number; seats: number }
export interface MyVehicle { id: string; modelId: string; kind: 'MOTO' | 'CAR'; fuelMl: number; tankMl: number; odometerKm: number; sinceServiceKm: number; serviceEveryKm: number; serviceDue: boolean; breakdownRiskBp: number; damage: number; condition: number; drivable: boolean; resaleValue: number; boughtPrice: number }
export interface Garage { models: VehicleModel[]; fuelPricePerL: number; remoteFuel?: { pricePerL: number; fee: number }; stations: string[]; maxVehicles: number; mine: MyVehicle[] }
export const getGarage = () => api<Garage>('/vehicles', { auth: true });
const veh = <R,>(path: string, body?: unknown) => api<ActionResponse<R>>(`/vehicles/${path}`, { method: 'POST', auth: true, body, idempotent: true });
export const buyVehicle = (modelId: string) => veh<{ paid: number }>('buy', { modelId });
export const refuelVehicle = (id: string, liters: number, remote = false) =>
  veh<{ liters: number; paid: number; remote?: boolean }>(`${id}/refuel`, remote ? { liters, remote } : { liters }).then((r) => {
    // Le pompiste de la station (scène 3D) fait le plein à l'instant où il est payé (pas pour une livraison à distance)
    if (!remote) window.dispatchEvent(new CustomEvent('agbe:refuel'));
    return r;
  });
export const serviceVehicle = (id: string) => veh<{ paid: number }>(`${id}/service`);
export const repairVehicle = (id: string) => veh<{ paid: number }>(`${id}/repair`);
export const sellVehicle = (id: string) => veh<{ received: number }>(`${id}/sell`);
export const travel = (to: string, mode: TransportMode) =>
  act<{ to: string; mode: TransportMode; meters?: number; paid: string; incident: boolean; breakdown?: boolean; shiftEnded?: boolean; fuelUsedMl?: number; replay?: boolean }>('travel', { to, mode }, true);
export const intercity = (to: string) => act<{ to: string; paid: string; hours: number; arrival: string; replay?: boolean }>('intercity', { to }, true);
export const payRentDebt = () => act<{ paid: number; replay?: boolean }>('rent/debt', undefined, true);
export const moveHousing = (housing: Housing) => act<{ paid: number; replay?: boolean }>('move', { housing }, true);
export const buyHome = () => act<{ paid: number; replay?: boolean }>('home/buy', undefined, true);
export const saveLook = (look: import('../game/kit').SavedLook) => act<{ saved: boolean }>('look', look);
export const doActivity = (id: string) => act<{ activity: string; paid: number; replay?: boolean }>('activity', { id }, true);

const co = <R = Record<string, unknown>>(path: string, body?: unknown, paid = false) =>
  api<ActionResponse<R>>(path, { method: 'POST', body, auth: true, idempotent: paid });
export interface TradeGood {
  id: string;
  emoji: string;
  nameFr: string;
  nameEn: string;
  kind: 'IMPORT' | 'EXPORT' | 'LOCAL' | 'CAR';
  buyAt: string;
  sellAt: string;
  taxBp: number;
  maxQty: number;
  buyToday: number;
  sellToday: number;
  /** Échangeable depuis le téléphone (pas les voitures), et cours de rachat à distance du jour. */
  remote: boolean;
  /** Prix d'un achat à distance (toujours au-dessus de la revente sur place). */
  remoteBuy: number;
  remoteSell: number;
  /** Quantité déjà vendue aujourd'hui (jour de jeu) et maximum vendable par jour. */
  soldToday: number;
  dailyMax: number;
  held: number;
  heldCost: string;
}
export const getTrade = () => api<{ day: number; goods: TradeGood[] }>('/trade', { auth: true });
export const tradeBuy = (id: string, qty: number, remote = false) => co<{ good: string; qty: number; paid: string; duty?: string; replay?: boolean }>('/trade/buy', { id, qty, ...(remote ? { remote } : {}) }, true);
export const tradeSell = (id: string, qty: number, remote = false) => co<{ good: string; qty: number; received: string; tax?: string; profit?: string; replay?: boolean }>('/trade/sell', { id, qty, ...(remote ? { remote } : {}) }, true);
export interface StockInfo {
  symbol: string;
  nameFr: string;
  nameEn: string;
  sectorFr: string;
  sectorEn: string;
  /** Agitation quotidienne du cours, en points de base. */
  volBp: number;
  price: number;
  changeBp: number;
  series: number[];
  held: number;
  heldCost: string;
}
export type StockRange = '1d' | '7d' | '30d' | '90d' | '1y' | '5y';
export interface StockHistory { symbol: string; range: StockRange; now: number; points: { t: number; p: number }[]; min: number; max: number; avg: number; changeBp: number }
export interface InvestOption {
  id: string;
  kind: 'FARM' | 'BUSINESS';
  emoji: string;
  nameFr: string;
  nameEn: string;
  descFr: string;
  descEn: string;
  cost: number;
  gameDays: number;
  riskBp: number;
}
export interface VentureInfo {
  id: string;
  optionId: string;
  kind: 'FARM' | 'BUSINESS';
  invested: string;
  collected: string;
  available: string;
  progress: number;
  daysLeft: number;
  done: boolean;
  failed: boolean;
  result: string | null;
  closed: boolean;
}
export const getInvest = () => api<{ day: number; feeBp: number; stocks: StockInfo[]; options: InvestOption[]; ventures: VentureInfo[] }>('/invest', { auth: true });
export const getStockHistory = (symbol: string, range: StockRange) => api<StockHistory>(`/invest/stocks/history?symbol=${encodeURIComponent(symbol)}&range=${range}`, { auth: true });
export const buyStock = (symbol: string, qty: number) => co<{ paid: string; replay?: boolean }>('/invest/stocks/buy', { symbol, qty }, true);
export const sellStock = (symbol: string, qty: number) => co<{ received: string; profit?: string; replay?: boolean }>('/invest/stocks/sell', { symbol, qty }, true);
export const startVenture = (id: string) => co<{ venture?: string; replay?: boolean }>('/invest/ventures', { id }, true);
export const collectVenture = (id: string) => co<{ received: string; closed: boolean }>(`/invest/ventures/${encodeURIComponent(id)}/collect`);
export const getSavings = () => co<{ balance: string; dailyBp: number; maxBalance: number; interest: string }>('/invest/savings');
export const deposit = (amount: number) => co<{ amount: number; replay?: boolean }>('/invest/savings/deposit', { amount }, true);
export const withdraw = (amount: number) => co<{ amount: number; replay?: boolean }>('/invest/savings/withdraw', { amount }, true);
export const createCompany = (form: CompanyForm, name: string, activityId: string) => co<{ fee: string; replay?: boolean }>('/company', { form, name, activityId }, true);
export const selectCompany = (companyId: string) => co<{ company: string }>('/company/select', { companyId });
export const sellCompany = (companyId: string) => co<{ company: string; price: string; sold: boolean }>('/company/sell', { companyId });
export const closeCompany = (companyId: string) => co<{ company: string; price: string; sold: boolean }>('/company/close', { companyId });
export const collectDocuments = () => co<{ rccm: string; nif: string }>('/company/documents');
export const registerCnss = () => co<{ employeesRegistered: number }>('/company/cnss');
export const getCandidates = () => api<Candidate[]>('/company/candidates', { auth: true });
export const getEmployees = () => api<Employee[]>('/company/employees', { auth: true });
export const hire = (id: string) => co<{ employee: string; cnssDeadlineDay: number }>('/company/hire', { id });
export const fire = (id: string) => co('/company/fire', { id });
export const payPayroll = () => co<{ months: number; net: string; social: string; fine: string; paid: string; replay?: boolean }>('/company/payroll', undefined, true);
export const declareTaxes = () => co<{ total: string; replay?: boolean }>('/company/declare', undefined, true);
export const getMyOffers = () => api<MyOffers>('/company/offers', { auth: true });
export const postOffer = (roleIndex: number, grossMonthly: number) => co<{ offer: string }>('/company/offers', { roleIndex, grossMonthly });
export const closeOffer = (id: string) => co('/company/offers/close', { id });
export const getJobBoard = () => api<BoardOffer[]>('/jobs/offers', { auth: true });
export const getPlayerJob = () => api<{ job: PlayerJob | null }>('/jobs/mine', { auth: true });
export const acceptOffer = (id: string) => co<{ employee: string; company: string; role?: string; roleEn?: string }>('/jobs/accept', { id });
export const claimSalary = () => co<{ months: number; paidMonths: number; net: string }>('/jobs/salary');
export const resignPlayerJob = () => co('/jobs/quit');
export type ZemBike = 'GOZEM' | 'OWN' | 'OWNER';
export const startShift = (kind: 'job' | 'company', bike?: ZemBike) => co<{ shift: string; missions: number }>('/work/start', { kind, ...(bike ? { bike } : {}) });
export const zemContract = (action: 'sign' | 'end') => co<{ contract: boolean }>('/work/zem-contract', { action });
export const serveMission = (shift: string, mission: string, accept: boolean) => co<{ mission: string; paid: number; incident: boolean; finished: boolean }>('/work/serve', { shift, mission, accept });
export const stopShift = () => co('/work/stop');

export interface Billboard {
  id: string;
  slot: number;
  title: string;
  subtitle: string;
  bg: string;
  fg: string;
  url: string | null;
  partner: string;
  partnerKind: string;
  endsAt: string;
  hasImage?: boolean;
}
export type PartnerTier = 'NONE' | 'BRONZE' | 'SILVER' | 'GOLD';
/** Lieu de marque d'un partenaire Argent ou Or. */
export interface BrandPlace {
  id: string;
  name: string;
  kind: string;
  tier: PartnerTier;
  label: string;
  x: number;
  z: number;
  color: string;
  /** Modèle du bâtiment (tour, agence, restaurant, boutique, station, transport, clinique, hôtel). */
  model: string;
  url: string | null;
  /** Logo du partenaire (adresse de l'image), ou null. */
  logo: string | null;
}
export interface PartnerOffer {
  id: string;
  kind: 'JOB' | 'EVENT';
  title: string;
  body: string;
  place: string;
  url: string | null;
  happensAt: string | null;
  partner: string;
  tier: PartnerTier;
}
export interface FreeSpot {
  id: string;
  nameFr: string;
  nameEn: string;
  x: number;
  z: number;
  /** Formule visée selon l'emplacement ; null = Argent ou Or. */
  tier: 'GOLD' | 'SILVER' | 'BRONZE' | null;
  /** Tarif indicatif (réglages admin) : par mois et pour la durée par défaut, en FCFA, euros et dollars (arrondis). */
  price: { months: number; monthly: SpotAmount; total: SpotAmount };
  /** Ce joueur a déjà une demande en attente pour cet emplacement. */
  requested: boolean;
}
export interface SpotAmount {
  xof: number;
  eur: number | null;
  usd: number | null;
}
export const getFreeSpots = () => api<FreeSpot[]>('/partners/free-spots', { auth: true });
export const sendSpotRequest = (b: { spotId: string; name: string; company?: string; whatsapp: string; email?: string; message: string }) =>
  api<{ id: string; status: string }>('/partners/spot-requests', { method: 'POST', body: b, auth: true });
export const getBrandPlaces = () => api<BrandPlace[]>('/partners/places', { auth: true });
export const getPartnerOffers = () => api<PartnerOffer[]>('/partners/offers', { auth: true });
export const offerClick = (id: string) => api<void>(`/partners/offers/${encodeURIComponent(id)}/click`, { method: 'POST', auth: true });
export interface SeaGrid {
  cols: number;
  rows: number;
  cell: number;
  originX: number;
  originZ: number;
  maxSide: number;
  days: number;
}
export interface SeaPlot {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  live: boolean;
  title?: string;
  subtitle?: string;
  bg?: string;
  fg?: string;
  url?: string | null;
  partner?: string;
  hasImage?: boolean;
  endsAt?: string;
}
export const getPlots = () => api<{ grid: SeaGrid; pricePerPlot: number | null; periodDays?: number; periods?: number[]; plots: SeaPlot[]; zones?: { id: string; grid: SeaGrid; price?: number | null; plots: SeaPlot[] }[] }>('/boards/plots', { auth: true });
export const bookPlots = (b: { zone: string; x: number; y: number; w: number; h: number; periods: number; advertiser: string; title: string; subtitle: string; bg: string; fg: string; url?: string; site?: Locale }) =>
  api<{ campaignId: string; purchaseId: string; redirectUrl: string }>('/boards/plots/book', { method: 'POST', body: b, auth: true });
export const uploadPlotImage = (campaignId: string, blob: Blob) => api<void>(`/boards/plots/${encodeURIComponent(campaignId)}/image`, { method: 'POST', blob, auth: true });
/** Offre publicitaire publique : la page d'accueil n'en affiche que le contact des annonceurs. */
export const getAdOffer = () =>
  api<{
    board: { price: number; days: number } | null;
    boardFixed?: { price: number; days: number } | null;
    plot: { price: number; periodDays: number; places: { zone: string; price: number }[] } | null;
    tiers: Record<'BRONZE' | 'SILVER' | 'GOLD', { monthlyPrice: number; boards: number; rotating: number; jobs: number; eventsPerMonth: number; brandPlace: boolean }>;
    contact: { email: string; whatsapp: string };
  }>('/boards/offer');
/** Annonce en ligne, montrée sur le site public (page « Annonces »). */
export interface ShowcaseAd {
  id: string;
  where: string;
  title: string;
  subtitle: string;
  bg: string;
  fg: string;
  url: string | null;
  partner: string;
  hasImage: boolean;
  endsAt: string;
}
export const getShowcase = () => api<ShowcaseAd[]>('/boards/showcase');
/** Section « Nos partenaires » du site (vide si l'équipe la cache). */
export interface SitePartner {
  id: string;
  name: string;
  kind: string;
  website: string | null;
  color: string | null;
  tier: 'NONE' | 'BRONZE' | 'SILVER' | 'GOLD';
}
export const getSitePartners = () => api<SitePartner[]>('/boards/partners');
export type ContactTopic = 'board' | 'plots' | 'partner' | 'game' | 'other';
/** Formulaire de contact du site : enregistré dans l'administration et envoyé par e-mail à l'équipe. */
/** Bug signalé depuis le jeu : arrive dans les messages de l'administration (le serveur ajoute compte, lieu et navigateur). */
export const sendBugReport = (b: { message: string; viewport?: string; locale: Locale }) =>
  api<{ ok: true }>('/contact/bug', { method: 'POST', auth: true, body: b });
export const sendContact = (b: { name: string; company?: string; whatsapp: string; email?: string; topic: ContactTopic; message: string; locale: Locale; website?: string }) =>
  api<void>('/contact', { method: 'POST', body: b });
export const getBillboards = () => api<Billboard[]>('/boards', { auth: true });
export const billboardView = (id: string) => api<void>(`/boards/${encodeURIComponent(id)}/view`, { method: 'POST', auth: true });
export const billboardClick = (id: string) => api<void>(`/boards/${encodeURIComponent(id)}/click`, { method: 'POST', auth: true });

export interface CourseInfo {
  id: string;
  venueId: string;
  emoji: string;
  nameFr: string;
  nameEn: string;
  teacher: string;
  startHour: number;
  hours: number;
  fee: number;
  unlocks: string[];
  sessions: number;
  enrolled: boolean;
  sessionsDone: number;
  correctAnswers: number;
  completed: boolean;
  attendedToday: boolean;
  inSession: boolean;
  /** Entré en classe aujourd'hui, question pas encore posée. */
  seated: boolean;
  /** Retard toléré pour entrer en classe (minutes de jeu après le début). */
  lateMinutes: number;
  lesson: null | { textFr: string; textEn: string; qFr: string; qEn: string; choicesFr: string[]; choicesEn: string[] };
}
export const getCourses = () => api<CourseInfo[]>('/school', { auth: true });
export const enroll = (id: string) => api<ActionResponse<{ fee: number; replay?: boolean }>>('/school/enroll', { method: 'POST', body: { id }, auth: true, idempotent: true });
export const sitClass = (id: string) => api<ActionResponse<{ endHour: number }>>('/school/sit', { method: 'POST', body: { id }, auth: true });
export const attend = (id: string, choice: number) =>
  api<ActionResponse<{ correct: boolean; answer: number; session: number; sessions: number; completed: boolean; unlocks: string[] }>>('/school/attend', { method: 'POST', body: { id, choice }, auth: true });

/** Conférence publique programmée (sujet, orateur, et pour celle du jour : en cours, place prise, terminée). */
export interface ConferenceTalk {
  day: number;
  id: string;
  emoji: string;
  speaker: string;
  titleFr: string;
  titleEn: string;
  textFr: string;
  textEn: string;
  inSession: boolean;
  seated: boolean;
  done: boolean;
}
export interface ConferenceInfo {
  venueId: string;
  startHour: number;
  hours: number;
  fee: number;
  lateMinutes: number;
  /** Jour de jeu courant. */
  day: number;
  upcoming: ConferenceTalk[];
}
export const getConference = () => api<ConferenceInfo>('/conference', { auth: true });
export const conferenceSit = () => api<ActionResponse<{ endHour: number; fee: number }>>('/conference/sit', { method: 'POST', auth: true, idempotent: true });
export const conferenceFinish = () => api<ActionResponse<{ morale: number; respect: number }>>('/conference/finish', { method: 'POST', auth: true });

export interface MyAd { id: string; partner: string; title: string; slot: number; status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'ENDED'; views: number; clicks: number; endsAt: string; days: number; hasImage?: boolean }
/** slot : -1 = annonce rotative (tous les panneaux), sinon numéro du panneau (annonce fixe, majorée). */
export const bookBillboard = (b: { slot: number; advertiser: string; title: string; subtitle: string; bg: string; fg: string; url?: string; site?: Locale }) =>
  api<{ campaignId: string; purchaseId: string; redirectUrl: string }>('/boards/book', { method: 'POST', body: b, auth: true });
/** Panneaux réservables et numéros déjà pris (page de réservation du site). */
export const getBoardSlots = () => api<{ count: number; taken: number[]; rotating: number; rotatingMax: number; rotationFrom: number }>('/boards/slots', { auth: true });
export const myAds = () => api<MyAd[]>('/boards/mine', { auth: true });

export const getProvider = () => api<{ provider: string }>('/payments/provider', { auth: true });
export const checkout = (id: string) =>
  api<{ purchaseId: string; redirectUrl: string }>('/payments/checkout', { method: 'POST', body: { id }, auth: true, idempotent: true });
export const getPurchase = (id: string) => api<Purchase>(`/payments/purchase/${encodeURIComponent(id)}`, { auth: true });
export const completeMockPayment = (id: string) =>
  api<unknown>(`/payments/mock/${encodeURIComponent(id)}/complete`, { method: 'POST', auth: true, idempotent: true });

export const restartLife = () => api<void>('/character/restart', { method: 'POST', body: { confirm: 'RESTART' }, auth: true });

export interface BankInfo {
  id: string;
  name: string;
  kind: 'BANK' | 'MFI';
  savingsYearBp: number;
  minSavings: number;
  minTerm: number;
  terms: { months: number; yearBp: number }[];
}
export interface BankTerm {
  id: string;
  bankId: string;
  principal: string;
  yearBp: number;
  months: number;
  startDay: number;
  endDay: number;
  interest: string;
  matured: boolean;
}
export interface BankView {
  day: number;
  interest: string;
  banks: BankInfo[];
  savings: { bankId: string; balance: string; yearBp: number }[];
  terms: BankTerm[];
}
export const getBank = () => co<BankView>('/bank/state');
export const bankDeposit = (bankId: string, amount: number) => co<{ amount: number; replay?: boolean }>('/bank/savings/deposit', { bankId, amount }, true);
export const bankWithdraw = (bankId: string, amount: number) => co<{ amount: number; replay?: boolean }>('/bank/savings/withdraw', { bankId, amount }, true);
export const openTerm = (bankId: string, months: number, amount: number) => co<{ id?: string; amount: number; interest?: string; replay?: boolean }>('/bank/terms', { bankId, months, amount }, true);
export const closeTerm = (id: string) => co<{ principal: string; interest: string; early: boolean }>(`/bank/terms/${encodeURIComponent(id)}/close`);

// Prêt bancaire personnel
export interface LoanSettings {
  capAmount: number;
  rateBp: number;
  termDays: number;
  installmentsCount: number;
  periodDays: number;
  lateFeeBpPerDay: number;
}
export interface LoanState {
  id: string;
  principal: string;
  rateBp: number;
  remaining: string;
  installmentAmount: string;
  nextDueGameDay: number;
  lateSinceGameDay: number | null;
  totalPenaltyPaid: string;
  status: 'OPEN' | 'LATE' | 'CLOSED';
  closedAt: string | null;
}
export interface MyLoan {
  settings: LoanSettings;
  loan: LoanState | null;
}
export const myLoan = () => api<MyLoan>('/loans/mine', { auth: true });
export const requestLoan = (amount: number) => co<{ id: string | null; amount?: number; installment?: string; period?: number; replay?: boolean }>('/loans/request', { amount }, true);
export const repayLoan = (amount: number) => co<{ id?: string; remaining?: string; closed?: boolean; replay?: boolean }>('/loans/repay', { amount }, true);

// Tontine entre joueurs
export const getTontines = () => api<import('./types').TontineList>('/tontines', { auth: true });
export const createTontine = (name: string, contribution: number, periodDays: number, maxMembers: number) => co<{ tontine: string }>('/tontines', { name, contribution, periodDays, maxMembers });
export const joinTontine = (id: string) => co(`/tontines/${id}/join`);
export const leaveTontine = (id: string) => co<{ cancelled: boolean }>(`/tontines/${id}/leave`);
export const startTontine = (id: string) => co<{ members: number }>(`/tontines/${id}/start`);
export const payTontine = (id: string) => co<{ paid: string; round: number; replay?: boolean }>(`/tontines/${id}/pay`, undefined, true);
export const collectTontine = (id: string) => co<{ amount: string; refunded: boolean; finished: boolean }>(`/tontines/${id}/collect`);

// Marché entre joueurs
export const getMyMarket = () => api<import('./types').MyMarket>('/market', { auth: true });
export const getStalls = () => api<import('./types').MarketStalls>('/market/stalls', { auth: true });
export const rentStall = (weeks: number) => co<{ paidUntilDay: number; paid: string; replay?: boolean }>('/market/stall', { weeks }, true);
export const buyWholesale = (goodId: string, qty: number) => co<{ paid: string; unit: number; replay?: boolean }>('/market/wholesale', { goodId, qty }, true);
export const setStallPrice = (goodId: string, price: number) => co('/market/price', { goodId, price });
export const withdrawStock = (goodId: string, qty: number) => co('/market/withdraw', { goodId, qty });
export const buyAtStall = (stallId: string, goodId: string, qty: number) => co<{ paid: string; replay?: boolean }>('/market/buy', { stallId, goodId, qty }, true);
export const useGood = (goodId: string) => co('/market/use', { goodId });

// Santé, famille, cérémonies, équipements, actualité économique
/** Dossier d'une consultation : examen, analyses demandées (puis résultats), interprétation et ordonnance. */
export interface MedicalVisit {
  id: string;
  day: number;
  status: 'CONSULTED' | 'ANALYZED' | 'TREATED' | 'CLOSED';
  vitals: { temp: string; pulse: number; bp: string };
  examFr: string;
  examEn: string;
  analyses: { id: string; nameFr: string; nameEn: string; unit: string; refFr: string; refEn: string; full: number; price: string; done: boolean; result: null | { valueFr: string; valueEn: string; flag: 'normal' | 'high' | 'low' | 'positive' | 'negative' } }[];
  pendingTotal: string;
  interpretation: null | { illness: string | null; fr: string; en: string };
  prescription: null | { items: { id: string; nameFr: string; nameEn: string; doseFr: string; doseEn: string; price: number }[]; total: number; patientTotal: string };
}
export const getVisit = () => api<{ visit: MedicalVisit | null }>('/health/visit', { auth: true });
export const consultDoctor = () => co<{ paid: string; visit: MedicalVisit | null; replay?: boolean }>('/health/consult', undefined, true);
export const doAnalyses = () => co<{ paid: string; visit: MedicalVisit | null; replay?: boolean }>('/health/analyses', undefined, true);
export const treatIllness = () => co<{ paid: string; covered?: string; cured: string; replay?: boolean }>('/health/treat', undefined, true);
export const getFamily = () => api<import('./types').FamilyRequest[]>('/family', { auth: true });
export const answerFamily = (id: string, pay: boolean) => co<{ paid: string }>(`/family/${id}/answer`, { pay }, true);
export const getCeremonies = () => api<import('./types').CeremonyList>('/ceremonies', { auth: true });
export const organizeCeremony = (kind: import('./types').CeremonyKind, venueId: string, inDays: number) => co<{ ceremony: string; day: number; paid: string; replay?: boolean }>('/ceremonies', { kind, venueId, inDays }, true);
export const attendCeremony = (id: string, gift: number) => co<{ gift: string }>(`/ceremonies/${id}/attend`, { gift }, true);
export const cancelCeremony = (id: string) => co(`/ceremonies/${id}/cancel`);
export const buyEquipment = (kind: 'generator' | 'solar' | 'waterTank') => co<{ paid: string; replay?: boolean }>('/home/equipment', { kind }, true);

// Hôtel
export const getHotel = () => api<import('./types').HotelView>('/hotel', { auth: true });
export const bookRoom = (roomType: string, nights: number) => co<{ paid: string; untilDay: number; replay?: boolean }>('/hotel/book', { roomType, nights }, true);
export const hotelCheckout = () => co('/hotel/checkout');
export const roomService = (itemId: string) => co<{ paid: string; replay?: boolean }>('/hotel/order', { itemId }, true);
export const bookHall = (hallId: string, inDays: number) => co<{ day: number; paid: string; replay?: boolean }>('/hotel/hall', { hallId, inDays }, true);

// ---------- Foncier : terrains par quarts de lot, titre foncier, exploitation, revente ----------
export interface LandZoneInfo {
  id: string;
  nameFr: string;
  nameEn: string;
  descFr: string;
  descEn: string;
  layout: { originX: number; originZ: number; cols: number; rows: number; cell: number };
  /** Rangées prévues au total : plus que `layout.rows` tant que la zone s'étend au fil des achats. */
  planRows: number;
  water: boolean;
  totalQuarters: number;
  soldQuarters: number;
  minPerM2: string;
  maxPerM2: string;
}
export interface LandStepRule { feePerM2: number; minFee: number; gameHours: number }
export interface LandUse {
  id: string;
  kind: 'HOUSE' | 'BUSINESS';
  emoji: string;
  nameFr: string;
  nameEn: string;
  /** Maison : classe de logement, modèle dessiné et description. */
  model?: 'ENTRER_COUCHER' | 'CHAMBRE_SALON' | 'VILLA';
  style?: string;
  descFr?: string;
  descEn?: string;
  minM2: number;
  cost: number;
  costPerM2: number;
  buildGameDays: number;
  dailyYieldBp: number;
  lifeGameDays: number;
}
export interface LandCatalog {
  lotM2: number;
  quarterM2: number;
  maxM2: number;
  ownedM2: number;
  maxPicks: number;
  purchaseFeeBp: number;
  transferTaxBp: number;
  steps: Record<'SURVEYED' | 'OPINION' | 'TITLED', LandStepRule>;
  uses: LandUse[];
  zones: LandZoneInfo[];
}
export interface LandZonePlan {
  zoneId: string;
  layout: { originX: number; originZ: number; cols: number; rows: number; cell: number };
  planRows: number;
  /** Par cellule : prix du m² (FCFA), masque des quarts libres et masque de mes quarts (4 bits). */
  price: number[];
  free: number[];
  mine: number[];
  margin: number;
  sign: boolean;
  /** Parcelle en mer (prestige) : distincte des cases de publicité. */
  water: boolean;
  /** Occupation publique (carte) : quarts vendus par achat, couleur stable de l'occupant, exploitation ; `home` : ma maison habitée. */
  owners: { cell: number; q: number; g?: number; o: number; mine: boolean; home: boolean; use: string | null; ready: boolean }[];
}
export interface LandCellInfo { zoneId: string; cell: number; x: number; z: number; perM2: string; centralityBp: number; roadBp: number; seaBp: number; tierBp: number; fixed: boolean }
export interface LandPick { cell: number; quarters: number[] }
export interface LandQuote {
  items: { cell: number; quarters: number[]; m2: number; perM2: string; price: string }[];
  m2: number;
  ownedM2: number;
  maxM2: number;
  overLimit: boolean;
  total: string;
  fee: string;
  grand: string;
}
export type LandStatus = 'BOUGHT' | 'SURVEYED' | 'OPINION' | 'TITLED';
export interface LandHolding {
  id: string;
  zoneId: string;
  cell: number;
  /** Tous les lots de la parcelle (plusieurs après un regroupement). */
  cells?: number[];
  quarters: number;
  m2: number;
  paid: string;
  perM2: string;
  value: string;
  status: LandStatus;
  step: { target: LandStatus; readyAt: string } | null;
  next: { step: LandStatus; fee: string; gameHours: number } | null;
  titleNo: string | null;
  use: { id: string; cost: string; readyAt: string | null; ready: boolean; collectable: string; collected: string; movedIn: boolean } | null;
  ask: string | null;
}
export interface LandMine { ownedM2: number; maxM2: number; holdings: LandHolding[] }
export interface LandListing {
  id: string;
  zoneId: string;
  cell: number;
  m2: number;
  titleNo: string | null;
  seller: string;
  mine: boolean;
  ask: string;
  askPerM2: string;
  marketPerM2: string;
  use: { id: string; ready: boolean } | null;
}
export const getLand = () => api<LandCatalog>('/land', { auth: true });
export const getLandZone = (zoneId: string) => api<LandZonePlan>(`/land/zones/${encodeURIComponent(zoneId)}`, { auth: true });
export const getLandCell = (zoneId: string, cell: number) => api<LandCellInfo>(`/land/zones/${encodeURIComponent(zoneId)}/cells/${cell}`, { auth: true });
export const quoteLand = (zoneId: string, picks: LandPick[]) => api<LandQuote>('/land/quote', { method: 'POST', body: { zoneId, picks }, auth: true });
export const buyLandQuarters = (zoneId: string, picks: LandPick[]) => co<{ zoneId: string; m2?: number; paid?: string; fee?: string; replay?: boolean }>('/land/buy', { zoneId, picks }, true);
export const getMyLand = () => api<LandMine>('/land/mine', { auth: true });
export const getLandMarket = () => api<{ transferTaxBp: number; listings: LandListing[] }>('/land/market', { auth: true });
export const landMerge = (ids: string[]) => co<{ id: string; m2: number; merged: number }>('/land/merge', { ids });
export const landStep = (id: string) => co<{ id: string; step?: LandStatus; paid?: string; replay?: boolean }>(`/land/${id}/step`, undefined, true);
export const landUse = (id: string, useId: string) => co<{ id: string; paid?: string; replay?: boolean }>(`/land/${id}/use`, { id: useId }, true);
export const landCollect = (id: string) => co<{ id: string; received: string; worn: boolean }>(`/land/${id}/collect`);
export const landMoveIn = (id: string) => co<{ housing: string }>(`/land/${id}/move-in`);
export const landList = (id: string, ask: number) => co<{ id: string; ask: string }>(`/land/${id}/list`, { ask });
export const landUnlist = (id: string) => co<{ id: string }>(`/land/${id}/unlist`);
export const landBuyListing = (id: string) => co<{ id: string; paid?: string; tax?: string; replay?: boolean }>(`/land/${id}/buy-listing`, undefined, true);

// ---------- Cuisine à la maison ----------
export interface KitchenItem {
  id: string;
  emoji: string;
  nameFr: string;
  nameEn: string;
  price: number;
  pack: number;
  shelfDays: number;
  venues: string[];
}
export interface KitchenAppliance {
  id: string;
  kind: 'FRIDGE' | 'STOVE';
  fuel?: 'CHARCOAL' | 'GAS' | 'ELECTRIC';
  fuelItem?: string;
  emoji: string;
  nameFr: string;
  nameEn: string;
  descFr: string;
  descEn: string;
  price: number;
  venues: string[];
}
export interface KitchenRecipe {
  id: string;
  foodId: string;
  portions: number;
  effort: number;
  items: { id: string; qty: number }[];
}
export interface KitchenState {
  items: KitchenItem[];
  appliances: KitchenAppliance[];
  recipes: KitchenRecipe[];
  rules: { fridgeShelfBp: number; leftoverDays: number; leftoverFridgeDays: number; homeMoraleBonus: number; electricFee: number; maxLeftovers: number };
  owned: string[];
  /** `daysLeft` : jours de jeu avant la première péremption (null : ne se périme pas). */
  pantry: { itemId: string; qty: number; daysLeft: number | null }[];
}
const kitchenAct = <R = Record<string, unknown>>(path: string, body: unknown, paid = false) =>
  api<ActionResponse<R>>(`/kitchen/${path}`, { method: 'POST', body, auth: true, idempotent: paid });
export const getKitchen = () => api<KitchenState>('/kitchen', { auth: true });
export const buyGrocery = (itemId: string, qty: number) => kitchenAct<{ paid: string; qty: number }>('buy', { itemId, qty }, true);
export const buyRecipeItems = (recipeId: string) => kitchenAct<{ paid: string; items: { itemId: string; qty: number }[] }>('buy-recipe', { recipeId }, true);
export const buyAppliance = (id: string) => kitchenAct<{ paid: string }>('buy-appliance', { id }, true);
export const cookRecipe = (recipeId: string, stoveId: string) => kitchenAct<{ food: string; portions: number; leftovers: number }>('cook', { recipeId, stoveId });
export const eatDish = (foodId: string) => kitchenAct<{ food: string }>('eat-dish', { foodId });
export const freezeDish = (foodId: string, qty: number) => kitchenAct<{ food: string; qty: number }>('freeze-dish', { foodId, qty });

// ---------- Études supérieures ----------
export type StudyKind = 'BT' | 'BTS' | 'LICENCE' | 'MASTER' | 'DOCTORAT';
export interface StudyCycle {
  years: number;
  fee: number;
  sessionsPerYear: number;
}
export interface StudyState {
  venueId: string;
  domains: { id: string; emoji: string; nameFr: string; nameEn: string }[];
  bt: { series: string; domain: string; nameFr: string; nameEn: string }[];
  cycles: Record<StudyKind, StudyCycle>;
  minCorrectBp: number;
  jobReq: Record<string, { min: 'BAC' | StudyKind; domains?: string[]; /** Options alternatives : un seul des diplômes listés suffit. */ or?: { min: 'BAC' | StudyKind; domains?: string[] }[] }>;
  diplomas: { kind: StudyKind; domain: string; series: string | null; obtainedAt: string }[];
  study: null | {
    kind: StudyKind;
    domain: string;
    series: string | null;
    year: number;
    years: number;
    fee: number;
    paid: boolean;
    sessionsDone: number;
    sessions: number;
    correctAnswers: number;
    attendedToday: boolean;
    lesson: null | { textFr: string; textEn: string; qFr: string; qEn: string; choicesFr: string[]; choicesEn: string[] };
  };
}
const studyAct = <R = Record<string, unknown>>(path: string, body?: unknown, paid = false) =>
  api<ActionResponse<R>>(`/study/${path}`, { method: 'POST', body, auth: true, idempotent: paid });
export const getStudy = () => api<StudyState>('/study', { auth: true });
export const studyEnroll = (kind: StudyKind, domain?: string, series?: string) => studyAct<{ fee: number }>('enroll', { kind, ...(domain ? { domain } : {}), ...(series ? { series } : {}) }, true);
export const studyRegister = () => studyAct<{ fee: number }>('register', undefined, true);
export const studyAttend = (choice: number) => studyAct<{ correct: boolean; answer: number; session: number; sessions: number }>('attend', { choice });
export const studyExam = () => studyAct<{ passed: boolean; graduated: boolean; year?: number; kind?: StudyKind; domain?: string }>('exam');
export const studyQuit = () => studyAct<{ quit: boolean }>('quit');

/** Initialisation d'une nouvelle installation (page /init) : état, puis base de données et premier administrateur. */
export const getInitStatus = () => api<{ enabled: boolean; initialized: boolean }>('/init');
export const runInit = (input: { secret: string; username: string; email: string; phone: string; password: string; birthDate: string; locale: 'fr' | 'en' }) =>
  api<{ ok: true }>('/init', { method: 'POST', body: input });

// ---------- Habillement ----------
export interface ClothesShopLine {
  itemId: string;
  qty: number;
  price: number;
}
export interface ClothesRules {
  venues: string[];
  weeklyRent: number;
  maxWeeks: number;
  taxBp: number;
  maxStock: number;
  maxBuy: number;
  wholesaleBp: number;
  maxPriceBp: number;
  closeBuybackBp?: number;
  closeRentRefundBp?: number;
  npcVisitsPerDay?: number;
}
export interface ClothesState {
  items: GarmentDef[];
  rules: ClothesRules;
  female: boolean;
  owned: string[];
  wear: Wear | null;
  /** Boutique de vêtements où l'on se trouve, sinon null. */
  here: string | null;
  shop: null | { id: string; venueId: string; paidUntilDay: number; open: boolean; sales: string; items: ClothesShopLine[]; closeQuote: { buyback: string; refund: string } };
  shops: { id: string; seller: string; items: ClothesShopLine[] }[];
}
const clothesAct = <R = Record<string, unknown>>(path: string, body: unknown, paid = false) =>
  api<ActionResponse<R>>(`/clothes/${path}`, { method: 'POST', body, auth: true, idempotent: paid });
export const getClothes = () => api<ClothesState>('/clothes', { auth: true });
export const buyClothes = (itemId: string) => clothesAct<{ paid: string }>('buy', { itemId }, true);
export const buyClothesFrom = (shopId: string, itemId: string) => clothesAct<{ paid: string }>('buy-from', { shopId, itemId }, true);
export const wearClothes = (w: Wear) => clothesAct<{ wear: Wear | null }>('wear', w);
export const rentClothesShop = (weeks: number) => clothesAct<{ paidUntilDay: number; paid: string }>('shop/rent', { weeks }, true);
export const stockClothesShop = (itemId: string, qty: number) => clothesAct<{ paid: string; unit: number }>('shop/stock', { itemId, qty }, true);
export const closeClothesShop = () => clothesAct<{ closed: boolean; buyback: string; refund: string }>('shop/close', {});
export const priceClothesShop = (itemId: string, price: number) => clothesAct<{ price: number }>('shop/price', { itemId, price });
export const takeFromClothesShop = (itemId: string) => clothesAct('shop/take', { itemId });

// ───────────── Marchés publics (tenders) ─────────────

export interface OpenTender {
  id: string;
  sector: string;
  /** Tous les domaines couverts par le marché (le principal d'abord). */
  sectors?: string[];
  titleFr: string;
  titleEn: string;
  descriptionFr: string;
  descriptionEn: string;
  slots: number;
  /** Plafond annoncé : une candidature proposant plus est refusée. Pas le montant payé (c'est `proposedPrice`). */
  maxBudget: string;
  maxHours: number;
  requiredSessions: number;
  /** Coût réel de réalisation (requiredSessions × coût du secteur) : à regarder AVANT de candidater. */
  realizationCost: string;
  /** Délai minimum physiquement possible (ne peut pas aller plus vite que d'enchaîner les séances). */
  minProposedHours: number;
  applicationDeadlineAt: string;
  applicants: number;
  alreadyApplied: boolean;
}
export interface MyTenderApplication {
  id: string;
  tenderId: string;
  sector: string;
  /** Tous les domaines couverts par le marché (le principal d'abord). */
  sectors?: string[];
  titleFr: string;
  titleEn: string;
  descriptionFr: string;
  descriptionEn: string;
  status: 'PENDING' | 'SELECTED' | 'REJECTED' | 'PAID';
  /** Plafond annoncé par le marché, pas le montant payé (c'est `proposedPrice`). */
  maxBudget: string;
  /** Prix proposé par le candidat : montant exact payé si la candidature est menée à terme. */
  proposedPrice: string;
  proposedHours: number;
  tenderStatus: 'OPEN' | 'AWARDED' | 'CANCELLED';
  sessionsCompleted: number;
  sessionsRequired: number;
  realizationCost: string;
  sessionCost: number;
  shiftGameHours: number;
  startedAt: string | null;
  endsAt: string | null;
  lastAdvancedAt: string | null;
  paidAt: string | null;
}
export const getOpenTenders = () => api<{ sector: string | null; tenders: OpenTender[] }>('/tenders', { auth: true });
export const getMyTenderApplications = () => api<MyTenderApplication[]>('/tenders/mine', { auth: true });
export const applyToTender = (id: string, proposedPrice: number, proposedHours: number) =>
  api<{ id: string; replay?: boolean }>(`/tenders/${encodeURIComponent(id)}/apply`, { method: 'POST', body: { proposedPrice, proposedHours }, auth: true, idempotent: true });
export const advanceTender = (applicationId: string) =>
  api<ActionResponse<{ id: string; sessionsCompleted: number; sessionsRequired: number; paid: boolean; replay?: boolean }>>(`/tenders/applications/${encodeURIComponent(applicationId)}/advance`, { method: 'POST', auth: true, idempotent: true });

export const uploadPartnerLogo = (partnerId: string, blob: Blob) => api<void>(`/admin/partners/${encodeURIComponent(partnerId)}/logo`, { method: 'POST', blob, auth: true });
export const deletePartnerLogo = (partnerId: string) => api<void>(`/admin/partners/${encodeURIComponent(partnerId)}/logo`, { method: 'DELETE', auth: true });

// ---------- Aménagement du logement ----------
export interface FurnitureDef {
  id: string;
  model: string;
  emoji: string;
  nameFr: string;
  nameEn: string;
  price: number;
  w: number;
  d: number;
  comfort: number;
  flat?: boolean;
  /** Pas de rotation possible (le lit). */
  fixed?: boolean;
}
export interface HomeFurnitureView {
  housing: string;
  slots: number;
  room: { w: number; d: number } | null;
  resaleBp: number;
  comfort: number;
  standing: 'MODEST' | 'COMFORTABLE' | 'LUXURIOUS';
  thresholds: { comfortable: number; luxurious: number };
  catalog: FurnitureDef[];
  items: { id: string; itemId: string; x: number; z: number; rot: number; paid: number }[];
  /** Meubles rangés (hors du logement) : à reposer, donner ou revendre. */
  storage: { id: string; itemId: string; paid: number }[];
  storageMax: number;
  /** Les meubles d'origine sont ceux du joueur (la 3D ne dessine plus les siens). */
  custom: boolean;
}
export const getHomeFurniture = () => api<HomeFurnitureView>('/home/furniture', { auth: true });
export const placeFurniture = (itemId: string, x: number, z: number, rot: number) => co<{ id: string | null; paid: string; replay?: boolean }>('/home/furniture', { itemId, x, z, rot }, true);
export const moveFurniture = (id: string, x: number, z: number, rot: number) => api<ActionResponse<{ id: string }>>(`/home/furniture/${id}`, { method: 'PUT', body: { x, z, rot }, auth: true });
export const sellFurniture = (id: string) => api<ActionResponse<{ id: string; received: string }>>(`/home/furniture/${id}`, { method: 'DELETE', auth: true });
export const storeFurniture = (id: string) => co<{ id: string }>(`/home/furniture/${id}/store`);
export const placeStoredFurniture = (id: string, x: number, z: number, rot: number) => co<{ id: string }>(`/home/furniture/${id}/place`, { x, z, rot });
export const giftFurniture = (id: string, to: string) => co<{ id: string; to: string }>(`/home/furniture/${id}/gift`, { to });

// Industrie : usines et zones franches, personnel, investisseurs PNJ, revente
export interface IndustryUnit { unit: number; status: 'FREE' | 'MINE' | 'LISTED' | 'TAKEN'; price: string; plantId: string | null; ask: string | null }
export type IndustryKind = 'FACTORY' | 'FREE_ZONE' | 'FARM' | 'LIVESTOCK';
export interface IndustrySite { id: string; kind: IndustryKind; emoji: string; nameFr: string; nameEn: string; descFr: string; descEn: string; districtFr: string; districtEn: string; price: string; maxStaff: number; wagePerStaff: number; fullNetPerDay: string; buildPrice?: string; buildDays?: number; built?: number; fullReturnBp?: number; startupGameDays?: number; staffCostPerDay?: number; grossWagePerDay?: number; units: IndustryUnit[] }
export interface IndustryOffer { id: string; emoji: string; nameFr: string; nameEn: string; bioFr: string; bioEn: string; maxShareBp: number; valuation: string }
export interface IndustryMine { id: string; catalogId: string; unit: number; paid: string; staff: number; maxStaff: number; netPerDay: string; revenuePerDay?: string; wagesPerDay?: string; companyId?: string | null; companyName?: string | null; equipment?: PlantEquipment; utilityBp?: number; returnBp?: number; demandBp?: number; stockValue?: string; spoilBp?: number; todayBp?: number; yesterdayBp?: number; fixedCostPerDay?: string; readyAt?: string | null; taxDue?: string; taxOverdue?: boolean; players?: IndustryPlayer[]; offers2?: { id: string; roleFr: string; roleEn: string; grossMonthly: number }[]; pending: string; investor: { id: string; emoji: string; nameFr: string; nameEn: string; shareBp: number; buyback: string } | null; ask: string | null; offers: IndustryOffer[] }
export interface PlantEquipment { borehole: boolean; solar: boolean; waterBp: number; powerBp: number; boreholePrice: string; solarPrice: string; boreholeBroken: boolean; solarBroken: boolean; boreholeRepair: string; solarRepair: string; boreholeEffBp: number; solarEffBp: number; boreholeDueIn: number; solarDueIn: number; boreholeService: string; solarService: string }
export interface IndustryPlayer { id: string; name: string; roleFr: string; roleEn: string; grossMonthly: number; unpaidMonths: number }
export interface IndustryView { companies?: { id: string; name: string; status: string }[]; day: number; transferTaxBp: number; otrBp?: number; cfeFee?: number; jobRoles?: { id: string; nameFr: string; nameEn: string; maxGross: number }[]; maxOpenOffers?: number; smig?: number; sites: IndustrySite[]; mine: IndustryMine[] }
export interface IndustryListing { id: string; catalogId: string; emoji: string; nameFr: string; nameEn: string; staff: number; maxStaff: number; ask: string; investorBp: number }
export const getIndustry = () => api<IndustryView>('/industry', { auth: true });
export const getIndustryMarket = () => api<{ listings: IndustryListing[] }>('/industry/market', { auth: true });
export const industryBuy = (companyId: string, catalogId: string, unit: number) => co<{ id: string; paid?: string; replay?: boolean }>('/industry/buy', { companyId, catalogId, unit }, true);
export const industryBuild = (companyId: string, catalogId: string) => co<{ id: string; unit: number; paid?: string; replay?: boolean }>('/industry/build', { companyId, catalogId }, true);
export const industryEquip = (id: string, kind: 'borehole' | 'solar') => co<{ id: string; paid?: string }>(`/industry/${id}/equip`, { kind }, true);
export const industryService = (id: string, kind: 'borehole' | 'solar') => co<{ id: string; paid?: string; repaired?: boolean }>(`/industry/${id}/service`, { kind }, true);
export const industryAttach = (id: string, companyId: string) => co<{ id: string }>(`/industry/${id}/attach`, { companyId });
export const industryStaff = (id: string, staff: number) => co<{ id: string; staff: number }>(`/industry/${id}/staff`, { staff });
export const industryCollect = (id: string) => co<{ id: string; received: string; investorShare: string }>(`/industry/${id}/collect`);
export const industryStake = (id: string, investorId: string, shareBp: number) => co<{ id: string; received: string }>(`/industry/${id}/stake`, { investorId, shareBp });
export const industryBuyback = (id: string) => co<{ id: string; paid: string }>(`/industry/${id}/buyback`);
export const industryList = (id: string, ask: number) => co<{ id: string; ask: string }>(`/industry/${id}/list`, { ask });
export const industryUnlist = (id: string) => co<{ id: string }>(`/industry/${id}/unlist`);
export const industryPostOffer = (id: string, roleId: string, grossMonthly: number) => co<{ offer: string }>(`/industry/${id}/offers`, { roleId, grossMonthly });
export const industryCloseOffer = (offerId: string) => co<{ offer: string }>(`/industry/offers/${offerId}/close`);
export const industryFire = (employeeId: string) => co<{ employee: string }>(`/industry/employees/${employeeId}/fire`);
export const industryClearStock = (id: string, discountBp: number) => co<{ sold: string; proceeds: string }>(`/industry/${id}/clear-stock`, { discountBp });
export const industryPayroll = () => co<{ months: number; net: string; social: string; paid: string }>('/industry/payroll', undefined, true);
export const industryDeclare = () => co<{ tax: string; penalty: string; replay?: boolean }>('/industry/declare', undefined, true);
export const industryBuyListing = (id: string, companyId: string) => co<{ id: string; paid?: string; replay?: boolean }>(`/industry/${id}/buy-listing`, { companyId }, true);
