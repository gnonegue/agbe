import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import type { Quality } from '../lib/prefs';
import { useGlRecovery } from './glRecovery';
import type { GameClock } from './clock';
import { Interior, type InteriorBrand, type InteriorKind } from './Interior';
import type { PersonLook } from './kit';

/** Commandes du poste de travail dans la pièce (voir Interior.setWork). */
export interface InteriorHandle {
  setCustomer: (on: boolean) => void;
  performWork: () => Promise<void>;
  setMove: (x: number, y: number) => void;
  setFurniture: (list: FurnitureItem[], selectedId?: string | null) => void;
  canPlace: (f: { x: number; z: number; rot: number; w: number; d: number; flat?: boolean }, ignoreId?: string | null) => boolean;
  findFreeSpot: (def: { w: number; d: number; flat?: boolean }) => { x: number; z: number; rot: number } | null;
  screenStep: (dir: 'up' | 'down' | 'left' | 'right') => { dx: number; dz: number };
}

/** Meuble posé dans la pièce (modèle, position, quarts de tour, empreinte). */
export interface FurnitureItem {
  id: string;
  model: string;
  x: number;
  z: number;
  rot: number;
  w: number;
  d: number;
  flat?: boolean;
}

interface Props {
  quality: Quality;
  kind: InteriorKind;
  look: PersonLook;
  open?: boolean;
  clock?: GameClock;
  asleep?: boolean;
  /** Hôpital : le patient est alité dans la salle de soins, les soignants passent le voir ; false = il se lève. */
  ward?: boolean;
  /** Métier à pied exercé ici : son poste est installé dans la pièce. */
  work?: string | null;
  /** Le personnage s'approche de la porte : on sort. */
  onExit?: () => void;
  /** Lieu de partenaire : décor de marque et articles exposés ; `onArticle` reçoit l'indice de l'article touché. */
  brand?: InteriorBrand | null;
  onArticle?: (index: number) => void;
  /** Meubles du joueur (maison) : posés à l'ouverture et à chaque changement. */
  furniture?: FurnitureItem[];
  /** Meuble en cours de réglage (repère vert ou rouge). */
  furnitureSelected?: string | null;
  /** Les meubles d'origine sont ceux du joueur : la pièce ne dessine plus les siens (lit, table, réchaud, télé…). */
  custom?: boolean;
}

/** Monte un intérieur (maison ou lieu couvert) et le libère au démontage. */
const InteriorScene = forwardRef<InteriorHandle, Props>(function InteriorScene({ quality, kind, look, open = true, clock, asleep = false, ward = false, work = null, onExit, brand = null, onArticle, furniture = [], furnitureSelected = null, custom = false }, ref) {
  const el = useRef<HTMLDivElement>(null);
  // Carte graphique retirée par le téléphone (écran noir) : la scène se reconstruit seule
  const glGen = useGlRecovery(el);
  const roomRef = useRef<Interior | null>(null);
  const asleepRef = useRef(asleep);
  asleepRef.current = asleep;
  const wardRef = useRef(ward);
  wardRef.current = ward;
  const workRef = useRef(work);
  workRef.current = work;
  // La pièce est recomposée si le décor de marque change (logo ou articles qui arrivent après l'ouverture)
  const brandKey = brand ? `${brand.label}|${brand.color}|${brand.logo ?? ''}|${brand.articles.map((a) => `${a.name}:${a.price}`).join(',')}` : '';
  const furnRef = useRef({ list: furniture, sel: furnitureSelected });
  furnRef.current = { list: furniture, sel: furnitureSelected };
  const exitRef = useRef(onExit);
  exitRef.current = onExit;
  const articleRef = useRef(onArticle);
  articleRef.current = onArticle;
  useImperativeHandle(ref, () => ({
    setCustomer: (on) => roomRef.current?.setCustomer(on),
    setMove: (x, y) => roomRef.current?.setMove(x, y),
    setFurniture: (list, sel) => roomRef.current?.setFurniture(list, sel ?? null),
    canPlace: (f, ignore) => roomRef.current?.canPlace(f, ignore ?? null) ?? false,
    findFreeSpot: (def) => roomRef.current?.findFreeSpot(def) ?? null,
    screenStep: (dir) => roomRef.current?.screenStep(dir) ?? { dx: 0, dz: 0 },
    performWork: async () => {
      await roomRef.current?.performWork();
    },
  }));
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    let room: Interior | null = null;
    try {
      room = new Interior(node, quality, kind, look, open, brand, custom);
      // Les meubles d'abord : le lit et les autres points d'usage doivent exister avant de coucher ou d'occuper le joueur
      room.setFurniture(furnRef.current.list, furnRef.current.sel);
      room.onArticle = (i) => articleRef.current?.(i);
      if (clock) room.getMinute = () => clock.minuteOfDay();
      room.onExit = () => exitRef.current?.();
      room.setAsleep(asleepRef.current);
      if (wardRef.current) room.setWard(true);
      if (workRef.current) room.setWork(workRef.current);
    } catch {
      room = null;
    }
    roomRef.current = room;
    return () => {
      roomRef.current = null;
      room?.dispose();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quality, kind, look, open, clock, brandKey, custom, glGen]);
  // Couché tant que la nuit dure côté serveur, même après un rechargement
  useEffect(() => roomRef.current?.setAsleep(asleep), [asleep]);
  useEffect(() => roomRef.current?.setWard(ward), [ward]);
  // Séance qui commence ou se termine pendant qu'on est dans la pièce
  useEffect(() => roomRef.current?.setWork(work), [work]);
  // Meubles du joueur : mis à jour à chaque achat, déplacement ou sélection
  useEffect(() => roomRef.current?.setFurniture(furniture, furnitureSelected), [furniture, furnitureSelected]);
  return <div ref={el} className="scene" />;
});

export default InteriorScene;
