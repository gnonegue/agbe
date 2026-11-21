import { holdFcfa } from '../lib/currency';
import { Fragment, useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { api, apiBlob, ApiError } from '../api/client';
import { errorText } from '../i18n';
import { fcfa } from '../lib/format';
import { HOME, setBrowsingSite } from '../lib/pages';
import PasswordInput from '../ui/PasswordInput';
import { prepareAdImage } from '../lib/image';
import { isWideSetting, SettingFields } from './SettingForm';
import { matches } from '../lib/search';
import { deletePartnerLogo, getBoardSlots, getCatalog, getMe, getPlots, uploadPartnerLogo, type SeaGrid, type SeaPlot, regenerateBackupCodes, totpDisable, totpEnable, totpSetup } from '../api/endpoints';
import { OTP } from '../lib/validate';
import { downloadText } from '../lib/download';
import TotpSetup from '../ui/TotpSetup';
import SearchSelect from '../ui/SearchSelect';
import SearchMulti from '../ui/SearchMulti';
import LogoField from '../ui/LogoField';
import PlotPicker, { type PlotRect } from '../ui/PlotPicker';
import { holdAutoReload } from '../lib/pwaUpdate';

interface Stats {
  accounts: number;
  guests: number;
  newAccounts: number;
  characters: number;
  active: number;
  purchases: number;
  revenue: number | string;
  daily: { day: string; amount: number }[];
  byKind: Record<string, number>;
  moneySupply: string;
  housing: Record<string, number>;
  pendingAds: number;
  liveBoards: number;
  occupancy: { id: string; cells: number; used: number }[];
  education: { studying: number; byKind: Record<string, number> };
  clothes?: { garments: number; owners: number; shopsOpen: number; shopSales: string; top: { itemId: string; n: number; emoji: string; nameFr: string; nameEn: string }[] };
  land: { owners: number; holdings: number; m2: number; titled: number; built: number; listed: number; paid: string; zones: { id: string; nameFr: string; nameEn: string; water?: boolean; holdings: number; soldQuarters: number; totalQuarters: number }[] };
  countries: { code: string; n: number }[];
}
// Icônes au trait (style « Lucide »), dessinées en SVG : nettes à toutes les tailles, sans émojis
const ICONS: Record<string, string> = {
  stats: 'M3 3v18h18M7 15l4-4 3 3 5-6',
  partners: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75',
  products: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8ZM7 7h.01',
  settings: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
  audit: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  reports: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  messages: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2ZM22 6l-10 7L2 6',
  ledger: 'M4 19.5A2.5 2.5 0 0 1 6.5 17H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15ZM20 17v5H6.5A2.5 2.5 0 0 1 4 19.5',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  ban: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20ZM4.9 4.9l14.2 14.2',
  pulse: 'M22 12h-4l-3 9L9 3l-3 9H2',
  wallet: 'M21 12V7H5a2 2 0 0 1 0-4h14v4M3 5v14a2 2 0 0 0 2 2h16v-5M18 12a2 2 0 0 0 0 4h4v-4Z',
  coins: 'M12 2a10 4 0 1 0 0 .01M2 6v6c0 2.2 4.5 4 10 4s10-1.8 10-4V6M2 12v6c0 2.2 4.5 4 10 4s10-1.8 10-4v-6',
  megaphone: 'M3 11l18-5v12L3 13v-2ZM11.6 16.8a3 3 0 1 1-5.8-1.6',
  refresh: 'M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5',
  back: 'M15 18l-6-6 6-6',
  home: 'M3 10.5 12 3l9 7.5M5 9v11h5v-6h4v6h5V9',
  image: 'M21 15l-5-5L5 21M3 3h18v18H3zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3',
  check: 'M20 6 9 17l-5-5',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2Z',
  plus: 'M12 5v14M5 12h14',
  edit: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  star: 'M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1L12 2Z',
  grid: 'M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM21 21l-4.35-4.35',
  key: 'M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4',
  mail: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm18 2l-10 7L2 6',
  tenders: 'M3 21h18M5 21V9l7-6 7 6v12M9 21v-6h6v6M9 10h.01M15 10h.01',
  loans: 'M3 10h18M4 10v10h16V10M12 3 3 10h18L12 3M8 13v4M12 13v4M16 13v4',
  jobs: 'M3 8h18v12H3zM8 8V5a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v3M3 13h18',
};
function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return (
    <svg className="ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

/** Montant compact pour les cartes (1,2 k · 5,07 M), le détail exact reste en infobulle. */
function compact(n: number | string, lang: string): string {
  return new Intl.NumberFormat(lang, { notation: 'compact', maximumFractionDigits: 2 }).format(Number(n));
}

/** Nom du pays dans la langue de l'admin, sans table de traduction : `XX` = IP locale ou hors base. */
function countryName(code: string, lang: string, unknown: string): string {
  if (code === 'XX') return unknown;
  try {
    return new Intl.DisplayNames([lang], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** Courbe des recettes (aire + ligne), axe des montants, réticule et infobulle au survol. */
function RevenueChart({ data, label, lang }: { data: { day: string; amount: number }[]; label: (n: number) => string; lang: string }) {
  const [hover, setHover] = useState<number | null>(null);
  // Dessin à la taille réelle du cadre : textes nets, hauteur fixe quelle que soit la largeur
  const box = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(720);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e!.contentRect.width))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const H = 240, L = 52, R = 12, T = 12, B = 26;
  const every = Math.max(1, Math.round(data.length / Math.max(2, Math.floor(W / 110))));
  const max = Math.max(1, ...data.map((d) => d.amount));
  // Graduation « ronde » de l'axe vertical
  const step = Math.pow(10, Math.floor(Math.log10(max)));
  const top = Math.ceil(max / step) * step;
  const x = (i: number) => L + (i * (W - L - R)) / Math.max(1, data.length - 1);
  const y = (v: number) => T + (H - T - B) * (1 - v / top);
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.amount).toFixed(1)}`).join('');
  const area = `${line}L${x(data.length - 1)},${y(0)}L${x(0)},${y(0)}Z`;
  const day = (s: string) => new Date(s + 'T12:00:00').toLocaleDateString(lang, { day: 'numeric', month: 'short' });
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(data.length - 1, Math.round(((px - L) / (W - L - R)) * (data.length - 1)))));
  };
  const h = hover !== null ? data[hover] : null;
  return (
    <div className="adm-chart" ref={box}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label(data.reduce((a, d) => a + d.amount, 0))} onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        <defs>
          <linearGradient id="admArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="var(--adm-accent)" stopOpacity=".22" />
            <stop offset="1" stopColor="var(--adm-accent)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((k) => (
          <g key={k}>
            <line x1={L} x2={W - R} y1={y(top * k)} y2={y(top * k)} className={k === 0 ? 'base' : 'grid'} />
            <text x={L - 8} y={y(top * k) + 4} textAnchor="end" className="tick">{compact(top * k, lang)}</text>
          </g>
        ))}
        {data.map((d, i) => ((i % every === 0 && data.length - 1 - i >= every * 0.6) || i === data.length - 1) && (
          <text key={d.day} x={x(i)} y={H - 6} textAnchor={i === 0 ? 'start' : i === data.length - 1 ? 'end' : 'middle'} className="tick">{day(d.day)}</text>
        ))}
        <path d={area} fill="url(#admArea)" />
        <path d={line} className="series" />
        {h && hover !== null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={T} y2={y(0)} className="cross" />
            <circle cx={x(hover)} cy={y(h.amount)} r="4.5" className="dot" />
          </g>
        )}
      </svg>
      {h && hover !== null && (
        <div className="adm-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <small>{day(h.day)}</small>
          <strong>{label(h.amount)}</strong>
        </div>
      )}
    </div>
  );
}

/** Ligne libellé + valeur + barre fine (part du maximum). */
function Meter({ label, value, max, text, tone = 'blue' }: { label: string; value: number; max: number; text: string; tone?: string }) {
  const pct = Math.min(100, (value / Math.max(1, max)) * 100);
  return (
    <div className="meter">
      <div className="meter-head"><span>{label}</span><strong>{text}</strong></div>
      <div className="meter-track"><div className={`meter-fill t-${tone}`} style={{ width: `${value > 0 ? Math.max(2, pct) : 0}%` }} /></div>
    </div>
  );
}

function Kpi({ icon, label, value, title, sub }: { icon: string; label: string; value: string; title?: string; sub: string }) {
  return (
    <div className="adm-kpi">
      <div className="adm-kpi-top"><span>{label}</span><i><Icon name={icon} size={16} /></i></div>
      <strong title={title}>{value}</strong>
      <small>{sub}</small>
    </div>
  );
}
interface Partner { id: string; name: string; kind: string; website: string | null; contact: string | null; active: boolean; tier: string; tierEndsAt: string | null; placeLabel: string | null; placeX: number | null; placeZ: number | null; placeColor: string | null; placeModel: string | null; showOnSite: boolean; logo?: string | null; _count: { campaigns: number } }
interface Offer { id: string; partner: { name: string }; kind: string; title: string; place: string; active: boolean; views: number; clicks: number; endsAt: string; happensAt: string | null }
const TIERS = ['NONE', 'BRONZE', 'SILVER', 'GOLD'];
/** Modèles de bâtiments de marque (mêmes identifiants que le serveur et la carte). */
const BRAND_MODELS = ['tower', 'agency', 'restaurant', 'shop', 'station', 'transport', 'clinic', 'hotel'];
interface Campaign { id: string; purchaseId?: string | null; plotX?: number | null; plotY?: number | null; plotW?: number | null; plotH?: number | null; createdAt: string; hasImage?: boolean; partnerId: string; partner: { name: string; contact?: string | null }; slot: number; title: string; subtitle: string; bg: string; fg: string; url: string | null; status: string; views: number; clicks: number; endsAt: string }
/** Compte supprimé encore dans la durée de conservation (identité gardée pour l'administration). */
interface DeletedRow {
  accountId: string; username: string | null; email: string | null; phone: string | null; google: boolean; birthDate: string; characterName: string | null;
  ips: string[]; createdAt: string; deletedAt: string; purgeAt: string; hold: boolean; rejoined: { id: string; username: string | null }[];
}
interface UserRow {
  id: string; username: string | null; email: string | null; phone: string | null; role: 'PLAYER' | 'ADMIN'; guest: boolean; google?: boolean; totpEnabled: boolean;
  createdAt: string; suspendedAt: string | null; lastLogin: string | null; spent: number; locale: string; presence?: 'online' | 'playing' | null;
  character: { name: string; housing: string; respect: number; lastPlayed: string; balance: string } | null;
}
interface AuditRow { id: string; action: string; actorId: string | null; actorName?: string | null; target: string | null; createdAt: string }

const PAGE = 20;
// Onglets des paramètres du jeu (préfixes de clés) ; ce qui n'est rangé nulle part va dans « Autres »
const SETTING_TABS: [string, string[]][] = [
  ['time', ['game.clock', 'needs.decay', 'action.', 'food.', 'activities.']],
  ['start', ['start.', 'destiny.']],
  ['housing', ['rent.', 'bills.', 'housing.', 'land', 'kitchen', 'freezer', 'home.']],
  ['work', ['payroll.', 'work.', 'amu', 'tax.']],
  ['company', ['company.', 'industry']],
  ['money', ['savings', 'banks', 'fx.', 'invest', 'transfer.']],
  ['school', ['school.', 'study']],
  ['ads', ['ad.', 'sea.', 'partners.']],
  ['health', ['health.', 'emergency.']],
  ['social', ['chat', 'tontine', 'family.', 'ceremony.', 'market.', 'clothes.']],
  ['travel', ['transport.', 'vehicles.', 'travel.', 'hotel', 'utilities.', 'economy.']],
  ['city', ['venues.', 'port.']],
];
const settingTab = (k: string) => SETTING_TABS.find(([, ps]) => ps.some((p) => k === p || k.startsWith(p)))?.[0] ?? 'other';
const PRODUCT_ICON: Record<string, string> = { COINS: 'coins', PREMIUM: 'star', AD_BOARD: 'megaphone', AD_PLOT: 'grid' };
const CSTATUS = ['ALL', 'PENDING', 'APPROVED', 'AWAITING_PAYMENT', 'ENDED', 'REJECTED'];
// Emplacement d'une campagne d'après son numéro (voir ad.zones côté serveur)
/** Zone d'annonces à cases correspondant à un emplacement (slot) négatif. */
const SLOT_ZONE: Record<number, string> = { [-2]: 'sea', [-3]: 'east', [-4]: 'lac_ouest', [-5]: 'lac_est', [-6]: 'lac_lions_ouest', [-7]: 'lac_lions_est' };
interface CampGroup { key: string; items: Campaign[] }
/** « 0–9, 12 » pour une liste d'entiers. */
function ranges(nums: number[]): string {
  const a = [...new Set(nums)].sort((x, y) => x - y);
  const out: string[] = [];
  for (let i = 0; i < a.length; ) {
    let j = i;
    while (j + 1 < a.length && a[j + 1] === a[j]! + 1) j++;
    out.push(j > i ? `${a[i]}–${a[j]}` : `${a[i]}`);
    i = j + 1;
  }
  return out.join(', ');
}
const placeOf = (slot: number) => (slot >= -1 ? 'board' : ({ [-2]: 'sea', [-3]: 'east', [-4]: 'lac_ouest', [-5]: 'lac_est', [-6]: 'lac_lions_ouest', [-7]: 'lac_lions_est' } as Record<number, string>)[slot] ?? 'zone');

interface Period { from: string; to: string }
const iso = (d: Date) => d.toISOString().slice(0, 10);
function lastDays(n: number): Period {
  const to = new Date();
  return { from: iso(new Date(to.getTime() - (n - 1) * 86_400_000)), to: iso(to) };
}
const PRESETS = [7, 30, 90, 365];

/** Choix de la période : raccourcis (7 j, 30 j, 90 j, 12 mois) ou dates libres. */
function PeriodPicker({ value, onChange }: { value: Period; onChange: (p: Period) => void }) {
  const { t } = useTranslation();
  const preset = PRESETS.find((n) => { const p = lastDays(n); return p.from === value.from && p.to === value.to; });
  return (
    <div className="adm-period">
      <Icon name="calendar" size={16} />
      <div className="adm-chips">
        {PRESETS.map((n) => (
          <button key={n} className={preset === n ? 'on' : ''} onClick={() => onChange(lastDays(n))}>{t(`admin.period.p${n}`)}</button>
        ))}
      </div>
      <label className="adm-dates">
        <input type="date" value={value.from} max={value.to} onChange={(e) => e.target.value && onChange({ ...value, from: e.target.value })} aria-label={t('admin.period.from')} />
        <span>→</span>
        <input type="date" value={value.to} min={value.from} max={iso(new Date())} onChange={(e) => e.target.value && onChange({ ...value, to: e.target.value })} aria-label={t('admin.period.to')} />
      </label>
    </div>
  );
}

function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { t } = useTranslation();
  return (
    <label className="adm-search">
      <Icon name="search" size={16} />
      <input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder ?? t('admin.search')} />
    </label>
  );
}

type Tab = 'stats' | 'users' | 'partners' | 'jobs' | 'products' | 'tenders' | 'loans' | 'settings' | 'audit' | 'ledger' | 'reports' | 'messages';
/** Message du formulaire de contact du site, avec les réponses de l'équipe. */
interface ContactRow {
  id: string; name: string; company: string | null; whatsapp: string; email: string | null; topic: string; message: string; locale: string; context: string | null;
  status: 'NEW' | 'READ' | 'DONE'; createdAt: string;
  replies: { id: string; channel: 'email' | 'whatsapp'; text: string; createdAt: string }[];
}
interface ReportRow {
  id: string;
  reason: string;
  createdAt: string;
  reporter: { id: string; name: string };
  target: { id: string; name: string; mutedUntil: string | null; reportsTotal: number };
  message: { id: string; text: string; room: string; hidden: boolean; createdAt: string } | null;
}
interface ProductRow { id: string; kind: string; nameFr: string; nameEn: string; priceAmount: number; currency: string; coinsGranted: number; active: boolean }
const KINDS = ['BRAND', 'SCHOOL', 'ARTIST', 'PROMOTER', 'INSTITUTION'];
interface TenderRow { id: string; sector: string; sectors?: string[]; titleFr: string; titleEn: string; descriptionFr: string; descriptionEn: string; slots: number; maxBudget: string; maxHours: number; requiredSessions: number; status: 'OPEN' | 'AWARDED' | 'CANCELLED'; applicationDeadlineAt: string; createdByAdminId: string | null; applicants: number; createdAt: string }
interface TenderApplicationRow { id: string; company: string; sector: string; titleFr: string; titleEn: string; descriptionFr: string; descriptionEn: string; proposedPrice: string; proposedHours: number; status: 'PENDING' | 'SELECTED' | 'REJECTED' | 'PAID'; score: number; sessionsCompleted: number; sessionsRequired: number; startedAt: string | null; endsAt: string | null; paidAt: string | null }
/** Prêt bancaire personnel, vu en lecture seule côté admin (aucun mouvement d'argent déclenché depuis ce panneau). */
interface JobOfferRow { id: string; kind: 'PUBLIC' | 'PLAYER'; roleFr: string; roleEn: string; level: string | null; venueId: string | null; venueFr: string | null; venueEn: string | null; company: string; boss: string; gross: number; net: string; open: boolean; employed: number; createdAt: string | null }
interface JobCatalogRow { id: string; level: string; nameFr: string; nameEn: string; payPerShift: number; energyCost: number; hungerCost: number; hygieneCost: number; shiftGameHours: number; riskPercent: number; category: string; emoji: string; descFr: string; descEn: string; enabled: boolean; venueId: string | null; reqs: { min: string; domains?: string[] }[] }
interface JobsView { config: { enabled: boolean; minShifts: number; bands: Record<string, { min: number; max: number }> }; offers: JobOfferRow[]; catalog: JobCatalogRow[]; domains: { id: string; emoji: string; nameFr: string; nameEn: string }[]; rules: { minGross: number; maxGross: number } }
/** Formulaire de modification d'un emploi : métier du catalogue (existant ou nouveau) ou offre d'un joueur. */
type JobEdit = { kind: 'job'; isNew: boolean; f: JobCatalogRow } | { kind: 'offer'; id: string; company: string; f: { roleFr: string; roleEn: string; grossMonthly: number } }
const NEW_JOB: JobCatalogRow = { id: '', level: 'DEBROUILLE', nameFr: '', nameEn: '', payPerShift: 2_500, energyCost: 10, hungerCost: 8, hygieneCost: 5, shiftGameHours: 4, riskPercent: 0, category: 'services', emoji: '💼', descFr: '', descEn: '', enabled: true, venueId: null, reqs: [] }
interface LoanRow {
  id: string; character: string; account: string; principal: string; rateBp: number; remaining: string; installmentAmount: string;
  nextDueGameDay: number; lateSinceGameDay: number | null; totalPenaltyPaid: string; status: 'OPEN' | 'LATE' | 'CLOSED';
  createdGameDay: number; createdAt: string; closedAt: string | null;
}

/** Back-office du concepteur : statistiques, partenaires et panneaux, paramètres du jeu, audit, grand livre. */
export default function AdminScreen({ onExit }: { onExit: () => void }) {
  const { t, i18n } = useTranslation();
  // L'administration lit toujours les montants en FCFA (posé avant le premier rendu, levé à la sortie)
  holdFcfa(true);
  // Nouvelle version en ligne : pas de rechargement surprise ici, seulement le bandeau « Mettre à jour »
  useEffect(() => holdAutoReload(), []);
  useEffect(() => () => holdFcfa(false), []);
  const [tab, setTab] = useState<Tab>('stats');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats | null>(null);
  const [partners, setPartners] = useState<Partner[]>([]);
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [settings, setSettings] = useState<Record<string, unknown>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [products, setProducts] = useState<ProductRow[]>([]);
  const [savedProducts, setSavedProducts] = useState<ProductRow[]>([]);
  const [np, setNp] = useState({ nameFr: '', nameEn: '', priceAmount: 2000, coinsGranted: 2000 });
  const [ledger, setLedger] = useState<unknown>(null);
  const [tenders, setTenders] = useState<TenderRow[]>([]);
  const [tenderApps, setTenderApps] = useState<Record<string, TenderApplicationRow[]>>({});
  const [openTenderApps, setOpenTenderApps] = useState<string | null>(null);
  const [tf, setTf] = useState<{ sector: string; sectors: string[]; titleFr: string; titleEn: string; descriptionFr: string; descriptionEn: string; slots: number; maxBudget: number; maxHours: number; requiredSessions: number; applicationWindowGameHours: number }>({ sector: 'pagnes', sectors: [], titleFr: '', titleEn: '', descriptionFr: '', descriptionEn: '', slots: 2, maxBudget: 500_000, maxHours: 48, requiredSessions: 5, applicationWindowGameHours: 24 });
  const [loans, setLoans] = useState<LoanRow[]>([]);
  /** Panneau choisi en modification (changer l'annonce de panneau, s'il est libre). */
  const [editSlot, setEditSlot] = useState<number | null>(null);
  const [jobsView, setJobsView] = useState<JobsView | null>(null);
  const [jobEdit, setJobEdit] = useState<JobEdit | null>(null);
  const [venueList, setVenueList] = useState<{ id: string; nameFr: string; nameEn: string }[]>([]);
  /** Mobile : le menu plein écran qui liste toutes les rubriques. */
  const [menuOpen, setMenuOpen] = useState(false);
  const [jobsKind, setJobsKind] = useState<'ALL' | 'PUBLIC' | 'PLAYER'>('ALL');
  const [jobsLevel, setJobsLevel] = useState('ALL');
  const [reports, setReports] = useState<ReportRow[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [unread, setUnread] = useState(0);
  const [contactView, setContactView] = useState<'open' | 'all'>('open');
  const [msgAll, setMsgAll] = useState(false);
  const [msgSel, setMsgSel] = useState<string | null>(null);
  const [msgQ, setMsgQ] = useState('');
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [p, setP] = useState({ name: '', kind: 'BRAND', website: '', contact: '' });
  const [offers, setOffers] = useState<Offer[]>([]);
  const [o, setO] = useState({ partnerId: '', kind: 'EVENT', title: '', body: '', place: '', url: '', happensAt: '', days: 30 });
  const [tierEdit, setTierEdit] = useState<{ id: string; tier: string; months: number; placeLabel: string; placeSpot: string; placeModel: string; placeColor: string; name: string; kind: string; website: string; contact: string } | null>(null);
  // Emplacements des lieux de marque (choix dans une liste, jamais de coordonnées à taper)
  const [spots, setSpots] = useState<{ id: string; nameFr: string; nameEn: string; x: number; z: number; takenBy: { id: string; name: string } | null }[]>([]);
  // Demandes d'espace VIP (Argent et Or) à valider
  type SpotReq = { id: string; spotId: string; spotNameFr: string; spotNameEn: string; tier: 'GOLD' | 'SILVER' | 'BRONZE'; name: string; company: string | null; whatsapp: string; email: string | null; message: string; createdAt: string; takenBy: { id: string; name: string } | null };
  const [spotReqs, setSpotReqs] = useState<SpotReq[]>([]);
  const [reqMonths, setReqMonths] = useState<Record<string, number>>({});
  const [per, setPer] = useState<Period>(() => lastDays(30));
  const [users, setUsers] = useState<{ total: number; pageSize: number; items: UserRow[] } | null>(null);
  const [deleted, setDeleted] = useState<{ total: number; pageSize: number; items: DeletedRow[] } | null>(null);
  const [uKind, setUKind] = useState('all');
  const [uAll, setUAll] = useState(false);
  const [sel, setSel] = useState<UserRow | null>(null);
  const [reason, setReason] = useState('');
  const [pwAsk, setPwAsk] = useState(false);
  const [newPw, setNewPw] = useState<string | null>(null);
  const [pwCopied, setPwCopied] = useState(false);
  // Mot de passe choisi par l'admin (au lieu du temporaire généré par le serveur)
  const [customPw, setCustomPw] = useState('');
  // Outil support : ajuste le solde d'un joueur (crédit ou débit)
  const [adjustAmount, setAdjustAmount] = useState(100_000);
  // Double authentification du compte admin courant : en production, les routes admin l'exigent (voir RolesGuard).
  // Lu indépendamment des autres appels (toujours accessible même quand le reste de la page est bloqué par mfa_required).
  const [totpEnabled, setTotpEnabled] = useState<boolean | null>(null);
  const [totpOpen, setTotpOpen] = useState(false);
  const [totpBusy, setTotpBusy] = useState(false);
  const [totpPassword, setTotpPassword] = useState('');
  const [totp, setTotp] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpError, setTotpError] = useState<string | null>(null);
  // Codes de secours (téléphone perdu) : montrés une seule fois, à l'activation ou après régénération.
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  const [backupOpen, setBackupOpen] = useState(false);
  const [backupPassword, setBackupPassword] = useState('');
  const [backupError, setBackupError] = useState<string | null>(null);
  // Désactivation volontaire de la 2FA.
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableError, setDisableError] = useState<string | null>(null);

  useEffect(() => {
    void getMe().then((me) => setTotpEnabled(me.totpEnabled)).catch(() => {});
  }, []);

  async function doTotpSetup(ev: FormEvent) {
    ev.preventDefault();
    setTotpError(null);
    if (totpPassword.length < 1 || totpPassword.length > 128) return setTotpError(t('auth.invalid.password'));
    setTotpBusy(true);
    try {
      setTotp(await totpSetup(totpPassword));
    } catch (e) {
      setTotpError(errorText(e instanceof ApiError ? e.code : 'unknown'));
    } finally {
      setTotpBusy(false);
      setTotpPassword('');
    }
  }

  async function doTotpEnable(ev: FormEvent) {
    ev.preventDefault();
    setTotpError(null);
    if (!OTP.test(totpCode)) return setTotpError(t('auth.invalid.code'));
    setTotpBusy(true);
    try {
      const r = await totpEnable(totpCode);
      setTotp(null);
      setTotpOpen(false);
      setTotpEnabled(true);
      // Toutes les sessions viennent d'être révoquées par le serveur : on montre d'abord les codes de secours
      // (une seule fois), puis « J'ai noté mes codes » recharge la page vers l'écran de connexion.
      setBackupCodes(r.backupCodes);
    } catch (e) {
      setTotpError(errorText(e instanceof ApiError ? e.code : 'unknown'));
    } finally {
      setTotpBusy(false);
      setTotpCode('');
    }
  }

  async function doRegenerateBackupCodes(ev: FormEvent) {
    ev.preventDefault();
    setBackupError(null);
    if (backupPassword.length < 1 || backupPassword.length > 128) return setBackupError(t('auth.invalid.password'));
    setTotpBusy(true);
    try {
      const r = await regenerateBackupCodes(backupPassword);
      setBackupOpen(false);
      setBackupCodes(r.backupCodes);
    } catch (e) {
      setBackupError(errorText(e instanceof ApiError ? e.code : 'unknown'));
    } finally {
      setTotpBusy(false);
      setBackupPassword('');
    }
  }

  // Désactivation volontaire : toutes les sessions sont révoquées par le serveur (y compris celle-ci) → rechargement.
  async function doTotpDisable(ev: FormEvent) {
    ev.preventDefault();
    setDisableError(null);
    if (disablePassword.length < 1 || disablePassword.length > 128) return setDisableError(t('auth.invalid.password'));
    setTotpBusy(true);
    try {
      await totpDisable(disablePassword);
      window.location.reload();
    } catch (e) {
      setDisableError(errorText(e instanceof ApiError ? e.code : 'unknown'));
      setTotpBusy(false);
      setDisablePassword('');
    }
  }
  const [sTab, setSTab] = useState('time');
  const [aKind, setAKind] = useState('all');
  const [sub, setSub] = useState<'partners' | 'campaigns' | 'offers' | 'vip'>('campaigns');
  const [openForm, setOpenForm] = useState(false);
  const [q, setQ] = useState('');
  const [cStatus, setCStatus] = useState<string>('ALL');
  const [cPlace, setCPlace] = useState('ALL');
  const [page, setPage] = useState(0);
  useEffect(() => setPage(0), [q, sub]);
  const [cImg, setCImg] = useState<Blob | null>(null);
  const [cImgUrl, setCImgUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!cImg) return setCImgUrl(null);
    const u = URL.createObjectURL(cImg);
    setCImgUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [cImg]);
  const pickImage = async (f: File) => {
    try {
      setCImg(await prepareAdImage(f));
    } catch {
      setError(errorText('invalid_image'));
    }
  };
  /** Panneaux visés par la nouvelle campagne : « all » (tous) ou des numéros ; une campagne est créée par panneau. */
  const [cSlots, setCSlots] = useState<string[]>([]);
  const [boardCount, setBoardCount] = useState(24);
  /** Espaces visés (plusieurs possibles) : « board » (panneaux de la ville), « sea », « east » ou un lac : annonce posée sur des cases, avec image. */
  const [cZones, setCZones] = useState<string[]>(['board']);
  /** Rectangle de cases choisi pour chaque espace à cases (mer, est, lacs). */
  const [cRects, setCRects] = useState<Record<string, PlotRect>>({});
  const rectOf = (z: string): PlotRect => cRects[z] ?? { x: 0, y: 0, w: 2, h: 2 };
  /** Attribution d'un espace VIP libre depuis l'onglet Espaces VIP : partenaire existant (ou nouveau), durée et bâtiment. */
  const [assign, setAssign] = useState<{ spotId: string; tier: 'GOLD' | 'SILVER' | 'BRONZE'; partnerId: string; newName: string; months: number; placeLabel: string; placeModel: string; placeColor: string } | null>(null);
  /** Logo choisi dans le formulaire ouvert : image prête, null = inchangé, 'remove' = à retirer. */
  const [logoSel, setLogoSel] = useState<Blob | null | 'remove'>(null);
  /** Prix mensuels en cours de saisie (formules VIP) ; vide = valeur enregistrée. */
  const [tierPrices, setTierPrices] = useState<Record<string, string>>({});
  /** Onglet interne de « Espaces VIP » : les espaces et leurs demandes, ou les formules et tarifs. */
  const [vipView, setVipView] = useState<'spaces' | 'tariffs'>('spaces');
  const [vTier, setVTier] = useState<'ALL' | 'GOLD' | 'SILVER' | 'BRONZE'>('ALL');
  const [vState, setVState] = useState<'ALL' | 'FREE' | 'PENDING' | 'TAKEN'>('ALL');
  /** Création d'un partenaire sans quitter le formulaire de campagne. */
  const [qp, setQp] = useState<{ name: string; kind: string } | null>(null);
  const [zonesData, setZonesData] = useState<Record<string, { grid: SeaGrid; plots: SeaPlot[] }>>({});
  useEffect(() => {
    if (!cZones.some((z) => z !== 'board')) return;
    void getPlots()
      .then((r) => setZonesData({ sea: { grid: r.grid, plots: r.plots }, ...Object.fromEntries((r.zones ?? []).map((z) => [z.id, { grid: z.grid, plots: z.plots }])) }))
      .catch(() => undefined);
  }, [cZones]);
  useEffect(() => {
    void getBoardSlots().then((r) => setBoardCount(r.count)).catch(() => undefined);
  }, []);
  const [c, setC] = useState({ partnerId: '', slot: -1, title: '', subtitle: '', bg: '#0a7d4f', fg: '#ffffff', url: '', days: 30 });
  // Campagne en cours de modification ; days = 0 garde la date de fin, sinon la repousse (et relance une campagne terminée)
  /** Campagne en cours de modification (toutes ses lignes) : le formulaire de création sert aussi à la modifier. */
  const [cGroup, setCGroup] = useState<Campaign[] | null>(null);
  /** Cases en cours de modification, par ligne de campagne (annonces en mer, sur les lacs, à l'est). */
  const [cRows, setCRows] = useState<Record<string, PlotRect>>({});
  /** Durée (jours) propre à chaque emplacement choisi ; sans valeur, celle de « même durée pour tous » (0 = garder la fin en modification). */
  const [cDays, setCDays] = useState<Record<string, number>>({});
  const keyOfSlot = (slot: number) => (slot === -1 ? 'b:all' : slot >= 0 ? `b:${slot}` : `z:${SLOT_ZONE[slot] ?? ''}`);
  const daysFor = (k: string) => cDays[k] ?? c.days;

  /** Dernière erreur affichée : le rechargement de la liste après un échec d'enregistrement ne doit pas l'effacer. */
  const errRef = useRef<string | null>(null);
  const call = useCallback(async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    errRef.current = null;
    setError(null);
    // La confirmation n'est pas effacée ici : le rechargement de la liste qui suit un enregistrement passe aussi par `call`
    try {
      return await fn();
    } catch (e) {
      const m = errorText(e instanceof ApiError ? e.code : 'unknown');
      errRef.current = m;
      setError(m);
      setNotice(null); // un ancien « Enregistré » ne reste pas affiché à côté d'une nouvelle erreur
      return null;
    }
  }, []);

  // La confirmation disparaît d'elle-même ; l'erreur reste jusqu'à la prochaine action ou à sa fermeture
  useEffect(() => {
    if (!notice) return;
    const id = window.setTimeout(() => setNotice(null), 4500);
    return () => window.clearTimeout(id);
  }, [notice]);

  const load = useCallback(async () => {
    if (tab === 'stats') {
      const [st, cs] = await Promise.all([call(() => api<Stats>(`/admin/stats?from=${per.from}&to=${per.to}`, { auth: true })), call(() => api<Campaign[]>('/admin/campaigns', { auth: true }))]);
      setStats(st);
      if (cs) setCampaigns(cs);
    }
    if (tab === 'partners') {
      const [ps, cs, os] = await Promise.all([
        call(() => api<Partner[]>('/admin/partners', { auth: true })),
        call(() => api<Campaign[]>('/admin/campaigns', { auth: true })),
        call(() => api<Offer[]>('/admin/offers', { auth: true })),
      ]);
      if (ps) setPartners(ps);
      const sp = await call(() => api<typeof spots>('/admin/partners/spots', { auth: true }));
      if (sp) setSpots(sp);
      const rq = await call(() => api<SpotReq[]>('/admin/spot-requests', { auth: true }));
      if (rq) setSpotReqs(rq);
      if (cs) setCampaigns(cs);
      if (os) setOffers(os);
    }
    if (tab === 'users') {
      const qs = new URLSearchParams({ kind: uKind, page: String(page) });
      if (q.trim()) qs.set('q', q.trim());
      if (!uAll) { qs.set('from', per.from); qs.set('to', per.to); }
      if (uKind === 'deleted') {
        const r = await call(() => api<{ total: number; pageSize: number; items: DeletedRow[] }>(`/admin/users?${qs}`, { auth: true }));
        if (r) setDeleted(r);
      } else {
        const r = await call(() => api<{ total: number; pageSize: number; items: UserRow[] }>(`/admin/users?${qs}`, { auth: true }));
        if (r) setUsers(r);
      }
    }
    if (tab === 'settings') {
      const s = await call(() => api<Record<string, unknown>>('/admin/settings', { auth: true }));
      if (s) {
        setSettings(s);
        setDrafts(Object.fromEntries(Object.entries(s).map(([k, v]) => [k, JSON.stringify(v, null, 2)])));
      }
    }
    if (tab === 'products') {
      const list = (await call(() => api<ProductRow[]>('/admin/products', { auth: true }))) ?? [];
      setProducts(list);
      setSavedProducts(list);
    }
    if (tab === 'audit') setAudit((await call(() => api<AuditRow[]>(`/admin/audit?limit=500&from=${per.from}&to=${per.to}`, { auth: true }))) ?? []);
    if (tab === 'reports') setReports((await call(() => api<ReportRow[]>('/admin/reports', { auth: true }))) ?? []);
    if (tab === 'messages') {
      const r = await call(() => api<{ unread: number; messages: ContactRow[] }>(`/admin/contact?view=${contactView}${msgAll ? '' : `&from=${per.from}&to=${per.to}`}${msgQ.trim() ? `&q=${encodeURIComponent(msgQ.trim())}` : ''}`, { auth: true }));
      if (r) {
        setContacts(r.messages);
        setUnread(r.unread);
      }
    }
    if (tab === 'partners' && !settings['partners.tiers']) {
      const st = await call(() => api<Record<string, unknown>>('/admin/settings', { auth: true }));
      if (st) setSettings((cur) => ({ ...cur, ...st }));
    }
    if (tab === 'ledger') setLedger(await call(() => api<unknown>('/admin/ledger/verify', { auth: true })));
    if (tab === 'jobs') {
      setJobsView(await call(() => api<JobsView>('/admin/jobs', { auth: true })));
      if (venueList.length === 0) void getCatalog().then((c) => setVenueList(c.venues.map((v) => ({ id: v.id, nameFr: v.nameFr, nameEn: v.nameEn })))).catch(() => undefined);
    }
    if (tab === 'loans') setLoans((await call(() => api<LoanRow[]>('/admin/loans', { auth: true }))) ?? []);
    if (tab === 'tenders') {
      setTenders((await call(() => api<TenderRow[]>('/admin/tenders', { auth: true }))) ?? []);
      if (!settings['company.activities']) {
        const s = await call(() => api<Record<string, unknown>>('/admin/settings', { auth: true }));
        if (s) setSettings(s);
      }
    }
  }, [tab, call, per, uKind, uAll, page, contactView, msgAll, tab === 'users' ? q : '', tab === 'messages' ? msgQ : '']);
  // « En ligne » et « En train de jouer » changent à chaque seconde : la liste se rafraîchit toute seule
  useEffect(() => {
    if (tab !== 'users' || (uKind !== 'online' && uKind !== 'playing')) return;
    const id = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(id);
  }, [tab, uKind]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void load();
  }, [load]);

  async function quickPartner() {
    if (!qp || qp.name.trim().length < 2) return;
    const r = await call(() => api<{ id: string }>('/admin/partners', { method: 'POST', auth: true, body: { name: qp.name.trim(), kind: qp.kind } }));
    if (r) {
      setC((cur) => ({ ...cur, partnerId: r.id }));
      setQp(null);
      void load();
    }
  }

  async function addPartner(ev: FormEvent) {
    ev.preventDefault();
    const r = await call(() => api('/admin/partners', { method: 'POST', auth: true, body: { ...p, website: p.website || undefined, contact: p.contact || undefined } }));
    if (r) {
      setP({ name: '', kind: 'BRAND', website: '', contact: '' });
      setNotice(t('admin.saved'));
      void load();
    }
  }

  const closeUser = () => {
    setSel(null);
    setReason('');
    setPwAsk(false);
    setNewPw(null);
    setPwCopied(false);
    setCustomPw('');
  };

  const userAction = async (x: UserRow, path: string, body?: object) => {
    if (await call(() => api(`/admin/users/${x.id}/${path}`, { method: 'POST', auth: true, body }))) {
      setNotice(t('admin.saved'));
      closeUser();
      void load();
    }
  };

  const resetPassword = async (x: UserRow) => {
    const r = await call(() => api<{ password: string }>(`/admin/users/${x.id}/password`, { method: 'POST', auth: true, body: { confirm: 'RESET' } }));
    if (r?.password) {
      setNewPw(r.password);
      setPwAsk(false);
      setPwCopied(false);
      setNotice(t('admin.saved'));
      void load();
    }
  };

  const sendResetLink = async (x: UserRow) => {
    const r = await call(() => api<{ sent: boolean }>(`/admin/users/${x.id}/reset-link`, { method: 'POST', auth: true }));
    if (r) {
      if (r.sent) setNotice(t('admin.users.resetLinkSent', { email: x.email ?? '' }));
      else setError(t('admin.users.resetLinkNotSent'));
    }
  };

  const copyPassword = async (password: string) => {
    try {
      await navigator.clipboard.writeText(password);
      setPwCopied(true);
    } catch {
      setPwCopied(false);
    }
  };

  async function addProduct(ev: FormEvent) {
    ev.preventDefault();
    // Identifiant technique tiré du nom (coins_2000_ab12…)
    const id = `coins_${np.priceAmount}_${Math.random().toString(36).slice(2, 6)}`.slice(0, 32);
    if (await call(() => api('/admin/products', { method: 'POST', auth: true, body: { id, ...np, nameFr: np.nameFr.trim(), nameEn: np.nameEn.trim() } }))) {
      setNp({ nameFr: '', nameEn: '', priceAmount: 2000, coinsGranted: 2000 });
      setOpenForm(false);
      setNotice(t('admin.saved'));
      void load();
    }
  }

  /** Prépare le formulaire de création avec les réglages d'une campagne existante (tous ses emplacements). */
  function startEdit(g: CampGroup) {
    const x = g.items[0]!;
    const boards = g.items.filter((i) => i.slot >= -1);
    setC({ partnerId: x.partnerId, slot: -1, title: x.title, subtitle: x.subtitle, bg: x.bg, fg: x.fg, url: x.url ?? '', days: 0 });
    setCZones([...(boards.length ? ['board'] : []), ...new Set(g.items.filter((i) => i.slot < -1).map((i) => SLOT_ZONE[i.slot] ?? '').filter(Boolean))]);
    setCSlots(boards.some((i) => i.slot === -1) ? ['all'] : boards.map((i) => String(i.slot)));
    setCImg(null);
    setCDays({});
    setEditSlot(g.items.length === 1 && g.items[0]!.slot >= -1 ? g.items[0]!.slot : null);
    setCRows(Object.fromEntries(g.items.filter((i) => i.slot < -1 && i.plotW).map((i) => [i.id, { x: i.plotX ?? 0, y: i.plotY ?? 0, w: i.plotW ?? 1, h: i.plotH ?? 1 }])));
    setCGroup(g.items);
    setOpenForm(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
  /** Enregistre un emploi modifié ou créé (métier du catalogue ou offre d'un joueur), puis revient à la liste. */
  async function saveJob() {
    if (!jobEdit) return;
    const ok = jobEdit.kind === 'offer'
      ? await call(() => api(`/admin/jobs/offers/${jobEdit.id}`, { method: 'PATCH', auth: true, body: jobEdit.f }))
      : await call(() => {
          const { id, venueId, ...rest } = jobEdit.f;
          const body = { ...rest, venueId, reqs: rest.level === 'DEBROUILLE' ? [] : rest.reqs };
          return jobEdit.isNew ? api('/admin/jobs/catalog', { method: 'POST', auth: true, body: { id, ...body, venueId: venueId || undefined } }) : api(`/admin/jobs/catalog/${id}`, { method: 'PATCH', auth: true, body });
        });
    if (ok) {
      setNotice(t('admin.saved'));
      setJobEdit(null);
      void load();
    }
  }
  async function withdrawOffer(id: string) {
    if (!window.confirm(t('admin.jobs.confirmWithdraw'))) return;
    if (await call(() => api(`/admin/jobs/offers/${id}`, { method: 'DELETE', auth: true }))) {
      setNotice(t('admin.jobs.withdrawn'));
      setJobEdit(null);
      void load();
    }
  }
  /** Enregistre les modifications : réglages communs, emplacements ajoutés (créés) ou retirés (arrêtés), image. */
  async function saveGroup() {
    if (!cGroup) return;
    const wantBoards = cZones.includes('board');
    const wantSlots = new Set<number>(wantBoards ? (cSlots.includes('all') ? [-1] : cSlots.map(Number)) : []);
    const wantPlots = new Set(cZones.filter((z) => z !== 'board'));
    const keep: Campaign[] = [];
    const drop: Campaign[] = [];
    for (const it of cGroup) (it.slot >= -1 ? wantSlots.has(it.slot) : wantPlots.has(SLOT_ZONE[it.slot] ?? '') ? true : false) ? keep.push(it) : drop.push(it);
    const remaining = Math.max(1, Math.ceil((Math.max(...cGroup.map((i) => +new Date(i.endsAt))) - Date.now()) / 86_400_000));
    const days = c.days > 0 ? c.days : remaining;
    // Image des nouveaux emplacements : celle qu'on vient de choisir, sinon celle de la campagne
    let blob: Blob | null = cImg;
    const withImage = cGroup.find((i) => i.hasImage);
    if (!blob && withImage) blob = (await call(() => apiBlob(`/admin/campaigns/${withImage.id}/image`))) ?? null;
    let failed = false;
    for (const it of keep) {
      const r = cRows[it.id];
      const moved = !!r && (r.x !== it.plotX || r.y !== it.plotY || r.w !== it.plotW || r.h !== it.plotH);
      const itDays = daysFor(keyOfSlot(it.slot));
      const body = { ...(editSlot !== null && it.slot >= -1 && editSlot !== it.slot ? { slot: editSlot } : {}), ...(c.partnerId && c.partnerId !== it.partnerId ? { partnerId: c.partnerId } : {}), title: c.title, subtitle: c.subtitle, bg: c.bg, fg: c.fg, url: c.url || undefined, ...(itDays > 0 ? { days: itDays } : {}), ...(moved ? { plotX: r!.x, plotY: r!.y, plotW: r!.w, plotH: r!.h } : {}) };
      if (!(await call(() => api(`/admin/campaigns/${it.id}`, { method: 'PATCH', auth: true, body })))) { failed = true; break; }
      if (cImg && (await call(() => api(`/admin/campaigns/${it.id}/image`, { method: 'POST', auth: true, blob: cImg }))) === null) { failed = true; break; }
    }
    for (const it of failed ? [] : drop) {
      const status = it.status === 'APPROVED' ? 'ENDED' : it.status === 'PENDING' ? 'REJECTED' : null;
      if (status && !(await call(() => api(`/admin/campaigns/${it.id}/status`, { method: 'POST', auth: true, body: { status } })))) { failed = true; break; }
    }
    const had = new Set(cGroup.map((i) => i.slot));
    for (const slot of failed ? [] : [...wantSlots].filter((n) => !had.has(n)).sort((x, y) => x - y)) {
      const r = await call(() => api<{ id: string }>('/admin/campaigns', { method: 'POST', auth: true, body: { ...c, slot, days: daysFor(keyOfSlot(slot)) || days, url: c.url || undefined } }));
      if (!r || (blob && (await call(() => api(`/admin/campaigns/${r.id}/image`, { method: 'POST', auth: true, blob: blob! }))) === null)) { failed = true; break; }
    }
    const hadZones = new Set(cGroup.filter((i) => i.slot < -1).map((i) => SLOT_ZONE[i.slot] ?? ''));
    for (const zone of failed ? [] : [...wantPlots].filter((z) => !hadZones.has(z))) {
      if (!blob) { errRef.current = t('admin.camp.imageRequired'); setError(errRef.current); failed = true; break; }
      const r = await call(() => api<{ id: string }>('/admin/campaigns/plot', { method: 'POST', auth: true, body: { partnerId: c.partnerId, zone, ...rectOf(zone), days: daysFor(`z:${zone}`) || days, title: c.title, subtitle: c.subtitle, bg: c.bg, fg: c.fg, url: c.url || undefined } }));
      if (!r || (await call(() => api(`/admin/campaigns/${r.id}/image`, { method: 'POST', auth: true, blob: blob! }))) === null) { failed = true; break; }
    }
    // Après un échec, la liste se recharge mais le message d'erreur reste affiché
    const kept = failed ? errRef.current : null;
    void load().then(() => kept && setError(kept));
    if (!failed) {
      setCGroup(null);
      setCImg(null);
      setOpenForm(false);
      setC({ ...c, title: '', subtitle: '', url: '', days: 30 });
      setCSlots([]);
      setCDays({});
      setNotice(t('admin.saved'));
    }
  }
  async function addCampaign(ev: FormEvent) {
    ev.preventDefault();
    if (cGroup) return saveGroup();
    const plotZones = cZones.filter((z) => z !== 'board');
    const wantsBoards = cZones.includes('board');
    if (cZones.length === 0 || (wantsBoards && cSlots.length === 0 && plotZones.length === 0)) return setError(t('admin.camp.pickPlace'));
    if (wantsBoards && cSlots.length === 0) return setError(t('admin.camp.pickPlace'));
    if (plotZones.length > 0 && !cImg) return setError(t('admin.camp.imageRequired'));
    let failed = false;
    // Une annonce par espace à cases (mer, est, lac) : même affiche, rectangle propre à chaque espace
    for (const zone of plotZones) {
      const r = await call(() => api<{ id: string }>('/admin/campaigns/plot', { method: 'POST', auth: true, body: { partnerId: c.partnerId, zone, ...rectOf(zone), days: daysFor(`z:${zone}`), title: c.title, subtitle: c.subtitle, bg: c.bg, fg: c.fg, url: c.url || undefined } }));
      // L'envoi d'image répond sans contenu : seul `null` signale une erreur
      if (!r || (await call(() => api(`/admin/campaigns/${r.id}/image`, { method: 'POST', auth: true, blob: cImg! }))) === null) {
        failed = true;
        break;
      }
    }
    // Une campagne par panneau de la ville
    if (!failed && wantsBoards) {
      const slots = cSlots.includes('all') ? [-1] : cSlots.map(Number).sort((x, y) => x - y);
      for (const slot of slots) {
        const r = await call(() => api<{ id: string }>('/admin/campaigns', { method: 'POST', auth: true, body: { ...c, slot, days: daysFor(keyOfSlot(slot)), url: c.url || undefined } }));
        if (!r || (cImg && (await call(() => api(`/admin/campaigns/${r.id}/image`, { method: 'POST', auth: true, blob: cImg }))) === null)) {
          failed = true;
          break;
        }
      }
    }
    const kept = failed ? errRef.current : null;
    void load().then(() => kept && setError(kept));
    if (!failed) {
      setCImg(null);
      setOpenForm(false);
      setC({ ...c, title: '', subtitle: '', url: '' });
      setCSlots([]);
      setCDays({});
      setNotice(t('admin.campaignCreated'));
    }
  }

  // Image d'une annonce en attente : chargée avec l'authentification admin, affichée en local
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const showImage = async (id: string) => {
    const b = await call(() => apiBlob(`/admin/campaigns/${id}/image`));
    if (b) {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      setImageUrl(URL.createObjectURL(b));
    }
  };
  /** Valide, refuse ou arrête toutes les lignes d'une campagne à plusieurs emplacements. */
  const setStatusMany = async (ids: string[], status: string) => {
    let ok = true;
    for (const id of ids) if (!(await call(() => api(`/admin/campaigns/${id}/status`, { method: 'POST', auth: true, body: { status } })))) ok = false;
    if (ok) void load();
  };
  const setStatus = async (id: string, status: string) => {
    if (await call(() => api(`/admin/campaigns/${id}/status`, { method: 'POST', auth: true, body: { status } }))) void load();
  };
  const togglePartner = async (x: Partner) => {
    if (await call(() => api(`/admin/partners/${x.id}`, { method: 'PATCH', auth: true, body: { active: !x.active } }))) void load();
  };
  // Section « Nos partenaires » du site public (affichée seulement si le réglage partners.showcase l'active)
  const toggleOnSite = async (x: Partner) => {
    if (await call(() => api(`/admin/partners/${x.id}`, { method: 'PATCH', auth: true, body: { showOnSite: !x.showOnSite } }))) void load();
  };
  type TierRules = { boards: number; rotating?: number; brandPlace: boolean; jobs: number; eventsPerMonth: number; monthlyPrice: number; defaultMonths?: number; minMonths?: number; maxMonths?: number };
  /** Règles d'une formule (durées comprises) lues dans les réglages ; vide tant qu'ils ne sont pas chargés. */
  const tierRulesOf = (tier: string): Partial<TierRules> => ((settings['partners.tiers'] as Record<string, TierRules> | undefined)?.[tier] ?? {}) as Partial<TierRules>;

  async function saveTariffs() {
    const cur = settings['partners.tiers'] as Record<'BRONZE' | 'SILVER' | 'GOLD', TierRules> | undefined;
    if (!cur) return;
    const next = { ...cur };
    for (const k of ['BRONZE', 'SILVER', 'GOLD'] as const) {
      const num = (key: string, lo: number, hi: number) => {
        const raw = tierPrices[key];
        return raw === undefined || raw === '' ? undefined : Math.max(lo, Math.min(hi, Math.round(Number(raw) || 0)));
      };
      const price = num(k, 0, 100_000_000);
      const min = num(`${k}:minMonths`, 1, 60);
      const max = num(`${k}:maxMonths`, 1, 60);
      const def = num(`${k}:defaultMonths`, 1, 60);
      const cnt = (f: string) => num(`${k}:${f}`, 0, 100);
      const counts = { boards: cnt('boards'), rotating: cnt('rotating'), eventsPerMonth: cnt('eventsPerMonth') };
      const rules = { ...cur[k], ...Object.fromEntries(Object.entries(counts).filter(([, v]) => v !== undefined)), ...(price !== undefined && { monthlyPrice: price }), ...(min !== undefined && { minMonths: min }), ...(max !== undefined && { maxMonths: max }), ...(def !== undefined && { defaultMonths: def }) };
      // Cohérence : min ≤ défaut ≤ max
      const lo = rules.minMonths ?? 1;
      const hi = Math.max(lo, rules.maxMonths ?? 36);
      next[k] = { ...rules, minMonths: lo, maxMonths: hi, defaultMonths: Math.max(lo, Math.min(hi, rules.defaultMonths ?? 12)) };
    }
    if (await call(() => api('/admin/settings/partners.tiers', { method: 'PUT', auth: true, body: { value: next } }))) {
      setSettings({ ...settings, 'partners.tiers': next });
      setTierPrices({});
      setNotice(t('admin.saved'));
    }
  }

  async function saveAssign(ev: FormEvent) {
    ev.preventDefault();
    if (!assign) return;
    let partnerId = assign.partnerId;
    if (!partnerId) {
      if (assign.newName.trim().length < 2) return setError(t('admin.vip.pickPartner'));
      const r = await call(() => api<{ id: string }>('/admin/partners', { method: 'POST', auth: true, body: { name: assign.newName.trim(), kind: 'BRAND' } }));
      if (!r) return;
      partnerId = r.id;
    }
    const label = assign.placeLabel.trim() || assign.newName.trim() || partners.find((x) => x.id === partnerId)?.name.slice(0, 40) || '';
    const body = { tier: assign.tier, months: assign.months, placeLabel: label.slice(0, 40), placeSpot: assign.spotId, placeModel: assign.placeModel, placeColor: assign.placeColor };
    if ((await call(() => api(`/admin/partners/${partnerId}`, { method: 'PATCH', auth: true, body }))) && (await applyLogo(partnerId))) {
      setAssign(null);
      setNotice(t('admin.saved'));
      void load();
    }
  }

  /** Envoie ou retire le logo choisi (après l'enregistrement du partenaire). */
  async function applyLogo(partnerId: string): Promise<boolean> {
    if (logoSel === null) return true;
    const ok = logoSel === 'remove' ? await call(() => deletePartnerLogo(partnerId).then(() => true)) : await call(() => uploadPartnerLogo(partnerId, logoSel).then(() => true));
    setLogoSel(null);
    return !!ok;
  }

  async function saveTier(ev: FormEvent) {
    ev.preventDefault();
    if (!tierEdit) return;
    const { id, ...body } = tierEdit;
    if ((await call(() => api(`/admin/partners/${id}`, { method: 'PATCH', auth: true, body }))) && (await applyLogo(id))) {
      setTierEdit(null);
      setNotice(t('admin.saved'));
      void load();
    }
  }
  async function addOffer(ev: FormEvent) {
    ev.preventDefault();
    const body = { ...o, url: o.url || undefined, happensAt: o.kind === 'EVENT' && o.happensAt ? new Date(o.happensAt).toISOString() : undefined };
    if (await call(() => api('/admin/offers', { method: 'POST', auth: true, body }))) {
      setO({ ...o, title: '', body: '', place: '', url: '', happensAt: '' });
      setNotice(t('admin.saved'));
      void load();
    }
  }
  const toggleOffer = async (x: Offer) => {
    if (await call(() => api(`/admin/offers/${x.id}/active`, { method: 'POST', auth: true, body: { active: !x.active } }))) void load();
  };
  const dirtyKeys = Object.keys(settings).filter((k) => drafts[k] !== undefined && drafts[k] !== JSON.stringify(settings[k], null, 2));
  /** Enregistre tous les paramètres modifiés ; s'arrête au premier refus du serveur (message affiché, le reste garde ses modifications). */
  const saveSettings = async () => {
    const saved: Record<string, unknown> = {};
    for (const key of dirtyKeys) {
      let value: unknown;
      try {
        value = JSON.parse(drafts[key] ?? '');
      } catch {
        setError(`${t(`admin.sk.${key}`, { defaultValue: key })} : ${t('admin.invalidJson')}`);
        break;
      }
      const r = await call(() => api(`/admin/settings/${encodeURIComponent(key)}`, { method: 'PUT', auth: true, body: { value } }));
      if (!r) break;
      saved[key] = value;
    }
    if (Object.keys(saved).length) {
      setSettings({ ...settings, ...saved });
      setNotice(t('admin.savedN', { count: Object.keys(saved).length }));
    }
  };

  const TABS = ['stats', 'users', 'partners', 'jobs', 'messages', 'products', 'tenders', 'loans', 'settings', 'reports', 'audit', 'ledger'] as Tab[];
  // Messages du site : statut, réponse par e-mail (envoyée par le serveur) ou WhatsApp (conversation ouverte avec le texte)
  const setContactStatus = async (m: ContactRow, status: ContactRow['status']) => {
    if (await call(() => api(`/admin/contact/${m.id}/status`, { method: 'POST', auth: true, body: { status } }))) void load();
  };
  const replyContact = async (m: ContactRow, channel: 'email' | 'whatsapp') => {
    const text = (replyDrafts[m.id] ?? '').trim();
    if (text.length < 2) return;
    // WhatsApp : la fenêtre s'ouvre tout de suite (sinon le navigateur la bloque), puis reçoit le lien
    const win = channel === 'whatsapp' ? window.open('', '_blank') : null;
    const r = await call(() => api<{ url: string | null }>(`/admin/contact/${m.id}/reply`, { method: 'POST', auth: true, body: { channel, text } }));
    if (!r) {
      win?.close();
      return;
    }
    if (win && r.url) {
      win.opener = null;
      win.location.href = r.url;
    }
    setReplyDrafts({ ...replyDrafts, [m.id]: '' });
    setNotice(t(channel === 'email' ? 'admin.msg.sentMail' : 'admin.msg.sentWa'));
    void load();
  };
  const match = (...xs: (string | null | undefined)[]) => matches(q, ...xs.filter((x): x is string => !!x));
  const shownCampaigns0 = campaigns.filter((x) => x.createdAt.slice(0, 10) >= per.from && x.createdAt.slice(0, 10) <= per.to && (cStatus === 'ALL' || x.status === cStatus) && (cPlace === 'ALL' || placeOf(x.slot) === cPlace) && match(x.title, x.partner.name, x.url));
  // Une ligne par emplacement : chacun a sa propre durée d'affichage (même annonce, durées différentes)
  const groups: CampGroup[] = shownCampaigns0.map((x) => ({ key: x.id, items: [x] }));
  const pendingList = campaigns.filter((x) => x.status === 'PENDING');
  return (
    <div className="admin">
      <aside className="admin-side">
        <div className="admin-brand">
          <span className="admin-logo" aria-hidden="true">A</span>
          <div>
            <strong>AGBE</strong>
            <small>{t('admin.title')}</small>
          </div>
        </div>
        <nav className="admin-nav" role="tablist">
          {TABS.map((k) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setNotice(null); setOpenForm(false); setQ(''); }}>
              <Icon name={k} /> <span>{t(`admin.tabs.${k}`)}</span>
              {k === 'partners' && (stats?.pendingAds ?? 0) > 0 && <em className="admin-badge">{stats!.pendingAds}</em>}
              {k === 'messages' && unread > 0 && <em className="admin-badge">{unread}</em>}
            </button>
          ))}
        </nav>
        {/* Site public (accueil) : affiché comme pour un visiteur, « Reprendre ma partie » ramène dans le jeu */}
        <button className="admin-exit" onClick={() => { setBrowsingSite(true); window.location.assign(i18n.language === 'en' ? HOME.en : HOME.fr); }}><Icon name="home" size={16} /> {t('admin.viewSite')}</button>
        <button className="admin-exit" onClick={onExit}><Icon name="back" size={16} /> {t('admin.backToGame')}</button>
      </aside>
      {/* Mobile : barre d'onglets en bas (4 rubriques + Menu) ; « Menu » ouvre toutes les rubriques en plein écran */}
      <nav className="admin-bottom" aria-label={t('admin.menu')}>
        {(['stats', 'users', 'partners', 'messages'] as Tab[]).map((k) => (
          <button key={k} className={tab === k && !menuOpen ? 'on' : ''} onClick={() => { setTab(k); setNotice(null); setOpenForm(false); setQ(''); setMenuOpen(false); }}>
            <span className="ab-ico"><Icon name={k} size={22} />{k === 'partners' && (stats?.pendingAds ?? 0) > 0 && <em className="admin-badge">{stats!.pendingAds}</em>}{k === 'messages' && unread > 0 && <em className="admin-badge">{unread}</em>}</span>
            <span className="ab-lbl">{t(`admin.bottom.${k}`)}</span>
          </button>
        ))}
        <button className={menuOpen || !['stats', 'users', 'partners', 'messages'].includes(tab) ? 'on' : ''} onClick={() => setMenuOpen(true)} aria-haspopup="dialog">
          <span className="ab-ico"><Icon name="grid" size={22} /></span>
          <span className="ab-lbl">{t('admin.menu')}</span>
        </button>
      </nav>
      {menuOpen && (
        <div className="admin-sheet" role="dialog" aria-modal="true" aria-label={t('admin.menu')}>
          <header className="admin-sheet-head">
            <strong>{t('admin.menu')}</strong>
            <button className="adm-btn" onClick={() => setMenuOpen(false)} aria-label={t('app.close')}>✕</button>
          </header>
          <div className="admin-sheet-grid">
            {TABS.map((k) => (
              <button key={k} className={tab === k ? 'on' : ''} onClick={() => { setTab(k); setNotice(null); setOpenForm(false); setQ(''); setMenuOpen(false); }}>
                <span className="as-ico"><Icon name={k} size={26} />{k === 'partners' && (stats?.pendingAds ?? 0) > 0 && <em className="admin-badge">{stats!.pendingAds}</em>}{k === 'messages' && unread > 0 && <em className="admin-badge">{unread}</em>}</span>
                <span>{t(`admin.tabs.${k}`)}</span>
              </button>
            ))}
          </div>
          <div className="admin-sheet-foot">
            <button className="adm-btn" onClick={() => { setBrowsingSite(true); window.location.assign(i18n.language === 'en' ? HOME.en : HOME.fr); }}><Icon name="home" size={16} /> {t('admin.viewSite')}</button>
            <button className="adm-btn" onClick={onExit}><Icon name="back" size={16} /> {t('admin.backToGame')}</button>
          </div>
        </div>
      )}
      <div className="admin-body">
        <header className="admin-top">
          <div>
            <h1>{t(`admin.tabs.${tab}`)}</h1>
            <small>{new Date().toLocaleDateString(i18n.language, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</small>
          </div>
          <button className="adm-btn" onClick={() => void load()}><Icon name="refresh" size={16} /> {t('admin.refresh')}</button>
        </header>
      <main className="admin-main">
        {/* Retour d'action : bandeau flottant, visible quelle que soit la position dans la page (confirmation ou erreur) */}
        {(error || notice) && (
          <div className="adm-toasts" aria-live="polite">
            {error && (
              <div className="adm-toast err" role="alert">
                <span className="adm-toast-ic" aria-hidden="true">✕</span>
                <span className="adm-toast-tx">{error}</span>
                <button type="button" className="adm-toast-x" onClick={() => setError(null)} aria-label={t('app.close')}>✕</button>
              </div>
            )}
            {notice && (
              <div className="adm-toast ok" role="status">
                <span className="adm-toast-ic" aria-hidden="true">✓</span>
                <span className="adm-toast-tx">{notice}</span>
                <button type="button" className="adm-toast-x" onClick={() => setNotice(null)} aria-label={t('app.close')}>✕</button>
              </div>
            )}
          </div>
        )}

        {/* Codes de secours montrés une seule fois (activation ou régénération) : priorité sur tout le reste. */}
        {backupCodes && (
          <div className="adm-danger">
            <strong>{t('settings.backupTitle')}</strong>
            <p>{t('settings.backupIntro')}</p>
            <ul className="list stacked">
              {backupCodes.map((c) => (
                <li key={c}><code className="mono selectable">{c}</code></li>
              ))}
            </ul>
            <div>
              <button className="adm-btn" onClick={() => void navigator.clipboard?.writeText(backupCodes.join('\n')).catch(() => {})}>{t('settings.copy')}</button>
              <button className="adm-btn" onClick={() => downloadText('agbe-codes-secours.txt', backupCodes.join('\n') + '\n')}>{t('settings.download')}</button>
              <button className="adm-btn" onClick={() => {
                setBackupCodes(null);
                // L'activation vient de révoquer toutes les sessions (y compris celle-ci) : on recharge vers la connexion.
                window.location.reload();
              }}>
                {t('settings.backupSaved')}
              </button>
            </div>
          </div>
        )}

        {/* En production, les routes admin exigent la 2FA (voir RolesGuard) : ce panneau reste accessible même quand
            tout le reste de la page est bloqué par « mfa_required », pour que l'activer soit toujours possible d'ici. */}
        {!backupCodes && totpEnabled === true && (
          <div className="adm-danger adm-secure">
            <p className="ok">{t('settings.totpActive')}</p>
            {backupOpen ? (
              <form onSubmit={doRegenerateBackupCodes} noValidate>
                <p className="muted">{t('settings.backupRegenHint')}</p>
                <label className="field">
                  <span>{t('auth.password')}</span>
                  <PasswordInput value={backupPassword} onChange={(e) => setBackupPassword(e.target.value)} autoComplete="current-password" maxLength={128} required />
                </label>
                {backupError && <p className="error" role="alert">{backupError}</p>}
                <div>
                  <button className="adm-btn" disabled={totpBusy}>{t('settings.backupRegenGo')}</button>
                  <button type="button" className="adm-btn" onClick={() => { setBackupOpen(false); setBackupPassword(''); setBackupError(null); }}>{t('app.cancel')}</button>
                </div>
              </form>
            ) : (
              <button className="adm-btn" onClick={() => setBackupOpen(true)}>{t('settings.backupRegen')}</button>
            )}
            {disableOpen ? (
              <form onSubmit={doTotpDisable} noValidate>
                <p className="muted">{t('settings.totpDisableHint')}</p>
                <label className="field">
                  <span>{t('auth.password')}</span>
                  <PasswordInput value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} autoComplete="current-password" maxLength={128} required />
                </label>
                {disableError && <p className="error" role="alert">{disableError}</p>}
                <div>
                  <button className="adm-btn danger" disabled={totpBusy}>{t('settings.totpDisableGo')}</button>
                  <button type="button" className="adm-btn" onClick={() => { setDisableOpen(false); setDisablePassword(''); setDisableError(null); }}>{t('app.cancel')}</button>
                </div>
              </form>
            ) : (
              <button className="adm-btn" onClick={() => setDisableOpen(true)}>{t('settings.totpDisable')}</button>
            )}
          </div>
        )}

        {!backupCodes && totpEnabled === false && (
          <div className="adm-danger">
            {totpOpen ? (
              totp ? (
                <form className="adm-totp" onSubmit={doTotpEnable} noValidate>
                  <strong>{t('admin.totpTitle')}</strong>
                  <TotpSetup totp={totp} code={totpCode} onCode={setTotpCode} />
                  {totpError && <p className="error" role="alert">{totpError}</p>}
                  <div className="adm-totp-actions">
                    <button className="adm-btn primary" disabled={totpBusy}><Icon name="shield" size={16} /> {t('settings.totpEnable')}</button>
                    <button type="button" className="adm-btn" onClick={() => { setTotpOpen(false); setTotp(null); setTotpCode(''); setTotpError(null); }}>{t('app.cancel')}</button>
                  </div>
                </form>
              ) : (
                <form onSubmit={doTotpSetup} noValidate>
                  <strong>{t('admin.totpTitle')}</strong>
                  <p>{t('settings.totpIntro')}</p>
                  <label className="field">
                    <span>{t('auth.password')}</span>
                    <PasswordInput value={totpPassword} onChange={(e) => setTotpPassword(e.target.value)} autoComplete="current-password" maxLength={128} required />
                  </label>
                  {totpError && <p className="error" role="alert">{totpError}</p>}
                  <div>
                    <button className="adm-btn" disabled={totpBusy}><Icon name="shield" size={16} /> {t('settings.totpStart')}</button>
                    <button type="button" className="adm-btn" onClick={() => { setTotpOpen(false); setTotpError(null); }}>{t('app.cancel')}</button>
                  </div>
                </form>
              )
            ) : (
              <>
                <strong>{t('admin.totpTitle')}</strong>
                <p>{t('admin.totpHint')}</p>
                <button className="adm-btn" onClick={() => setTotpOpen(true)}><Icon name="shield" size={16} /> {t('settings.totpTitle')}</button>
              </>
            )}
          </div>
        )}

        {tab === 'stats' && stats && (
          <div className="dash">
            <div className="span-all"><PeriodPicker value={per} onChange={setPer} /></div>
            <div className="kpis">
              <Kpi icon="users" label={t('admin.kpi.accounts')} value={compact(stats.accounts, i18n.language)} sub={`+${stats.newAccounts} ${t('admin.kpi.inPeriod')} · ${stats.guests} ${t('admin.kpi.guests')}`} />
              <Kpi icon="pulse" label={t('admin.kpi.active')} value={compact(stats.active, i18n.language)} sub={t('admin.kpi.of', { n: stats.characters })} />
              <Kpi icon="wallet" label={t('admin.kpi.revenuePeriod')} value={`${compact(stats.revenue, i18n.language)} FCFA`} title={fcfa(stats.revenue)} sub={`${stats.purchases} ${t('admin.kpi.purchases').toLowerCase()}`} />
              <Kpi icon="coins" label={t('admin.kpi.supply')} value={`${compact(stats.moneySupply, i18n.language)} FCFA`} title={fcfa(stats.moneySupply)} sub={t('admin.kpi.supplyHint')} />
              <Kpi icon="megaphone" label={t('admin.kpi.pending')} value={String(stats.pendingAds)} sub={`${stats.liveBoards} ${t('admin.kpi.liveBoards')}`} />
            </div>
            <section className="adm-card span-all">
              <div className="adm-card-head">
                <div><h3>{t('admin.revenuePeriod')}</h3><small>{t('admin.revenue30Hint')}</small></div>
                <strong className="adm-total">{fcfa(stats.daily.reduce((a, d) => a + d.amount, 0))}</strong>
              </div>
              <RevenueChart data={stats.daily} label={(n) => fcfa(n)} lang={i18n.language} />
            </section>
            <section className="adm-card">
              <div className="adm-card-head"><h3>{t('admin.byKind')}</h3></div>
              {Object.keys(stats.byKind).length === 0 && <p className="adm-empty">{t('admin.none')}</p>}
              {Object.entries(stats.byKind).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <Meter key={k} label={t(`admin.kinds.${k}`, { defaultValue: k })} value={v} max={Math.max(...Object.values(stats.byKind))} text={fcfa(v)} />
              ))}
            </section>
            <section className="adm-card">
              <div className="adm-card-head"><h3>{t('admin.occupancy')}</h3></div>
              {stats.occupancy.map((z) => (
                <Meter key={z.id} label={t(`ads.where.${z.id}`, { defaultValue: z.id })} value={z.used} max={z.cells} text={`${Math.round((z.used / Math.max(1, z.cells)) * 100)} % · ${z.used} / ${z.cells}`} />
              ))}
            </section>
            <section className="adm-card">
              <div className="adm-card-head"><h3>{t('admin.countries')}</h3></div>
              {stats.countries.length === 0 && <p className="adm-empty">{t('admin.none')}</p>}
              {stats.countries.map((c) => (
                <Meter key={c.code} label={countryName(c.code, i18n.language, t('admin.unknownCountry'))} value={c.n} max={Math.max(...stats.countries.map((x) => x.n))} text={String(c.n)} />
              ))}
            </section>
            <section className="adm-card">
              <div className="adm-card-head"><h3>{t('admin.population')}</h3></div>
              {Object.entries(stats.housing).sort((a, b) => b[1] - a[1]).map(([k, v]) => (
                <Meter key={k} label={t(`housing.${k}`, { defaultValue: k })} value={v} max={Math.max(1, stats.characters)} text={String(v)} />
              ))}
            </section>
            <section className="adm-card">
              <div className="adm-card-head"><h3>{t('admin.education.title')}</h3><span className="adm-pill">{stats.education.studying}</span></div>
              {(['BT', 'BTS', 'LICENCE', 'MASTER', 'DOCTORAT'] as const).map((k) => (
                <Meter key={k} label={t(`study.kind.${k}`)} value={stats.education.byKind[k] ?? 0} max={Math.max(1, stats.characters)} text={String(stats.education.byKind[k] ?? 0)} />
              ))}
              <p className="adm-dim">{t('admin.education.studying', { n: stats.education.studying })}</p>
            </section>
            {stats.clothes && (
              <section className="adm-card">
                <div className="adm-card-head"><h3>{t('admin.clothes.title')}</h3><span className="adm-pill">{stats.clothes.garments}</span></div>
                <div className="kpis">
                  <Kpi icon="users" label={t('admin.clothes.owners')} value={String(stats.clothes.owners)} sub={t('admin.clothes.garments', { n: stats.clothes.garments })} />
                  <Kpi icon="star" label={t('admin.clothes.shops')} value={String(stats.clothes.shopsOpen)} sub={t('admin.clothes.shopsSub')} />
                  <Kpi icon="coins" label={t('admin.clothes.sales')} value={`${compact(Number(stats.clothes.shopSales), i18n.language)} FCFA`} title={fcfa(Number(stats.clothes.shopSales))} sub={t('admin.clothes.salesSub')} />
                </div>
                {stats.clothes.top.map((g) => (
                  <Meter key={g.itemId} label={`${g.emoji} ${i18n.language === 'en' ? g.nameEn : g.nameFr}`} value={g.n} max={Math.max(1, stats.clothes!.top[0]?.n ?? 1)} text={String(g.n)} />
                ))}
              </section>
            )}
            <section className="adm-card span-all">
              <div className="adm-card-head"><h3>{t('admin.land.title')}</h3><span className="adm-pill">{compact(stats.land.m2, i18n.language)} m²</span></div>
              <div className="kpis">
                <Kpi icon="users" label={t('admin.land.owners')} value={String(stats.land.owners)} sub={t('admin.land.holdings', { n: stats.land.holdings })} />
                <Kpi icon="check" label={t('admin.land.titled')} value={String(stats.land.titled)} sub={t('admin.land.built', { n: stats.land.built })} />
                <Kpi icon="coins" label={t('admin.land.paid')} value={`${compact(Number(stats.land.paid), i18n.language)} FCFA`} title={fcfa(Number(stats.land.paid))} sub={t('admin.land.listed', { n: stats.land.listed })} />
                {(() => {
                  const sea = stats.land.zones.filter((z) => z.water);
                  const sold = sea.reduce((n, z) => n + z.soldQuarters, 0);
                  const total = sea.reduce((n, z) => n + z.totalQuarters, 0);
                  return sea.length > 0 ? <Kpi icon="check" label={`🌊 ${t('admin.land.sea')}`} value={String(sold)} sub={t('admin.land.seaSub', { total })} /> : null;
                })()}
              </div>
              {stats.land.zones.map((z) => (
                <Meter key={z.id} label={`${z.water ? '🌊 ' : ''}${i18n.language === 'en' ? z.nameEn : z.nameFr}`} value={z.soldQuarters} max={Math.max(1, z.totalQuarters)} text={`${Math.round((z.soldQuarters / Math.max(1, z.totalQuarters)) * 100)} % · ${z.holdings}`} />
              ))}
            </section>
            <section className="adm-card span-all">
              <div className="adm-card-head"><h3>{t('admin.toReview')}</h3><span className="adm-pill">{pendingList.length}</span></div>
              {pendingList.length === 0 && <p className="adm-empty"><Icon name="check" size={16} /> {t('admin.nothingToReview')}</p>}
              {pendingList.length > 0 && (
                <table className="admin-table">
                  <thead><tr><th>{t('admin.f.preview')}</th><th>{t('admin.f.name')}</th><th>{t('admin.f.contact')}</th><th>{t('admin.f.place')}</th><th>{t('admin.f.website')}</th><th /></tr></thead>
                  <tbody>
                    {pendingList.map((x) => (
                      <tr key={x.id}>
                        <td><span className="review-art" style={{ background: x.bg, color: x.fg }}>{x.title}</span></td>
                        <td><strong>{x.partner.name}</strong></td>
                        <td className="mono">{x.partner.contact ?? '—'}</td>
                        <td>{x.slot <= -2 ? t('admin.seaPlot') : x.slot === -1 ? t('admin.allBoards') : `#${x.slot}`}</td>
                        <td className="mono">{x.url ?? '—'}</td>
                        <td className="row-actions">
                          {x.slot <= -2 && <button className="adm-btn icon" title={t('admin.f.preview')} onClick={() => void showImage(x.id)}><Icon name="image" size={16} /></button>}
                          <button className="adm-btn primary" onClick={() => void setStatus(x.id, 'APPROVED')}>{t('admin.approve')}</button>
                          <button className="adm-btn" onClick={() => void setStatus(x.id, 'REJECTED')}>{t('admin.reject')}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {imageUrl && (
                <div className="review-image">
                  <img className="ad-image-preview" src={imageUrl} alt="" />
                  <button className="adm-btn" onClick={() => setImageUrl(null)}>{t('app.close')}</button>
                </div>
              )}
            </section>
          </div>
        )}

        {tab === 'users' && (
          <div className="adm-stack">
            <section className="adm-card flush">
              <div className="adm-toolbar">
                <SearchBox value={q} onChange={(v) => { setQ(v); setPage(0); }} />
                <div className="adm-chips">
                  {['all', 'online', 'playing', 'players', 'guests', 'admins', 'suspended', 'deleted'].map((k) => (
                    <button key={k} className={uKind === k ? 'on' : ''} onClick={() => { setUKind(k); setPage(0); }}>{t(`admin.users.kind.${k}`)}</button>
                  ))}
                </div>
              </div>
              <div className="adm-toolbar">
                <label className="adm-check"><input type="checkbox" checked={uAll} onChange={(e) => { setUAll(e.target.checked); setPage(0); }} /> {t('admin.users.anyDate')}</label>
                {!uAll && <PeriodPicker value={per} onChange={(v) => { setPer(v); setPage(0); }} />}
                <span className="adm-grow" />
                {uKind === 'deleted' ? deleted && <small className="adm-dim">{t('admin.users.count', { count: deleted.total })}</small> : users && <small className="adm-dim">{t('admin.users.count', { count: users.total })}</small>}
              </div>
              {uKind === 'deleted' ? (
                <>
                  <p className="adm-help pad">{t('admin.deleted.help')}</p>
                  <table className="admin-table">
                    <thead><tr><th>{t('admin.users.user')}</th><th>{t('admin.users.contact')}</th><th>{t('admin.users.character')}</th><th>{t('admin.deleted.ips')}</th><th>{t('admin.deleted.deletedAt')}</th><th>{t('admin.deleted.purgeAt')}</th><th /></tr></thead>
                    <tbody>
                      {deleted?.items.map((x) => (
                        <tr key={x.accountId}>
                          <td><div className="adm-who"><span className="adm-av" style={{ background: '#94a3b8' }}>{(x.username ?? x.characterName ?? '?').slice(0, 1).toUpperCase()}</span><div><strong>{x.username ? `@${x.username}` : t('admin.users.guest')}</strong><small>{t('admin.deleted.born', { date: new Date(x.birthDate).toLocaleDateString(i18n.language) })}{x.google ? ' · Google' : ''}</small></div></div></td>
                          <td><div className="adm-lines"><span>{x.phone ?? '—'}</span><span className="adm-dim">{x.email ?? ''}</span></div></td>
                          <td>{x.characterName ?? <span className="adm-dim">—</span>}{x.rejoined.length > 0 && <div><span className="adm-tag warn">{t('admin.deleted.rejoined', { names: x.rejoined.map((a) => (a.username ? `@${a.username}` : a.id.slice(0, 8))).join(', ') })}</span></div>}</td>
                          <td className="mono adm-dim">{x.ips.slice(0, 3).join(', ') || '—'}{x.ips.length > 3 ? ` +${x.ips.length - 3}` : ''}</td>
                          <td className="adm-dim">{new Date(x.deletedAt).toLocaleDateString(i18n.language)}</td>
                          <td>{x.hold ? <span className="adm-status s-PENDING">{t('admin.deleted.onHold')}</span> : <span className="adm-dim">{new Date(x.purgeAt).toLocaleDateString(i18n.language)}</span>}</td>
                          <td className="row-actions">
                            <button className={x.hold ? 'adm-btn' : 'adm-btn primary'} onClick={() => void call(() => api(`/admin/users/${x.accountId}/hold`, { method: 'POST', auth: true, body: { hold: !x.hold } })).then((r) => r && load())}>{t(x.hold ? 'admin.deleted.release' : 'admin.deleted.hold')}</button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {deleted && deleted.items.length === 0 && <p className="adm-empty pad">{t('admin.none')}</p>}
                  {deleted && deleted.total > deleted.pageSize && (
                    <div className="adm-pager">
                      <small>{t('admin.range', { from: page * deleted.pageSize + 1, to: Math.min(deleted.total, (page + 1) * deleted.pageSize), n: deleted.total })}</small>
                      <div>
                        <button className="adm-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('admin.prev')}</button>
                        <button className="adm-btn" disabled={(page + 1) * deleted.pageSize >= deleted.total} onClick={() => setPage(page + 1)}>{t('admin.next')}</button>
                      </div>
                    </div>
                  )}
                </>
              ) : (<>
              <table className="admin-table">
                <thead><tr><th>{t('admin.users.user')}</th><th>{t('admin.users.contact')}</th><th>{t('admin.users.character')}</th><th className="num">{t('admin.users.balance')}</th><th className="num">{t('admin.users.spent')}</th><th>{t('admin.users.joined')}</th><th>{t('admin.f.status')}</th><th /></tr></thead>
                <tbody>
                  {users?.items.map((x) => (
                    <tr key={x.id} className={x.suspendedAt ? 'off' : ''}>
                      <td><div className="adm-who"><span className="adm-av" style={{ background: x.role === 'ADMIN' ? '#6250d6' : x.guest ? '#94a3b8' : '#0a7d4f' }}>{(x.username ?? x.character?.name ?? '?').slice(0, 1).toUpperCase()}</span><div><strong>{x.username ? `@${x.username}` : t('admin.users.guest')}</strong><small>{x.role === 'ADMIN' ? t('admin.users.admin') : x.guest ? t('admin.users.guestShort') : t('admin.users.player')}{x.totpEnabled ? ' · 2FA' : ''}{x.google ? ' · Google' : ''}</small></div></div></td>
                      <td className="adm-dim"><div className="adm-lines"><span>{x.email ?? '—'}</span><span>{x.phone ?? ''}</span></div></td>
                      <td>{x.character ? <div className="adm-lines"><strong>{x.character.name}</strong><span className="adm-dim">{t(`housing.${x.character.housing}`, { defaultValue: x.character.housing })} · ⭐ {x.character.respect}</span></div> : <span className="adm-dim">—</span>}</td>
                      <td className="num">{x.character ? fcfa(x.character.balance) : '—'}</td>
                      <td className="num">{x.spent ? fcfa(x.spent) : <span className="adm-dim">0</span>}</td>
                      <td className="adm-dim">{new Date(x.createdAt).toLocaleDateString(i18n.language)}</td>
                      <td>{x.suspendedAt ? <span className="adm-status s-REJECTED">{t('admin.users.suspended')}</span> : <span className="adm-status s-APPROVED">{t('admin.users.active')}</span>}{x.presence && <div><span className={`adm-tag presence-${x.presence}`}>● {t(`admin.users.presence.${x.presence}`)}</span></div>}</td>
                      <td className="row-actions"><button className="adm-btn" onClick={() => { setSel(x); setReason(''); setPwAsk(false); setNewPw(null); setPwCopied(false); }}>{t('admin.users.manage')}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {users && users.items.length === 0 && <p className="adm-empty pad">{t('admin.none')}</p>}
              {users && users.total > users.pageSize && (
                <div className="adm-pager">
                  <small>{t('admin.range', { from: page * users.pageSize + 1, to: Math.min(users.total, (page + 1) * users.pageSize), n: users.total })}</small>
                  <div>
                    <button className="adm-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('admin.prev')}</button>
                    <button className="adm-btn" disabled={(page + 1) * users.pageSize >= users.total} onClick={() => setPage(page + 1)}>{t('admin.next')}</button>
                  </div>
                </div>
              )}
              </>)}
            </section>

            {sel && (
              <div className="adm-drawer-bg" onClick={closeUser}>
                <aside className="adm-drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={sel.username ?? sel.id}>
                  <div className="adm-card-head">
                    <div className="adm-who"><span className="adm-av lg">{(sel.username ?? sel.character?.name ?? '?').slice(0, 1).toUpperCase()}</span><div><h3>{sel.username ? `@${sel.username}` : t('admin.users.guest')}</h3><small className="mono">{sel.id}</small></div></div>
                    <button className="adm-btn icon" onClick={closeUser} aria-label={t('app.close')}>✕</button>
                  </div>
                  <dl className="adm-dl">
                    <dt>{t('admin.users.email')}</dt><dd>{sel.email ?? '—'}</dd>
                    <dt>{t('admin.users.phone')}</dt><dd>{sel.phone ?? '—'}</dd>
                    <dt>{t('admin.users.role')}</dt><dd>{sel.role === 'ADMIN' ? t('admin.users.admin') : sel.guest ? t('admin.users.guestShort') : t('admin.users.player')}</dd>
                    <dt>2FA</dt><dd>{sel.totpEnabled ? t('admin.users.on') : t('admin.users.off')}</dd>
                    <dt>Google</dt><dd>{sel.google ? t('admin.users.on') : t('admin.users.off')}</dd>
                    <dt>{t('admin.users.joined')}</dt><dd>{new Date(sel.createdAt).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })}</dd>
                    <dt>{t('admin.users.lastLogin')}</dt><dd>{sel.lastLogin ? new Date(sel.lastLogin).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }) : '—'}</dd>
                    <dt>{t('admin.users.character')}</dt><dd>{sel.character ? `${sel.character.name} · ${t(`housing.${sel.character.housing}`, { defaultValue: sel.character.housing })}` : '—'}</dd>
                    <dt>{t('admin.users.balance')}</dt><dd>{sel.character ? fcfa(sel.character.balance) : '—'}</dd>
                    <dt>{t('admin.users.spent')}</dt><dd>{fcfa(sel.spent)}</dd>
                  </dl>
                  <div className="adm-actions">
                    <h4>{t('admin.users.actions')}</h4>
                    <button className="adm-btn" onClick={() => void userAction(sel, 'logout')}><Icon name="logout" size={16} /> {t('admin.users.forceLogout')}</button>
                    {!sel.guest && sel.email && (
                      <button className="adm-btn" onClick={() => void sendResetLink(sel)}><Icon name="mail" size={16} /> {t('admin.users.sendResetLink')}</button>
                    )}
                    {!sel.guest && (newPw ? (
                      <div className="adm-pw">
                        <p>{t('admin.users.newPasswordHint')}</p>
                        <div className="adm-pw-row">
                          <code>{newPw}</code>
                          <button type="button" className="adm-btn" onClick={() => void copyPassword(newPw)}>{pwCopied ? t('admin.users.copied') : t('admin.users.copyPassword')}</button>
                        </div>
                        <button type="button" className="adm-btn" onClick={() => { setNewPw(null); setPwCopied(false); }}>{t('admin.users.dismissPassword')}</button>
                      </div>
                    ) : pwAsk ? (
                      <div className="adm-danger">
                        <p>{t('admin.users.resetPasswordConfirm')}</p>
                        <button className="adm-btn danger" onClick={() => void resetPassword(sel)}><Icon name="key" size={16} /> {t('admin.users.resetPasswordConfirmBtn')}</button>
                        <button className="adm-btn" onClick={() => setPwAsk(false)}>{t('admin.users.resetPasswordCancel')}</button>
                      </div>
                    ) : (
                      <button className="adm-btn" onClick={() => setPwAsk(true)}><Icon name="key" size={16} /> {t('admin.users.resetPassword')}</button>
                    ))}
                    {!sel.guest && (
                      <button className="adm-btn" onClick={() => void userAction(sel, 'role', { role: sel.role === 'ADMIN' ? 'PLAYER' : 'ADMIN' })}>
                        <Icon name="shield" size={16} /> {sel.role === 'ADMIN' ? t('admin.users.demote') : t('admin.users.promote')}
                      </button>
                    )}
                    {sel.character && (
                      <div className="adm-danger">
                        <label>
                          <span>{t('admin.users.adjustBalance')}</span>
                          <input type="number" step={1000} value={adjustAmount} onChange={(e) => setAdjustAmount(Math.max(-100_000_000, Math.min(100_000_000, Math.floor(Number(e.target.value) || 0))))} />
                        </label>
                        <small className="muted">{t('admin.users.adjustBalanceHint')}</small>
                        <div>
                          <button className="adm-btn" onClick={() => void userAction(sel, 'adjust-balance', { amount: adjustAmount })}><Icon name="wallet" size={16} /> {t('admin.users.adjustBalanceGo')}</button>
                        </div>
                        <small className="muted">{t('admin.users.waiveBillHint')}</small>
                        <div>
                          <button className="adm-btn" onClick={() => void userAction(sel, 'waive-medical-bill')}><Icon name="ledger" size={16} /> {t('admin.users.waiveBillGo')}</button>
                        </div>
                      </div>
                    )}
                    {!sel.guest && (
                      <div className="adm-danger">
                        <label>
                          <span>{t('admin.users.newPassword')}</span>
                          <PasswordInput value={customPw} onChange={(e) => setCustomPw(e.target.value)} minLength={10} maxLength={128} autoComplete="new-password" />
                        </label>
                        <small className="muted">{t('admin.users.passwordHint')}</small>
                        <div>
                          <button className="adm-btn primary" disabled={customPw.length < 10} onClick={() => void userAction(sel, 'password', { confirm: 'RESET', password: customPw })}>{t('admin.users.setPassword')}</button>
                        </div>
                      </div>
                    )}
                    {sel.suspendedAt ? (
                      <button className="adm-btn primary" onClick={() => void userAction(sel, 'suspend', { suspended: false })}>{t('admin.users.unsuspend')}</button>
                    ) : (
                      <div className="adm-danger">
                        <label><span>{t('admin.users.reason')}</span><input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} /></label>
                        <button className="adm-btn danger" onClick={() => void userAction(sel, 'suspend', { suspended: true, reason: reason.trim() || undefined })}><Icon name="ban" size={16} /> {t('admin.users.suspend')}</button>
                      </div>
                    )}
                  </div>
                </aside>
              </div>
            )}
          </div>
        )}

        {tab === 'partners' && (
          <div className="adm-stack">
            <div className="adm-seg" role="tablist">
              {(['partners', 'vip', 'campaigns', 'offers'] as const).map((k) => (
                <button key={k} role="tab" aria-selected={sub === k} className={sub === k ? 'on' : ''} onClick={() => { setSub(k); setOpenForm(false); }}>
                  {t(`admin.sub.${k}`)} <em>{k === 'partners' ? partners.length : k === 'campaigns' ? campaigns.length : k === 'offers' ? offers.length : spots.length}</em>{k === 'vip' && spotReqs.length > 0 && <span className="adm-dot" title={t('admin.vip.title')} aria-label={t('admin.vip.title')}>{spotReqs.length}</span>}
                </button>
              ))}
              <span className="adm-grow" />
              {sub !== 'vip' && <button className="adm-btn primary" onClick={() => { setOpenForm((v) => !v); setTierEdit(null); setCGroup(null); }}><Icon name="plus" size={16} /> {t(`admin.new.${sub}`)}</button>}
            </div>

            {imageUrl && (
              <section className="adm-card adm-image">
                <img className="ad-image-preview" src={imageUrl} alt="" />
                <button className="adm-btn" onClick={() => setImageUrl(null)}>{t('app.close')}</button>
              </section>
            )}

            {sub === 'vip' && (
              <div className="adm-seg adm-seg-sub" role="tablist" aria-label={t('admin.sub.vip')}>
                <button role="tab" aria-selected={vipView === 'spaces'} className={vipView === 'spaces' ? 'on' : ''} onClick={() => setVipView('spaces')}>🗺️ {t('admin.vip.tabSpaces')}{spotReqs.length > 0 && <span className="adm-dot">{spotReqs.length}</span>}</button>
                <button role="tab" aria-selected={vipView === 'tariffs'} className={vipView === 'tariffs' ? 'on' : ''} onClick={() => setVipView('tariffs')}>💰 {t('admin.vip.tariffs')}</button>
              </div>
            )}

            {sub === 'vip' && vipView === 'spaces' && spotReqs.length > 0 && (
              <section className="adm-card adm-vipreq">
                <h3>👑 {t('admin.vip.title')} <em>{spotReqs.length}</em></h3>
                <p className="adm-hint">{t('admin.vip.hint')}</p>
                <ul className="adm-vipreq-list">
                  {spotReqs.map((r) => {
                    const decide = async (what: 'approve' | 'reject') => {
                      const res = await call(() => api(`/admin/spot-requests/${r.id}/${what}`, { method: 'POST', auth: true, body: what === 'approve' ? { months: reqMonths[r.id] ?? tierRulesOf(r.tier).defaultMonths ?? 12 } : {} }));
                      if (res) void load();
                    };
                    return (
                      <li key={r.id} className={`adm-vipreq-item ${r.tier.toLowerCase()}`}>
                        <div className="adm-vipreq-head">
                          <strong>{i18n.language === 'en' ? r.spotNameEn : r.spotNameFr}</strong>
                          <span className="adm-vipreq-tier">{r.tier === 'SILVER' ? '⭐' : r.tier === 'BRONZE' ? '🥉' : '👑'} {t(`partners.tier.${r.tier}`)}</span>
                        </div>
                        <p><b>{r.company || r.name}</b>{r.company ? ` · ${r.name}` : ''} · <a href={`https://wa.me/${r.whatsapp}`} target="_blank" rel="noopener noreferrer">+{r.whatsapp}</a>{r.email ? ` · ${r.email}` : ''}</p>
                        <p className="adm-vipreq-msg">{r.message}</p>
                        <small className="muted">{new Date(r.createdAt).toLocaleString(i18n.language)}</small>
                        {r.takenBy && <p className="error small-line">{t('admin.vip.taken', { name: r.takenBy.name })}</p>}
                        <div className="adm-vipreq-actions">
                          <label>
                            <span>{t('admin.vip.months')}</span>
                            <input type="number" min={tierRulesOf(r.tier).minMonths ?? 1} max={tierRulesOf(r.tier).maxMonths ?? 36} value={reqMonths[r.id] ?? tierRulesOf(r.tier).defaultMonths ?? 12} onChange={(e) => setReqMonths({ ...reqMonths, [r.id]: Math.max(1, Math.min(36, Number(e.target.value) || 12)) })} />
                          </label>
                          <button className="adm-btn primary" disabled={!!r.takenBy} onClick={() => void decide('approve')}>{t('admin.vip.approve')}</button>
                          <button className="adm-btn" onClick={() => void decide('reject')}>{t('admin.vip.reject')}</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </section>
            )}

            {sub === 'vip' && (() => {
              const tierOf = (id: string): 'GOLD' | 'SILVER' | 'BRONZE' => (/(^|_)or(_|$)/.test(id) ? 'GOLD' : /(^|_)bronze(_|$)/.test(id) ? 'BRONZE' : 'SILVER');
              const pending = new Map<string, number>();
              for (const r of spotReqs) pending.set(r.spotId, (pending.get(r.spotId) ?? 0) + 1);
              const rows = spots.filter((sp) => (vTier === 'ALL' || tierOf(sp.id) === vTier) && (vState === 'ALL' || (vState === 'FREE' ? !sp.takenBy && !pending.has(sp.id) : vState === 'PENDING' ? !sp.takenBy && pending.has(sp.id) : !!sp.takenBy)) && match(sp.nameFr, sp.nameEn, sp.takenBy?.name ?? ''));
              const free = spots.filter((sp) => !sp.takenBy && !pending.has(sp.id)).length;
              return (
                <>
                {vipView === 'tariffs' && (
                <section className="adm-card adm-tariffs">
                  <div className="adm-card-head"><h3>💰 {t('admin.vip.tariffs')}</h3><small className="adm-help">{t('admin.vip.tariffsHelp')}</small></div>
                  <div className="adm-tariff-grid">
                    {(['BRONZE', 'SILVER', 'GOLD'] as const).map((k) => {
                      const rules = (settings['partners.tiers'] as Record<string, TierRules> | undefined)?.[k];
                      const mine = spots.filter((sp) => tierOf(sp.id) === k);
                      const freeN = mine.filter((sp) => !sp.takenBy && !pending.has(sp.id)).length;
                      return (
                        <div key={k} className={`adm-tariff ${k.toLowerCase()}`}>
                          <h4>{k === 'GOLD' ? '👑' : k === 'SILVER' ? '⭐' : '🥉'} {t(`vip.name.${k}`)}</h4>
                          <label>
                            <span>{t('admin.vip.pricePerMonth')}</span>
                            <div className="adm-price"><input type="number" min={0} step={1000} value={tierPrices[k] ?? String(rules?.monthlyPrice ?? '')} onChange={(e) => setTierPrices({ ...tierPrices, [k]: e.target.value })} disabled={!rules} /><em>FCFA</em></div>
                          </label>
                          <div className="adm-dur">
                            {(['defaultMonths', 'minMonths', 'maxMonths'] as const).map((f) => (
                              <label key={f}>
                                <span>{t(`admin.vip.${f}`)}</span>
                                <input type="number" min={1} max={60} value={tierPrices[`${k}:${f}`] ?? String(rules?.[f] ?? (f === 'defaultMonths' ? 12 : f === 'minMonths' ? 1 : 36))} onChange={(e) => setTierPrices({ ...tierPrices, [`${k}:${f}`]: e.target.value })} disabled={!rules} />
                              </label>
                            ))}
                          </div>
                          <div className="adm-dur">
                            {(['boards', 'rotating', 'eventsPerMonth'] as const).map((f) => (
                              <label key={f}>
                                <span>{t(`admin.vip.cnt.${f}`)}</span>
                                <input type="number" min={0} max={100} value={tierPrices[`${k}:${f}`] ?? String(rules?.[f] ?? 0)} onChange={(e) => setTierPrices({ ...tierPrices, [`${k}:${f}`]: e.target.value })} disabled={!rules} />
                              </label>
                            ))}
                          </div>
                          <small className="adm-dim">{t('admin.vip.spacesOf', { free: freeN, total: mine.length })}</small>
                        </div>
                      );
                    })}
                  </div>
                  <div className="adm-form-foot"><button type="button" className="adm-btn primary" disabled={Object.values(tierPrices).every((v) => v === '')} onClick={() => void saveTariffs()}>{t('admin.vip.saveTariffs')}</button></div>
                </section>
                )}
                {vipView === 'spaces' && (
                <section className="adm-card flush adm-vipspots">
                  <div className="adm-toolbar">
                    <SearchBox value={q} onChange={setQ} />
                    <div className="adm-chips">
                      {(['ALL', 'GOLD', 'SILVER', 'BRONZE'] as const).map((k) => (
                        <button key={k} className={vTier === k ? 'on' : ''} onClick={() => { setVTier(k); setPage(0); }}>{k === 'ALL' ? t('admin.all') : `${k === 'GOLD' ? '👑' : k === 'SILVER' ? '⭐' : '🥉'} ${t(`partners.tier.${k}`)}`}</button>
                      ))}
                    </div>
                    <div className="adm-chips">
                      {(['ALL', 'FREE', 'PENDING', 'TAKEN'] as const).map((k) => (
                        <button key={k} className={vState === k ? 'on' : ''} onClick={() => { setVState(k); setPage(0); }}>{k === 'ALL' ? t('admin.all') : k === 'FREE' ? t('admin.vip.onlyFree') : k === 'PENDING' ? `${t('admin.vip.onlyPending')} (${[...pending.keys()].filter((id) => spots.some((x) => x.id === id && !x.takenBy)).length})` : t('admin.vip.onlyTaken')}</button>
                      ))}
                    </div>
                    <small className="adm-dim">{t('admin.vip.count', { free, total: spots.length })}</small>
                  </div>
                  {assign && (() => {
                    const sp = spots.find((x) => x.id === assign.spotId);
                    const ic = assign.tier === 'GOLD' ? '👑' : assign.tier === 'SILVER' ? '⭐' : '🥉';
                    return (
                      <form className="adm-form form-tier adm-assign" onSubmit={saveAssign}>
                        <h3><span className="form-badge" aria-hidden="true">{ic}</span> {t('admin.vip.assign')} · {sp ? (i18n.language === 'en' ? sp.nameEn : sp.nameFr) : ''}</h3>
                        <div className="adm-fields">
                          <label><span>{t('admin.f.partner')}</span><SearchSelect value={assign.partnerId} options={partners.map((x) => ({ value: x.id, label: x.name, hint: x.tier === 'NONE' ? undefined : t(`partners.tier.${x.tier}`) }))} onChange={(v) => setAssign({ ...assign, partnerId: v })} placeholder={t('admin.camp.choose')} searchLabel={t('admin.ss.search')} empty={t('admin.ss.empty')} /></label>
                          {!assign.partnerId && <label><span>{t('admin.vip.orNew')}</span><input value={assign.newName} onChange={(e) => setAssign({ ...assign, newName: e.target.value })} placeholder={t('admin.camp.partnerName')} minLength={2} maxLength={64} /></label>}
                          <label><span>{t('admin.f.months')}</span><input type="number" min={tierRulesOf(assign.tier).minMonths ?? 1} max={tierRulesOf(assign.tier).maxMonths ?? 36} value={assign.months} onChange={(e) => setAssign({ ...assign, months: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} /></label>
                          <label><span>{t('admin.f.placeLabel')}</span><input value={assign.placeLabel} onChange={(e) => setAssign({ ...assign, placeLabel: e.target.value })} maxLength={40} /></label>
                          <label><span>{t('admin.f.placeModel')}</span><SearchSelect value={assign.placeModel} options={BRAND_MODELS.map((m) => ({ value: m, label: t(`admin.models.${m}.name`), hint: t(`admin.models.${m}.hint`) }))} onChange={(v) => setAssign({ ...assign, placeModel: v })} placeholder={t('admin.f.placeModel')} searchLabel={t('admin.ss.search')} empty={t('admin.ss.empty')} /></label>
                          <label><span>{t('admin.f.bg')}</span><input type="color" value={assign.placeColor} onChange={(e) => setAssign({ ...assign, placeColor: e.target.value })} /></label>
                          <LogoField current={partners.find((x) => x.id === assign.partnerId)?.logo ?? null} value={logoSel} onChange={setLogoSel} />
                        </div>
                        <div className="adm-form-foot"><button type="button" className="adm-btn" onClick={() => setAssign(null)}>{t('app.cancel')}</button><button className="adm-btn primary" disabled={!assign.partnerId && assign.newName.trim().length < 2}>{t('admin.vip.assignGo')}</button></div>
                      </form>
                    );
                  })()}
                  <table className="admin-table">
                    <thead><tr><th>{t('admin.vip.space')}</th><th>{t('admin.f.tier')}</th><th>{t('admin.vip.state')}</th><th className="num">{t('admin.vip.pending')}</th><th /></tr></thead>
                    <tbody>
                      {rows.length === 0 && <tr><td colSpan={5} className="adm-dim">{t('admin.vip.none')}</td></tr>}
                      {rows.slice(page * PAGE, page * PAGE + PAGE).map((sp) => {
                        const tr = tierOf(sp.id);
                        return (
                          <tr key={sp.id} className={sp.takenBy ? '' : 'adm-clickrow'} onClick={() => !sp.takenBy && (setLogoSel(null), setAssign({ spotId: sp.id, tier: tr, partnerId: '', newName: '', months: tierRulesOf(tr).defaultMonths ?? 12, placeLabel: '', placeModel: 'agency', placeColor: tr === 'GOLD' ? '#d69a12' : tr === 'BRONZE' ? '#a8683a' : '#7d8ba0' }))}>
                            <td><strong>{i18n.language === 'en' ? sp.nameEn : sp.nameFr}</strong><small className="adm-dim adm-block">{sp.id}</small></td>
                            <td><span className={`adm-tag tier-${tr} tier-pill`}>{tr === 'GOLD' ? '👑' : tr === 'SILVER' ? '⭐' : '🥉'} {t(`partners.tier.${tr}`)}</span></td>
                            <td>{sp.takenBy ? <span className="adm-status s-APPROVED">{t('admin.spotTaken', { name: sp.takenBy.name })}</span> : pending.has(sp.id) ? <span className="adm-status s-PENDING">{t('admin.vip.statusPending', { count: pending.get(sp.id) })}</span> : <span className="adm-status s-ENDED">{t('admin.spotFree')}</span>}</td>
                            <td className="num">{pending.get(sp.id) ?? 0}</td>
                            <td className="row-actions">{!sp.takenBy && <div className="row-actions-in"><button type="button" className="adm-btn primary">{t('admin.vip.assign')}</button></div>}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {rows.length > PAGE && (
                    <div className="adm-pager">
                      <small>{t('admin.range', { from: page * PAGE + 1, to: Math.min(rows.length, page * PAGE + PAGE), n: rows.length })}</small>
                      <div>
                        <button className="adm-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('admin.prev')}</button>
                        <button className="adm-btn" disabled={(page + 1) * PAGE >= rows.length} onClick={() => setPage(page + 1)}>{t('admin.next')}</button>
                      </div>
                    </div>
                  )}
                </section>
                )}
                </>
              );
            })()}

            {sub === 'partners' && (
              <>
                {openForm && (
                  <form className="adm-card adm-form form-new" onSubmit={addPartner}>
                    <h3><span className="form-badge" aria-hidden="true">＋</span> {t('admin.new.partners')}</h3>
                    <div className="adm-fields">
                      <label><span>{t('admin.f.name')}</span><input value={p.name} onChange={(e) => setP({ ...p, name: e.target.value })} maxLength={64} required /></label>
                      <label><span>{t('admin.f.kind')}</span><SearchSelect value={p.kind} options={KINDS.map((k) => ({ value: k, label: t(`billboard.kinds.${k}`) }))} onChange={(v) => setP({ ...p, kind: v })} placeholder={t('admin.f.kind')} searchLabel={t('admin.ss.search')} empty={t('admin.ss.empty')} /></label>
                      <label><span>{t('admin.f.website')}</span><input placeholder="https://…" value={p.website} onChange={(e) => setP({ ...p, website: e.target.value })} maxLength={200} /></label>
                      <label><span>{t('admin.f.contact')}</span><input value={p.contact} onChange={(e) => setP({ ...p, contact: e.target.value })} maxLength={120} /></label>
                    </div>
                    <div className="adm-form-foot"><button type="button" className="adm-btn" onClick={() => setOpenForm(false)}>{t('app.cancel')}</button><button className="adm-btn primary">{t('admin.addPartner')}</button></div>
                  </form>
                )}
                {tierEdit && (
                  <form className="adm-card adm-form form-tier" onSubmit={saveTier}>
                    <h3><span className="form-badge" aria-hidden="true">{tierEdit.tier === 'GOLD' ? '👑' : tierEdit.tier === 'SILVER' ? '⭐' : tierEdit.tier === 'BRONZE' ? '🥉' : '🏷️'}</span> {t('admin.f.tier')} · {partners.find((x) => x.id === tierEdit.id)?.name}</h3>
                    <div className="adm-fields">
                      <label><span>{t('admin.f.name')}</span><input value={tierEdit.name} onChange={(e) => setTierEdit({ ...tierEdit, name: e.target.value })} minLength={2} maxLength={64} required /></label>
                      <label><span>{t('admin.f.kind')}</span><SearchSelect value={tierEdit.kind} options={KINDS.map((k) => ({ value: k, label: t(`billboard.kinds.${k}`) }))} onChange={(v) => setTierEdit({ ...tierEdit, kind: v })} placeholder={t('admin.f.kind')} searchLabel={t('admin.ss.search')} empty={t('admin.ss.empty')} /></label>
                      <label><span>{t('admin.f.website')}</span><input placeholder="https://…" value={tierEdit.website} onChange={(e) => setTierEdit({ ...tierEdit, website: e.target.value })} maxLength={200} /></label>
                      <label><span>{t('admin.f.contact')}</span><input value={tierEdit.contact} onChange={(e) => setTierEdit({ ...tierEdit, contact: e.target.value })} maxLength={120} /></label>
                      <label><span>{t('admin.f.tier')}</span><SearchSelect value={tierEdit.tier} options={TIERS.map((k) => ({ value: k, label: t(`partners.tier.${k}`) }))} onChange={(v) => setTierEdit({ ...tierEdit, tier: v })} placeholder={t('admin.f.tier')} searchLabel={t('admin.ss.search')} empty={t('admin.ss.empty')} /></label>
                      <label><span>{t('admin.f.months')}</span><input type="number" min={1} max={24} value={tierEdit.months} onChange={(e) => setTierEdit({ ...tierEdit, months: Number(e.target.value) })} /></label>
                      <label><span>{t('admin.f.placeLabel')}</span><input value={tierEdit.placeLabel} onChange={(e) => setTierEdit({ ...tierEdit, placeLabel: e.target.value })} minLength={2} maxLength={40} /></label>
                      <label>
                        <span>{t('admin.f.placeModel')}</span>
                        <SearchSelect
                          value={tierEdit.placeModel}
                          options={BRAND_MODELS.map((m) => ({ value: m, label: t(`admin.models.${m}.name`), hint: t(`admin.models.${m}.hint`) }))}
                          onChange={(v) => setTierEdit({ ...tierEdit, placeModel: v })}
                          placeholder={t('admin.f.placeModel')}
                          searchLabel={t('admin.ss.search')}
                          empty={t('admin.ss.empty')}
                        />
                      </label>
                      <label className="wide">
                        <span>{t('admin.f.placeSpot')}</span>
                        <SearchSelect
                          value={tierEdit.placeSpot}
                          options={[
                            { value: 'none', label: t('admin.spotNone') },
                            ...spots.map((sp) => ({
                              value: sp.id,
                              label: i18n.language === 'en' ? sp.nameEn : sp.nameFr,
                              hint: sp.takenBy && sp.takenBy.id !== tierEdit.id ? t('admin.spotTaken', { name: sp.takenBy.name }) : t('admin.spotFree'),
                              disabled: !!sp.takenBy && sp.takenBy.id !== tierEdit.id,
                            })),
                          ]}
                          onChange={(v) => setTierEdit({ ...tierEdit, placeSpot: v })}
                          placeholder={t('admin.spotNone')}
                          searchLabel={t('admin.ss.search')}
                          empty={t('admin.ss.empty')}
                        />
                      </label>
                      <label><span>{t('admin.f.bg')}</span><input type="color" value={tierEdit.placeColor} onChange={(e) => setTierEdit({ ...tierEdit, placeColor: e.target.value })} /></label>
                      <LogoField current={partners.find((x) => x.id === tierEdit.id)?.logo ?? null} value={logoSel} onChange={setLogoSel} />
                    </div>
                    <small className="adm-help">{t('admin.tierHelp')}</small>
                    <div className="adm-form-foot"><button type="button" className="adm-btn" onClick={() => setTierEdit(null)}>{t('app.cancel')}</button><button className="adm-btn primary">{t('admin.save')}</button></div>
                  </form>
                )}
                <section className="adm-card flush">
                  <div className="adm-toolbar"><SearchBox value={q} onChange={setQ} /></div>
                  <table className="admin-table">
                    <thead><tr><th>{t('admin.f.name')}</th><th>{t('admin.f.kind')}</th><th>{t('admin.f.website')}</th><th className="num">{t('admin.f.campaigns')}</th><th>{t('admin.f.tier')}</th><th /></tr></thead>
                    <tbody>
                      {partners.filter((x) => match(x.name, x.website, x.contact)).map((x) => (
                        <tr key={x.id} className={x.active ? '' : 'off'}>
                          <td><div className="adm-who"><span className="adm-av" style={{ background: x.placeColor ?? undefined }}>{x.name.slice(0, 1).toUpperCase()}</span><div><strong>{x.name}</strong>{x.contact && <small>{x.contact}</small>}</div></div></td>
                          <td><span className="adm-tag">{t(`billboard.kinds.${x.kind}`)}</span></td>
                          <td>{x.website ? <a className="adm-link" href={x.website} target="_blank" rel="noopener noreferrer">{x.website.replace(/^https:\/\//, '').replace(/\/$/, '')}</a> : <span className="adm-dim">—</span>}</td>
                          <td className="num">{x._count.campaigns}</td>
                          <td><span className={`adm-tag tier-${x.tier} tier-pill`}>{t(`partners.tier.${x.tier}`)}</span>{x.tierEndsAt && <small className="adm-dim"> · {new Date(x.tierEndsAt).toLocaleDateString(i18n.language)}</small>}</td>
                          <td className="row-actions"><div className="row-actions-in">
                            <button className="adm-btn" onClick={() => {
                              // Emplacement actuel retrouvé dans la liste (coordonnées identiques), sinon aucun
                              const cur = spots.find((sp) => sp.x === x.placeX && sp.z === x.placeZ);
                              setOpenForm(false);
                              setLogoSel(null);
                              setTierEdit({ id: x.id, tier: x.tier, months: x.tierEndsAt ? Math.max(1, Math.round((Date.parse(x.tierEndsAt) - Date.now()) / (30 * 86_400_000))) : tierRulesOf(x.tier).defaultMonths ?? 12, placeLabel: x.placeLabel ?? x.name.slice(0, 40), placeSpot: cur?.id ?? 'none', placeModel: x.placeModel ?? 'agency', placeColor: x.placeColor ?? '#0a7d4f', name: x.name, kind: x.kind, website: x.website ?? '', contact: x.contact ?? '' });
                            }}>{t('admin.editTier')}</button>
                            <button className={x.showOnSite ? 'adm-btn primary' : 'adm-btn'} aria-pressed={x.showOnSite} title={t('admin.onSiteHelp')} onClick={() => void toggleOnSite(x)}>{t(x.showOnSite ? 'admin.onSite' : 'admin.offSite')}</button>
                            <button className="adm-btn" onClick={() => void togglePartner(x)}>{x.active ? t('admin.deactivate') : t('admin.activate')}</button>
                          </div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </section>
              </>
            )}

            {sub === 'campaigns' && (
              <>
                {openForm && (
                  <form className="adm-card adm-form" onSubmit={addCampaign}>
                    <div className="adm-card-head"><h3>{cGroup ? t('admin.camp.edit') : t('admin.new.campaigns')}</h3><small className="adm-help">{cGroup ? t('admin.camp.editGroupHelp') : t('admin.camp.help')}</small></div>
                    <div className="camp-form">
                      <div className="camp-fields">
                        <fieldset className="camp-group">
                          <legend>{t('admin.camp.who')}</legend>
                          <div className="adm-fields two">
                            <label><span>{t('admin.f.partner')}</span><SearchSelect value={c.partnerId} options={partners.map((x) => ({ value: x.id, label: x.name }))} onChange={(v) => setC({ ...c, partnerId: v })} placeholder={t('admin.camp.choose')} searchLabel={t('admin.ss.search')} empty={t('admin.ss.empty')} /></label>
                            <div className="wide camp-qp">
                              {qp ? (
                                <div className="camp-qp-form">
                                  <input value={qp.name} onChange={(e) => setQp({ ...qp, name: e.target.value })} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void quickPartner(); } }} placeholder={t('admin.camp.partnerName')} aria-label={t('admin.camp.partnerName')} minLength={2} maxLength={64} autoFocus />
                                  <SearchSelect value={qp.kind} options={KINDS.map((k) => ({ value: k, label: t(`billboard.kinds.${k}`) }))} onChange={(v) => setQp({ ...qp, kind: v })} placeholder={t('admin.f.kind')} searchLabel={t('admin.ss.search')} empty={t('admin.ss.empty')} />
                                  <button type="button" className="adm-btn primary" disabled={qp.name.trim().length < 2} onClick={() => void quickPartner()}>{t('admin.camp.createPartner')}</button>
                                  <button type="button" className="adm-btn" onClick={() => setQp(null)}>{t('app.cancel')}</button>
                                </div>
                              ) : (
                                <button type="button" className="adm-btn" onClick={() => setQp({ name: '', kind: 'BRAND' })}>＋ {t('admin.camp.newPartner')}</button>
                              )}
                            </div>
                            {cGroup ? (
                              // Modification : une ligne = un seul emplacement ; un panneau se change pour un panneau libre
                              <div className="wide camp-one-place">
                                <span>{t('admin.camp.where')}</span>
                                {editSlot !== null ? (
                                  <SearchSelect
                                    value={String(editSlot)}
                                    options={[{ value: '-1', label: t('admin.camp.allBoards') }, ...Array.from({ length: boardCount }, (_, i) => {
                                      const busy = campaigns.some((x) => x.id !== cGroup[0]!.id && x.slot === i && (x.status === 'PENDING' || x.status === 'APPROVED' || x.status === 'AWAITING_PAYMENT') && +new Date(x.endsAt) > Date.now());
                                      return { value: String(i), label: `${t('admin.camp.boardNo')} ${i}`, hint: busy ? t('admin.camp.busy') : undefined, disabled: busy };
                                    })]}
                                    onChange={(v) => setEditSlot(Number(v))}
                                    placeholder={t('admin.camp.where')}
                                    searchLabel={t('admin.ss.search')}
                                    empty={t('admin.ss.empty')}
                                  />
                                ) : (
                                  <strong>{(() => { const sl = cGroup[0]!.slot; return t(`ads.where.${SLOT_ZONE[sl] ?? 'zone'}`); })()}</strong>
                                )}
                              </div>
                            ) : (
                              <>
                            <label className="wide"><span>{t('admin.camp.zone')}</span>
                                <SearchMulti
                                  values={cZones}
                                  options={['board', 'sea', 'east', 'lac_ouest', 'lac_est', 'lac_lions_ouest', 'lac_lions_est'].map((k) => ({ value: k, label: t(`ads.where.${k}`) }))}
                                  onChange={setCZones}
                                  placeholder={t('admin.camp.zone')}
                                  searchLabel={t('admin.ss.search')}
                                  empty={t('admin.ss.empty')}
                                  removeLabel={t('app.close')}
                                />
                              </label>
                              {cZones.includes('board') && (<label className="wide"><span>{t('admin.camp.where')}</span>
                                <SearchMulti
                                  values={cSlots}
                                  options={[{ value: 'all', label: t('admin.camp.allBoards') }, ...Array.from({ length: boardCount }, (_, i) => ({ value: String(i), label: `${t('admin.camp.boardNo')} ${i}` }))]}
                                  onChange={(v) => setCSlots(v.includes('all') && !cSlots.includes('all') ? ['all'] : v.filter((x) => x !== 'all'))}
                                  placeholder={t('admin.camp.where')}
                                  searchLabel={t('admin.ss.search')}
                                  empty={t('admin.ss.empty')}
                                  removeLabel={t('app.close')}
                                />
                              </label>)}
                              </>
                            )}
                            {cZones.filter((z) => z !== 'board').map((z) => {
                              // Espace déjà occupé par cette campagne : on montre ses cases actuelles (non modifiables ici)
                              const own = cGroup?.filter((i) => i.slot < -1 && SLOT_ZONE[i.slot] === z) ?? [];
                              if (own.length > 0) {
                                return (
                                  <div className="wide" key={z}>
                                    <strong>{t(`ads.where.${z}`)}</strong>
                                    {zonesData[z] ? own.map((i) => (
                                      <div key={i.id} className="camp-own-plot">
                                        <PlotPicker
                                          grid={zonesData[z]!.grid}
                                          plots={zonesData[z]!.plots.filter((pl) => pl.id !== i.id && !(pl.x === i.plotX && pl.y === i.plotY && pl.w === i.plotW && pl.h === i.plotH))}
                                          value={cRows[i.id] ?? { x: i.plotX ?? 0, y: i.plotY ?? 0, w: i.plotW ?? 1, h: i.plotH ?? 1 }}
                                          onChange={(r) => setCRows({ ...cRows, [i.id]: r })}
                                        />
                                      </div>
                                    )) : <small className="adm-dim">{t('app.loading')}</small>}
                                  </div>
                                );
                              }
                              return (
                              <div className="wide" key={z}>
                                <strong>{t(`ads.where.${z}`)}</strong>
                                {zonesData[z] ? <PlotPicker grid={zonesData[z]!.grid} plots={zonesData[z]!.plots} value={rectOf(z)} onChange={(r) => setCRects({ ...cRects, [z]: r })} /> : <small className="adm-dim">{t('app.loading')}</small>}
                              </div>
                              );
                            })}
                            {cZones.some((z) => z !== 'board' && !cGroup?.some((i) => SLOT_ZONE[i.slot] === z)) && <small className="adm-help wide">{t('admin.camp.imageRequired')}</small>}
                            
                            {!cGroup && <label><span>{t('admin.camp.durationAll')}</span>
                              <div className="adm-chips">
                                {(cGroup ? [0, 7, 14, 30, 90] : [7, 14, 30, 90]).map((d) => <button key={d} type="button" className={c.days === d && Object.keys(cDays).length === 0 ? 'on' : ''} onClick={() => { setC({ ...c, days: d }); setCDays({}); }}>{d === 0 ? t('admin.camp.keepEnd') : t('plots.days', { count: d })}</button>)}
                                <input className="days-input" type="number" min={1} max={365} inputMode="numeric" placeholder={t('admin.camp.daysFree')} aria-label={t('admin.camp.daysFree')} value={c.days > 0 && ![7, 14, 30, 90].includes(c.days) ? c.days : ''} onChange={(e) => { const v = Math.min(365, Math.max(0, Math.round(Number(e.target.value) || 0))); setC({ ...c, days: v }); setCDays({}); }} />
                              </div>
                            </label>}
                            {(() => {
                              // Une ligne par emplacement choisi, chacun avec sa durée : 3 jours sur un panneau, 5 en mer, etc.
                              const rows = [
                                ...(cZones.includes('board') ? (cSlots.includes('all') ? ['b:all'] : [...cSlots].sort((x, y) => Number(x) - Number(y)).map((x) => `b:${x}`)) : []),
                                ...cZones.filter((z) => z !== 'board').map((z) => `z:${z}`),
                              ];
                              if (rows.length === 0) return null;
                              const label = (k0: string) => { const k = cGroup && editSlot !== null && k0 === keyOfSlot(cGroup[0]!.slot) ? keyOfSlot(editSlot) : k0; return (k === 'b:all' ? `${t('ads.where.board')} · ${t('admin.camp.allBoards')}` : k.startsWith('b:') ? `${t('ads.where.board')} #${k.slice(2)}` : t(`ads.where.${k.slice(2)}`)); };
                              return (
                                <div className="wide camp-days">
                                  <strong>{t('admin.camp.durationEach')}</strong>
                                  {rows.map((k) => (
                                    <div key={k} className="camp-days-row">
                                      <span>{label(k)}</span>
                                      <div className="adm-chips">
                                        {(cGroup && cGroup.some((i) => keyOfSlot(i.slot) === k) ? [0, 1, 2, 3, 5, 7, 14, 30, 90] : [1, 2, 3, 5, 7, 14, 30, 90]).map((d) => <button key={d} type="button" className={daysFor(k) === d ? 'on' : ''} onClick={() => setCDays({ ...cDays, [k]: d })}>{d === 0 ? t('admin.camp.keepEnd') : t('plots.days', { count: d })}</button>)}
                                        <input className="days-input" type="number" min={1} max={365} inputMode="numeric" placeholder={t('admin.camp.daysFree')} aria-label={t('admin.camp.daysFree')} value={![0, 1, 2, 3, 5, 7, 14, 30, 90].includes(daysFor(k)) ? daysFor(k) : ''} onChange={(e) => { const v = Math.min(365, Math.max(0, Math.round(Number(e.target.value) || 0))); setCDays({ ...cDays, [k]: v }); }} />
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              );
                            })()}
                          </div>
                        </fieldset>
                        <fieldset className="camp-group">
                          <legend>{t('admin.camp.what')}</legend>
                          <div className="adm-fields two">
                            <label><span>{t('admin.f.title')} <small className="adm-dim">{c.title.length}/40</small></span><input value={c.title} onChange={(e) => setC({ ...c, title: e.target.value })} maxLength={40} required /></label>
                            <label><span>{t('admin.f.subtitle')} <small className="adm-dim">{c.subtitle.length}/80</small></span><input value={c.subtitle} onChange={(e) => setC({ ...c, subtitle: e.target.value })} maxLength={80} /></label>
                            <label className="wide"><span>{t('admin.f.url')}</span><input type="url" placeholder="https://…" value={c.url} onChange={(e) => setC({ ...c, url: e.target.value })} maxLength={200} /></label>
                          </div>
                        </fieldset>
                        <fieldset className="camp-group">
                          <legend>{t('admin.camp.look')}</legend>
                          <div className="camp-colors">
                            {(['bg', 'fg'] as const).map((key) => (
                              <div key={key} className="camp-color">
                                <span>{t(key === 'bg' ? 'admin.f.bg' : 'admin.f.fg')}</span>
                                <div>
                                  {(key === 'bg' ? ['#0a7d4f', '#006a4e', '#d21034', '#ffce00', '#0f172a', '#7c3aed', '#ea580c'] : ['#ffffff', '#0f172a', '#ffce00']).map((col) => (
                                    <button key={col} type="button" className={`swatch${c[key] === col ? ' on' : ''}`} style={{ background: col }} onClick={() => setC({ ...c, [key]: col })} aria-label={col} />
                                  ))}
                                  <label className="swatch custom" title={t('admin.camp.custom')}><input type="color" value={c[key]} onChange={(e) => setC({ ...c, [key]: e.target.value })} /></label>
                                </div>
                              </div>
                            ))}
                          </div>
                          <div
                            className={`camp-drop${cImg ? ' has' : ''}`}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void pickImage(f); }}
                          >
                            <Icon name="image" size={20} />
                            <div>
                              <strong>{cImg ? t('admin.camp.imageReady') : t('admin.camp.image')}</strong>
                              <small>{t('admin.camp.imageHelp')}</small>
                            </div>
                            <label className="adm-btn">{cImg ? t('book.changeImage') : t('book.addImage')}<input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void pickImage(f); e.target.value = ''; }} /></label>
                            {cImg && <button type="button" className="adm-btn danger" onClick={() => setCImg(null)}>{t('book.removeImage')}</button>}
                          </div>
                        </fieldset>
                      </div>
                      <div className="camp-preview">
                        <small className="adm-dim">{t('admin.camp.preview')}</small>
                        <div className="camp-board">
                          <div className="camp-screen" style={{ background: cImgUrl ? `center / cover url(${cImgUrl})` : c.bg, color: c.fg }}>
                            {!cImgUrl && <><strong>{c.title || t('admin.f.title')}</strong>{c.subtitle && <span>{c.subtitle}</span>}</>}
                          </div>
                          <i className="camp-leg" /><i className="camp-leg" />
                        </div>
                        <dl className="camp-sum">
                          <dt>{t('admin.f.partner')}</dt><dd>{partners.find((x) => x.id === c.partnerId)?.name ?? '—'}</dd>
                          <dt>{t('admin.camp.where')}</dt><dd>{[
                            ...(cZones.includes('board') && cSlots.length > 0 ? [cSlots.includes('all') ? t('admin.camp.allBoards') : [...cSlots].sort((x, y) => Number(x) - Number(y)).map((n) => `${t('admin.camp.boardNo')} ${n}`).join(', ')] : []),
                            ...cZones.filter((z) => z !== 'board').map((z) => { const o = cGroup?.find((i) => SLOT_ZONE[i.slot] === z); const r = o ? (cRows[o.id] ?? { x: o.plotX ?? 0, y: o.plotY ?? 0, w: o.plotW ?? 0, h: o.plotH ?? 0 }) : rectOf(z); return `${t(`ads.where.${z}`)} · ${t('admin.camp.cells', { x: r.x + 1, y: r.y + 1, w: r.w, h: r.h })}`; }),
                          ].join(' ; ') || '—'}</dd>
                          <dt>{t('admin.camp.until')}</dt><dd>{(cGroup && c.days === 0 ? new Date(Math.max(...cGroup.map((i) => +new Date(i.endsAt)))) : new Date(Date.now() + c.days * 86_400_000)).toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' })}</dd>
                        </dl>
                      </div>
                    </div>
                    <div className="adm-form-foot"><button type="button" className="adm-btn" onClick={() => { setOpenForm(false); setCGroup(null); setCDays({}); }}>{t('app.cancel')}</button><button className="adm-btn primary" disabled={!c.partnerId || c.title.trim().length < 2 || cZones.length === 0 || (!cGroup && cZones.some((z) => z !== 'board') && !cImg) || (cZones.includes('board') && cSlots.length === 0)}>{cGroup ? t('admin.camp.save') : t('admin.addCampaign')}</button></div>
                  </form>
                )}
                {/* Pendant la modification d'une campagne, la liste disparaît : on édite, puis on revient à la liste */}
                {!(openForm && cGroup) && (
                <section className="adm-card flush">
                  <div className="adm-toolbar">
                    <SearchBox value={q} onChange={setQ} />
                    <PeriodPicker value={per} onChange={(v) => { setPer(v); setPage(0); }} />
                  </div>
                  <div className="adm-toolbar">
                    <div className="adm-chips">
                      {CSTATUS.map((k) => (
                        <button key={k} className={cStatus === k ? 'on' : ''} onClick={() => { setCStatus(k); setPage(0); }}>
                          {k === 'ALL' ? t('admin.all') : t(`admin.status.${k}`)} <em>{k === 'ALL' ? campaigns.length : campaigns.filter((x) => x.status === k).length}</em>
                        </button>
                      ))}
                    </div>
                    <div className="adm-select-wrap"><SearchSelect value={cPlace} options={[{ value: 'ALL', label: t('admin.allPlaces') }, ...['board', 'sea', 'east', 'lac_ouest', 'lac_est', 'lac_lions_ouest', 'lac_lions_est'].map((k) => ({ value: k, label: t(`ads.where.${k}`) }))]} onChange={(v) => { setCPlace(v); setPage(0); }} placeholder={t('admin.allPlaces')} searchLabel={t('admin.ss.search')} empty={t('admin.ss.empty')} /></div>
                  </div>
                  <table className="admin-table">
                    <thead><tr><th>{t('admin.f.title')}</th><th>{t('admin.f.partner')}</th><th>{t('admin.f.place')}</th><th>{t('admin.f.status')}</th><th className="num">{t('admin.f.views')}</th><th className="num">{t('admin.f.clicks')}</th><th>{t('admin.f.ends')}</th><th /></tr></thead>
                    <tbody>
                      {groups.slice(page * PAGE, page * PAGE + PAGE).map((g) => {
                        const x = g.items[0]!;
                        const ids = g.items.map((i) => i.id);
                        const statuses = [...new Set(g.items.map((i) => i.status))];
                        const status = statuses.length === 1 ? statuses[0]! : 'MIXED';
                        const boards = g.items.filter((i) => i.slot >= -1);
                        const zones = [...new Set(g.items.filter((i) => i.slot < -1).map((i) => placeOf(i.slot)))];
                        const imageOf = g.items.find((i) => i.hasImage);
                        const pending = g.items.filter((i) => i.status === 'PENDING').map((i) => i.id);
                        const live = g.items.filter((i) => i.status === 'APPROVED').map((i) => i.id);
                        return (
                        <tr key={g.key}>
                          <td>
                            <div className="camp-card">
                              <span className="camp-thumb" style={{ background: `linear-gradient(135deg, ${x.bg}, ${x.bg}cc)`, color: x.fg }} aria-hidden="true">
                                <b>{x.title}</b>
                                {x.subtitle && <i>{x.subtitle}</i>}
                              </span>
                              <span className="camp-meta"><strong>{x.title}</strong><small>{x.subtitle || x.partner.name}</small></span>
                            </div>
                          </td>
                          <td><strong className="camp-partner">{x.partner.name}</strong></td>
                          <td>
                            <div className="camp-places">
                              {boards.length > 0 && <span className="adm-tag camp-place" title={boards.map((i) => (i.slot === -1 ? t('admin.camp.allBoards') : `#${i.slot}`)).join(', ')}>🪧 {t('ads.where.board')} {boards.some((i) => i.slot === -1) ? t('admin.camp.allBoards') : `${boards.length > 1 ? '#' : '#'}${ranges(boards.map((i) => i.slot))}`}{boards.length > 1 && ` (${boards.length})`}</span>}
                              {zones.map((z) => <span key={z} className="adm-tag camp-place">{z === 'sea' ? '🌊' : z.startsWith('lac') ? '🛶' : '📢'} {t(`ads.where.${z}`)}</span>)}
                            </div>
                          </td>
                          <td><span className={`adm-status s-${status}`}>{status === 'MIXED' ? t('admin.status.MIXED') : t(`admin.status.${status}`)}</span></td>
                          <td className="num">{g.items.reduce((n, i) => n + i.views, 0)}</td><td className="num">{g.items.reduce((n, i) => n + i.clicks, 0)}</td>
                          <td className="adm-dim">{new Date(Math.max(...g.items.map((i) => +new Date(i.endsAt)))).toLocaleDateString(i18n.language)}</td>
                          <td className="row-actions"><div className="row-actions-in">
                            {g.items.some((i) => i.status !== 'AWAITING_PAYMENT') && !g.items.some((i) => i.purchaseId) && <button className="adm-btn icon" title={t('admin.camp.edit')} aria-label={t('admin.camp.edit')} onClick={() => startEdit(g)}><Icon name="edit" size={16} /></button>}
                            {imageOf && <button className="adm-btn icon" title={t('admin.image')} onClick={() => void showImage(imageOf.id)}><Icon name="image" size={16} /></button>}
                            <label className="adm-btn icon" title={imageOf ? t('book.changeImage') : t('book.addImage')}>
                              <Icon name="plus" size={16} />
                              <input type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={async (e) => {
                                const f = e.target.files?.[0];
                                e.target.value = '';
                                if (!f) return;
                                try {
                                  const blob = await prepareAdImage(f);
                                  // Même affiche pour tous les emplacements de la campagne
                                  let ok = true;
                                  for (const id of ids) if (!(await call(() => api(`/admin/campaigns/${id}/image`, { method: 'POST', auth: true, blob })))) ok = false;
                                  if (ok) { setNotice(t('admin.saved')); void load(); }
                                } catch {
                                  setError(errorText('invalid_image'));
                                }
                              }} />
                            </label>
                            {pending.length > 0 && <button className="adm-btn primary" onClick={() => void setStatusMany(pending, 'APPROVED')}>{t('admin.approve')}</button>}
                            {pending.length > 0 && <button className="adm-btn" onClick={() => void setStatusMany(pending, 'REJECTED')}>{t('admin.reject')}</button>}
                            {live.length > 0 && <button className="adm-btn danger" onClick={() => void setStatusMany(live, 'ENDED')}>{t('admin.end')}</button>}
                          </div></td>
                        </tr>
                        );
                      })}
                    </tbody>
                  </table>
                  {groups.length === 0 && <p className="adm-empty pad">{t('admin.none')}</p>}
                  {groups.length > PAGE && (
                    <div className="adm-pager">
                      <small>{t('admin.range', { from: page * PAGE + 1, to: Math.min(groups.length, page * PAGE + PAGE), n: groups.length })}</small>
                      <div>
                        <button className="adm-btn" disabled={page === 0} onClick={() => setPage(page - 1)}>{t('admin.prev')}</button>
                        <button className="adm-btn" disabled={(page + 1) * PAGE >= groups.length} onClick={() => setPage(page + 1)}>{t('admin.next')}</button>
                      </div>
                    </div>
                  )}
                </section>
                )}
              </>
            )}

            {sub === 'offers' && (
              <>
                {openForm && (
                  <form className="adm-card adm-form" onSubmit={addOffer}>
                    <h3>{t('admin.new.offers')}</h3>
                    <div className="adm-fields">
                      <label><span>{t('admin.f.partner')}</span><SearchSelect value={o.partnerId} options={partners.filter((x) => x.tier !== 'NONE').map((x) => ({ value: x.id, label: x.name, hint: t(`partners.tier.${x.tier}`) }))} onChange={(v) => setO({ ...o, partnerId: v })} placeholder="—" searchLabel={t('admin.ss.search')} empty={t('admin.offerNoPartner')} /></label>
                      
                      <label><span>{t('admin.f.title')}</span><input value={o.title} onChange={(e) => setO({ ...o, title: e.target.value })} minLength={2} maxLength={80} required /></label>
                      <label><span>{t('admin.f.place')}</span><input value={o.place} onChange={(e) => setO({ ...o, place: e.target.value })} minLength={2} maxLength={80} required /></label>
                      <label className="wide"><span>{t('admin.f.body')}</span><textarea rows={3} value={o.body} onChange={(e) => setO({ ...o, body: e.target.value })} minLength={2} maxLength={400} required /></label>
                      <label><span>{t('admin.f.url')}</span><input placeholder="https://…" value={o.url} onChange={(e) => setO({ ...o, url: e.target.value })} maxLength={200} /></label>
                      {o.kind === 'EVENT' && <label><span>{t('admin.f.date')}</span><input type="datetime-local" value={o.happensAt} onChange={(e) => setO({ ...o, happensAt: e.target.value })} required /></label>}
                      <label><span>{t('admin.f.days')}</span><input type="number" min={1} max={365} value={o.days} onChange={(e) => setO({ ...o, days: Number(e.target.value) })} /></label>
                    </div>
                    <div className="adm-form-foot"><button type="button" className="adm-btn" onClick={() => setOpenForm(false)}>{t('app.cancel')}</button><button className="adm-btn primary" disabled={!o.partnerId}>{t('admin.addOffer')}</button></div>
                  </form>
                )}
                <section className="adm-card flush">
                  <div className="adm-toolbar"><SearchBox value={q} onChange={setQ} /></div>
                  <table className="admin-table">
                    <thead><tr><th>{t('admin.f.title')}</th><th>{t('admin.f.partner')}</th><th>{t('admin.f.kind')}</th><th className="num">{t('admin.f.clicks')}</th><th>{t('admin.f.ends')}</th><th /></tr></thead>
                    <tbody>
                      {offers.filter((x) => match(x.title, x.partner.name, x.place)).map((x) => (
                        <tr key={x.id} className={x.active ? '' : 'off'}>
                          <td><strong>{x.title}</strong><small className="adm-dim adm-block">{x.place}</small></td>
                          <td>{x.partner.name}</td>
                          <td><span className="adm-tag">{t(`admin.offerKind.${x.kind}`)}</span></td>
                          <td className="num">{x.clicks}</td>
                          <td className="adm-dim">{new Date(x.endsAt).toLocaleDateString(i18n.language)}</td>
                          <td className="row-actions"><button className="adm-btn" onClick={() => void toggleOffer(x)}>{x.active ? t('admin.deactivate') : t('admin.activate')}</button></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {offers.length === 0 && <p className="adm-empty pad">{t('admin.none')}</p>}
                </section>
              </>
            )}
          </div>
        )}

        {tab === 'products' && (
          <div className="adm-stack">
            <div className="adm-seg">
              <p className="adm-help">{t('admin.productsHelp')}</p>
              <span className="adm-grow" />
              <button className="adm-btn primary" onClick={() => setOpenForm((v) => !v)}><Icon name="plus" size={16} /> {t('admin.new.product')}</button>
            </div>
            {openForm && (
              <form className="adm-card adm-form" onSubmit={addProduct}>
                <h3>{t('admin.new.product')}</h3>
                <div className="adm-fields">
                  <label><span>{t('admin.f.nameFr')}</span><input value={np.nameFr} onChange={(e) => setNp({ ...np, nameFr: e.target.value })} minLength={2} maxLength={64} required /></label>
                  <label><span>{t('admin.f.nameEn')}</span><input value={np.nameEn} onChange={(e) => setNp({ ...np, nameEn: e.target.value })} minLength={2} maxLength={64} required /></label>
                  <label><span>{t('admin.f.price')} (FCFA)</span><input type="number" min={1} step={1} value={np.priceAmount} onChange={(e) => setNp({ ...np, priceAmount: Math.max(1, Math.round(Number(e.target.value) || 1)) })} required /></label>
                  <label><span>{t('admin.f.coins')}</span><input type="number" min={1} step={1} value={np.coinsGranted} onChange={(e) => setNp({ ...np, coinsGranted: Math.max(1, Math.round(Number(e.target.value) || 1)) })} required /></label>
                </div>
                <small className="adm-help">{t('admin.newProductHelp')}</small>
                <div className="adm-form-foot"><button type="button" className="adm-btn" onClick={() => setOpenForm(false)}>{t('app.cancel')}</button><button className="adm-btn primary">{t('admin.create')}</button></div>
              </form>
            )}
          <div className="adm-products">
            {products.map((pr) => {
              const orig = savedProducts.find((x) => x.id === pr.id);
              const dirty = !!orig && (orig.priceAmount !== pr.priceAmount || orig.active !== pr.active || orig.coinsGranted !== pr.coinsGranted);
              const edit = (patch: Partial<ProductRow>) => setProducts(products.map((x) => (x.id === pr.id ? { ...x, ...patch } : x)));
              return (
                <section key={pr.id} className={`adm-card adm-product${pr.active ? '' : ' off'}`}>
                  <div className="adm-product-head">
                    <i className={`k-${pr.kind}`}><Icon name={PRODUCT_ICON[pr.kind] ?? 'products'} size={18} /></i>
                    <div><strong>{i18n.language === 'en' ? pr.nameEn : pr.nameFr}</strong><small>{t(`admin.kinds.${pr.kind}`, { defaultValue: pr.kind })}</small></div>
                    <label className="adm-switch" title={t('admin.f.active')}>
                      <input type="checkbox" checked={pr.active} onChange={(e) => edit({ active: e.target.checked })} />
                      <span />
                    </label>
                  </div>
                  <label className="adm-money">
                    <span>{t('admin.f.price')}</span>
                    <div><input type="number" min={1} step={1} value={pr.priceAmount} onChange={(e) => edit({ priceAmount: Math.max(1, Math.round(Number(e.target.value) || 1)) })} /><em>{pr.currency === 'XOF' ? 'FCFA' : pr.currency}</em></div>
                  </label>
                  {pr.kind === 'COINS' && (
                    <label className="adm-money">
                      <span>{t('admin.f.coins')}</span>
                      <div><input type="number" min={1} step={1} value={pr.coinsGranted} onChange={(e) => edit({ coinsGranted: Math.max(1, Math.round(Number(e.target.value) || 1)) })} /><em>FCFA</em></div>
                    </label>
                  )}
                  <div className="adm-form-foot">
                    {dirty && <button className="adm-btn" onClick={() => orig && edit(orig)}>{t('app.cancel')}</button>}
                    <button className="adm-btn primary" disabled={!dirty} onClick={() => void call(() => api(`/admin/products/${encodeURIComponent(pr.id)}`, { method: 'PUT', auth: true, body: { priceAmount: pr.priceAmount, active: pr.active, ...(pr.kind === 'COINS' ? { coinsGranted: pr.coinsGranted } : {}) } })).then((r) => { if (r) { setNotice(t('admin.saved')); setSavedProducts(products); } })}>
                      {t('admin.save')}
                    </button>
                  </div>
                </section>
              );
            })}
          </div>
          </div>
        )}

        {tab === 'tenders' && (
          <div className="adm-stack">
            <div className="adm-seg">
              <p className="adm-help">{t('admin.tendersHelp')}</p>
              <span className="adm-grow" />
              <button className="adm-btn primary" onClick={() => setOpenForm((v) => !v)}><Icon name="plus" size={16} /> {t('admin.new.tender')}</button>
            </div>
            {openForm && (
              <form
                className="adm-card adm-form"
                onSubmit={(ev) => {
                  ev.preventDefault();
                  void call(() => api('/admin/tenders', { method: 'POST', auth: true, body: tf })).then((r) => {
                    if (r) {
                      setNotice(t('admin.created'));
                      setOpenForm(false);
                      setTf({ sector: 'pagnes', sectors: [], titleFr: '', titleEn: '', descriptionFr: '', descriptionEn: '', slots: 2, maxBudget: 500_000, maxHours: 48, requiredSessions: 5, applicationWindowGameHours: 24 });
                      void load();
                    }
                  });
                }}
              >
                <h3>{t('admin.new.tender')}</h3>
                <div className="adm-fields">
                  <label><span>{t('admin.f.sector')}</span>
                    <SearchSelect
                      value={tf.sector}
                      options={(settings['company.activities'] as { id: string; nameFr: string; nameEn: string }[] | undefined ?? []).map((a) => ({ value: a.id, label: i18n.language === 'en' ? a.nameEn : a.nameFr }))}
                      onChange={(v) => setTf({ ...tf, sector: v })}
                      placeholder={t('admin.f.sector')}
                      searchLabel={t('admin.ss.search')}
                      empty={t('admin.ss.empty')}
                    />
                  </label>
                  <fieldset className="adm-field-wide adm-sectors">
                    <legend>{t('admin.f.moreSectors')}</legend>
                    <small className="adm-help">{t('admin.f.moreSectorsHelp')}</small>
                    <div className="chips">
                      {(settings['company.activities'] as { id: string; nameFr: string; nameEn: string }[] | undefined ?? []).filter((a) => a.id !== tf.sector).map((a) => {
                        const on = tf.sectors.includes(a.id);
                        return (
                          <button key={a.id} type="button" className={`chip-act ${on ? 'app' : ''}`} aria-pressed={on} onClick={() => setTf({ ...tf, sectors: on ? tf.sectors.filter((x) => x !== a.id) : [...tf.sectors, a.id] })}>
                            {i18n.language === 'en' ? a.nameEn : a.nameFr}
                          </button>
                        );
                      })}
                    </div>
                  </fieldset>
                  <label><span>{t('admin.f.titleFr')}</span><input type="text" minLength={2} maxLength={160} value={tf.titleFr} onChange={(e) => setTf({ ...tf, titleFr: e.target.value })} required /></label>
                  <label><span>{t('admin.f.titleEn')}</span><input type="text" minLength={2} maxLength={160} value={tf.titleEn} onChange={(e) => setTf({ ...tf, titleEn: e.target.value })} required /></label>
                  <label className="adm-field-wide"><span>{t('admin.f.descriptionFr')}</span><textarea minLength={2} maxLength={600} value={tf.descriptionFr} onChange={(e) => setTf({ ...tf, descriptionFr: e.target.value })} required /></label>
                  <label className="adm-field-wide"><span>{t('admin.f.descriptionEn')}</span><textarea minLength={2} maxLength={600} value={tf.descriptionEn} onChange={(e) => setTf({ ...tf, descriptionEn: e.target.value })} required /></label>
                  <label><span>{t('admin.f.slots')}</span><input type="number" min={1} max={50} step={1} value={tf.slots} onChange={(e) => setTf({ ...tf, slots: Math.max(1, Math.round(Number(e.target.value) || 1)) })} required /></label>
                  <label><span>{t('admin.f.maxBudget')} (FCFA)</span><input type="number" min={1} step={1} value={tf.maxBudget} onChange={(e) => setTf({ ...tf, maxBudget: Math.max(1, Math.round(Number(e.target.value) || 1)) })} required /></label>
                  <label><span>{t('admin.f.maxHours')}</span><input type="number" min={1} step={1} value={tf.maxHours} onChange={(e) => setTf({ ...tf, maxHours: Math.max(1, Math.round(Number(e.target.value) || 1)) })} required /></label>
                  <label><span>{t('admin.f.requiredSessions')}</span><input type="number" min={1} step={1} value={tf.requiredSessions} onChange={(e) => setTf({ ...tf, requiredSessions: Math.max(1, Math.round(Number(e.target.value) || 1)) })} required /></label>
                  <label><span>{t('admin.f.applicationWindowGameHours')}</span><input type="number" min={1} step={1} value={tf.applicationWindowGameHours} onChange={(e) => setTf({ ...tf, applicationWindowGameHours: Math.max(1, Math.round(Number(e.target.value) || 1)) })} required /></label>
                </div>
                <div className="adm-form-foot"><button type="button" className="adm-btn" onClick={() => setOpenForm(false)}>{t('app.cancel')}</button><button className="adm-btn primary">{t('admin.create')}</button></div>
              </form>
            )}
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t('admin.f.title')}</th><th>{t('admin.f.sector')}</th><th>{t('admin.f.slots')}</th><th>{t('admin.f.maxBudget')}</th><th>{t('admin.f.maxHours')}</th><th>{t('admin.f.requiredSessions')}</th>
                  <th>{t('tenders.deadline')}</th><th>{t('admin.f.applicants')}</th><th>{t('admin.f.status')}</th><th />
                </tr>
              </thead>
              <tbody>
                {tenders.map((tr) => (
                  <Fragment key={tr.id}>
                    <tr>
                      <td>{i18n.language === 'en' ? tr.titleEn : tr.titleFr}<div className="adm-dim">{[tr.sector, ...(tr.sectors ?? [])].join(' · ')}</div></td>
                      <td>{[tr.sector, ...(tr.sectors ?? [])].join(', ')}</td>
                      <td>{tr.slots}</td>
                      <td>{fcfa(tr.maxBudget)}</td>
                      <td>{tr.maxHours}</td>
                      <td>{tr.requiredSessions}</td>
                      <td className="adm-dim">{new Date(tr.applicationDeadlineAt).toLocaleString(i18n.language)}</td>
                      <td>{tr.applicants}</td>
                      <td><span className={`adm-pill ${tr.status.toLowerCase()}`}>{t(`tenders.status.${tr.status}`)}</span></td>
                      <td>
                        <button
                          className="adm-btn"
                          onClick={() => {
                            const next = openTenderApps === tr.id ? null : tr.id;
                            setOpenTenderApps(next);
                            if (next && !tenderApps[tr.id]) void call(() => api<TenderApplicationRow[]>(`/admin/tenders/${tr.id}/applications`, { auth: true })).then((r) => { if (r) setTenderApps((m) => ({ ...m, [tr.id]: r })); });
                          }}
                        >
                          {openTenderApps === tr.id ? t('admin.tendersHide') : t('admin.tendersView')}
                        </button>
                        {tr.status === 'OPEN' && (
                          <button className="adm-btn danger" onClick={() => void call(() => api(`/admin/tenders/${tr.id}/cancel`, { method: 'POST', auth: true })).then((r) => { if (r) { setNotice(t('admin.saved')); void load(); } })}>
                            {t('app.cancel')}
                          </button>
                        )}
                      </td>
                    </tr>
                    {openTenderApps === tr.id && (
                      <tr>
                        <td colSpan={10}>
                          {!tenderApps[tr.id]?.length ? (
                            <p className="adm-dim">{t('admin.tendersNoApplications')}</p>
                          ) : (
                            <table className="admin-table">
                              <thead><tr><th>{t('admin.f.company')}</th><th>{t('admin.f.proposedPrice')}</th><th>{t('tenders.proposedHours')}</th><th>{t('admin.f.status')}</th><th>{t('tenders.score')}</th><th>{t('admin.f.requiredSessions')}</th></tr></thead>
                              <tbody>
                                {tenderApps[tr.id]!.map((ap) => (
                                  <tr key={ap.id}>
                                    <td>{ap.company}</td>
                                    <td>{fcfa(ap.proposedPrice)}</td>
                                    <td>{ap.proposedHours}</td>
                                    <td>{t(`tenders.appStatus.${ap.status}`)}</td>
                                    <td className="mono">{ap.score.toFixed(1)}</td>
                                    <td>{ap.sessionsCompleted} / {ap.sessionsRequired}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            </table>
            {tenders.length === 0 && <p className="adm-dim">{t('admin.tendersEmpty')}</p>}
          </div>
        )}

        {tab === 'jobs' && (
          <div className="adm-stack">
            <div className="adm-seg">
              <p className="adm-help">{t('admin.jobs.help')}</p>
              {jobsView && !jobEdit && (
                <div className="adm-jobs-actions">
                  <button type="button" className="adm-btn primary" onClick={() => setJobEdit({ kind: 'job', isNew: true, f: { ...NEW_JOB } })}>＋ {t('admin.jobs.newJob')}</button>
                  <button type="button" className={`adm-btn${jobsView.config.enabled ? ' on' : ''}`} onClick={async () => {
                    const next = { ...jobsView.config, enabled: !jobsView.config.enabled };
                    if (await call(() => api('/admin/settings/jobs.public', { method: 'PUT', auth: true, body: { value: next } }))) void load();
                  }}>{jobsView.config.enabled ? t('admin.jobs.publicOn') : t('admin.jobs.publicOff')}</button>
                </div>
              )}
            </div>
            {jobsView && jobEdit && (
              <form className="adm-card adm-form" onSubmit={(e) => { e.preventDefault(); void saveJob(); }}>
                <div className="adm-card-head">
                  <h3>{jobEdit.kind === 'job' ? (jobEdit.isNew ? t('admin.jobs.newJob') : t('admin.jobs.editJob', { name: jobEdit.f.nameFr })) : t('admin.jobs.editOffer', { company: jobEdit.company })}</h3>
                  <small className="adm-help">{jobEdit.kind === 'job' ? t('admin.jobs.jobHelp') : t('admin.jobs.offerHelp', { min: fcfa(jobsView.rules.minGross), max: fcfa(jobsView.rules.maxGross) })}</small>
                </div>
                {jobEdit.kind === 'offer' ? (
                  <div className="adm-fields">
                    <label><span>{t('admin.jobs.roleFr')}</span><input value={jobEdit.f.roleFr} maxLength={48} required onChange={(e) => setJobEdit({ ...jobEdit, f: { ...jobEdit.f, roleFr: e.target.value } })} /></label>
                    <label><span>{t('admin.jobs.roleEn')}</span><input value={jobEdit.f.roleEn} maxLength={48} required onChange={(e) => setJobEdit({ ...jobEdit, f: { ...jobEdit.f, roleEn: e.target.value } })} /></label>
                    <label><span>{t('admin.jobs.gross')}</span><input type="number" min={jobsView.rules.minGross} max={jobsView.rules.maxGross} step={500} value={jobEdit.f.grossMonthly} required onChange={(e) => setJobEdit({ ...jobEdit, f: { ...jobEdit.f, grossMonthly: Number(e.target.value) } })} /></label>
                  </div>
                ) : (() => {
                  const f = jobEdit.f;
                  const set = (patch: Partial<JobCatalogRow>) => setJobEdit({ ...jobEdit, f: { ...f, ...patch } });
                  const num = (k: 'payPerShift' | 'energyCost' | 'hungerCost' | 'hygieneCost' | 'shiftGameHours' | 'riskPercent', max: number, min = 0) => (
                    <label key={k}><span>{t(`admin.jobs.f.${k}`)}</span><input type="number" min={min} max={max} value={f[k]} required onChange={(e) => set({ [k]: Number(e.target.value) } as Partial<JobCatalogRow>)} /></label>
                  );
                  const cats = [...new Set(jobsView.catalog.map((j) => j.category))].sort();
                  return (
                    <div className="adm-fields">
                      {jobEdit.isNew && <label><span>{t('admin.jobs.f.id')}</span><input value={f.id} pattern="[a-z0-9_]{2,32}" maxLength={32} placeholder="agent_exemple" required onChange={(e) => set({ id: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} /><small className="adm-dim">{t('admin.jobs.f.idHint')}</small></label>}
                      <label><span>{t('admin.jobs.roleFr')}</span><input value={f.nameFr} maxLength={64} required onChange={(e) => set({ nameFr: e.target.value })} /></label>
                      <label><span>{t('admin.jobs.roleEn')}</span><input value={f.nameEn} maxLength={64} required onChange={(e) => set({ nameEn: e.target.value })} /></label>
                      <label><span>{t('admin.jobs.f.level')}</span>
                        <SearchSelect
                          value={f.level}
                          options={['DEBROUILLE', 'QUALIFIE', 'DIPLOME', 'ENTREPRENEUR'].map((l) => ({ value: l, label: t(`work.levels.${l}`, { defaultValue: l }) }))}
                          onChange={(v) => set({ level: v })}
                          placeholder={t('admin.jobs.f.level')}
                          searchLabel={t('admin.ss.search')}
                          empty={t('admin.ss.empty')}
                        />
                      </label>
                      <label><span>{t('admin.jobs.f.venue')}</span>
                        <SearchSelect
                          value={f.venueId ?? ''}
                          options={[{ value: '', label: t('admin.jobs.f.noVenue') }, ...venueList.map((v) => ({ value: v.id, label: i18n.language === 'en' ? v.nameEn : v.nameFr }))]}
                          onChange={(v) => set({ venueId: v || null })}
                          placeholder={t('admin.jobs.f.noVenue')}
                          searchLabel={t('admin.ss.search')}
                          empty={t('admin.ss.empty')}
                        />
                      </label>
                      {num('payPerShift', 10_000_000)}
                      {num('shiftGameHours', 48, 1)}
                      {num('energyCost', 100)}
                      {num('hungerCost', 100)}
                      {num('hygieneCost', 100)}
                      {num('riskPercent', 100)}
                      <label><span>{t('admin.jobs.f.category')}</span><input list="job-cats" value={f.category} pattern="[a-z0-9_]{2,24}" required onChange={(e) => set({ category: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })} /><datalist id="job-cats">{cats.map((c) => <option key={c} value={c} />)}</datalist></label>
                      <label><span>{t('admin.jobs.f.emoji')}</span><input value={f.emoji} maxLength={8} required onChange={(e) => set({ emoji: e.target.value })} /></label>
                      <fieldset className="wide adm-diploma" disabled={f.level === 'DEBROUILLE'}>
                        <legend>{t('admin.jobs.f.diploma')}</legend>
                        {f.level === 'DEBROUILLE' ? (
                          <small className="adm-dim">{t('admin.jobs.f.diplomaNone')}</small>
                        ) : (
                          <>
                            {f.reqs.length === 0 && <small className="adm-dim">{t('admin.jobs.f.diplomaEmpty')}</small>}
                            {f.reqs.map((opt, idx) => {
                              const setOpt = (patch: Partial<{ min: string; domains?: string[] }>) => set({ reqs: f.reqs.map((o, k) => (k === idx ? { ...o, ...patch } : o)) });
                              return (
                                <div key={idx} className="adm-diploma-opt">
                                  <div className="adm-diploma-head">
                                    <strong>{idx === 0 ? t('admin.jobs.f.diplomaOpt', { n: idx + 1 }) : `${t('work.or').toUpperCase()} · ${t('admin.jobs.f.diplomaOpt', { n: idx + 1 })}`}</strong>
                                    <button type="button" className="adm-btn danger small" onClick={() => set({ reqs: f.reqs.filter((_, k) => k !== idx) })}>{t('admin.jobs.f.removeOpt')}</button>
                                  </div>
                                  <label><span>{t('admin.jobs.f.diplomaMin')}</span>
                                    <SearchSelect
                                      value={opt.min}
                                      options={['BT', 'BTS', 'LICENCE', 'MASTER', 'DOCTORAT'].map((k) => ({ value: k, label: t(`study.kind.${k}`) }))}
                                      onChange={(v) => setOpt({ min: v })}
                                      placeholder={t('admin.jobs.f.diplomaMin')}
                                      searchLabel={t('admin.ss.search')}
                                      empty={t('admin.ss.empty')}
                                    />
                                  </label>
                                  <div className="adm-domains">
                                    <span>{t('admin.jobs.f.diplomaDomains')}</span>
                                    <div className="adm-chips adm-chips-wrap">
                                      {(opt.domains ?? []).map((id) => {
                                        const d = jobsView.domains.find((x) => x.id === id);
                                        return (
                                          <button key={id} type="button" className="on" title={t('admin.jobs.f.removeDomain')} onClick={() => { const rest = (opt.domains ?? []).filter((x) => x !== id); setOpt({ domains: rest.length ? rest : undefined }); }}>
                                            {d?.emoji} {d ? (i18n.language === 'en' ? d.nameEn : d.nameFr) : id} ✕
                                          </button>
                                        );
                                      })}
                                      {(opt.domains ?? []).length === 0 && <small className="adm-dim">{t('admin.jobs.f.allDomains')}</small>}
                                    </div>
                                    <SearchSelect
                                      value=""
                                      options={jobsView.domains.filter((d) => !(opt.domains ?? []).includes(d.id)).map((d) => ({ value: d.id, label: `${d.emoji} ${i18n.language === 'en' ? d.nameEn : d.nameFr}` }))}
                                      onChange={(v) => v && setOpt({ domains: [...(opt.domains ?? []), v] })}
                                      placeholder={t('admin.jobs.f.addDomain')}
                                      searchLabel={t('admin.ss.search')}
                                      empty={t('admin.ss.empty')}
                                    />
                                  </div>
                                </div>
                              );
                            })}
                            <button type="button" className="adm-btn" onClick={() => set({ reqs: [...f.reqs, { min: 'LICENCE' }] })}>＋ {t('admin.jobs.f.addOpt')}</button>
                            <small className="adm-dim">{t('admin.jobs.f.diplomaHelp')}</small>
                          </>
                        )}
                      </fieldset>
                      <label className="wide"><span>{t('admin.jobs.f.descFr')}</span><input value={f.descFr} maxLength={280} onChange={(e) => set({ descFr: e.target.value })} /></label>
                      <label className="wide"><span>{t('admin.jobs.f.descEn')}</span><input value={f.descEn} maxLength={280} onChange={(e) => set({ descEn: e.target.value })} /></label>
                      <label className="adm-check"><input type="checkbox" checked={f.enabled} onChange={(e) => set({ enabled: e.target.checked })} /> {t('admin.jobs.f.enabled')}</label>
                    </div>
                  );
                })()}
                <div className="adm-form-foot">
                  {jobEdit.kind === 'offer' && <button type="button" className="adm-btn danger" onClick={() => void withdrawOffer(jobEdit.id)}>{t('admin.jobs.withdraw')}</button>}
                  <span className="adm-grow" />
                  <button type="button" className="adm-btn" onClick={() => setJobEdit(null)}>{t('app.cancel')}</button>
                  <button className="adm-btn primary">{t('admin.camp.save')}</button>
                </div>
              </form>
            )}
            {jobsView && !jobEdit && (
              <>
                <div className="adm-filters adm-jobs-filters">
                  <div className="adm-chips">
                    {(['ALL', 'PUBLIC', 'PLAYER'] as const).map((k) => (
                      <button key={k} type="button" className={jobsKind === k ? 'on' : ''} onClick={() => setJobsKind(k)}>
                        {t(`admin.jobs.kind.${k}`)} <small>{jobsView.offers.filter((o) => k === 'ALL' || o.kind === k).length}</small>
                      </button>
                    ))}
                  </div>
                  <div className="adm-chips">
                    {['ALL', 'DEBROUILLE', 'QUALIFIE', 'DIPLOME'].map((k) => (
                      <button key={k} type="button" className={jobsLevel === k ? 'on' : ''} onClick={() => setJobsLevel(k)}>{k === 'ALL' ? t('admin.all') : t(`work.levels.${k}`, { defaultValue: k })}</button>
                    ))}
                  </div>
                  <SearchBox value={q} onChange={setQ} />
                </div>
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>{t('admin.jobs.role')}</th>
                      <th>{t('admin.jobs.employer')}</th>
                      <th>{t('admin.jobs.type')}</th>
                      <th>{t('admin.jobs.gross')}</th>
                      <th>{t('admin.jobs.net')}</th>
                      <th>{t('admin.f.status')}</th>
                      <th>{t('admin.jobs.employed')}</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {jobsView.offers
                      .filter((o) => (jobsKind === 'ALL' || o.kind === jobsKind) && (jobsLevel === 'ALL' || o.level === jobsLevel) && match(o.roleFr, o.roleEn, o.company, o.boss))
                      .map((o) => (
                        <tr key={o.id}>
                          <td><strong>{i18n.language === 'en' ? o.roleEn : o.roleFr}</strong></td>
                          <td>{o.kind === 'PUBLIC' ? (o.venueId ? (i18n.language === 'en' ? o.venueEn : o.venueFr) ?? o.venueId : t('work.publicEmployer')) : o.company}{o.kind === 'PLAYER' && <div className="adm-dim">{o.boss}</div>}</td>
                          <td><span className="adm-pill">{o.kind === 'PUBLIC' ? `${t('admin.jobs.kind.PUBLIC')} · ${t(`work.levels.${o.level}`, { defaultValue: o.level ?? '' })}` : t('admin.jobs.kind.PLAYER')}</span></td>
                          <td>{fcfa(o.gross)}</td>
                          <td>{fcfa(o.net)}</td>
                          <td><span className={`adm-status s-${o.open ? 'APPROVED' : 'ENDED'}`}>{o.open ? t('admin.jobs.open') : o.kind === 'PLAYER' ? t('admin.jobs.filled') : t('admin.jobs.off')}</span></td>
                          <td className="num">{o.kind === 'PUBLIC' ? o.employed : o.employed > 0 ? 1 : 0}</td>
                          <td className="row-actions">
                            {(o.kind === 'PUBLIC' || o.open) && (
                              <button type="button" className="adm-btn icon" title={t('admin.camp.edit')} aria-label={t('admin.camp.edit')} onClick={() => {
                                if (o.kind === 'PUBLIC') {
                                  const j = jobsView.catalog.find((x) => `job:${x.id}` === o.id);
                                  if (j) setJobEdit({ kind: 'job', isNew: false, f: { ...j } });
                                } else setJobEdit({ kind: 'offer', id: o.id, company: o.company, f: { roleFr: o.roleFr, roleEn: o.roleEn, grossMonthly: o.gross } });
                                window.scrollTo({ top: 0, behavior: 'smooth' });
                              }}><Icon name="edit" size={16} /></button>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}

        {tab === 'loans' && (
          <div className="adm-stack">
            <div className="adm-seg">
              <p className="adm-help">{t('admin.loansHelp')}</p>
            </div>
            <table className="admin-table">
              <thead>
                <tr>
                  <th>{t('admin.f.player')}</th>
                  <th>{t('admin.f.principal')}</th>
                  <th>{t('admin.f.remaining')}</th>
                  <th>{t('admin.f.installmentAmount')}</th>
                  <th>{t('admin.f.rateBp')}</th>
                  <th>{t('admin.f.status')}</th>
                  <th>{t('admin.f.nextDue')}</th>
                  <th>{t('admin.f.lateSince')}</th>
                  <th>{t('admin.f.totalPenaltyPaid')}</th>
                </tr>
              </thead>
              <tbody>
                {loans.map((l) => (
                  <tr key={l.id}>
                    <td>{l.character}<div className="adm-dim">{l.account}</div></td>
                    <td>{fcfa(l.principal)}</td>
                    <td>{fcfa(l.remaining)}</td>
                    <td>{fcfa(l.installmentAmount)}</td>
                    <td>{(l.rateBp / 100).toFixed(2)} %</td>
                    <td><span className="adm-pill">{t(`admin.loanStatus.${l.status}`)}</span></td>
                    <td className="adm-dim">{l.status === 'CLOSED' ? '—' : t('admin.f.day', { day: l.nextDueGameDay })}</td>
                    <td className="adm-dim">{l.lateSinceGameDay != null ? t('admin.f.day', { day: l.lateSinceGameDay }) : '—'}</td>
                    <td>{fcfa(l.totalPenaltyPaid)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {loans.length === 0 && <p className="adm-dim">{t('admin.loansEmpty')}</p>}
          </div>
        )}

        {tab === 'settings' && (
          <div className="sset">
            <nav className="sset-nav" role="tablist">
              <SearchBox value={q} onChange={setQ} />
              {[...SETTING_TABS.map(([id]) => id), 'other'].filter((id) => Object.keys(settings).some((k) => settingTab(k) === id)).map((id) => {
                const changed = dirtyKeys.filter((k) => settingTab(k) === id).length;
                return (
                  <button key={id} role="tab" aria-selected={!q.trim() && sTab === id} className={!q.trim() && sTab === id ? 'on' : ''} onClick={() => { setSTab(id); setQ(''); }}>
                    <span>{t(`admin.stab.${id}`)}</span>
                    {changed > 0 ? <i className="sset-dot" title={t('admin.modified')} /> : <em>{Object.keys(settings).filter((k) => settingTab(k) === id).length}</em>}
                  </button>
                );
              })}
              <small className="adm-help">{t('admin.settingsIntro')}</small>
            </nav>
            <div className="sset-body">
              <div className="adm-settings">
                {Object.keys(settings).filter((k) => (q.trim() ? match(k, t(`admin.sk.${k}`, { defaultValue: '' })) : settingTab(k) === sTab)).map((k) => {
                  const dirty = dirtyKeys.includes(k);
                  let parsed: unknown;
                  try {
                    parsed = JSON.parse(drafts[k] ?? 'null');
                  } catch {
                    parsed = undefined;
                  }
                  return (
                    <section key={k} className={`adm-card sset-card${dirty ? ' dirty' : ''}${isWideSetting(parsed) ? ' wide' : ''}`}>
                      <div className="adm-card-head">
                        <div><h3>{t(`admin.sk.${k}`, { defaultValue: k })}</h3><small className="mono">{k}</small></div>
                        {dirty && <button className="adm-btn" onClick={() => setDrafts({ ...drafts, [k]: JSON.stringify(settings[k], null, 2) })}>{t('app.cancel')}</button>}
                      </div>
                      {parsed === undefined ? (
                        <p className="error">{t('admin.invalidJson')}</p>
                      ) : (
                        <SettingFields name={k} value={parsed as never} onChange={(v) => setDrafts({ ...drafts, [k]: JSON.stringify(v, null, 2) })} />
                      )}
                      <details className="sf-advanced">
                        <summary>{t('admin.advanced')}</summary>
                        <textarea className="adm-code" value={drafts[k] ?? ''} onChange={(e) => setDrafts({ ...drafts, [k]: e.target.value })} rows={Math.min(14, (drafts[k] ?? '').split('\n').length + 1)} spellCheck={false} />
                      </details>
                    </section>
                  );
                })}
              </div>
              {dirtyKeys.length > 0 && (
                <div className="sset-bar" role="region">
                  <span>{t('admin.changes', { count: dirtyKeys.length })}</span>
                  <button className="adm-btn" onClick={() => setDrafts(Object.fromEntries(Object.entries(settings).map(([k, v]) => [k, JSON.stringify(v, null, 2)])))}>{t('admin.discardAll')}</button>
                  <button className="adm-btn primary" onClick={() => void saveSettings()}>{t('admin.saveAll')}</button>
                </div>
              )}
            </div>
          </div>
        )}

        {tab === 'audit' && (
          <section className="adm-card flush">
            <div className="adm-toolbar">
              <SearchBox value={q} onChange={setQ} />
              <div className="adm-select-ss">
                <SearchSelect value={aKind} options={['all', 'auth', 'admin', 'payment', 'account', 'billboard', 'plots'].map((k) => ({ value: k, label: t(`admin.actk.${k}`) }))} onChange={setAKind} placeholder={t('admin.actk.all')} searchLabel={t('admin.ss.search')} empty={t('admin.ss.empty')} />
              </div>
              <PeriodPicker value={per} onChange={setPer} />
            </div>
            <table className="admin-table">
              <thead><tr><th>{t('admin.f.date')}</th><th>{t('admin.f.action')}</th><th>{t('admin.f.actor')}</th><th>{t('admin.f.target')}</th></tr></thead>
              <tbody>
                {audit.filter((a) => (aKind === 'all' || a.action.startsWith(`${aKind}.`)) && match(a.action, t(`admin.act.${a.action}`, { defaultValue: '' }), a.target, a.actorId, a.actorName)).map((a) => (
                  <tr key={a.id}>
                    <td className="adm-dim">{new Date(a.createdAt).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })}</td>
                    <td><span className={`adm-tag a-${a.action.split('.')[0]} ${/failed|blocked|locked|mismatch|reuse|unknown/.test(a.action) ? 'warn' : ''}`} title={a.action}>{t(`admin.act.${a.action}`, { defaultValue: a.action })}</span></td>
                    <td>{a.actorName ? <strong>{a.actorName}</strong> : <span className="mono adm-dim">{a.actorId?.slice(0, 8) ?? t('admin.actSystem')}</span>}</td>
                    <td className="mono adm-dim">{a.target ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        {tab === 'reports' && (
          <section className="adm-card">
            {reports.length === 0 ? (
              <p className="adm-dim">{t('admin.reports.empty')}</p>
            ) : (
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{t('admin.reports.when')}</th>
                    <th>{t('admin.reports.target')}</th>
                    <th>{t('admin.reports.reason')}</th>
                    <th>{t('admin.reports.message')}</th>
                    <th>{t('admin.reports.by')}</th>
                    <th />
                  </tr>
                </thead>
                <tbody>
                  {reports.map((r) => {
                    const act = async (action: 'dismiss' | 'hide' | 'mute', muteHours?: number) => {
                      const ok = await call(() => api(`/admin/reports/${r.id}/resolve`, { method: 'POST', body: muteHours ? { action, muteHours } : { action }, auth: true }));
                      if (ok) {
                        setNotice(t(`admin.reports.done.${action}`, { name: r.target.name }));
                        void load();
                      }
                    };
                    return (
                      <tr key={r.id}>
                        <td className="adm-dim">{new Date(r.createdAt).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' })}</td>
                        <td>
                          <strong>{r.target.name}</strong>
                          <small className="adm-dim"> · {t('admin.reports.total', { n: r.target.reportsTotal })}</small>
                          {r.target.mutedUntil && new Date(r.target.mutedUntil) > new Date() && <small className="adm-dim"> · {t('admin.reports.muted')}</small>}
                        </td>
                        <td><span className="adm-tag warn">{t(`chat.reasons.${r.reason}`, { defaultValue: r.reason })}</span></td>
                        <td>{r.message ? <span className={r.message.hidden ? 'adm-dim' : ''}>« {r.message.text} »</span> : '—'}</td>
                        <td className="adm-dim">{r.reporter.name}</td>
                        <td className="adm-actions">
                          <button className="btn small ghost" onClick={() => void act('dismiss')}>{t('admin.reports.dismiss')}</button>
                          {r.message && <button className="btn small" onClick={() => void act('hide')}>{t('admin.reports.hide')}</button>}
                          <button className="btn small" onClick={() => void act('mute', 24)}>{t('admin.reports.mute24')}</button>
                          <button className="btn small danger" onClick={() => void act('mute', 168)}>{t('admin.reports.mute7d')}</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </section>
        )}

        {tab === 'messages' && (
          <div className="adm-stack">
            <div className="adm-seg" role="tablist">
              {(['open', 'all'] as const).map((v) => (
                <button key={v} role="tab" className={contactView === v ? 'on' : ''} aria-selected={contactView === v} onClick={() => setContactView(v)}>{t(`admin.msg.view.${v}`)}</button>
              ))}
            </div>
            <div className="adm-toolbar">
              <SearchBox value={msgQ} onChange={setMsgQ} placeholder={t('admin.msg.search')} />
            </div>
            <div className="adm-toolbar">
              <label className="adm-check"><input type="checkbox" checked={msgAll} onChange={(e) => setMsgAll(e.target.checked)} /> {t('admin.msg.anyDate')}</label>
              {!msgAll && <PeriodPicker value={per} onChange={setPer} />}
              <span className="adm-grow" />
              <small className="adm-dim">{t('admin.msg.count', { count: contacts.length })}</small>
            </div>
            {contacts.length === 0 && <section className="adm-card"><p className="adm-dim">{t('admin.msg.empty')}</p></section>}
            {contacts.length > 0 && (() => {
              const m = contacts.find((c) => c.id === msgSel) ?? contacts.find((c) => c.status === 'NEW') ?? contacts[0]!;
              const draft = replyDrafts[m.id] ?? '';
              return (
                <div className="adm-msg-layout">
                  <ul className="adm-msg-list" role="listbox" aria-label={t('admin.tab.messages', { defaultValue: 'Messages' })}>
                    {contacts.map((c) => (
                      <li key={c.id}>
                        <button type="button" role="option" aria-selected={c.id === m.id} className={`adm-msg-row ${c.id === m.id ? 'on' : ''} ${c.status === 'NEW' ? 'new' : ''}`} onClick={() => setMsgSel(c.id)}>
                          <span className="adm-av">{c.name.slice(0, 1).toUpperCase()}</span>
                          <span className="adm-msg-row-body">
                            <span className="adm-msg-row-top"><strong>{c.name}</strong><small className="adm-dim">{new Date(c.createdAt).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' })}</small></span>
                            <span className="adm-msg-row-prev">{c.message}</span>
                            <span className="adm-msg-row-tags"><span className="adm-tag">{t(`contact.topics.${c.topic}`, { defaultValue: c.topic })}</span><span className={`adm-tag msg-${c.status}`}>{t(`admin.msg.status.${c.status}`)}</span>{c.replies.length > 0 && <span className="adm-tag">↩ {c.replies.length}</span>}</span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                  <section key={m.id} className={`adm-card adm-msg adm-msg-detail ${m.status === 'NEW' ? 'new' : ''}`}>
                  <header className="adm-msg-head">
                    <div className="adm-who">
                      <span className="adm-av">{m.name.slice(0, 1).toUpperCase()}</span>
                      <div><strong>{m.name}</strong>{m.company && <small>{m.company}</small>}</div>
                    </div>
                    <span className="adm-tag">{t(`contact.topics.${m.topic}`, { defaultValue: m.topic })}</span>
                    <span className={`adm-tag msg-${m.status}`}>{t(`admin.msg.status.${m.status}`)}</span>
                    <small className="adm-dim">{new Date(m.createdAt).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' })}</small>
                  </header>
                  <div className="adm-msg-contact">
                    {m.whatsapp ? <a className="adm-link" href={`https://wa.me/${m.whatsapp}`} target="_blank" rel="noopener noreferrer">WhatsApp +{m.whatsapp}</a> : <span className="adm-dim">{t('admin.msg.noWhatsapp')}</span>}
                    {m.email ? <a className="adm-link" href={`mailto:${m.email}`}>{m.email}</a> : <span className="adm-dim">{t('admin.msg.noEmail')}</span>}
                    <span className="adm-dim">{m.locale.toUpperCase()}</span>
                    <button type="button" className="adm-link" onClick={() => { setMsgQ(m.whatsapp || m.email || m.name); setMsgAll(true); setContactView('all'); }}>{t('admin.msg.byUser')}</button>
                  </div>
                  <p className="adm-msg-text">{m.message}</p>
                  {m.context && <small className="adm-dim mono">{m.context}</small>}
                  {m.replies.length > 0 && (
                    <ul className="adm-msg-replies">
                      {m.replies.map((r) => (
                        <li key={r.id}>
                          <small className="adm-dim">{t(`admin.msg.via.${r.channel}`)} · {new Date(r.createdAt).toLocaleString(i18n.language, { dateStyle: 'short', timeStyle: 'short' })}</small>
                          <p>{r.text}</p>
                        </li>
                      ))}
                    </ul>
                  )}
                  <textarea className="adm-msg-reply" rows={3} maxLength={2000} placeholder={t('admin.msg.replyHint')} value={draft} onChange={(e) => setReplyDrafts({ ...replyDrafts, [m.id]: e.target.value })} />
                  <div className="adm-actions">
                    <button className="adm-btn primary" disabled={draft.trim().length < 2 || !m.whatsapp} onClick={() => void replyContact(m, 'whatsapp')}>{t('admin.msg.replyWa')}</button>
                    <button className="adm-btn" disabled={draft.trim().length < 2 || !m.email} title={m.email ? undefined : t('admin.msg.noEmail')} onClick={() => void replyContact(m, 'email')}>{t('admin.msg.replyMail')}</button>
                    {m.status === 'NEW' && <button className="adm-btn" onClick={() => void setContactStatus(m, 'READ')}>{t('admin.msg.markRead')}</button>}
                    {m.status !== 'DONE' ? (
                      <button className="adm-btn" onClick={() => void setContactStatus(m, 'DONE')}>{t('admin.msg.markDone')}</button>
                    ) : (
                      <button className="adm-btn" onClick={() => void setContactStatus(m, 'READ')}>{t('admin.msg.reopen')}</button>
                    )}
                  </div>
                </section>
                </div>
              );
            })()}
          </div>
        )}

        {tab === 'ledger' && ledger !== null && (() => {
          const lg = ledger as { ok?: boolean; globalSum?: string; mismatches?: unknown[] };
          return (
            <div className="adm-stack">
              <section className={`adm-card ledger-hero ${lg.ok ? 'good' : 'bad'}`}>
                <i><Icon name={lg.ok ? 'check' : 'ban'} size={22} /></i>
                <div>
                  <h3>{lg.ok ? t('admin.ledger.okTitle') : t('admin.ledger.badTitle')}</h3>
                  <p>{lg.ok ? t('admin.ledger.okText') : t('admin.ledger.badText')}</p>
                </div>
              </section>
              <div className="kpis">
                <div className="adm-kpi"><div className="adm-kpi-top"><span>{t('admin.ledger.sum')}</span></div><strong>{fcfa(lg.globalSum ?? '0')}</strong><small>{t('admin.ledger.sumHint')}</small></div>
                <div className={`adm-kpi ${(lg.mismatches?.length ?? 0) ? 'bad' : 'good'}`}><div className="adm-kpi-top"><span>{t('admin.ledger.mismatches')}</span></div><strong>{lg.mismatches?.length ?? 0}</strong><small>{t('admin.ledger.mismatchesHint')}</small></div>
              </div>
              <details className="adm-card sf-advanced">
                <summary>{t('admin.details')}</summary>
                <pre className="adm-code">{JSON.stringify(ledger, null, 2)}</pre>
              </details>
            </div>
          );
        })()}
      </main>
      </div>
    </div>
  );
}
