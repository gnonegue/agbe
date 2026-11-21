// Types du contrat d'API (docs/API.md).

export type Locale = 'fr' | 'en';
export type Profile = 'LOCAL' | 'DIASPORA' | 'FOREIGNER';
export type Region = 'MARITIME' | 'PLATEAUX' | 'CENTRALE' | 'KARA' | 'SAVANES';
export type Condition = 'RICH' | 'MIDDLE' | 'POOR';
export type BirthMode = 'FREE_CHOICE' | 'DESTINY';
export type Housing = 'VILLA' | 'CHAMBRE_SALON' | 'ENTRER_COUCHER';

export interface TokenResponse {
  accessToken: string;
  expiresIn: number;
}
export interface MfaChallenge {
  mfaRequired: true;
  mfaToken: string;
}

export interface Me {
  id: string;
  email: string | null;
  /** Nom d'utilisateur (null pour un invité ou un ancien compte). */
  username?: string | null;
  phone: string | null;
  locale: Locale;
  /** Devise d'affichage des montants (présentation seulement). */
  currency?: 'XOF' | 'EUR' | 'USD';
  role: string;
  totpEnabled: boolean;
  /** Codes de secours 2FA restants (null sans 2FA). */
  backupCodesLeft?: number | null;
  hasCharacter: boolean;
  /** Partie sans compte (invité). */
  guest?: boolean;
  createdAt: string;
}

/** Mode de paiement d'un métier : à chaque service (TASK) ou salaire mensuel après embauche (MONTHLY). */
export type PayMode = 'TASK' | 'MONTHLY';
export interface Job {
  id: string;
  level: string;
  payMode: PayMode;
  nameFr: string;
  nameEn: string;
  payPerShift: number;
  energyCost: number;
  hungerCost: number;
  hygieneCost: number;
  shiftGameHours: number;
  riskPercent: number;
  category: string;
  emoji: string;
  descFr: string;
  descEn: string;
}
export interface Food {
  id: string;
  nameFr: string;
  nameEn: string;
  price: number;
  hunger: number;
  energy: number;
  morale: number;
  health: number;
}
export interface Product {
  id: string;
  kind: 'COINS' | 'PREMIUM';
  nameFr: string;
  nameEn: string;
  priceAmount: number;
  currency: string;
  coinsGranted: number;
}
export interface VenueActivity {
  id: string;
  emoji: string;
  nameFr: string;
  nameEn: string;
  price: number;
  hunger: number;
  energy: number;
  hygiene: number;
  health: number;
  morale: number;
  respect: number;
}
export interface Venue {
  id: string;
  emoji: string;
  nameFr: string;
  nameEn: string;
  districtFr: string;
  districtEn: string;
  descFr: string;
  descEn: string;
  x: number;
  z: number;
  app: string | null;
  /** Ville du lieu ; absent (serveur ancien) = Lomé. */
  city?: string;
  activities: VenueActivity[];
}
export type TransportMode = 'WALK' | 'ZEM' | 'WORO' | 'BUS' | 'CAR' | 'MOTO';
export interface TransportCfg {
  base: number;
  perKm: number;
  roundTo: number;
  energyPerKm: number;
  riskBp: number;
}

