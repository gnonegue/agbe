// Génération des missions d'une séance de travail (fonction pure, montants entiers décidés par le serveur).
import { distanceMeters, fare, type TransportModeConfig } from '../economy/transport';

export interface Mission {
  id: string;
  /** ride (course de zém), delivery (livraison à moto), sale (vente), wash (lavage), service (client de l'entreprise) */
  kind: 'ride' | 'delivery' | 'sale' | 'wash' | 'service';
  from?: string;
  to?: string;
  item?: string;
  qty?: number;
  /** Montant encaissé si la mission est acceptée (FCFA). */
  amount: number;
  /** Charges déduites (carburant, marchandise) — FCFA. */
  cost: number;
  status: 'open' | 'done' | 'declined';
}

export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  let s = h >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const PARCELS = ['meal', 'groceries', 'parcel', 'documents', 'medicine'];
/** Lieux récents évités pour une nouvelle course (pas d'allers-retours sur les mêmes endroits). */
const RECENT_MAX = 4;
/** Course minimale (m) : pas de destination juste à côté du point de départ quand d'autres lieux sont possibles. */
const MIN_TRIP_M = 250;

const SALE_ITEMS: Record<string, { item: string; unit: number; max: number }[]> = {
  street_vendor: [
    { item: 'oranges', unit: 50, max: 10 },
    { item: 'beignets', unit: 25, max: 12 },
    { item: 'water_sachet', unit: 25, max: 10 },
    { item: 'peanuts', unit: 100, max: 4 },
    { item: 'bread', unit: 150, max: 3 },
  ],
  tailor: [
    { item: 'hem', unit: 500, max: 3 },
    { item: 'shirt', unit: 3000, max: 1 },
    { item: 'dress', unit: 5000, max: 1 },
  ],
  pagnes: [{ item: 'wax_piece', unit: 4500, max: 2 }, { item: 'wax_half', unit: 2500, max: 2 }],
  maquis: [{ item: 'ablo_fish', unit: 800, max: 4 }, { item: 'rice_sauce', unit: 600, max: 4 }, { item: 'soda', unit: 300, max: 4 }],
  couture: [{ item: 'hem', unit: 500, max: 3 }, { item: 'shirt', unit: 3000, max: 1 }, { item: 'dress', unit: 5000, max: 1 }],
  cyber: [{ item: 'internet_hour', unit: 300, max: 3 }, { item: 'printing', unit: 50, max: 20 }, { item: 'cv_typing', unit: 1500, max: 1 }],
  maquis_waiter: [{ item: 'ablo_fish', unit: 800, max: 3 }, { item: 'rice_sauce', unit: 600, max: 3 }, { item: 'soda', unit: 300, max: 4 }],
  shop_clerk: [{ item: 'phone_credit', unit: 500, max: 4 }, { item: 'soap', unit: 250, max: 4 }, { item: 'biscuits', unit: 150, max: 6 }],
  cyber_attendant: [{ item: 'internet_hour', unit: 300, max: 3 }, { item: 'printing', unit: 50, max: 20 }, { item: 'cv_typing', unit: 1500, max: 1 }],
  barber: [{ item: 'haircut', unit: 500, max: 2 }, { item: 'braids', unit: 3000, max: 1 }, { item: 'shave', unit: 300, max: 2 }],
  moto_mechanic: [{ item: 'oil_change', unit: 1500, max: 1 }, { item: 'puncture', unit: 300, max: 2 }, { item: 'brake_pads', unit: 2000, max: 1 }],
  hotel_waiter: [{ item: 'coffee', unit: 800, max: 3 }, { item: 'juice', unit: 600, max: 3 }, { item: 'sandwich', unit: 1500, max: 2 }],
  transport: [],
};

/**
 * Missions d'une séance. Les montants restent proches de la paie de référence du métier (`target`),
 * sans jamais dépendre d'une valeur envoyée par le client.
 */
