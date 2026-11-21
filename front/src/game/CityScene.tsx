import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Quality } from '../lib/prefs';
import { useGlRecovery } from './glRecovery';
import type { GameClock } from './clock';
import { resolveLook, type PersonLook } from './kit';
import { live, sendPosition } from '../lib/live';
import type { LandZoneView } from './landLayer';
import { World, type Ad, type BrandSpot, type VipSpot, type BusLine, type SeaGridSpec, type SeaPlotSpec, type CityVenue, type CityView, type TravelMode } from './World';

export interface CityHandle {
  setView: (v: CityView) => void;
  placeAt: (id: string) => void;
  /** `roadside` : le véhicule s'arrête sur la route près du lieu, sans aller jusqu'à la devanture (courses, livraisons). */
  travel: (id: string, mode: TravelMode, opts?: { roadside?: boolean }) => Promise<void>;
  /** Le client descend de la moto et marche jusqu'à l'entrée du lieu. */
  dropPassenger: (id: string) => void;
  /** Un livreur du lieu emporte le colis à l'entrée. */
  dropParcel: (id: string) => void;
  /** Interrompt le trajet en cours (le personnage reste où il est) ; la promesse de `travel` se résout. */
  stopTravel: () => void;
  setMove: (x: number, y: number) => void;
  setCustomer: (on: boolean, parcel?: boolean, key?: string) => void;
  setWork: (id: string | null) => void;
  setLand: (zones: LandZoneView[]) => void;
  focusAt: (x: number, z: number) => void;
  performWork: () => Promise<void>;
  setCargo: (on: boolean) => void;
  setOwnMoto: (on: boolean, passenger?: boolean) => void;
  setDutyMoto: (on: boolean) => void;
  isNear: (id: string, r?: number) => boolean;
  recenter: () => void;
  /** Station-service : le joueur sur sa moto ou sa voiture, le pompiste à côté ; null = hors station. */
  setStation: (kind: 'MOTO' | 'CAR' | null, venueId?: string) => void;
  /** Pose la moto / la voiture du joueur devant sa maison. */
  setParkedVehicles: (want: { MOTO: boolean; CAR: boolean }) => void;
  /** Le joueur reste sur sa moto ou sa voiture dans la rue (null = à pied). */
  setRidden: (kind: 'MOTO' | 'CAR' | null) => void;
  /** Le pompiste fait le plein pendant quelques secondes (appelé quand le plein vient d'être payé). */
  stationFuel: () => void;
  /** Tourne la carte (radians) ; 0 = remet le nord en haut. */
  rotateMap: (rad: number) => void;
  setBoardsVisible: (on: boolean) => void;
  tripProgress: () => ReturnType<World['tripProgress']>;
  setHidden: (on: boolean) => void;
  capture: () => Promise<Blob | null>;
  /** SAMU : l'ambulance vient des urgences jusqu'au joueur (false si l'un des lieux n'est pas dans cette ville). */
  ambulanceCome: (hospitalId: string, pickupId: string) => Promise<boolean>;
  /** Les secouristes installent le joueur sur le brancard et le montent dans l'ambulance. */
  ambulanceLoad: () => Promise<void>;
  ambulanceClear: () => void;
  ambulanceProgress: () => ReturnType<World['ambulanceProgress']>;
}

interface Props {
  quality: Quality;
  clock: GameClock;
  venues: CityVenue[];
  home: CityVenue;
  look: PersonLook;
  ads: Ad[];
  busLines: BusLine[];
  view: CityView;
  startAt: string;
  /** false pendant qu'on est dans un bâtiment : la ville reste en mémoire, en pause (pas de reconstruction à la sortie). */
  active?: boolean;
  onPick: (id: string) => void;
  onNear: (id: string | null) => void;
  onArrive?: (id: string | null) => void;
  onBillboard: (adId: string, panel?: number) => void;
  /** Panneau sans annonce touché : son emplacement, à réserver. */
  onFreeBoard?: (slot: number) => void;
  brands: BrandSpot[];
  /** Espaces VIP libres (balise « VIP SPACE ») et clic sur l'un d'eux. */
  vipSpots?: VipSpot[];
  onVipSpot?: (id: string) => void;
  /** Panneaux publicitaires visibles (préférence du joueur). */
  boardsVisible: boolean;
  /** Coupure d'électricité dans la zone du joueur : les bâtiments restent sombres la nuit. */
  powerCut?: boolean;
  sea: { grid: SeaGridSpec; plots: SeaPlotSpec[] } | null;
  onSeaCell: (x: number, y: number, zone: string) => void;
  /** Terrains à vendre dessinés sur la carte ; changer cette liste redessine seulement les zones. */
  land?: LandZoneView[];
  onLandCell?: (zoneId: string, cell: number) => void;
  zones?: { id: string; grid: SeaGridSpec; plots: SeaPlotSpec[] }[];
  onPlot: (id: string) => void;
  onBrand: (id: string) => void;
}

