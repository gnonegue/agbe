// Catalogue musical dynamique : classement des artistes togolais (du plus au moins écouté) et titres trouvés en direct
// dans la recherche publique d'iTunes (aperçus de 30 s légaux, lien vers le titre complet). Aucun fichier n'est copié.
import { playClip } from './music';

export interface Artist {
  name: string;
  key: string;
  emoji: string;
  /**
   * Fiches iTunes de l'artiste (plusieurs quand le magasin en a créé plusieurs) : vérifiées à la main pour éviter les
   * homonymes étrangers. Sans fiche sûre, l'artiste reste au classement mais n'entre pas dans les tendances.
   */
  itunes?: number[];
}

/** Classement éditorial : du meilleur au moins bien classé. Le joueur peut chercher bien au-delà de cette liste. */
export const RANKING: Artist[] = [
  { name: 'Toofan', key: 'toofan', emoji: '🔥', itunes: [267464395] },
  { name: 'Santrinos Raphaël', key: 'santrinos', emoji: '🎤', itunes: [1452925136, 1634034153] },
  { name: 'King Mensah', key: 'kingMensah', emoji: '👑', itunes: [160103065] },
  { name: 'Sethlo', key: 'sethlo', emoji: '⭐', itunes: [1521477135, 1512780868, 1154884854] },
  { name: 'Paki Chenzu', key: 'pakiChenzu', emoji: '💥', itunes: [1720523107, 1733690620] },
  { name: 'Tony X', key: 'tonyX', emoji: '🎧', itunes: [1468715460, 1769713923, 1653658505] },
  { name: 'Senza', key: 'senza', emoji: '🎙️' },
  { name: 'Mastapopa', key: 'mastapopa', emoji: '🎶' },
  { name: 'King Maz', key: 'kingMaz', emoji: '🎤', itunes: [1791992873, 1812922750] },
  { name: 'Mardy Mbhz', key: 'mardy', emoji: '🎶', itunes: [1725056791] },
  { name: 'Santy Dorim', key: 'santyDorim', emoji: '👸', itunes: [1489464352] },
  { name: 'Cécile Meba', key: 'cecileMeba', emoji: '🌸', itunes: [1606916835] },
  { name: 'Axel Merryl', key: 'axelMerryl', emoji: '🎼', itunes: [1336487866, 1628934576] },
  { name: 'Etane Blex', key: 'etaneBlex', emoji: '🎵', itunes: [1530096153] },
  { name: 'Anodaboy', key: 'anodaboy', emoji: '🎹', itunes: [1660871980] },
  { name: 'Himra', key: 'himra', emoji: '🔊', itunes: [1197313464] },
  { name: 'Kiko', key: 'kiko', emoji: '🎷' },
  { name: 'Lamu', key: 'lamu', emoji: '🎺' },
  { name: 'Fanicko', key: 'fanicko', emoji: '💃', itunes: [885156668, 1756643816] },
  { name: 'Almok', key: 'almok', emoji: '✍️', itunes: [719025731, 1507959948] },
  { name: 'Vaudou Game', key: 'vaudouGame', emoji: '🥁', itunes: [864035235] },
  { name: 'Bella Bellow', key: 'bellaBellow', emoji: '🌺', itunes: [193499602] },
];

export interface CatalogTrack {
  id: string;
  title: string;
  artist: string;
  artwork: string | null;
  previewUrl: string;
  url: string | null;
  /** Année de sortie (null si iTunes ne la donne pas). */
  year: number | null;
}

/** Année des tendances : l'année en cours, d'après la date du jour (2026, puis 2027 l'an prochain, sans rien changer). */
export function trendYear(now = new Date()): number {
  return now.getFullYear();
}

interface ItunesRow {
  trackId?: number;
  trackName?: string;
  artistName?: string;
  artworkUrl60?: string;
  previewUrl?: string;
  trackViewUrl?: string;
  releaseDate?: string;
  wrapperType?: string;
  artistId?: number;
}

const cache = new Map<string, CatalogTrack[]>();

/** Recherche de titres (aperçus) : vide en cas de réseau absent ou de réponse inattendue. */
export async function searchTracks(term: string, limit = 12): Promise<CatalogTrack[]> {
  const q = term.trim();
  if (q.length < 2) return [];
  const hit = cache.get(`${q.toLowerCase()}|${limit}`);
  if (hit) return hit;
  try {
    const r = await fetch(`https://itunes.apple.com/search?media=music&entity=song&limit=${limit}&term=${encodeURIComponent(q)}`);
    if (!r.ok) return [];
    const body = (await r.json()) as { results?: ItunesRow[] };
    const list = (body.results ?? [])
      .filter((x) => x.previewUrl && x.trackName && x.artistName)
      .map((x) => {
        const y = x.releaseDate ? new Date(x.releaseDate).getFullYear() : NaN;
        return { id: String(x.trackId ?? `${x.artistName}-${x.trackName}`), title: x.trackName!, artist: x.artistName!, artwork: x.artworkUrl60 ?? null, previewUrl: x.previewUrl!, url: x.trackViewUrl ?? null, year: Number.isFinite(y) ? y : null };
      });
    cache.set(`${q.toLowerCase()}|${limit}`, list);
    return list;
  } catch {
    return [];
  }
}