export type CompanyForm = 'EI' | 'SARL' | 'SA';
export interface CompanyActivity {
  id: string;
  nameFr: string;
  nameEn: string;
  revenue: number;
  cost: number;
  shiftGameHours: number;
  energyCost: number;
}
export interface Declaration {
  /** Chiffre d'affaires des usines et sites (impôt OTR seulement). */
  plantRevenue?: string;
  fromMonth: number;
  toMonth: number;
  months: number;
  overdueMonths: number;
  revenue: string;
  cnss: string;
  amu: string;
  otr: string;
  penalty: string;
  total: string;
}
export interface CompanyState {
  id: string;
  /** Toutes les entreprises ouvertes du joueur (celle en cours est `id`). */
  companies: { id: string; name: string; activityId: string; status: 'PENDING_CFE' | 'REGISTERED' | 'CLOSED' }[];
  maxCompanies: number;
  /** Prix de rachat si on la vend (FCFA, fixé par le serveur) ; "0" tant qu'elle n'est pas immatriculée. */
  salePrice: string;
  name: string;
  form: CompanyForm;
  activityId: string;
  status: 'PENDING_CFE' | 'REGISTERED' | 'CLOSED';
  readyInGameHours: number;
  rccm: string | null;
  nif: string | null;
  cnssNumber: string | null;
  nextShiftInGameHours: number;
  pendingRevenue: string;
  declaration: Declaration | null;
}
export interface Mission {
  id: string;
  kind: 'ride' | 'delivery' | 'sale' | 'wash' | 'service';
  from?: string;
  to?: string;
  item?: string;
  qty?: number;
  amount: number;
  cost: number;
  status: 'open' | 'done' | 'declined';
}
export interface Shift {
  id: string;
  kind: 'job' | 'company';
  sourceId: string;
  orders: Mission[];
  endsAt: string;
}
export interface Employee {
  id: string;
  name: string;
  roleFr: string;
  roleEn: string;
  grossMonthly: number;
  net: string;
  employerCost: string;
  cnssNumber: string | null;
  cnssDeadlineDay: number;
  late: boolean;
  unpaidMonths: number;
  player: boolean;
}
/** Offre d'emploi publiée par l'entreprise du joueur. */
export interface JobOffer {
  id: string;
  roleFr: string;
  roleEn: string;
  grossMonthly: number;
  net: string;
}
export interface MyOffers {
  offers: JobOffer[];
  roles: { fr: string; en: string }[];
  minGross: number;
  maxGross: number;
  maxOpenOffers: number;
}
/** Offre d'un autre joueur, sur le tableau des offres. */
export interface BoardOffer extends JobOffer {
  company: string;
  activityId: string;
  boss: string;
  /** Emploi chez un employeur public : métier du catalogue, niveau, lieu de travail et services mensuels exigés. */
  publicJobId?: string;
  level?: string;
  venueId?: string | null;
  minShifts?: number;
}
/** Emploi actuel chez un autre joueur. */
export interface PlayerJob {
  id: string;
  company: string;
  boss: string;
  roleFr: string;
  roleEn: string;
  grossMonthly: number;
  net: string;
  cnssNumber: string | null;
  unpaidMonths: number;
  publicJobId?: string | null;
  venueId?: string | null;
  minShifts?: number | null;
}
export interface Candidate {
  id: string;
  name: string;
  roleFr: string;
  roleEn: string;
  grossMonthly: number;
  experienceYears: number;
}

export interface Catalog {
  jobs: Job[];
  foods: Food[];
  products: Product[];
  rent: Record<Housing, number>;
  wash: { price: number; hygieneGain: number };
  transferFee: { rateBp: number; min: number; max: number };
  venues: Venue[];
  homePosition: Record<Housing, { x: number; z: number }>;
  /** Heures d'ouverture par lieu, en heures de jeu. */
  hours: Record<string, [number, number]>;
  workAnyHour: string[];
  /** FCFA pour 1 unité de devise. */
  fx: Record<string, number>;
  transport: Record<Exclude<TransportMode, 'CAR' | 'MOTO'>, TransportCfg> & { CAR?: TransportCfg; MOTO?: TransportCfg };
  company: {
    cfe: { feeEI: number; feeSociety: number; feeSocietyNonEcowas: number; delayGameHours: number };
    capitalMin: Record<CompanyForm, number>;
    contributions: { cnssTnsBp: number; amuTnsMonthly: number; otrBp: number; penaltyBpPerMonth: number; graceDays: number; unregisteredFine: number; maxEmployees: number };
    activities: CompanyActivity[];
  };
  workPlaces: Record<string, string>;
  market: {
    goods: MarketGood[];
    rules: { venues: string[]; weeklyRent: number; maxWeeks: number; taxBp: number; maxStock: number; maxBuy: number; ranks: { id: string; minSales: number }[] };
  };
  /** Vêtements des boutiques : pour dessiner la tenue des joueurs. */
  clothes?: import('../game/kit').GarmentDef[];
  health?: { illnesses: { id: string; nameFr: string; nameEn: string; treatment: number }[]; consultPrice: number };
  family?: { answerDays: number };
  ceremony?: { kinds: Record<'DOT' | 'BAPTEME' | 'FUNERAILLES' | 'ANNIVERSAIRE', { cost: number; respect: number }>; minGift: number; maxGift: number; minDaysAhead: number; maxDaysAhead: number; venues?: string[] };
  hotel?: { venueId: string; partyHall: string; halls: { id: string; daily: number }[] };
  outages?: { generatorPrice: number; solarPrice: number; tankPrice: number };
  intercity?: { enabled?: boolean; cities: { id: string; gare: string; region: Region }[]; routes: { a: string; b: string; price: number; hours: number }[]; energyPerHour: number };
  tontine: { minContribution: number; maxContribution: number; periods: number[]; minMembers: number; maxMembers: number; missRespect: number; maxActive: number; maxDefaultsToJoin: number };
  /** Produit « panneau 7 jours » (argent réel), réservé depuis une affiche. */
  board: Product | null;
  /** Même panneau, annonce fixe sur un panneau choisi (majoré). */
  boardFixed?: Product | null;
}