/** Monte la ville Three.js (recréée si la qualité, la langue des étiquettes ou les lieux changent). */
const CityScene = forwardRef<CityHandle, Props>(function CityScene(props, ref) {
  const { t } = useTranslation();
  const el = useRef<HTMLDivElement>(null);
  // Carte graphique retirée par le téléphone (écran noir) : la scène se reconstruit seule
  const glGen = useGlRecovery(el);
  const world = useRef<World | null>(null);
  /** Poste de travail et client en cours, réappliqués si la ville est reconstruite. */
  const duty = useRef<{ work: string | null; customer: [boolean, boolean | undefined, string | undefined] | null }>({ work: null, customer: null });
  // Les rappels et la vue changent sans recréer la scène
  const cb = useRef(props);
  cb.current = props;

  useImperativeHandle(ref, () => ({
    setView: (v) => world.current?.setView(v),
    placeAt: (id) => world.current?.placeAt(id),
    travel: async (id, mode, opts) => {
      // La scène est créée juste après le montage : on attend qu'elle existe (≈ 5 s max).
      for (let i = 0; i < 300 && !world.current; i++) await new Promise((ok) => requestAnimationFrame(ok));
      await world.current?.travel(id, mode, opts);
    },
    dropPassenger: (id) => world.current?.dropPassenger(id),
    dropParcel: (id) => world.current?.dropParcel(id),
    stopTravel: () => world.current?.stopTravel(),
    setMove: (x, y) => world.current?.setMove(x, y),
    setCustomer: (on, parcel, key) => {
      duty.current.customer = [on, parcel, key];
      world.current?.setCustomer(on, parcel, key);
    },
    setWork: (id) => {
      duty.current.work = id;
      world.current?.setWork(id);
    },
    setLand: (zones) => world.current?.setLand(zones),
    focusAt: (x, z) => world.current?.focusAt(x, z),
    performWork: async () => {
      await world.current?.performWork();
    },
    setCargo: (on) => world.current?.setCargo(on),
    setOwnMoto: (on, passenger) => world.current?.setOwnMoto(on, passenger),
    setDutyMoto: (on) => world.current?.setDutyMoto(on),
    isNear: (id, r) => world.current?.isNear(id, r) ?? false,
    recenter: () => world.current?.recenter(),
    setStation: (kind, venueId) => world.current?.setStation(kind, venueId),
    stationFuel: () => world.current?.stationFuel(),
    setRidden: (kind) => world.current?.setRidden(kind),
    setParkedVehicles: (want) => world.current?.setParkedVehicles(want),
    rotateMap: (rad) => world.current?.rotateMap(rad),
    setBoardsVisible: (on) => world.current?.setBoardsVisible(on),
    tripProgress: () => world.current?.tripProgress() ?? null,
    setHidden: (on) => world.current?.setHidden(on),
    capture: async () => (await world.current?.capture()) ?? null,
    ambulanceCome: async (hospitalId, pickupId) => {
      for (let i = 0; i < 300 && !world.current; i++) await new Promise((ok) => requestAnimationFrame(ok));
      return (await world.current?.ambulanceCome(hospitalId, pickupId)) ?? false;
    },
    ambulanceLoad: async () => {
      await world.current?.ambulanceLoad();
    },
    ambulanceClear: () => world.current?.ambulanceClear(),
    ambulanceProgress: () => world.current?.ambulanceProgress() ?? null,
  }));

  const { quality, clock, venues, home, look, ads, busLines, brands, vipSpots, sea, zones } = props;
  // L'emplacement des terrains à vendre (zone entière, extension comprise) fixe où l'on ne bâtit ni ne plante : la scène est refaite s'il change
  const wantedSites = (props.land ?? []).map((z) => `${z.id}:${z.layout.originX},${z.layout.originZ},${z.layout.cols},${z.planRows ?? z.layout.rows},${z.layout.cell},${z.margin ?? 6}`).join('|');
  // Reconstruire la ville pendant un trajet remettait le personnage au départ et coupait l'animation :
  // un nouveau plan des terrains n'est appliqué qu'une fois le trajet terminé
  const [landSites, setLandSites] = useState(wantedSites);
  useEffect(() => {
    if (wantedSites === landSites) return;
    const id = window.setInterval(() => {
      if (world.current?.tripProgress()) return;
      window.clearInterval(id);
      setLandSites(wantedSites);
    }, 500);
    return () => window.clearInterval(id);
  }, [wantedSites, landSites]);
  useEffect(() => {
    const node = el.current;
    if (!node) return;
    try {
      world.current = new World(node, quality, () => clock.minuteOfDay(), {
        totalMinutes: () => clock.totalMinutes(),
        venues,
        home,
        look,
        ads,
        busLines,
        brands,
        vipSpots,
        onVipSpot: (id) => cb.current.onVipSpot?.(id),
        sea: sea ?? undefined,
        zones,
        land: cb.current.land ?? [],
        onLandCell: (zoneId, cell) => cb.current.onLandCell?.(zoneId, cell),
        onSeaCell: (x, y, zone) => cb.current.onSeaCell(x, y, zone),
        onPlot: (id) => cb.current.onPlot(id),
        onBrand: (id) => cb.current.onBrand(id),
        onPick: (id) => cb.current.onPick(id),
        onNear: (id) => cb.current.onNear(id),
        onArrive: (id) => cb.current.onArrive?.(id),
        onBillboard: (id, panel) => cb.current.onBillboard(id, panel),
        freeBoard: { title: t('billboard.yourAd'), sub: t('billboard.freeSub') },
        onFreeBoard: (slot) => cb.current.onFreeBoard?.(slot),
      });
      world.current.placeAt(cb.current.startAt);
      world.current.setView(cb.current.view);
      world.current.setBoardsVisible(cb.current.boardsVisible);
      world.current.setPowerCut(!!cb.current.powerCut);
      // Ville reconstruite (parcelles chargées, annonces…) : le poste de travail et le client en cours reviennent
      if (duty.current.work) world.current.setWork(duty.current.work);
      if (duty.current.customer?.[0]) world.current.setCustomer(true, duty.current.customer[1], duty.current.customer[2]);
    } catch {
      world.current = null; // WebGL indisponible : l'interface reste utilisable
    }
    return () => {
      world.current?.dispose();
      world.current = null;
    };
  }, [quality, clock, venues, home, look, ads, busLines, brands, vipSpots, sea, zones, landSites, t, glGen]);

  useEffect(() => {
    world.current?.setLand(props.land ?? []);
  }, [props.land]);

  useEffect(() => {
    world.current?.setView(props.view);
  }, [props.view]);

  const active = props.active !== false;
  const wasActive = useRef(active);
  useEffect(() => {
    const w = world.current;
    if (!w) return;
    w.setActive(active);
    // Retour d'un bâtiment : on réapparaît devant le lieu quitté
    if (active && !wasActive.current) {
      w.placeAt(cb.current.startAt);
      w.setView(cb.current.view);
    }
    wasActive.current = active;
  }, [active]);

  useEffect(() => {
    world.current?.setBoardsVisible(props.boardsVisible);
  }, [props.boardsVisible]);
  useEffect(() => {
    world.current?.setPowerCut(!!props.powerCut);
  }, [props.powerCut]);

  // Multijoueur : position envoyée toutes les 1,5 s, même depuis un intérieur (on reste visible devant le lieu),
  // autres joueurs affichés à chaque mise à jour de présence
  useEffect(() => {
    const id = window.setInterval(() => {
      const w = world.current;
      if (w && !document.hidden) {
        const p = w.getPose();
        sendPosition(p.x, p.z, p.yaw, p.ride);
      }
    }, 1500);
    // Seulement quand la liste des joueurs change (un message de chat, un « écrit… » ne redessinent pas les passants)
    let seen: unknown = null;
    const apply = () => {
      const players = live.get().players;
      if (players === seen) return;
      seen = players;
      world.current?.setRemotePlayers(players.map((pl) => ({ ...pl, look: resolveLook(pl.look, pl.id) })));
    };
    apply();
    const off = live.subscribe(apply);
    return () => {
      window.clearInterval(id);
      off();
      world.current?.setRemotePlayers([]);
    };
  }, []);

  return (
    <div ref={el} className="scene" style={active ? undefined : { display: 'none' }}>
      <a className="map-attribution" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer">
        {t('map.attribution')}
      </a>
    </div>
  );
});

export default CityScene;