export function generateMissions(args: {
  seed: string;
  source: string; // id du métier ou de l'activité d'entreprise
  count: number;
  target: number; // chiffre d'affaires visé pour la séance
  costRatioBp: number; // part des charges (0 pour un salarié payé à la tâche)
  places: { id: string; x: number; z: number }[];
  zem: TransportModeConfig;
  /** Lieu de départ de la première course (les suivantes partent de la destination précédente). */
  start?: string;
}): Mission[] {
  const r = seededRandom(args.seed);
  const out: Mission[] = [];
  const ride = args.source === 'zem_driver' || args.source === 'transport';
  let at = args.places.find((p) => p.id === args.start) ?? args.places[0];
  // Lieux visités récemment (départs et arrivées) : on les évite pour ne pas tourner en rond (allers-retours A → B → A → B)
  const recent: string[] = at ? [at.id] : [];
  const remember = (...ids: string[]) => {
    for (const id of ids) {
      recent.push(id);
      if (recent.length > RECENT_MAX) recent.shift();
    }
  };
  /** Destination tirée parmi les lieux ni récents ni trop proches du point de départ (repli : n'importe quel autre lieu). */
  const pickDest = (from: { id: string; x: number; z: number }) => {
    const fresh = args.places.filter((p) => p.id !== from.id && !recent.includes(p.id) && distanceMeters(from.x, from.z, p.x, p.z) >= MIN_TRIP_M);
    const pool = fresh.length > 0 ? fresh : args.places.filter((p) => p.id !== from.id);
    return pool[Math.floor(r() * pool.length)]!;
  };
  for (let i = 0; i < args.count; i++) {
    const id = `m${i}`;
    if (ride && args.places.length >= 2) {
      const a = at!;
      const b = pickDest(a);
      const amount = Number(fare(distanceMeters(a.x, a.z, b.x, b.z), args.zem));
      remember(b.id);
      at = b;
      out.push({ id, kind: 'ride', from: a.id, to: b.id, amount, cost: Math.round((amount * args.costRatioBp) / 10_000), status: 'open' });
      continue;
    }
    // Livreur : récupérer un colis dans un lieu et le déposer dans un autre, payé à la distance + forfait
    if ((args.source === 'delivery_driver' || args.source === 'cargo_rider') && args.places.length >= 2) {
      // Les colis s'enchaînent : le suivant se récupère dans l'un des lieux les plus proches du dernier point de dépôt
      // (au lieu de traverser toute la ville à vide entre deux livraisons), puis se dépose ailleurs.
      const here = at!;
      // Lieux proches du dernier dépôt, en écartant ceux où l'on vient de passer (sinon le livreur tournait dans le même petit groupe)
      const byDist = (p: { x: number; z: number }) => distanceMeters(here.x, here.z, p.x, p.z);
      const others = args.places.filter((p) => p.id !== here.id);
      const freshNear = others.filter((p) => !recent.includes(p.id)).sort((p, q) => byDist(p) - byDist(q)).slice(0, 4);
      const nearest = freshNear.length > 0 ? freshNear : [...others].sort((p, q) => byDist(p) - byDist(q)).slice(0, 3);
      const a = nearest.length > 0 ? nearest[Math.floor(r() * nearest.length)]! : args.places[Math.floor(r() * args.places.length)]!;
      const b = pickDest(a);
      const amount = Number(fare(distanceMeters(a.x, a.z, b.x, b.z), args.zem)) + 200;
      remember(a.id, b.id);
      at = b;
      out.push({ id, kind: 'delivery', from: a.id, to: b.id, item: PARCELS[Math.floor(r() * PARCELS.length)]!, amount, cost: 0, status: 'open' });
      continue;
    }
    if (args.source === 'car_washer') {
      const amount = r() < 0.3 ? 1000 : 500; // lavage extérieur ou complet
      out.push({ id, kind: 'wash', item: amount === 1000 ? 'full_wash' : 'outside_wash', amount, cost: 0, status: 'open' });
      continue;
    }
    const items = SALE_ITEMS[args.source] ?? SALE_ITEMS.street_vendor!;
    const it = items[Math.floor(r() * items.length)]!;
    const qty = 1 + Math.floor(r() * it.max);
    const amount = it.unit * qty;
    out.push({ id, kind: args.source in { pagnes: 1, maquis: 1, couture: 1, cyber: 1 } ? 'service' : 'sale', item: it.item, qty, amount, cost: Math.round((amount * args.costRatioBp) / 10_000), status: 'open' });
  }
  // Ajustement doux vers la cible : on ne dépasse pas 1,4 × la paie de référence
  const total = out.reduce((s, m) => s + m.amount, 0);
  if (total > args.target * 1.4 && total > 0) {
    const k = (args.target * 1.4) / total;
    for (const m of out) {
      m.amount = Math.max(25, Math.round((m.amount * k) / 25) * 25);
      m.cost = Math.round((m.cost * k) / 25) * 25;
    }
  }
  return out;
}