export interface GameTime {
  day: number;
  hour: number;
  minute: number;
  month: number;
  dayOfMonth: number;
  totalMinutes: number;
}

export interface Needs {
  hunger: number;
  energy: number;
  hygiene: number;
  health: number;
  morale: number;
  respect: number;
}

export interface State {
  id: string;
  name: string;
  profile: Profile;
  region: Region;
  birthCondition: Condition;
  birthMode: BirthMode;
  housing: Housing;
  /** Apparence choisie (null : tirée de l'identifiant). */
  look: import('../game/kit').SavedLook | null;
  /** Maison construite sur le lotissement (sinon position du type de logement). */
  homePos: { x: number; z: number } | null;
  /** Modèle de la maison construite où l'on habite (voir game/houses.ts), sinon null. */
  homeStyle?: string | null;
  /** Lieu actuel : identifiant d'un lieu ou « home ». */
  location: string;
  company: CompanyState | null;
  shift: Shift | null;
  needs: Needs;
  wallet: { balance: string; currency: string };
  job: null | { id: string; nameFr: string; nameEn: string; payPerShift: number; shiftGameHours: number; payMode: PayMode };
  /** Métiers occupés en même temps (le métier actif est `job`). */
  /** Urgence SAMU : prise en charge à l'hôpital (aucune action possible jusqu'à `until`). */
  hospital: null | { until: string; startedAt: string | null; venueId: string };
  /** Facture de soins à régler (urgence), ou null. */
  medicalBill: null | { id: string; amount: number; fullAmount: number; label: string; createdAt: string };
  samu: { callBelowHealth: number; stayGameHours: number; fee: number; hospitalId: string; canCall: boolean };
  jobs: { id: string; nameFr: string; nameEn: string; emoji: string; payPerShift: number; shiftGameHours: number; payMode: PayMode; nextInGameHours: number }[];
  maxJobs: number;
  nextWorkInGameHours: number;
  nextRestInGameHours: number;
  /** Nuit de sommeil en cours (null si éveillé). */
  sleep?: { startedAt: string | null; until: string } | null;
  nextMusicInGameHours: number;
  nextTvInGameHours: number;
  nextReadInGameHours: number;
  hasTv: boolean;
  /** Actes à faire une fois par jour de jeu et déjà faits. */
  doneToday: string[];
  freezer: { owned: boolean; price: number; capacity: number; discountBp: number; used: number; items: { foodId: string; qty: number }[] };
  /** Nuit possible maintenant : durée en heures de jeu (null avant l'heure du coucher). */
  sleepPlan?: { hours: number | null; fromHour: number };
  rent: {
    monthly: number;
    paidUntilGameDay: number;
    overdue: boolean;
    overdueMonths: number;
    /** Prochain versement (pénalité de retard comprise), FCFA. */
    nextPayment: string;
    lateFeeBpPerDay: number;
    overdueDays?: number;
    /** Jours de jeu avant l'expulsion (null : à jour). */
    evictInDays: number | null;
    owned: boolean;
    homeless: boolean;
    debt: string;
    deposit: string;
    price: number;
    offers: { housing: Housing; monthly: number; deposit: number; price: number }[];
  };
  amu: { covered: boolean; paidUntilGameDay: number; monthly: number; coverageBp: number; hospitals: string[] };
  /** Maladie en cours : `id` n'est connu qu'après une consultation (sinon seulement des symptômes). Absent si le serveur n'est pas à jour. */
  illness?: { id: string | null; sinceDay: number | null; diagnosed: boolean } | null;
  familyPending?: number;
  outages?: { power: boolean; water: boolean; powerUntil: string | null; waterUntil: string | null };
  equipment?: { generator: boolean; solar: boolean; waterTank: boolean };
  economy?: { events: string[]; transportBp: number };
  /** Ville actuelle (absent : serveur ancien, Lomé) et trajet en car en cours. */
  city?: string;
  /** Possède une voiture (achetée au port) : peut la conduire. */
  hasCar?: boolean;
  hasMoto?: boolean;
  /** Contrat de moto confiée signé avec un propriétaire, et tarifs de la moto d'une séance de zém (absents : serveur ancien). */
  zemContract?: boolean;
  zemBike?: { gozemFee: number; ownerFee: number; ownKm: number };
  /** Motos et voitures du joueur (carburant, état) ; prix du litre. */
  vehicles: { id: string; kind: 'MOTO' | 'CAR'; modelId: string; nameFr: string; nameEn: string; emoji: string; fuelMl: number; tankMl: number; mlPerKm: number; condition: number; drivable: boolean; serviceDue: boolean }[];
  fuelPricePerL: number;
  trip?: { until: string; to: string; from?: string | null; since?: string | null } | null;
  bills: Record<Bill, { monthly: number; usage?: { showers: number; tariff: number; amount: number }; water?: { litres: number; showerLitres: number; water: number; subscription: number; total: number }; power?: { kwh: number; solarKwh: number; energy: number; subscription: number; total: number; appliances: string[]; appliancesKwh: number; baseKwh: number; cookingKwh: number }; due?: string; daysLate?: number; paidUntilGameDay: number; overdue: boolean; active: boolean }>;
  gameTime: GameTime;
  secondsPerGameDay: number;
}