const toTrack = (x: ItunesRow): CatalogTrack => {
  const y = x.releaseDate ? new Date(x.releaseDate).getFullYear() : NaN;
  return { id: String(x.trackId ?? `${x.artistName}-${x.trackName}`), title: x.trackName!, artist: x.artistName!, artwork: x.artworkUrl60 ?? null, previewUrl: x.previewUrl!, url: x.trackViewUrl ?? null, year: Number.isFinite(y) ? y : null };
};

/** Une ligne du classement de l'année : l'artiste, ses titres sortis cette année (du plus récent) et ses derniers titres. */
export interface YearRow {
  artist: Artist;
  thisYear: CatalogTrack[];
  latest: CatalogTrack[];
}

/** Derniers titres d'un artiste, d'après ses fiches iTunes triées par date (léger en 3G) ; titres explicites écartés. */
async function latestOf(a: Artist): Promise<CatalogTrack[]> {
  if (!a.itunes?.length) return [];
  const body = await fetch(`https://itunes.apple.com/lookup?id=${a.itunes.join(',')}&entity=song&limit=15&sort=recent`).then((r) => (r.ok ? (r.json() as Promise<{ results?: (ItunesRow & { trackExplicitness?: string })[] }>) : { results: [] }));
  const seen = new Set<string>();
  return (body.results ?? [])
    .filter((x) => x.wrapperType === 'track' && x.previewUrl && x.trackName && x.artistName && x.trackExplicitness !== 'explicit')
    .map(toTrack)
    .filter((t) => !seen.has(t.title.toLowerCase()) && !!seen.add(t.title.toLowerCase()))
    .sort((x, y) => (y.year ?? 0) - (x.year ?? 0));
}

const YEAR_CACHE = 'agbe.music.year.v2';
let yearRows: Promise<YearRow[]> | null = null;

/**
 * Classement de l'année en cours : les artistes qui ont sorti le plus de titres cette année d'abord, puis les autres ;
 * à égalité, l'ordre éditorial. Calculé une fois par jour et gardé sur le téléphone (≈ 300 Ko
 * de données la première fois seulement).
 */
export function yearRanking(): Promise<YearRow[]> {
  if (yearRows) return yearRows;
  const year = trendYear();
  const day = new Date().toISOString().slice(0, 10);
  try {
    const saved = JSON.parse(localStorage.getItem(YEAR_CACHE) ?? 'null') as { day: string; rows: { key: string; thisYear: CatalogTrack[]; latest: CatalogTrack[] }[] } | null;
    if (saved?.day === day && Array.isArray(saved.rows)) {
      const rows = saved.rows.flatMap((r) => {
        const artist = RANKING.find((a) => a.key === r.key);
        return artist ? [{ artist, thisYear: r.thisYear, latest: r.latest }] : [];
      });
      if (rows.length) return (yearRows = Promise.resolve(rows));
    }
  } catch {
    /* cache illisible : on recalcule */
  }
  yearRows = (async () => {
    const out: YearRow[] = [];
    // 4 artistes à la fois : pas de rafale de requêtes sur un réseau lent
    for (let i = 0; i < RANKING.length; i += 4) {
      const part = await Promise.all(
        RANKING.slice(i, i + 4).map(async (artist) => {
          const latest = await latestOf(artist).catch(() => [] as CatalogTrack[]);
          return { artist, latest: latest.slice(0, 8), thisYear: latest.filter((t) => t.year === year) };
        }),
      );
      out.push(...part);
    }
    const order = (r: YearRow) => RANKING.indexOf(r.artist);
    out.sort((x, y) => y.thisYear.length - x.thisYear.length || order(x) - order(y));
    // Rien reçu (hors ligne) : on ne garde pas un classement vide pour la journée
    if (out.some((r) => r.latest.length > 0)) {
      try {
        localStorage.setItem(YEAR_CACHE, JSON.stringify({ day, rows: out.map((r) => ({ key: r.artist.key, thisYear: r.thisYear, latest: r.latest })) }));
      } catch {
        /* stockage plein ou indisponible */
      }
    } else yearRows = null;
    return out;
  })();
  return yearRows;
}

/** « Tendances de l'année » : les titres sortis cette année, artiste par artiste dans l'ordre du classement de l'année. */
export async function chartTracks(top = 10, per = 2): Promise<{ artist: Artist; tracks: CatalogTrack[] }[]> {
  return (await yearRanking())
    .filter((r) => r.thisYear.length > 0)
    .slice(0, top)
    .map((r) => ({ artist: r.artist, tracks: r.thisYear.slice(0, per) }));
}

/**
 * Radio togolaise : un titre de l'année au hasard, les mieux classés de l'année plus souvent (à défaut de titres cette
 * année, les plus récents de l'artiste), puis le suivant à la fin de l'extrait.
 */
export async function playTogoRadio(): Promise<CatalogTrack | null> {
  const rows = (await yearRanking()).filter((r) => r.latest.length > 0).slice(0, 12);
  if (!rows.length) return null;
  const weights = rows.map((_, i) => 1 / (i + 1));
  const total = weights.reduce((a, b) => a + b, 0);
  let pick = Math.random() * total;
  let i = 0;
  while (i < weights.length - 1 && pick > weights[i]!) pick -= weights[i++]!;
  const row = rows[i]!;
  const list = row.thisYear.length ? row.thisYear : row.latest;
  const track = list[Math.floor(Math.random() * list.length)];
  if (!track) return null;
  playClip(track, () => void playTogoRadio());
  return track;
}