export interface ActionResponse<R = Record<string, unknown>> {
  result: R;
  state: State;
}

export interface HistoryEntry {
  id: string;
  kind: string;
  memo: string | null;
  amount: string;
  balanceAfter: string;
  at: string;
}

export interface Payroll {
  gross: string;
  cnssEmployee: string;
  amuEmployee: string;
  taxable?: string;
  amuBase?: string;
  irpp: string;
  net: string;
  cnssEmployer: string;
  amuEmployer: string;
  employerCost: string;
  belowSmig: boolean | string;
}

export type PurchaseStatus = 'PENDING' | 'PAID' | 'FAILED' | 'CANCELLED';
export interface Purchase {
  id: string;
  status: PurchaseStatus;
  productId: string;
  amount: number | string;
  currency: string;
  paidAt: string | null;
}

export type Bill = 'ELEC' | 'WATER' | 'WIFI';

/** Tontine vue par un joueur. */
export interface TontineView {
  id: string;
  name: string;
  owner: boolean;
  contribution: string;
  periodDays: number;
  maxMembers: number;
  status: 'FORMING' | 'ACTIVE' | 'FINISHED' | 'CANCELLED';
  member: boolean;
  pot: string;
  round: number | null;
  payoutRound: number;
  deadlineDay: number | null;
  paidThisRound: boolean;
  myTurn: number | null;
  members: { id: string; name: string; me: boolean; left: boolean; turn: number | null; missed: number; paid: boolean }[];
  payouts: { round: number; amount: string; refunded: boolean; toMe: boolean }[];
  membersDefaults?: number;
}
export interface TontineList {
  myDefaults: number;
  mine: TontineView[];
  open: TontineView[];
}

export interface MarketGood {
  id: string;
  emoji: string;
  nameFr: string;
  nameEn: string;
  wholesale: number;
  maxMarkupBp: number;
  effects: Partial<Record<'hunger' | 'energy' | 'hygiene' | 'health' | 'morale' | 'respect', number>>;
}
export interface MarketItem {
  goodId: string;
  qty: number;
  price: number;
}
export interface MyMarket {
  day: number;
  wholesale: Record<string, number>;
  stall: { id: string; venueId: string; paidUntilDay: number; open: boolean; sales: string; rank: { id: string; next: { id: string; minSales: number } | null }; items: MarketItem[] } | null;
  inventory: { goodId: string; qty: number }[];
}
export interface MarketStalls {
  venueId: string;
  stalls: { id: string; seller: string; rank: string; items: MarketItem[] }[];
}

export interface FamilyRequest {
  id: string;
  kind: string;
  amount: string;
  day: number;
  expiresDay: number;
  status: 'PENDING' | 'PAID' | 'REFUSED' | 'EXPIRED';
}
export type CeremonyKind = 'DOT' | 'BAPTEME' | 'FUNERAILLES' | 'ANNIVERSAIRE';
export interface CeremonyList {
  today: number;
  list: { id: string; kind: CeremonyKind; venueId: string; day: number; host: string; mine: boolean; guests: number; attended: boolean; gifts: string | null; canAttend: boolean }[];
}

export interface HotelView {
  day: number;
  venueId: string;
  maxNights: number;
  rooms: { id: string; count: number; nightly: number; comfort: number; free: number }[];
  stay: { id: string; roomType: string; fromDay: number; toDay: number; nightsLeft: number } | null;
  roomService: { id: string; emoji: string; nameFr: string; nameEn: string; price: number; hunger: number; energy: number; morale: number; health: number }[];
  halls: { id: string; capacity: number; daily: number; respect: number; booked: { day: number; mine: boolean }[] }[];
}
