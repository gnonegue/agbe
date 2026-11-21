// Lomé en 3D semi-réaliste : carte (vue de haut) et rue (caméra derrière le personnage).
// Le socle reste procédural et léger ; des modèles CC0 instanciés enrichissent les bâtiments et la circulation.
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Quality } from '../lib/prefs';
import type { Ride } from '../lib/live';
import { PROFILES, pixelRatioFor, type QualityProfile } from './quality';
import { unlockStreetSound, updateStreetSound } from '../lib/streetSound';
import { animateWalk, bakeGroup, buildPerson, clearRidePose, garment, ridePose, seatLegs, sitPose, Materials, randomLook, rng, type PersonLook } from './kit';
import { buildStation, poseArms, restArms, type Station } from './workstation';
import { buildLandLayer, type LandLayer, type LandZoneView } from './landLayer';
import { BUILDINGS, DETAILS, loadModels, ModelInstances, type Model } from './assets';
import { buildHouse, houseModel, CITY_LOW, CITY_TALL, HOUSE_STYLES, type HouseStyle } from './houses';
import { buildBike, buildCar as drawCar, buildMoto as drawMoto, buildRider, motoPillionSpec, motoRideSpec, carKindFor, vehicleModel, type CarKind } from './vehicles';
import { brakingDistance, drive, LaneIndex, type Mover } from './traffic';
import { buildAmbulance, buildParamedic, buildStretcher, flashBeacons, setDoors, type AmbulanceRig } from './ambulance';
import { sirenLevel, sirenStart, sirenStop } from '../lib/siren';
import { rainAt } from './weather';
import { buildSeaDistrict, type SeaDistrict } from './seaDistrict';

// Repère : x = ouest(−)/est(+), z = nord(−)/sud(+). La mer est au sud.
// Maquette schématique : le centre est comprimé ; ce repère n’est pas une projection métrique uniforme.
const MIN_X = -140;
// Marge orientale nécessaire au corridor Port–Kégué, qui contourne réellement l'aéroport.
const MAX_X = 230;
/** Bord visuel oriental du terrain (+20 autour de MAX_X), puis marge avant l'espace publicitaire. */
const EAST_AD_MIN_X = MAX_X + 24;
// À l'est de cette limite commencent l'emprise aéroportuaire et le corridor industriel du Port :
// on n'y répète pas la trame de concessions résidentielles du reste de Lomé.
const CITY_BUILD_MAX_X = 145;
const MIN_Z = -480;
/**
 * Grand Lomé : le sol s'étend au nord-ouest (Sogbossito, Légbassito) et le long de la RN1 jusqu'à Tsévié
 * (Davié et son péage à mi-chemin). Positions projetées depuis OpenStreetMap à l'échelle de la maquette
 * (34 unités par km, rond-point GTA en (0, -224) ; tout le nord a été remonté de 48 pour tripler l’écart GTA – carrefour OTR) : Davié ≈ (-19, -903), Tsévié ≈ (5, -1040).
 */
const MAP_MIN_X = -300;
const MAP_MIN_Z = -1110;
/** Bord est de la maquette : un peu au-delà de la ville, sans la côte vers Aného. */
const MAP_MAX_X = 260;
/** Le boulevard Eyadéma prolonge l'avenue x = 0 vers le nord (Université, OTR, CNSS), puis devient la RN1 jusqu'à Tsévié. */
const EYADEMA_END_Z = -1060;
const TOLL_Z = -840;
/** Dézoom maximal de la carte : assez large pour voir tout le Grand Lomé d'un coup. */
const MAP_MAX_ZOOM = 4;
const DAVIE_Z = -905;
const TSEVIE_ARCH_Z = -1000;
/** Route de Kpalimé (RN5), qui quitte la RN1 à Davié vers l'ouest (tracé schématique). */
const KPALIME_ROAD: [number, number][] = [[0, DAVIE_Z], [-60, DAVIE_Z - 8], [-130, DAVIE_Z - 38], [-215, DAVIE_Z - 70], [MAP_MIN_X + 6, DAVIE_Z - 92]];
const PRES_ROAD_Z = -224;
const PRES_ROAD_END_X = 64;
/** Carrefour OTR (boulevard Eyadéma) : rue vers Agbalépédogan au sud-ouest, entre la CNSS et l'OTR. */
const OTR_X = 0;
const OTR_Z = -152;
const OTR_BRANCH: [number, number][] = [[OTR_X, OTR_Z], [-14, OTR_Z + 4], [-30, OTR_Z + 9], [-43, OTR_Z + 7]];
/** Rond-point des cinq rues (avenue de la Chance, avenue Pya, rue de l'OTR, rue des agences) : un anneau remplace le carrefour où les véhicules s'entassaient. */
const CITY_RING = { x: -52, z: -146, R: 9, I: 3.6 };
/** Rues secondaires (polylignes) : tenues libres de maisons. */
/** Routes du nord (au-delà du rond-point GTA) : boulevard de Kégué vers l'est, route des Deux Lions vers l'ouest, voie d'Agoè. */
// Kégué est nettement au nord de Lomé II : ce recul évite de coller l'échangeur à la Présidence.
const KEGUE_Z = -289;
const DEUX_LIONS_Z = -314;
const AGOE_Z = -394;
const DEUX_LIONS_X = -80;
/**
 * Arrondit les angles d'une polyligne : chaque sommet intérieur devient une courbe (environ un arc de rayon `r`, réduit si
 * les segments voisins sont courts). Les extrémités ne bougent pas : les raccords aux autres routes restent exacts.
 */
const roundCorners = (pts: [number, number][], r = 7): [number, number][] => {
  if (pts.length < 3) return pts;
  const out: [number, number][] = [pts[0]!];
  for (let i = 1; i < pts.length - 1; i++) {
    const [ax, az] = pts[i - 1]!;
    const [bx, bz] = pts[i]!;
    const [cx, cz] = pts[i + 1]!;
    const l1 = Math.hypot(bx - ax, bz - az);
    const l2 = Math.hypot(cx - bx, cz - bz);
    if (l1 < 1e-3 || l2 < 1e-3) continue;
    const ux = (bx - ax) / l1, uz = (bz - az) / l1;
    const vx = (cx - bx) / l2, vz = (cz - bz) / l2;
    const turn = Math.acos(Math.max(-1, Math.min(1, ux * vx + uz * vz)));
    if (turn < 0.1) {
      out.push(pts[i]!);
      continue;
    }
    const t = Math.min(r * Math.tan(turn / 2), l1 * 0.45, l2 * 0.45);
    const p1: [number, number] = [bx - ux * t, bz - uz * t];
    const p2: [number, number] = [bx + vx * t, bz + vz * t];
    // Courbe de Bézier entre les deux points de tangence, le sommet comme point de contrôle
    const n = Math.max(2, Math.ceil(turn / 0.18));
    for (let k = 0; k <= n; k++) {
      const s = k / n;
      out.push([(1 - s) * (1 - s) * p1[0] + 2 * (1 - s) * s * bx + s * s * p2[0], (1 - s) * (1 - s) * p1[1] + 2 * (1 - s) * s * bz + s * s * p2[1]]);
    }
  }
  out.push(pts[pts.length - 1]!);
  return out;
};
// Tracés relevés sur OpenStreetMap (34 unités par km, rond-point GTA en (0, -224) ; tout le nord a été remonté de 48 pour tripler l’écart GTA – carrefour OTR)
/** Route directe du rond-point GTA au carrefour Deux Lions (nord-ouest), qui rejoint le boulevard de la CEDEAO. */
const GTA_LIONS: [number, number][] = [[-7, -229], [-14, -234], [-15, -245], [-24, -255], [-45, -264], [-65, -270], [-73, -276], [-77, -298], [DEUX_LIONS_X, DEUX_LIONS_Z]];
/** Entrée de la gare d'Agbalépédogan depuis la route GTA–Deux-Lions (rue Pythagore). */
const AGBALEPEDO_ACCESS: [number, number][] = [[-70, -222], [-55, -226], [-40, -231]];
/** Accès public à l'aérogare depuis le boulevard de la Paix ; il s'arrête au dépose-minute. */
const AIRPORT_ACCESS: [number, number][] = [[90, -110], [114, -108], [135, -104], [154, -102]];
/** Boulevard de la CEDEAO : de Deux Lions vers le nord-est, par Agoè-Assiyéyé, jusqu'à la N1 à l'échangeur d'Agoè. */
// Il finit en T sur la bretelle d'Agoè qui longe la rampe (avant, il la croisait en X pour rejoindre la RN1 sous le pont)
const CEDEAO_END: [number, number] = [-34.7, -396.2];
const CEDEAO: [number, number][] = [[DEUX_LIONS_X, DEUX_LIONS_Z], [-72, -314], [-54, -316], [-50, -340], [-51, -361], [-43, -370], CEDEAO_END];
/** Quatrième branche de Deux-Lions : voie nord entre les deux bassins de rétention. */
const DEUX_LIONS_NORTH: [number, number][] = [[DEUX_LIONS_X, DEUX_LIONS_Z], [-81, -330], [-82, -352], [-83, -374]];
/** Largeur de la chaussée des rues (m) ; voie de droite, voie des deux-roues et des vélos en découlent. */
const ROAD_W = 9;
const LANE = 2.2;
const ZEM_LANE = 2.1;
const BIKE_LANE = 3.1;
/** Axe et profil communs aux ponts, chaussées et itinéraires. Les angles viennent des tabliers OSM. */
const FLYOVERS = {
  echangeur_kegue: { x: 132, z: KEGUE_Z, yaw: -30 * Math.PI / 180, half: 9, ramp: 18, height: 6.5, width: 8 },
  echangeur_agoe: { x: 0, z: AGOE_Z, yaw: -22 * Math.PI / 180, half: 13, ramp: 32, height: 6.5, width: 9 },
};
type Flyover = typeof FLYOVERS.echangeur_kegue;
const bridgePoint = (b: Flyover, along: number, across = 0): [number, number] => [
  b.x + along * Math.cos(b.yaw) + across * Math.sin(b.yaw),
  b.z - along * Math.sin(b.yaw) + across * Math.cos(b.yaw),
];
// Un court tronçon droit dans l'axe avant chaque rampe : la route tourne au sol, et l'asphalte couvre toute la rampe
const bridgeLine = (b: Flyover): [number, number][] => [b.half + b.ramp + 6, b.half + b.ramp, b.half, 0, -b.half, -b.half - b.ramp, -b.half - b.ramp - 6].map(d => bridgePoint(b, d));
/** Hauteur du tablier, uniquement sur sa chaussée ; les axes transversaux restent au sol. */
const flyoverHeight = (x: number, z: number, direction?: [number, number]) => {
  for (const b of Object.values(FLYOVERS)) {
    const dx = x - b.x, dz = z - b.z;
    const along = dx * Math.cos(b.yaw) - dz * Math.sin(b.yaw);
    const across = dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw);
    if (Math.abs(across) > b.width / 2 + 0.7 || Math.abs(along) >= b.half + b.ramp) continue;
    if (direction) {
      const len = Math.hypot(...direction);
      if (len < 0.01 || Math.abs(direction[0] * Math.cos(b.yaw) - direction[1] * Math.sin(b.yaw)) / len < 0.85) continue;
    }
    return b.height * Math.min(1, (b.half + b.ramp - Math.abs(along)) / b.ramp);
  }
  return 0;
};
/** Axe continu Port → Kégué → Agoè, passant exactement par les pieds et les extrémités des tabliers. */
const GRAND_BYPASS: [number, number][] = [
  [128, 14], [145, 14], [165, 5], [180, -8], [205, -35], [215, -70], [218, -110], [218, -150], [210, -228],
  // Arrivée sur Kégué dans l'axe du pont (avant, un décrochement de 6 m faisait une marche au pied de la rampe, côté CHR)
  bridgePoint(FLYOVERS.echangeur_kegue, 62), ...bridgeLine(FLYOVERS.echangeur_kegue),
  // Après le pied est d'Agoè, la route reste dans l'axe sur 30 m (les bretelles s'y insèrent) avant de tourner vers Kégué
  ...roundCorners([[94, -314], [88, -340], bridgePoint(FLYOVERS.echangeur_agoe, 75), bridgePoint(FLYOVERS.echangeur_agoe, 51)]).slice(0, -1),
  ...bridgeLine(FLYOVERS.echangeur_agoe),
];
/** Jean-Paul II passe sous le pont : aucun sommet commun au centre du tablier. */
const JEAN_PAUL_II: [number, number][] = [[PRES_ROAD_END_X, PRES_ROAD_Z], [86, -229], [110, -238], [120, -258], [124, -273], [140, -305], [144, -328]];
/**
 * Bretelles d'Agoè (losange, comme un vrai échangeur) : chacune quitte la RN1 en douceur, longe la rampe sur le côté (hors du
 * béton), puis rejoint dans l'axe la route qui continue, restée droite sur une trentaine de mètres après le pied de rampe :
 * le tablier arrive au milieu, les bretelles de part et d'autre, et les trois se fondent en une seule chaussée.
 */
const AGOE_RAMP_SET = [-1, 1].flatMap(sx => [-1, 1].map(sz => {
  const b = FLYOVERS.echangeur_agoe;
  const foot = b.half + b.ramp;
  // Distance à l'axe : demi-tablier + demi-chaussée + 3 m de bas-côté
  const side = b.width / 2 + ROAD_W / 2 + 3;
  const ax: [number, number] = [Math.cos(b.yaw) * sx, -Math.sin(b.yaw) * sx];
  const start: [number, number] = [0, AGOE_Z + sz * 40];
  // Point de la RN1 à hauteur de la bretelle, puis début et fin du tronçon qui longe la rampe
  const onN1: [number, number] = [0, AGOE_Z + sz * side / Math.cos(b.yaw)];
  const q1 = bridgePoint(b, sx * 26, sz * side);
  const q2 = bridgePoint(b, sx * foot, sz * side);
  const end = bridgePoint(b, sx * (foot + 28), 0);
  const road: [number, number][] = [];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10, u = 1 - t;
    road.push([u * u * start[0] + 2 * u * t * onN1[0] + t * t * q1[0], u * u * start[1] + 2 * u * t * onN1[1] + t * t * q1[1]]);
  }
  const c1: [number, number] = [q2[0] + ax[0] * 14, q2[1] + ax[1] * 14];
  const c2: [number, number] = [end[0] - ax[0] * 14, end[1] - ax[1] * 14];
  for (let k = 0; k <= 10; k++) {
    const t = k / 10, u = 1 - t;
    road.push([
      u * u * u * q2[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * end[0],
      u * u * u * q2[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * end[1],
    ]);
  }
  // Suite de la route après l'insertion : vers Kégué à l'est, vers Légbassito à l'ouest
  const cont: [number, number][] = sx > 0 ? [bridgePoint(b, 75), [88, -340]] : [bridgePoint(b, -75), [-136, -432], [-180, -431]];
  // Tracé de circulation : un peu de RN1 avant la bretelle, puis la route qui continue après l'insertion
  const drive: [number, number][] = [[0, AGOE_Z + sz * 75], ...road, ...cont];
  // Conduite à droite : la droite du sens « en s'éloignant du pont » est le côté +sx de l'axe transversal. La bretelle de ce
  // côté sort (RN1 → route qui continue), l'autre entre (route qui continue → RN1). Au bout, la voiture repart sur la voisine.
  const oneWay: 1 | -1 = sx * sz > 0 ? 1 : -1;
  return { sx, sz, road, drive, oneWay, nextSx: oneWay > 0 ? sx : -sx, nextSz: oneWay > 0 ? -sz : sz };
}));
const AGOE_RAMPS = AGOE_RAMP_SET.map((r) => r.road);
/**
 * Route de Légbassito : elle quitte l'échangeur d'Agoè vers l'ouest, tout droit, passe au sud de Sogbossito puis longe le marché de
 * Légbassito et Apessito jusqu'à Mission-Tové. Elle fait partie des rues de la ville : les maisons de décor l'évitent.
 */
const LEGBASSITO_ROAD: [number, number][] = [bridgePoint(FLYOVERS.echangeur_agoe, -45), bridgePoint(FLYOVERS.echangeur_agoe, -75), [-136, -432], [-180, -431], [-222, -432], [-222, -468], [-222, -508], [-222, -544], [-225, -588], [-233, -628], [-255, -673], [-285, -713]];
/** Quartier d'affaires Ouest : les boulevards de Nyékonakpoè (z = -30) et d'Adidogomé (z = -110) prolongés vers l'ouest. */
const BIZ_MID_X = -200;
const BIZ_WEST_X = -250;
/** Avenue du bord ouest du quartier d'affaires, juste avant la limite de la carte. */
const BIZ_EDGE_X = -290;
/** Les avenues du quartier d'affaires montent jusqu'à une rue du nord (z = -286) : prolongement de la route d'Adidogomé de Deux Lions. */
const BIZ_NORTH_Z = -286;
const SIDE_ROADS: [number, number][][] = [
  // Route de la nouvelle Présidence : elle part du rond-point GTA, longe l’arrière (côté nord) du siège de YAS
  // et de la Présidence, puis rejoint le boulevard Jean-Paul II qui dessert le CHR Lomé-Commune.
  [[0, PRES_ROAD_Z], [PRES_ROAD_END_X, PRES_ROAD_Z]],
  // Avenue de la Chance : 5e branche du rond-point GTA (OSM), qui repart vers le sud-ouest en parallèle du boulevard Eyadéma.
  [[-6, -222], [-34, -221], [-50, -214], [-52, -155]],
  OTR_BRANCH,
  // Rue de service derrière la CNSS et à côté du siège GTA Assurances : de l'avenue de la Chance au boulevard Eyadéma
  [[-51, -177], [-2, -177]],
  JEAN_PAUL_II,
  // Corniche ouest : prolonge le boulevard de la côte (z = 14) vers l'ouest jusqu'à la route sur l'eau (secteur marin, voir seaDistrict.ts)
  [[MIN_X, 14], [-226, 14], [-312, 24], [-312, 38]],
  // Une seule polyligne évite les ruptures visuelles et de navigation entre Port, Kégué et Agoè.
  GRAND_BYPASS,
  GTA_LIONS,
  AGBALEPEDO_ACCESS,
  CEDEAO,
  DEUX_LIONS_NORTH,
  // Rue devant EZA ZOZO : relie la RN1 au boulevard de la CEDEAO, au sud du restaurant et du marché d'Agoè-Assiyéyé.
  [[0, -342], [-50.1, -342]],
  // Route d'Adidogomé à l'ouest de Deux Lions
  // Branche sud-ouest vers Adidogomé ; elle n'est pas horizontale sur la carte réelle.
  [[DEUX_LIONS_X, DEUX_LIONS_Z], [-96, -300], [-116, -291], [-136, -286]],
  // Avenue Pya : de la route GTA – Deux Lions par le rond-point Tsotsi jusqu'à l'avenue de Tokoin (la rue de l'OTR y aboutit)
  [[-68, -272], [-77, -231], [-70, -222], [-66, -213], [-59.5, -151]],
  [[-48.5, -137.7], [-43, -125], [-42, -112]],
  // Rue des agences d'Adidogomé, branchée sur l'avenue Pya, le long du lotissement
  [[-60.5, -143], [-125, -141]],
  // Boulevard Haho vers le marché de Hédzranawoé, au nord-ouest de l'aéroport.
  // Elle se poursuit vers le nord jusqu'à la route Jean-Paul II (carrefour au sommet [110, -238]), pour ne plus s'arrêter dans l'herbe
  [[90, -110], [98, -126], [106, -142], [108, -154], [108, -196], [110, -238]],
  // Route de l'Aviation / boulevard de la Paix : accès ouest à l'aérogare,
  // séparé du marché et arrêté sur la boucle publique, sans traverser la piste.
  AIRPORT_ACCESS,
  // Route de Légbassito à l’ouest et bretelles au sol ; pas de carrefour sur le tablier.
  LEGBASSITO_ROAD,
  ...AGOE_RAMPS,
  // Sortie Dogta-Lafiè : courte bretelle depuis la RN1 jusqu'au portail de l'hôpital.
  [[0, -446], [18, -446]],
  // Boulevards prolongés vers l'ouest jusque devant les boutiques Mode Nyékonakpoè et Mode Adidogomé
  // Les rues du quartier démarrent à l'intérieur de la grille de la ville (recouvrement de 20) : vrais carrefours, pas de bout de route
  [[MIN_X + 10, -30], [BIZ_EDGE_X, -30]],
  [[MIN_X + 10, -110], [BIZ_EDGE_X, -110]],
  // Quartier d'affaires Ouest (lieux de marque des partenaires Or et Argent) : deux avenues nord-sud prolongées vers le
  // nord, une rue au milieu (prolongement de z = -70) et deux rues plus au nord (z = -150, reliée à la rue des agences, et z = -190)
  // (14 = z du boulevard du bord de mer, COAST_Z, défini plus bas)
  [[BIZ_MID_X, BIZ_NORTH_Z], [BIZ_MID_X, 14]],
  [[BIZ_WEST_X, BIZ_NORTH_Z], [BIZ_WEST_X, 14]],
  [[BIZ_EDGE_X, BIZ_NORTH_Z], [BIZ_EDGE_X, 14]],
  // Boulevard du bord de mer prolongé vers l'ouest le long de la plage, jusqu'au bout du quartier
  [[MIN_X + 10, 14], [BIZ_EDGE_X, 14]],
  [[MIN_X + 10, -70], [BIZ_EDGE_X, -70]],
  [[-125, -141], [-150, -150], [BIZ_EDGE_X, -150]],
  // Rues du nord reliées à l'avenue Pya (carrefours à x ≈ -64 et -77)
  [[-64, -190], [BIZ_EDGE_X, -190]],
  [[-77, -230], [BIZ_EDGE_X, -230]],
  // Route d'Adidogomé prolongée vers l'ouest jusqu'à l'avenue du bord de la carte : elle dessert les emplacements Bronze du nord
  [[-136, BIZ_NORTH_Z], [BIZ_EDGE_X, BIZ_NORTH_Z]],
];
/** Accès de la place de l’Indépendance, raccordés à la grille urbaine. */
const CENTRAL_ROADS: [number, number][][] = [
  [[0, -50], [6.5, -50]], [[33.5, -50], [40, -50]],
  [[20, -70], [20, -63.5]], [[20, -36.5], [20, -30]],
];
// Virages arrondis (le contournement garde son tracé exact : il passe par les pieds des tabliers)
const CITY_ROADS = [...SIDE_ROADS, ...CENTRAL_ROADS].map((road) => (road === GRAND_BYPASS || AGOE_RAMPS.includes(road) ? road : roundCorners(road)));
const segDist = (px: number, pz: number, [ax, az]: [number, number], [bx, bz]: [number, number]) => {
  const dx = bx - ax;
  const dz = bz - az;
  const k = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(px - ax - k * dx, pz - az - k * dz);
};
/** Segments des rues secondaires, à plat, et leur index par case (utilisé par `onRoad`, appelé des centaines de milliers de fois à la construction). */
const ROAD_SEG_CELL = 24;
const ROAD_SEG_MARGIN = 6;
type RoadSeg = [number, number, number, number];
let roadSegIndex: { all: RoadSeg[]; grid: Map<number, RoadSeg[]> } | null = null;
const citySegmentIndex = (): { all: RoadSeg[]; grid: Map<number, RoadSeg[]> } => {
  if (roadSegIndex) return roadSegIndex;
  const all: RoadSeg[] = [];
  const grid = new Map<number, RoadSeg[]>();
  const pad = ROAD_W / 2 + ROAD_SEG_MARGIN + 1;
  for (const road of CITY_ROADS) {
    for (let i = 0; i < road.length - 1; i++) {
      const [ax, az] = road[i]!;
      const [bx, bz] = road[i + 1]!;
      const seg: RoadSeg = [ax, az, bx, bz];
      all.push(seg);
      for (let cx = Math.floor((Math.min(ax, bx) - pad) / ROAD_SEG_CELL); cx <= Math.floor((Math.max(ax, bx) + pad) / ROAD_SEG_CELL); cx++) {
        for (let cz = Math.floor((Math.min(az, bz) - pad) / ROAD_SEG_CELL); cz <= Math.floor((Math.max(az, bz) + pad) / ROAD_SEG_CELL); cz++) {
          const key = cx * 100003 + cz;
          const list = grid.get(key);
          if (list) list.push(seg);
          else grid.set(key, [seg]);
        }
      }
    }
  }
  roadSegIndex = { all, grid };
  return roadSegIndex;
};
/** Points des routes (hors tabliers et rampes des échangeurs) tous les 4 m : départs possibles des routes d'accès aux terrains. */
let roadSampleCache: [number, number][] | null = null;
const roadSamples = (): [number, number][] => {
  if (roadSampleCache) return roadSampleCache;
  const pts: [number, number][] = [];
  const bridges = Object.values(FLYOVERS).map((b) => ({ x: b.x, z: b.z, r: b.half + b.ramp + 12 }));
  const push = (x: number, z: number) => {
    if (!inLagoon(x, z, 4) && !bridges.some((q) => Math.hypot(x - q.x, z - q.z) < q.r)) pts.push([x, z]);
  };
  for (const z of ROADS_Z) for (let x = MIN_X; x <= roadEastEnd(z); x += 4) push(x, z + bend(z, x));
  for (const x of ROADS_X) {
    const end = x === 0 ? EYADEMA_END_Z : ROAD_END_Z - ROAD_W / 2;
    for (let z = 14; z >= end; z -= 4) push(x + bend(x, z), z);
  }
  for (const road of CITY_ROADS) {
    for (let i = 0; i < road.length - 1; i++) {
      const [ax, az] = road[i]!;
      const [bx, bz] = road[i + 1]!;
      const len = Math.hypot(bx - ax, bz - az);
      for (let d = 0; d <= len; d += 4) push(ax + ((bx - ax) * d) / (len || 1), az + ((bz - az) * d) / (len || 1));
    }
  }
  return (roadSampleCache = pts);
};
/** Lieux posés hors du quadrillage de la ville : une route d'accès les relie au réseau. */
const COUNTRY_VENUES = new Set(['studio_ori_infos', 'capture_media', 'lavage_auto']);
const WALK_MAX_Z = 32;
/**
 * Lagunes de Lomé (contours OpenStreetMap ramenés au plan du centre) : Lac Ouest au nord de Kodjoviakopé,
 * Lac Est (lagune de Bè) au nord-est d'Akodessewa. Ellipses : centre, demi-axes.
 */
const LAGOONS = [
  { x: -64, z: -50, rx: 17, rz: 10 },
  { x: 133, z: -90, rx: 11, rz: 6 },
];
const inLagoon = (x: number, z: number, margin = 0) => LAGOONS.some((l) => ((x - l.x) / (l.rx + margin)) ** 2 + ((z - l.z) / (l.rz + margin)) ** 2 < 1);

/**
 * Réseau routier du nord (boulevard Eyadéma + rues secondaires) : sommets des tracés, reliés aux carrefours
 * (une extrémité posée sur une autre route y est raccordée). Les trajets suivent ce réseau au lieu de couper
 * à travers les maisons.
 */
const NORTH_NET = (() => {
  const lines: [number, number][][] = [[[0, -104], [0, EYADEMA_END_Z]], ...SIDE_ROADS.map((r) => r.map((p) => [...p] as [number, number]))];
  // Raccorde chaque extrémité à la route la plus proche (à moins de 10 unités) en insérant le point projeté
  for (const [li, line] of lines.entries()) {
    for (const end of [line[0]!, line[line.length - 1]!]) {
      let best: { lj: number; k: number; p: [number, number]; d: number } | null = null;
      for (const [lj, other] of lines.entries()) {
        if (lj === li) continue;
        for (let k = 0; k < other.length - 1; k++) {
          const a = other[k]!;
          const b = other[k + 1]!;
          const dx = b[0] - a[0];
          const dz = b[1] - a[1];
          const t = Math.max(0, Math.min(1, ((end[0] - a[0]) * dx + (end[1] - a[1]) * dz) / (dx * dx + dz * dz || 1)));
          const p: [number, number] = [a[0] + t * dx, a[1] + t * dz];
          const d = Math.hypot(p[0] - end[0], p[1] - end[1]);
          if (d < 10 && (!best || d < best.d)) best = { lj, k, p, d };
        }
      }
      if (!best) continue;
      const other = lines[best.lj]!;
      const a = other[best.k]!;
      const b = other[best.k + 1]!;
      if (Math.hypot(best.p[0] - a[0], best.p[1] - a[1]) > 0.5 && Math.hypot(best.p[0] - b[0], best.p[1] - b[1]) > 0.5) other.splice(best.k + 1, 0, best.p);
      // L'extrémité rejoint le carrefour
      if (end === line[0]) line.unshift(best.p);
      else line.push(best.p);
    }
  }
  const nodes: [number, number][] = [];
  const idOf = (p: [number, number]) => {
    const i = nodes.findIndex((n) => Math.hypot(n[0] - p[0], n[1] - p[1]) < 0.6);
    if (i >= 0) return i;
    nodes.push(p);
    return nodes.length - 1;
  };
  const edges: [number, number][] = [];
  for (const line of lines) for (let k = 0; k < line.length - 1; k++) edges.push([idOf(line[k]!), idOf(line[k + 1]!)]);
  return { nodes, edges };
})();

/** Itinéraire sur le réseau du nord entre deux points quelconques (chacun rattaché à la route la plus proche). */
function northPath(ax: number, az: number, bx: number, bz: number): [number, number][] {
  const { nodes, edges } = NORTH_NET;
  const snap = (x: number, z: number) => {
    let best = { e: 0, p: [x, z] as [number, number], d: Infinity };
    edges.forEach(([i, j], e) => {
      const p = [x, z] as [number, number];
      const d = segDist(p[0], p[1], nodes[i]!, nodes[j]!);
      if (d < best.d) {
        const [a, b] = [nodes[i]!, nodes[j]!];
        const dx = b[0] - a[0];
        const dz = b[1] - a[1];
        const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1)));
        best = { e, p: [a[0] + t * dx, a[1] + t * dz], d };
      }
    });
    return best;
  };
  const sa = snap(ax, az);
  const sb = snap(bx, bz);
  // Graphe local : sommets + deux points rattachés (indices n et n + 1)
  const n = nodes.length;
  const pts = [...nodes, sa.p, sb.p];
  const adj: [number, number][][] = pts.map(() => []);
  const link = (i: number, j: number) => {
    const d = Math.hypot(pts[i]![0] - pts[j]![0], pts[i]![1] - pts[j]![1]);
    adj[i]!.push([j, d]);
    adj[j]!.push([i, d]);
  };
  edges.forEach(([i, j], e) => {
    const on = [sa.e === e ? n : -1, sb.e === e ? n + 1 : -1].filter((k) => k >= 0);
    if (on.length === 0) return link(i, j);
    // Arête coupée par le(s) point(s) rattaché(s), dans l'ordre le long de l'arête
    on.sort((p, q) => Math.hypot(pts[p]![0] - nodes[i]![0], pts[p]![1] - nodes[i]![1]) - Math.hypot(pts[q]![0] - nodes[i]![0], pts[q]![1] - nodes[i]![1]));
    let prev = i;
    for (const k of on) {
      link(prev, k);
      prev = k;
    }
    link(prev, j);
  });
  // Dijkstra (quelques dizaines de sommets)
  const dist = pts.map(() => Infinity);
  const from = pts.map(() => -1);
  const done = pts.map(() => false);
  dist[n] = 0;
  for (;;) {
    let u = -1;
    for (let i = 0; i < pts.length; i++) if (!done[i] && dist[i]! < Infinity && (u < 0 || dist[i]! < dist[u]!)) u = i;
    if (u < 0 || u === n + 1) break;
    done[u] = true;
    for (const [v, w] of adj[u]!) {
      if (dist[u]! + w < dist[v]!) {
        dist[v] = dist[u]! + w;
        from[v] = u;
      }
    }
  }
  const path: [number, number][] = [];
  for (let u = n + 1; u >= 0; u = from[u]!) {
    path.unshift(pts[u]!);
    if (u === n) break;
  }
  return path[0] === sa.p ? path : [sa.p, sb.p];
}
/** Parc de la circulation : modèle, poids de tirage, bande éventuelle, teintes possibles. */
const TRAFFIC: { kind: CarKind; weight: number; stripe?: number; paints: number[] }[] = [
  { kind: 'hatch', weight: 6, stripe: 0x111111, paints: [0xffce00] }, // taxi jaune
  { kind: 'sedan', weight: 4, paints: [0xc0c6cc, 0x1b1d22, 0xb3122e, 0x2e3a8c, 0xf2f2f2, 0x6b7280] },
  { kind: 'suv', weight: 3, paints: [0x1b1d22, 0x1f5f3a, 0xf2f2f2, 0x8a8f96, 0x7a1f1f] },
  { kind: 'hatch', weight: 3, paints: [0x2e3a8c, 0x1f8a8a, 0x4caf50, 0xc8102e, 0xd9c7a0, 0xf2f2f2] },
  { kind: 'van', weight: 2, paints: [0xf2f2f2, 0xd9c7a0, 0x1f6feb] },
  { kind: 'truck', weight: 2, paints: [0xe5383b, 0x1f6feb, 0xf2f2f2] },
  // Poids lourds articulés (matières premières, carburant, ciment) : jamais tirés au hasard, placés sur les contournements et la RN1 (voir `heavyTypes`)
  { kind: 'semi', weight: 0, paints: [0xe5383b, 0x1f6feb, 0x1f8a4c, 0xf2a900, 0x2e3a8c] },
  { kind: 'tanker', weight: 0, paints: [0xf2f2f2, 0xe5383b, 0x1f6feb, 0xf2a900] },
  { kind: 'van', weight: 1, stripe: 0xd21034, paints: [0xf7f7f7] }, // ambulance
  // Véhicules longs : bus de ville Sotral et cars de ligne, quelques-uns seulement
  { kind: 'bus', weight: 1, stripe: 0xffce00, paints: [0x1f6feb] },
  { kind: 'bus', weight: 0.8, paints: [0xf2f2f2, 0xe9e4d8] },
];
/** Longueur occupée dans la file (m) : le modèle et un peu de marge ; 6 m au moins, 11 m pour un bus. */
const isLongKind = (k?: CarKind): boolean => k === 'bus' || k === 'truck' || k === 'semi' || k === 'tanker';
/** Indices (dans TRAFFIC) des poids lourds articulés. */
const heavyTypes = (): number[] => TRAFFIC.flatMap((t, i) => (t.kind === 'semi' || t.kind === 'tanker' ? [i] : []));
const trafficLen = (type: number) => ({ bus: 11, truck: 7, semi: 17, tanker: 15 } as Partial<Record<CarKind, number>>)[TRAFFIC[type]?.kind ?? 'sedan'] ?? 6;
/** Teinte stable d'un véhicule de la circulation (même couleur d'une image à l'autre). */
function trafficPaint(type: number, n: number): number {
  const p = TRAFFIC[type]?.paints ?? [0xffffff];
  return p[(n * 2654435761 >>> 0) % p.length]!;
}
/** Assise et pose du conducteur d'un deux-roues. */
const ZEM_SEAT = { seatY: 0.93, seatZ: -0.25, lean: 0.3 };
const ROADS_Z = [14, -30, -70, -110];
const ROADS_X = [-90, -40, 0, 40, 90];
/** Boulevard du bord de mer : les avenues y finissent, la plage commence juste au sud. */
const COAST_Z = ROADS_Z[0]!;
/**
 * La circulation ordinaire du boulevard du bord de mer fait demi-tour avant le carrefour du Port (x = 90) : avec elle,
 * ce carrefour en T se bloquait aux heures de pointe. La portion devant le Port est laissée aux camions du Port.
 */
const COAST_EAST_STOP = 82;
/** Bout est de la circulation sur une route. */
const trafficEast = (z: number) => (nearest(z, ROADS_Z) === COAST_Z ? COAST_EAST_STOP : roadEastEnd(z));
/**
 * Les boulevards urbains s'arrêtent à l'aéroport ; seul AIRPORT_ACCESS entre côté public jusqu'à l'aérogare.
 * Celui du sud (z = −70) va jusqu'à l'aire de la tour de contrôle et du dépôt de carburant ; celui du nord
 * (z = −110) s'arrête à la station-service, où l'accès à l'aérogare prend le relais.
 */
const roadEastEnd = (z: number) => {
  const road = nearest(z, ROADS_Z);
  return road === -70 ? 148 : road === -110 ? 140 : MAX_X;
};
/** Les avenues nord-sud s'arrêtent au dernier boulevard (aéroport, gare et campus au sud). */
const ROAD_END_Z = -110;
/** Le personnage arrive devant l'entrée, sur le parvis (au sud du lieu). */
const ENTRY = 12;
/** Lieux entourés d'une clôture pleine : leur point d'arrivée est à l'intérieur de l'enceinte, juste derrière le portail. */
const FENCED_VENUES = new Set(['hopital_dogta', 'cnss']);
/** Façades orientées dans la ville, indépendamment de la caméra. Entrées en coordonnées locales après réduction. */
const VENUE_LAYOUTS: Record<string, { scale: [number, number, number]; yaw: number; entries: [number, number][] }> = {
  // Palais des Congrès à sa vraie stature : seul dans son îlot
  palais_congres: { scale: [0.6, 1, 0.6], yaw: -79.4, entries: [[0, 10.5], [5, 10.5]] },
  // Station du boulevard Eyadéma : pompes et entrée tournées vers le boulevard, à l'est.
  station_boulevard: { scale: [1, 1, 1], yaw: 90, entries: [[0, 14], [6, 14]] },
  // Station Oryx réduite, dans le bloc libre à l'est du CHU (elle était posée sur lui et collée aux deux rues voisines)
  station_oryx: { scale: [0.8, 1, 0.8], yaw: 0, entries: [[0, 12], [5, 12], [-5, 12]] },
  // Siège GTA Assurances au sud-ouest du rond-point GTA, entre l'avenue de la Chance et le boulevard : façade vers le boulevard (est)
  // Grand Marché agrandi, juste à l'est de l'avenue qui longe le Palais
  marche_assigame: { scale: [0.7, 0.9, 0.7], yaw: 0, entries: [[0, 7.5], [10, 6.5], [-8, 6.5]] },
  // Cathédrale agrandie, à l'est du Grand Marché
  cathedrale: { scale: [0.65, 0.95, 0.65], yaw: 0, entries: [[0, 8], [6, 6.5]] },
  boad: { scale: [1, 1, 1], yaw: 0, entries: [[-9, 4.6], [-9, 4.2]] },
  chu_campus: { scale: [1, 1, 1], yaw: 0, entries: [[3.5, -10], [2.5, -10]] },
  // Parvis sud-est : l'accès reste sur le campus, à l'extérieur de l'enceinte du CHU.
  universite: { scale: [0.6, 0.85, 0.6], yaw: 90, entries: [[-9, 5], [0, 9], [5, 9]] },
  colombe_paix: { scale: [1, 1, 1], yaw: 0, entries: [[8, 9], [9, 8]] },
  carrefour_deux_lions: { scale: [1, 1, 1], yaw: 0, entries: [[10, 10], [8, 10]] },
  echangeur_agoe: { scale: [1, 1, 1], yaw: 0, entries: [[8, 28], [10, 28]] },
  echangeur_kegue: { scale: [1, 1, 1], yaw: 0, entries: [[15, -5], [16, -5]] },
  monument: { scale: [1, 1, 1], yaw: 100.6, entries: [[0, 9], [5, 9]] },
  cnss: { scale: [0.55, 0.8, 0.55], yaw: 0, entries: [[0, 1.8], [3, 1.8]] },
  // Bank of Africa : la façade (bandeau vert, hall) fait face à la route la plus proche
  bank_boa_1: { scale: [1, 1, 1], yaw: 152, entries: [[0, 5.2], [5, 5.2], [-5, 5.2]] }, // le siège (6.1229 N, 1.2244 E) : façade tournée vers la cathédrale (82, -39)
  bank_boa_2: { scale: [1, 1, 1], yaw: 180, entries: [[0, 7], [5, 7], [-5, 7]] }, // agence simple : face à la route du nord
  // Ecobank, siège de Bè : façade tournée vers le boulevard au nord (yaw 180) ; le bâtiment est décalé de 6 m à l'est du point d'arrivée
  bank_ecobank_2: { scale: [1, 1, 1], yaw: 180, entries: [[-6, 5.9], [-4, 5.9], [-8, 5.9]] },
  moov_africa: { scale: [1, 1, 1], yaw: 0, entries: [[0, 3.4], [6, 3.4], [-6, 3.4]] }, // devant le perron, sur le trottoir (et non au milieu de la chaussée)
  otr: { scale: [0.7, 0.9, 0.7], yaw: -70, entries: [[0, 5], [4, 5]] },
  yas: { scale: [0.55, 0.85, 0.55], yaw: -90, entries: [[0, 5], [4, 5]] },
  // EZA ZOZO, à l'ancienne place du marché d'Agoè-Assiyéyé, au nord de la rue qui relie la RN1 à la CEDEAO : façade sur cette rue (au sud)
  eza_zozo: { scale: [0.8, 0.9, 0.8], yaw: 0, entries: [[0, 9.5], [5, 9.5]] },
  // La Nouvelle Présidence est au sud de la route qui lui porte son nom : son portail regarde vers le nord (OSM relation 2688600).
  // Dogta-Lafiè est à l'est de la RN1 : sa façade et son portail regardent vers la route, à l'ouest.
  hopital_dogta: { scale: [0.6, 0.72, 0.6], yaw: -90, entries: [[0, 9], [3, 9], [-3, 9]] },
  stade_kegue: { scale: [0.65, 0.7, 0.65], yaw: 0, entries: [[0, 9], [5, 9], [-5, 9]] },
  // Ambassade des États-Unis : en face du CHU Campus, de l'autre côté du boulevard, façade vers l'ouest
  // Marché d'Agoè-Assiyéyé : à l'est du boulevard de la CEDEAO, façade vers la route qui passe devant
  // Gare Sotral (Parc central, avenue de la Paix) : façade vers la route de l'aéroport, au nord
  gare_sotral: { scale: [1, 1, 1], yaw: 180, entries: [[0, 4.4], [4, 4.4], [-4, 4.4]] },
  // Prêt-à-porter du Grand Marché : derrière les agences de la rue du Commerce, sa vitrine regarde le boulevard au nord
  mode_assigame: { scale: [1, 1, 1], yaw: 180, entries: [[0, 6], [3, 6], [-3, 6]] },
  // Hôtel du 2 Février : entrée et enseigne côté boulevard, au nord (face à la place de l'Indépendance)
  hotel_2fevrier: { scale: [1, 1, 1], yaw: 180, entries: [[0, 7.5], [4, 7.5], [-4, 7.5]] },
  // Chaussures et Mode de Bè : sur la pelouse derrière la Boutique du quartier, au sud du boulevard, vitrine vers lui
  mode_be: { scale: [1, 1, 1], yaw: 180, entries: [[0, 6], [3, 6], [-3, 6]] },
  // Marché d'Agoè-Assiyéyé réduit, au nord d'EZA ZOZO vers l'échangeur d'Agoè, entre la bretelle ouest et la CEDEAO
  marche_agoe: { scale: [0.55, 1, 0.55], yaw: -90, entries: [[0, 6], [3.5, 6], [-3.5, 6]] },
  amb_usa: { scale: [1, 1, 1], yaw: -90, entries: [[0, 9], [3, 9], [-3, 9]] },
  presidence: { scale: [0.7, 0.75, 0.7], yaw: 180, entries: [[0, 13], [4, 13], [-4, 13]] },
  marche_hedzranawoe: { scale: [0.65, 0.8, 0.65], yaw: 0, entries: [[0, 6], [4, 6], [-4, 6]] },
  // Marché des féticheurs d'Akodessewa : plein air derrière l'aéroport, enseigne et entrée vers la route de l'est
  akodessewa: { scale: [1, 1, 1], yaw: 90, entries: [[0, 7], [4, 7], [-4, 7]] },
};
const venueYaw = (id: string) => (VENUE_LAYOUTS[id]?.yaw ?? 0) * Math.PI / 180;
const rotateXZ = (x: number, z: number, yaw: number): [number, number] => [x * Math.cos(yaw) + z * Math.sin(yaw), -x * Math.sin(yaw) + z * Math.cos(yaw)];
/** Piste 04/22 : la piste (axe x local) pointe au nord-est, l'aérogare (+z local) au nord-ouest. */
const AIRPORT_ROT = (-129 * Math.PI) / 180;
// Emprise compacte : la piste reste lisible sans recouvrir Hédzranawoé ni le centre-ville.
const AIRPORT_SCALE = 0.54;
/** Emprise au sol des grands lieux (demi-largeur, recul au nord) ; par défaut 12 × 12. */
/** Panneaux numérotés réservables (0 à N-1), debout et « à louer » même sans annonce : égal au réglage serveur `ad.boards.count`. */
const NUMBERED_BOARDS = 40;

const FOOTPRINT: Record<string, { hw: number; back: number; front?: number }> = { station_oryx: { hw: 13, back: 9, front: 12 }, station_total: { hw: 16, back: 11, front: 14 }, station_lome2: { hw: 16, back: 11, front: 14 }, station_boulevard: { hw: 16, back: 11, front: 14 }, hopital_dogta: { hw: 22, back: 17, front: 14 }, studio_ori_infos: { hw: 9, back: 7, front: 10 }, capture_media: { hw: 9, back: 7, front: 10 }, aeroport: { hw: 46, back: 50, front: 50 }, carrefour_gta: { hw: 24, back: 20, front: 18 }, carrefour_deux_lions: { hw: 26, back: 28, front: 14 }, carrefour_otr: { hw: 8, back: 8, front: 8 }, otr: { hw: 8, back: 6.5, front: 7 }, chu_campus: { hw: 4, back: 13, front: 13 }, port: { hw: 24, back: 16 }, agbalepedo: { hw: 15, back: 13, front: 12 }, eza_zozo: { hw: 8, back: 8, front: 10 }, universite: { hw: 9, back: 7, front: 10 }, marche_assigame: { hw: 11.4, back: 9.6, front: 7 }, akodessewa: { hw: 11, back: 7.5, front: 7 }, supermarche: { hw: 14, back: 12 }, palais_congres: { hw: 15.6, back: 12.4, front: 12.4 }, colombe_paix: { hw: 9, back: 9, front: 13 }, cathedrale: { hw: 7.3, back: 16.3, front: 7.3 }, boad: { hw: 15, back: 6.5, front: 12.5 }, hotel_2fevrier: { hw: 9, back: 6, front: 6 }, monument: { hw: 14, back: 14, front: 14 }, cnss: { hw: 24, back: 14, front: 26 }, yas: { hw: 11, back: 6, front: 6 }, presidence: { hw: 17, back: 12, front: 10 }, amb_usa: { hw: 9, back: 8, front: 9 }, marche_agoe: { hw: 9.5, back: 6.5, front: 5.5 }, marche_hedzranawoe: { hw: 9, back: 8, front: 8 }, chr_commune: { hw: 20, back: 14, front: 12 }, stade_kegue: { hw: 17, back: 27, front: 10 }, palais_lome: { hw: 14, back: 9 }, echangeur_kegue: { hw: 24, back: 20, front: 20 }, echangeur_agoe: { hw: 50, back: 45, front: 45 }, gare_sotral: { hw: 16, back: 12, front: 12 }, station_zem: { hw: 12, back: 12, front: 14 }, lavage_auto: { hw: 5.5, back: 7, front: 7 }, grande_mosquee: { hw: 10, back: 11, front: 12 } };
/** Durée maximale d'un trajet à l'écran, en secondes réelles. */
const MAX_TRIP_S = 48;
/**
 * Carrefours à feux : centre et décalage du cycle (onde verte le long du boulevard). Le premier est le
 * carrefour OTR (ses lignes d'arrêt sont propres) ; les autres croisent une avenue et une rue du quadrillage.
 */
const SIGNALS: { x: number; z: number; offset: number; straight?: boolean }[] = [
  { x: OTR_X, z: OTR_Z, offset: 0 },
  { x: 0, z: -30, offset: 0 },
  { x: 0, z: -70, offset: 6 },
  { x: 0, z: -110, offset: 12 },
  { x: 40, z: -70, offset: 26 },
  { x: -40, z: -70, offset: 40 },
  // Quartier d'affaires Ouest : carrefours des deux avenues du milieu avec les boulevards (routes droites, hors grille)
  { x: BIZ_MID_X, z: -30, offset: 0, straight: true },
  { x: BIZ_MID_X, z: -70, offset: 8, straight: true },
  { x: BIZ_MID_X, z: -110, offset: 16, straight: true },
  { x: BIZ_WEST_X, z: -30, offset: 24, straight: true },
  { x: BIZ_WEST_X, z: -70, offset: 32, straight: true },
  { x: BIZ_WEST_X, z: -110, offset: 40, straight: true },
];
/** Indice du premier feu du quartier d'affaires : ceux-là régulent les tracés de rue (pas la grille). */
const FIRST_DISTRICT_SIGNAL = 6;
/** Cycle de 44 s : axe nord-sud vert 18 s, orange 3 s, rouge intégral 1 s, puis l'axe est-ouest. */
/** Cycle des feux : vert 18 s, orange 3 s, rouge 23 s (avant 25 / 3 / 32 s : les files de 10 véhicules attendaient plus d'une demi-minute). */
const SIGNAL_CYCLE = 44;
type SignalState = 'green' | 'amber' | 'red';
const signalState = (i: number, axis: 'x' | 'z', t: number): SignalState => {
  const k = (t + SIGNALS[i]!.offset) % SIGNAL_CYCLE;
  const local = axis === 'z' ? k : (k + SIGNAL_CYCLE / 2) % SIGNAL_CYCLE;
  return local < 18 ? 'green' : local < 21 ? 'amber' : 'red';
};
/** Feu du carrefour (avenue rx, rue rz) du quadrillage, ou -1. */
const signalAt = (rx: number, rz: number) => SIGNALS.findIndex((g, i) => i > 0 && g.x === rx && g.z === rz);
/** Clé d'un carrefour du quadrillage. */
const junctionKey = (rx: number, rz: number) => rx * 4096 + rz;
/** Emprise au sol d'un obstacle ; hauteur inconnue = obstacle haut. */
type Solid = { x0: number; x1: number; z0: number; z1: number; h?: number };
const SOLID_CELL = 8;
const solidKey = (ix: number, iz: number) => (ix + 4096) * 8192 + (iz + 4096);

const C = {
  earth: 0xc9dea6, // herbe claire (vue d'ensemble lumineuse, façon jeu de ville)
  grass: 0xbfdc9c,
  sand: 0xf4e6bf,
  road: 0x8d96a2,
  line: 0xffffff,
  sea: 0x3d9be9,
  trunk: 0x9a7350,
  palm: 0x2e9e5b,
  plot: 0xf1f3f6,
};
// Murs peints de Lomé : blanc, crème, bleu ciel, jaune, vert d'eau, rose pâle
/** Couleurs d'auvents et d'enseignes des boutiques (opérateurs mobiles, bars, pharmacies, quincailleries…). */
const SHOP_COLORS = [0xf6c90e, 0x1f6feb, 0xe5383b, 0x22a861, 0xf18f01, 0x8e44ad, 0x00a6a6];
const WALLS = [0xffffff, 0xfdf3dc, 0xdbe9fb, 0xffe7a3, 0xd8f0e2, 0xfadde1, 0xffffff, 0xf3efe6, 0xf1d9b5, 0xe8c9a0, 0xcfe3ee, 0xf4c7b8, 0xc9d8c5, 0xe9e2d0];
/** Peintures des voitures qui passent au lavage (blanc, noir, gris, rouge, bleu, beige…). */
const WASH_PAINTS = [0xf4f4f4, 0x1b1b1b, 0x9aa3ad, 0xc0392b, 0x2563eb, 0xd8c7a3, 0x2f6b3a, 0x6b7280, 0x7c2d12];
const ROOFS = [0x8a96a6, 0x6f7f93, 0xb4552d, 0x9aa5b4, 0x3d7bd9, 0xc96a3b];

export type CityView = 'map' | 'street';
export type TravelMode = 'WALK' | 'ZEM' | 'WORO' | 'BUS' | 'CAR';

export interface CityVenue {
  id: string;
  emoji: string;
  label: string;
  x: number;
  z: number;
  /** Maison du joueur seulement : type de logement (dessine la concession correspondante) ; null = à la rue. */
  housing?: string | null;
  /** Maison construite sur un terrain : modèle dessiné dans la concession (voir houses.ts). */
  style?: string | null;
}

/** Affiche publicitaire (marques fictives tant qu'aucun accord partenaire n'existe). */
export interface Ad {
  id: string;
  slot: number;
  title: string;
  sub: string;
  bg: string;
  fg: string;
  image?: string;
}
/** Compagnie de cars (fictive) peinte sur les véhicules de la gare routière. */
export interface BusLine {
  name: string;
  color: string;
}

export interface WorldOptions {
  venues: CityVenue[];
  home: CityVenue;
  look: PersonLook;
  ads: Ad[];
  busLines: BusLine[];
  /** Épingle touchée (carte). */
  onPick: (id: string) => void;
  /** Lieu le plus proche à pied (rue), ou null. */
  onNear: (id: string | null) => void;
  /** Le personnage est arrivé devant l'entrée d'un lieu (ou de sa maison) : on y entre sans appuyer sur « Entrer ». */
  onArrive?: (id: string | null) => void;
  /** Panneau publicitaire touché : identifiant de la campagne affichée. */
  onBillboard: (adId: string, panel?: number) => void;
  /** Texte des panneaux sans annonce (traduit), et emplacement libre touché pour le réserver. */
  freeBoard?: { title: string; sub: string };
  onFreeBoard?: (slot: number) => void;
  /** Lieux de marque des partenaires Argent et Or. */
  brands?: BrandSpot[];
  /** Emplacements VIP libres et clic sur l'un d'eux. */
  vipSpots?: VipSpot[];
  onVipSpot?: (id: string) => void;
  /** Lieu de marque touché. */
  onBrand?: (id: string) => void;
  /** Temps de jeu total (minutes) : météo (pluie, sol mouillé) identique à celle du téléphone. */
  totalMinutes?: () => number;
  /** Parcelles en mer : grille et parcelles louées. */
  sea?: { grid: SeaGridSpec; plots: SeaPlotSpec[] };
  /** Autres espaces de pub (est de la ville, lagunes), loués comme la mer. */
  zones?: { id: string; grid: SeaGridSpec; plots: SeaPlotSpec[] }[];
  /** Case libre touchée (colonne, rangée, espace) ou parcelle en ligne touchée. */
  onSeaCell?: (x: number, y: number, zone: string) => void;
  /** Terrains à vendre : zones dessinées sur la carte et lot touché (zone, cellule). */
  land?: LandZoneView[];
  onLandCell?: (zoneId: string, cell: number) => void;
  onPlot?: (id: string) => void;
}

export interface SeaGridSpec {
  cols: number;
  rows: number;
  cell: number;
  originX: number;
  originZ: number;
}
export interface SeaPlotSpec {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
  live: boolean;
  title?: string;
  sub?: string;
  bg?: string;
  fg?: string;
  /** Image validée de l'annonce (servie par l'API). */
  image?: string;
}

/** Espace vert réservé aux partenaires Argent et Or, encore libre : une balise « VIP SPACE » invite à le réserver. */
export interface VipSpot {
  id: string;
  /** Texte de l'épingle (traduit). */
  label: string;
  tier: 'GOLD' | 'SILVER' | 'BRONZE' | null;
  x: number;
  z: number;
}

/** Lieux déjà tenus par un partenaire : formule Or ou Argent (badge sur leur épingle). */
const PARTNER_VENUE_TIER: Record<string, 'GOLD' | 'SILVER'> = { station_zem: 'GOLD', eza_zozo: 'GOLD', capture_media: 'SILVER', studio_ori_infos: 'SILVER' };

export interface BrandSpot {
  id: string;
  label: string;
  color: string;
  /** Modèle du bâtiment ; inconnu ou absent : agence. */
  model?: string;
  /** Logo du partenaire (adresse de l'image) : affiché sur l'enseigne et le totem. */
  logo?: string | null;
  x: number;
  z: number;
}

interface Walker {
  g: THREE.Group;
  axis: 'x' | 'z';
  lane: number;
  pos: number;
  dir: 1 | -1;
  speed: number;
  phase: number;
}
interface Car extends Mover {
  type: number;
  /** Vitesse de croisière hors embouteillage (m/s). */
  cruise: number;
  /** Hors circulation (heures creuses) : ni dessiné ni simulé. */
  off?: boolean;
  /** Temps passé à l'arrêt (secondes) : sert à retirer les véhicules d'un embouteillage durable. */
  jam?: number;
}
type Zem = Mover;
/** Voiture sur une rue secondaire (tracé en polyligne) : position = abscisse curviligne le long du tracé. */
const X_AXIS = new THREE.Vector3(1, 0, 0);
interface PathCar extends Mover {
  /** Cap lissé (radians) : les virages et demi-tours se font en tournant, sans claquer d'un côté à l'autre. */
  ha?: number;
  /** Secondes restantes où la voiture, bloquée trop longtemps, passe malgré le véhicule de tête. */
  ghostT?: number;
  type: number;
  route: number;
  cruise: number;
  off?: boolean;
  /** Position dans la scène (centre du véhicule, voie de droite comprise, hauteur sur un tablier) et sens de marche, mis à jour à chaque image. */
  x: number;
  y: number;
  z: number;
  hx: number;
  hz: number;
  /** Inclinaison (rad, nez vers le haut si positive) : sur une rampe, le véhicule suit la pente au lieu de rester à plat. */
  pitch?: number;
  /** Temps d'attente sans avancer (s) : au bout de quelques secondes il passe, pour ne jamais bloquer un carrefour. */
  wait: number;
  /** Rang de priorité aux carrefours entre tracés : le plus grand cède au plus petit (jamais de blocage mutuel). */
  uid: number;
}
interface SkyKey {
  m: number;
  sky: THREE.Color;
  sun: number;
  hemi: number;
}

// Vraie nuit bleu sombre (clair de lune), jour lumineux, aube et soir orangés ; les lumières de la ville prennent le relais.
const SKY_KEYS: SkyKey[] = [
  { m: 0, sky: new THREE.Color(0x0c1633), sun: 0.0, hemi: 0.22 },
  { m: 300, sky: new THREE.Color(0x111d40), sun: 0.0, hemi: 0.24 },
  { m: 360, sky: new THREE.Color(0x4b4f86), sun: 0.15, hemi: 0.42 },
  { m: 400, sky: new THREE.Color(0xffc9a3), sun: 0.5, hemi: 0.72 },
  { m: 480, sky: new THREE.Color(0xd6ecff), sun: 0.95, hemi: 0.92 },
  { m: 960, sky: new THREE.Color(0xd6ecff), sun: 1.0, hemi: 0.95 },
  { m: 1080, sky: new THREE.Color(0xffb98a), sun: 0.55, hemi: 0.78 },
  { m: 1140, sky: new THREE.Color(0x3d3f7a), sun: 0.1, hemi: 0.42 },
  { m: 1200, sky: new THREE.Color(0x101b3c), sun: 0.0, hemi: 0.25 },
  { m: 1440, sky: new THREE.Color(0x0c1633), sun: 0.0, hemi: 0.22 },
];

// Vitesses de déplacement (unités/s) : trajets plus posés pour sentir la distance
const SPEED: Record<TravelMode, number> = { WALK: 3.2, BUS: 7, WORO: 8.5, ZEM: 8, CAR: 9.5 };

/** Enseigne des agences (nom de l'établissement, couleur du bandeau). */
const BANK_SIGNS: Record<string, [string, string]> = {
  boa: ['BANK OF AFRICA', '#0b4f9c'],
  ecobank: ['ECOBANK', '#1a7f94'],
  orabank: ['ORABANK', '#e06c00'],
  nsia: ['NSIA BANQUE', '#0d5c46'],
  ibbank: ['IB BANK', '#6a1b9a'],
  fucec: ['FUCEC-TOGO', '#2e7d32'],
};
/** Pictogramme d'une affiche selon son thème (annonces sans image). */
const AD_ICONS: [RegExp, string][] = [
  [/caf[ée]/i, '☕'], [/riz/i, '🍚'], [/ananas/i, '🍍'], [/wax|pagne|mode|tailleur/i, '👗'], [/tech|code|informatique/i, '💻'],
  [/radio|fm/i, '📻'], [/ciment|construction|maison|bâti/i, '🏗️'], [/eau|source/i, '💧'], [/pain|boulang/i, '🥖'], [/foot|éperviers/i, '⚽'],
  [/clinique|santé|urgence/i, '🏥'], [/pharmac/i, '💊'], [/moto|kéké|pièces/i, '🏍️'], [/hôtel|chambre/i, '🏨'], [/ciné/i, '🎬'],
  [/fruit|mangue/i, '🥭'], [/karité/i, '🧴'], [/bière|tchoukoutou/i, '🍺'], [/sodabi/i, '🥃'], [/permis|auto-?école/i, '🚗'],
  [/money|envoie|paie/i, '💸'], [/casque/i, '⛑️'], [/cours|bac|école|formation/i, '📚'], [/propre|déchets/i, '♻️'], [/huile/i, '🫙'], [/gari/i, '🥣'],
];
// Bouton sans texte (aucun libellé en dur côté client) : flèche seule
const AD_CTA = ['  →  ', '  ➜  ', '  ›  '];
/** Badges sans mots (chiffres et symboles, lisibles en toutes langues). */
const AD_PROMOS = ['-20%', '-30%', '-50%', '2×1', '100%', '★1er', '24/7', '+1'];
/** Assombrit (k < 0) ou éclaircit (k > 0) une couleur #rrggbb. */
const shade = (hex: string, k: number) => {
  const n = parseInt(hex.slice(1), 16);
  const f = (c: number) => Math.round(Math.min(255, Math.max(0, k < 0 ? c * (1 + k) : c + (255 - c) * k)));
  return `rgb(${f(n >> 16)}, ${f((n >> 8) & 255)}, ${f(n & 255)})`;
};
const nearest = (v: number, list: number[]) => list.reduce((a, b) => (Math.abs(b - v) < Math.abs(a - v) ? b : a));
/**
 * Courbure douce des avenues (Lomé n'est pas tirée au cordeau) : décalage perpendiculaire d'une route
 * selon la position le long de celle-ci. Le boulevard du bord de mer reste droit, comme la côte.
 */
// Courbes longues et discrètes : elles cassent l'effet de quadrillage sans donner aux boulevards
// l'aspect ondulé et artificiel visible dans l'ancienne vue aérienne.
const BEND_A = 1.15;
const BEND_K = (2 * Math.PI) / 180;
const BEND_MIN = -308;
const BEND_STEP = 2;
/** Atténuation par route (0 = droite devant un lieu, 1 = courbe libre), calculée à la construction de la ville. */
const bendMask = new Map<number, Float32Array>();
const smooth = (t: number) => {
  const k = Math.min(1, Math.max(0, t));
  return k * k * (3 - 2 * k);
};
function computeBendMask(venues: { id: string; x: number; z: number }[]): void {
  bendMask.clear();
  const n = Math.ceil((-2 * BEND_MIN) / BEND_STEP) + 1;
  for (const [roads, ew] of [[ROADS_Z, true], [ROADS_X, false]] as const) {
    for (const r of roads) {
      const m = new Float32Array(n).fill(1);
      for (const v of venues) {
        const f = FOOTPRINT[v.id] ?? { hw: 12, back: 12 };
        const corners = [-f.hw, f.hw].flatMap(x => [-f.back, f.front ?? ENTRY + 14].map(z => rotateXZ(x, z, venueYaw(v.id))));
        const x0 = v.x + Math.min(...corners.map(p => p[0]));
        const x1 = v.x + Math.max(...corners.map(p => p[0]));
        const z0 = v.z + Math.min(...corners.map(p => p[1]));
        const z1 = v.z + Math.max(...corners.map(p => p[1]));
        // Lieu assez proche pour que la courbe le touche : bande de route élargie de l'amplitude
        const reach = ROAD_W / 2 + BEND_A + 1;
        const near = ew ? z0 < r + reach && z1 > r - reach : x0 < r + reach && x1 > r - reach;
        if (!near) continue;
        for (let i = 0; i < n; i++) {
          const a = BEND_MIN + i * BEND_STEP;
          const d = (ew ? Math.max(x0 - a, a - x1, 0) : Math.max(z0 - a, a - z1, 0)) - 2;
          m[i] = Math.min(m[i]!, smooth(d / 12));
        }
      }
      bendMask.set(r, m);
    }
  }
}
const bend = (road: number, along: number) => {
  if (road === 14) return 0;
  const m = bendMask.get(road);
  const k = m ? (m[Math.min(m.length - 1, Math.max(0, Math.round((along - BEND_MIN) / BEND_STEP)))] ?? 1) : 1;
  return k * BEND_A * Math.sin(along * BEND_K + road * 0.37);
};
const bendSlope = (road: number, along: number) => bend(road, along + 0.5) - bend(road, along - 0.5);
/** Décalage d'une voie (axe x : route est-ouest ; axe z : avenue nord-sud). */
/** Rond-point GTA sur le boulevard Eyadéma : les voies s'écartent pour en faire le tour. */
const GTA_Z = -224;
const GTA_RING = 9.5;
const GTA_ISLAND = 3.8;
const gtaBump = (z: number) => {
  const d = Math.abs(z - GTA_Z);
  return d < 14 ? 4.9 * (0.5 + 0.5 * Math.cos((Math.PI * d) / 14)) : 0;
};
/** Colombe de la Paix : carrefour nord-est, sur l’accès public à l’aéroport, séparé de la place de l’Indépendance. */
const COLOMBE_X = 90;
const COLOMBE_Z = -110;
const COLOMBE_RING = 7.5;
const COLOMBE_ISLAND = 3;
const colombeBump = (d: number) => (Math.abs(d) < 11 ? 3.6 * (0.5 + 0.5 * Math.cos((Math.PI * d) / 11)) : 0);
const laneBend = (axis: 'x' | 'z', lane: number, pos: number) => {
  const road = nearest(lane, axis === 'x' ? ROADS_Z : ROADS_X);
  let b = bend(road, pos) + (axis === 'z' && road === 0 ? Math.sign(lane || 1) * gtaBump(pos) : 0);
  // Les voies contournent l'îlot de la Colombe
  if (axis === 'z' && road === COLOMBE_X) b += Math.sign(lane - road || 1) * colombeBump(pos - COLOMBE_Z);
  if (axis === 'x' && road === COLOMBE_Z) b += Math.sign(lane - road || 1) * colombeBump(pos - COLOMBE_X);
  return b;
};
/** Cap d'un véhicule qui suit la courbe. */
/** Bout nord d'une avenue : le boulevard Eyadéma (x = 0) continue jusqu'à Agbalépédo. */
const avenueEnd = (lane: number) => (nearest(lane, ROADS_X) === 0 ? EYADEMA_END_Z : ROAD_END_Z);
const laneHeading = (axis: 'x' | 'z', lane: number, pos: number, dir: 1 | -1) => {
  const sl = laneBend(axis, lane, pos + 0.5) - laneBend(axis, lane, pos - 0.5);
  return axis === 'x' ? Math.atan2(dir, dir * sl) : Math.atan2(dir * sl, dir);
};

/** Ronds-points traversés par les trajets : centre et rayon de la voie qui fait le tour de l'îlot. */
const ROUNDABOUTS: { x: number; z: number; r: number }[] = [
  { x: 0, z: GTA_Z, r: (GTA_RING + GTA_ISLAND) / 2 },
  { x: COLOMBE_X, z: COLOMBE_Z, r: (COLOMBE_RING + COLOMBE_ISLAND) / 2 },
  { x: DEUX_LIONS_X, z: DEUX_LIONS_Z, r: 6.6 },
  { x: CITY_RING.x, z: CITY_RING.z, r: (CITY_RING.R + CITY_RING.I) / 2 },
];
/**
 * Tracés où roulent des voitures en plus du quadrillage : toutes les rues secondaires et routes du nord, sans les petits
 * raccords de moins de 30 m. Ils traversent les échangeurs : sur le contournement (`deck`), les voitures montent sur le
 * tablier ; les axes transversaux passent dessous, au sol. (Avant, les tracés s'arrêtaient à 40 m des ponts : aucune
 * voiture ne passait devant.)
 */
/**
 * Camions du Port : ils sortent par le portail (juste derrière, le terre-plein est couvert de conteneurs), prennent le
 * boulevard devant le Port puis le contournement vers Kégué et Agoè, et reviennent. Tracé de circulation seulement :
 * il emprunte des chaussées déjà dessinées.
 */
/** Route sur l'eau (chaussée dessinée par seaDistrict.ts) : tracé de circulation seulement, dans le prolongement de la corniche ouest. */
const SEA_ROAD: [number, number][] = [[-312, 38], [-312, 250]];
const PORT_TRUCKS: [number, number][] = [[118, 22], [118, 14], ...GRAND_BYPASS];
/** Tracé de circulation. `oneWay` : sens unique (sens de marche imposé) ; `next` : tracé pris au bout (demi-tour sur l'autre voie). */
type PathRoute = { pts: [number, number][]; cum: number[]; total: number; deck: boolean; trucks?: boolean; oneWay?: 1 | -1; next?: number };
const PATH_ROUTES: PathRoute[] = (() => {
  // Seuls le contournement et les camions du Port traversent les échangeurs (par le tablier). Les autres tracés
  // s'arrêtent avant : au pied des ponts, bretelles et routes convergent et leurs voitures se bloquaient mutuellement.
  const zones = Object.values(FLYOVERS).map((b) => ({ x: b.x, z: b.z, r: b.half + b.ramp + 12 }));
  // Au-delà du pied de rampe (plus de 46 m du pont, côté sud de la carte), plus de risque de blocage : la rue d'EZA ZOZO garde sa circulation
  const near = (p: [number, number]) => zones.some((q) => Math.hypot(p[0] - q.x, p[1] - q.z) < q.r && p[1] < q.z + 46);
  const out: PathRoute[] = [];
  const push = (run: [number, number][], deck: boolean, trucks: boolean) => {
    if (run.length < 2) return;
    const cum = [0];
    for (let i = 1; i < run.length; i++) cum.push(cum[i - 1]! + Math.hypot(run[i]![0] - run[i - 1]![0], run[i]![1] - run[i - 1]![1]));
    const total = cum[cum.length - 1]!;
    if (total >= 20) out.push({ pts: run, cum, total, deck, trucks });
  };
  // Ronds-points : les tracés s'arrêtent au bord de l'anneau (ils ne le traversent pas, et personne n'y tourne en
  // boucle) ; la circulation qui en fait le tour reste celle du quadrillage (GTA, Colombe de la Paix).
  const rings = ROUNDABOUTS.map((rb) => ({ ...rb, cut: rb.r + ROAD_W / 2 + 1 }));
  const inRing = (p: [number, number]) => rings.some((q) => Math.hypot(p[0] - q.x, p[1] - q.z) < q.cut);
  const exitPoint = (a: [number, number], b: [number, number], q: { x: number; z: number; cut: number }): [number, number] => {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 20; k++) {
      const m = (lo + hi) / 2;
      if (Math.hypot(a[0] + (b[0] - a[0]) * m - q.x, a[1] + (b[1] - a[1]) * m - q.z) < q.cut) lo = m;
      else hi = m;
    }
    return [a[0] + (b[0] - a[0]) * hi, a[1] + (b[1] - a[1]) * hi];
  };
  // Bretelles d'Agoè : elles longent la rampe sans la toucher et s'insèrent dans le sens de la route qui continue ; leurs
  // voitures vont de la RN1 jusqu'au-delà de l'insertion (sans elles, seules les voitures du tablier passaient à Agoè).
  // Comme sur un vrai échangeur, chaque bretelle est à sens unique et ne se prend qu'en tournant à droite : à double sens,
  // l'une des deux coupait la voie d'en face en s'insérant, et les voitures face à face se bloquaient pour de bon.
  // Au bout, la voiture fait demi-tour sur la bretelle voisine : les quatre forment une boucle, sans voiture qui disparaît.
  const first = out.length;
  for (const r of AGOE_RAMP_SET) {
    push(r.drive, false, false);
    out[out.length - 1]!.oneWay = r.oneWay;
  }
  AGOE_RAMP_SET.forEach((r, k) => (out[first + k]!.next = first + AGOE_RAMP_SET.findIndex((q) => q.sx === r.nextSx && q.sz === r.nextSz)));
  for (const poly of [...CITY_ROADS, PORT_TRUCKS, SEA_ROAD]) {
    if (AGOE_RAMPS.includes(poly)) continue;
    const deck = poly === GRAND_BYPASS || poly === PORT_TRUCKS;
    if (deck) {
      push(poly, true, poly === PORT_TRUCKS);
      continue;
    }
    let run: [number, number][] = [];
    for (let i = 0; i < poly.length; i++) {
      const pt = poly[i]!;
      const ring = rings.find((q) => Math.hypot(pt[0] - q.x, pt[1] - q.z) < q.cut);
      if (near(pt) || ring) {
        if (ring && run.length > 0) run.push(exitPoint(pt, run[run.length - 1]!, ring));
        push(run, false, false);
        run = [];
        const nx = poly[i + 1];
        if (ring && nx && !inRing(nx) && !near(nx)) run.push(exitPoint(pt, nx, ring));
      } else run.push(pt);
    }
    push(run, false, false);
  }
  return out;
})();
/**
 * Raccords entre tracés : chaque bout de tracé qui aboutit (à moins de 30 m) sur une autre route est prolongé jusqu'à elle, et la
 * voiture qui y arrive s'y engage au lieu de faire demi-tour ou de disparaître. La circulation est ainsi continue d'une
 * rue à l'autre, sans voiture qui clignote. Les bouts sans route voisine (impasses, abords des échangeurs) gardent un demi-tour en douceur.
 */
const JOIN_RADIUS = 30;
type RouteJoin = { route: number; s: number };
const ROUTE_JOINS: (RouteJoin | null)[][] = (() => {
  const R = PATH_ROUTES;
  const project = (px: number, pz: number, j: number) => {
    const o = R[j]!;
    let best = Infinity;
    let bs = 0;
    let bx = px;
    let bz = pz;
    for (let i = 1; i < o.pts.length; i++) {
      const [ax, az] = o.pts[i - 1]!;
      const [cx, cz] = o.pts[i]!;
      const dx = cx - ax;
      const dz = cz - az;
      const l2 = dx * dx + dz * dz || 1;
      const t = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2));
      const d = Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
      if (d < best) {
        best = d;
        bs = o.cum[i - 1]! + Math.sqrt(l2) * t;
        bx = ax + dx * t;
        bz = az + dz * t;
      }
    }
    return { d: best, s: bs, x: bx, z: bz };
  };
  const eligible = (r: PathRoute) => !r.deck && !r.trucks && r.next === undefined && r.oneWay === undefined;
  // 1) Pour chaque bout, la route voisine la plus proche ; le tracé est prolongé jusqu'au point de raccord
  const target: ({ route: number; x: number; z: number } | null)[][] = R.map(() => [null, null]);
  R.forEach((r, i) => {
    if (!eligible(r)) return;
    for (const e of [0, 1] as const) {
      const pt = e === 1 ? r.pts[r.pts.length - 1]! : r.pts[0]!;
      let best: { route: number; x: number; z: number; d: number } | null = null;
      R.forEach((o, j) => {
        if (j === i || o.trucks) return;
        const q = project(pt[0], pt[1], j);
        if (q.d <= JOIN_RADIUS && (!best || q.d < best.d)) best = { route: j, x: q.x, z: q.z, d: q.d };
      });
      if (best) target[i]![e] = best;
    }
  });
  R.forEach((r, i) => {
    for (const e of [0, 1] as const) {
      const t = target[i]![e];
      if (!t) continue;
      const pt = e === 1 ? r.pts[r.pts.length - 1]! : r.pts[0]!;
      if (Math.hypot(t.x - pt[0], t.z - pt[1]) < 0.5) continue;
      if (e === 1) r.pts.push([t.x, t.z]);
      else {
        r.pts.unshift([t.x, t.z]);
      }
    }
    r.cum = [0];
    for (let k = 1; k < r.pts.length; k++) r.cum.push(r.cum[k - 1]! + Math.hypot(r.pts[k]![0] - r.pts[k - 1]![0], r.pts[k]![1] - r.pts[k - 1]![1]));
    r.total = r.cum[r.cum.length - 1]!;
  });
  // 2) Position (abscisse) du raccord sur la route d'arrivée, une fois toutes les routes prolongées
  return R.map((_, i) => [0, 1].map((e) => {
    const t = target[i]![e];
    if (!t) return null;
    const q = project(t.x, t.z, t.route);
    return { route: t.route, s: q.s };
  }));
})();
/** Décalage par rapport à l'axe : positif à droite du mouvement, négatif à gauche. */
const RIGHT_LANE = LANE;
const LEFT_SIDEWALK = -(ROAD_W / 2 + 0.9);

/**
 * Trajet sur l'axe → trajet réel sans retour en arrière. Les engins prennent un décalage positif
 * (voie de droite) ; les piétons un décalage négatif (trottoir gauche, face à la circulation).
 */
function followTrafficSide(from: THREE.Vector3, axis: THREE.Vector3[], dest: THREE.Vector3, offset: number): THREE.Vector3[] {
  // 1. Points en double et demi-tours (aller au-delà d'un carrefour puis revenir) supprimés
  let pts = [from.clone(), ...axis];
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const c = pts[i + 1]!;
      const ux = b.x - a.x;
      const uz = b.z - a.z;
      const vx = c.x - b.x;
      const vz = c.z - b.z;
      const lu = Math.hypot(ux, uz);
      const lv = Math.hypot(vx, vz);
      if (lu < 0.3 || (lv > 0.3 && (ux * vx + uz * vz) / (lu * lv) < -0.7)) {
        pts.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  // 2. Points réguliers (tous les 2 m) pour que la voie et les virages suivent bien la route
  const dense: THREE.Vector3[] = [pts[0]!];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const n = Math.max(1, Math.round(a.distanceTo(b) / 2));
    for (let k = 1; k <= n; k++) dense.push(new THREE.Vector3().lerpVectors(a, b, k / n));
  }
  // 3. Droite du mouvement = (−dz, dx). Un offset négatif place donc le piéton à gauche.
  const lane = dense.map((q, i) => {
    if (i === 0) return q.clone();
    const a = dense[Math.max(0, i - 1)]!;
    const b = dense[Math.min(dense.length - 1, i + 1)]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return new THREE.Vector3(q.x - ((b.z - a.z) / len) * offset, 0, q.z + ((b.x - a.x) / len) * offset);
  });
  // 4. Ronds-points : engins sur l'anneau ; piétons sur le trottoir extérieur par l'arc le plus court.
  let out = lane;
  for (const rb of ROUNDABOUTS) {
    const circleR = offset < 0 ? rb.r + ROAD_W / 2 + 1 : rb.r;
    const inside = (q: THREE.Vector3) => Math.hypot(q.x - rb.x, q.z - rb.z) < circleR + Math.abs(offset);
    const next: THREE.Vector3[] = [];
    for (let i = 0; i < out.length; ) {
      if (!inside(out[i]!) || i === 0) {
        next.push(out[i]!);
        i++;
        continue;
      }
      let j = i;
      while (j < out.length && inside(out[j]!)) j++;
      const ang = (q: THREE.Vector3) => Math.atan2(q.z - rb.z, q.x - rb.x);
      const a1 = ang(out[i - 1]!);
      const a2 = j < out.length ? ang(out[j]!) : ang(out[j - 1]!);
      // Les engins gardent l'îlot à gauche ; le piéton reste à l'extérieur et prend l'arc court.
      let sweep = a1 - a2;
      if (offset >= 0) {
        while (sweep <= 0.05) sweep += Math.PI * 2;
        if (sweep > Math.PI * 2 - 0.05) sweep -= Math.PI * 2;
      } else {
        sweep = Math.atan2(Math.sin(sweep), Math.cos(sweep));
      }
      const steps = Math.max(2, Math.round((Math.abs(sweep) * circleR) / 1.5));
      for (let k = 0; k <= steps; k++) {
        const t = a1 - (sweep * k) / steps;
        next.push(new THREE.Vector3(rb.x + Math.cos(t) * circleR, 0, rb.z + Math.sin(t) * circleR));
      }
      i = j;
    }
    out = next;
  }
  out.shift();
  out.push(dest.clone());
  return out;
}

/**
 * Affiche publicitaire AGBE pour une annonce sans image, dans un style togolais : bande tissée kente aux couleurs
 * du drapeau, panneau de motifs de pagne wax, ou cadre à triangles ; pictogramme lié au thème, titre sur plusieurs
 * lignes, accroche, étiquette promo et bouton. Proportions de la parcelle ou du panneau (w × h).
 */
export function drawAdArt(title: string, sub: string, bg: string, fg: string, w: number, h: number): HTMLCanvasElement {
  const W = 512;
  const H = Math.max(96, Math.min(1024, Math.round((W * h) / w)));
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const g = cv.getContext('2d');
  const seed = [...title].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
  const m = Math.min(W, H);
  const icon = AD_ICONS.find(([re]) => re.test(title + ' ' + sub))?.[1] ?? '🛍️';
  const FLAG = ['#006a4e', '#ffce00', '#d21034'];
  const wrap = (text: string, maxW: number, size: number, maxLines: number): string[] => {
    if (!g) return [text];
    g.font = `900 ${size}px system-ui, sans-serif`;
    const lines: string[] = [];
    let cur = '';
    for (const word of text.split(' ')) {
      const next = cur ? `${cur} ${word}` : word;
      if (g.measureText(next).width > maxW && cur) {
        lines.push(cur);
        cur = word;
      } else cur = next;
    }
    if (cur) lines.push(cur);
    return lines.slice(0, maxLines);
  };
  if (!g) return cv;
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, shade(bg, 0.08));
  grad.addColorStop(1, shade(bg, -0.22));
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  g.textBaseline = 'top';
  const layout = seed % 3;
  // Zone réservée au texte (x, y, largeur), selon la mise en page
  let tx = W * 0.07;
  let ty = H * 0.1;
  let tw = W * 0.86;
  let bottom = H;
  if (layout === 0) {
    // Bande kente en bas : rangées de rectangles tissés aux couleurs du drapeau, liserés noirs
    const bh = Math.max(14, H * 0.16);
    bottom = H - bh;
    const cell = bh / 2;
    for (let r = 0; r < 2; r++) {
      for (let c = 0; c * cell < W; c++) {
        g.fillStyle = FLAG[(c + r * 2 + seed) % 3]!;
        g.fillRect(c * cell, bottom + r * cell, cell, cell);
        g.fillStyle = 'rgba(0,0,0,.35)';
        g.fillRect(c * cell + cell * 0.42, bottom + r * cell, cell * 0.16, cell);
      }
    }
    g.fillStyle = 'rgba(0,0,0,.4)';
    g.fillRect(0, bottom - 3, W, 3);
    // Pictogramme dans un médaillon
    g.fillStyle = 'rgba(255,255,255,.18)';
    g.beginPath();
    g.arc(W * 0.82, bottom * 0.5, m * 0.26, 0, Math.PI * 2);
    g.fill();
    g.font = `${Math.round(m * 0.28)}px system-ui, sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(icon, W * 0.82, bottom * 0.5);
    g.textAlign = 'left';
    g.textBaseline = 'top';
    tw = W * 0.62;
  } else if (layout === 1) {
    // Panneau de pagne wax à gauche : cercles concentriques et feuilles, en couleur du texte et de l'accent
    const pw = W * 0.3;
    g.save();
    g.beginPath();
    g.rect(0, 0, pw, H);
    g.clip();
    g.fillStyle = shade(bg, -0.35);
    g.fillRect(0, 0, pw, H);
    const r0 = pw * 0.34;
    for (let yy = -r0; yy < H + r0; yy += r0 * 1.7) {
      for (let xx = 0; xx < pw + r0; xx += r0 * 1.9) {
        const off = Math.round(yy / (r0 * 1.7)) % 2 ? r0 * 0.95 : 0;
        for (let k = 3; k > 0; k--) {
          g.fillStyle = k % 2 ? fg : FLAG[(seed + k) % 3]!;
          g.globalAlpha = 0.85;
          g.beginPath();
          g.arc(xx + off, yy, (r0 * k) / 3, 0, Math.PI * 2);
          g.fill();
        }
      }
    }
    g.restore();
    g.globalAlpha = 1;
    g.fillStyle = fg;
    g.fillRect(pw, 0, Math.max(3, W * 0.008), H);
    g.font = `${Math.round(m * 0.18)}px system-ui, sans-serif`;
    g.textAlign = 'right';
    g.fillText(icon, W * 0.95, H * 0.07);
    g.textAlign = 'left';
    tx = pw + W * 0.05;
    tw = W - pw - W * 0.1;
  } else {
    // Cadre de triangles façon pagne sur les quatre bords
    const t = Math.max(10, m * 0.06);
    for (let x = 0; x < W; x += t) {
      g.fillStyle = FLAG[Math.round(x / t) % 3]!;
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x + t, 0);
      g.lineTo(x + t / 2, t);
      g.fill();
      g.beginPath();
      g.moveTo(x, H);
      g.lineTo(x + t, H);
      g.lineTo(x + t / 2, H - t);
      g.fill();
    }
    for (let y = t; y < H - t; y += t) {
      g.fillStyle = FLAG[Math.round(y / t + 1) % 3]!;
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(0, y + t);
      g.lineTo(t, y + t / 2);
      g.fill();
      g.beginPath();
      g.moveTo(W, y);
      g.lineTo(W, y + t);
      g.lineTo(W - t, y + t / 2);
      g.fill();
    }
    g.font = `${Math.round(m * 0.18)}px system-ui, sans-serif`;
    g.textAlign = 'right';
    g.fillText(icon, W - t * 1.6, t * 1.4);
    g.textAlign = 'left';
    tx = t * 2;
    ty = t * 1.8;
    tw = W - t * 4 - m * 0.2;
    bottom = H - t;
  }
  // Titre (plusieurs lignes), accroche
  const tall = H > W * 1.1;
  let size = Math.round(m * (tall ? 0.15 : 0.19));
  let lines = wrap(title, tw, size, 3);
  while (lines.some((l) => g.measureText(l).width > tw) && size > 14) lines = wrap(title, tw, (size -= 2), 3);
  let y = ty;
  g.fillStyle = fg;
  g.shadowColor = 'rgba(0,0,0,.25)';
  g.shadowBlur = 6;
  g.shadowOffsetY = 2;
  g.font = `900 ${size}px system-ui, sans-serif`;
  for (const l of lines) {
    g.fillText(l, tx, y, tw);
    y += size * 1.05;
  }
  g.shadowColor = 'transparent';
  const subSize = Math.max(11, Math.round(size * 0.45));
  g.globalAlpha = 0.92;
  for (const l of wrap(sub, tw, subSize, 2)) {
    g.font = `700 ${subSize}px system-ui, sans-serif`;
    g.fillText(l, tx, y + subSize * 0.3, tw);
    y += subSize * 1.2;
  }
  g.globalAlpha = 1;
  // Étiquette promo en ruban (une affiche sur trois)
  if (seed % 3 === 0) {
    const label = AD_PROMOS[(seed >>> 4) % AD_PROMOS.length]!;
    const fs = Math.round(m * 0.075);
    g.font = `900 ${fs}px system-ui, sans-serif`;
    const lw = g.measureText(label).width + fs * 1.4;
    const ry = Math.min(bottom - fs * 2.6, H * 0.62);
    g.fillStyle = '#ffce00';
    g.beginPath();
    g.moveTo(W - lw - fs * 0.6, ry);
    g.lineTo(W, ry);
    g.lineTo(W, ry + fs * 1.6);
    g.lineTo(W - lw - fs * 0.6, ry + fs * 1.6);
    g.lineTo(W - lw, ry + fs * 0.8);
    g.fill();
    g.fillStyle = '#d21034';
    g.textBaseline = 'middle';
    g.fillText(label, W - lw + fs * 0.3, ry + fs * 0.8);
    g.textBaseline = 'top';
  }
  // Bouton d'appel à l'action
  const ctaH = Math.max(16, Math.round(m * 0.12));
  const ctaY = Math.min(bottom - ctaH - m * 0.05, y + subSize * 0.8);
  g.font = `800 ${Math.round(ctaH * 0.55)}px system-ui, sans-serif`;
  const label = AD_CTA[seed % AD_CTA.length]!;
  const ctaW = g.measureText(label).width + ctaH;
  g.fillStyle = fg;
  g.beginPath();
  g.roundRect(tx, ctaY, ctaW, ctaH, ctaH / 2);
  g.fill();
  g.fillStyle = shade(bg, -0.1);
  g.textBaseline = 'middle';
  g.fillText(label, tx + ctaH / 2, ctaY + ctaH / 2);
  return cv;
}

export class World {
  private readonly container: HTMLElement;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera: THREE.PerspectiveCamera;
  private readonly profile: QualityProfile;
  private readonly mats: Materials;
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly sun: THREE.DirectionalLight;
  private readonly hemi: THREE.HemisphereLight;
  private readonly sky: THREE.Mesh;
  private readonly skyMaterial: THREE.ShaderMaterial;
  private readonly player: THREE.Group;
  private groundY = 0;
  private vehicles: Record<Exclude<TravelMode, 'WALK'>, THREE.Group>;
  private readonly marker: THREE.Mesh;
  private readonly opts: WorldOptions;
  private readonly getMinuteOfDay: () => number;
  private readonly nightMaterials: THREE.MeshLambertMaterial[] = [];
  /** Intensité nocturne propre à un matériau (1 = fenêtres de référence) : les grandes vitres brillent moins. */
  private readonly nightScale = new WeakMap<THREE.Material, number>();
  /** Lumières qui clignotent la nuit (place de l'Indépendance) : matériau, intensité de base, décalage et rythme. */
  private readonly blinkMats: { m: THREE.MeshLambertMaterial; scale: number; phase: number; speed: number }[] = [];
  private powerCut = false;
  private nightLevel = 0;
  private readonly pointLights: THREE.PointLight[] = [];
  private playerGlow: THREE.PointLight | null = null;
  private readonly pinLayer: HTMLDivElement;
  /** Autres joueurs connectés : avatar, position visée (interpolée) et étiquette de nom. */
  private readonly remotes = new Map<string, { g: THREE.Group; label: HTMLDivElement; tx: number; tz: number; tyaw: number; phase: number; lookKey: string; ride: Ride | null; veh: THREE.Group | null }>();
  private readonly pins: { id: string; el: HTMLButtonElement; pos: THREE.Vector3 }[] = [];
  private readonly resizeObs: ResizeObserver;
  /** Vecteur de travail pour savoir si un point est à l'image (tmp.w garde la cible lissée de la caméra). */
  private readonly screenPt = new THREE.Vector3();
  private readonly tmp = { v: new THREE.Vector3(), w: new THREE.Vector3(), m: new THREE.Matrix4(), q: new THREE.Quaternion(), pitch: new THREE.Quaternion(), s: new THREE.Vector3(1, 1, 1), c: new THREE.Color() };
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly boards: THREE.Object3D[] = [];
  private readonly brandSpots: BrandSpot[] = [];
  /** Limite sud de la carte (étendue jusqu'aux parcelles en mer). */
  private seaMaxZ = 0;
  private maxPanX = MAP_MAX_X;
  private minPanX = MAP_MIN_X;
  private minPanZ = MAP_MIN_Z - 22;
  private maxPanZ = WALK_MAX_Z;
  /** Zones de terrain à vendre (reconstruites seules quand les ventes changent). */
  private land: LandLayer | null = null;
  private readonly plotGrids = new Map<string, SeaGridSpec>();
  private readonly radars: THREE.Object3D[] = [];
  /** Feux tricolores : lampes rouge / orange / vert, cycle commun (boulevard, puis rue transversale). */
  private readonly lights: { red: THREE.Mesh; amber: THREE.Mesh; green: THREE.Mesh; halo?: THREE.MeshBasicMaterial[]; sig: number; axis: 'x' | 'z'; state?: SignalState }[] = [];
  private lightT = 0;
  /** Horloge de la circulation (s) et réservations des carrefours sans feux (premier arrivé, avec alternance). */
  private simT = 0;
  /** Temps passé à attendre un véhicule pendant le trajet en cours (s). */
  private tripEase = 1;
  private tripWait = 0;
  /** Temps passé à contourner un véhicule (s) : au-delà de 2,5 s la moto cesse de zigzaguer (jamais de tour en rond sans fin). */
  private swerveT = 0;
  /** Temps passé collé derrière un véhicule immobile (s) : au-delà de 4 s, la moto cherche à le contourner. */
  private followT = 0;
  /** Facteur de vitesse de croisière actuel de la circulation (1 = fluide, 0,5 = pointe). */
  private slowNow = 1;
  private readonly signalMats: THREE.Material[] = [];
  private readonly reservations = new Map<number, { axis: 'x' | 'z'; since: number; seen: number }>();
  private readonly ships: { g: THREE.Group; x: number; zNear: number; zFar: number; t: number }[] = [];
  /** Portiques du port : chariot, câble, palonnier et conteneur porté. */
  private readonly cranes: { trolley: THREE.Mesh; cable: THREE.Mesh; spreader: THREE.Mesh; load: THREE.Mesh; quayX: number; shipX: number; gz: number; offset: number }[] = [];
  /** Porte-conteneurs en rotation au poste à quai des portiques. */
  private tractors: { g: THREE.Group; load: THREE.Mesh; gz: number; quayX: number; yardX: number; yardZ: number; t: number }[] = [];
  private berth: { g: THREE.Group; x: number; zBerth: number; zFar: number; t: number; stack: THREE.Object3D[]; yard: THREE.Mesh[] } | null = null;
  private readonly flights: { g: THREE.Group; x0: number; x1: number; z: number; t: number }[] = [];
  /** Emprises au sol des bâtiments (rectangles) : on ne les traverse pas. */
  private readonly solids: Solid[] = [];
  /** Index spatial des emprises (cellules de SOLID_CELL m), reconstruit après tout ajout ou déplacement d'emprise. */
  private solidGrid: Map<number, number[]> | null = null;

  private view: CityView = 'map';
  /** Point visé par la caméra en vue carte (déplaçable au doigt). */
  private readonly focus = new THREE.Vector3();
  private readonly camPos = new THREE.Vector3();
  private readonly entries = new Map<string, { x: number; z: number; yaw: number }>();
  private arriveYaw: number | null = null;
  private readonly camLook = new THREE.Vector3();
  private zoom = 1;
  private yaw = 0;
  private route: THREE.Vector3[] = [];
  private speed = SPEED.WALK;
  private travelDone: (() => void) | null = null;
  private riding: Exclude<TravelMode, 'WALK'> | null = null;
  /** Conducteur du zém quand le joueur est passager. */
  private zemDriver: THREE.Group | null = null;
  /** Moto du joueur (livreur, zémidjan) : il conduit lui-même ; derrière lui, un client ou rien (le colis est à part). */
  private ownMoto = false;
  private pillion: THREE.Group | null = null;
  // Repère « c'est moi » au-dessus du personnage, itinéraire rouge et drapeau d'arrivée pendant un trajet
  private youMarker!: THREE.Group;
  private routeRibbon: THREE.Mesh | null = null;
  private routeFlag!: THREE.Group;
  private trip = { total: 0, done: 0, points: 0, mode: 'WALK' as TravelMode, to: '' };
  private readonly keys = new Set<string>();
  private joy = { x: 0, y: 0 };
  private near: string | null = null;
  private arrived: string | null = null;
  private walkers: Walker[] = [];
  private customer: { g: THREE.Group; phase: number; parcel?: boolean; seated?: boolean; arrived?: boolean; car?: boolean } | null = null;
  /** Lavage : la voiture arrive par la droite, attend d'être lavée, puis repart par la gauche ; `want` : un client attend son tour. */
  private wash = { state: 'gone' as 'gone' | 'in' | 'here' | 'out', x: 0, want: false };
  /** Trajet des voitures à l'aire de lavage fixe (calculé à l'installation du poste). */
  private washRoute: { inP: [number, number][]; outP: [number, number][] } | null = null;
  /** Servie pendant son arrivée : la voiture repart dès qu'elle est entrée. */
  private washLeave = false;
  /** Mission du client dont la voiture est au lavage. */
  private washKey: string | undefined;
  /** Poste de travail à pied en place (étal, comptoir, fauteuil…), ancré à l'endroit où le joueur s'est mis au travail. */
  private work: { id: string; st: Station; x: number; z: number; yaw: number; idle: number; last: THREE.Vector3; act: { t: number; dur: number; wait: number; done: () => void } | null } | null = null;
  /** Clients servis qui s'éloignent avant de disparaître. */
  private leavers: { g: THREE.Group; t: number; dx: number; dz: number; phase: number }[] = [];
  private cargo: THREE.Group | null = null;
  private customerSeed = 1;
  private zems: Zem[] = [];
  private soundT = 0;
  /** Deux-roues de la circulation, cuits en maillages instanciés : modèle (moto ou vélo, partie peinte teintée) et conducteur. */
  private zemSets: { mesh: THREE.InstancedMesh; count: number }[] = [];
  /** Pour chaque deux-roues : ensembles (véhicule, conducteur) et rang de son instance dans chacun. */
  private zemSlots: { sets: number[]; idx: number[] }[] = [];
  private readonly houseMeshes: THREE.InstancedMesh[] = [];
  private readonly venueObjects: THREE.Object3D[] = [];
  private houseSpots: { x: number; z: number; w: number; d: number; h: number; floors: number; tint: number }[] = [];
  private readonly instances: ModelInstances[] = [];
  private cars: Car[] = [];
  private pathCars: PathCar[] = [];
  /** Tous les véhicules ambiants (voitures puis motos), reconstruit seulement quand la flotte change. */
  private fleet: (Car | Zem)[] = [];
  private readonly laneIndex = new LaneIndex<Car | Zem>((m) => nearest(m.lane, m.axis === 'x' ? ROADS_Z : ROADS_X));
  private carSets: ModelInstances[] = [];
  private readonly tmpCar = { m: new THREE.Matrix4(), q: new THREE.Quaternion(), p: new THREE.Vector3(), s: new THREE.Vector3() };
  private raf = 0;
  private lastFrame = 0;
  private realDt = 0;
  private walkPhase = 0;
  private disposed = false;
  /**
   * Ambulance du SAMU : elle vient des urgences jusqu'au joueur (`coming`), s'arrête (`parked`), puis les secouristes l'installent
   * sur le brancard et le montent à l'arrière (`loading`). Pendant ce temps le personnage n'obéit plus aux commandes (`ambHold`).
   */
  private amb: {
    rig: AmbulanceRig;
    medics: [THREE.Group, THREE.Group];
    stretcher: THREE.Group;
    route: THREE.Vector3[];
    total: number;
    done: number;
    speed: number;
    wait: number;
    /** Temps restant (s) où elle passe sans s'arrêter pour le trafic : évite l'arrêt/départ à chaque image (écran qui vibre). */
    pass?: number;
    phase: 'coming' | 'parked' | 'loading' | 'aboard';
    arrived: (() => void) | null;
    load: { t0: number; done: () => void; player: THREE.Vector3; out: THREE.Vector3; side: THREE.Vector3; inside: THREE.Vector3; yaw: number } | null;
    /** Sirène parfois presque inaudible (bâtiments, vent) : facteur et moment du prochain changement. */
    dim: number;
    dimUntil: number;
  } | null = null;
  private ambHold = false;
  private down: { x: number; y: number; t: number; moved: boolean } | null = null;
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinchDist = 0;
  private pinchAngle = 0;
  /** Rotation de la carte (radians, 0 = nord en haut) : torsion à deux doigts, clic droit ou Maj + glisser, boutons de la barre. */
  private mapYaw = 0;

  constructor(container: HTMLElement, quality: Quality, getMinuteOfDay: () => number, opts: WorldOptions) {
    this.container = container;
    this.quality = quality;
    this.profile = PROFILES[quality];
    this.getMinuteOfDay = getMinuteOfDay;
    this.opts = opts;
    this.mats = new Materials(this.profile.standardMaterials);
    // Vitres des maisons (modèles de houses.ts) : elles s'éclairent la nuit comme les autres fenêtres
    this.nightMaterials.push(this.mats.windowLit());
    this.nightScale.set(this.mats.windowLit(), 0.7);

    this.renderer = new THREE.WebGLRenderer({ antialias: this.profile.antialias, powerPreference: quality === 'low' ? 'low-power' : 'default', alpha: false, stencil: false });
    this.renderer.setPixelRatio(pixelRatioFor(quality));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = quality === 'high' ? 1.08 : 1.0;
    this.renderer.shadowMap.enabled = this.profile.shadows;
    this.renderer.shadowMap.type = quality === 'high' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    this.renderer.domElement.className = 'world-canvas';
    container.appendChild(this.renderer.domElement);

    this.camera = new THREE.PerspectiveCamera(40, 1, 0.5, 500);
    this.scene.background = new THREE.Color(0xd6ecff);
    this.scene.fog = new THREE.Fog(0xd6ecff, 140, 320);

    // Dôme atmosphérique : un seul maillage, sans texture ni post-traitement. Le dégradé et le halo
    // solaire donnent de la profondeur au ciel tout en restant moins coûteux qu'une skybox HDR.
    this.skyMaterial = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        topColor: { value: new THREE.Color(0x4f91cf) },
        horizonColor: { value: new THREE.Color(0xd8edff) },
        groundColor: { value: new THREE.Color(0xf1c993) },
        sunColor: { value: new THREE.Color(0xffe3ad) },
        sunDirection: { value: new THREE.Vector3(0.3, 0.7, -0.4).normalize() },
        sunStrength: { value: 0.8 },
      },
      vertexShader: `
        varying vec3 vDirection;
        void main() {
          vDirection = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 topColor;
        uniform vec3 horizonColor;
        uniform vec3 groundColor;
        uniform vec3 sunColor;
        uniform vec3 sunDirection;
        uniform float sunStrength;
        varying vec3 vDirection;
        void main() {
          float y = normalize(vDirection).y;
          float upper = smoothstep(-0.05, 0.72, y);
          vec3 skyColor = mix(horizonColor, topColor, upper);
          skyColor = mix(groundColor, skyColor, smoothstep(-0.32, 0.03, y));
          float sunDot = max(dot(normalize(vDirection), normalize(sunDirection)), 0.0);
          float glow = pow(sunDot, 48.0) * 0.24 + pow(sunDot, 900.0) * 1.8;
          gl_FragColor = vec4(skyColor + sunColor * glow * sunStrength, 1.0);
        }
      `,
    });
    // Rayon inférieur au plan lointain de la vue rue (190 m), le dôme suit toujours la caméra.
    this.sky = new THREE.Mesh(this.geo(new THREE.SphereGeometry(170, quality === 'high' ? 32 : 20, quality === 'high' ? 16 : 10)), this.skyMaterial);
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -100;
    this.scene.add(this.sky);

    this.hemi = new THREE.HemisphereLight(0xffffff, 0xc9b98f, 0.9);
    this.sun = new THREE.DirectionalLight(0xfff1d0, 1.0);
    this.sun.castShadow = this.profile.shadows;
    if (this.profile.shadows) {
      this.sun.shadow.mapSize.set(this.profile.shadowMapSize, this.profile.shadowMapSize);
      Object.assign(this.sun.shadow.camera, { left: -45, right: 45, top: 45, bottom: -45, near: 1, far: 200 });
      // Ombres propres et légèrement adoucies : pas de moirage sur les personnages, bords moins crénelés
      this.sun.shadow.bias = -0.0004;
      this.sun.shadow.normalBias = 0.04;
      this.sun.shadow.radius = 2.5;
    }
    this.scene.add(this.hemi, this.sun, this.sun.target);

    computeBendMask([opts.home, ...opts.venues]);
    this.buildGround();
    this.buildRoads();
    this.buildSignals();
    for (const v of opts.venues) {
      // Objets de chaque lieu repérés une fois : le toucher ne teste qu'eux (et pas toute la ville)
      // Lieu d'un partenaire : son bâtiment est dessiné par le modèle de marque (buildBrands), pas par un bâtiment générique
      if (v.id.startsWith('brand_')) continue;
      const before = this.scene.children.length;
      const solidsBefore = this.solids.length;
      this.buildVenue(v);
      this.autoWindows(v.id, before);
      const layout = VENUE_LAYOUTS[v.id];
      if (layout) {
        // Un parent conserve les pentes des toits sous une échelle non uniforme.
        // Les obstacles subissent exactement la même transformation que les modèles.
        const group = new THREE.Group();
        group.matrixAutoUpdate = false;
        group.matrix.makeTranslation(v.x, 0, v.z)
          .multiply(new THREE.Matrix4().makeRotationY(venueYaw(v.id)))
          .multiply(new THREE.Matrix4().makeScale(...layout.scale))
          .multiply(new THREE.Matrix4().makeTranslation(-v.x, 0, -v.z));
        for (const o of this.scene.children.slice(before)) {
          o.userData.venueId = v.id;
          // Les vendeuses gardent la taille des autres personnages de la rue.
          if (v.id === 'marche_assigame' && o instanceof THREE.Group) o.scale.multiply(new THREE.Vector3(1 / layout.scale[0], 1 / layout.scale[1], 1 / layout.scale[2]));
          group.add(o);
        }
        this.scene.add(group);
        this.mergeParents.push(group);
        for (const s of this.solids.slice(solidsBefore)) {
          const corners = [[s.x0, s.z0], [s.x1, s.z0], [s.x0, s.z1], [s.x1, s.z1]]
            .map(([sx, sz]) => new THREE.Vector3(sx!, 0, sz!).applyMatrix4(group.matrix));
          s.x0 = Math.min(...corners.map(p => p.x));
          s.x1 = Math.max(...corners.map(p => p.x));
          s.z0 = Math.min(...corners.map(p => p.z));
          s.z1 = Math.max(...corners.map(p => p.z));
        }
        this.solidGrid = null;
      }
      this.clearRoads(before, solidsBefore);
      this.trimSlabs(before, v.id);
      this.venueLot(v, this.solids.slice(solidsBefore));
      for (const o of this.scene.children.slice(before)) {
        o.userData.venueId = v.id;
        this.venueObjects.push(o);
      }
    }
    {
      // Maison du joueur : construite façade au sud (+z), puis retournée si la route la plus proche passe derrière elle,
      // pour que portail, entrée et parking donnent sur la rue (et pas sur l'arrière d'un îlot)
      const h = opts.home;
      this.homeYaw = this.homeFacing(h.x, h.z);
      const before = this.scene.children.length;
      const solidsBefore = this.solids.length;
      this.buildHome(h);
      if (this.homeYaw !== 0) {
        const group = new THREE.Group();
        group.matrixAutoUpdate = false;
        group.matrix.makeTranslation(h.x, 0, h.z).multiply(new THREE.Matrix4().makeRotationY(this.homeYaw)).multiply(new THREE.Matrix4().makeTranslation(-h.x, 0, -h.z));
        for (const o of this.scene.children.slice(before)) group.add(o);
        this.scene.add(group);
        this.mergeParents.push(group);
        for (const sd of this.solids.slice(solidsBefore)) {
          const corners = [[sd.x0, sd.z0], [sd.x1, sd.z0], [sd.x0, sd.z1], [sd.x1, sd.z1]].map(([sx, sz]) => new THREE.Vector3(sx!, 0, sz!).applyMatrix4(group.matrix));
          sd.x0 = Math.min(...corners.map((q) => q.x));
          sd.x1 = Math.max(...corners.map((q) => q.x));
          sd.z0 = Math.min(...corners.map((q) => q.z));
          sd.z1 = Math.max(...corners.map((q) => q.z));
        }
        this.solidGrid = null;
      }
    }
    this.buildBrands();
    this.buildCityRoundabouts();
    this.buildMedians();
    this.buildStreetLights();
    this.buildHouses();
    this.buildRoadsideKiosks();
    this.buildGrandLome();
    this.buildTrees();
    this.buildBoulevardTrees();
    this.buildStreetLife();
    this.buildBillboards();
    this.buildSea();
    this.buildLagoons();
    this.buildLandAccess();
    this.setLand(opts.land ?? []);

    this.player = buildPerson(this.mats, opts.look);
    this.scene.add(this.player);
    this.vehicles = { ZEM: this.buildMoto(0xe5383b), WORO: this.buildCar(0xffce00, 4.2, { kind: 'hatch', stripe: 0x111111 }), BUS: this.buildCar(0x1f6feb, 9), CAR: this.buildCar(0xd9dde3, 4.2, { kind: 'sedan' }) }; // CAR : la voiture du joueur
    // Conducteur du zémidjan : gilet vert, casque, mains au guidon ; le joueur s'assoit derrière lui.
    const driver = buildRider(this.mats, { ...randomLook(rng(4242)), female: false, outfit: 'casual', fabric: 'plain', color: 4 }, { ...ZEM_SEAT, helmet: 0x196a45 });
    this.vehicles.ZEM.add(driver);
    this.zemDriver = driver;
    // Taxi : un vrai taxi avec son chauffeur ; le joueur est assis à l'arrière, dans l'habitacle (et non perché sur la carrosserie).
    // Sa propre voiture : il est assis au volant. Personnages réduits, jambes pliées vers le plancher : ils tiennent sous le toit.
    {
      const seat = (g: THREE.Group, x: number, z: number): THREE.Group => {
        sitPose(g);
        for (const n of ['legL', 'legR']) {
          const leg = g.getObjectByName(n);
          if (leg) leg.rotation.x = -0.9;
        }
        g.scale.setScalar(0.68);
        g.position.set(x, 0.12, z);
        return g;
      };
      this.vehicles.WORO.add(seat(buildPerson(this.mats, { ...randomLook(rng(9191)), female: false, outfit: 'casual', fabric: 'plain', color: 2 }), -0.38, 0.55));
      const client = seat(buildPerson(this.mats, opts.look), 0.38, -0.75);
      this.taxiRider = client;
      this.vehicles.WORO.add(client);
      const pilot = seat(buildPerson(this.mats, opts.look), -0.38, 0.45);
      this.carDriver = pilot;
      this.vehicles.CAR.add(pilot);
    }
    Object.values(this.vehicles).forEach((v) => {
      v.visible = false;
      this.scene.add(v);
    });
    this.buildYouMarker();

    this.marker = new THREE.Mesh(this.geo(new THREE.RingGeometry(0.6, 0.9, 24)), new THREE.MeshBasicMaterial({ color: 0x1f6feb, transparent: true, opacity: 0 }));
    this.marker.rotation.x = -Math.PI / 2;
    this.scene.add(this.marker);

    // Épingles (DOM au-dessus du canvas : texte net, accessibles au clavier)
    this.pinLayer = document.createElement('div');
    this.pinLayer.className = 'pins';
    container.appendChild(this.pinLayer);
    for (const v of [opts.home, ...opts.venues]) this.addPin(v);
    this.buildVipSpots(); // après la couche des épingles

    this.placeAt(opts.home.id);
    // Développement seulement : accès depuis la console (captures, débogage de la caméra)
    if (import.meta.env.DEV) (window as unknown as { __agbeWorld?: World }).__agbeWorld = this;

    const el = this.renderer.domElement;
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerup', this.onUp);
    el.addEventListener('pointercancel', this.onCancel);
    el.addEventListener('wheel', this.onWheel, { passive: false });
    el.addEventListener('contextmenu', this.noMenu);
    window.addEventListener('keydown', this.onKey);
    window.addEventListener('keyup', this.onKey);
    document.addEventListener('visibilitychange', this.onVisibility);
    // Redimensionner le canvas efface son image : on redessine aussitôt (le callback passe avant l'affichage),
    // sinon la page montre un canvas vide jusqu'à l'image suivante de la boucle, d'où un flash.
    this.resizeObs = new ResizeObserver(() => {
      this.resize();
      if (this.disposed || this.paused || this.hidden) return;
      this.renderer.render(this.scene, this.camera);
      this.updatePins();
    });
    this.resizeObs.observe(container);
    this.resize();
    this.raf = requestAnimationFrame(this.loop);
    this.mergeStatic();
    if (import.meta.env.DEV) (window as unknown as { __agbeWorld?: unknown }).__agbeWorld = this; // diagnostic en développement
    void this.upgradeWithModels();
  }

  /**
   * Remplace les maisons dessinées en code par de vrais modèles d'immeubles et ajoute la circulation.
   * Asynchrone : la ville est jouable tout de suite, les modèles arrivent ensuite (et restent en cache).
   */
  private async upgradeWithModels(): Promise<void> {
    const models = await loadModels([...BUILDINGS, ...DETAILS]);
    if (this.disposed) return;
    const towers = BUILDINGS.map((n) => models.get(n)).filter((m): m is Model => !!m);
    // Maisons de quartier : villas et maisons modernes dessinées en code (plain-pied d'abord, puis à étage), vitres allumées la nuit
    const homes = [...CITY_LOW, ...CITY_TALL].map((st) => houseModel(this.mats, st));
    const blds = [...towers, ...homes];
    if (blds.length > 0 && this.houseSpots.length > 0) {
      this.houseMeshes.forEach((m) => (m.visible = false));
      const r = rng(777);
      const groups = blds.map(() => [] as typeof this.houseSpots);
      // Maisons basses : modèles de villas et maisons à étage ; centre et immeubles : modèles d'immeubles
      for (const s of this.houseSpots) {
        const home = homes.length > 0 && (towers.length === 0 || s.floors <= 2) && r() < (s.floors === 1 ? 0.95 : 0.6);
        const pick = s.floors === 1 ? Math.floor(r() * CITY_LOW.length) : CITY_LOW.length + Math.floor(r() * CITY_TALL.length);
        groups[home ? towers.length + pick : Math.floor(r() * towers.length)]!.push(s);
      }
      const m4 = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      // Par modèle ET par quartier (carrés de 70 m) : seuls les quartiers à l'écran sont dessinés.
      // Les maisons ne projettent pas d'ombre (deux fois moins de triangles) ; les immeubles oui.
      const CHUNK = 120; // quartiers plus grands : moins d’appels de dessin, la caméra de rue s’arrête au brouillard
      blds.forEach((model, gi) => {
        const chunks = new Map<string, typeof this.houseSpots>();
        for (const s of groups[gi]!) {
          const key = `${Math.floor(s.x / CHUNK)},${Math.floor(s.z / CHUNK)}`;
          const c = chunks.get(key);
          if (c) c.push(s);
          else chunks.set(key, [s]);
        }
        for (const list of chunks.values()) {
          const inst = new ModelInstances(model, list.length, this.scene, this.profile.shadows && gi < towers.length);
          if (gi >= towers.length) inst.meshes.forEach((m) => (m.receiveShadow = this.profile.shadows));
          list.forEach((s, i) => {
            const k = Math.min(s.w / model.size.x, s.d / model.size.z) * 1.15;
            // Façade côté rue la plus proche (sud ou nord), légère variation
            q.setFromAxisAngle(this.up, r() < 0.5 ? 0 : Math.PI);
            // Immeubles étirés à la hauteur voulue ; maisons gardées dans leurs proportions
            const hk = gi < towers.length ? s.h / model.size.y : k;
            m4.compose(this.tmp.v.set(s.x, 0.1, s.z), q, this.tmp.s.set(k, hk, k));
            inst.set(i, m4);
            inst.color(i, this.tmp.c.setHex(s.tint));
          });
          inst.commit(true);
          inst.cull();
          this.instances.push(inst);
        }
      });
    }
    // Étals et parasols du Grand Marché et des maquis : détails supplémentaires
    const parasol = models.get('city/detail-parasol-a');
    const beach = this.opts.venues.find((v) => v.id === 'plage_lome');
    if (parasol && beach) {
      const inst = new ModelInstances(parasol, 10, this.scene, this.profile.shadows);
      for (let i = 0; i < 10; i++) {
        this.tmp.m.compose(this.tmp.v.set(beach.x - 27 + i * 6, 0, beach.z + 2 + (i % 2) * 2), this.tmp.q.identity(), this.tmp.s.set(3, 3, 3));
        inst.set(i, this.tmp.m);
      }
      inst.commit();
      this.instances.push(inst);
    }
    // Circulation : voitures, taxis jaunes, camions sur les grands axes
    // Véhicules dessinés en code (carrosserie lisse, peinture teintée par instance) ; la circulation les grandit de 1,7
    const cars: (Model | undefined)[] = TRAFFIC.map((t) => vehicleModel(drawCar(this.mats, { kind: t.kind, color: 0xffffff, stripe: t.stripe }), 1 / 1.7));
    const weights = TRAFFIC.map((t) => t.weight); // beaucoup de taxis et de berlines
    // Parc complet = circulation des heures de pointe ; le reste de la journée, une partie seulement roule.
    const total = Math.round(this.profile.zems * 1.5) * 6;
    const r = rng(4242);
    for (let i = 0; i < total; i++) {
      let pick = r() * weights.reduce((a, b) => a + b, 0);
      let type = 0;
      while (pick > weights[type]! && type < weights.length - 1) pick -= weights[type++]!;
      if (!cars[type]) continue;
      const axis: 'x' | 'z' = r() < 0.65 ? 'x' : 'z';
      const dir: 1 | -1 = r() < 0.5 ? 1 : -1;
      const road = axis === 'x' ? ROADS_Z[Math.floor(r() * ROADS_Z.length)]! : ROADS_X[Math.floor(r() * ROADS_X.length)]!;
      // Conduite à droite : la droite de +x est +z, celle de +z est −x
      const lane = road + (axis === 'x' ? dir : -dir) * LANE;
      const eastEnd = axis === 'x' ? trafficEast(road) : MAX_X;
      let pos = axis === 'x' ? MIN_X + r() * (eastEnd - MIN_X) : MIN_Z + r() * (14 - MIN_Z);
      // Les véhicules ne naissent plus superposés sur une même file.
      for (let attempt = 0; attempt < 14 && [...this.cars, ...this.zems].some((c) => c.axis === axis && c.dir === dir && Math.abs(c.lane - lane) < 0.8 && Math.abs(c.pos - pos) < 9); attempt++) {
        pos = axis === 'x' ? MIN_X + r() * (eastEnd - MIN_X) : MIN_Z + r() * (14 - MIN_Z);
      }
      const speed = 4.5 + r() * 4;
      this.cars.push({ type, axis, dir, lane, pos, speed, cruise: speed, v: speed, len: trafficLen(type), gap: Infinity, leadV: speed, stuck: 0 });
    }
    // Boulevard devant le Port (z = 14) vers le contournement : un flux continu, une voiture tous les ~30 m par sens
    // (le tirage au hasard sur toutes les routes y laissait de grands vides)
    {
      const eastEnd = trafficEast(14);
      const n = Math.max(2, Math.round((eastEnd - 40) / 30));
      for (const dir of [1, -1] as const) {
        for (let k = 0; k < n; k++) {
          let pick = r() * weights.reduce((a, b) => a + b, 0);
          let type = 0;
          while (pick > weights[type]! && type < weights.length - 1) pick -= weights[type++]!;
          if (!cars[type]) continue;
          const pos = 40 + ((k + 0.15 + r() * 0.7) / n) * (eastEnd - 40);
          const speed = 5 + r() * 3.5;
          this.cars.push({ type, axis: 'x', dir, lane: 14 + dir * LANE, pos, speed, cruise: speed, v: speed, len: trafficLen(type), gap: Infinity, leadV: speed, stuck: 0 });
        }
      }
    }
    const heavy = heavyTypes();
    // RN1 vers Davié et Tsévié : un poids lourd articulé (semi-remorque, citerne) tous les ~150 m par sens
    const rn1Heavy = Math.round((MIN_Z - EYADEMA_END_Z) / 150);
    for (const dir of [1, -1] as const) {
      for (let k = 0; k < rn1Heavy; k++) {
        const type = heavy[Math.floor(r() * heavy.length)]!;
        if (!cars[type]) continue;
        const pos = EYADEMA_END_Z + ((k + 0.15 + r() * 0.7) / rn1Heavy) * (MIN_Z - EYADEMA_END_Z);
        const speed = 5 + r() * 2.5; // lourds : un peu plus lents que les voitures
        this.cars.push({ type, axis: 'z', dir, lane: -dir * LANE, pos, speed, cruise: speed, v: speed, len: trafficLen(type), gap: Infinity, leadV: speed, stuck: 0 });
      }
    }
    // RN1 vers Tsévié : au nord de la ville (après Dogta-Lafiè), le parc commun aux cinq avenues n'y laissait presque personne.
    // Une voiture tous les ~30 m par sens (avant la part horaire du parc), de la limite de la ville jusqu'à Tsévié.
    const rn1 = Math.round(((MIN_Z - EYADEMA_END_Z) / 30) * (0.7 + 0.3 * Math.min(1, this.profile.zems / 20)));
    for (const dir of [1, -1] as const) {
      for (let k = 0; k < rn1; k++) {
        let pick = r() * weights.reduce((a, b) => a + b, 0);
        let type = 0;
        while (pick > weights[type]! && type < weights.length - 1) pick -= weights[type++]!;
        if (!cars[type]) continue;
        const pos = EYADEMA_END_Z + ((k + 0.2 + r() * 0.6) / rn1) * (MIN_Z - EYADEMA_END_Z);
        const speed = 6 + r() * 4; // route nationale : on roule plus vite qu'en ville
        this.cars.push({ type, axis: 'z', dir, lane: -dir * LANE, pos, speed, cruise: speed, v: speed, len: trafficLen(type), gap: Infinity, leadV: speed, stuck: 0 });
      }
    }
    // Rues secondaires : environ une voiture tous les 34 m par sens (le parc complet roule aux heures de pointe)
    const pr = rng(9131);
    PATH_ROUTES.forEach((route, ri) => {
      // Routes de campagne du Grand Lomé (au-delà de la ville dense) : circulation clairsemée, pour ne pas alourdir la simulation
      // Le Quartier d'affaires Ouest et le secteur GTA – OTR sont des quartiers denses, même s'ils sont à l'ouest du plan de base
      const inDistrict = (q: [number, number]) => q[0] < MIN_X + 12 && q[0] > BIZ_EDGE_X - 12 && q[1] > BIZ_NORTH_Z - 10 && q[1] < 20;
      const inGtaSector = (q: [number, number]) => q[0] > -80 && q[0] < 10 && q[1] > -300 && q[1] < -100;
      const dense = route.pts.filter((q) => inDistrict(q) || inGtaSector(q)).length > route.pts.length / 2;
      const rural = !dense && route.pts.filter((q) => q[1] < MIN_Z || q[0] < MIN_X).length > route.pts.length / 2;
      // Camions du Port : quelques-uns par sens, de temps en temps sur la route
      // Densité : une voiture tous les ~70 m en rase campagne, ~38 m en ville, ~32 m en quartier dense (avant 150 / 45 / 32 : des vides
      // entre deux voitures sur les longues routes) ; au moins 2 par sens sur un tracé de plus de 100 m, 10 au plus
      const perDir = route.trucks
        ? 3
        : Math.min(rural ? 16 : 10, Math.max(dense || route.total > 100 ? 2 : 1, Math.floor((route.total / (rural ? 50 : dense ? 36 : 52)) * (0.7 + 0.3 * Math.min(1, this.profile.zems / 20)))));
      // Sur un anneau de rond-point, un seul sens de circulation
      for (const dir of route.oneWay ? [route.oneWay] : ([1, -1] as const)) {
        for (let k = 0; k < perDir; k++) {
          let pick = pr() * weights.reduce((a, b) => a + b, 0);
          let type = 0;
          while (pick > weights[type]! && type < weights.length - 1) pick -= weights[type++]!;
          // Contournements (échangeurs) : surtout des poids lourds articulés, quelques camions
          if (route.trucks) type = pr() < 0.7 ? heavy[Math.floor(pr() * heavy.length)]! : TRAFFIC.findIndex((t) => t.kind === 'truck');
          if (!cars[type]) continue;
          const speed = 4.5 + pr() * 3.5;
          this.pathCars.push({ uid: this.pathCars.length, type, route: ri, axis: 'x', lane: 0, pos: ((k + pr() * 0.8) / perDir) * route.total, dir, speed, cruise: speed, v: speed, len: trafficLen(type), gap: Infinity, leadV: speed, stuck: 0, x: 0, y: 0, z: 0, hx: 1, hz: 0, wait: 0 });
        }
      }
    });
    this.syncTraffic(true);
    this.carSets = cars.map((m, t) => (m ? new ModelInstances(m, Math.max(1, this.cars.filter((c) => c.type === t).length + this.pathCars.filter((c) => c.type === t).length), this.scene, this.profile.shadows) : null)) as ModelInstances[];
  }

  // ---------- API ----------

  /** Recentre la carte sur le joueur. */
  recenter(): void {
    this.focus.copy(this.player.position);
  }

  /** Remplace les zones de terrain à vendre : sol, bornes, quarts vendus, constructions ; ajuste les limites de la carte. */
  setLand(zones: LandZoneView[]): void {
    if (this.land) {
      this.scene.remove(this.land.group);
      this.land.geos.forEach((g) => g.dispose());
      this.land.own.forEach((m) => m.dispose());
      this.land = null;
    }
    this.minPanX = MAP_MIN_X;
    this.minPanZ = MAP_MIN_Z - 22;
    this.maxPanZ = WALK_MAX_Z;
    if (zones.length === 0) return;
    this.land = buildLandLayer(zones, this.mats, (t, sub, bg, fg, w, h) => this.posterTexture(t, sub, bg, fg, w, h), this.profile.shadows);
    this.scene.add(this.land.group);
    const b = this.land.bounds;
    this.minPanX = Math.min(MAP_MIN_X, b.minX);
    this.maxPanX = Math.max(this.maxPanX, b.maxX);
    this.minPanZ = Math.min(this.minPanZ, b.minZ);
    this.maxPanZ = Math.max(this.maxPanZ, b.maxZ);
  }

  /** Centre la carte sur un point (zone de terrain, lieu…). */
  focusAt(x: number, z: number): void {
    this.focus.set(THREE.MathUtils.clamp(x, this.minPanX, this.maxPanX), 0, THREE.MathUtils.clamp(z, this.minPanZ, Math.max(this.maxPanZ, this.seaMaxZ)));
  }

  /** Affiche ou masque les panneaux publicitaires et les enseignes de marque. */
  setBoardsVisible(on: boolean): void {
    for (const b of this.boards) {
      // Le panneau entier (poteaux, cadre, affiche) est le parent de la face cliquable
      const root = b.parent && b.parent !== this.scene ? b.parent : b;
      root.visible = on;
    }
  }

  /** Champ de vision : plus large en marchant (rue à hauteur d'homme, comme dans la référence) que sur la carte. */
  private fovFor(portrait: boolean): number {
    const street = this.view === 'street';
    return portrait ? (street ? 68 : 58) : street ? 58 : 40;
  }

  setView(v: CityView): void {
    this.view = v;
    this.camera.fov = this.fovFor(this.container.clientWidth < this.container.clientHeight);
    this.camera.updateProjectionMatrix();
    if (v === 'map') this.focus.copy(this.player.position);
    this.pinLayer.classList.toggle('street', v === 'street');
    (this.scene.fog as THREE.Fog).near = v === 'street' ? 60 : 140;
    (this.scene.fog as THREE.Fog).far = v === 'street' ? 180 : 320;
    // En vue de rue, rien n'est dessiné au-delà du brouillard (la ville lointaine coûtait la moitié de l'image)
    this.camera.far = v === 'street' ? 190 : 500;
    // Vue de dessus : la caméra est loin du sol, un plan proche à 0,5 donnait une précision de profondeur trop faible (les dalles fines superposées clignotaient)
    this.camera.near = v === 'street' ? 0.5 : 8;
    this.camera.updateProjectionMatrix();
  }

  /** Le personnage est-il déjà devant ce lieu (à `r` mètres de son entrée) ? Évite un trajet inutile, qui ferait tourner en rond. */
  isNear(id: string, r = 8): boolean {
    const v = this.find(id);
    if (!v) return false;
    const e = this.entryOf(v);
    return Math.hypot(this.player.position.x - e.x, this.player.position.z - e.z) <= r;
  }

  /** Place immédiatement le personnage devant un lieu (chargement, retour de la maison). */
  placeAt(id: string): void {
    const v = this.find(id);
    if (!v) return;
    this.stopTravel(); // une activité qui en lance une autre ne doit jamais laisser un trajet précédent en suspens
    const e = this.entryOf(v);
    this.groundY = 0;
    this.player.position.set(e.x, 0, e.z);
    this.player.rotation.y = e.yaw;
    this.yaw = e.yaw; // face au lieu
    this.focus.copy(this.player.position);
    this.snapCamera();
  }

  /** Flèche rouge qui flotte au-dessus du joueur (dessinée par-dessus tout) et drapeau d'arrivée. */
  private buildYouMarker(): void {
    const red = new THREE.MeshBasicMaterial({ color: 0xe5383b, depthTest: false, transparent: true });
    const white = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });
    const g = new THREE.Group();
    const arrow = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.42, 0.75, 4)), red);
    arrow.rotation.x = Math.PI; // pointe vers le bas
    arrow.name = 'arrow';
    const rim = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.56, 0.95, 4)), white);
    rim.rotation.x = Math.PI;
    rim.position.y = 0.06;
    rim.scale.set(1, 1, 1);
    arrow.renderOrder = 21;
    rim.renderOrder = 20;
    const ring = new THREE.Mesh(this.geo(new THREE.RingGeometry(0.7, 1.0, 32)), new THREE.MeshBasicMaterial({ color: 0xe5383b, depthTest: false, transparent: true }));
    ring.rotation.x = -Math.PI / 2;
    ring.name = 'ring';
    ring.renderOrder = 19;
    g.add(rim, arrow, ring);
    this.youMarker = g;
    this.scene.add(g);
    const flag = new THREE.Group();
    const pole = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.08, 0.08, 3.2, 6)), white);
    pole.position.y = 1.6;
    const cloth = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(1.4, 0.9)), new THREE.MeshBasicMaterial({ color: 0xe5383b, side: THREE.DoubleSide, depthTest: false }));
    cloth.position.set(0.72, 2.7, 0);
    pole.renderOrder = cloth.renderOrder = 20;
    flag.add(pole, cloth);
    flag.visible = false;
    this.routeFlag = flag;
    this.scene.add(flag);
  }

  /** Ruban rouge posé sur les routes, du joueur à l'arrivée (deux triangles par tronçon). */
  private drawRoute(from: THREE.Vector3): void {
    if (this.routeRibbon) {
      this.scene.remove(this.routeRibbon);
      this.routeRibbon.geometry.dispose();
    }
    const pts = [from.clone(), ...this.route];
    const pos: number[] = [];
    const w = 0.55;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1]!;
      const b = pts[i]!;
      const len = Math.hypot(b.x - a.x, b.z - a.z) || 1;
      const nx = (-(b.z - a.z) / len) * w;
      const nz = ((b.x - a.x) / len) * w;
      const y = 0.18;
      pos.push(a.x + nx, y, a.z + nz, a.x - nx, y, a.z - nz, b.x + nx, y, b.z + nz, a.x - nx, y, a.z - nz, b.x - nx, y, b.z - nz, b.x + nx, y, b.z + nz);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xe5383b, transparent: true, opacity: 0.85, depthTest: false, side: THREE.DoubleSide }));
    mesh.renderOrder = 18;
    this.routeRibbon = mesh;
    this.scene.add(mesh);
    const end = pts[pts.length - 1]!;
    this.routeFlag.position.set(end.x, 0, end.z);
    this.routeFlag.visible = true;
  }

  private clearRoute(): void {
    if (this.routeRibbon) {
      this.scene.remove(this.routeRibbon);
      this.routeRibbon.geometry.dispose();
      (this.routeRibbon.material as THREE.Material).dispose();
      this.routeRibbon = null;
    }
    this.routeFlag.visible = false;
  }

  /** Avancement du trajet en cours (null hors trajet) : part parcourue, secondes restantes, moyen, destination. */
  tripProgress(): { ratio: number; secondsLeft: number; mode: TravelMode; to: string } | null {
    if (!this.travelDone || this.trip.total <= 0) return null;
    const ratio = Math.min(1, this.trip.done / this.trip.total);
    return { ratio, secondsLeft: Math.max(0, Math.round((this.trip.total - this.trip.done) / Math.max(0.1, this.speed))), mode: this.trip.mode, to: this.trip.to };
  }

  /** Trajet animé le long des routes ; la promesse se résout à l'arrivée. */
  /**
   * Itinéraire par les routes de `p` jusqu'à `finalDest` (devant l'entrée d'un lieu), sur la voie de droite (trottoir de gauche
   * à pied), réparé autour des obstacles et posé sur les tabliers des échangeurs. Sert au joueur et à l'ambulance.
   */
  private planPath(p: THREE.Vector3, finalDest: THREE.Vector3, mode: TravelMode, airportArrival = false, startY = this.groundY): THREE.Vector3[] {
    let route: THREE.Vector3[] = [];
    const [gateX, gateZ] = AIRPORT_ACCESS[0]!;
    const [terminalX, terminalZ] = AIRPORT_ACCESS[AIRPORT_ACCESS.length - 1]!;
    const airportDeparture = !airportArrival && Math.hypot(p.x - terminalX, p.z - terminalZ) < 8;
    const start = airportDeparture ? new THREE.Vector3(gateX, 0, gateZ) : p;
    const dest = airportArrival ? new THREE.Vector3(gateX, 0, gateZ) : finalDest;
    const north = (z: number) => z < ROAD_END_Z - 5;
    const pn = north(start.z);
    const dn = north(dest.z);
    const rz = nearest(start.z, ROADS_Z);
    const rz2 = nearest(dest.z, ROADS_Z);
    // Avenue de liaison prise entre le départ et l'arrivée quand il y en a une : pas d'aller au-delà puis de demi-tour
    const between = ROADS_X.filter((x) => x >= Math.min(start.x, dest.x) - 0.5 && x <= Math.max(start.x, dest.x) + 0.5);
    const rx = pn || dn ? 0 : nearest(dest.x, between.length ? between : ROADS_X);
    // Itinéraire en L par les grands axes, puis la dernière rue jusqu'à l'entrée.
    // Au nord de la grille, tout passe par le boulevard Eyadéma puis la rue transversale du lieu.
    const corners: [number, number, 'x' | 'z' | null][] = [];
    // Au nord, l'itinéraire suit le réseau routier (boulevard Eyadéma, routes de Kégué, des Deux Lions, CEDEAO…)
    const net = (ax: number, az: number, bx: number, bz: number) => {
      for (const [x, z] of northPath(ax, az, bx, bz)) corners.push([x, z, 'n' as 'z']);
    };
    const gate = ROAD_END_Z - 6;
    if (pn) {
      corners.push([start.x, start.z, null]);
      net(start.x, start.z, dn ? dest.x : 0, dn ? dest.z : gate);
    } else {
      corners.push([start.x, rz, null], [rx, rz, 'x']);
      if (dn) {
        corners.push([0, gate, 'z']);
        net(0, gate, dest.x, dest.z);
      }
    }
    if (!dn) {
      if (!pn && rz === rz2) {
        // Même boulevard : deux points suffisent. L'ancien code conservait ensuite l'avenue `rx`,
        // ce qui créait un aller-retour artificiel avant de revenir à la destination.
        corners.length = 0;
        corners.push([start.x, rz, null], [dest.x, rz, 'x']);
      } else corners.push([rx, rz2, 'z'], [dest.x, rz2, 'x']);
    }
    if (airportDeparture) {
      for (let i = AIRPORT_ACCESS.length - 2; i >= 0; i--) {
        const [x, z] = AIRPORT_ACCESS[i]!;
        route.push(new THREE.Vector3(x, 0, z));
      }
    }
    for (let i = 0; i < corners.length; i++) {
      const [x1, z1, axis] = corners[i]!;
      const [x0, z0] = i > 0 ? corners[i - 1]! : corners[0]!;
      // Points intermédiaires pour suivre la courbe de la route empruntée
      const steps = axis ? Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / 6)) : 1;
      for (let k = 1; k <= steps; k++) {
        const x = x0 + ((x1 - x0) * k) / steps;
        const z = z0 + ((z1 - z0) * k) / steps;
        if ((axis as string) === 'n') route.push(new THREE.Vector3(x, 0, z));
        else route.push(axis === 'z' ? new THREE.Vector3(x + bend(rx, z), 0, z) : new THREE.Vector3(x, 0, z + (north(z) ? 0 : bend(axis ? z1 : rz, x))));
      }
    }
    if (airportArrival) {
      for (let i = 1; i < AIRPORT_ACCESS.length; i++) {
        const [x, z] = AIRPORT_ACCESS[i]!;
        route.push(new THREE.Vector3(x, 0, z));
      }
    }
    const planned = followTrafficSide(p, route, finalDest, mode === 'WALK' ? LEFT_SIDEWALK : RIGHT_LANE);
    // Une entrée peut être derrière une clôture ou une route peut frôler une concession : on répare
    // uniquement les tronçons qui touchent un obstacle, sans recalculer tout le réseau routier.
    route = [];
    let routePrev = p.clone();
    for (const waypoint of planned) {
      const repaired = this.clearSegment(routePrev, waypoint) ? [waypoint] : this.safeConnector(routePrev, waypoint);
      if (repaired.length === 0) continue;
      route.push(...repaired);
      routePrev = repaired[repaired.length - 1]!;
    }
    route.forEach((waypoint, i) => {
      const prev = i > 0 ? route[i - 1]! : p;
      const next = route[i + 1] ?? waypoint;
      const direction: [number, number] = [next.x - prev.x, next.z - prev.z];
      waypoint.y = flyoverHeight(waypoint.x, waypoint.z, direction);
      if (waypoint.y > 0 && mode === 'WALK') {
        // Sur le pont, le trottoir reste à l’intérieur du garde-corps.
        for (const b of Object.values(FLYOVERS)) {
          const dx = waypoint.x - b.x, dz = waypoint.z - b.z;
          const along = dx * Math.cos(b.yaw) - dz * Math.sin(b.yaw);
          const across = dx * Math.sin(b.yaw) + dz * Math.cos(b.yaw);
          if (Math.abs(along) > b.half + b.ramp || Math.abs(across) > b.width / 2 + 0.7) continue;
          const [x, z] = bridgePoint(b, along, THREE.MathUtils.clamp(across, -b.width / 2 + 0.5, b.width / 2 - 0.5));
          waypoint.x = x;
          waypoint.z = z;
        }
      }
    });
    // Pas de saut sur un échangeur : un point isolé au sol entre deux points du pont reprend leur altitude moyenne,
    // puis la pente entre deux points consécutifs est bornée à celle des rampes (le véhicule ne « décolle » plus).
    for (let i = 1; i < route.length - 1; i++) {
      const w = route[i]!;
      if (w.y === 0 && route[i - 1]!.y > 0 && route[i + 1]!.y > 0) w.y = (route[i - 1]!.y + route[i + 1]!.y) / 2;
    }
    const maxSlope = Math.max(...Object.values(FLYOVERS).map((b) => b.height / b.ramp)) * 1.3;
    const settle = (from: THREE.Vector3, to: THREE.Vector3) => {
      const reach = maxSlope * Math.max(0.5, Math.hypot(to.x - from.x, to.z - from.z));
      to.y = Math.min(from.y + reach, Math.max(from.y - reach, to.y));
    };
    for (let i = 0; i < route.length; i++) settle(i > 0 ? route[i - 1]! : new THREE.Vector3(p.x, startY, p.z), route[i]!);
    for (let i = route.length - 2; i >= 0; i--) settle(route[i + 1]!, route[i]!);
    return route;
  }

  travel(id: string, mode: TravelMode, opts: { roadside?: boolean } = {}): Promise<void> {
    const v = this.find(id);
    if (!v) return Promise.resolve();
    this.stopTravel(); // annule proprement un trajet précédent encore en cours avant d'en démarrer un nouveau
    this.tripWait = 0;
    this.swerveT = 0;
    this.followT = 0;
    const p = this.player.position;
    const entry = this.entryOf(v);
    this.arriveYaw = entry.yaw;
    // Déjà à l'entrée : pas de trajet (le tracé d'un trajet de quelques mètres décrivait une boucle autour du point)
    if (Math.hypot(p.x - entry.x, p.z - entry.z) < 2.5) {
      this.player.rotation.y = entry.yaw;
      this.yaw = entry.yaw;
      this.arriveYaw = null;
      return Promise.resolve();
    }
    this.route = this.planPath(p, new THREE.Vector3(entry.x, 0, entry.z), mode, v.id === 'aeroport');
    // Arrêt au bord de la route (course ou livraison) : le véhicule s'arrête sur la chaussée proche du lieu, sans rouler jusqu'à la
    // devanture ; le client ou le colis fait le reste à pied. On coupe les derniers points à moins de 6 m de l'entrée.
    if (opts.roadside && this.route.length > 1) {
      let k = this.route.length - 1;
      while (k > 0 && Math.hypot(this.route[k]!.x - entry.x, this.route[k]!.z - entry.z) < 6) k--;
      if (k < this.route.length - 1 && Math.hypot(this.route[k]!.x - p.x, this.route[k]!.z - p.z) > 2) {
        this.route = this.route.slice(0, k + 1);
        this.arriveYaw = null;
      }
    }
    let length = 0;
    let prev = p.clone();
    for (const w of this.route) {
      length += prev.distanceTo(w);
      prev = w;
    }
    // Trajet lisible mais jamais interminable, même sur un téléphone lent
    this.speed = Math.max(SPEED[mode], length / MAX_TRIP_S);
    this.riding = mode === 'WALK' ? null : mode;
    this.trip = { total: length, done: 0, points: this.route.length, mode, to: id };
    this.drawRoute(p);
    return new Promise((resolve) => {
      this.travelDone = resolve;
    });
  }

  // ---------- ambulance du SAMU ----------

  /**
   * L'ambulance part des urgences de `hospitalId` et vient jusqu'au joueur, placé devant `pickupId` (sa maison ou le lieu où il
   * était). Gyrophares allumés, sirène dont le volume dépend de la distance. Résout `true` à l'arrêt de l'ambulance, `false` si
   * l'un des deux lieux n'est pas dans cette ville.
   */
  ambulanceCome(hospitalId: string, pickupId: string): Promise<boolean> {
    const h = this.find(hospitalId);
    if (!h || !this.find(pickupId)) return Promise.resolve(false);
    this.stopTravel();
    this.placeAt(pickupId);
    this.ambHold = true;
    const e = this.entryOf(h);
    const target = new THREE.Vector3(this.player.position.x, 0, this.player.position.z);
    const route = this.planPath(new THREE.Vector3(e.x, 0, e.z), target, 'CAR', false, 0);
    // Elle s'arrête au bord de la route, à quelques mètres du joueur (pas sur lui)
    while (route.length > 1 && Math.hypot(route[route.length - 1]!.x - target.x, route[route.length - 1]!.z - target.z) < 6) route.pop();
    if (!this.amb) {
      const rig = buildAmbulance(this.mats);
      this.shadowed(rig.group);
      const stretcher = buildStretcher(this.mats, rig);
      const medics: [THREE.Group, THREE.Group] = [buildParamedic(this.mats, rig, 8201), buildParamedic(this.mats, rig, 8202)];
      for (const o of [rig.group, stretcher, ...medics]) this.scene.add(o);
      this.amb = { rig, medics, stretcher, route: [], total: 0, done: 0, speed: 0, wait: 0, phase: 'coming', arrived: null, load: null, dim: 1, dimUntil: 0 };
    }
    const a = this.amb;
    a.rig.group.visible = true;
    a.rig.group.position.set(e.x, 0, e.z);
    a.rig.group.rotation.set(0, 0, 0, 'YXZ');
    setDoors(a.rig, 0);
    a.stretcher.visible = false;
    for (const m of a.medics) m.visible = false;
    a.route = route;
    let total = 0;
    let prev = a.rig.group.position.clone();
    for (const w of route) {
      total += prev.distanceTo(w);
      prev = w;
    }
    // Rapide, mais le trajet reste lisible : une vingtaine de secondes au plus
    a.total = total;
    a.done = 0;
    a.speed = Math.max(11, total / 22);
    a.wait = 0;
    a.phase = 'coming';
    a.load = null;
    const first = route[0];
    if (first) a.rig.group.rotation.y = Math.atan2(first.x - e.x, first.z - e.z);
    sirenStart();
    return new Promise((resolve) => {
      a.arrived = () => resolve(true);
    });
  }

  /** Avancement de l'ambulance qui arrive (null quand elle ne roule pas). */
  ambulanceProgress(): { ratio: number; secondsLeft: number } | null {
    const a = this.amb;
    if (!a || a.phase !== 'coming' || a.total <= 0) return null;
    return { ratio: Math.min(1, a.done / a.total), secondsLeft: Math.max(0, Math.round((a.total - a.done) / a.speed)) };
  }

  /**
   * Prise en charge : les portes arrière s'ouvrent, deux secouristes sortent le brancard, le joueur s'y allonge, ils le roulent
   * jusqu'à l'ambulance et le font glisser à l'intérieur, puis referment les portes. Résout à la fermeture des portes.
   */
  ambulanceLoad(): Promise<void> {
    const a = this.amb;
    if (!a) return Promise.resolve();
    a.phase = 'loading';
    sirenStop();
    const g = a.rig.group;
    g.updateMatrixWorld(true);
    const out = g.localToWorld(new THREE.Vector3(0, 0, a.rig.rearZ - 1.5));
    const inside = g.localToWorld(new THREE.Vector3(0, a.rig.floorY + 0.02, a.rig.rearZ + 1.1));
    out.y = 0;
    const player = new THREE.Vector3(this.player.position.x, 0, this.player.position.z);
    // Le brancard vient se ranger à côté du joueur (à 0,9 m sur le côté), pas sur lui
    const dir = player.clone().sub(out);
    const dist = Math.max(0.01, dir.length());
    dir.divideScalar(dist);
    const side = player.clone().add(new THREE.Vector3(-dir.z, 0, dir.x).multiplyScalar(0.9));
    const yaw = dist > 0.3 ? Math.atan2(side.x - out.x, side.z - out.z) : g.rotation.y + Math.PI;
    // Caméra de rue derrière le joueur, tournée vers l'ambulance : on voit toute la scène
    this.yaw = Math.atan2(out.x - player.x, out.z - player.z);
    this.player.rotation.order = 'YXZ';
    return new Promise((resolve) => {
      a.load = { t0: performance.now(), done: resolve, player, out, side, inside, yaw };
    });
  }

  /** Fin de la scène : l'ambulance et les secouristes disparaissent, le personnage redevient visible et reprend les commandes. */
  ambulanceClear(): void {
    sirenStop();
    const a = this.amb;
    if (a) {
      a.rig.group.visible = false;
      a.stretcher.visible = false;
      for (const m of a.medics) m.visible = false;
      a.phase = 'parked';
      a.load = null;
      a.arrived = null;
    }
    if (this.ambHold) {
      this.ambHold = false;
      this.player.visible = true;
      this.player.rotation.set(0, this.player.rotation.y, 0, 'XYZ');
      this.player.position.y = this.groundY;
    }
  }

  private readonly ambV = new THREE.Vector3();

  private updateAmbulance(now: number, dt: number): void {
    const a = this.amb;
    if (!a || !a.rig.group.visible) return;
    const g = a.rig.group;
    flashBeacons(a.rig, now);
    if (a.phase === 'coming') {
      const next = a.route[0];
      if (!next) {
        a.phase = 'parked';
        sirenLevel(0);
        const done = a.arrived;
        a.arrived = null;
        done?.();
      } else {
        const pos = g.position;
        const dx = next.x - pos.x;
        const dz = next.z - pos.z;
        const dist = Math.hypot(dx, dz);
        if (dist < 0.15) {
          pos.y = next.y;
          a.route.shift();
        } else {
          const step = Math.min(dist, a.speed * dt);
          const to = this.tmp.v.set(pos.x + (dx / dist) * step, 0, pos.z + (dz / dist) * step);
          // Les voitures lui laissent la voie ; si l'une reste devant, elle attend un instant puis passe
          if (a.pass && a.pass > 0) a.pass -= dt;
          const blocked = pos.y < 2 && !(a.pass && a.pass > 0) && this.trafficOnSegment(pos, to, 0.95);
          if (blocked && a.wait < 1.2) a.wait += dt;
          else {
            // Après l'attente, elle passe franchement pendant un moment (sinon : un pas, un arrêt, un pas… à chaque image)
            if (blocked) a.pass = 1.6;
            a.wait = 0;
            const climb = (next.y - pos.y) * Math.min(1, step / dist);
            pos.set(to.x, pos.y + climb, to.z);
            a.done += step;
            g.rotation.x = -Math.atan2(climb, Math.max(0.01, step));
          }
          const target = Math.atan2(dx, dz);
          g.rotation.y += Math.atan2(Math.sin(target - g.rotation.y), Math.cos(target - g.rotation.y)) * Math.min(1, dt * 6);
        }
        // Sirène : forte quand elle est près du joueur, faible au loin, et parfois presque inaudible un moment
        if (now > a.dimUntil) {
          const r = Math.random();
          a.dim = r < 0.6 ? 1 : r < 0.85 ? 0.55 : 0.18;
          a.dimUntil = now + 1800 + Math.random() * 3200;
        }
        const d = Math.hypot(pos.x - this.player.position.x, pos.z - this.player.position.z);
        const near = Math.pow(Math.max(0, 1 - d / 280), 1.6);
        sirenLevel(Math.max(0.03, near * a.dim));
      }
      return;
    }
    const L = a.load;
    if (a.phase !== 'loading' || !L) return;
    const t = (now - L.t0) / 1000;
    const ease = (k: number) => (k <= 0 ? 0 : k >= 1 ? 1 : k * k * (3 - 2 * k));
    const seg = (t0: number, t1: number) => ease((t - t0) / (t1 - t0));
    // Vecteur propre à la scène : `tmp.w` est la cible lissée de la caméra ; l'écraser ici faisait trembler l'image à l'arrivée du SAMU
    const lerpV = (u: THREE.Vector3, v: THREE.Vector3, k: number) => this.ambV.copy(u).lerp(v, k);
    // 1. Les portes s'ouvrent
    setDoors(a.rig, t < 9.6 ? seg(0, 1.2) : 1 - seg(9.8, 10.9));
    // Position du brancard : sortie à l'arrière, jusqu'au joueur, retour, puis il glisse dans la cellule
    const s = a.stretcher;
    let sp: THREE.Vector3;
    if (t < 1.4) sp = L.out;
    else if (t < 4.2) sp = lerpV(L.out, L.side, seg(1.4, 4.2));
    else if (t < 6.4) sp = L.side;
    else if (t < 8.6) sp = lerpV(L.side, L.out, seg(6.4, 8.6));
    else sp = lerpV(L.out, L.inside, seg(8.6, 9.6));
    s.visible = t >= 1.2 && t < 9.6;
    s.position.copy(sp);
    s.rotation.set(0, L.yaw, 0);
    const fx = Math.sin(L.yaw);
    const fz = Math.cos(L.yaw);
    // 2. Les deux secouristes, un à chaque bout du brancard
    const walking = (t > 1.4 && t < 4.2) || (t > 6.4 && t < 8.6);
    a.medics.forEach((m, i) => {
      const k = i === 0 ? -1.3 : 1.3;
      m.visible = t >= 1.2 && t < 10;
      m.position.set(sp.x + fx * k, 0, sp.z + fz * k);
      // Le secouriste de tête recule face au brancard ; l'autre pousse
      m.rotation.set(0, i === 0 ? L.yaw + Math.PI : L.yaw, 0);
      if (t >= 9.6) m.position.set(L.out.x + (i === 0 ? 1 : -1) * fz * 0.6, 0, L.out.z - (i === 0 ? 1 : -1) * fx * 0.6);
      animateWalk(m, now / 120 + i, walking ? 0.6 : 0);
    });
    // 3. Le joueur se tourne vers le brancard, s'y allonge, puis voyage avec lui
    const p = this.player;
    const HIP = 0.95;
    const pose = (hx: number, hy: number, hz: number, pitch: number, yaw: number) => {
      p.rotation.set(pitch, yaw, 0, 'YXZ');
      const off = this.tmp.v.set(0, HIP, 0).applyEuler(p.rotation);
      p.position.set(hx - off.x, hy - off.y, hz - off.z);
    };
    // Allongé la tête vers l'ambulance (il y entre la tête la première) : le bassin est un peu vers les pieds
    const lyingYaw = L.yaw + Math.PI;
    const lying = (c: THREE.Vector3) => pose(c.x + fx * 0.15, c.y + 0.98, c.z + fz * 0.15, -Math.PI / 2, lyingYaw);
    animateWalk(p, 0, 0);
    // Il attend face au brancard, puis s'assoit dessus et s'allonge
    const face = Math.atan2(L.side.x - L.player.x, L.side.z - L.player.z);
    if (t < 4.6) pose(L.player.x, HIP, L.player.z, 0, face);
    else if (t < 6.2) {
      const k = seg(4.6, 6.2);
      const turn = Math.atan2(Math.sin(lyingYaw - face), Math.cos(lyingYaw - face));
      pose(L.player.x + (L.side.x + fx * 0.15 - L.player.x) * k, HIP + (0.98 - HIP) * k, L.player.z + (L.side.z + fz * 0.15 - L.player.z) * k, -Math.PI / 2 * k, face + turn * k);
    } else lying(sp);
    p.visible = t < 9.7;
    if (t >= 11) {
      a.phase = 'aboard';
      a.load = null;
      for (const m of a.medics) m.visible = false;
      L.done();
    }
  }

  /** Interrompt le trajet en cours : le personnage s'arrête où il est et la promesse de `travel` se résout. */
  stopTravel(): void {
    const done = this.travelDone;
    if (!done) return;
    this.travelDone = null;
    this.route = [];
    this.clearRoute();
    this.riding = null;
    this.arriveYaw = null;
    done();
  }

  /** Carton de livraison (au sol en attendant, puis sur le porte-bagages de la moto). */
  private parcel(): THREE.Group {
    const g = new THREE.Group();
    const box = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.6, 0.45, 0.5)), this.mats.color(0xc49a6c));
    box.position.y = 0.23;
    const tape = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.62, 0.06, 0.1)), this.mats.color(0xe9d8b4));
    tape.position.y = 0.46;
    g.add(box, tape);
    return g;
  }

  /**
   * Le joueur conduit sa propre moto (missions de livreur ou de zémidjan) : pas de conducteur devant lui.
   * `passenger` : un client assis derrière (course de zém) ; sinon personne (livraison : le colis est sanglé derrière).
   */
  setOwnMoto(on: boolean, passenger = false): void {
    this.ownMoto = on;
    if (this.zemDriver) this.zemDriver.visible = !on;
    if (this.pillion) {
      this.pillion.removeFromParent();
      this.pillion = null;
    }
    if (on && passenger) {
      const g = buildPerson(this.mats, randomLook(rng(this.customerSeed * 7919)));
      ridePose(g, motoPillionSpec());
      this.vehicles.ZEM.add(g);
      this.pillion = g;
    }
  }

  private dutyMoto = false;
  /**
   * Zémidjan ou livreur en service : sa moto est sous lui dès qu'une course est proposée (il attend le client sur la selle),
   * pas seulement une fois le trajet lancé. Sans effet pendant un trajet, à la station ou quand il est déjà sur sa moto.
   */
  setDutyMoto(on: boolean): void {
    if (on) {
      if (this.travelDone || this.stationProps || this.riddenOn || this.riding) return;
      this.dutyMoto = true;
      this.riding = 'ZEM';
      this.ownMoto = true;
      if (this.zemDriver) this.zemDriver.visible = false;
    } else if (this.dutyMoto && !this.travelDone) {
      this.dutyMoto = false;
      this.riding = null;
      this.ownMoto = false;
      if (this.zemDriver) this.zemDriver.visible = true;
    } else if (!on) this.dutyMoto = false;
  }

  /**
   * Le joueur reste sur sa moto (ou au volant de sa voiture) dans la rue après un trajet : il repart avec, sans changer de moyen de
   * transport. Sans effet pendant un trajet ou la scène de la station (qui montre déjà le véhicule).
   */
  private riddenOn = false;
  /** Véhicule personnel avec lequel le joueur est arrivé (null = à pied). */
  private rideKind: 'MOTO' | 'CAR' | null = null;
  /** Moto et voiture garées (devant la maison, ou là où le joueur est descendu). */
  private readonly parked: Partial<Record<'MOTO' | 'CAR', { g: THREE.Group; x: number; z: number; yaw: number }>> = {};

  /** Pose (ou retire) la moto et la voiture du joueur devant sa maison. Sans effet sur un véhicule déjà posé ailleurs. */
  /** Espace de stationnement préparé devant la maison (dalles, marquage, panneau) : une place de voiture et une place de moto. */
  private parkingPads: THREE.Group | null = null;

  private buildParkingPads(e: { x: number; z: number; yaw: number }, rx: number, rz: number): void {
    const g = new THREE.Group();
    const mat = (c: number) => this.mats.color(c, 0.8);
    const bay = (side: number, w: number, len: number, label: string) => {
      const x = e.x + rx * side;
      const z = e.z + rz * side;
      const b = new THREE.Group();
      b.position.set(x, this.groundY, z);
      b.rotation.y = Math.atan2(this.opts.home.x - x, this.opts.home.z - z); // même sens que le véhicule garé
      const part = (bw: number, bh: number, bd: number, c: number, px: number, py: number, pz: number) => {
        const m = new THREE.Mesh(this.geo(new THREE.BoxGeometry(bw, bh, bd)), mat(c));
        m.position.set(px, py, pz);
        m.receiveShadow = this.profile.shadows;
        b.add(m);
        return m;
      };
      part(w, 0.06, len, 0x8a8d93, 0, 0.03, 0); // dalle de béton
      for (const dx of [-w / 2 + 0.06, w / 2 - 0.06]) part(0.08, 0.075, len - 0.1, 0xf5f5f0, dx, 0.034, 0); // lignes latérales
      part(w - 0.1, 0.075, 0.08, 0xf5f5f0, 0, 0.034, -len / 2 + 0.07); // ligne du fond
      part(w * 0.72, 0.14, 0.16, 0xd9d2c0, 0, 0.1, len / 2 - 0.55); // butée de roues
      void label;
      g.add(b);
    };
    bay(-3.4, 1.5, 2.7, 'moto');
    bay(5.2, 3.0, 5.4, 'car');
    // Panneau « P » entre les deux places : mât, plaque bleue et lettre blanche
    const sx = e.x + rx * 0.9;
    const sz = e.z + rz * 0.9;
    const pole = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.04, 0.04, 2.1, 8)), mat(0x9aa0a8));
    pole.position.set(sx, this.groundY + 1.05, sz);
    const plate = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.62, 0.62, 0.05)), mat(0x1f6feb));
    plate.position.set(sx, this.groundY + 2.2, sz);
    plate.rotation.y = e.yaw;
    const stem = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.08, 0.38, 0.02)), mat(0xffffff));
    const bowl = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.22, 0.2, 0.02)), mat(0xffffff));
    stem.position.set(-0.07, 0, 0.035);
    bowl.position.set(0.04, 0.08, 0.035);
    plate.add(stem, bowl);
    g.add(pole, plate);
    this.scene.add(g);
    this.parkingPads = g;
  }

  setParkedVehicles(want: { MOTO: boolean; CAR: boolean }): void {
    const e = this.entryOf(this.opts.home);
    const rx = Math.cos(e.yaw);
    const rz = -Math.sin(e.yaw);
    if (!this.parkingPads) this.buildParkingPads(e, rx, rz);
    for (const k of ['MOTO', 'CAR'] as const) {
      const have = this.parked[k];
      if (!want[k]) {
        if (have) {
          this.scene.remove(have.g);
          delete this.parked[k];
        }
        continue;
      }
      if (have) continue;
      const g = k === 'MOTO' ? this.buildMoto(0xe5383b) : this.buildCar(0xd9dde3, 4.2, { kind: 'sedan' });
      const side = k === 'MOTO' ? -3.4 : 5.2;
      const x = e.x + rx * side;
      const z = e.z + rz * side;
      const yaw = Math.atan2(this.opts.home.x - x, this.opts.home.z - z); // pare-chocs tourné vers la maison
      g.position.set(x, this.groundY, z);
      g.rotation.y = yaw;
      g.visible = this.rideKind !== k;
      this.scene.add(g);
      this.parked[k] = { g, x, z, yaw };
    }
  }

  /** Le joueur assis à l'arrière du taxi (son corps de rue est masqué pendant la course). */
  private taxiRider: THREE.Group | null = null;
  /** Le joueur au volant de sa voiture. */
  private carDriver: THREE.Group | null = null;
  setRidden(kind: 'MOTO' | 'CAR' | null): void {
    if (this.stationProps || this.travelDone) return;
    if (!kind) {
      if (!this.riddenOn) return;
      this.riddenOn = false;
      if (this.rideKind) {
        const pkd = this.parked[this.rideKind];
        if (pkd) pkd.g.visible = true;
      }
      this.rideKind = null;
      this.riding = null;
      this.ownMoto = false;
      if (this.zemDriver) this.zemDriver.visible = true;
      return;
    }
    this.riddenOn = true;
    this.rideKind = kind;
    const pkd = this.parked[kind];
    if (pkd) pkd.g.visible = false;
    this.riding = kind === 'MOTO' ? 'ZEM' : 'CAR';
    this.ownMoto = kind === 'MOTO';
    if (this.zemDriver) this.zemDriver.visible = false;
  }

  /** Point de départ des piétons qui quittent la moto : à droite du véhicule, vers l'entrée du lieu. */
  private dropSpot(id: string): { x: number; z: number; dx: number; dz: number } | null {
    const v = this.find(id);
    if (!v) return null;
    const e = this.entryOf(v);
    const p = this.player.position;
    const rot = this.player.rotation.y;
    const x = p.x + Math.cos(rot) * 0.9;
    const z = p.z - Math.sin(rot) * 0.9;
    const dx = e.x - x;
    const dz = e.z - z;
    const len = Math.hypot(dx, dz) || 1;
    return { x, z, dx: dx / len, dz: dz / len };
  }

  /** Le client descend de la moto, arrêtée au bord de la route, et marche jusqu'à l'entrée du lieu. */
  dropPassenger(id: string): void {
    const g = this.pillion;
    const spot = this.dropSpot(id);
    if (!g || !spot) return;
    this.pillion = null;
    g.removeFromParent();
    clearRidePose(g);
    g.rotation.set(0, Math.atan2(spot.dx, spot.dz), 0);
    g.position.set(spot.x, this.groundY, spot.z);
    this.scene.add(g);
    this.leavers.push({ g, t: 0, dx: spot.dx, dz: spot.dz, phase: 0 });
  }

  /** Livraison : un livreur du lieu vient chercher le colis au bord de la route et l'emporte à l'entrée. */
  dropParcel(id: string): void {
    const spot = this.dropSpot(id);
    if (!spot) return;
    const g = buildPerson(this.mats, randomLook(rng(this.customerSeed++ * 104729)));
    const box = this.parcel();
    box.position.set(0, 0.95, 0.32);
    box.scale.setScalar(0.8);
    g.add(box);
    g.position.set(spot.x, this.groundY, spot.z);
    g.rotation.y = Math.atan2(spot.dx, spot.dz);
    this.scene.add(g);
    this.leavers.push({ g, t: 0, dx: spot.dx, dz: spot.dz, phase: 0 });
  }

  /** Colis sanglé derrière la selle pendant une livraison. */
  setCargo(on: boolean): void {
    if (on && !this.cargo) {
      this.cargo = this.parcel();
      this.cargo.position.set(0, 0.88, -0.72);
      this.vehicles.ZEM.add(this.cargo);
    } else if (!on && this.cargo) {
      this.cargo.removeFromParent();
      this.cargo = null;
    }
  }

  /** Un client arrive à pied vers le personnage (mission de travail), ou un colis attend à ses pieds ; false : rien. */
  setCustomer(on: boolean, parcel = false, key?: string): void {
    // Lavage : le client, c'est sa voiture ; celle qui vient d'être lavée repart et la suivante arrive
    if (this.work?.st.car && !parcel) {
      // Même client annoncé de nouveau (rafraîchissement de l'état) : sa voiture reste où elle est
      if (on && key !== undefined && key === this.washKey && this.wash.want) return;
      this.washKey = on ? key : undefined;
      if (this.wash.state === 'in' && this.washRoute) {
        // Aire fixe : servie pendant son arrivée, la voiture finit d'entrer par l'allée puis repart (sans couper l'aire)
        this.washLeave = true;
      } else if (this.wash.state === 'in' || this.wash.state === 'here') {
        this.wash.x = 0;
        this.wash.state = 'out';
      }
      this.wash.want = on;
      this.customer = on ? { g: this.work.st.car.g, phase: 0, car: true } : null;
      return;
    }
    if (this.customer) {
      const c = this.customer;
      if (this.work && !c.parcel) this.sendAway(c.g, c.seated === true);
      else this.scene.remove(c.g);
      this.customer = null;
    }
    if (!on) return;
    const p = this.player.position;
    if (parcel) {
      const g = this.parcel();
      g.position.set(p.x + Math.sin(this.yaw) * 1.8, 0, p.z + Math.cos(this.yaw) * 1.8);
      this.scene.add(g);
      this.customer = { g, phase: 0, parcel: true };
      return;
    }
    const g = buildPerson(this.mats, randomLook(rng(this.customerSeed++ * 7919)));
    // Il arrive de la rue, à une dizaine de mètres devant (du poste de travail s'il y en a un)
    const o = this.work ? { x: this.work.x, z: this.work.z, yaw: this.work.yaw } : { x: p.x, z: p.z, yaw: this.yaw };
    g.position.set(o.x + Math.sin(o.yaw) * 10 + Math.cos(o.yaw) * 3, 0, o.z + Math.cos(o.yaw) * 10 - Math.sin(o.yaw) * 3);
    this.scene.add(g);
    this.customer = { g, phase: 0 };
  }

  /** Le client servi (ou refusé) repart dans la rue, puis disparaît. */
  private sendAway(g: THREE.Group, seated: boolean): void {
    if (seated) {
      g.position.y = 0;
      animateWalk(g, 0, 0);
    }
    const w = this.work!;
    // Il s'éloigne de côté, loin de l'étal
    const dx = Math.cos(w.yaw) * (this.customerSeed % 2 ? 1 : -1) + Math.sin(w.yaw) * 0.6;
    const dz = -Math.sin(w.yaw) * (this.customerSeed % 2 ? 1 : -1) + Math.cos(w.yaw) * 0.6;
    this.leavers.push({ g, t: 0, dx, dz, phase: 0 });
  }

  /**
   * Installe (ou retire, avec null) le poste de travail illustré d'un métier à pied, devant le joueur :
   * étal, comptoir, fauteuil, voiture à laver… Le client vient s'y placer et on voit le geste du métier.
   */
  setWork(id: string | null): void {
    if (this.work?.id === id && id !== null) return;
    this.clearWork();
    if (id) this.mountWork(id);
  }

  /** Construit le poste devant le joueur, face à la direction où il regarde. */
  private mountWork(id: string): void {
    const st = buildStation(this.mats, id);
    if (st.car) this.dressWashCars(st);
    const p = this.player.position;
    st.group.position.set(p.x, 0, p.z);
    st.group.rotation.y = this.yaw;
    this.scene.add(st.group);
    if (st.hand) this.player.getObjectByName('armR')?.getObjectByName('forearm')?.add(st.hand);
    this.work = { id, st, x: p.x, z: p.z, yaw: this.yaw, idle: 0, last: p.clone(), act: null };
    this.wash = { state: 'gone', x: 0, want: false };
    this.washRoute = null;
    this.washLeave = false;
    // Lavage : un client annoncé avant l'installation du poste arrivait à pied ; c'est sa voiture qui doit venir
    const c = this.customer;
    if (st.car && c && !c.car && !c.parcel) {
      this.scene.remove(c.g);
      this.customer = null;
      this.setCustomer(true);
    }
  }

  /**
   * Lavage : les voitures de clients sont de vraies voitures (berline, citadine, SUV : même modèle que la circulation, vitres, phares,
   * jantes) au lieu de deux pavés ; chacune a sa peinture propre, qui change à chaque client. Elles arrivent de face (le long de x).
   */
  private dressWashCars(st: Station): void {
    const car = st.car;
    if (!car) return;
    car.g.clear();
    const models: { g: THREE.Group; paint: THREE.MeshLambertMaterial }[] = [];
    for (const kind of ['sedan', 'hatch', 'suv'] as const) {
      const g = this.buildCar(0xffffff, 4.2, { kind });
      const shared = g.userData.paint as THREE.Material | undefined;
      const paint = (shared ?? new THREE.MeshLambertMaterial({ color: 0xffffff })).clone() as THREE.MeshLambertMaterial;
      g.traverse((o) => {
        if (o instanceof THREE.Mesh && o.material === shared) o.material = paint;
      });
      st.own.push(paint);
      g.rotation.y = -Math.PI / 2; // l'avant regarde vers -x : la voiture arrive de la droite, s'arrête, repart
      g.visible = models.length === 0;
      car.g.add(g);
      models.push({ g, paint });
    }
    car.g.userData.models = models;
    car.paint = models[0]!.paint;
  }

  private unmountWork(): void {
    const w = this.work;
    if (!w) return;
    this.scene.remove(w.st.group);
    w.st.hand?.removeFromParent();
    w.st.geos.forEach((g) => g.dispose());
    w.st.own.forEach((m) => m.dispose());
    restArms(this.player);
    this.work = null;
  }

  private clearWork(): void {
    const w = this.work;
    if (!w) return;
    w.act?.done();
    this.unmountWork();
    // Le client en attente repart (la voiture du lavage disparaît avec le poste)
    if (this.customer?.car) this.customer = null;
    if (this.customer && !this.customer.parcel) {
      this.scene.remove(this.customer.g);
      this.customer = null;
    }
    for (const l of this.leavers) this.scene.remove(l.g);
    this.leavers = [];
  }

  /** Le geste du métier (servir, couper, laver…) : attend que le client soit là, joue l'animation, puis rend la main. */
  performWork(): Promise<void> {
    const w = this.work;
    if (!w) return Promise.resolve();
    return new Promise((done) => {
      w.act = { t: 0, dur: 1.5, wait: 0, done: () => ((w.act = null), done()) };
    });
  }

  /** Où le client se place, en coordonnées du monde. */
  private customerSpot(): { x: number; z: number; face: number; sit: boolean } {
    const w = this.work;
    if (!w) {
      const p = this.player.position;
      return { x: p.x + Math.sin(this.yaw) * 2.2, z: p.z + Math.cos(this.yaw) * 2.2, face: Math.atan2(-Math.sin(this.yaw), -Math.cos(this.yaw)), sit: false };
    }
    const { x, z, sit } = w.st.spot;
    const c = Math.cos(w.yaw);
    const s = Math.sin(w.yaw);
    // repère local (x à droite, z vers le client) -> monde
    return { x: w.x + x * c + z * s, z: w.z - x * s + z * c, face: sit ? w.yaw : Math.atan2(-s, -c), sit };
  }

  /** Animation du poste : client qui arrive, geste du joueur, clients qui repartent. */
  private updateWork(dt: number): void {
    const w = this.work;
    for (let i = this.leavers.length - 1; i >= 0; i--) {
      const l = this.leavers[i]!;
      l.t += dt;
      l.phase += dt * 9;
      l.g.position.x += l.dx * 2.2 * dt;
      l.g.position.z += l.dz * 2.2 * dt;
      l.g.rotation.y = Math.atan2(l.dx, l.dz);
      animateWalk(l.g, l.phase, 0.55);
      if (l.t > 4) {
        this.scene.remove(l.g);
        this.leavers.splice(i, 1);
      }
    }
    if (!w) return;
    if (w.st.car) this.updateWash(w.st.car, dt);
    const act = w.act;
    // Le joueur s'est déplacé puis arrêté ailleurs : le poste le suit (pas de poste laissé derrière lui)
    const here = this.player.position;
    w.idle = here.distanceToSquared(w.last) < 1e-4 ? w.idle + dt : 0;
    w.last.copy(here);
    if (!act && w.idle > 0.6 && Math.hypot(here.x - w.x, here.z - w.z) > 3) {
      const id = w.id;
      this.unmountWork();
      this.mountWork(id);
      return;
    }
    if (!act) return;
    const c = this.customer;
    // On attend que le client soit arrivé avant de commencer (2 s au plus ; 5 s pour une voiture qui manœuvre)
    if (act.t === 0 && c && !c.parcel && !c.arrived && act.wait < (c.car ? 5 : 1)) {
      act.wait += dt;
      return;
    }
    act.t += dt;
    const p = Math.min(1, act.t / act.dur);
    poseArms(this.player, w.st.motion, act.t, p);
    const goods = w.st.goods;
    if (goods) {
      goods.mesh.visible = p > 0.12 && p < 0.8;
      const k = Math.min(1, Math.max(0, (p - 0.12) / 0.4));
      goods.mesh.position.lerpVectors(goods.from, goods.to, k);
    }
    if (p >= 1) {
      if (goods) goods.mesh.visible = false;
      restArms(this.player);
      act.done();
    }
  }

  /** Voiture du lavage : arrivée en ralentissant, arrêt devant le joueur, départ ; nouvelle couleur à chaque client. */
  private updateWash(car: NonNullable<Station['car']>, dt: number): void {
    const s = this.wash;
    if (this.updateWashRoute(car, dt)) return;
    if (s.state === 'out') {
      s.x -= 8 * dt;
      if (s.x < -16) s.state = 'gone';
    } else if (s.state === 'gone' && s.want) {
      // Un nouveau client : autre modèle (berline, citadine ou SUV) et autre couleur
      const models = car.g.userData.models as { g: THREE.Group; paint: THREE.MeshLambertMaterial }[] | undefined;
      const seed = this.customerSeed++;
      if (models?.length) {
        const k = seed % models.length;
        models.forEach((m, i) => (m.g.visible = i === k));
        car.paint = models[k]!.paint;
      }
      car.paint.color.setHex(WASH_PAINTS[seed % WASH_PAINTS.length]!);
      s.x = 16;
      s.state = 'in';
    } else if (s.state === 'in') {
      s.x -= Math.max(1.2, Math.min(9, s.x * 1.6)) * dt;
      if (s.x <= 0) {
        s.x = 0;
        s.state = 'here';
        if (this.customer?.car) this.customer.arrived = true;
      }
    }
    car.g.visible = s.state !== 'gone';
    car.g.position.x = s.x;
  }

  /**
   * Aire de lavage fixe (lavage_auto) : les voitures suivent un vrai trajet, toujours en marche avant. Arrivée par la voie
   * d'accès depuis l'avenue, virage dans la baie, arrêt devant le laveur ; départ par le fond de l'aire, tour par l'est
   * sur l'herbe libre, puis retour sur la voie d'accès jusqu'à l'avenue. Faux si le poste n'est pas à cette aire.
   */
  private updateWashRoute(car: NonNullable<Station['car']>, dt: number): boolean {
    const w = this.work;
    const v = this.opts.venues.find((x) => x.id === 'lavage_auto');
    if (!w || !v || Math.hypot(w.x - (v.x + 2.1), w.z - (v.z - 0.6)) > 3) return false;
    if (!this.washRoute) {
      // Point d'arrêt : là où le poste attend la voiture (2,7 m devant le laveur)
      const stop = w.st.group.localToWorld(new THREE.Vector3(0, 0, 2.7));
      const S: [number, number] = [stop.x, stop.z];
      // Bout de la voie d'accès (au nord-est de l'aire) et allée vers l'entrée nord de la baie
      const T: [number, number] = [v.x + 10, v.z - 11];
      const N: [number, number] = [S[0], v.z - 9.5];
      const road = this.access().find(([, b]) => Math.hypot(b[0] - T[0], b[1] - T[1]) < 1.5);
      const far: [number, number] = road ? [road[0][0], road[0][1]] : [T[0] + 30, T[1]];
      // La voiture apparaît (et disparaît) sur la voie, à 30 m du bout au plus
      const l = Math.hypot(far[0] - T[0], far[1] - T[1]) || 1;
      const A: [number, number] = [T[0] + ((far[0] - T[0]) * Math.min(l, 30)) / l, T[1] + ((far[1] - T[1]) * Math.min(l, 30)) / l];
      // Entrée par le nord, arrêt devant le laveur ; sortie par le sud, demi-tour par la bande d'herbe libre à l'est, retour à la voie
      this.washRoute = {
        inP: [A, T, N, [S[0], v.z - 6], S],
        outP: [S, [S[0], v.z + 8.5], [v.x + 7.5, v.z + 8.5], [v.x + 7.5, v.z - 9.5], T, A],
      };
    }
    const route = this.washRoute;
    const s = this.wash;
    const along = (path: [number, number][], d: number): { x: number; z: number; h: number; end: boolean; left: number } => {
      let rest = d;
      let total = 0;
      for (let i = 0; i < path.length - 1; i++) total += Math.hypot(path[i + 1]![0] - path[i]![0], path[i + 1]![1] - path[i]![1]);
      for (let i = 0; i < path.length - 1; i++) {
        const [ax, az] = path[i]!;
        const [bx, bz] = path[i + 1]!;
        const l = Math.hypot(bx - ax, bz - az);
        if (rest <= l || i === path.length - 2) {
          const t = l > 0 ? Math.min(1, rest / l) : 1;
          return { x: ax + (bx - ax) * t, z: az + (bz - az) * t, h: Math.atan2(bx - ax, bz - az), end: rest >= l && i === path.length - 2, left: Math.max(0, total - d) };
        }
        rest -= l;
      }
      return { x: path[0]![0], z: path[0]![1], h: 0, end: true, left: 0 };
    };
    if (s.state === 'gone' && s.want) {
      const models = car.g.userData.models as { g: THREE.Group; paint: THREE.MeshLambertMaterial }[] | undefined;
      const seed = this.customerSeed++;
      if (models?.length) {
        const k = seed % models.length;
        models.forEach((m, i) => (m.g.visible = i === k));
        car.paint = models[k]!.paint;
      }
      car.paint.color.setHex(WASH_PAINTS[seed % WASH_PAINTS.length]!);
      s.x = 0;
      s.state = 'in';
      this.washLeave = false;
    }
    let pos: { x: number; z: number; h: number; end: boolean; left: number } | null = null;
    if (s.state === 'in') {
      const cur = along(route.inP, s.x);
      // Roule à 9 m/s, ralentit sur les 8 derniers mètres
      s.x += Math.max(1.2, Math.min(9, cur.left * 1.2)) * dt;
      pos = along(route.inP, s.x);
      if (pos.end) {
        s.state = this.washLeave ? 'out' : 'here';
        this.washLeave = false;
        s.x = 0;
        if (this.customer?.car) this.customer.arrived = true;
      }
    } else if (s.state === 'here') {
      pos = along(route.inP, 1e9);
    } else if (s.state === 'out') {
      s.x += Math.min(8, 2 + s.x * 0.8) * dt; // démarre doucement
      pos = along(route.outP, s.x);
      if (pos.end) s.state = 'gone';
    }
    car.g.visible = s.state !== 'gone';
    if (pos) {
      const local = w.st.group.worldToLocal(new THREE.Vector3(pos.x, 0, pos.z));
      car.g.position.set(local.x, 0, local.z);
      // Le modèle regarde vers −x de son groupe : on l'oriente dans le sens de la marche, en tournant progressivement
      const target = pos.h + Math.PI / 2 - w.yaw;
      const cur = car.g.rotation.y;
      const diff = Math.atan2(Math.sin(target - cur), Math.cos(target - cur));
      car.g.rotation.y = s.state === 'here' || Math.abs(diff) > 2.5 ? target : cur + diff * Math.min(1, dt * 6);
    }
    return true;
  }

  /** Joystick tactile : x = tourner, y = avancer (−1..1). */
  setMove(x: number, y: number): void {
    this.joy = { x: THREE.MathUtils.clamp(x, -1, 1), y: THREE.MathUtils.clamp(y, -1, 1) };
  }

  // ---------- construction ----------

  private geo<T extends THREE.BufferGeometry>(g: T): T {
    this.geos.push(g);
    return g;
  }

  /** Bleus de vitrage des bâtiments : ces pièces s'éclairent la nuit (sauf coupure d'électricité). */
  private static readonly GLASS_HEX = new Set([0x9fc9e8, 0x9cc3dc, 0x7fb6e8, 0xb9d7ec, 0x8fb4c8, 0x6ec3f0, 0x5fb4e6, 0x4a91b8, 0x3fa7d6]);
  private readonly glowCache = new Map<number, THREE.MeshLambertMaterial>();
  private glowGlass(color: number): THREE.MeshLambertMaterial {
    let m = this.glowCache.get(color);
    if (!m) {
      m = new THREE.MeshLambertMaterial({ color, emissive: 0xffd27a, emissiveIntensity: 0 });
      this.nightMaterials.push(m);
      this.nightScale.set(m, 0.28);
      this.glowCache.set(color, m);
    }
    return m;
  }

  /** Vitrage de façade partagé : s'allume la nuit comme les fenêtres. */
  /** Toits d'abris ouverts masqués quand le joueur est dessous (aire de lavage). */
  private seeThroughRoofs: { parts: THREE.Object3D[]; x0: number; x1: number; z0: number; z1: number }[] = [];

  private litGlass(): THREE.Material {
    return this.glowGlass(0x38566f);
  }

  /**
   * Fenêtres éclairées la nuit sur une façade (tour, immeuble) : petites vitres chaudes sur un mur sombre, certaines
   * éteintes au hasard (comme des bureaux ou chambres vides). `face` : +1 façade côté sud (z+), -1 côté nord.
   */
  private litGrid(cx: number, faceZ: number, face: 1 | -1, cols: number, rows: number, colStep: number, y0: number, rowStep: number, w = 0.6, h = 0.85, power = 0.55): void {
    const mat = new THREE.MeshLambertMaterial({ color: 0x2b3f52, emissive: 0xffd27a, emissiveIntensity: 0 });
    this.nightMaterials.push(mat);
    this.nightScale.set(mat, power);
    const panes = this.instanced(new THREE.BoxGeometry(w, h, 0.08), mat, cols * rows, false);
    let k = 0;
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        // Hasard stable (pas de Math.random : la façade ne change pas d'un chargement à l'autre)
        const lit = ((c * 7 + r * 13 + Math.imul(c + 3, r + 5)) % 10) < 7;
        this.setInstance(panes, k++, cx + (c - (cols - 1) / 2) * colStep, y0 + r * rowStep, faceZ + face * 0.04, lit ? 1 : 0, lit ? 1 : 0, lit ? 1 : 0);
      }
    }
  }

  /** Lieux qui dessinent déjà leurs propres fenêtres éclairées : pas de fenêtres automatiques par-dessus. */
  private static readonly OWN_WINDOWS = new Set(['hotel_2fevrier', 'cnss', 'eza_zozo', 'hopital_dogta', 'studio_ori_infos', 'capture_media', 'cfe', 'ccit', 'station_oryx', 'station_total', 'station_lome2', 'station_boulevard', 'station_zem', 'bank_ecobank_2']);
  /** Sièges aux façades très vitrées : fenêtres automatiques plus discrètes la nuit. */
  private static readonly DIM_WINDOWS = new Set(['port', 'boad', 'bank_boa_1', 'bank_boa_2', 'moov_africa']);
  private dimWinMat: THREE.MeshLambertMaterial | null = null;
  private autoWinMat: THREE.MeshLambertMaterial | null = null;

  /**
   * Fenêtres automatiques d'un bâtiment de lieu : sur chaque grand volume (pavé posé droit) créé par le modèle,
   * une grille de petites vitres sombres le jour, chaudes la nuit (certaines éteintes), à partir du premier étage
   * (le rez-de-chaussée garde ses portes, vitrines et enseignes). Éteintes pendant une coupure d'électricité.
   */
  private autoWindows(venueId: string, before: number): void {
    if (World.OWN_WINDOWS.has(venueId)) return;
    if (!this.autoWinMat) {
      this.autoWinMat = new THREE.MeshLambertMaterial({ color: 0x2b3f52, emissive: 0xffd27a, emissiveIntensity: 0 });
      this.nightMaterials.push(this.autoWinMat);
      this.nightScale.set(this.autoWinMat, 0.55);
    }
    if (!this.dimWinMat) {
      this.dimWinMat = new THREE.MeshLambertMaterial({ color: 0x2b3f52, emissive: 0xffd27a, emissiveIntensity: 0 });
      this.nightMaterials.push(this.dimWinMat);
      this.nightScale.set(this.dimWinMat, 0.2);
    }
    const winMat = World.DIM_WINDOWS.has(venueId) ? this.dimWinMat : this.autoWinMat;
    const front: THREE.Matrix4[] = [];
    const side: THREE.Matrix4[] = [];
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    for (const o of this.scene.children.slice(before)) {
      if (!(o instanceof THREE.Mesh) || (o as unknown as THREE.InstancedMesh).isInstancedMesh) continue;
      const g = o.geometry as THREE.BoxGeometry;
      if (g.type !== 'BoxGeometry' || o.rotation.y !== 0 || o.rotation.x !== 0 || o.rotation.z !== 0) continue;
      const { width: w, height: h, depth: d } = g.parameters;
      if (w < 4.5 || d < 3.5 || h < 5) continue;
      // Volumes vitrés ou colorés en bleu clair : déjà des vitres, rien à ajouter
      const mat = o.material as THREE.MeshLambertMaterial;
      if (mat.color) {
        col.copy(mat.color);
        if (col.b > col.r + 0.08 && col.b >= col.g && col.getHSL({ h: 0, s: 0, l: 0 }).l > 0.45) continue;
      }
      const cx = o.position.x;
      const cz = o.position.z;
      const base = o.position.y - h / 2;
      const top = o.position.y + h / 2;
      const place = (list: THREE.Matrix4[], x: number, y: number, z: number, hash: number) => {
        // ~30 % éteintes (stable d'un chargement à l'autre)
        if (hash % 10 >= 7) return;
        list.push(m4.clone().makeTranslation(x, y, z));
      };
      const colsF = Math.max(1, Math.min(9, Math.floor((w - 1.4) / 2.4)));
      const colsS = Math.max(1, Math.min(7, Math.floor((d - 1.4) / 2.4)));
      let r = 0;
      for (let y = base + 3.4; y + 0.8 < top; y += 3, r++) {
        for (let c = 0; c < colsF; c++) {
          const px = cx + (c - (colsF - 1) / 2) * ((w - 1.4) / colsF);
          const hk = Math.abs(Math.imul(Math.round(cx * 7 + c * 31), 31) + Math.imul(Math.round(y * 5 + cz), 17) + r * 13);
          place(front, px, y, cz + d / 2 + 0.04, hk);
          place(front, px, y, cz - d / 2 - 0.04, hk + 3);
        }
        for (let c = 0; c < colsS; c++) {
          const pz = cz + (c - (colsS - 1) / 2) * ((d - 1.4) / colsS);
          const hk = Math.abs(Math.imul(Math.round(cz * 7 + c * 29), 37) + Math.imul(Math.round(y * 5 + cx), 19) + r * 11);
          place(side, cx + w / 2 + 0.04, y, pz, hk);
          place(side, cx - w / 2 - 0.04, y, pz, hk + 5);
        }
      }
    }
    for (const [list, geo] of [[front, new THREE.BoxGeometry(0.85, 1.15, 0.08)], [side, new THREE.BoxGeometry(0.08, 1.15, 0.85)]] as const) {
      if (!list.length) continue;
      const im = this.instanced(geo, winMat, list.length, false);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.instanceMatrix.needsUpdate = true;
    }
  }

  /**
   * Siège d'un média : socle vitré éclairé, bandeau d'enseigne (logo), ruban de fenêtres éclairées la nuit, auvent,
   * jardinières, toit technique. `onAir` : voyant rouge « à l'antenne » ; `lens` : gros objectif de caméra en façade.
   */
  private mediaHq(x: number, z: number, o: { main: number; accent: number; dark: number; logo: 'ori' | 'capture'; onAir?: boolean; lens?: boolean }): void {
    const { main, accent, dark } = o;
    const steel = 0xc8ccd2;
    this.box(22, 0.12, 16, 0xcfd0d6, x, 0.06, z - 1, false);
    // Corps de 9 m, sans mur aveugle : socle sombre, étage principal, attique
    this.box(15, 9, 8, main, x, 4.5, z - 3.5);
    this.solid(x, z - 3.5, 15, 8);
    this.box(15.6, 0.5, 8.6, accent, x, 9.25, z - 3.5, false);
    this.box(15.2, 0.9, 8.2, dark, x, 9.95, z - 3.5);
    // Pilastres d'angle de la couleur d'accent
    for (const dx of [-7.7, 7.7]) this.box(0.7, 9.2, 0.7, accent, x + dx, 4.6, z + 0.5, false);
    // Rez-de-chaussée vitré : vitrine éclairée, meneaux sombres, porte centrale
    const g = this.litGlass();
    const front = z + 0.54;
    const shop = new THREE.Mesh(this.geo(new THREE.BoxGeometry(12.6, 2.9, 0.1)), g);
    shop.position.set(x, 1.6, front);
    this.scene.add(shop);
    for (let i = 0; i <= 6; i++) this.box(0.1, 3, 0.16, dark, x - 6.3 + i * 2.1, 1.6, front + 0.04, false);
    this.box(12.8, 0.14, 0.18, dark, x, 3.1, front + 0.04, false);
    this.box(2.3, 2.9, 0.18, dark, x, 1.5, front + 0.08, false);
    // Auvent d'entrée sur deux poteaux, tapis et perron
    this.box(5.2, 0.22, 2.4, accent, x, 3.4, z + 1.7, false);
    for (const dx of [-2.4, 2.4]) this.box(0.14, 3.3, 0.14, steel, x + dx, 1.65, z + 2.7, false);
    this.box(6, 0.05, 3.4, 0xd9d2c3, x, 0.16, z + 2.2, false);
    // Bandeau d'enseigne (logo de la marque), au-dessus de la vitrine
    const sign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(10.4, 2.6)), new THREE.MeshBasicMaterial({ map: this.logoTexture(o.logo) }));
    sign.position.set(x, 5.1, z + 0.62);
    this.scene.add(sign);
    this.nightMaterials.push(sign.material as unknown as THREE.MeshLambertMaterial);
    // Ruban de fenêtres sous l'attique, éclairées la nuit
    this.litGrid(x, z + 0.5, 1, 6, 1, 2.2, 7.7, 3, 1.5, 1.3);
    this.litGrid(x + 7.5, z - 3.5, 1, 1, 2, 1, 4.2, 3.2, 0.1, 1.4);
    // Fenêtres des côtés
    for (const sx of [-1, 1]) this.litGridSide(x + sx * 7.5, z - 3.5, sx as 1 | -1, 3, 2, 2.3, 4.6, 3.2);
    // Toit : unités de climatisation, mât et antenne parabolique
    for (const dx of [-4, -1.5, 3.6]) this.box(1.8, 0.9, 1.2, 0xaab0b8, x + dx, 10.9, z - 4.5, false);
    this.box(0.14, 5, 0.14, 0x555b66, x + 5.5, 12.4, z - 5.5, false);
    const dish = new THREE.Mesh(this.geo(new THREE.SphereGeometry(1.1, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2)), this.mats.color(0xf4f4f1));
    dish.position.set(x - 5.4, 11.3, z - 5);
    dish.rotation.x = -Math.PI / 3;
    this.scene.add(dish);
    if (o.onAir) {
      // Voyant « à l'antenne » : rouge, il reste allumé la nuit
      const lamp = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.7, 0.55, 0.2)), new THREE.MeshLambertMaterial({ color: 0x8a1c1f, emissive: 0xff2b2f, emissiveIntensity: 0.9 }));
      lamp.position.set(x + 5.7, 3.7, z + 0.7);
      this.scene.add(lamp);
    }
    if (o.lens) {
      // Gros objectif de caméra sur la façade : tube noir, bague jaune, lentille bleutée
      const barrel = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(1.15, 1.25, 0.9, 20)), this.mats.color(0x15171a));
      barrel.rotation.x = Math.PI / 2;
      barrel.position.set(x - 5.6, 7.7, z + 0.95);
      this.scene.add(barrel);
      const ring = new THREE.Mesh(this.geo(new THREE.TorusGeometry(1.0, 0.12, 8, 20)), this.mats.color(accent));
      ring.position.set(x - 5.6, 7.7, z + 1.42);
      this.scene.add(ring);
      const lensGlass = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.82, 20)), new THREE.MeshLambertMaterial({ color: 0x1f4e7a, emissive: 0x3d8bd8, emissiveIntensity: 0.25 }));
      lensGlass.position.set(x - 5.6, 7.7, z + 1.44);
      this.scene.add(lensGlass);
    }
    // Jardinières, banc, arbre et lampadaire sur le parvis
    for (const dx of [-5.8, 5.8]) {
      this.box(2, 0.6, 0.8, 0xb9b3a8, x + dx, 0.3, z + 1.7);
      const shrub = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.8, 8, 6)), this.mats.color(0x3f8f4a));
      shrub.position.set(x + dx, 0.95, z + 1.7);
      this.scene.add(shrub);
    }
    this.box(2.2, 0.12, 0.6, 0x7a5a3a, x - 3.8, 0.5, z + 3.6, false);
    this.tree(x + 9.2, z + 2.8);
    this.tree(x - 9.2, z + 2.8);
  }

  /** Fenêtres éclairées sur une façade latérale (axe x) : `face` +1 côté est, -1 côté ouest. */
  private litGridSide(faceX: number, cz: number, face: 1 | -1, cols: number, rows: number, colStep: number, y0: number, rowStep: number): void {
    const mat = new THREE.MeshLambertMaterial({ color: 0x2b3f52, emissive: 0xffd27a, emissiveIntensity: 0 });
    this.nightMaterials.push(mat);
    this.nightScale.set(mat, 0.55);
    const panes = this.instanced(new THREE.BoxGeometry(0.08, 1.2, 1.2), mat, cols * rows, false);
    let k = 0;
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) this.setInstance(panes, k++, faceX + face * 0.04, y0 + r * rowStep, cz + (c - (cols - 1) / 2) * colStep);
  }

  /**
   * Clôture d'enceinte (muret bas, grille noire, piliers de portail) sur le rectangle donné ; `gates` : ouvertures
   * sur la façade sud (z1), centre et largeur. Même style que l'enceinte de la CNSS.
   */
  private fenceRect(x0: number, x1: number, z0: number, z1: number, gates: { x: number; w: number }[]): void {
    const seg = (px: number, pz: number, len: number, alongX: boolean) => {
      if (len <= 0.1) return;
      // Infranchissable pour les piétons et les véhicules (seuls les portails restent ouverts)
      this.solid(px, pz, alongX ? len : 0.7, alongX ? 0.7 : len, 2.2);
      this.box(alongX ? len : 0.45, 0.7, alongX ? 0.45 : len, 0xd9d3c4, px, 0.35, pz, false);
      this.box(alongX ? len : 0.08, 0.1, alongX ? 0.08 : len, 0x20252b, px, 2.1, pz, false);
      const n = Math.max(1, Math.floor(len / 1.4));
      for (let k = 0; k <= n; k++) {
        const o = -len / 2 + (k * len) / n;
        this.box(0.07, 1.4, 0.07, 0x20252b, alongX ? px + o : px, 1.4, alongX ? pz : pz + o, false);
      }
    };
    seg((x0 + x1) / 2, z0, x1 - x0, true);
    seg(x0, (z0 + z1) / 2, z1 - z0, false);
    seg(x1, (z0 + z1) / 2, z1 - z0, false);
    // Façade : tronçons entre les portails
    const sorted = [...gates].sort((a, b) => a.x - b.x);
    let cur = x0;
    for (const g of sorted) {
      seg((cur + (g.x - g.w / 2)) / 2, z1, g.x - g.w / 2 - cur, true);
      for (const sx of [-1, 1]) this.box(0.8, 3, 0.8, 0xd9d3c4, g.x + (sx * g.w) / 2, 1.5, z1, false);
      cur = g.x + g.w / 2;
    }
    seg((cur + x1) / 2, z1, x1 - cur, true);
  }

  /** Coupure d'électricité dans la zone : fenêtres, enseignes et lampadaires restent éteints la nuit. */
  setPowerCut(on: boolean): void {
    if (this.powerCut === on) return;
    this.powerCut = on;
    this.applyNight();
  }

  private box(w: number, h: number, d: number, color: number, x: number, y: number, z: number, cast = true): THREE.Mesh {
    const m = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, h, d)), World.GLASS_HEX.has(color) ? this.glowGlass(color) : this.mats.color(color));
    m.position.set(x, y, z);
    m.castShadow = cast && this.profile.shadows;
    m.receiveShadow = this.profile.shadows;
    this.scene.add(m);
    return m;
  }

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material, count: number, cast = true): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(this.geo(geo), mat, Math.max(1, count));
    m.castShadow = cast && this.profile.shadows;
    m.receiveShadow = this.profile.shadows;
    this.scene.add(m);
    return m;
  }

  private setInstance(m: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rotY = 0): void {
    const t = this.tmp;
    t.q.setFromAxisAngle(this.up, rotY);
    t.m.compose(t.v.set(x, y, z), t.q, t.s.set(sx, sy, sz));
    m.setMatrixAt(i, t.m);
  }

  /** Déclare un volume infranchissable (centre, largeur x, profondeur z). */
  /**
   * Fluidité : les milliers de petits éléments de décor immobiles (murs, dalles, poteaux, tribunes…) sont
   * regroupés en un maillage par matériau (et par lieu, pour que le toucher d'un bâtiment marche encore).
   * Les éléments animés ou cliquables restent à part.
   */
  private readonly mergeParents: THREE.Object3D[] = [];
  /** Matériaux « blancs » à couleur par sommet créés par la fusion : à libérer avec la ville. */
  private readonly mergedMats: THREE.Material[] = [];

  /**
   * Un sous-groupe est « de décor » s'il ne contient aucun élément nommé (membres des personnages, pièces animées
   * retrouvées par leur nom), aucune lumière, aucun maillage skinné ni objet déjà déclaré dynamique.
   */
  private isStaticGroup(g: THREE.Object3D, dynamic: Set<THREE.Object3D>): boolean {
    let ok = true;
    g.traverse((o) => {
      if (!ok) return;
      if (o !== g && (o.name !== '' || dynamic.has(o))) ok = false;
      else if ((o as THREE.Light).isLight || (o as THREE.SkinnedMesh).isSkinnedMesh) ok = false;
    });
    return ok && g.name === '';
  }

  private mergeStatic(): void {
    const dynamic = new Set<THREE.Object3D>([...this.radars, ...(this.berth?.yard ?? [])]);
    for (const c of this.cranes) [c.trolley, c.cable, c.spreader, c.load].forEach((o) => dynamic.add(o));
    for (const l of this.lights) [l.red, l.amber, l.green].forEach((o) => dynamic.add(o));
    // Pièces que la boucle d'animation déplace une à une (losanges et anneaux VIP, vagues, charges de tracteurs, piles du quai)
    for (const v of this.vipAnim) [v.gem, v.beam, v.ring].forEach((o) => dynamic.add(o));
    for (const b of this.beachWaves) dynamic.add(b.mesh);
    for (const t of this.tractors) dynamic.add(t.load);
    for (const o of this.berth?.stack ?? []) o.traverse((c) => dynamic.add(c));
    const groups = new Map<string, THREE.Mesh[]>();
    // La scène et les ensembles construits dans leur propre repère (aéroport) ; chaque fusion reste dans son parent.
    // Les sous-groupes de décor immobile (préaux, pylônes, étals, mobilier…) sont fusionnés eux aussi, chacun dans son repère.
    const containers: THREE.Object3D[] = [this.scene, ...this.mergeParents];
    const seen = new Set<THREE.Object3D>(containers);
    const collect = (p: THREE.Object3D): void => {
      for (const c of p.children) {
        if (!(c instanceof THREE.Group) || seen.has(c) || !this.isStaticGroup(c, dynamic)) continue;
        seen.add(c);
        containers.push(c);
        collect(c);
      }
    };
    for (const root of [...containers]) collect(root);
    const candidates: THREE.Mesh[] = [];
    for (const o of containers.flatMap((p) => p.children)) {
      if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || dynamic.has(o) || !o.visible || Array.isArray(o.material)) continue;
      if (Object.keys(o.userData).some((k) => k !== 'venueId')) continue;
      if (!o.geometry.getAttribute('position') || !o.geometry.getAttribute('normal')) continue;
      candidates.push(o);
    }
    // Matériaux touchés à l'exécution (nuit, feux, écrans, eau) ou portés par un objet non fusionné : jamais regroupés
    const chosen = new Set<THREE.Object3D>(candidates);
    const shielded = new Set<THREE.Material>([...this.nightMaterials, ...this.signalMats]);
    this.scene.traverse((o) => {
      if (!(o instanceof THREE.Mesh) || chosen.has(o)) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) shielded.add(m);
    });
    // Couleur unie, opaque, sans texture ni lueur : la couleur passe dans les sommets et un seul matériau « blanc »
    // sert toutes les couleurs d'une même famille (type, face, relief) ; le rendu est identique, en un seul dessin.
    const tinted = new Map<string, THREE.Material>();
    const lookOf = (m: THREE.Material): { mat: THREE.Material; tint: THREE.Color | null } => {
      const keep = { mat: m, tint: null };
      if (shielded.has(m) || !(m instanceof THREE.MeshLambertMaterial || m instanceof THREE.MeshBasicMaterial || m instanceof THREE.MeshStandardMaterial)) return keep;
      if (m.transparent || m.opacity !== 1 || m.map || m.alphaMap || m.envMap || m.wireframe || m.alphaTest > 0 || m.vertexColors) return keep;
      const lit = m as THREE.MeshLambertMaterial;
      if ('emissive' in lit && (lit.emissive.getHex() !== 0 || lit.emissiveMap)) return keep;
      const st = m as THREE.MeshStandardMaterial;
      if (st.normalMap || st.roughnessMap || st.metalnessMap || st.aoMap || st.bumpMap) return keep;
      const sig = [m.type, m.side, lit.flatShading, m.depthWrite, m.depthTest, m.toneMapped, m.fog, m.polygonOffset, m.colorWrite, st.roughness, st.metalness].join('|');
      let rep = tinted.get(sig);
      if (!rep) {
        rep = m.clone();
        (rep as THREE.MeshLambertMaterial).color.setRGB(1, 1, 1);
        rep.vertexColors = true;
        tinted.set(sig, rep);
        this.mergedMats.push(rep);
      }
      return { mat: rep, tint: m.color };
    };
    for (const o of candidates) {
      // Tous les lieux fusionnés ensemble par matériau ; les pièces d'origine restent, invisibles, pour le toucher
      const key = `${o.parent!.uuid}|${lookOf(o.material as THREE.Material).mat.uuid}|${o.castShadow ? 1 : 0}|${o.receiveShadow ? 1 : 0}|${o.renderOrder}`;
      const list = groups.get(key);
      if (list) list.push(o);
      else groups.set(key, [o]);
    }
    for (const list of groups.values()) {
      if (list.length < 2) continue;
      const parent = list[0]!.parent!;
      const look = lookOf(list[0]!.material as THREE.Material);
      // Si l'une des pièces n'a pas d'index, toutes passent en « sans index » pour pouvoir se fondre dans un seul tampon
      const flat = list.some((m) => !m.geometry.index);
      const geos = list.map((m) => {
        m.updateMatrix();
        // Copie (la géométrie d'origine est partagée par d'autres objets), réduite aux attributs communs ; repère du parent
        const geo = flat && m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
        for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv'].includes(k)) geo.deleteAttribute(k);
        const n = geo.getAttribute('position').count;
        if (!geo.getAttribute('uv')) geo.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
        if (look.tint) {
          const c = (lookOf(m.material as THREE.Material).tint ?? look.tint) as THREE.Color;
          const col = new Float32Array(n * 3);
          for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
          geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
        }
        return geo.applyMatrix4(m.matrix);
      });
      const merged = mergeGeometries(geos, false);
      geos.forEach((geo) => geo.dispose());
      if (!merged) continue;
      const first = list[0]!;
      const mesh = new THREE.Mesh(merged, look.mat);
      mesh.castShadow = first.castShadow;
      mesh.receiveShadow = first.receiveShadow;
      mesh.renderOrder = first.renderOrder;
      this.geos.push(merged);
      for (const m of list) {
        // Pièce d'un lieu : gardée invisible (le rayon de sélection la touche encore), sinon retirée
        if (m.userData.venueId) m.visible = false;
        else parent.remove(m);
      }
      parent.add(mesh);
    }
  }

  /** Dalles de lieu que `trimSlabs` n'a pas pu rogner (repère de mise au point : id du lieu et emprise). */
  readonly slabConflicts: string[] = [];

  /**
   * Dalles et parvis (boîtes plates au ras du sol) d'un lieu qui recouvrent la chaussée : elles sont rognées du côté de la
   * route, du plus petit écart qui les dégage (la chaussée s'est élargie, ces dalles avaient été dessinées pour l'ancienne).
   * Le rognage se fait dans le repère propre de chaque dalle, donc quelle que soit son orientation dans la ville.
   */
  private trimSlabs(before: number, venueId: string): void {
    const box = new THREE.Box3();
    const pt = new THREE.Vector3();
    for (const root of this.scene.children.slice(before)) {
      root.updateMatrixWorld(true);
      root.traverse((m) => {
        if (!(m instanceof THREE.Mesh) || (m as unknown as THREE.InstancedMesh).isInstancedMesh) return;
        const kind = m.geometry.type;
        if (kind !== 'BoxGeometry' && kind !== 'CircleGeometry' && kind !== 'CylinderGeometry') return;
        box.setFromObject(m);
        if (box.max.y > 0.5 || box.min.y < -0.5) return;
        if (kind !== 'BoxGeometry') {
          // Esplanade ronde ou ovale : réduite (jusqu'à 70 %) autour de son centre tant qu'elle touche la chaussée. Les ronds-points,
          // échangeurs et monuments, dont les disques bordent volontairement la route, ne sont pas touchés.
          if (/^(carrefour_|echangeur_|colombe_paix|monument|aeroport|port|plage_)/.test(venueId)) return;
          const geo = m.geometry as THREE.CircleGeometry | THREE.CylinderGeometry;
          const radius = kind === 'CircleGeometry' ? (geo as THREE.CircleGeometry).parameters.radius : (geo as THREE.CylinderGeometry).parameters.radiusTop;
          const [ax, bx] = kind === 'CircleGeometry' ? (['x', 'y'] as const) : (['x', 'z'] as const);
          const discArea = (box.max.x - box.min.x) * (box.max.z - box.min.z);
          if (discArea < 4 || discArea > 1500) return;
          if (!this.onRoad((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2, Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + 0.2)) return;
          const rim = (k: number): boolean => {
            m.scale[ax] = base[0]! * k;
            m.scale[bx] = base[1]! * k;
            m.updateWorldMatrix(true, false);
            for (let i = 0; i < 48; i++) {
              const a = (i / 48) * Math.PI * 2;
              if (kind === 'CircleGeometry') pt.set(radius * Math.cos(a), radius * Math.sin(a), 0);
              else pt.set(radius * Math.cos(a), 0, radius * Math.sin(a));
              pt.applyMatrix4(m.matrixWorld);
              if (this.onRoad(pt.x, pt.z, 0.1)) return true;
            }
            return false;
          };
          const base: [number, number] = [m.scale[ax], m.scale[bx]];
          if (!rim(1)) {
            m.scale[ax] = base[0];
            m.scale[bx] = base[1];
            return;
          }
          for (let k = 0.96; k >= 0.7; k -= 0.04) if (!rim(k)) return;
          m.scale[ax] = base[0];
          m.scale[bx] = base[1];
          m.updateWorldMatrix(true, false);
          this.slabConflicts.push(`${venueId} (disque) ${box.min.x.toFixed(1)},${box.max.x.toFixed(1)},${box.min.z.toFixed(1)},${box.max.z.toFixed(1)}`);
          return;
        }
        const worldArea = (box.max.x - box.min.x) * (box.max.z - box.min.z);
        // Trop petite pour se voir, ou immense (aéroport, port : dalles pensées avec leurs routes propres)
        if (worldArea < 4 || worldArea > 1500) return;
        // Prétest : si même le disque circonscrit reste loin de toute route, rien à faire
        if (!this.onRoad((box.min.x + box.max.x) / 2, (box.min.z + box.max.z) / 2, Math.hypot(box.max.x - box.min.x, box.max.z - box.min.z) / 2 + 0.2)) return;
        m.geometry.computeBoundingBox();
        const gb = m.geometry.boundingBox!;
        const ly = (gb.min.y + gb.max.y) / 2;
        const hits = (x0: number, x1: number, z0: number, z1: number): boolean => {
          const nx = Math.min(60, Math.max(1, Math.ceil((x1 - x0) / 0.5)));
          const nz = Math.min(60, Math.max(1, Math.ceil((z1 - z0) / 0.5)));
          for (let i = 0; i <= nx; i++) {
            for (let j = 0; j <= nz; j++) {
              // Le bord suffit (une route qui coupe une dalle la traverse de bord à bord) ; l'intérieur est vu tous les 2 m
              if (i !== 0 && i !== nx && j !== 0 && j !== nz && (i % 4 !== 0 || j % 4 !== 0)) continue;
              pt.set(x0 + ((x1 - x0) * i) / nx, ly, z0 + ((z1 - z0) * j) / nz).applyMatrix4(m.matrixWorld);
              if (this.onRoad(pt.x, pt.z, 0.1)) return true;
            }
          }
          return false;
        };
        const x0 = gb.min.x;
        const x1 = gb.max.x;
        const z0 = gb.min.z;
        const z1 = gb.max.z;
        if (!hits(x0, x1, z0, z1)) return;
        // Rognages d'un ou deux côtés, essayés du plus petit au plus grand : le premier qui libère la chaussée est retenu
        const cands: [number, number, number, number, number][] = [];
        const area = (x1 - x0) * (z1 - z0);
        for (let a = 0; a <= 6.01; a += 0.5) {
          for (let b = 0; b <= 6.01; b += 0.5) {
            for (let c = 0; c <= 6.01; c += 0.5) {
              for (let d = 0; d <= 6.01; d += 0.5) {
                if ([a, b, c, d].filter((v) => v > 0).length > 2) continue;
                const w = x1 - x0 - a - b;
                const h = z1 - z0 - c - d;
                if (w < 0.8 || h < 0.8) continue;
                cands.push([area - w * h, x0 + a, x1 - b, z0 + c, z1 - d]);
              }
            }
          }
        }
        cands.sort((u, v) => u[0] - v[0]);
        for (const [, nx0, nx1, nz0, nz1] of cands.slice(0, 160)) {
          if (hits(nx0, nx1, nz0, nz1)) continue;
          m.geometry = new THREE.BoxGeometry(nx1 - nx0, gb.max.y - gb.min.y, nz1 - nz0).translate((nx0 + nx1) / 2, ly, (nz0 + nz1) / 2);
          return;
        }
        this.slabConflicts.push(`${venueId} ${box.min.x.toFixed(1)},${box.max.x.toFixed(1)},${box.min.z.toFixed(1)},${box.max.z.toFixed(1)}`);
      });
    }
  }

  /**
   * Un lieu dessiné pour des rues plus étroites ne doit pas déborder sur la chaussée : si l'un de ses obstacles la touche,
   * tout le lieu (modèles et obstacles) est décalé du plus petit écart (1,6 m au plus) qui le dégage. Sans position libre
   * à cette distance (lieu volontairement posé sur la route : rond-point, échangeur), il reste en place.
   */
  private clearRoads(before: number, solidsBefore: number): void {
    const mine = this.solids.slice(solidsBefore);
    if (!mine.length) return;
    const hits = (dx: number, dz: number): number => {
      let n = 0;
      for (const s of mine) {
        const nx = Math.min(14, Math.max(1, Math.ceil(s.x1 - s.x0)));
        const nz = Math.min(14, Math.max(1, Math.ceil(s.z1 - s.z0)));
        for (let i = 0; i <= nx; i++) {
          for (let j = 0; j <= nz; j++) {
            if (this.onRoad(s.x0 + ((s.x1 - s.x0) * i) / nx + dx, s.z0 + ((s.z1 - s.z0) * j) / nz + dz, 0.15)) n++;
          }
        }
      }
      return n;
    };
    if (hits(0, 0) === 0) return;
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let dx = -1.6; dx <= 1.601; dx += 0.4) {
      for (let dz = -1.6; dz <= 1.601; dz += 0.4) {
        const d = Math.hypot(dx, dz);
        if (d > 1.6 || d >= bestD || hits(dx, dz) > 0) continue;
        best = [dx, dz];
        bestD = d;
      }
    }
    if (!best) return;
    const [bx, bz] = best;
    const move = new THREE.Matrix4().makeTranslation(bx, 0, bz);
    for (const o of this.scene.children.slice(before)) {
      if (o.matrixAutoUpdate === false) o.matrix.premultiply(move);
      else o.position.set(o.position.x + bx, o.position.y, o.position.z + bz);
    }
    for (const s of mine) {
      s.x0 += bx;
      s.x1 += bx;
      s.z0 += bz;
      s.z1 += bz;
    }
    this.solidGrid = null;
  }

  /**
   * Parcelle d'un lieu : dalle claire légèrement surélevée avec bordure blanche, englobant ses bâtiments
   * (comme les terrains des lieux sur la carte d'un jeu de ville).
   */
  private venueLot(v: CityVenue, solids: { x0: number; x1: number; z0: number; z1: number }[]): void {
    // Ces maquettes possèdent déjà leur parvis ; une seconde dalle déborderait chez le voisin.
    if (VENUE_LAYOUTS[v.id]) return;
    if (v.id.startsWith('carrefour_') || v.id.startsWith('echangeur_') || v.id === 'colombe_paix' || v.id === 'aeroport' || v.id === 'port' || v.id === 'plage_lome') return;
    let x0 = v.x - 6;
    let x1 = v.x + 6;
    let z0 = v.z - 8;
    let z1 = v.z + 4;
    for (const s of solids) {
      if (Math.hypot((s.x0 + s.x1) / 2 - v.x, (s.z0 + s.z1) / 2 - v.z) > 40) continue;
      x0 = Math.min(x0, s.x0);
      x1 = Math.max(x1, s.x1);
      z0 = Math.min(z0, s.z0);
      z1 = Math.max(z1, s.z1);
    }
    x0 -= 2.5;
    x1 += 2.5;
    z0 -= 2.5;
    z1 = Math.max(z1 + 2.5, v.z + ENTRY - 4.2);
    // La parcelle s'arrête au trottoir : on rogne chaque bord tant qu'il touche une route
    const edgeHits = (ax: number, az: number, bx: number, bz: number) => {
      for (let k = 0; k <= 12; k++) if (this.onRoad(ax + ((bx - ax) * k) / 12, az + ((bz - az) * k) / 12, 1.7)) return true;
      return false;
    };
    for (let i = 0; i < 40 && x1 - x0 > 6 && z1 - z0 > 6; i++) {
      let moved = false;
      if (edgeHits(x0, z0, x0, z1)) (x0 += 0.5), (moved = true);
      if (edgeHits(x1, z0, x1, z1)) (x1 -= 0.5), (moved = true);
      if (edgeHits(x0, z0, x1, z0)) (z0 += 0.5), (moved = true);
      if (edgeHits(x0, z1, x1, z1)) (z1 -= 0.5), (moved = true);
      if (!moved) break;
    }
    const w = x1 - x0;
    const d = z1 - z0;
    const cx = (x0 + x1) / 2;
    const cz = (z0 + z1) / 2;
    // Une dalle mate sans liseré : l'ancienne bordure blanche ressemblait à une ligne routière.
    this.box(w, 0.08, d, 0xd8dfcb, cx, 0.04, cz, false);
  }

  /** Emprise infranchissable ; `h` (hauteur) permet à la caméra de passer au-dessus des bâtiments bas. */
  private solid(x: number, z: number, w: number, d: number, h?: number): void {
    this.solids.push({ x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2, h });
    this.solidGrid = null;
  }

  /**
   * Point d'arrivée devant un lieu : en face par défaut ; si un autre bâtiment y est posé ou cache la vue,
   * le premier point libre sur le côté, tourné vers le lieu. Calculé une fois, sur les vrais obstacles.
   */
  /** Orientation de la maison du joueur (0 : portail au sud ; π : retournée, portail au nord). */
  private homeYaw = 0;

  /** Distance (m) de la première chaussée trouvée en partant de (x, z) dans la direction dz (+1 sud, -1 nord), Infinity au-delà de 40 m. */
  private roadDistance(x: number, z: number, dz: number): number {
    for (let t = 6; t <= 40; t += 0.5) if (this.onRoad(x, z + dz * t, 0) || this.onRoad(x - 3, z + dz * t, 0) || this.onRoad(x + 3, z + dz * t, 0)) return t;
    return Infinity;
  }

  /** La maison regarde la route la plus proche : retournée (π) si la rue passe nettement plus près derrière que devant. */
  private homeFacing(x: number, z: number): number {
    const front = this.roadDistance(x, z, 1);
    const back = this.roadDistance(x, z, -1);
    if (back + 1 < front) return Math.PI;
    if (front + 1 < back) return 0;
    // Routes aussi proches des deux côtés : on prend le côté le plus dégagé entre le portail et la rue (place pour l'entrée et le parking)
    const clutter = (dz: number, to: number) => {
      let n = 0;
      for (let t = 6; t < Math.min(to, 30); t += 1) for (let dx = -6; dx <= 6; dx += 2) if (this.blocked(x + dx, z + dz * t, 0.3)) n++;
      return n;
    };
    return clutter(-1, back) < clutter(1, front) ? Math.PI : 0;
  }

  private entryOf(v: CityVenue): { x: number; z: number; yaw: number } {
    const hit = this.entries.get(v.id);
    if (hit) return hit;
    if (v.id === 'port') {
      // Devant le portail du port, sur le trottoir sud du boulevard, face au terre-plein
      const out = { x: v.x - 3, z: v.z - 0.3, yaw: 0 };
      this.entries.set(v.id, out);
      return out;
    }
    if (v.id === 'lavage_auto') {
      // Le laveur travaille dans l'aire de lavage, entre la voiture et la moto, tourné vers la voiture
      const out = { x: v.x + 2.1, z: v.z - 0.6, yaw: -Math.PI / 2 };
      this.entries.set(v.id, out);
      return out;
    }
    if (v.id === 'aeroport') {
      const [x, z] = AIRPORT_ACCESS[AIRPORT_ACCESS.length - 1]!;
      const out = { x, z, yaw: Math.atan2(v.x - x, v.z - z) };
      this.entries.set(v.id, out);
      return out;
    }
    const OFFSETS = [[0, ENTRY], [5, ENTRY], [-5, ENTRY], [9, ENTRY - 1], [-9, ENTRY - 1], [0, ENTRY + 5], [13, 6], [-13, 6], [15, 0], [-15, 0], [9, ENTRY + 5], [-9, ENTRY + 5], [0, ENTRY + 10], [16, -6], [-16, -6], [20, 6], [-20, 6], [14, ENTRY + 8], [-14, ENTRY + 8], [22, -2], [-22, -2], [0, ENTRY + 16], [24, ENTRY], [-24, ENTRY], [26, -10], [-26, -10]];
    const clear = (ax: number, az: number, bx: number, bz: number) => {
      const n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5);
      for (let i = 0; i <= n; i++) if (this.blocked(ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n, 0.3)) return false;
      return true;
    };
    let out = { x: v.x, z: v.z + ENTRY, yaw: Math.PI };
    // Maison du joueur : d'abord juste devant son portail (à 5 m du centre), côté rue, jamais sur la chaussée
    const isHome = v.id === this.opts.home.id;
    const homeFirst: [number, number][] = isHome ? [[0, 7], [0, 8.5], [0, 10]] : [];
    for (const [ox, oz] of [...homeFirst, ...(VENUE_LAYOUTS[v.id]?.entries ?? []), ...OFFSETS]) {
      const [dx, dz] = rotateXZ(ox!, oz!, isHome ? this.homeYaw : venueYaw(v.id));
      const x = v.x + dx;
      const z = v.z + dz;
      if (this.onRoad(x, z, 0) && (VENUE_LAYOUTS[v.id] || oz! < ENTRY - 2)) continue;
      const yaw = Math.atan2(v.x - x, v.z - z);
      const d = Math.hypot(ox!, oz!);
      // Place libre, recul de la caméra libre, et vue dégagée jusqu'aux abords du lieu (ses propres murs exceptés)
      // Les entrées des petites maquettes sont proches des façades/étals : ne pas tester
      // plusieurs mètres à l'intérieur de leur propre bâtiment et rejeter leur parvis.
      const reach = VENUE_LAYOUTS[v.id] ? Math.min(0.6, d * 0.45) : Math.max(d * 0.45, d - 9);
      // Enceinte close (hôpital, CNSS) : on arrive devant le portail, côté intérieur ; la caméra de rue gère elle-même la clôture derrière
      if (!FENCED_VENUES.has(v.id) && !clear(x, z, x - Math.sin(yaw) * 6.5, z - Math.cos(yaw) * 6.5)) continue;
      if (!clear(x, z, x + Math.sin(yaw) * reach, z + Math.cos(yaw) * reach)) continue;
      // Pas coincé entre deux murs : un peu d'air de chaque côté
      if (this.blocked(x + Math.cos(yaw) * 2.5, z - Math.sin(yaw) * 2.5, 0.3) && this.blocked(x - Math.cos(yaw) * 2.5, z + Math.sin(yaw) * 2.5, 0.3)) continue;
      out = { x, z, yaw };
      break;
    }
    this.entries.set(v.id, out);
    return out;
  }

  /**
   * Lieu dont l'entrée est la plus proche de (x, z), dans un rayon `radius` ; `prefer` (lieu déjà atteint) gagne les égalités à
   * 0,5 m près et garde un rayon `radius`, alors que les autres lieux doivent être à moins de `radiusOther` (par défaut `radius`).
   */
  private nearestEntry(x: number, z: number, radius: number, prefer: string | null, radiusOther = radius): CityVenue | undefined {
    let best: CityVenue | undefined;
    let bestD = Infinity;
    for (const v of [this.opts.home, ...this.opts.venues]) {
      const e = this.entryOf(v);
      const d = Math.hypot(e.x - x, e.z - z);
      if (d >= (v.id === prefer ? radius : radiusOther)) continue;
      const score = v.id === prefer ? d - 0.5 : d;
      if (score < bestD) {
        bestD = score;
        best = v;
      }
    }
    return best;
  }

  private buildSolidGrid(): Map<number, number[]> {
    const grid = new Map<number, number[]>();
    this.solids.forEach((b, i) => {
      for (let ix = Math.floor(b.x0 / SOLID_CELL); ix <= Math.floor(b.x1 / SOLID_CELL); ix++) {
        for (let iz = Math.floor(b.z0 / SOLID_CELL); iz <= Math.floor(b.z1 / SOLID_CELL); iz++) {
          const k = solidKey(ix, iz);
          const list = grid.get(k);
          if (list) list.push(i);
          else grid.set(k, [i]);
        }
      }
    });
    return grid;
  }

  /** Point (élargi de r) dans une emprise plus haute que `minH` ? Seules les cellules voisines sont testées. */
  private blocked(x: number, z: number, r = 0.45, minH = -Infinity): boolean {
    const grid = (this.solidGrid ??= this.buildSolidGrid());
    const solids = this.solids;
    for (let ix = Math.floor((x - r) / SOLID_CELL); ix <= Math.floor((x + r) / SOLID_CELL); ix++) {
      for (let iz = Math.floor((z - r) / SOLID_CELL); iz <= Math.floor((z + r) / SOLID_CELL); iz++) {
        const list = grid.get(solidKey(ix, iz));
        if (!list) continue;
        for (const i of list) {
          const b = solids[i]!;
          if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r && (b.h ?? Infinity) > minH) return true;
        }
      }
    }
    return false;
  }

  /** Segment praticable par une moto, échantillonné assez finement pour ne pas traverser un mur mince. */
  private clearSegment(a: THREE.Vector3, b: THREE.Vector3, radius = 0.62): boolean {
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.65));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (this.blocked(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, radius)) return false;
    }
    return true;
  }

  /**
   * Petit A* local pour le dernier tronçon entre la chaussée et l'entrée d'un lieu.
   * Il n'est calculé qu'au lancement d'un trajet et évite les concessions, murs et bâtiments.
   */
  private safeConnector(from: THREE.Vector3, to: THREE.Vector3): THREE.Vector3[] {
    if (this.blocked(from.x, from.z, 0.62) || this.blocked(to.x, to.z, 0.62)) return [];
    if (this.clearSegment(from, to)) return [to.clone()];
    const step = 1.4;
    // Marge assez large pour contourner une concession entière, pas seulement son mur le plus proche.
    const pad = 24;
    const x0 = Math.floor((Math.min(from.x, to.x) - pad) / step) * step;
    const z0 = Math.floor((Math.min(from.z, to.z) - pad) / step) * step;
    const nx = Math.ceil((Math.max(from.x, to.x) + pad - x0) / step) + 1;
    const nz = Math.ceil((Math.max(from.z, to.z) + pad - z0) / step) + 1;
    const count = nx * nz;
    const key = (ix: number, iz: number) => iz * nx + ix;
    const point = (k: number) => new THREE.Vector3(x0 + (k % nx) * step, 0, z0 + Math.floor(k / nx) * step);
    const nearestCell = (p: THREE.Vector3) => key(Math.max(0, Math.min(nx - 1, Math.round((p.x - x0) / step))), Math.max(0, Math.min(nz - 1, Math.round((p.z - z0) / step))));
    const start = nearestCell(from);
    const goal = nearestCell(to);
    const score = new Float32Array(count).fill(Infinity);
    const prev = new Int32Array(count).fill(-1);
    const open = new Set<number>([start]);
    score[start] = 0;
    while (open.size) {
      let cur = -1;
      let best = Infinity;
      for (const k of open) {
        const p = point(k);
        const f = score[k]! + Math.hypot(p.x - to.x, p.z - to.z);
        if (f < best) (best = f), (cur = k);
      }
      if (cur === goal) break;
      open.delete(cur);
      const cx = cur % nx;
      const cz = Math.floor(cur / nx);
      for (const [dx, dz] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]] as const) {
        const ix = cx + dx;
        const iz = cz + dz;
        if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) continue;
        const k = key(ix, iz);
        const p = point(k);
        if (k !== goal && k !== start && this.blocked(p.x, p.z, 0.68)) continue;
        // Interdit de couper en diagonale à travers l'angle d'un mur.
        if (dx && dz && (this.blocked(x0 + (cx + dx) * step, z0 + cz * step, 0.68) || this.blocked(x0 + cx * step, z0 + (cz + dz) * step, 0.68))) continue;
        const next = score[cur]! + (dx && dz ? step * Math.SQRT2 : step);
        if (next >= score[k]!) continue;
        score[k] = next;
        prev[k] = cur;
        open.add(k);
      }
    }
    // Aucun chemin sûr : ne jamais retomber sur une ligne droite qui traverserait le bâtiment.
    if (goal !== start && prev[goal]! < 0) return [];
    const raw: THREE.Vector3[] = [to.clone()];
    for (let k = goal; k !== start && k >= 0; k = prev[k]!) raw.unshift(point(k));
    // Lissage par visibilité : conserve les contournements mais retire l'effet escalier de la grille.
    const out: THREE.Vector3[] = [];
    let anchor = from;
    for (let i = 0; i < raw.length; ) {
      let j = raw.length - 1;
      while (j > i && !this.clearSegment(anchor, raw[j]!)) j--;
      if (!this.clearSegment(anchor, raw[j]!)) return [];
      out.push(raw[j]!);
      anchor = raw[j]!;
      i = j + 1;
    }
    return out;
  }

  /** Un véhicule garé (visible) occupe-t-il ce point ? Boîte orientée : voiture 4,2 × 1,9 ; moto 2 × 0,8. */
  private parkedAt(x: number, z: number, r: number): boolean {
    for (const k of ['MOTO', 'CAR'] as const) {
      const pk = this.parked[k];
      if (!pk?.g.visible) continue;
      const dx = x - pk.x;
      const dz = z - pk.z;
      const s = Math.sin(pk.yaw);
      const c = Math.cos(pk.yaw);
      const along = dx * s + dz * c; // le long du véhicule (devant = direction du cap)
      const across = dx * c - dz * s;
      if (Math.abs(along) < (k === 'CAR' ? 2.1 : 1.0) + r && Math.abs(across) < (k === 'CAR' ? 0.95 : 0.4) + r) return true;
    }
    return false;
  }

  /** Un véhicule en circulation occupe-t-il ce point ? (voiture ou camion : 6 × 2,2 ; moto : 2 × 0,8) */
  private vehicleAt(x: number, z: number, r = 0.35): boolean {
    const hit = (axis: 'x' | 'z', lane: number, pos: number, halfLen: number, halfW: number) => {
      const side = lane + laneBend(axis, lane, pos);
      const [along, across] = axis === 'x' ? [x - pos, z - side] : [z - pos, x - side];
      return Math.abs(along) < halfLen + r && Math.abs(across) < halfW + r;
    };
    // Moto et voiture garées du joueur : obstacles pleins (boîte orientée), qu'on soit à pied ou au guidon d'un autre véhicule
    if (this.parkedAt(x, z, r)) return true;
    return this.cars.some((c) => !c.off && hit(c.axis, c.lane, c.pos, 3, 1.1)) || this.zems.some((m) => hit(m.axis, m.lane, m.pos, 1, 0.4)) || this.pathCars.some((p) => !p.off && Math.abs(p.y - this.groundY) < 2 && Math.abs(p.x - x) < 2.6 + r && Math.abs(p.z - z) < 2.6 + r && Math.hypot(p.x - x, p.z - z) < 2.5 + r);
  }

  /** Balayage du prochain mouvement : empêche une moto rapide de sauter au travers d'un véhicule entre deux images. */
  /**
   * Véhicule le plus proche devant le joueur dans son couloir (voitures de la grille, des rues et zémidjans qui roulent dans le
   * même sens) : distance libre pare-chocs à pare-chocs et vitesse. null s'il n'y en a pas à moins de `reach` mètres.
   */
  private leadAhead(ux: number, uz: number, reach: number, half: number): { gap: number; v: number } | null {
    const p = this.player.position;
    let best: { gap: number; v: number } | null = null;
    const consider = (ox: number, oz: number, ohx: number, ohz: number, len: number, ov: number) => {
      if (ohx * ux + ohz * uz < -0.3) return; // en sens inverse : il ne nous précède pas
      const dx = ox - p.x;
      const dz = oz - p.z;
      const fwd = dx * ux + dz * uz;
      if (fwd < 0.2 || Math.abs(dx * uz - dz * ux) > 1.7) return;
      const gap = fwd - len / 2 - half;
      if (gap > reach || (best && gap >= best.gap)) return;
      best = { gap, v: ov };
    };
    for (const o of this.fleet) {
      const b = laneBend(o.axis, o.lane, o.pos);
      consider(o.axis === 'x' ? o.pos : o.lane + b, o.axis === 'x' ? o.lane + b : o.pos, o.axis === 'x' ? o.dir : 0, o.axis === 'x' ? 0 : o.dir, o.len, o.v);
    }
    for (const q of this.pathCars) if (!q.off && Math.abs(q.y - this.groundY) < 2) consider(q.x, q.z, q.hx, q.hz, q.len, q.v);
    return best;
  }

  private trafficOnSegment(a: THREE.Vector3, b: THREE.Vector3, radius: number): boolean {
    // Si le trajet démarre exceptionnellement dans un véhicule ambiant, on le laisse seulement s'en dégager.
    const alreadyOverlapping = this.vehicleAt(a.x, a.z, radius);
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.35));
    for (let i = 1; i <= n; i++) {
      const t = i / n;
      const hit = this.vehicleAt(a.x + (b.x - a.x) * t, a.z + (b.z - a.z) * t, radius);
      if (hit && !alreadyOverlapping) return true;
      if (!hit && alreadyOverlapping) return false;
    }
    return false;
  }

  /** Déplace le personnage en glissant le long des murs ; renvoie false s'il est bloqué. */
  private moveTo(nx: number, nz: number): boolean {
    const p = this.player.position;
    nx = THREE.MathUtils.clamp(nx, MAP_MIN_X, MAP_MAX_X);
    nz = THREE.MathUtils.clamp(nz, MAP_MIN_Z, WALK_MAX_Z);
    // Voitures, camions et motos sont des obstacles (sauf si un véhicule nous a déjà rejoints : on peut s'en dégager)
    const stuck = this.groundY < 2 && this.vehicleAt(p.x, p.z);
    const attempt = (x: number, z: number) => {
      if (this.blocked(x, z) || (this.groundY < 2 && !stuck && this.vehicleAt(x, z))) return false;
      const direction: [number, number] = [x - p.x, z - p.z];
      const step = Math.hypot(...direction);
      let height = flyoverHeight(x, z, this.groundY > 0.15 ? undefined : direction);
      // Sous le pont, on reste au niveau inférieur ; on ne monte que par le pied de la rampe.
      if (this.groundY <= 0.15 && height > 0.2 + step * 0.5) height = 0;
      // Un garde-corps empêche de quitter latéralement un tablier en sautant dans le vide.
      if (this.groundY > 0.15 && Math.abs(height - this.groundY) > 0.2 + step * 0.5) return false;
      p.x = x;
      p.z = z;
      this.groundY = height;
      return true;
    };
    return attempt(nx, nz) || attempt(nx, p.z) || attempt(p.x, nz);
  }

  /**
   * Feu du carrefour OTR (boulevard) : distance libre jusqu'à la ligne d'arrêt quand le feu est rouge,
   * ou orange si le véhicule peut encore s'arrêter confortablement ; Infinity sinon.
   */
  private redGap(v: Car | Zem): number {
    if (v.axis !== 'z' || this.lights.length === 0 || nearest(v.lane, ROADS_X) !== OTR_X) return Infinity;
    const state = signalState(0, 'z', this.lightT);
    if (state === 'green') return Infinity;
    const stop = v.dir === 1 ? OTR_Z - 8 : OTR_Z + 9;
    const ahead = (stop - v.pos) * v.dir - v.len / 2;
    if (ahead < -0.5) return Infinity; // déjà engagé
    if (state === 'amber' && ahead < brakingDistance(v.v)) return Infinity; // orange trop tard pour freiner
    return Math.max(0, ahead);
  }

  /** Le personnage sur la voie devant le véhicule : distance libre jusqu'à lui (Infinity s'il n'y est pas). */
  private playerGap(v: Car | Zem): number {
    if (this.groundY > 2) return Infinity;
    const p = this.player.position;
    const along = v.axis === 'x' ? p.x : p.z;
    const side = (v.axis === 'x' ? p.z : p.x) - laneBend(v.axis, v.lane, along);
    if (Math.abs(side - v.lane) >= LANE + 0.05) return Infinity;
    // Le joueur reste un obstacle quand il conduit : auparavant le trafic traversait sa moto.
    const half = this.riding === 'BUS' ? 3.8 : this.riding === 'CAR' || this.riding === 'WORO' ? 2.2 : this.riding === 'ZEM' ? 1.25 : 0.45;
    const ahead = (along - v.pos) * v.dir;
    if (ahead < -half) return Infinity;
    return Math.max(0, ahead - v.len / 2 - half);
  }

  /** Feux des carrefours du quadrillage : un poteau par coin, tête tournée vers les véhicules qui arrivent. */
  private buildSignals(): void {
    // Matériaux partagés par carrefour et par axe : quelques changements de couleur par cycle au lieu d'un par lampe.
    SIGNALS.forEach((g, sig) => {
      if (sig === 0) return; // carrefour OTR : construit avec son lieu
      for (const axis of ['z', 'x'] as const) {
        const set = this.signalSet();
        for (const dir of [1, -1] as const) this.signalPost(g.x, g.z, axis, dir, set, g.straight);
        this.lights.push({ ...set.lamps, halo: set.halo, sig, axis });
      }
    });
  }

  /** Matériaux d'un groupe de feux qui changent ensemble (un axe d'un carrefour) : lentilles et halos rouge, orange, vert. */
  private signalSet(): { lamps: { red: THREE.Mesh; amber: THREE.Mesh; green: THREE.Mesh }; mats: THREE.MeshBasicMaterial[]; halo: THREE.MeshBasicMaterial[] } {
    // Hors correction de tons : un vert de feu reste vert (sinon il vire au blanc une fois éclairci)
    const mats = [0x1c0706, 0x1a1405, 0x07170e].map((c) => new THREE.MeshBasicMaterial({ color: c, toneMapped: false }));
    const halo = [0xff2a1f, 0xffb000, 0x14e06a].map((c) => new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
    this.signalMats.push(...mats, ...halo);
    // Maillages témoins : seule leur matière compte pour la mise à jour (les vraies lentilles la partagent)
    const probe = (m: THREE.Material) => new THREE.Mesh(undefined, m);
    return { lamps: { red: probe(mats[0]!), amber: probe(mats[1]!), green: probe(mats[2]!) }, mats, halo };
  }

  /**
   * Feu moderne d'une approche de carrefour : poteau sur le trottoir, au coin à droite des véhicules qui arrivent
   * (repoussé hors de la chaussée, courbes comprises), potence au-dessus de leur voie avec un feu à LED suspendu,
   * et un second feu plus bas sur le poteau, à hauteur de vue du piéton.
   */
  private signalPost(rx: number, rz: number, axis: 'x' | 'z', dir: 1 | -1, set: { mats: THREE.MeshBasicMaterial[]; halo: THREE.MeshBasicMaterial[] }, straight = false): void {
    // Routes de la grille : elles ondulent (bend) ; les routes du quartier d'affaires sont droites
    const bd = (road: number, along: number) => (straight ? 0 : bend(road, along));
    // Coin à droite avant le carrefour, et orientation face aux véhicules
    const sx = axis === 'z' ? -dir : -dir;
    const sz = axis === 'z' ? -dir : dir;
    const rot = axis === 'z' ? (dir === 1 ? Math.PI : 0) : dir === 1 ? -Math.PI / 2 : Math.PI / 2;
    let c = ROAD_W / 2 + 1.1;
    let px = rx + bd(rx, rz) + sx * c;
    let pz = rz + bd(rz, rx) + sz * c;
    for (let i = 0; i < 12 && this.onRoad(px, pz, 0.45); i++) {
      c += 0.35;
      px = rx + bd(rx, rz) + sx * c;
      pz = rz + bd(rz, rx) + sz * c;
    }
    const steel = this.mats.color(0x5b636c, 0.4);
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number, parent: THREE.Object3D = this.scene) => {
      const mesh = new THREE.Mesh(this.geo(geo), m);
      mesh.position.set(x, y, z);
      parent.add(mesh);
      return mesh;
    };
    add(new THREE.BoxGeometry(0.55, 0.22, 0.55), this.mats.color(0xb9b4aa), px, 0.11, pz);
    add(new THREE.CylinderGeometry(0.085, 0.11, 5.9, 12), steel, px, 2.95, pz).castShadow = this.profile.shadows;
    // Potence jusqu'au-dessus de la voie (voie de droite du sens de marche)
    const laneOff = axis === 'z' ? -dir * LANE : dir * LANE;
    const lane = axis === 'z' ? rx + laneOff + bd(rx, pz) : rz + laneOff + bd(rz, px);
    const span = Math.abs((axis === 'z' ? px : pz) - lane);
    const mid = ((axis === 'z' ? px : pz) + lane) / 2;
    const arm = add(new THREE.CylinderGeometry(0.06, 0.07, span + 0.3, 10), steel, axis === 'z' ? mid : px, 5.75, axis === 'z' ? pz : mid);
    arm.rotation.set(axis === 'x' ? Math.PI / 2 : 0, 0, axis === 'z' ? Math.PI / 2 : 0);
    const brace = add(new THREE.CylinderGeometry(0.03, 0.03, Math.min(2.4, span * 0.6), 6), steel, 0, 0, 0);
    const bx = axis === 'z' ? px + Math.sign(lane - px) * 0.55 : px;
    const bz = axis === 'x' ? pz + Math.sign(lane - pz) * 0.55 : pz;
    brace.position.set(bx, 5.25, bz);
    brace.rotation.set(axis === 'x' ? Math.sign(lane - pz) * 0.9 : 0, 0, axis === 'z' ? -Math.sign(lane - px) * 0.9 : 0);
    this.signalHead(axis === 'z' ? lane : px, 4.95, axis === 'z' ? pz : lane, rot, 1, set);
    this.signalHead(px, 3.1, pz, rot, 0.78, set);
  }

  /** Feu tricolore à LED : boîtier, panneau arrière à liseré jaune, lentilles plates, visières et halo de la lampe allumée. */
  private signalHead(x: number, y: number, z: number, rot: number, k: number, set: { mats: THREE.MeshBasicMaterial[]; halo: THREE.MeshBasicMaterial[] }): void {
    const g = new THREE.Group();
    const add = (geo: THREE.BufferGeometry, m: THREE.Material, px: number, py: number, pz: number) => {
      const mesh = new THREE.Mesh(this.geo(geo), m);
      mesh.position.set(px, py, pz);
      g.add(mesh);
      return mesh;
    };
    add(new THREE.BoxGeometry(0.74, 1.52, 0.02), this.mats.color(0xffcc00, 0.6), 0, 0, -0.17);
    add(new THREE.BoxGeometry(0.66, 1.44, 0.03), this.mats.color(0x111316, 0.7), 0, 0, -0.15);
    add(new THREE.BoxGeometry(0.42, 1.22, 0.28), this.mats.color(0x24282e, 0.45), 0, 0, 0);
    const visor = new THREE.CylinderGeometry(0.17, 0.17, 0.2, 14, 1, true, -Math.PI / 2, Math.PI);
    for (const [i, dy] of [[0, 0.39], [1, 0], [2, -0.39]] as const) {
      add(new THREE.CylinderGeometry(0.135, 0.135, 0.03, 20), set.mats[i]!, 0, dy, 0.145).rotation.x = Math.PI / 2;
      const v = add(visor, this.mats.color(0x1b1e22, 0.6), 0, dy + 0.02, 0.24);
      v.rotation.x = -Math.PI / 2; // demi-tube au-dessus de la lentille
      v.material.side = THREE.DoubleSide;
      add(new THREE.CircleGeometry(0.26, 20), set.halo[i]!, 0, dy, 0.17).renderOrder = 2;
    }
    g.scale.setScalar(k);
    g.position.set(x, y, z);
    g.rotation.y = rot;
    this.scene.add(g);
  }

  private readonly beachMats: THREE.Material[] = [];
  private readonly beachWaves: { mesh: THREE.Mesh; base: number; phase: number; amp: number }[] = [];

  /** Plan de mer subdivisé, coloré par distance au rivage (z = 35) : turquoise clair, puis bleu moyen, puis bleu profond. */
  private seaGeometry(w: number, d: number): THREE.BufferGeometry {
    // Assez de segments pour que les vagues déforment la surface (une maille tous les ~6 m)
    const g = new THREE.PlaneGeometry(w, d, Math.max(1, Math.round(w / 6)), 60);
    const pos = g.attributes.position as THREE.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const shallow = new THREE.Color(0x63d6d2);
    const mid = new THREE.Color(0x2fa6dd);
    const deep = new THREE.Color(0x1b5fae);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const dist = d / 2 - pos.getY(i); // 0 au rivage, d au large
      const t1 = THREE.MathUtils.smoothstep(dist, 0, 26);
      const t2 = THREE.MathUtils.smoothstep(dist, 20, 120);
      c.copy(shallow).lerp(mid, t1).lerp(deep, t2);
      col[i * 3] = c.r;
      col[i * 3 + 1] = c.g;
      col[i * 3 + 2] = c.b;
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.geos.push?.(g);
    return g;
  }

  /** Sable : grain et petites rides générés, nuance chaude ; remplace l'aplat jaune. */
  private sandSurface(): THREE.Material {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d')!;
    g.fillStyle = '#f1dfae';
    g.fillRect(0, 0, 256, 256);
    const r = rng(77);
    for (let i = 0; i < 2600; i++) {
      g.fillStyle = r() < 0.5 ? 'rgba(255,248,222,.45)' : 'rgba(196,160,98,.28)';
      g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
    }
    // Rides du vent : fines courbes claires
    g.strokeStyle = 'rgba(176,140,84,.22)';
    g.lineWidth = 1.2;
    for (let k = 0; k < 14; k++) {
      g.beginPath();
      const y0 = 10 + k * 18;
      g.moveTo(0, y0);
      for (let x = 0; x <= 256; x += 16) g.lineTo(x, y0 + Math.sin(x / 22 + k) * 3);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(70, 3);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    const m = new THREE.MeshLambertMaterial({ map: tex });
    this.beachMats.push(m, tex as unknown as THREE.Material);
    return m;
  }

  /**
   * Plage : sable mouillé et écume qui va et vient au bord de l'eau, rochers, pirogues de pêcheurs tirées sur le sable, parasols
   * à rayures, transats, paillotes, tours de maîtres-nageurs et filets de volley ; le tout loin du Port et des lieux.
   */
  private buildBeach(): void {
    const r = rng(1313);
    const x0 = MAP_MIN_X - 20;
    const x1 = MAP_MAX_X + 20;
    const W = x1 - x0;
    const cx = (x0 + x1) / 2;
    // Sable mouillé (plus sombre, un peu brillant) et trois bandes d'écume animées
    const wet = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(W, 3.4)), new THREE.MeshLambertMaterial({ color: 0xcdb27d }));
    wet.rotation.x = -Math.PI / 2;
    wet.position.set(cx, 0.016, 33.9);
    this.beachMats.push(wet.material as THREE.Material);
    this.scene.add(wet);
    const foamTex = (() => {
      const cv = document.createElement('canvas');
      cv.width = 512;
      cv.height = 32;
      const g = cv.getContext('2d')!;
      const grad = g.createLinearGradient(0, 0, 0, 32);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(0.35, 'rgba(255,255,255,.9)');
      grad.addColorStop(0.7, 'rgba(255,255,255,.35)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 512, 32);
      // Dentelle de l'écume
      g.globalCompositeOperation = 'destination-out';
      const rr = rng(5);
      for (let i = 0; i < 90; i++) {
        g.beginPath();
        g.arc(rr() * 512, 4 + rr() * 22, 1 + rr() * 3.2, 0, 6.3);
        g.fill();
      }
      const t = new THREE.CanvasTexture(cv);
      t.wrapS = THREE.RepeatWrapping;
      t.repeat.set(Math.round(W / 40), 1);
      return t;
    })();
    this.beachMats.push(foamTex as unknown as THREE.Material);
    for (let k = 0; k < 3; k++) {
      const m = new THREE.MeshBasicMaterial({ map: foamTex, transparent: true, depthWrite: false, opacity: 0.8 });
      this.beachMats.push(m);
      const foam = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(W, 2.4 - k * 0.3)), m);
      foam.rotation.x = -Math.PI / 2;
      foam.position.set(cx, 0.03 + k * 0.004, 35.6 + k * 1.7);
      foam.renderOrder = 2;
      this.scene.add(foam);
      this.beachWaves.push({ mesh: foam, base: 35.6 + k * 1.7, phase: k * 2.1, amp: 0.7 + k * 0.25 });
    }

    // Emplacements possibles : bande de sable entre le boulevard et l'eau, hors Port et hors plage jouable (parasols du lieu)
    const port = this.opts.venues.find((v) => v.id === 'port');
    const plage = this.opts.venues.find((v) => v.id === 'plage_lome');
    // Sable libre : au sud du boulevard côtier (z = 14), loin du Port et du lieu « plage » qui a ses propres parasols
    const spot = (x: number, z: number, m = 0.6) => (!port || Math.abs(x - (port.x + 1)) > 40) && (!plage || Math.abs(x - plage.x) > 16 + m) && z < 33 && z > 19;
    type P = { x: number; z: number; ry: number };
    const umbrellas: P[] = [];
    const loungers: P[] = [];
    const boats: P[] = [];
    for (let x = MIN_X + 6; x < MAX_X - 6; x += 5 + r() * 8) {
      const z = 22 + r() * 8;
      const u = r();
      if (!spot(x, z)) continue;
      if (u < 0.55) {
        umbrellas.push({ x, z, ry: r() * 6 });
        if (r() < 0.8) loungers.push({ x: x - 1.5, z: z + 0.8, ry: 0.2 + r() * 0.3 });
        if (r() < 0.6) loungers.push({ x: x + 1.5, z: z + 0.6, ry: -0.2 - r() * 0.3 });
      } else if (u < 0.8) boats.push({ x, z: 29 + r() * 3, ry: (r() - 0.5) * 0.35 });
    }
    // Parasols : mât blanc et toile à six quartiers alternés
    const poleG = new THREE.CylinderGeometry(0.05, 0.06, 2.6, 6);
    poleG.translate(0, 1.3, 0);
    const canopyG = new THREE.ConeGeometry(1.7, 0.7, 8, 1, true);
    canopyG.translate(0, 2.95, 0);
    const poles = this.instanced(poleG, this.mats.color(0xf4f4f4), Math.max(1, umbrellas.length), false);
    const canopies = this.instanced(canopyG, new THREE.MeshLambertMaterial({ color: 0xffffff, side: THREE.DoubleSide }), Math.max(1, umbrellas.length), true);
    const PARA = [0xe5383b, 0xffce00, 0x1f6feb, 0x22a861, 0xf18f01, 0xff7aa8, 0x00a6a6];
    umbrellas.forEach((u, i) => {
      this.setInstanceE(poles, i, u.x, 0, u.z, 1, 1, 1, 0.08, u.ry, 0);
      this.setInstanceE(canopies, i, u.x, 0, u.z, 1, 1, 1, 0.08, u.ry, 0);
      canopies.setColorAt(i, this.tmp.c.setHex(PARA[i % PARA.length]!));
    });
    if (canopies.instanceColor) canopies.instanceColor.needsUpdate = true;
    // Transats : assise et dossier incliné
    const seats = this.instanced(new THREE.BoxGeometry(0.7, 0.12, 1.5), this.mats.color(0xf5efe0), Math.max(1, loungers.length), false);
    const backs = this.instanced(new THREE.BoxGeometry(0.7, 0.1, 0.75), this.mats.color(0xf5efe0), Math.max(1, loungers.length), false);
    loungers.forEach((l, i) => {
      this.setInstanceE(seats, i, l.x, 0.32, l.z, 1, 1, 1, 0, l.ry, 0);
      this.setInstanceE(backs, i, l.x - Math.sin(l.ry) * 0.9, 0.62, l.z - Math.cos(l.ry) * 0.9, 1, 1, 1, 0.9, l.ry, 0);
      seats.setColorAt(i, this.tmp.c.setHex(i % 3 === 0 ? 0xbfe3f5 : 0xf5efe0));
      backs.setColorAt(i, this.tmp.c.setHex(i % 3 === 0 ? 0xbfe3f5 : 0xf5efe0));
    });
    for (const m of [seats, backs]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    // Pirogues de pêcheurs : coque effilée peinte, liseré de couleur, étrave relevée
    const hullG = new THREE.CylinderGeometry(0.5, 0.42, 5.6, 10);
    hullG.rotateZ(Math.PI / 2);
    const hulls = this.instanced(hullG, this.mats.color(0xffffff), Math.max(1, boats.length), true);
    const stripes = this.instanced(new THREE.BoxGeometry(5.5, 0.1, 0.9), this.mats.color(0xffffff), Math.max(1, boats.length), false);
    const prows = this.instanced(new THREE.BoxGeometry(0.2, 0.9, 0.3), this.mats.color(0x7a4a26), Math.max(1, boats.length * 2), false);
    const HULL = [0x2f6fd0, 0xe5383b, 0x22a861, 0xf1c40f, 0xffffff];
    boats.forEach((b, i) => {
      this.setInstanceE(hulls, i, b.x, 0.42, b.z, 1, 0.5, 1, 0, b.ry, 0);
      hulls.setColorAt(i, this.tmp.c.setHex(HULL[i % HULL.length]!));
      this.setInstanceE(stripes, i, b.x, 0.72, b.z, 1, 1, 1, 0, b.ry, 0);
      stripes.setColorAt(i, this.tmp.c.setHex(HULL[(i + 2) % HULL.length]!));
      for (const side of [-1, 1] as const) this.setInstanceE(prows, i * 2 + (side > 0 ? 1 : 0), b.x + Math.cos(b.ry) * 2.75 * side, 0.85, b.z - Math.sin(b.ry) * 2.75 * side, 1, 1, 1, 0, b.ry, side * 0.5);
    });
    for (const m of [hulls, stripes]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    // Rochers sombres et lisses près de l'eau
    const rocksAt: [number, number, number][] = [];
    for (let x = MIN_X; x < MAX_X; x += 17 + r() * 30) if (r() < 0.7 && (!port || Math.abs(x - (port.x + 1)) > 40)) rocksAt.push([x, 32.4 + r() * 1.4, 0.5 + r() * 0.9]);
    const rocks = this.instanced(new THREE.IcosahedronGeometry(1, 0), this.mats.color(0x6f6a62), Math.max(1, rocksAt.length), true);
    rocksAt.forEach(([x, z, sc], i) => this.setInstanceE(rocks, i, x, sc * 0.3, z, sc * 1.4, sc * 0.7, sc, r(), r() * 6, r() * 0.5));
    // Paillotes (bars de plage au toit de chaume) et tours de maîtres-nageurs, à intervalles réguliers
    const paillote = (x: number, z: number) => {
      for (const [dx, dz] of [[-2.2, -1.6], [2.2, -1.6], [-2.2, 1.6], [2.2, 1.6]] as const) this.box(0.2, 2.6, 0.2, 0x6b4a2b, x + dx, 1.3, z + dz, false);
      const roof = new THREE.Mesh(this.geo(new THREE.ConeGeometry(3.9, 1.9, 8)), this.mats.color(0xc9a35a));
      roof.position.set(x, 3.4, z);
      roof.castShadow = this.profile.shadows;
      this.scene.add(roof);
      this.box(4.4, 1, 1, 0x8b5a2b, x, 0.5, z - 1.2, false);
      this.box(4.6, 0.12, 1.2, 0xe9d9b4, x, 1.05, z - 1.2, false);
      for (const dx of [-1.2, 1.2]) {
        const stool = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.25, 0.2, 0.8, 8)), this.mats.color(0xe5383b));
        stool.position.set(x + dx, 0.42, z + 0.9);
        this.scene.add(stool);
      }
    };
    const tower = (x: number, z: number) => {
      for (const [dx, dz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]] as const) this.box(0.14, 2.6, 0.14, 0xf1f1f1, x + dx, 1.3, z + dz, false);
      this.box(2.1, 0.14, 2.1, 0xe5383b, x, 2.65, z, false);
      this.box(2.3, 0.1, 2.3, 0xffffff, x, 3.55, z, false);
      this.box(0.9, 1.0, 0.9, 0xf4f4f4, x, 3.1, z, false);
      this.box(0.06, 1.4, 0.06, 0x555555, x + 0.9, 4.1, z + 0.9, false);
      this.box(0.7, 0.45, 0.04, 0xe5383b, x + 1.25, 4.5, z + 0.9, false);
    };
    for (const x of [-95, 15, 150]) if (spot(x, 25, 5) && (!port || Math.abs(x - (port.x + 1)) > 50)) paillote(x, 25);
    for (const x of [-60, 70, 190]) if (spot(x, 27, 3) && (!port || Math.abs(x - (port.x + 1)) > 50)) tower(x, 27);
    // Filets de volley
    for (const x of [-40, 100]) {
      if (!spot(x, 26, 6)) continue;
      for (const dx of [-3, 3]) this.box(0.1, 2.4, 0.1, 0x555555, x + dx, 1.2, 26, false);
      this.box(6, 0.9, 0.04, 0xf4f4f4, x, 2, 26, false);
      this.box(6.1, 0.1, 0.06, 0xe5383b, x, 2.45, 26, false);
    }
  }

  // ---------- pluie et sol mouillé ----------
  private rainK = 0;
  private rainT = 0;
  private rainGoal = 0;
  private rainLines: THREE.LineSegments | null = null;
  private rainLoc: Float32Array | null = null;
  /**
   * Météo de la ville (voir weather.ts, la même que dans le téléphone) : gouttes autour de la caméra et ciel gris pendant
   * la pluie ; pas d'eau dessinée au sol.
   */
  private updateRain(dt: number): void {
    this.rainT -= dt;
    if (this.rainT <= 0) {
      this.rainT = 3;
      const total = this.opts.totalMinutes?.() ?? 0;
      this.rainGoal = rainAt(total);
    }
    const ease = (v: number, goal: number, rate: number) => v + Math.sign(goal - v) * Math.min(Math.abs(goal - v), dt * rate);
    this.rainK = ease(this.rainK, this.rainGoal, 0.3);
    const k = this.rainK;
    const map = this.view === 'map';
    const cx = this.tmp.w.x; // centre : ce que la caméra regarde
    const cz = this.tmp.w.z;
    const S = map ? 150 : 48; // côté de la boîte de pluie autour de la caméra

    // --- gouttes et ciel couvert
    if (k < 0.01) {
      if (this.rainLines) this.rainLines.visible = false;
      return;
    }
    const H = map ? 70 : 30;
    // Gouttes selon la qualité : 800 (haute), 500 (moyenne), 250 (basse)
    const N = this.profile.trees >= 44 ? 800 : this.profile.trees >= 30 ? 500 : 250;
    if (!this.rainLines) {
      const loc = new Float32Array(N * 5);
      const r = rng(4242);
      for (let i = 0; i < N; i++) {
        loc[i * 5] = r();
        loc[i * 5 + 1] = r();
        loc[i * 5 + 2] = r();
        loc[i * 5 + 3] = 0.65 + r() * 0.7; // vitesse propre à la goutte
        loc[i * 5 + 4] = 0.6 + r() * 0.9; // longueur propre à la goutte
      }
      this.rainLoc = loc;
      const g = this.geo(new THREE.BufferGeometry());
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 6), 3));
      const m = new THREE.LineBasicMaterial({ color: 0xd6e6f5, transparent: true, opacity: 0.4, depthWrite: false });
      this.beachMats.push(m);
      this.rainLines = new THREE.LineSegments(g, m);
      this.rainLines.frustumCulled = false;
      this.rainLines.renderOrder = 5;
      this.scene.add(this.rainLines);
    }
    const loc = this.rainLoc!;
    const pos = this.rainLines.geometry.attributes.position as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    // Rafales : le vent et la force de l'averse varient lentement (jamais deux instants pareils)
    const tt = performance.now() / 1000;
    const gust = 0.5 + 0.5 * Math.sin(tt * 0.31) * Math.sin(tt * 0.17 + 1.3);
    const slant = 0.1 + 0.28 * gust + 0.06 * Math.sin(tt * 1.7);
    const live = Math.min(N, Math.max(60, Math.round(N * (0.45 + 0.55 * gust) * (0.5 + 0.5 * k))));
    const base = (map ? 0.7 : 1.5) * dt; // part de la hauteur de la boîte parcourue pendant ce pas
    for (let i = 0; i < N; i++) {
      let y = loc[i * 5 + 1]! - base * loc[i * 5 + 3]! * (0.85 + 0.3 * gust);
      if (y < 0) {
        // La goutte réapparaît en haut à un autre endroit : pas de motif qui se répète
        y += 1;
        loc[i * 5] = Math.random();
        loc[i * 5 + 2] = Math.random();
        loc[i * 5 + 3] = 0.65 + Math.random() * 0.7;
        loc[i * 5 + 4] = 0.6 + Math.random() * 0.9;
      }
      loc[i * 5 + 1] = y;
      const x = cx + (loc[i * 5]! - 0.5) * S;
      const z = cz + (loc[i * 5 + 2]! - 0.5) * S;
      const wy = y * H;
      const len = (map ? 2.6 : 1.1) * loc[i * 5 + 4]!;
      arr[i * 6] = x;
      arr[i * 6 + 1] = wy;
      arr[i * 6 + 2] = z;
      arr[i * 6 + 3] = x + len * slant;
      arr[i * 6 + 4] = wy - len;
      arr[i * 6 + 5] = z;
    }
    this.rainLines.geometry.setDrawRange(0, live * 2);
    pos.needsUpdate = true;
    this.rainLines.visible = true;
    (this.rainLines.material as THREE.LineBasicMaterial).opacity = (0.16 + 0.3 * k) * (0.75 + 0.25 * gust);
    // Ciel couvert : fond et brouillard grisés, soleil et lumière du ciel plus faibles
    const bg = this.scene.background as THREE.Color;
    bg.lerp(this.tmp.c.setHex(0x6c7683), 0.55 * k);
    (this.scene.fog as THREE.Fog).color.copy(bg);
    this.sun.intensity *= 1 - 0.5 * k;
    this.hemi.intensity *= 1 - 0.2 * k;
    this.updateLightning(dt, k);
  }

  private flashNext = 8;
  private flashAge = -1;
  private bolt: THREE.Line | null = null;

  /** Éclairs : seulement pendant les gros orages (pluie > 0,85, voir weather.ts) ; deux éclats rapprochés et un trait de foudre. */
  private updateLightning(dt: number, k: number): void {
    const storm = this.rainGoal > 0.85 && k > 0.8;
    if (this.flashAge < 0) {
      if (this.bolt) this.bolt.visible = false;
      if (!storm) return;
      this.flashNext -= dt;
      if (this.flashNext > 0) return;
      this.flashNext = 6 + Math.random() * 16;
      this.flashAge = 0;
      // Trait de foudre en zigzag, à quelque distance de la caméra
      const S = this.view === 'map' ? 90 : 34;
      const bx = this.tmp.w.x + (Math.random() - 0.5) * S;
      const bz = this.tmp.w.z + (Math.random() - 0.5) * S - S * 0.3;
      const pts: number[] = [];
      let x = bx;
      let z = bz;
      const top = this.view === 'map' ? 90 : 50;
      for (let y = top, i = 0; i < 9; i++, y -= top / 9) {
        pts.push(x, y, z);
        x += (Math.random() - 0.5) * 5;
        z += (Math.random() - 0.5) * 3;
      }
      pts.push(x, 0, z);
      if (!this.bolt) {
        this.bolt = new THREE.Line(this.geo(new THREE.BufferGeometry()), new THREE.LineBasicMaterial({ color: 0xf4f7ff, fog: false }));
        this.bolt.frustumCulled = false;
        this.bolt.renderOrder = 6;
        this.beachMats.push(this.bolt.material as THREE.Material);
        this.scene.add(this.bolt);
      }
      this.bolt.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.bolt.geometry.computeBoundingSphere();
    }
    this.flashAge += dt;
    const t = this.flashAge;
    // Deux éclats : 0–0,12 s puis 0,2–0,42 s
    const level = t < 0.12 ? 1 - t / 0.12 : t > 0.2 && t < 0.42 ? 1 - (t - 0.2) / 0.22 : 0;
    if (this.bolt) this.bolt.visible = level > 0.05;
    if (t >= 0.42) this.flashAge = -1;
    if (level <= 0) return;
    const bg = this.scene.background as THREE.Color;
    bg.lerp(this.tmp.c.setHex(0xf2f6ff), 0.65 * level);
    (this.scene.fog as THREE.Fog).color.copy(bg);
    this.hemi.intensity += 1.3 * level;
    this.sun.intensity += 0.6 * level;
  }

  private seaDistrict: SeaDistrict | null = null;

  /** Temps des vagues (secondes), lu par le matériau de la mer. */
  private readonly seaTime = { value: 0 };

  /**
   * Houle réelle : trois trains de vagues qui avancent vers la plage (la surface monte et descend), amplitude nulle au
   * rivage pour ne pas toucher le sable ni l'écume, plus des reflets de soleil qui glissent à la surface.
   */
  private animateSea(m: THREE.Material): void {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    // Qualité basse : mer immobile (le dégradé reste), un calcul de moins par sommet et par image
    if (this.profile.trees < 30) return;
    const uT = this.seaTime;
    m.onBeforeCompile = (sh) => {
      sh.uniforms.uT = uT;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nuniform float uT;\nvarying vec2 vSea;')
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
          vSea = position.xy;
          float shore = smoothstep(3.0, 40.0, 150.0 - position.y);
          float wv = sin(position.y * 0.18 - uT * 1.1 + sin(position.x * 0.05) * 1.5) * 0.55
                   + sin(position.y * 0.31 + position.x * 0.12 - uT * 1.7) * 0.3
                   + sin(position.x * 0.23 - position.y * 0.09 - uT * 0.9) * 0.15;
          // Toujours au-dessus du plan d'eau de l'horizon (sinon les deux surfaces se croisent et découpent des bandes)
          transformed.z += (0.02 + 0.09 * (0.5 + 0.5 * wv)) * shore;`,
        );
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uT;\nvarying vec2 vSea;')
        .replace(
          '#include <color_fragment>',
          `#include <color_fragment>
          float gl = sin(vSea.y * 0.7 - uT * 1.6 + sin(vSea.x * 0.4) * 2.0) * sin(vSea.x * 0.5 + uT * 0.8 + vSea.y * 0.2);
          diffuseColor.rgb += smoothstep(0.8, 1.0, gl) * 0.16 + 0.03 * sin(vSea.y * 0.12 - uT * 0.6);`,
        );
    };
    m.needsUpdate = true;
  }

  /** Va-et-vient de l'écume sur le sable mouillé. */
  private updateBeach(): void {
    this.seaTime.value = performance.now() / 1000;
    this.seaDistrict?.update(this.seaTime.value, Math.min(0.1, this.realDt || 1 / 60));
    if (this.beachWaves.length === 0) return;
    const t = performance.now() / 1000;
    for (const w of this.beachWaves) {
      w.mesh.position.z = w.base + Math.sin(t * 0.7 + w.phase) * w.amp;
      (w.mesh.material as THREE.MeshBasicMaterial).opacity = 0.55 + 0.3 * Math.sin(t * 0.7 + w.phase + 1.2);
    }
  }

  private buildGround(): void {
    const ground = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(MAX_X - MIN_X + 40, 36 - MIN_Z + 30)), this.surface('#c9dea6', 0.18, 'grass', 40));
    ground.rotation.x = -Math.PI / 2;
    // Le terrain suit les vraies bornes asymétriques de la carte ; auparavant il restait centré
    // sur x=0 et débordait à l'ouest tout en s'arrêtant trop tôt à l'est.
    ground.position.set((MIN_X + MAX_X) / 2, 0, (36 + MIN_Z - 30) / 2);
    ground.receiveShadow = this.profile.shadows;
    const sandMat = this.sandSurface();
    const beach = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(MAX_X - MIN_X + 40, 18)), sandMat);
    beach.rotation.x = -Math.PI / 2;
    beach.position.set((MIN_X + MAX_X) / 2, 0.01, 27);
    const seaMat = this.profile.standardMaterials
      ? new THREE.MeshStandardMaterial({ color: C.sea, roughness: 0.25, metalness: 0.1 })
      : new THREE.MeshLambertMaterial({ color: C.sea });
    // Mer en dégradé : eau turquoise peu profonde près du rivage, bleu profond au large
    const gradSea = this.profile.standardMaterials
      ? new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.25, metalness: 0.1 })
      : new THREE.MeshLambertMaterial({ vertexColors: true });
    this.beachMats.push(gradSea);
    this.animateSea(gradSea);
    const sea = new THREE.Mesh(this.seaGeometry(700, 300), gradSea);
    sea.rotation.x = -Math.PI / 2;
    sea.position.set(0, -0.05, 185);
    sea.userData.noMerge = true; // la fusion des maillages perdrait le dégradé (couleurs par sommet)
    // Grand Lomé : bande nord (RN1 vers Tsévié) et bande ouest (Sogbossito, Légbassito), même grain d'herbe
    const tile = 10.25;
    const stripW = MAX_X - MAP_MIN_X + 40;
    const stripD = MIN_Z - 30 - (MAP_MIN_Z - 30);
    const north = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(stripW, stripD)), this.surface('#c9dea6', 0.18, 'grass', stripW / tile, stripD / tile));
    north.rotation.x = -Math.PI / 2;
    north.position.set((MAP_MIN_X + MAX_X) / 2, 0, (MIN_Z - 30 + MAP_MIN_Z - 30) / 2);
    north.receiveShadow = this.profile.shadows;
    const westW = MIN_X - 20 - (MAP_MIN_X - 20);
    const westD = 36 - (MIN_Z - 30);
    const west = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(westW, westD)), this.surface('#c9dea6', 0.18, 'grass', westW / tile, westD / tile));
    west.rotation.x = -Math.PI / 2;
    west.position.set((MAP_MIN_X - 20 + MIN_X - 20) / 2, 0, (36 + MIN_Z - 30) / 2);
    west.receiveShadow = this.profile.shadows;
    const beachWest = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(westW, 18)), sandMat);
    beachWest.rotation.x = -Math.PI / 2;
    beachWest.position.set((MAP_MIN_X - 20 + MIN_X - 20) / 2, 0.01, 27);
    // Sol, plage et mer prolongés jusqu'au bord est
    const eastW = MAP_MAX_X + 20 - (MAX_X + 20);
    const eastD = 36 + 260;
    const east = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(eastW, eastD)), this.surface('#c9dea6', 0.18, 'grass', eastW / tile, eastD / tile));
    east.rotation.x = -Math.PI / 2;
    east.position.set((MAX_X + MAP_MAX_X + 40) / 2, 0, (36 - 260) / 2);
    east.receiveShadow = this.profile.shadows;
    const beachEast = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(eastW, 18)), sandMat);
    beachEast.rotation.x = -Math.PI / 2;
    beachEast.position.set((MAX_X + MAP_MAX_X + 40) / 2, 0.01, 27);
    const seaEast = new THREE.Mesh(this.seaGeometry(MAP_MAX_X - 350 + 400, 300), gradSea);
    seaEast.rotation.x = -Math.PI / 2;
    seaEast.userData.noMerge = true;
    seaEast.position.set((350 + MAP_MAX_X + 400) / 2, -0.05, 185);
    this.scene.add(ground, beach, sea, north, west, beachWest, east, beachEast, seaEast);
    this.buildBeach();
    // Secteur marin : digue, route sur l'eau, île de prestige, bateaux (voir seaDistrict.ts)
    this.seaDistrict = buildSeaDistrict(this.mats, this.profile.shadows, this.profile.trees < 30);
    this.scene.add(this.seaDistrict.group);
    // Horizon : terre et mer au-delà des bords de la carte, pour que la carte dézoomée ne montre plus de vide
    const farLand = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(9000, 6000)), this.mats.color(C.earth));
    farLand.rotation.x = -Math.PI / 2;
    farLand.position.set(500, -0.04, 36 - 3000);
    const farSea = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(9000, 6000)), seaMat);
    farSea.rotation.x = -Math.PI / 2;
    farSea.position.set(500, -0.08, 36 + 3000);
    this.scene.add(farLand, farSea);
  }

  /** Texture de surface générée (grain, taches, joints) : asphalte, béton, herbe. */
  private surface(base: string, grain: number, kind: 'asphalt' | 'concrete' | 'grass', repeat = 1, repeatY = repeat): THREE.Material {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const g = cv.getContext('2d')!;
    g.fillStyle = base;
    g.fillRect(0, 0, 256, 256);
    const r = rng(kind.length * 977);
    for (let i = 0; i < 9000; i++) {
      const v = (r() - 0.5) * grain;
      g.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`;
      g.fillRect(r() * 256, r() * 256, 1 + r() * 2, 1 + r() * 2);
    }
    if (kind === 'asphalt') {
      // Réparations et taches d'huile
      for (let i = 0; i < 6; i++) {
        g.fillStyle = `rgba(0,0,0,${0.06 + r() * 0.08})`;
        g.beginPath();
        g.ellipse(r() * 256, r() * 256, 10 + r() * 30, 6 + r() * 16, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
    } else if (kind === 'concrete') {
      // Joints des dalles de trottoir
      g.strokeStyle = 'rgba(0,0,0,0.18)';
      g.lineWidth = 2;
      for (let k = 0; k <= 256; k += 64) {
        g.beginPath();
        g.moveTo(k, 0);
        g.lineTo(k, 256);
        g.moveTo(0, k);
        g.lineTo(256, k);
        g.stroke();
      }
    } else {
      // Touffes d'herbe et plaques de latérite
      for (let i = 0; i < 40; i++) {
        g.fillStyle = r() < 0.5 ? 'rgba(60,120,50,0.08)' : 'rgba(170,110,60,0.06)';
        g.beginPath();
        g.ellipse(r() * 256, r() * 256, 4 + r() * 10, 3 + r() * 8, r() * 3, 0, Math.PI * 2);
        g.fill();
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat, repeatY);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.mats.textures.push(tex);
    return this.profile.standardMaterials
      ? new THREE.MeshStandardMaterial({ map: tex, roughness: kind === 'asphalt' ? 0.94 : 0.88, metalness: 0 })
      : new THREE.MeshLambertMaterial({ map: tex });
  }

  private buildRoads(): void {
    const roadMat = this.surface('#7d8693', 0.22, 'asphalt');
    // Accotement sable-béton proche du sol : pas de double trait gris autour de chaque rue.
    const walkMat = this.surface('#b8b19f', 0.14, 'concrete');
    for (const z of ROADS_Z) {
      const pts: [number, number][] = [];
      for (let x = MIN_X - 10; x <= roadEastEnd(z); x += 3) pts.push([x, z + bend(z, x)]);
      const end = roadEastEnd(z);
      if (pts[pts.length - 1]![0] !== end) pts.push([end, z + bend(z, end)]);
      this.addStrip(pts, (z === 14 ? ROAD_W + 2 : ROAD_W) + 2.2, walkMat, 0.011);
      this.addStrip(pts, z === 14 ? ROAD_W + 2 : ROAD_W, roadMat, 0.02);
    }
    for (const x of ROADS_X) {
      const pts: [number, number][] = [];
      const end = x === 0 ? EYADEMA_END_Z : ROAD_END_Z - ROAD_W / 2;
      for (let z = 14 + ROAD_W / 2; z >= end; z -= 3) pts.push([x + bend(x, z), z]);
      this.addStrip(pts, ROAD_W + 2.2, walkMat, 0.012);
      this.addStrip(pts, ROAD_W, roadMat, 0.021);
    }
    // Route de la nouvelle Présidence : du boulevard Eyadéma (angle de Yas) jusqu'au portail
    // Rues secondaires : trottoir et bordure de chaque côté (comme les boulevards), qui suivent les virages ; dessous la
    // chaussée du quadrillage (0,02), au-dessus de ses trottoirs (0,012)
    // (Sur un échangeur, les glissières remplacent le trottoir : il est rentré dans la dalle, sinon il apparaissait par-dessus l'asphalte.)
    for (const road of CITY_ROADS) this.addStrip(road, ROAD_W - 1 + 2.2, walkMat, road === GRAND_BYPASS ? (x, z) => (flyoverHeight(x, z) > 0 ? flyoverHeight(x, z) - 0.6 : 0.016) : 0.016);
    // Bouts de route arrondis : trottoir en demi-cercle autour de chaque extrémité
    const caps = CITY_ROADS.flatMap((road) => [road[0]!, road[road.length - 1]!].map(([x, z]) => [x, z, road === GRAND_BYPASS ? flyoverHeight(x, z) : 0] as const)).filter(([, , h]) => h < 0.05);
    const capMesh = this.instanced(new THREE.CylinderGeometry((ROAD_W - 1 + 2.2) / 2, (ROAD_W - 1 + 2.2) / 2, 0.012, 24), walkMat, caps.length, false);
    caps.forEach(([x, z, h], i) => this.setInstance(capMesh, i, x, h + 0.01, z));
    for (const road of CITY_ROADS) this.addStrip(road, ROAD_W - 1, roadMat, road === GRAND_BYPASS ? (x, z) => 0.022 + flyoverHeight(x, z) : 0.022);
    // Les bandes sont des polylignes indépendantes : un disque aux sommets ferme les micro-trous
    // visibles dans les virages serrés et aux raccords avec les grands axes.
    // (Pas de disque sur un échangeur : la route y est droite, et un disque à plat dépasserait de la rampe inclinée.)
    const joints = CITY_ROADS.flatMap(road => road.map(([x, z]) => [x, z, road === GRAND_BYPASS ? flyoverHeight(x, z) : 0] as const)).filter(([x, z]) => !Object.values(FLYOVERS).some((b) => Math.hypot(x - b.x, z - b.z) < b.half + b.ramp + 1));
    const jointMesh = this.instanced(new THREE.CylinderGeometry((ROAD_W - 1) / 2, (ROAD_W - 1) / 2, 0.025, 16), roadMat, joints.length, false);
    joints.forEach(([x, z, h], i) => this.setInstance(jointMesh, i, x, h + 0.023, z));
    this.buildCornerFillets(roadMat, walkMat);
    this.buildRampFlares(roadMat, walkMat);
    // Pointillés blancs
    const dashes: [number, number, number, number?][] = [];
    for (const z of ROADS_Z) for (let x = MIN_X; x <= roadEastEnd(z); x += 6) if (!ROADS_X.some((rx) => Math.abs(rx - x) < 5)) dashes.push([x, z + bend(z, x), -Math.atan(bendSlope(z, x))]);
    for (const x of ROADS_X) {
      const end = x === 0 ? EYADEMA_END_Z : ROAD_END_Z;
      for (let z = end; z <= 12; z += 6) if (!ROADS_Z.some((rz) => Math.abs(rz - z) < 5)) dashes.push([x + bend(x, z), z, Math.PI / 2 + Math.atan(bendSlope(x, z))]);
    }
    // Les axes diagonaux ont le même marquage continu visuellement que la grille principale.
    // Les pointillés sont calculés par segment afin de rester centrés même dans les courbes.
    // Un trait tous les 6 m le long de la route (même dans les courbes, faites de petits segments), aucun dans les carrefours
    // aux deux bouts, où plusieurs routes se croisent.
    for (const road of CITY_ROADS) {
      // Bretelle : pas de pointillés dans la zone où elle s'insère (ils croisaient ceux de la route qui continue)
      const stop = AGOE_RAMPS.includes(road) ? 26 : 6;
      let total = 0;
      for (let i = 0; i < road.length - 1; i++) total += Math.hypot(road[i + 1]![0] - road[i]![0], road[i + 1]![1] - road[i]![1]);
      let next = 6;
      let walked = 0;
      for (let i = 0; i < road.length - 1; i++) {
        const [ax, az] = road[i]!;
        const [bx, bz] = road[i + 1]!;
        const dx = bx - ax;
        const dz = bz - az;
        const len = Math.hypot(dx, dz);
        while (len > 0 && next <= walked + len) {
          const t = (next - walked) / len;
          if (next <= total - stop) dashes.push([ax + dx * t, az + dz * t, -Math.atan2(dz, dx), road === GRAND_BYPASS ? flyoverHeight(ax + dx * t, az + dz * t) : 0]);
          next += 6;
        }
        walked += len;
      }
    }
    const dash = this.instanced(new THREE.BoxGeometry(2.4, 0.02, 0.22), new THREE.MeshBasicMaterial({ color: C.line }), dashes.length, false);
    dashes.forEach(([x, z, r, h = 0], i) => this.setInstance(dash, i, x, h + 0.04, z, 1, 1, 1, r));

    // Passages piétons aux carrefours les plus fréquentés. Un seul InstancedMesh pour toute la ville.
    const crossings: [number, number, number][] = [];
    for (const [cx, cz] of [[0, -30], [COLOMBE_X, COLOMBE_Z], [0, -110], [OTR_X, OTR_Z]] as const) {
      for (let i = -3; i <= 3; i++) {
        crossings.push([cx + i * 0.72, cz + ROAD_W / 2 + 1.6, 0]);
        crossings.push([cx + ROAD_W / 2 + 1.6, cz + i * 0.72, Math.PI / 2]);
      }
    }
    const crossing = this.instanced(new THREE.BoxGeometry(0.42, 0.018, 2.2), new THREE.MeshBasicMaterial({ color: 0xe9e5d8 }), crossings.length, false);
    crossings.forEach(([x, z, rot], i) => this.setInstance(crossing, i, x, 0.047, z, 1, 1, 1, rot));
  }

  /** Bande de route suivant une polyligne (x, z), posée à plat. */
  /**
   * Pied des rampes des échangeurs : la chaussée de la rampe est large (le tablier) ; au sol elle se resserre progressivement
   * sur la route qui continue, sur une quinzaine de mètres, au lieu de tomber d'un coup sur une route plus étroite. Le trottoir suit.
   */
  private buildRampFlares(roadMat: THREE.Material, walkMat: THREE.Material): void {
    const LEN = 16;
    const narrow = ROAD_W - 1;
    const asphalt: number[] = [];
    const walk: number[] = [];
    const quad = (out: number[], y: number, a: [number, number], b: [number, number], c: [number, number], d: [number, number]) => {
      for (const [p, q, r] of [[a, b, c], [a, c, d]] as const) {
        const up = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]) < 0;
        const [s, t] = up ? [q, r] : [r, q];
        out.push(p[0], y, p[1], s[0], y, s[1], t[0], y, t[1]);
      }
    };
    for (const b of Object.values(FLYOVERS)) {
      for (const sign of [-1, 1]) {
        const foot = sign * (b.half + b.ramp);
        const wide = b.width + 1;
        const steps = 8;
        for (let k = 0; k < steps; k++) {
          // Largeur qui se resserre en douceur (cosinus) du pied de la rampe jusqu'à la route
          const w = (t: number) => narrow + (wide - narrow) * (0.5 + 0.5 * Math.cos(Math.PI * t));
          const t0 = k / steps, t1 = (k + 1) / steps;
          const a0 = foot + sign * LEN * t0, a1 = foot + sign * LEN * t1;
          // Le trottoir part de la largeur du tablier (glissières comprises) et ne s'élargit qu'ensuite : plus d'épaulement carré au pied
          const curb = (t: number) => 0.6 + 1.6 * Math.min(1, t * 2);
          for (const [out, y, g0, g1] of [[asphalt, 0.0225, 0, 0], [walk, 0.0165, curb(t0), curb(t1)]] as const) {
            quad(out, y,
              bridgePoint(b, a0, -(w(t0) + g0) / 2), bridgePoint(b, a1, -(w(t1) + g1) / 2),
              bridgePoint(b, a1, (w(t1) + g1) / 2), bridgePoint(b, a0, (w(t0) + g0) / 2));
          }
        }
      }
    }
    for (const [pos, mat] of [[walk, walkMat], [asphalt, roadMat]] as const) {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const uv: number[] = [];
      for (let i = 0; i < pos.length; i += 3) uv.push(pos[i]! / 6, pos[i + 2]! / 6);
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      const m = new THREE.Mesh(this.geo(g), mat);
      m.receiveShadow = this.profile.shadows;
      this.scene.add(m);
    }
  }

  /**
   * Coins arrondis aux carrefours du quadrillage : la chaussée s'évase en arc de cercle et le trottoir suit la courbe,
   * à chaque coin où les deux routes continuent (pas du côté où une avenue s'arrête).
   */
  private buildCornerFillets(roadMat: THREE.Material, walkMat: THREE.Material): void {
    const R = 4.5;
    const W = 1.1; // largeur du trottoir
    const hw = ROAD_W / 2;
    const STEPS = 10;
    const asphalt: number[] = [];
    const walk: number[] = [];
    // Triangle orienté vers le haut quel que soit le coin (le miroir d'un coin inverse le sens des sommets)
    const tri = (out: number[], y: number, a: [number, number], b: [number, number], c: [number, number]) => {
      const up = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0;
      const [p, q] = up ? [b, c] : [c, b];
      out.push(a[0], y, a[1], p[0], y, p[1], q[0], y, q[1]);
    };
    for (const rz of ROADS_Z) {
      for (const rx of ROADS_X) {
        const endZ = rx === 0 ? EYADEMA_END_Z : ROAD_END_Z - hw;
        if (rz < endZ || rx > roadEastEnd(rz)) continue;
        const cx = rx + bend(rx, rz);
        const cz = rz + bend(rz, rx);
        for (const sx of [-1, 1] as const) {
          for (const sz of [-1, 1] as const) {
            // L'avenue continue-t-elle de ce côté (vers la mer ou vers le nord) et le boulevard de l'autre ?
            if (sz === 1 && rz >= COAST_Z) continue;
            if (sz === -1 && rz - ROAD_W <= endZ) continue;
            if (sx === 1 && rx + ROAD_W >= roadEastEnd(rz)) continue;
            // Repère du coin : origine au coin des deux bords de chaussée, axes vers l'intérieur du pâté de maisons
            const ox = cx + sx * hw;
            const oz = cz + sz * hw;
            const at = (u: number, v: number): [number, number] => [ox + sx * u, oz + sz * v];
            const arc = (r: number, k: number): [number, number] => {
              const a = (Math.PI / 2) * (k / STEPS);
              return at(R - r * Math.cos(a), R - r * Math.sin(a));
            };
            for (let k = 0; k < STEPS; k++) {
              // Chaussée : entre le coin et l'arc de rayon R (centré à (R, R) dans le pâté)
              tri(asphalt, 0.019, at(0, 0), arc(R, k), arc(R, k + 1));
              // Trottoir : bande entre les rayons R − W et R
              tri(walk, 0.017, arc(R, k), arc(R - W, k), arc(R - W, k + 1));
              tri(walk, 0.017, arc(R, k), arc(R - W, k + 1), arc(R, k + 1));
            }
          }
        }
      }
    }
    for (const [pos, mat] of [[asphalt, roadMat], [walk, walkMat]] as const) {
      if (pos.length === 0) continue;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const uv: number[] = [];
      for (let i = 0; i < pos.length; i += 3) uv.push(pos[i]! / 6, pos[i + 2]! / 6);
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.computeVertexNormals();
      const m = new THREE.Mesh(this.geo(g), mat);
      m.receiveShadow = this.profile.shadows;
      this.scene.add(m);
    }
  }

  private addStrip(pts: [number, number][], width: number, mat: THREE.Material, y: number | ((x: number, z: number) => number)): void {
    const pos: number[] = [];
    const idx: number[] = [];
    pts.forEach(([x, z], i) => {
      const [px, pz] = pts[Math.max(0, i - 1)]!;
      const [nx, nz] = pts[Math.min(pts.length - 1, i + 1)]!;
      const len = Math.hypot(nx - px, nz - pz) || 1;
      const ox = (-(nz - pz) / len) * (width / 2);
      const oz = ((nx - px) / len) * (width / 2);
      const h = typeof y === 'number' ? y : y(x, z);
      pos.push(x + ox, h, z + oz, x - ox, h, z - oz);
      if (i > 0) {
        const k = i * 2;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    // Coordonnées de texture en mètres (1 répétition tous les 6 m) : asphalte et béton sans étirement
    const uv: number[] = [];
    for (let i = 0; i < pos.length; i += 3) uv.push(pos[i]! / 6, pos[i + 2]! / 6);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setIndex(idx);
    g.computeVertexNormals();
    // Les normales doivent pointer vers le ciel quel que soit le sens de la polyligne
    const n = g.getAttribute('normal');
    if (n.count > 0 && n.getY(0) < 0) {
      idx.reverse();
      g.setIndex(idx);
      g.computeVertexNormals();
    }
    const m = new THREE.Mesh(this.geo(g), mat);
    m.receiveShadow = this.profile.shadows;
    this.scene.add(m);
  }

  /** Point sur une route au sol (le contournement, qui passe sur les ponts, n'en fait pas partie) : pour placer les piles. */
  private groundRoadAt(x: number, z: number, margin: number): boolean {
    if (ROADS_X.some((rx) => (rx === 0 || z > ROAD_END_Z - ROAD_W) && z < 14 + ROAD_W && Math.abs(rx + bend(rx, z) - x) < ROAD_W / 2 + margin)) return true;
    if (ROADS_Z.some((rz) => x <= roadEastEnd(rz) + ROAD_W / 2 && Math.abs(rz + bend(rz, x) - z) < ROAD_W / 2 + margin)) return true;
    return CITY_ROADS.some((r) => r !== GRAND_BYPASS && r.slice(1).some((b, i) => segDist(x, z, r[i]!, b) < ROAD_W / 2 + margin));
  }

  /** Point sur une route ou son trottoir (marge en mètres au-delà de la chaussée). */
  private onRoad(x: number, z: number, margin: number): boolean {
    if (ROADS_X.some((rx) => (rx === 0 || z > ROAD_END_Z - ROAD_W) && z < 14 + ROAD_W && Math.abs(rx + bend(rx, z) - x) < ROAD_W / 2 + margin)) return true;
    if (ROADS_Z.some((rz) => x <= roadEastEnd(rz) + ROAD_W / 2 && Math.abs(rz + bend(rz, x) - z) < ROAD_W / 2 + margin)) return true;
    // Rues secondaires : segments à plat, indexés par case de 24 m (marge d'au plus 6 m) ; au-delà, balayage complet
    const { all, grid } = citySegmentIndex();
    const near = margin <= ROAD_SEG_MARGIN ? grid.get(Math.floor(x / ROAD_SEG_CELL) * 100003 + Math.floor(z / ROAD_SEG_CELL)) : all;
    if (!near) return false;
    const reach = ROAD_W / 2 + margin;
    for (const [ax, az, bx, bz] of near) {
      const dx = bx - ax;
      const dz = bz - az;
      const k = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1)));
      if (Math.hypot(x - ax - k * dx, z - az - k * dz) < reach) return true;
    }
    return false;
  }

  private isFree(x: number, z: number, margin: number): boolean {
    return this.freeBase(x, z, margin) && !this.access().some(([a, b]) => segDist(x, z, a, b) < ROAD_W / 2 + margin);
  }

  /** Routes d'accès aux zones de terrain à vendre : du point de route le plus proche jusqu'au bord de la zone, par un tracé dégagé. */
  private accessRoads: [[number, number], [number, number]][] | null = null;
  private access(): [[number, number], [number, number]][] {
    if (this.accessRoads) return this.accessRoads;
    const out: [[number, number], [number, number]][] = [];
    const samples = roadSamples();
    // Cibles : les zones de terrain à vendre et les lieux posés en rase campagne (studios), jusqu'à leur parvis
    const targets: { id: string; venue?: string; x0: number; x1: number; z0: number; z1: number }[] = [];
    for (const lz of this.opts.land ?? []) {
      if (lz.water) continue; // en mer : pas de route d'accès
      const g = lz.layout;
      const m = lz.margin ?? 6;
      targets.push({ id: lz.id, x0: g.originX - m, x1: g.originX + g.cols * g.cell + m, z0: g.originZ - m, z1: g.originZ + (lz.planRows ?? g.rows) * g.cell + m });
    }
    for (const v of this.opts.venues) {
      const f = FOOTPRINT[v.id];
      // Lavage : la voie de l'avenue s'arrête au nord-est de l'aire, sans la toucher ; une allée mène ensuite à l'entrée nord
      if (v.id === 'lavage_auto') targets.push({ id: `v:${v.id}`, venue: v.id, x0: v.x + 10, x1: v.x + 10, z0: v.z - 11, z1: v.z - 11 });
      else if (f && COUNTRY_VENUES.has(v.id)) targets.push({ id: `v:${v.id}`, venue: v.id, x0: v.x - f.hw, x1: v.x + f.hw, z0: v.z - f.back, z1: v.z + ENTRY });
    }
    for (const lz of targets) {
      const { x0, x1, z0, z1 } = lz;
      const ranked = samples
        .map((p) => {
          const cx = Math.max(x0, Math.min(x1, p[0]));
          const cz = Math.max(z0, Math.min(z1, p[1]));
          return { p, cx, cz, d: Math.hypot(p[0] - cx, p[1] - cz) };
        })
        .filter((s) => s.d < 170)
        .sort((a, b) => a.d - b.d);
      // Déjà au bord d'une route : rien à tracer
      if (ranked.length === 0 || ranked[0]!.d < 3) continue;
      // Tracé le plus court qui ne touche ni bâtiment ni lagune ; marge réduite si rien n'est assez dégagé
      let done = false;
      for (const clear of [1.5, 0.5, -0.8]) {
        for (const s of ranked.slice(0, 200)) {
          let ok = true;
          for (let t = 0; t <= s.d && ok; t += 2) {
            const x = s.p[0] + ((s.cx - s.p[0]) * t) / s.d;
            const z = s.p[1] + ((s.cz - s.p[1]) * t) / s.d;
            ok = this.onRoad(x, z, 1.6) || this.freeBase(x, z, clear, lz.id, lz.venue);
          }
          if (ok) {
            out.push([s.p, [s.cx, s.cz]]);
            done = true;
            break;
          }
        }
        if (done) break;
      }
    }
    return (this.accessRoads = out);
  }

  /** Trace les routes d'accès aux zones de terrain : même chaussée et même accotement que les rues. */
  private buildLandAccess(): void {
    const roadMat = this.surface('#7d8693', 0.22, 'asphalt');
    const walkMat = this.surface('#b8b19f', 0.14, 'concrete');
    for (const [a, b] of this.access()) {
      this.addStrip([a, b], ROAD_W - 1 + 2.2, walkMat, 0.012);
      this.addStrip([a, b], ROAD_W - 1, roadMat, 0.022);
    }
  }

  private freeBase(x: number, z: number, margin: number, skipZone?: string, skipVenue?: string): boolean {
    if (inLagoon(x, z, margin + 2)) return false;
    if (ROADS_X.some((rx) => (rx === 0 || z > ROAD_END_Z - ROAD_W) && Math.abs(rx + bend(rx, z) - x) < ROAD_W / 2 + margin)) return false;
    if (ROADS_Z.some((rz) => x <= roadEastEnd(rz) + ROAD_W / 2 && Math.abs(rz + bend(rz, x) - z) < ROAD_W / 2 + margin)) return false;
    if (CITY_ROADS.some((r) => r.slice(1).some((b, i) => segDist(x, z, r[i]!, b) < ROAD_W / 2 + margin))) return false;
    if (Math.hypot(x - CITY_RING.x, z - CITY_RING.z) < CITY_RING.R + 2 + margin) return false;
    // Lieu, parvis et place de la caméra de rue restent dégagés
    if (this.brandSpots.some((b) => Math.abs(b.x - x) < 8 && Math.abs(b.z - z) < 8)) return false;
    // Espaces VIP libres : ni arbre ni maison de décor dessus, pour qu'on les voie bien depuis le dessus
    if ((this.opts.vipSpots ?? []).some((v) => Math.abs(v.x - x) < (v.tier === 'BRONZE' ? 6.5 : v.tier === 'SILVER' ? 8.5 : 12.5) + margin && Math.abs(v.z - z) < (v.tier === 'BRONZE' ? 5.5 : v.tier === 'SILVER' ? 7.5 : 9.5) + margin)) return false;
    // Zones de terrain à vendre (lotissement compris) : ni arbre ni maison de décor dessus
    for (const lz of this.opts.land ?? []) {
      if (lz.id === skipZone) continue;
      const g = lz.layout;
      if (x > g.originX - 4 && x < g.originX + g.cols * g.cell + 4 && z > g.originZ - 4 && z < g.originZ + (lz.planRows ?? g.rows) * g.cell + 4) return false;
    }
    return ![this.opts.home, ...this.opts.venues].some((v) => {
      if (v.id === skipVenue || v.id.startsWith('brand_')) return false;
      // Aéroport : la piste est tournée (04/22), on teste dans son propre repère pour ne rien bâtir dessus
      if (v.id === 'aeroport') {
        const dx = x - v.x;
        const dz = z - v.z;
        const c = Math.cos(AIRPORT_ROT);
        const sn = Math.sin(AIRPORT_ROT);
        const lx = (dx * c - dz * sn) / AIRPORT_SCALE;
        const lz = (dx * sn + dz * c) / AIRPORT_SCALE;
        return lx > -72 - margin && lx < 76 + margin && lz > -31 - margin && lz < 32 + margin;
      }
      const f = FOOTPRINT[v.id] ?? { hw: 12, back: 12 };
      const [lx, lz] = rotateXZ(x - v.x, z - v.z, -venueYaw(v.id));
      return Math.abs(lx) < f.hw + margin && lz > -f.back - margin && lz < (f.front ?? ENTRY + 14) + margin;
    });
  }

  private buildHouses(): void {
    const r = rng(228);
    const spots: { x: number; z: number; w: number; d: number; h: number; floors: number; shop: number }[] = [];
    for (let z = MIN_Z + 4; z <= 6; z += 9) {
      for (let x = MIN_X + 4; x <= CITY_BUILD_MAX_X - 4; x += 9) {
        const jx = x + (r() - 0.5) * 1.6;
        const jz = z + (r() - 0.5) * 1.6;
        if (r() < 0.08) continue;
        // Du pavillon d'un niveau en périphérie aux immeubles de 6 niveaux autour de la place de l'Indépendance
        const core = Math.hypot(jx, jz + 50);
        const u = r();
        const nearStadium = Math.hypot(jx - 82, jz + 204) < 62;
        const floors0 = core < 55 ? (u < 0.1 ? 1 : u < 0.25 ? 2 : u < 0.45 ? 3 : u < 0.65 ? 4 : u < 0.83 ? 5 : 6)
          : core < 115 ? (u < 0.3 ? 1 : u < 0.6 ? 2 : u < 0.8 ? 3 : u < 0.92 ? 4 : 5)
            : (u < 0.55 ? 1 : u < 0.85 ? 2 : u < 0.97 ? 3 : 4);
        // Autour du stade de Kégué : quartier dense de petits immeubles et de tours (4 à 8 niveaux)
        const floors = nearStadium ? 4 + Math.floor(r() * 5) : floors0;
        const w = floors >= 4 ? 6.2 + r() * 0.8 : 4.5 + r() * 2;
        const d = floors >= 4 ? 6.2 + r() * 0.8 : 4.5 + r() * 2;
        // On teste toute la concession (mur compris), pas seulement son centre. C'est ce qui
        // empêche une maison ou un portail d'empiéter sur une route diagonale.
        const clearance = Math.hypot(w + 1.8, d + 1.8) / 2 + 1.2;
        if (!this.isFree(jx, jz, clearance)) continue;
        // Quartier d'affaires Ouest : réservé aux bâtiments des partenaires Or et Argent, pas de maisons de décor
        if (jx < -90 && jz > -245 && jz < 22) continue;
        // Parcelle donnant sur un boulevard : rez-de-chaussée commerçant (vitrine, auvent rayé, enseigne)
        const gap = ROADS_Z.reduce((best, rz) => (rz > jz && jx <= roadEastEnd(rz) && rz - jz < best ? rz - jz : best), Infinity) - (d + 1.8) / 2;
        const shop = gap >= 4.6 && gap <= 11 && r() < 0.75 ? SHOP_COLORS[Math.floor(r() * SHOP_COLORS.length)]! : 0;
        spots.push({ x: jx, z: jz, w, d, h: 2.8 * floors + r() * 0.6, floors, shop });
      }
    }
    this.houseSpots = spots.map((s) => ({ ...s, tint: WALLS[Math.floor(r() * WALLS.length)]! }));
    const n = spots.length;
    const plots = this.instanced(new THREE.BoxGeometry(1, 0.1, 1), this.mats.color(C.plot), n, false);
    const walls = this.instanced(new THREE.BoxGeometry(1, 1, 1), this.mats.color(0xffffff), n);
    const roofs = this.instanced(new THREE.BoxGeometry(1, 0.35, 1), this.mats.color(0xffffff), n);
    const doors = this.instanced(new THREE.BoxGeometry(0.9, 1.7, 0.08), this.mats.color(0x3d5a80), n, false);
    const winMat = new THREE.MeshLambertMaterial({ color: 0x6f9fd8, emissive: 0xffc861, emissiveIntensity: 0 });
    this.nightMaterials.push(winMat);
    const windows = this.instanced(new THREE.BoxGeometry(0.8, 0.7, 0.06), winMat, n * 14, false);
    const tanks = this.instanced(new THREE.CylinderGeometry(0.45, 0.45, 0.9, 8), this.mats.color(0x1b1b1b), n, false);
    let w = 0;
    let t = 0;
    // Concession togolaise : mur de clôture en parpaing, piliers, portail en tôle peinte, plaque de numéro
    const fence = this.instanced(new THREE.BoxGeometry(1, 1, 1), this.mats.color(0xe9e4d8), n * 5, false);
    const pillars = this.instanced(new THREE.BoxGeometry(0.5, 2.3, 0.5), this.mats.color(0xf6f3ec), n * 2, false);
    const gates = this.instanced(new THREE.BoxGeometry(1, 1.9, 0.12), this.mats.color(0xffffff), n, false);
    const plates = this.instanced(new THREE.BoxGeometry(0.42, 0.3, 0.04), this.mats.color(0x1f4e9c), n, false);
    const shutters = this.instanced(new THREE.BoxGeometry(0.32, 0.8, 0.08), this.mats.color(0xffffff), n * 26, false);
    const legs = this.instanced(new THREE.BoxGeometry(0.12, 2.6, 0.12), this.mats.color(0x3a3f47), n * 4, false);
    const frames = this.instanced(new THREE.BoxGeometry(1, 1, 1), this.mats.color(0x9aa1a8), n * 6, false);
    // Vitrines, auvents rayés, enseignes et marchandises des boutiques en bord de route
    const shopMat = new THREE.MeshLambertMaterial({ color: 0x7fb8d6, emissive: 0xffe08a, emissiveIntensity: 0 });
    this.nightMaterials.push(shopMat);
    const shopGlass = this.instanced(new THREE.BoxGeometry(1, 1, 1), shopMat, n, false);
    const awnings = this.instanced(new THREE.BoxGeometry(1, 1, 1), this.mats.color(0xffffff), n * 4, false);
    const signs = this.instanced(new THREE.BoxGeometry(1, 1, 1), this.mats.color(0xffffff), n, false);
    const goods = this.instanced(new THREE.BoxGeometry(1, 1, 1), this.mats.color(0xffffff), n * 3, false);
    let sg = 0;
    let aw = 0;
    let gd = 0;
    const GATES = [0x1f4e9c, 0xd21034, 0x22a861, 0x14213d, 0x6d3b1f, 0x9aa3ad];
    const SHUTTERS = [0x2f6fa8, 0x22a861, 0xc0392b, 0x8e5b2e, 0xf1c40f];
    // Relief des façades : encadrements et appuis de fenêtres, bandeaux d'étage, balcons, auvent d'entrée, toits en tôle
    const trims = this.instanced(new THREE.BoxGeometry(1, 1, 1), this.mats.color(0xf6f3ec), n * 44, false);
    const rails = this.instanced(new THREE.BoxGeometry(1, 1, 1), this.mats.color(0x3a3f47), n * 12, false);
    const tin = this.instanced(new THREE.CylinderGeometry(1, 1, 1, 3, 1), this.mats.color(0x9aa3ad), n, false);
    // Immeubles (3 niveaux et plus) : acrotère clair, cage d'escalier, groupes de climatisation, antenne, fenêtres sur les côtés
    const parapets = this.instanced(new THREE.BoxGeometry(1, 1, 1), this.mats.color(0xffffff), n * 4, false);
    const roofGear = this.instanced(new THREE.BoxGeometry(1, 1, 1), this.mats.color(0xffffff), n * 5, false);
    const sideMat = new THREE.MeshLambertMaterial({ color: 0x6f9fd8, emissive: 0xffc861, emissiveIntensity: 0 });
    this.nightMaterials.push(sideMat);
    const sideWins = this.instanced(new THREE.BoxGeometry(0.06, 0.7, 0.8), sideMat, n * 24, false);
    let pa = 0;
    let rg = 0;
    let sw = 0;
    let tr = 0;
    let rl = 0;
    let tn = 0;
    let fw = 0;
    let st = 0;
    let lg = 0;
    let fr = 0;
    spots.forEach((s, i) => {
      this.setInstance(plots, i, s.x, 0.05, s.z, s.w + 1.8, 1, s.d + 1.8);
      const pw = s.w + 1.8;
      const pd = s.d + 1.8;
      const fz = s.z + pd / 2;
      const gw = 2.4;
      const side = (pw - gw) / 2;
      if (!s.shop) {
        this.setInstance(fence, fw++, s.x - gw / 2 - side / 2, 0.9, fz, side, 1.8, 0.22);
        this.setInstance(fence, fw++, s.x + gw / 2 + side / 2, 0.9, fz, side, 1.8, 0.22);
      }
      this.setInstance(fence, fw++, s.x - pw / 2, 0.9, s.z, 0.22, 1.8, pd);
      this.setInstance(fence, fw++, s.x + pw / 2, 0.9, s.z, 0.22, 1.8, pd);
      this.setInstance(fence, fw++, s.x, 0.9, s.z - pd / 2, pw, 1.8, 0.22);
      if (s.shop) {
        // Pas de portail : le mur de façade est remplacé par la boutique
        for (const [m, k] of [[pillars, i * 2], [pillars, i * 2 + 1], [gates, i], [plates, i]] as const) this.setInstance(m, k, s.x, -9, fz, 0, 0, 0);
        const sz = s.z + (s.d / 2) * 1.08;
        this.setInstance(shopGlass, sg++, s.x, 1.25, sz + 0.1, s.w * 0.86, 2, 0.08);
        for (let a = 0; a < 4 && aw < n * 4; a++) {
          const aid = aw++;
          this.setInstance(awnings, aid, s.x - s.w * 0.55 + (a + 0.5) * ((s.w * 1.1) / 4), 2.75, sz + 0.75, (s.w * 1.1) / 4, 0.1, 1.5);
          awnings.setColorAt(aid, this.tmp.c.setHex(a % 2 === 0 ? s.shop : 0xffffff));
        }
        this.setInstance(signs, sg - 1, s.x, 3.25, sz + 0.12, s.w * 0.95, 0.55, 0.12);
        signs.setColorAt(sg - 1, this.tmp.c.setHex(0x14213d));
        for (let g = 0; g < 3 && gd < n * 3; g++) {
          const gid = gd++;
          this.setInstance(goods, gid, s.x - s.w * 0.3 + g * s.w * 0.3, 0.3, sz + 1.1, 0.7, 0.6, 0.6);
          goods.setColorAt(gid, this.tmp.c.setHex(SHOP_COLORS[(g + i) % SHOP_COLORS.length]!));
        }
      } else {
        this.setInstance(pillars, i * 2, s.x - gw / 2 - 0.25, 1.15, fz);
        this.setInstance(pillars, i * 2 + 1, s.x + gw / 2 + 0.25, 1.15, fz);
        this.setInstance(gates, i, s.x, 0.95, fz, gw, 1, 1);
        gates.setColorAt(i, this.tmp.c.setHex(GATES[Math.floor(r() * GATES.length)]!));
        this.setInstance(plates, i, s.x - gw / 2 - 0.25, 1.75, fz + 0.27);
      }
      // Maison inachevée (poteaux et dalle en béton brut, fers en attente) : un classique des quartiers
      if (s.floors > 1 && r() < 0.12 && fr < n * 6 - 6) {
        const top = s.h;
        for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const) this.setInstance(frames, fr++, s.x + (dx * s.w) / 2.3, top + 1.4, s.z + (dz * s.d) / 2.3, 0.35, 2.8, 0.35);
        this.setInstance(frames, fr++, s.x, top + 2.9, s.z, s.w, 0.25, s.d);
      }
      this.setInstance(walls, i, s.x, s.h / 2, s.z, s.w, s.h, s.d);
      this.solid(s.x, s.z, s.w * 1.15, s.d * 1.15, s.h + 0.4);
      walls.setColorAt(i, this.tmp.c.setHex(WALLS[Math.floor(r() * WALLS.length)]!));
      this.setInstance(roofs, i, s.x, s.h + 0.17, s.z, s.w + 0.4, 1, s.d + 0.4);
      roofs.setColorAt(i, this.tmp.c.setHex(s.floors >= 3 ? [0xb8bec6, 0xc4c0b6, 0xa9b0ba][i % 3]! : ROOFS[Math.floor(r() * ROOFS.length)]!));
      if (s.floors >= 3 && pa + 4 <= n * 4 && rg + 4 <= n * 5) {
        // Acrotère tout autour du toit-terrasse, plus clair que la dalle
        const py = s.h + 0.62;
        const tone = WALLS[(i * 5 + 3) % WALLS.length]!;
        for (const [px, pz, pw2, pd2] of [[s.x, s.z + (s.d + 0.4) / 2, s.w + 0.5, 0.2], [s.x, s.z - (s.d + 0.4) / 2, s.w + 0.5, 0.2], [s.x - (s.w + 0.4) / 2, s.z, 0.2, s.d + 0.4], [s.x + (s.w + 0.4) / 2, s.z, 0.2, s.d + 0.4]] as const) {
          this.setInstance(parapets, pa, px, py, pz, pw2, 0.55, pd2);
          parapets.setColorAt(pa++, this.tmp.c.setHex(tone));
        }
        // Cage d'escalier, climatiseurs et antenne
        this.setInstance(roofGear, rg, s.x - s.w / 4, s.h + 1.2, s.z + s.d / 4, 1.5, 1.7, 1.5);
        roofGear.setColorAt(rg++, this.tmp.c.setHex(0xd9d4c8));
        this.setInstance(roofGear, rg, s.x + s.w / 4, s.h + 0.85, s.z + s.d / 4, 1.0, 0.7, 0.6);
        roofGear.setColorAt(rg++, this.tmp.c.setHex(0xdfe3e8));
        this.setInstance(roofGear, rg, s.x + s.w / 4 + 1.1, s.h + 0.8, s.z + s.d / 4, 0.7, 0.6, 0.6);
        roofGear.setColorAt(rg++, this.tmp.c.setHex(0xdfe3e8));
        this.setInstance(roofGear, rg, s.x - s.w / 3, s.h + 2.4, s.z - s.d / 3, 0.07, 3.6, 0.07);
        roofGear.setColorAt(rg++, this.tmp.c.setHex(0x555b63));
        // Fenêtres sur les deux côtés de chaque niveau
        for (let f = 0; f < s.floors && sw + 4 <= n * 24; f++) {
          const wy = 1.6 + f * 2.8;
          for (const sx of [-1, 1] as const) for (const oz of [-s.d / 4, s.d / 4]) this.setInstance(sideWins, sw++, s.x + sx * (s.w / 2 + 0.04), wy, s.z + oz);
        }
      }
      this.setInstance(doors, i, s.x, 0.85, s.z + s.d / 2 + 0.03);
      if (tr < n * 44) this.setInstance(trims, tr++, s.x, 2.05, s.z + s.d / 2 + 0.45, 1.8, 0.1, 0.9); // auvent d'entrée
      // Maison basse : toit à deux pentes en tôle ondulée au lieu du toit-terrasse
      if (s.floors === 1 && r() < 0.6) {
        // Prisme à 3 pans couché selon la profondeur, faîtage vers le haut
        const m = new THREE.Matrix4().compose(this.tmp.v.set(s.x, s.h + 0.75, s.z), this.tmp.q.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2), new THREE.Vector3((s.w + 0.6) / 1.732, s.d + 0.6, 0.8));
        tin.setMatrixAt(tn++, m);
      }
      for (let f = 0; f < s.floors && w < n * 14 - 1; f++) {
        const y = 1.6 + f * 2.8;
        this.setInstance(windows, w++, s.x - s.w / 4 - 0.2, y, s.z + s.d / 2 + 0.04);
        this.setInstance(windows, w++, s.x + s.w / 4 + 0.2, y, s.z + s.d / 2 + 0.04);
        for (const wx of [s.x - s.w / 4 - 0.2, s.x + s.w / 4 + 0.2]) {
          if (tr > n * 44 - 2) break;
          this.setInstance(trims, tr++, wx, y, s.z + s.d / 2 + 0.03, 1.0, 0.9, 0.08); // encadrement
          this.setInstance(trims, tr++, wx, y - 0.45, s.z + s.d / 2 + 0.1, 1.1, 0.08, 0.22); // appui
        }
        if (f > 0 && tr < n * 44) this.setInstance(trims, tr++, s.x, f * 2.8 + 0.1, s.z, s.w + 0.16, 0.18, s.d + 0.16); // bandeau d'étage
        if (f >= 1 && f % 2 === 1 && rl < n * 12 - 2 && tr < n * 44) {
          // Balcon un étage sur deux : dalle en saillie et garde-corps métallique
          const by = f * 2.8 + 0.05;
          this.setInstance(trims, tr++, s.x, by, s.z + s.d / 2 + 0.6, s.w * 0.6, 0.15, 1.2);
          this.setInstance(rails, rl++, s.x, by + 0.5, s.z + s.d / 2 + 1.17, s.w * 0.6, 0.9, 0.05);
          this.setInstance(rails, rl++, s.x, by + 0.9, s.z + s.d / 2 + 1.17, s.w * 0.6, 0.06, 0.08);
        }
        // Persiennes colorées de part et d'autre des fenêtres
        const sc = SHUTTERS[i % SHUTTERS.length]!;
        for (const wx of [s.x - s.w / 4 - 0.2, s.x + s.w / 4 + 0.2]) {
          for (const dx of [-0.58, 0.58]) {
            if (st >= n * 26) break;
            this.setInstance(shutters, st, wx + dx, y, s.z + s.d / 2 + 0.06);
            shutters.setColorAt(st++, this.tmp.c.setHex(sc));
          }
        }
      }
      // Polytank noir sur le toit : un classique de Lomé
      // Polytank noir : sur le toit, ou dans la cour sur une tour métallique
      if (r() < 0.35) this.setInstance(tanks, t++, s.x + s.w / 4, s.h + 0.8, s.z - s.d / 4);
      else if (r() < 0.3 && lg < n * 4 - 4) {
        const tx = s.x + pw / 2 - 0.9;
        const tz = s.z - pd / 2 + 0.9;
        for (const [dx, dz] of [[-0.4, -0.4], [0.4, -0.4], [-0.4, 0.4], [0.4, 0.4]] as const) this.setInstance(legs, lg++, tx + dx, 1.3, tz + dz);
        this.setInstance(tanks, t++, tx, 3.05, tz);
      }
    });
    windows.count = w;
    parapets.count = Math.max(1, pa);
    roofGear.count = Math.max(1, rg);
    sideWins.count = Math.max(1, sw);
    for (const m of [parapets, roofGear]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    shopGlass.count = sg;
    awnings.count = aw;
    goods.count = gd;
    signs.count = sg;
    for (const m of [awnings, signs, goods]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    tanks.count = Math.max(1, t);
    fence.count = fw;
    trims.count = Math.max(1, tr);
    rails.count = Math.max(1, rl);
    tin.count = Math.max(1, tn);
    tin.instanceMatrix.needsUpdate = true;
    shutters.count = Math.max(1, st);
    legs.count = Math.max(1, lg);
    frames.count = Math.max(1, fr);
    for (const m of [gates, shutters]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
    // Poteaux électriques en bois et fils le long des boulevards
    const poles: [number, number][] = [];
    const addPole = (x: number, z: number) => {
      // Le fût entier garde une marge avec chaussées, murs et emprises de carrefour.
      if (!this.onRoad(x, z, 1.1) && !this.blocked(x, z, 0.65) && this.isFree(x, z, 0.65)) poles.push([x, z]);
    };
    for (const z of ROADS_Z) for (let x = MIN_X; x <= roadEastEnd(z); x += 16) {
      if (!ROADS_X.some((rx) => Math.abs(rx - x) < 8)) addPole(x, z - ROAD_W / 2 - 2.1 + bend(z, x));
    }
    for (let z = ROAD_END_Z; z >= EYADEMA_END_Z; z -= 16) {
      if (Math.abs(z - PRES_ROAD_Z) > 9 && Math.abs(z - KEGUE_Z) > 9 && Math.abs(z - AGOE_Z) > 12) addPole(ROAD_W / 2 + 2.1 + bend(0, z) + gtaBump(z), z);
    }
    const pole = this.instanced(new THREE.CylinderGeometry(0.12, 0.16, 8, 6), this.mats.color(0x6b4f35), poles.length, false);
    const arm = this.instanced(new THREE.BoxGeometry(1.6, 0.12, 0.12), this.mats.color(0x5b4330), poles.length, false);
    const wire = this.instanced(new THREE.BoxGeometry(1, 0.03, 0.03), this.mats.color(0x1b1b1b), poles.length * 3, false);
    let wi = 0;
    poles.forEach(([x, z], i) => {
      this.setInstance(pole, i, x, 4, z);
      const prev = poles[i - 1];
      const alongZ = Math.abs(x - (prev?.[0] ?? x)) < 3;
      this.setInstance(arm, i, x, 7.6, z, 1, 1, 1, alongZ ? 0 : Math.PI / 2);
      if (prev && Math.hypot(prev[0] - x, prev[1] - z) < 20) {
        const len = Math.hypot(prev[0] - x, prev[1] - z);
        const rot = -Math.atan2(prev[1] - z, prev[0] - x);
        for (const k of [-0.6, 0, 0.6]) {
          const ox = alongZ ? k : 0;
          const oz = alongZ ? 0 : k;
          this.setInstance(wire, wi++, (x + prev[0]) / 2 + ox, 7.45, (z + prev[1]) / 2 + oz, len, 1, 1, rot);
        }
      }
    });
    wire.count = Math.max(1, wi);
    this.houseMeshes.push(walls, roofs, doors, windows, trims, rails, tin, shutters, frames, parapets, roofGear, sideWins);
    if (walls.instanceColor) walls.instanceColor.needsUpdate = true;
    if (roofs.instanceColor) roofs.instanceColor.needsUpdate = true;
  }

  private buildTrees(): void {
    const r = rng(1960);
    const pts: [number, number][] = [];
    // Cocotiers de la plage, sauf sur le terre-plein et entre les digues du Port
    const port = this.opts.venues.find((v) => v.id === 'port');
    for (let x = MIN_X; x <= MAX_X; x += 8) {
      const px = x + r() * 3;
      const pz = 21 + r() * 7;
      if (!port || Math.abs(px - (port.x + 1)) > 36) pts.push([px, pz]);
    }
    for (const z of ROADS_Z) for (let x = MIN_X; x <= roadEastEnd(z); x += 14) if (this.isFree(x, z - 5.5, 0)) pts.push([x + r() * 2, z - 5.5 + bend(z, x)]);
    for (const x of ROADS_X) for (let z = ROAD_END_Z; z <= 4; z += 14) if (this.isFree(x + 5 + bend(x, z), z, 0)) pts.push([x + 5 + bend(x, z), z + r() * 2]);
    const list = pts.slice(0, this.profile.trees * 3);
    this.plantTrees(
      list.map(([x, z]) => {
        // Plage : cocotiers ; ailleurs, feuillus (manguiers, neems) une fois sur deux, sinon palmiers
        if (z > 18 || r() >= 0.55) return { x, z, kind: 'palm' as const, h: 5 + r() * 3.2, s: 1 };
        return { x, z, kind: r() < 0.5 ? ('mango' as const) : ('neem' as const), h: 2.4 + r() * 1.6, s: 2 + r() * 1.3 };
      }),
      1960,
    );
  }

  /**
   * Boulevard Gnassingbé Eyadéma (axe nord-sud, du dernier boulevard jusqu'à Agoè) : alignement d'arbres des deux côtés,
   * neems, flamboyants et palmiers en alternance, comme sur le boulevard réel. Ils s'écartent des carrefours, des
   * poteaux, des parvis et des bâtiments.
   */
  private buildBoulevardTrees(): void {
    const r = rng(2026);
    type T = { x: number; z: number; kind: 'neem' | 'flame' | 'palm'; h: number; s: number };
    const list: T[] = [];
    // Allée dense : un arbre tous les 4,5 m de chaque côté, et une seconde rangée en retrait pour un feuillage continu
    for (let z = ROAD_END_Z - 6; z >= EYADEMA_END_Z + 6; z -= 4.5) {
      const cx = bend(0, z) + gtaBump(z);
      for (const side of [-1, 1] as const) {
        // Hors de la ville (au nord de la limite de la maquette dense), la RN1 n'a plus qu'un alignement clairsemé
        const rural = z < MIN_Z;
        for (const [off, keep] of [[side < 0 ? 6.6 : 8.4, rural ? 0.22 : 1], [side < 0 ? 11.6 : 13.4, rural ? 0 : 0.65]] as const) {
          if (r() > keep) continue;
          const x = cx + side * off;
          const zz = z + (r() - 0.5) * 2.4;
          if (!this.isFree(x, zz, 1.2) || this.blocked(x, zz, 1) || this.onRoad(x, zz, 0.3)) continue;
          const u = r();
          list.push({ x, z: zz, kind: u < 0.5 ? 'neem' : u < 0.72 ? 'flame' : 'palm', h: 3.2 + r() * 1.6, s: 2 + r() * 1.2 });
        }
      }
    }
    this.plantTrees(list.map((t) => (t.kind === 'palm' ? { ...t, h: t.h + 2.6 } : t)), 2026);
  }

  private setInstanceE(m: THREE.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx: number, ry: number, rz: number): void {
    const t = this.tmp;
    t.q.setFromEuler(this.treeEuler.set(rx, ry, rz));
    t.m.compose(t.v.set(x, y, z), t.q, t.s.set(sx, sy, sz));
    m.setMatrixAt(i, t.m);
  }
  private readonly treeEuler = new THREE.Euler(0, 0, 0, 'YXZ');

  /**
   * Arbres plus vrais : tronc effilé et légèrement penché, charpentières, houppier fait de plusieurs boules de feuillage aux verts
   * variés (neem dense et sombre, manguier en dôme, flamboyant en parasol rouge et vert), cocotiers au tronc courbé avec
   * neuf palmes retombantes et des noix. Tout est instancié : quelques appels de dessin pour des centaines d'arbres.
   */
  private plantTrees(all: { x: number; z: number; kind: 'neem' | 'mango' | 'flame' | 'palm'; h: number; s: number }[], seed: number): void {
    // Aucun arbre sur le point d'arrivée d'un lieu ni juste à côté : le joueur ne doit pas arriver sous un feuillage
    const doors = this.opts.venues.map((v) => this.entryOf(v));
    const mon = this.opts.venues.find((v) => v.id === 'monument');
    const list = all.filter((t) => !doors.some((d) => Math.hypot(t.x - d.x, t.z - d.z) < 6.5 + t.s) && !(mon && Math.hypot(t.x - mon.x, t.z - mon.z) < 21));
    if (list.length === 0) return;
    const r = rng(seed);
    const blobs = this.profile.trees >= 44 ? 4 : this.profile.trees >= 30 ? 3 : 2;
    const round = list.filter((t) => t.kind !== 'palm');
    const palms = list.filter((t) => t.kind === 'palm');
    const trunkG = new THREE.CylinderGeometry(0.11, 0.27, 1, 7);
    trunkG.translate(0, 0.5, 0);
    const limbG = new THREE.CylinderGeometry(0.045, 0.1, 1, 5);
    limbG.translate(0, 0.5, 0);
    const frondG = new THREE.BoxGeometry(0.2, 0.035, 2.3);
    frondG.translate(0, 0, 1.15);
    const trunks = this.instanced(trunkG, this.mats.color(C.trunk), round.length + palms.length * 2);
    const limbs = this.instanced(limbG, this.mats.color(0x6b4a2b), Math.max(1, round.length * 3), false);
    const crowns = this.instanced(new THREE.IcosahedronGeometry(1, 1), this.mats.color(0xffffff), Math.max(1, round.length * blobs));
    const fronds = this.instanced(frondG, this.mats.color(0xffffff), Math.max(1, palms.length * 9), false);
    const nuts = this.instanced(new THREE.SphereGeometry(0.17, 6, 5), this.mats.color(0x5b3a1e), Math.max(1, palms.length * 3), false);
    const col = (hex: number, dl = 0.12) => this.tmp.c.setHex(hex).offsetHSL((r() - 0.5) * 0.04, (r() - 0.5) * 0.1, (r() - 0.5) * dl);
    let nt = 0;
    let nl = 0;
    let nc = 0;
    for (const t of round) {
      const yaw = r() * 6.28;
      const lean = (r() - 0.5) * 0.14;
      this.setInstanceE(trunks, nt++, t.x, 0, t.z, 1 + t.s * 0.12, t.h, 1 + t.s * 0.12, 0, yaw, lean);
      const flame = t.kind === 'flame';
      const spread = flame ? 1.25 : 1;
      // Charpentières : trois branches maîtresses qui portent le feuillage
      for (let k = 0; k < 3; k++) {
        const a = yaw + (k / 3) * 6.28 + r() * 0.8;
        this.setInstanceE(limbs, nl++, t.x, t.h * 0.7, t.z, 1, t.s * 0.95, 1, 0.55 + r() * 0.3, a, 0);
      }
      const base = flame ? 0xe4572e : t.kind === 'neem' ? 0x2f8a3e : 0x3a8f3c;
      const cy = t.h + t.s * (flame ? 0.4 : 0.6);
      this.setInstanceE(crowns, nc, t.x, cy, t.z, t.s * spread, t.s * (flame ? 0.5 : 0.82), t.s * spread, 0, r() * 6, 0);
      crowns.setColorAt(nc++, col(base));
      for (let k = 1; k < blobs; k++) {
        const a = (k / (blobs - 1)) * 6.28 + r();
        const rad = t.s * (flame ? 0.95 : 0.62);
        const sc = t.s * (0.55 + r() * 0.2) * spread;
        this.setInstanceE(crowns, nc, t.x + Math.cos(a) * rad, cy - t.s * 0.08 + r() * t.s * 0.35, t.z + Math.sin(a) * rad, sc, sc * (flame ? 0.55 : 0.85), sc, 0, r() * 6, 0);
        // Flamboyant : quelques touffes encore vertes parmi les fleurs rouges
        crowns.setColorAt(nc++, col(flame && r() < 0.3 ? 0x4aa040 : base, 0.18));
      }
    }
    let nf = 0;
    let nn = 0;
    for (const t of palms) {
      const ry = r() * 6.28;
      const lean = 0.1 + r() * 0.16;
      const low = t.h * 0.55;
      this.setInstanceE(trunks, nt++, t.x, 0, t.z, 1, low, 1, 0, ry, 0);
      // Partie haute inclinée : le tronc se courbe
      const up = t.h * 0.5;
      this.setInstanceE(trunks, nt++, t.x, low, t.z, 0.8, up, 0.8, 0, ry, lean);
      const topX = t.x - Math.sin(lean) * Math.cos(ry) * up;
      const topY = low + Math.cos(lean) * up;
      const topZ = t.z + Math.sin(lean) * Math.sin(ry) * up;
      for (let k = 0; k < 9; k++) {
        const a = (k / 9) * 6.28 + r() * 0.3;
        const len = 0.85 + r() * 0.3;
        this.setInstanceE(fronds, nf, topX, topY, topZ, 1, 1, len, 0.25 + (k % 3) * 0.28 + r() * 0.1, a, 0);
        fronds.setColorAt(nf++, col(0x2e9e5b, 0.2));
      }
      for (let k = 0; k < 3; k++) {
        const a = (k / 3) * 6.28 + r();
        this.setInstanceE(nuts, nn++, topX + Math.cos(a) * 0.25, topY - 0.25, topZ + Math.sin(a) * 0.25, 1, 1, 1, 0, 0, 0);
      }
    }
    trunks.count = nt;
    limbs.count = nl;
    crowns.count = nc;
    fronds.count = nf;
    nuts.count = nn;
    for (const m of [trunks, limbs, crowns, fronds, nuts]) m.instanceMatrix.needsUpdate = true;
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    if (fronds.instanceColor) fronds.instanceColor.needsUpdate = true;
  }

  /** Bâtiment générique : volume, bandeau de couleur, auvent, enseigne. */
  /**
   * Grand Lomé hors du plan dense : péage et village de Davié sur la RN1, carrefour de la route de Kpalimé,
   * entrée de Tsévié, hameaux de Sogbossito et de Légbassito. Les emplacements sont des projections
   * approximatives (voir MAP_MIN_Z) ; les zones de terrain à vendre sont posées par `setLand`.
   */
  private buildGrandLome(): void {
    const r = rng(7311);
    const n1 = (z: number) => bend(0, z);
    /** Panneau lisible des deux sens de circulation (une face tournée vers le sud, une vers le nord). */
    const sign = (title: string, sub: string, bg: string, fg: string, x: number, y: number, z: number, w: number, h: number, gap = 0.06, alongX = false): void => {
      const tex = this.posterTexture(title, sub, bg, fg, 768, Math.round((768 * h) / w));
      for (const face of [1, -1] as const) {
        const m = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(w, h)), new THREE.MeshBasicMaterial({ map: tex }));
        if (alongX) {
          m.position.set(x + face * gap, y, z);
          m.rotation.y = (face * Math.PI) / 2;
        } else {
          m.position.set(x, y, z + face * gap);
          if (face < 0) m.rotation.y = Math.PI;
        }
        this.scene.add(m);
      }
    };
    const hut = (x: number, z: number): void => {
      const w = 4 + r() * 2.2;
      const d = 4 + r() * 2.2;
      const h = 2.5 + r() * 0.7;
      if (!this.freeBase(x, z, Math.hypot(w, d) / 2 + 2)) return;
      if (KPALIME_ROAD.slice(1).some((b, i) => segDist(x, z, KPALIME_ROAD[i]!, b) < ROAD_W / 2 + Math.hypot(w, d) / 2 + 2)) return;
      this.box(w, h, d, WALLS[Math.floor(r() * WALLS.length)]!, x, h / 2, z);
      this.solid(x, z, w, d);
      this.box(w + 0.6, 0.25, d + 0.6, ROOFS[Math.floor(r() * ROOFS.length)]!, x, h + 0.12, z);
      this.box(0.9, 1.7, 0.08, 0x3d5a80, x, 0.85, z + d / 2 + 0.05, false);
    };
    const hamlet = (cx: number, cz: number, radius: number, count: number): void => {
      for (let i = 0; i < count; i++) {
        const a = r() * Math.PI * 2;
        const d = Math.sqrt(r()) * radius;
        hut(cx + Math.cos(a) * d, cz + Math.sin(a) * d);
      }
    };

    /** Péage : six voies sous un auvent. `alongX` : route est-ouest (RN2) au lieu de nord-sud (RN1). */
    const tollPlaza = (cx: number, cz: number, title: string, subtitle: string, alongX: boolean): void => {
      const bx = (w: number, h: number, d: number, color: number, lx: number, y: number, lz: number, cast = true): THREE.Mesh =>
        alongX ? this.box(d, h, w, color, cx + lz, y, cz + lx, cast) : this.box(w, h, d, color, cx + lx, y, cz + lz, cast);
      bx(28, 0.05, 40, 0x7d8693, 0, 0.035, 0, false);
      for (const dx of [-7.2, 0, 7.2]) {
        bx(1.9, 0.3, 11, 0xd9d3c4, dx, 0.15, 0, false);
        bx(1.8, 2.7, 4.2, 0xfbfaf6, dx, 1.5, 0);
        if (alongX) this.solid(cx, cz + dx, 4.2, 1.9);
        else this.solid(cx + dx, cz, 1.9, 4.2);
        bx(1.85, 0.7, 4.25, 0x1f4e9c, dx, 2.4, 0, false);
        bx(1.84, 0.9, 1.6, 0x7fb6e8, dx, 1.5, 1, false);
        // Lisses relevées, de part et d'autre de chaque cabine
        for (const side of [-1, 1] as const) {
          const arm = bx(3, 0.14, 0.14, 0xe5383b, dx + side * 2.3, 2.4, 2.4, false);
          if (alongX) arm.rotation.x = -side * 1.05;
          else arm.rotation.z = side * 1.05;
        }
      }
      bx(30, 0.8, 11, 0xf4f1e8, 0, 6.6, 0);
      bx(30.1, 0.9, 11.1, 0x1f4e9c, 0, 6.0, 0, false);
      for (const dx of [-14, -7.2, 0, 7.2, 14]) bx(0.6, 6.2, 0.6, 0xe8e2d6, dx, 3.1, 5.3);
      sign(title, subtitle, '#1f4e9c', '#ffffff', cx, 6.0, cz, 22, 1.9, 5.65, alongX);
    };

    // --- Péage de Davié (position approximative)
    {
      const cx = n1(TOLL_Z);
      tollPlaza(cx, TOLL_Z, 'PÉAGE DE DAVIÉ', 'RN1 • LOMÉ ⇄ TSÉVIÉ', false);
      // Poste de péage et logements des agents
      this.building(cx + 22, TOLL_Z - 6, 12, 8, 4.2, 0xfbfaf6, 0x1f4e9c);
      this.building(cx - 22, TOLL_Z + 4, 9, 7, 3.8, 0xfdf3dc, 0x1f4e9c);
      hamlet(cx + 34, TOLL_Z + 22, 14, 5);
    }

    // --- Davié : village de part et d'autre de la RN1, carrefour de la route de Kpalimé
    {
      for (let z = DAVIE_Z - 44; z <= DAVIE_Z + 44; z += 9) {
        for (const side of [-1, 1] as const) {
          if (r() < 0.12) continue;
          hut(n1(z) + side * (12 + r() * 6), z + (r() - 0.5) * 3);
        }
      }
      hamlet(32, DAVIE_Z - 10, 24, 10);
      hamlet(-34, DAVIE_Z + 30, 22, 8);
      this.building(n1(DAVIE_Z + 18) + 14, DAVIE_Z + 18, 16, 8, 3.8, 0xfdf3dc, 0xe5383b); // marché
      const asphalt = this.surface('#7d8693', 0.22, 'asphalt');
      const shoulder = this.surface('#b8b19f', 0.14, 'concrete');
      this.addStrip(KPALIME_ROAD, ROAD_W - 0.5 + 2, shoulder, 0.012);
      this.addStrip(KPALIME_ROAD, ROAD_W - 0.5, asphalt, 0.022);
      const dashes: [number, number, number][] = [];
      for (let i = 0; i < KPALIME_ROAD.length - 1; i++) {
        const [ax, az] = KPALIME_ROAD[i]!;
        const [bx, bz] = KPALIME_ROAD[i + 1]!;
        const len = Math.hypot(bx - ax, bz - az);
        for (let d = 3; d < len - 3; d += 7) dashes.push([ax + ((bx - ax) * d) / len, az + ((bz - az) * d) / len, -Math.atan2(bz - az, bx - ax)]);
      }
      for (const [dx, dz, rot] of dashes) {
        const m = this.box(3, 0.02, 0.18, 0xffffff, dx, 0.03, dz, false);
        m.rotation.y = rot;
      }
      sign('DAVIÉ', 'CARREFOUR • ROUTE DE KPALIMÉ ▸', '#0d6e3f', '#ffffff', n1(DAVIE_Z + 8) - 9, 3.2, DAVIE_Z + 8, 9, 2.2);
      this.box(0.2, 3.2, 0.2, 0xc8ccd2, n1(DAVIE_Z + 8) - 9, 1.6, DAVIE_Z + 8, false);
      sign('KPALIMÉ ▸', 'RN5', '#0d6e3f', '#ffffff', -150, 3.2, DAVIE_Z - 50, 6, 1.6);
      this.box(0.2, 3.2, 0.2, 0xc8ccd2, -150, 1.6, DAVIE_Z - 50, false);
    }

    // --- Tsévié : portique d'entrée et centre-ville
    {
      const cx = n1(TSEVIE_ARCH_Z);
      for (const dx of [-8, 8]) this.box(0.8, 7, 0.8, 0xe8e2d6, cx + dx, 3.5, TSEVIE_ARCH_Z);
      this.box(17.6, 1.8, 0.9, 0x1f4e9c, cx, 7.2, TSEVIE_ARCH_Z, false);
      sign('TSÉVIÉ', 'BIENVENUE', '#1f4e9c', '#ffffff', cx, 7.2, TSEVIE_ARCH_Z, 16, 1.6, 0.5);
      const rows = [-1022, -1038, -1052];
      rows.forEach((z, ri) => {
        for (let x = -30; x <= 42; x += 14) {
          if (Math.abs(x - cx) < 12 || r() < 0.15) continue;
          if (!this.freeBase(x, z, 9)) continue;
          const floors = ri === 0 ? 1 + Math.floor(r() * 2) : 1 + Math.floor(r() * 3);
          this.building(x, z, 9 + r() * 3, 7 + r() * 2, 3.2 * floors, WALLS[Math.floor(r() * WALLS.length)]!, SHOP_COLORS[Math.floor(r() * SHOP_COLORS.length)]!);
        }
      });
      sign('MARCHÉ DE TSÉVIÉ', 'FRUITS • LÉGUMES • TISSUS', '#8d2d2d', '#fff1cf', cx + 22, 4.6, -1015, 11, 1.2);
      hamlet(cx - 50, -1030, 22, 9);
      hamlet(cx + 60, -1040, 20, 8);
    }

    // --- Route de Légbassito (tracée avec les rues de la ville) : marché, puis Apessito (église, école, poste de police)
    {
      // Rond-point de Légbassito (OSM : marché sur la route de Mission-Tové à (-220, -455)) : chaussée circulaire et îlot central
      const rx = -222;
      const rz = -505;
      const ring = new THREE.Mesh(this.geo(new THREE.CircleGeometry(9.5, 40)), this.surface('#7d8693', 0.22, 'asphalt'));
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(rx, 0.04, rz);
      ring.receiveShadow = this.profile.shadows;
      const curb = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(4.3, 4.3, 0.34, 28)), this.mats.color(0xf3efe6));
      curb.position.set(rx, 0.19, rz);
      const island = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(3.7, 3.7, 0.4, 28)), this.mats.color(0x6bbf59));
      island.position.set(rx, 0.22, rz);
      this.scene.add(ring, curb, island);
      this.roundaboutDecor(rx, rz, 9.5, 4.3, false);
      this.tree(rx, rz);
      this.solid(rx, rz, 7.4, 7.4);
      sign('LÉGBASSITO', 'ROUTE DE MISSION-TOVÉ', '#1f4e9c', '#ffffff', rx + 12, 3.2, rz - 14, 7, 1.2);
      this.box(0.2, 3.2, 0.2, 0xc8ccd2, rx + 12, 1.6, rz - 14, false);
      // Marché de Légbassito : dalle, halle centrale et étals colorés, face au rond-point (à l'ouest)
      const mx = -252;
      const mz = -510;
      this.box(30, 0.12, 20, 0xe9e4d8, mx, 0.06, mz, false);
      this.box(14, 4.4, 8, 0xfdf3dc, mx - 5, 2.2, mz - 4);
      this.solid(mx - 5, mz - 4, 14, 8);
      this.box(14.6, 0.5, 8.6, 0xb4552d, mx - 5, 4.6, mz - 4);
      for (let row = 0; row < 3; row++) {
        for (let col = 0; col < 6; col++) {
          const sx = mx - 12 + col * 4.4;
          const sz = mz + 2 + row * 4;
          if (col < 2 && row === 0) continue;
          this.box(2.4, 0.9, 1.6, 0xb08968, sx, 0.45, sz);
          this.box(3, 0.12, 2.4, SHOP_COLORS[(row * 6 + col) % SHOP_COLORS.length]!, sx, 2.3, sz - 0.2, false);
          this.box(0.1, 1.9, 0.1, 0x5b4330, sx - 1.3, 1.0, sz + 0.9, false);
          this.box(0.1, 1.9, 0.1, 0x5b4330, sx + 1.3, 1.0, sz + 0.9, false);
        }
      }
      sign('MARCHÉ DE LÉGBASSITO', 'ALIMENTS • PAGNES • QUINCAILLERIE', '#8d2d2d', '#fff1cf', mx + 15.5, 3.8, mz, 14, 1.5, 0.06, true);
      this.box(0.2, 3.8, 0.2, 0xc8ccd2, mx + 15.5, 1.9, mz - 6.8, false);
      this.box(0.2, 3.8, 0.2, 0xc8ccd2, mx + 15.5, 1.9, mz + 6.8, false);
      // Apessito : église catholique, école et poste de police au bord de la route
      this.building(-205, -568, 12, 9, 6.5, 0xfbfaf6, 0x1f4e9c);
      this.box(0.3, 3.2, 0.3, 0xe5e5e5, -205, 8.1, -568, false);
      this.box(1.6, 0.3, 0.3, 0xe5e5e5, -205, 8.9, -568, false);
      sign('ÉGLISE CATHOLIQUE', 'APESSITO', '#1f4e9c', '#ffffff', -205, 4.2, -562.9, 8, 0.9);
      this.building(-205, -596, 16, 8, 3.8, 0xfdf3dc, 0xf6c90e);
      sign('EPP APESSITO', '', '#0d6e3f', '#ffffff', -205, 3.4, -591.8, 8, 0.8);
      this.building(-205, -548, 8, 6, 3.4, 0xdbe9fb, 0x1f4e9c);
      sign('POSTE DE POLICE', 'APESSITO', '#1f4e9c', '#ffffff', -205, 3.0, -544.9, 6, 0.8);
      sign('MISSION-TOVÉ ▸', '', '#0d6e3f', '#ffffff', -233, 3.2, -640, 6, 1.4);
      this.box(0.2, 3.2, 0.2, 0xc8ccd2, -233, 1.6, -640, false);
    }

    // --- Hameaux de Sogbossito (nord-ouest d'Agoè) et de Légbassito (plus à l'ouest)
    hamlet(-140, -553, 22, 9);
    hamlet(-120, -478, 26, 10);
    hamlet(-262, -448, 30, 12);
    hamlet(-190, -618, 22, 8);
    // Apessito, route de Mission-Tové
    hamlet(-250, -643, 30, 12);
    hamlet(-185, -583, 20, 8);
  }

  private building(x: number, z: number, w: number, d: number, h: number, wall: number, accent: number): void {
    this.box(w + 3, 0.12, d + 5, 0xffffff, x, 0.06, z + 1.5, false);
    this.box(w, h, d, wall, x, h / 2, z);
    this.solid(x, z, w, d);
    this.box(w + 0.1, 0.6, d + 0.1, accent, x, h * 0.62, z, false);
    this.box(w + 0.5, 0.4, d + 0.5, 0x6f7f93, x, h + 0.2, z);
    this.box(1.6, 2.2, 0.12, 0x3d5a80, x, 1.1, z + d / 2 + 0.06, false);
    this.box(w * 0.75, 0.12, 1.4, accent, x, 2.6, z + d / 2 + 0.7, false);
    // Façade en profondeur : vitres, tableaux de fenêtre et seuil. Les pièces sont fusionnées ensuite.
    const glass = this.litGlass();
    const windows = Math.max(2, Math.min(6, Math.floor(w / 2.7)));
    for (let i = 0; i < windows; i++) {
      const wx = x - w * 0.38 + (i * w * 0.76) / Math.max(1, windows - 1);
      if (Math.abs(wx - x) < 1.15) continue;
      const pane = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.05, 1.05, 0.07)), glass);
      pane.position.set(wx, Math.min(h - 1, 1.7), z + d / 2 + 0.08);
      pane.receiveShadow = this.profile.shadows;
      this.scene.add(pane);
      this.box(1.25, 0.1, 0.12, 0xe8e2d6, wx, Math.min(h - 0.4, 2.28), z + d / 2 + 0.1, false);
      this.box(1.25, 0.1, 0.18, 0xe8e2d6, wx, Math.min(h - 1.6, 1.12), z + d / 2 + 0.13, false);
    }
    this.box(2.2, 0.16, 1.15, 0xc9c4b8, x, 0.08, z + d / 2 + 0.65, false);
  }

  /** Ambassade : enceinte, guérite, bâtiment de chancellerie et mât au drapeau du pays. */
  private embassy(x: number, z: number, name: string, flag: (g: THREE.Group) => void, big = false): void {
    const w = big ? 16 : 13;
    const d = big ? 13 : 11;
    this.box(w, 0.15, d, 0xbfdc9c, x, 0.08, z - 1, false);
    for (const [bw, bd, bx, bz] of [[w, 0.5, 0, -d / 2], [0.5, d, -w / 2, 0], [0.5, d, w / 2, 0], [w / 2 - 2, 0.5, -w / 4 - 1, d / 2], [w / 2 - 2, 0.5, w / 4 + 1, d / 2]] as const) {
      this.box(bw, 1.8, bd, 0xeeeae0, x + bx, 0.9, z - 1 + bz, false);
    }
    this.solid(x, z - 1, w, d);
    this.box(big ? 11 : 8, big ? 9 : 6.5, big ? 6 : 5, 0xfbfaf6, x, big ? 4.5 : 3.25, z - 3);
    this.box(big ? 11.1 : 8.1, 0.8, big ? 6.1 : 5.1, 0x3b5a78, x, big ? 6.5 : 4.6, z - 3, false);
    this.box(1.6, 2.4, 1.6, 0xd9d3c4, x + w / 2 - 1.5, 1.2, z + d / 2 - 1.5);
    // Entrée : portail ouvert dans le mur de la rue, allée dallée, perron, porte vitrée sous auvent et nom de l'ambassade sur le bandeau
    const wallZ = z - 1 + d / 2;
    const frontZ = z - 3 + (big ? 3 : 2.5);
    const pathLen = wallZ - frontZ + 1.6;
    this.box(3, 0.04, pathLen, 0xd9d2c3, x, 0.18, frontZ + pathLen / 2, false);
    for (const sx of [-1, 1]) {
      this.box(0.5, 2.4, 0.6, 0xd9d3c4, x + sx * 1.75, 1.2, wallZ);
      this.box(0.08, 1.8, 1.5, 0x20252b, x + sx * 1.4, 1, wallZ - 1, false); // battant ouvert vers l'intérieur
    }
    this.box(3.4, 0.14, 0.9, 0xd9d3c4, x, 0.22, frontZ + 0.45, false);
    this.box(1.9, 2.5, 0.14, 0x274a6b, x, 1.4, frontZ + 0.07, false);
    for (const sx of [-1, 1]) this.box(0.7, 1.6, 0.16, 0x9fc9e8, x + sx * 0.45, 1.55, frontZ + 0.09, false);
    this.box(4.4, 0.2, 1.9, 0x3b5a78, x, 3.05, frontZ + 0.95, false);
    for (const sx of [-1, 1]) this.box(0.14, 2.9, 0.14, 0xc8ccd2, x + sx * 2, 1.5, frontZ + 1.8, false);
    const nameSign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(big ? 9.6 : 7, big ? 0.7 : 0.62)), new THREE.MeshBasicMaterial({ map: this.posterTexture(name, '', '#3b5a78', '#ffffff', 768, 64) }));
    nameSign.position.set(x, big ? 6.5 : 4.6, frontZ + 0.09);
    this.scene.add(nameSign);
    const g = new THREE.Group();
    this.box(0.14, 8, 0.14, 0xc8ccd2, x - w / 2 + 2, 4, z + d / 2 - 2, false);
    g.position.set(x - w / 2 + 2.05, 7.2, z + d / 2 - 2);
    flag(g);
    this.scene.add(g);
  }

  /**
   * Entrée d'un bâtiment : allée dallée jusqu'à la rue, perron, porte à deux vantaux vitrés et auvent, posés contre la façade
   * (z = frontZ, orientée vers +z, comme le point d'arrivée du joueur). `h` : hauteur de la porte.
   */
  private entrance(x: number, frontZ: number, w = 2.4, h = 2.5): void {
    this.box(w + 0.8, 0.04, 3.2, 0xd9d2c3, x, 0.18, frontZ + 1.6, false);
    this.box(w + 1.2, 0.14, 0.8, 0xd9d3c4, x, 0.22, frontZ + 0.5, false);
    this.box(w, h, 0.14, 0x274a6b, x, h / 2 + 0.15, frontZ + 0.08, false);
    for (const sx of [-1, 1]) this.box(w * 0.36, h * 0.62, 0.16, 0x9fc9e8, x + sx * w * 0.24, h * 0.55 + 0.15, frontZ + 0.1, false);
    this.box(w + 1.6, 0.2, 1.7, 0x3b5a78, x, h + 0.55, frontZ + 0.85, false);
    for (const sx of [-1, 1]) this.box(0.12, h + 0.4, 0.12, 0xc8ccd2, x + sx * (w / 2 + 0.6), (h + 0.4) / 2 + 0.15, frontZ + 1.6, false);
  }

  /**
   * Bank of Africa Togo (photos) : tour de sept niveaux habillée de panneaux d'aluminium gris-blanc, colonne centrale et pans de
   * verre bleu, balcons courbes en débord de chaque côté, couronne arrondie ; au rez-de-chaussée, le bandeau vert à l'enseigne
   * « BANK OF AFRICA TOGO » (logo carré vert), un auvent et un hall vitré. Les vitres brillent la nuit.
   */
  private boaTower(x: number, z: number): void {
    const cv = document.createElement('canvas');
    cv.width = 64;
    cv.height = 128;
    const g = cv.getContext('2d');
    if (g) {
      const gr = g.createLinearGradient(0, 0, 0, 128);
      gr.addColorStop(0, '#2a5db0');
      gr.addColorStop(1, '#10357a');
      g.fillStyle = gr;
      g.fillRect(0, 0, 64, 128);
      g.strokeStyle = '#0b2658';
      g.lineWidth = 2;
      for (const my of [0, 32, 64, 96, 128]) { g.beginPath(); g.moveTo(0, my); g.lineTo(64, my); g.stroke(); }
      g.beginPath(); g.moveTo(32, 0); g.lineTo(32, 128); g.stroke();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    this.mats.textures.push(tex);
    const glassMat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffd9a0, emissiveIntensity: 0 });
    this.nightMaterials.push(glassMat);
    this.nightScale.set(glassMat, 0.55);
    const GREEN = 0x1e8a4a;
    const panel = 0xe4e7ea;
    const H = 22;
    const D = 7;
    const zf = z - 3 + D / 2; // face avant
    this.box(12, 0.12, 9.5, 0xe9e4d8, x, 0.06, z - 1.8, false); // dallé court : il ne doit pas déborder sur la chaussée
    // Corps : panneaux d'aluminium, couronne arrondie
    this.box(9.2, H, D, panel, x, H / 2, z - 3);
    this.solid(x, z - 3, 9.2, D);
    const crown = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(4.7, 4.7, 1.4, 28, 1, false, -Math.PI / 2, Math.PI)), this.mats.color(0xf1f2f3));
    crown.rotation.x = 0;
    crown.scale.set(1, 1, 0.75);
    crown.position.set(x, H + 0.5, zf - 1.6);
    this.scene.add(crown);
    // Pans de verre : colonne centrale haute, bloc droit et bloc gauche, balcons courbes
    const pane = (w: number, h: number, px: number, py: number): void => {
      const m = this.box(w, h, 0.14, 0xffffff, px, py, zf + 0.04, false);
      m.material = glassMat.clone();
      (m.material as THREE.MeshLambertMaterial).map = tex.clone();
      (m.material as THREE.MeshLambertMaterial).map!.repeat.set(Math.max(1, Math.round(w / 1.4)), Math.max(1, Math.round(h / 3.2)));
      (m.material as THREE.MeshLambertMaterial).map!.needsUpdate = true;
      this.nightMaterials.push(m.material as THREE.MeshLambertMaterial);
      this.nightScale.set(m.material as THREE.Material, 0.55);
    };
    pane(2.4, 17.6, x - 0.9, 12.4);
    pane(2.8, 15.2, x + 2.9, 11.2);
    pane(1.9, 14, x - 3.45, 10.4);
    for (let f = 0; f < 6; f++) {
      const y = 4.4 + f * 3.1;
      // Balcon courbe à droite et à gauche : dalle et nez arrondi
      for (const sx of [-1, 1]) {
        const w = sx > 0 ? 3.6 : 2.6;
        const cx = x + (sx > 0 ? 2.9 : -3.45);
        this.box(w, 0.35, 1.5, 0xf1f2f3, cx, y, zf + 0.75, false);
        const nose = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.75, 0.75, 0.35, 14, 1, false, -Math.PI / 2, Math.PI)), this.mats.color(0xf1f2f3));
        nose.position.set(cx, y, zf + 1.5);
        nose.rotation.y = Math.PI / 2;
        this.scene.add(nose);
        this.box(w, 0.18, 0.06, 0x9aa3ad, cx, y + 0.45, zf + 1.5, false);
      }
    }
    // Rez-de-chaussée : hall vitré, auvent et bandeau vert « BANK OF AFRICA TOGO »
    const lobby = this.box(7.2, 3, 0.12, 0xffffff, x + 0.4, 1.7, zf + 0.04, false);
    lobby.material = glassMat;
    this.box(9.4, 1.5, 0.5, GREEN, x, 4.2, zf + 0.5, false);
    this.box(9.4, 0.3, 1.6, 0xe4e7ea, x, 3.3, zf + 0.9, false);
    // Enseigne : le logo officiel (public/brands/boa.png) sur un panneau blanc ; un tracé simplifié le remplace le temps du chargement
    const sc = document.createElement('canvas');
    sc.width = 576;
    sc.height = 349;
    const sg = sc.getContext('2d')!;
    const paintFallback = (): void => {
      sg.fillStyle = '#ffffff';
      sg.fillRect(0, 0, 576, 349);
      sg.fillStyle = '#111111';
      sg.fillRect(20, 14, 260, 250);
      sg.fillStyle = '#2f9d4a';
      sg.fillRect(20, 160, 125, 104);
      sg.fillRect(158, 160, 122, 104);
      sg.fillStyle = '#ffffff';
      sg.fillRect(110, 20, 60, 140);
      sg.fillStyle = '#111111';
      sg.font = '800 62px sans-serif';
      for (const [t, ty] of [['BANK', 90], ['OF', 160], ['AFRICA', 235]] as const) sg.fillText(t, 305, ty);
    };
    paintFallback();
    const signTex = new THREE.CanvasTexture(sc);
    signTex.colorSpace = THREE.SRGBColorSpace;
    signTex.anisotropy = 8;
    this.mats.textures.push(signTex);
    void this.loadLogo(`${import.meta.env.BASE_URL}brands/boa.png`).then((img) => {
      if (!img) return;
      sg.fillStyle = '#ffffff';
      sg.fillRect(0, 0, 576, 349);
      sg.drawImage(img, 0, 0, 576, 349);
      signTex.needsUpdate = true;
    });
    const boaSign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(2.45, 1.485)), new THREE.MeshBasicMaterial({ map: signTex, toneMapped: false }));
    boaSign.position.set(x - 0.2, 4.2, zf + 0.78);
    this.scene.add(boaSign);
    this.box(2.6, 1.6, 0.1, 0xffffff, x - 0.2, 4.2, zf + 0.72, false);
    this.box(0.12, 3, 0.12, 0xb4b8ba, x - 3.4, 1.6, zf + 1.6, false);
    this.box(0.12, 3, 0.12, 0xb4b8ba, x + 4.2, 1.6, zf + 1.6, false);
    this.box(1, 2, 0.6, 0x3a3f47, x + 5.6, 1, z + 1.2, false); // distributeur
    this.box(0.7, 0.5, 0.05, 0x7fb6e8, x + 5.6, 1.4, z + 1.52, false);
    // Petit totem vert à l'angle
    this.box(0.5, 4, 0.3, 0xf4f6f4, x - 6, 2, z + 1.8, false);
    this.box(0.5, 1.3, 0.34, GREEN, x - 6, 3.3, z + 1.8, false);
  }

  /** Logo d'Ecobank : « Ecobank » en italique blanc sous un arc fin, sur fond bleu ; avec filet vert et « La Banque Panafricaine » si `tagline`. */
  private ecobankLogo(w: number, h: number, tagline: boolean): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    if (g) {
      g.fillStyle = '#0f5a8b';
      g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffffff';
      g.strokeStyle = '#ffffff';
      g.textBaseline = 'alphabetic';
      // Taille du mot : au plus 84 % de la largeur, au plus la hauteur disponible (avec l'arc au-dessus)
      let fs = tagline ? h * 0.36 : h * 0.62;
      g.font = `italic 500 ${fs}px "Trebuchet MS", "DejaVu Sans", Arial, sans-serif`;
      const tw = g.measureText('Ecobank').width;
      if (tw > w * 0.84) {
        fs *= (w * 0.84) / tw;
        g.font = `italic 500 ${fs}px "Trebuchet MS", "DejaVu Sans", Arial, sans-serif`;
      }
      const width = g.measureText('Ecobank').width;
      const x0 = (w - width) / 2;
      const base = tagline ? h * 0.52 : h * 0.78;
      g.fillText('Ecobank', x0, base);
      // Arc fin qui part du haut du « b » et retombe au-dessus du « k »
      g.lineWidth = Math.max(1.5, fs * 0.035);
      g.beginPath();
      g.moveTo(x0 + width * 0.52, base - fs * 0.78);
      g.quadraticCurveTo(x0 + width * 0.78, base - fs * 1.18, x0 + width * 0.97, base - fs * 0.62);
      g.stroke();
      if (tagline) {
        g.strokeStyle = '#8cc63f';
        g.lineWidth = Math.max(2, h * 0.012);
        g.beginPath();
        g.moveTo(w * 0.07, h * 0.66);
        g.lineTo(w * 0.93, h * 0.66);
        g.stroke();
        g.fillStyle = '#ffffff';
        g.font = `italic 400 ${w * 0.072}px "Trebuchet MS", "DejaVu Sans", Arial, sans-serif`;
        g.fillText('La Banque Panafricaine', w * 0.07, h * 0.84);
      }
    }
    const t = new THREE.CanvasTexture(cv);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    this.mats.textures.push(t);
    return t;
  }

  /**
   * Siège d'Ecobank Togo (Bè) : tour de verre bleu miroir de huit niveaux, bandes verticales blanches de part et d'autre de la
   * travée centrale, deux cadres blancs en « E » sur les ailes, portail bleu à verrière en arc, toit noir en porte-à-faux sur un
   * dernier niveau vitré, mâts de drapeaux et guérite blanche. Dessiné face à +z (la scène le fait pivoter vers le boulevard).
   */
  private ecobankTower(x: number, z: number): void {
    const W = 21;
    const D = 7;
    const H = 16.5;
    const FLOORS = 8;
    const pitch = H / FLOORS;
    const cx = x - 6;
    const zf = z + 3; // plan de façade
    const zc = zf - D / 2;
    const WHITE = 0xf3f5f7;
    const NAVY = 0x1d4a96;
    // Verre miroir : une cellule par niveau et par travée (allège sombre, filet argenté, reflet en biais)
    const cv = document.createElement('canvas');
    cv.width = 128;
    cv.height = 64;
    const g = cv.getContext('2d');
    if (g) {
      const gr = g.createLinearGradient(0, 0, 0, 64);
      gr.addColorStop(0, '#7db4e6');
      gr.addColorStop(1, '#3b7fc4');
      g.fillStyle = gr;
      g.fillRect(0, 0, 128, 64);
      // Reflets du ciel en biais
      g.fillStyle = 'rgba(255,255,255,0.2)';
      g.beginPath();
      g.moveTo(0, 56);
      g.lineTo(64, 0);
      g.lineTo(100, 0);
      g.lineTo(36, 56);
      g.closePath();
      g.fill();
      // Allège étroite et filet argenté à chaque niveau, meneau très fin
      g.fillStyle = '#2a68ac';
      g.fillRect(0, 56, 128, 8);
      g.fillStyle = '#d3e0ee';
      g.fillRect(0, 55, 128, 2);
      g.fillStyle = 'rgba(214,228,242,0.7)';
      g.fillRect(0, 0, 2, 55);
    }
    const base = new THREE.CanvasTexture(cv);
    base.colorSpace = THREE.SRGBColorSpace;
    base.wrapS = THREE.RepeatWrapping;
    base.wrapT = THREE.RepeatWrapping;
    this.mats.textures.push(base);
    // La nuit, le verre reste sombre et seules quelques fenêtres s'allument (carte d'émission en damier irrégulier, stable)
    let paneSeed = 3;
    const glass = (w: number, h: number, light = false): THREE.MeshLambertMaterial => {
      const cols = Math.max(1, Math.round(w / 3.6));
      const rows = Math.max(1, Math.round(h / pitch));
      const t = base.clone();
      t.needsUpdate = true;
      t.repeat.set(cols, rows);
      this.mats.textures.push(t);
      const lc = document.createElement('canvas');
      lc.width = cols * 24;
      lc.height = rows * 16;
      const lg = lc.getContext('2d');
      paneSeed += 7;
      if (lg) {
        lg.fillStyle = '#000000';
        lg.fillRect(0, 0, lc.width, lc.height);
        // Trois fenêtres par travée et par niveau, chacune allumée au hasard (bureaux occupés ou vides)
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            for (let k = 0; k < 3; k++) {
              const hash = Math.abs(Math.imul(c * 3 + k + 5 + paneSeed, 2654435761) ^ Math.imul(r + 11, 40503));
              if (hash % 10 >= (light ? 8 : 5)) continue;
              lg.fillStyle = hash % 7 === 0 ? '#bcd2f5' : hash % 3 === 0 ? '#f3cf8f' : '#e7b873';
              lg.fillRect(c * 24 + 2 + k * 7, r * 16 + 2, 6, 10);
            }
          }
        }
      }
      const glow = new THREE.CanvasTexture(lc);
      glow.colorSpace = THREE.SRGBColorSpace;
      this.mats.textures.push(glow);
      const mat = new THREE.MeshLambertMaterial({ map: t, color: light ? 0xe4f0ff : 0xffffff, emissive: 0xffffff, emissiveMap: glow, emissiveIntensity: 0 });
      this.nightMaterials.push(mat);
      this.nightScale.set(mat, 0.75);
      return mat;
    };
    const pane = (w: number, h: number, px: number, py: number, pz: number, ry: number, light = false): void => {
      const m = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(w, h)), glass(w, h, light));
      m.position.set(px, py, pz);
      m.rotation.y = ry;
      this.scene.add(m);
    };
    // Parvis dallé (il s'arrête avant la chaussée du boulevard) et pelouses des deux côtés de l'allée
    this.box(27, 0.1, 16.2, 0xd9d3c6, cx, 0.05, z + 3, false);
    for (const sx of [-1, 1]) this.box(8.4, 0.05, 6.4, 0x6fae4a, cx + sx * 7.8, 0.125, z + 6.4, false);
    // Corps : cœur sombre, quatre faces de verre
    this.box(W, H, D, 0x2a5a96, cx, H / 2, zc);
    this.solid(cx, zc, W, D);
    pane(W, H, cx, H / 2, zf + 0.03, 0);
    pane(W, H, cx, H / 2, zf - D - 0.03, Math.PI);
    for (const sx of [-1, 1]) pane(D, H, cx + sx * (W / 2 + 0.03), H / 2, zc, sx * Math.PI / 2);
    this.box(W + 0.3, 0.35, D + 0.3, 0x2a2e35, cx, H + 0.17, zc, false); // toit terrasse
    // Travée centrale, en avant, entre deux bandes blanches
    pane(5.4, H - 0.6, cx, H / 2 + 0.3, zf + 0.06, 0, true);
    for (const sx of [-1, 1]) {
      this.box(0.5, H + 0.5, 0.6, WHITE, cx + sx * 3, (H + 0.5) / 2, zf + 0.25, false); // bande autour de la travée
      this.box(0.6, H + 0.5, 0.6, WHITE, cx + sx * (W / 2 - 0.3), (H + 0.5) / 2, zf + 0.25, false); // bande d'angle
      this.box(0.6, H + 0.5, D + 0.1, WHITE, cx + sx * (W / 2 - 0.1), (H + 0.5) / 2, zc, false);
    }
    // Cadres blancs en « E » sur les deux ailes : montant et cinq barres saillantes
    for (const sx of [-1, 1]) {
      const spine = cx + sx * (W / 2 - 2);
      // Cinq barres épaisses (la première coiffe le montant), espacées d'un peu plus d'un niveau, sur un montant plein
      const gap = pitch * 1.1;
      const y0 = pitch * 2.4;
      this.box(1, gap * 4 + 0.62, 0.8, WHITE, spine, y0 + gap * 2, zf + 0.4, false);
      for (let i = 0; i < 5; i++) this.box(3.7, 0.55, 0.8, WHITE, spine - sx * 1.85, y0 + i * gap, zf + 0.4, false);
    }
    // Hall d'entrée : grand cadre bleu sur trois niveaux, vitrage clair à bandes blanches, bandeau à l'enseigne, verrière en arc
    const portalH = pitch * 3 + 0.4;
    for (const sx of [-1, 1]) this.box(0.9, portalH, 0.6, NAVY, cx + sx * 2.75, portalH / 2, zf + 0.4, false);
    this.box(6.4, 1, 0.6, NAVY, cx, portalH + 0.1, zf + 0.4, false);
    pane(4.6, portalH - 0.4, cx, (portalH - 0.4) / 2, zf + 0.12, 0, true);
    for (const y of [pitch * 1.6, pitch * 2.4]) this.box(4.6, 0.22, 0.25, WHITE, cx, y, zf + 0.3, false);
    const sign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(4.4, 0.9)), new THREE.MeshBasicMaterial({ map: this.ecobankLogo(1280, 262, false), toneMapped: false }));
    sign.position.set(cx, portalH + 0.1, zf + 0.71);
    this.scene.add(sign);
    // Verrière en arcs blancs : plus haute contre la façade, plus basse devant, vitrée entre les arcs
    const R = 2.2;
    const arcs = 5;
    const seg = 16;
    const spring = 0.8;
    const rib = this.mats.color(0xeef2f6, 0.4);
    const pts: number[] = [];
    for (let i = 0; i < arcs; i++) {
      const u = i / (arcs - 1);
      const apex = 3 + (1 - u) * 1.8; // devant (u = 1) : 3 m ; contre la façade : 4,8 m
      const sy = (apex - spring) / R;
      const az = zf + 0.7 + u * 2;
      const arch = new THREE.Mesh(this.geo(new THREE.TorusGeometry(R, 0.06, 6, 24, Math.PI)), rib);
      arch.scale.set(1, sy, 1);
      arch.position.set(cx, spring, az);
      this.scene.add(arch);
      for (let k = 0; k <= seg; k++) {
        const th = (k / seg) * Math.PI;
        pts.push(cx + R * Math.cos(th), spring + sy * R * Math.sin(th), az);
      }
    }
    const idx: number[] = [];
    for (let i = 0; i < arcs - 1; i++) {
      for (let k = 0; k < seg; k++) {
        const p0 = i * (seg + 1) + k;
        const p1 = (i + 1) * (seg + 1) + k;
        idx.push(p0, p1, p0 + 1, p0 + 1, p1, p1 + 1);
      }
    }
    const roofGeo = new THREE.BufferGeometry();
    roofGeo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    roofGeo.setIndex(idx);
    roofGeo.computeVertexNormals();
    this.scene.add(new THREE.Mesh(this.geo(roofGeo), new THREE.MeshLambertMaterial({ color: 0xd8ecf7, transparent: true, opacity: 0.4, side: THREE.DoubleSide })));
    // Pieds de l'arc de façade, jusqu'au sol
    for (const sx of [-1, 1]) this.box(0.12, spring, 0.12, 0xeef2f6, cx + sx * R, spring / 2, zf + 2.7, false);
    // Deux bassins à jets d'eau de part et d'autre du tapis rouge
    const jet = new THREE.ConeGeometry(0.1, 0.85, 6);
    for (const sx of [-1, 1]) {
      this.box(2.2, 0.28, 2.4, 0xe9e6df, cx + sx * 2.5, 0.24, z + 4.4, false);
      this.box(1.9, 0.04, 2.1, 0x6fc3e8, cx + sx * 2.5, 0.4, z + 4.4, false);
      for (const [dx, dz] of [[-0.5, -0.5], [0.5, 0], [-0.3, 0.6]] as const) {
        const j = new THREE.Mesh(this.geo(jet), this.mats.color(0xf4fbff, 0.2));
        j.position.set(cx + sx * 2.5 + dx, 0.85, z + 4.4 + dz);
        this.scene.add(j);
      }
    }
    this.box(1.6, 0.03, 4.4, 0xb3202f, cx, 0.12, z + 4.6, false); // tapis rouge
    // Dernier niveau vitré en retrait sous un toit noir en porte-à-faux
    const pent = this.box(11, 2.4, D - 2, 0x16345f, cx, H + 1.55, zc - 0.3);
    pane(11, 2.4, cx, H + 1.55, zc - 0.3 + (D - 2) / 2 + 0.03, 0);
    this.box(13.2, 0.5, D + 1.8, 0x15181d, cx, H + 3, zc + 0.9);
    pent.castShadow = false;
    // Mâts de drapeaux de chaque côté de l'allée
    const flag = (kind: number): THREE.Mesh => {
      const c = document.createElement('canvas');
      c.width = 60;
      c.height = 40;
      const f = c.getContext('2d');
      if (f) {
        if (kind === 0) {
          for (let i = 0; i < 5; i++) {
            f.fillStyle = i % 2 ? '#ffce00' : '#006a4e';
            f.fillRect(0, i * 8, 60, 8);
          }
          f.fillStyle = '#d21034';
          f.fillRect(0, 0, 24, 24);
          f.fillStyle = '#ffffff';
          f.fillRect(9, 9, 6, 6);
        } else {
          f.fillStyle = kind === 1 ? '#f4f6f8' : '#4b92db';
          f.fillRect(0, 0, 60, 40);
        }
      }
      const t = new THREE.CanvasTexture(c);
      t.colorSpace = THREE.SRGBColorSpace;
      this.mats.textures.push(t);
      return new THREE.Mesh(this.geo(new THREE.PlaneGeometry(1.4, 0.93)), new THREE.MeshBasicMaterial({ map: t, side: THREE.DoubleSide }));
    };
    let k = 0;
    for (const sx of [-1, 1]) {
      for (const dx of [6.2, 8.1, 10]) {
        const px = cx + sx * dx;
        this.box(0.08, 7.4, 0.08, 0xdfe3e6, px, 3.7, z + 4.4, false);
        const f = flag(k++ % 3);
        f.position.set(px + 0.74, 6.8, z + 4.4);
        this.scene.add(f);
      }
    }
    // Panneau d'accueil sur deux poteaux, à droite de l'entrée : logo complet avec sa signature
    for (const dx of [-0.8, 0.8]) this.box(0.1, 1.5, 0.1, 0x9aa3ad, cx + 4.9 + dx, 0.75, z + 5.2, false);
    const board = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(2.1, 1.6)), new THREE.MeshBasicMaterial({ map: this.ecobankLogo(1024, 780, true), toneMapped: false }));
    board.position.set(cx + 4.9, 2.1, z + 5.24);
    this.scene.add(board);
    this.box(2.2, 1.7, 0.08, 0xf4f6f8, cx + 4.9, 2.1, z + 5.18, false);
    // Guérite blanche à l'angle du parvis
    this.box(2.6, 2.7, 2.4, WHITE, cx - 12.4, 1.35, z + 1.4);
    this.solid(cx - 12.4, z + 1.4, 2.6, 2.4);
    this.box(2.8, 0.2, 2.6, 0x2a2e35, cx - 12.4, 2.8, z + 1.4, false);
    this.box(2.62, 1, 2.42, NAVY, cx - 12.4, 1.5, z + 1.4, false);
    pane(1.8, 1, cx - 12.4, 1.5, z + 2.62, 0, true);
  }

  /** Agence bancaire : façade vitrée, bandeau et enseigne aux couleurs de l'établissement, distributeur. */
  private bankBranch(x: number, z: number, bank: string, id = ''): void {
    const [label, color] = BANK_SIGNS[bank] ?? ['BANQUE', '#1f6feb'];
    const tint = new THREE.Color(color).getHex();
    // Seul le siège (agence de l'Avenue de la Libération) est la grande tour ; les autres agences sont des bâtiments simples
    if (bank === 'boa' && id === 'bank_boa_1') {
      this.boaTower(x, z);
      return;
    }
    if (bank === 'ecobank' && id === 'bank_ecobank_2') {
      this.ecobankTower(x, z);
      return;
    }
    this.box(13, 0.12, 11, 0xe9e4d8, x, 0.06, z - 1, false);
    this.box(10, 6, 7, 0xfbfaf6, x, 3, z - 3);
    this.solid(x, z - 3, 10, 7);
    this.box(8.6, 3.6, 0.15, 0x7fb6e8, x, 2.2, z + 0.55, false);
    // Entrée : porte vitrée double au milieu de la façade (cadre sombre, poignées), marche devant
    this.box(2.6, 2.8, 0.12, 0x3a3f47, x, 1.4, z + 0.66, false);
    for (const dx of [-0.62, 0.62]) {
      this.box(1.12, 2.6, 0.06, 0x4f86c6, x + dx, 1.35, z + 0.74, false);
      this.box(0.06, 0.5, 0.08, 0xd9dcdf, x + dx * 0.25, 1.3, z + 0.8, false);
    }
    this.box(3.4, 0.15, 1, 0xd9d3c4, x, 0.075, z + 1.15, false);
    this.box(10.1, 1, 7.1, tint, x, 5.2, z - 3, false);
    this.box(10.6, 0.4, 7.6, 0x6f7f93, x, 6.2, z - 3);
    const sign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(8, 1)), new THREE.MeshBasicMaterial({ map: this.posterTexture(label, '', color, '#ffffff', 512, 64) }));
    sign.position.set(x, 5.2, z + 0.57);
    this.scene.add(sign);
    this.box(1, 2, 0.6, 0x3a3f47, x + 4.2, 1, z + 1.2, false); // distributeur
    this.box(0.7, 0.5, 0.05, 0x7fb6e8, x + 4.2, 1.4, z + 1.52, false);
  }

  /**
   * Boutique de prêt-à-porter : grande vitrine vitrée, auvent rayé, enseigne au nom du lieu et mannequins
   * habillés avec les vêtements du catalogue (robe, boubou, costume, jean) ; portant de chemises à l'entrée.
   */
  private clothesShop(x: number, z: number, v: CityVenue): void {
    const seed = [...v.id].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7) >>> 0;
    const accent = [0xc8326b, 0x1f6feb, 0xf18f01, 0x22a861][seed % 4]!;
    // Jardin tondu, allée jusqu'à la rue et parvis dallé, étagés au-dessus du terrain du lieu (dessus à 0,08) :
    // des surfaces à la même hauteur scintillent, surtout vues de haut
    this.box(18, 0.04, 15, 0x7fb069, x, 0.1, z - 1.5, false);
    this.box(3, 0.05, 5, 0xd9d2c3, x, 0.125, z + 6, false);
    this.box(14, 0.05, 11, 0xe9e4d8, x, 0.145, z - 1.5, false);
    this.box(11, 6.2, 7.5, 0xf7f1e8, x, 3.1, z - 3.3);
    this.solid(x, z - 3.3, 11, 7.5);
    // Toit-terrasse : acrotère aux couleurs de la boutique, verrière, climatiseurs, bandeau d'angle
    this.box(11, 0.06, 7.5, 0xb9b3a8, x, 6.23, z - 3.3, false);
    for (const [w, d, dx, dz] of [[11.2, 0.3, 0, 0.5], [11.2, 0.3, 0, -7.1], [0.3, 7.6, -5.45, -3.3], [0.3, 7.6, 5.45, -3.3]] as const) {
      this.box(w, 0.7, d, accent, x + dx, 6.5, z + dz, false);
    }
    this.box(4, 0.25, 2.4, 0x9cc3dc, x - 1.5, 6.35, z - 3.8, false);
    for (const dx of [2.6, 4]) {
      this.box(1, 0.7, 0.8, 0xdfe3e6, x + dx, 6.6, z - 5.6, false);
      this.box(0.6, 0.05, 0.6, 0x4f5965, x + dx, 6.97, z - 5.6, false);
    }
    for (const sx of [-1, 1]) this.box(0.08, 5.4, 1.2, accent, x + sx * 5.53, 3, z - 0.6, false);
    // Bacs à fleurs de part et d'autre de la vitrine, palmiers et banc sur la pelouse
    for (const sx of [-1, 1]) {
      this.box(1.6, 0.5, 0.8, 0x8a8f96, x + sx * 6.4, 0.25, z + 0.8, false);
      for (let i = 0; i < 3; i++) this.box(0.38, 0.32, 0.38, [0xe5383b, 0xffce00, 0xf4f4f1][(seed + i) % 3]!, x + sx * 6.4 - 0.5 + i * 0.5, 0.62, z + 0.8, false);
    }
    this.box(2, 0.12, 0.6, 0x8a5a44, x + 6.6, 0.55, z + 4.6, false);
    for (const dx of [-0.8, 0.8]) this.box(0.12, 0.5, 0.5, 0x3a3f47, x + 6.6 + dx, 0.25, z + 4.6, false);
    // Vitrine : socle, grande vitre et montants, porte vitrée au centre
    this.box(10.4, 0.5, 0.3, 0x3a3f47, x, 0.25, z + 0.5, false);
    // Vitre claire (opaque) : la vitrine se lit de loin, les mannequins sont dehors sous l'auvent
    const glass = new THREE.Mesh(this.geo(new THREE.BoxGeometry(10.2, 3.4, 0.08)), this.mats.color(0x9cc3dc, 0.12));
    glass.position.set(x, 2.2, z + 0.52);
    this.scene.add(glass);
    for (const dx of [-5.1, -1.2, 1.2, 5.1]) this.box(0.16, 3.6, 0.2, 0x2b2f36, x + dx, 2.2, z + 0.55, false);
    this.box(10.4, 0.18, 0.22, 0x2b2f36, x, 3.95, z + 0.55, false);
    // Auvent rayé aux couleurs de la boutique
    for (let i = 0; i < 8; i++) {
      const stripe = this.box(1.3, 0.08, 1.6, i % 2 ? 0xffffff : accent, x - 4.55 + i * 1.3, 4.35, z + 1.25, false);
      stripe.rotation.x = 0.28;
    }
    const sign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(9, 1.3)), new THREE.MeshBasicMaterial({ map: this.posterTexture(v.label.toUpperCase(), 'PRÊT-À-PORTER • CHAUSSURES', '#' + accent.toString(16).padStart(6, '0'), '#ffffff', 768, 112) }));
    sign.position.set(x, 5.3, z + 0.48);
    this.scene.add(sign);
    // Mannequins devant la vitrine, chacun dans une tenue du catalogue (si le catalogue des vêtements est chargé)
    const outfits: [boolean, Record<string, string>][] = [
      [true, { dress: 'robe_wax', shoes: 'escarpins_noirs' }],
      [false, { top: 'boubou_bazin', bottom: 'pantalon_beige', shoes: 'sandales' }],
      [false, { top: 'veste_noire', bottom: 'pantalon_noir', shoes: 'chaussures_noires' }],
      [true, { top: 'blouse_wax', bottom: 'jean_bleu', shoes: 'baskets_blanches' }],
      [true, { dress: 'kaba_kente', shoes: 'escarpins_rouges' }],
      [false, { top: 'polo_beige', bottom: 'jean_bleu', shoes: 'baskets_noires' }],
    ];
    for (let i = 0; i < 4; i++) {
      const [female, ids] = outfits[(seed + i) % outfits.length]!;
      const wear = { top: garment(ids.top), bottom: garment(ids.bottom), dress: garment(ids.dress), shoes: garment(ids.shoes) };
      const look: PersonLook = { ...randomLook(rng(seed + i)), female, hairStyle: female ? 'bun' : 'lowcut', wear: wear.dress || (wear.top && wear.bottom) ? wear : undefined };
      const m = buildPerson(this.mats, look);
      m.scale.setScalar(0.9);
      m.position.set(x - 4.2 + i * 2.1 + (i >= 2 ? 2.2 : 0), 0.26, z + 1.7);
      m.rotation.y = (i % 2 ? -1 : 1) * 0.25;
      this.scene.add(m);
      this.box(0.9, 0.1, 0.9, 0xd9d4ca, m.position.x, 0.21, m.position.z, false);
    }
    // Portant de chemises devant l'entrée
    this.box(2.4, 0.06, 0.06, 0x4f5965, x + 5.4, 1.95, z + 3.8, false);
    for (const dx of [-1.15, 1.15]) this.box(0.06, 1.95, 0.06, 0x4f5965, x + 5.4 + dx, 0.98, z + 3.8, false);
    for (let i = 0; i < 6; i++) this.box(0.34, 0.78, 0.05, [0xe5383b, 0xffce00, 0x22a861, 0x1f6feb, 0xffffff, 0x14213d][(seed + i) % 6]!, x + 4.2 + i * 0.38, 1.5, z + 3.8, false);
    this.tree(x - 7.6, z + 3.4);
    this.tree(x + 7.8, z - 6.5);
  }

  /** Arbre de jardin : tronc et houppier. */
  /**
   * Habillage commun des ronds-points : massifs fleuris et palmier sur l'îlot (sauf si un monument l'occupe), filets blancs
   * le long de l'anneau, flèches de sens giratoire (horaire ; la circulation tourne dans le même sens) et lampadaires
   * posés en bordure, jamais sur une route.
   */
  private roundaboutDecor(cx: number, cz: number, R: number, I: number, centre = true): void {
    const flat = (r0: number, r1: number, color: number, y: number) => {
      const m = new THREE.Mesh(this.geo(new THREE.RingGeometry(r0, r1, 48)), this.mats.color(color));
      m.rotation.x = -Math.PI / 2;
      m.position.set(cx, y, cz);
      this.scene.add(m);
    };
    // Filets blancs : bord extérieur et bord de l'îlot
    flat(R - 0.5, R - 0.3, 0xffffff, 0.045);
    flat(I + 0.3, I + 0.5, 0xffffff, 0.045);
    // Flèches : tirets tangents au milieu de l'anneau, chacun terminé par une pointe
    const mid = (R + I) / 2;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2;
      const px = cx + Math.cos(a) * mid;
      const pz = cz + Math.sin(a) * mid;
      const dash = this.box(1.5, 0.02, 0.2, 0xffffff, px, 0.05, pz, false);
      dash.rotation.y = -a - Math.PI / 2;
      if (i % 4 === 0) {
        const head = this.box(0.55, 0.02, 0.2, 0xffffff, px + Math.cos(a + Math.PI / 2) * 0.85 + Math.cos(a) * 0.2, 0.05, pz + Math.sin(a + Math.PI / 2) * 0.85 + Math.sin(a) * 0.2, false);
        head.rotation.y = -a - Math.PI / 2 + 0.6;
        const head2 = this.box(0.55, 0.02, 0.2, 0xffffff, px + Math.cos(a + Math.PI / 2) * 0.85 - Math.cos(a) * 0.2, 0.05, pz + Math.sin(a + Math.PI / 2) * 0.85 - Math.sin(a) * 0.2, false);
        head2.rotation.y = -a - Math.PI / 2 - 0.6;
      }
    }
    // Massifs : anneau de fleurs de quatre couleurs sur l'îlot, puis pelouse plus claire autour d'un palmier
    const flowers = [0xe5383b, 0xffce00, 0xff7aa8, 0xffffff];
    const fr = I * (centre ? 0.72 : 0.8);
    const nf = Math.max(10, Math.round(fr * 4));
    for (let i = 0; i < nf; i++) {
      const a = (i / nf) * Math.PI * 2;
      this.box(0.8, 0.3, 0.8, flowers[i % flowers.length]!, cx + Math.cos(a) * fr, 0.48, cz + Math.sin(a) * fr, false);
    }
    if (centre) {
      const trunk = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.16, 0.24, 3.4, 8)), this.mats.color(0x7a5a3a));
      trunk.position.set(cx, 2.1, cz);
      this.scene.add(trunk);
      for (let k = 0; k < 6; k++) {
        const frond = this.box(2.2, 0.08, 0.5, 0x2f8a4a, cx + Math.cos((k / 6) * Math.PI * 2) * 0.95, 3.7, cz + Math.sin((k / 6) * Math.PI * 2) * 0.95, false);
        frond.rotation.y = -(k / 6) * Math.PI * 2;
        frond.rotation.z = 0.25;
      }
    }
    // Lampadaires en bordure, sur les diagonales, hors chaussée
    const lamp = new THREE.MeshBasicMaterial({ color: 0xfff1b8 });
    this.nightMaterials.push(lamp as unknown as THREE.MeshLambertMaterial);
    for (let k = 0; k < 4; k++) {
      const a = Math.PI / 4 + (k * Math.PI) / 2;
      const lx = cx + Math.cos(a) * (R + 2.4);
      const lz = cz + Math.sin(a) * (R + 2.4);
      if (this.onRoad(lx, lz, 1.2)) continue;
      this.box(0.2, 5.4, 0.2, 0x4a5058, lx, 2.7, lz, false);
      const head = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.9, 0.22, 0.5)), lamp);
      head.position.set(lx - Math.cos(a) * 0.5, 5.5, lz - Math.sin(a) * 0.5);
      this.scene.add(head);
    }
  }

  private tree(x: number, z: number): void {
    // Tronc effilé, deux charpentières et un houppier de trois boules aux verts différents (plus un cube planté dans une sphère)
    const k = Math.abs(Math.floor(x * 7.3 + z * 3.1)) % 3;
    const trunk = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.16, 0.3, 2.6, 7)), this.mats.color(0x6b4a2b));
    trunk.position.set(x, 1.3, z);
    trunk.castShadow = this.profile.shadows;
    this.scene.add(trunk);
    for (const [ax, az] of [[0.5, 0.2], [-0.45, -0.3]] as const) {
      const limb = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.05, 0.1, 1.3, 5)), this.mats.color(0x6b4a2b));
      limb.position.set(x + ax * 0.5, 2.9, z + az * 0.5);
      limb.rotation.set(az * 1.2, 0, -ax * 1.2);
      this.scene.add(limb);
    }
    const greens = [[0x2f8a3e, 0x3a9a47, 0x46a852], [0x3a8f3c, 0x2f7a35, 0x4aa040], [0x2e9e5b, 0x36a862, 0x2a8450]][k]!;
    for (const [i, [dx, dy, dz, rr]] of ([[0, 3.5, 0, 1.55], [0.9, 3.2, 0.4, 1.1], [-0.8, 3.3, -0.5, 1.2]] as const).entries()) {
      const blob = new THREE.Mesh(this.geo(new THREE.IcosahedronGeometry(rr, 1)), this.mats.color(greens[i]!));
      blob.position.set(x + dx, dy, z + dz);
      blob.scale.y = 0.85;
      blob.castShadow = this.profile.shadows;
      this.scene.add(blob);
    }
  }

  /** Étal de marché togolais : table, cagettes, produits et parasol en toile. */
  private marketStall(x: number, z: number, color: number, seed: number, clothes = false): void {
    this.box(2.8, 0.16, 1.35, 0x8a5a44, x, 1.02, z, false);
    for (const dx of [-1.15, 1.15]) for (const dz of [-0.48, 0.48]) this.box(0.1, 1, 0.1, 0x62432d, x + dx, 0.5, z + dz, false);
    this.box(1.25, 0.42, 0.95, 0xb7834f, x - 0.7, 1.3, z, false);
    this.box(1.25, 0.42, 0.95, 0xb7834f, x + 0.7, 1.3, z, false);
    if (clothes) {
      this.box(2.45, 0.06, 0.06, 0x4f5965, x, 2.05, z - 0.55, false);
      for (let i = 0; i < 5; i++) this.box(0.38, 0.8, 0.04, [0xe5383b, 0xffce00, 0x22a861, 0x1f6feb, 0xf18f01][(seed + i) % 5]!, x - 0.92 + i * 0.46, 1.62, z - 0.52, false);
    } else {
      const produce = [0xd94832, 0xe39b2e, 0x64a544, 0x8e5c2c];
      for (let i = 0; i < 10; i++) {
        const p = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.12 + (i % 2) * 0.025, 7, 5)), this.mats.color(produce[(seed + i) % produce.length]!));
        p.position.set(x - 1.05 + (i % 5) * 0.52, 1.58 + Math.floor(i / 5) * 0.18, z - 0.18 + Math.floor(i / 5) * 0.38);
        this.scene.add(p);
      }
    }
    this.box(0.09, 2.7, 0.09, 0x5b3a1e, x, 1.35, z, false);
    const canopy = new THREE.Mesh(this.geo(new THREE.ConeGeometry(1.85, 0.65, 12)), this.mats.color(color));
    canopy.position.set(x, 2.85, z);
    this.scene.add(canopy);
  }

  /** Étal du marché des féticheurs d'Akodessewa : table de bois, crânes, cornes, bocaux, herbes séchées et fétiches suspendus. */
  private fetishStall(x: number, z: number, seed: number): void {
    this.box(2.8, 0.14, 1.3, 0x6b4a2f, x, 0.95, z, false);
    for (const dx of [-1.2, 1.2]) for (const dz of [-0.5, 0.5]) this.box(0.1, 0.95, 0.1, 0x4a3320, x + dx, 0.47, z + dz, false);
    // Étagère du fond, avec des fétiches pendus à la traverse
    this.box(2.8, 1.5, 0.08, 0x5a3d26, x, 1.7, z - 0.62, false);
    this.box(2.9, 0.07, 0.07, 0x3d2a1a, x, 2.45, z - 0.5, false);
    for (let i = 0; i < 6; i++) this.box(0.1, 0.3 + ((seed + i) % 3) * 0.12, 0.1, [0x5b3a1e, 0xb08a5c, 0xd8cfc0, 0x7a2e1c][(seed + i) % 4]!, x - 1.2 + i * 0.48, 2.25 - ((seed + i) % 3) * 0.05, z - 0.5, false);
    // Plateau : crânes d'animaux, cornes, bocaux et bouquets d'herbes
    const bone = this.mats.color(0xe8e0cf);
    for (let i = 0; i < 4; i++) {
      const skull = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.17, 7, 5)), bone);
      skull.scale.set(1, 0.85, 1.25);
      skull.position.set(x - 1.05 + i * 0.5, 1.2, z + ((seed + i) % 2 ? 0.12 : -0.08));
      this.scene.add(skull);
      this.box(0.06, 0.07, 0.06, 0x2a2018, skull.position.x - 0.06, 1.24, skull.position.z + 0.17, false);
      this.box(0.06, 0.07, 0.06, 0x2a2018, skull.position.x + 0.06, 1.24, skull.position.z + 0.17, false);
    }
    for (const [dx, tilt] of [[0.95, 0.3], [1.15, -0.3]] as const) {
      const horn = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.07, 0.5, 6)), this.mats.color(0x8a7457));
      horn.position.set(x + dx, 1.3, z + 0.1);
      horn.rotation.z = tilt;
      this.scene.add(horn);
    }
    for (let i = 0; i < 3; i++) this.box(0.2, 0.34, 0.2, [0x7a9a4a, 0xb7683a, 0x4f7f8a][(seed + i) % 3]!, x + 0.2 + i * 0.3, 1.2, z + 0.28, false);
    for (let i = 0; i < 3; i++) this.box(0.4, 0.14, 0.3, [0x6e8f3a, 0x8b6b3c, 0x9a5a2a][(seed + i) % 3]!, x - 0.3 + i * 0.1, 1.09 + i * 0.12, z + 0.32, false);
    // Auvent : toile ocre tendue sur quatre perches
    for (const dx of [-1.45, 1.45]) for (const dz of [-0.6, 0.8]) this.box(0.08, 2.6, 0.08, 0x4a3320, x + dx, 1.3, z + dz, false);
    const tarp = this.box(3.3, 0.06, 1.8, [0xc89b3c, 0xa8532e, 0x6f8f5a, 0xc07a3c][seed % 4]!, x, 2.62, z + 0.1, false);
    tarp.rotation.x = -0.12;
  }

  /** Commerçante statique près d'un étal, avec une silhouette commune aux personnages jouables. */
  private marketSeller(x: number, z: number, rot: number, seed: number): void {
    const seller = buildPerson(this.mats, { ...randomLook(rng(seed)), female: true, outfit: seed % 3 ? 'casual' : 'boubou', fabric: seed % 2 ? 'wax' : 'kente' });
    seller.scale.setScalar(0.92);
    seller.position.set(x, 0, z);
    seller.rotation.y = rot;
    this.scene.add(seller);
  }

  /** Drapeau à bandes (horizontales ou verticales), avec un motif facultatif. */
  private stripes(colors: number[], vertical: boolean, extra?: (g: THREE.Group) => void): (g: THREE.Group) => void {
    return (g) => {
      const n = colors.length;
      colors.forEach((c, i) => {
        const m = new THREE.Mesh(this.geo(new THREE.BoxGeometry(vertical ? 2.4 / n : 2.4, vertical ? 1.6 : 1.6 / n, 0.04)), this.mats.color(c));
        if (vertical) m.position.set(2.4 / n / 2 + (i * 2.4) / n, 0, 0);
        else m.position.set(1.2, 0.8 - 1.6 / n / 2 - (i * 1.6) / n, 0);
        g.add(m);
      });
      extra?.(g);
    };
  }

  private patch(g: THREE.Group, color: number, w: number, h: number, x: number, y: number): void {
    const m = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, h, 0.06)), this.mats.color(color));
    m.position.set(x, y, 0);
    g.add(m);
  }

  /** Aéroport dans son repère local (x le long de la piste). */
  private buildAirport(x: number, z: number): void {
    // Parking et taxis, aérogare à toit ondulé, tarmac avec 3 postes et passerelles,
    // voie de circulation, piste 04/22 balisée (repère local : piste selon x, aérogare côté +z). Tour, radar, manche à air, dépôt de carburant.
    const glass = new THREE.MeshLambertMaterial({ color: 0x7fb6e8, emissive: 0x1d4f80, emissiveIntensity: 0.25 });
    this.nightMaterials.push(glass);
    const tx = x + 4;
    const tz = z + 3;
    // Côté ville : parvis, boucle de dépose-minute, stationnement et taxis.
    this.box(54, 0.06, 16, 0xc8cdd2, tx, 0.025, tz + 13, false);
    this.box(50, 0.07, 5.2, 0x4e555e, tx, 0.05, tz + 8.5, false);
    for (let i = 0; i < 13; i++) this.box(0.12, 0.02, 4, 0xffffff, tx - 24 + i * 4, 0.095, tz + 8.5, false);
    this.box(42, 0.06, 5.5, 0x646b74, tx, 0.05, tz + 16, false);
    for (let i = 0; i < 11; i++) this.box(0.12, 0.02, 4.2, 0xffffff, tx - 20 + i * 4, 0.095, tz + 16, false);
    this.box(44, 0.14, 1.5, 0xbfdc9c, tx, 0.08, tz + 12.2, false);
    for (let i = 0; i < 6; i++) this.tree(tx - 18 + i * 7.2, tz + 12.2);
    for (let i = 0; i < 6; i++) {
      const taxi = this.buildCar(0xffce00, 4.2);
      taxi.rotation.y = Math.PI / 2;
      taxi.position.set(tx - 17 + i * 6.5, 0, tz + 8.5);
      this.scene.add(taxi);
    }
    // Aérogare : socle, façade vitrée à montants, toit ondulé débordant, auvent d'entrée, enseigne
    this.box(42, 0.8, 11, 0xe9edf3, tx, 0.4, tz);
    this.solid(tx, tz, 42, 11);
    const hall = new THREE.Mesh(this.geo(new THREE.BoxGeometry(40, 6, 9)), glass);
    hall.position.set(tx, 3.8, tz);
    this.scene.add(hall);
    for (let i = 0; i <= 10; i++) this.box(0.25, 6, 9.2, 0xffffff, tx - 20 + i * 4, 3.8, tz, false);
    for (let i = 0; i < 5; i++) {
      const wave = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(4.6, 4.6, 13, 18, 1, false, 0, Math.PI)), this.mats.color(0xf3f5f8));
      wave.rotation.set(Math.PI / 2, 0, Math.PI / 2);
      wave.scale.set(1, 1, 0.28);
      wave.position.set(tx - 17.6 + i * 8.8, 6.8, tz);
      wave.castShadow = this.profile.shadows;
      this.scene.add(wave);
    }
    // Grande marquise et poteaux arborescents caractéristiques de la façade publique.
    this.box(34, 0.35, 4.2, 0xf7f8fa, tx, 5.4, tz + 6.2, false);
    for (let i = 0; i < 7; i++) {
      const px = tx - 15 + i * 5;
      this.box(0.32, 4.3, 0.32, 0xf7f8fa, px, 2.15, tz + 7.7, false);
      const left = this.box(0.25, 3.2, 0.25, 0xf7f8fa, px - 0.75, 4.25, tz + 7.7, false);
      const right = this.box(0.25, 3.2, 0.25, 0xf7f8fa, px + 0.75, 4.25, tz + 7.7, false);
      left.rotation.z = -0.5;
      right.rotation.z = 0.5;
    }
    this.box(10, 4.7, 0.12, 0x21496b, tx, 2.5, tz + 4.58, false);
    this.box(2.4, 3.1, 0.16, 0xb9d7ec, tx, 1.55, tz + 4.68, false);
    const sign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(18, 1.6)), new THREE.MeshBasicMaterial({ map: this.posterTexture('AÉROPORT INTERNATIONAL DE LOMÉ', '', '#14213d', '#ffffff', 1024, 92) }));
    sign.position.set(tx, 6.35, tz + 4.62);
    this.scene.add(sign);
    // Tarmac et trois postes de stationnement avec passerelles
    const apronZ = tz - 13;
    this.box(110, 0.07, 15, 0xb9bec6, x - 5, 0.04, apronZ, false);
    [0x22a861, 0x1f6feb, 0xd21034].forEach((livery, i) => {
      const px = tx - 26 + i * 22;
      this.box(0.25, 0.02, 14, 0xffce00, px, 0.09, apronZ, false); // ligne de guidage du poste
      const pl = this.buildPlane(livery);
      pl.scale.setScalar(0.62);
      pl.rotation.y = -Math.PI / 2; // nez vers l'aérogare (+z)
      pl.position.set(px, 0, apronZ - 0.5);
      this.scene.add(pl);
      this.solid(px, apronZ - 0.5, 3, 14);
      // Passerelle télescopique de l'aérogare jusqu'à la porte avant
      const bridge = this.box(1.6, 1.6, 4.2, 0xdfe4ea, px + 2.4, 2.4, tz - 6.3);
      bridge.rotation.y = 0.35;
      this.box(0.4, 2.2, 0.4, 0x6f7f93, px + 3, 1.1, tz - 7.6, false);
      // Véhicules de piste : tracteur bagages et camion-citerne
      this.box(1.6, 0.8, 1, 0xffce00, px + 5, 0.4, apronZ + 3, false);
      this.box(1.2, 0.5, 1, 0x9aa1a8, px + 6.8, 0.25, apronZ + 3, false);
    });
    // Voie de circulation : bord bitumé, axe jaune, feux bleus
    const twZ = apronZ - 10;
    this.box(124, 0.07, 6, 0x4a5058, x - 5, 0.05, twZ, false);
    this.box(124, 0.02, 0.25, 0xffce00, x - 5, 0.1, twZ, false);
    // Bretelles courtes reliant chaque poste au taxiway sans traverser le terminal.
    for (const px of [tx - 26, tx - 4, tx + 18]) {
      this.box(5.5, 0.065, 8, 0x555c64, px, 0.045, apronZ - 5, false);
      this.box(0.2, 0.02, 8, 0xffce00, px, 0.09, apronZ - 5, false);
    }
    for (let i = 0; i < 25; i++) for (const side of [-1, 1]) this.box(0.18, 0.3, 0.18, 0x3b82f6, x - 66 + i * 5, 0.15, twZ + side * 3.2, false);
    // Piste 04/22 : bandes de seuil, indicatifs, zone de toucher, axe, feux de bord et d'extrémité
    const rz = twZ - 10;
    const rx = x - 5;
    this.box(130, 0.08, 11, 0x33383f, rx, 0.06, rz, false);
    for (let i = 0; i < 16; i++) this.box(4, 0.02, 0.4, 0xffffff, rx - 52 + i * 7, 0.12, rz, false);
    for (const end of [-1, 1]) {
      for (let k = 0; k < 8; k++) this.box(4, 0.02, 0.5, 0xffffff, rx + end * 61, 0.12, rz - 4.2 + k * 1.2, false);
      for (const side of [-1, 1]) {
        this.box(3, 0.02, 0.9, 0xffffff, rx + end * 46, 0.12, rz + side * 2.6, false); // zone de toucher
        this.box(6, 0.02, 1.4, 0xffffff, rx + end * 38, 0.12, rz + side * 2.6, false); // point de visée
      }
      const num = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(4.4, 2.4)), new THREE.MeshBasicMaterial({ map: this.posterTexture(end < 0 ? '22' : '04', '', '#33383f', '#ffffff', 256, 140), transparent: false }));
      num.rotation.set(-Math.PI / 2, 0, end < 0 ? -Math.PI / 2 : Math.PI / 2);
      num.position.set(rx + end * 54, 0.13, rz);
      this.scene.add(num);
      for (let k = 0; k < 9; k++) this.box(0.25, 0.3, 0.25, end < 0 ? 0x22c55e : 0xef4444, rx + end * 65.2, 0.15, rz - 4.8 + k * 1.2, false);
    }
    for (let i = 0; i < 26; i++) for (const side of [-1, 1]) this.box(0.2, 0.25, 0.2, 0xfff2b0, rx - 62 + i * 5, 0.15, rz + side * 5.7, false);
    // Tour de contrôle, radar tournant, manche à air, dépôt de carburant
    this.box(2.6, 20, 2.6, 0xf3efe6, x + 46, 10, z - 2);
    this.solid(x + 46, z - 2, 2.8, 2.8);
    const cab = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(2.8, 2.1, 2.6, 10)), glass);
    cab.position.set(x + 46, 21.3, z - 2);
    this.scene.add(cab);
    this.box(6, 0.4, 6, 0xffffff, x + 46, 22.8, z - 2);
    this.box(0.12, 3, 0.12, 0xe5383b, x + 46, 24.5, z - 2, false);
    this.box(0.6, 6, 0.6, 0x9aa1a8, x + 52, 3, z - 9, false);
    const radar = new THREE.Mesh(this.geo(new THREE.BoxGeometry(4, 1.2, 0.3)), this.mats.color(0xffffff));
    radar.position.set(x + 52, 6.4, z - 9);
    this.scene.add(radar);
    this.radars.push(radar);
    this.box(0.12, 4, 0.12, 0xdfe4ea, rx - 40, 2, rz + 8, false);
    const sock = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.4, 2, 8, 1, true)), this.mats.color(0xf18f01));
    sock.rotation.z = Math.PI / 2;
    sock.position.set(rx - 39, 3.8, rz + 8);
    this.scene.add(sock);
    for (let i = 0; i < 3; i++) {
      const tank = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(2, 2, 3, 16)), this.mats.color(0xffffff));
      tank.position.set(x + 56 + (i % 2) * 5, 1.5, z - 18 + i * 3.5);
      tank.castShadow = this.profile.shadows;
      this.scene.add(tank);
    }
    // Avion animé : décollages et atterrissages sur la piste
    const plane = this.buildPlane(0xd21034);
    plane.position.set(rx - 60, 0, rz);
    this.scene.add(plane);
    this.flights.push({ g: plane, x0: rx - 60, x1: rx + 55, z: rz, t: 0 });
  }

  private buildVenue(v: CityVenue): void {
    const { x, z } = v;
    switch (v.id) {
      case 'marche_assigame': {
        // Grand Marché d'Adawlato : bâtiment central de cinq niveaux (dont sous-sol et terrasse),
        // allongé comme l'emprise réelle de 150 × 50 m, entouré des rues d'étals d'Assigamé.
        this.box(30, 0.12, 20, 0xaaa49a, x, 0.06, z - 2, false);
        this.box(28, 13.2, 10.5, 0xe8d6b8, x, 6.6, z - 7);
        this.solid(x, z - 7, 28, 10.5);
        this.solid(x, z + 3.8, 29, 6);
        this.box(28.4, 0.45, 10.9, 0x8d5b42, x, 13.4, z - 7, false);
        this.box(26.5, 0.28, 9.2, 0xb85c43, x, 13.82, z - 7, false);
        // Quatre niveaux visibles au-dessus du sous-sol : socle poreux et trois plateaux marchands.
        for (const y of [3.3, 6.3, 9.3, 12.3]) this.box(28.2, 0.22, 10.7, 0xf4ead8, x, y, z - 7, false);
        for (let i = 0; i < 10; i++) {
          const wx = x - 12.1 + i * 2.7;
          for (const wy of [4.75, 7.75, 10.75]) this.box(1.55, 1.2, 0.12, 0x38566f, wx, wy, z - 1.7, false);
          this.box(1.6, 2.25, 0.18, 0x5b3a29, wx, 1.25, z - 1.42, false);
        }
        // Rideau de briques ajourées ocre du projet d'Adawlato, interrompu par de grandes poches verticales.
        const latticeX = Array.from({ length: 33 }, (_, i) => x - 13.2 + i * 0.825).filter((px) => Math.abs(px - x) > 1.6 && Math.abs(Math.abs(px - x) - 8) > 1.1);
        const lattice = this.instanced(new THREE.BoxGeometry(0.22, 9.3, 0.22), this.mats.color(0xb66a42), latticeX.length, false);
        latticeX.forEach((px, i) => this.setInstance(lattice, i, px, 8, z - 1.47));
        for (const dx of [-8, 0, 8]) {
          this.box(2.2, 0.45, 0.55, 0x6c854e, x + dx, 6.4, z - 1.3, false);
          const foliage = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.8, 9, 7)), this.mats.color(0x4f7a3a));
          foliage.scale.set(1.3, 1.8, 0.65);
          foliage.position.set(x + dx, 7.35, z - 1.2);
          this.scene.add(foliage);
        }
        // Couverture plissée continue : deux versants par travée, sans triangles manquants.
        const canopyCols = [0xd95d39, 0xe3b341, 0x28785e, 0x315b88, 0x8b4f91];
        for (let row = 0; row < 2; row++) for (let i = 0; i < 12; i++) {
          const x0 = x - 14 + i * (28 / 12);
          const x1 = x - 14 + (i + 1) * (28 / 12);
          const zm = z - 7 + (row ? 2.65 : -2.65);
          const ridge = 16.3;
          const xm = (x0 + x1) / 2;
          const geo = new THREE.BufferGeometry();
          geo.setAttribute('position', new THREE.Float32BufferAttribute([
            x0, 15.45, zm - 2.65, x0, 15.45, zm + 2.65,
            xm, ridge, zm - 2.65, xm, ridge, zm + 2.65,
            x1, 15.45, zm - 2.65, x1, 15.45, zm + 2.65,
          ], 3));
          geo.setIndex([0, 1, 2, 2, 1, 3, 2, 3, 4, 4, 3, 5]);
          geo.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0.5, 0, 0.5, 1, 1, 0, 1, 1], 2));
          geo.computeVertexNormals();
          const tri = new THREE.Mesh(this.geo(geo), this.mats.color(canopyCols[(i + row * 2) % canopyCols.length]!));
          tri.material.side = THREE.DoubleSide;
          tri.castShadow = this.profile.shadows;
          this.scene.add(tri);
        }
        for (const dx of [-11, -5.5, 0, 5.5, 11]) this.box(0.16, 2.8, 0.16, 0xd8d3c7, x + dx, 14.5, z - 7, false);
        const marketSign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(11, 1.2)), new THREE.MeshBasicMaterial({ map: this.posterTexture('GRAND MARCHÉ', 'ASSIGAMÉ • ADOWLATO', '#8d2d2d', '#fff1cf', 768, 96) }));
        marketSign.position.set(x, 12.35, z - 1.2);
        this.scene.add(marketSign);
        const colors = [0xe5383b, 0xffce00, 0x22a861, 0x1f6feb, 0xf18f01, 0x8e44ad];
        for (let row = 0; row < 2; row++) {
          for (let col = 0; col < 6; col++) {
            const sx = x - 12.5 + col * 5;
            const sz = z + 2 + row * 3.6;
            this.marketStall(sx, sz, colors[(col + row * 2) % colors.length]!, 30 + row * 10 + col, col % 3 === 0);
          }
        }
        for (const [dx, dz, rot, seed] of [[-10, 0.6, 0, 211], [-3, 3.7, Math.PI, 212], [5, 0.6, 0, 213], [11, 4.1, Math.PI, 214]] as const) this.marketSeller(x + dx, z + dz, rot, seed);
        break;
      }
      case 'plage_lome':
        for (let i = 0; i < 4; i++) {
          const um = new THREE.Mesh(this.geo(new THREE.ConeGeometry(1.8, 0.8, 8)), this.mats.wax(i));
          um.position.set(x - 9 + i * 6, 2.6, z - 1);
          this.scene.add(um);
          this.box(0.1, 2.4, 0.1, 0xffffff, x - 9 + i * 6, 1.2, z - 1, false);
        }
        break;
      case 'maquis_be': {
        const roof = new THREE.Mesh(this.geo(new THREE.ConeGeometry(5, 1.8, 8)), this.mats.wax(0));
        roof.position.set(x, 3.6, z - 2);
        this.scene.add(roof);
        [[-3.5, -3.5], [3.5, -3.5], [-3.5, 1.5], [3.5, 1.5]].forEach(([dx, dz]) => this.box(0.2, 3, 0.2, 0x5b3a1e, x + dx!, 1.5, z - 2 + dz!, false));
        const bulbMat = new THREE.MeshLambertMaterial({ color: 0x553300, emissive: 0xffb347, emissiveIntensity: 0 });
        this.nightMaterials.push(bulbMat);
        const bulbs = this.instanced(new THREE.SphereGeometry(0.14, 6, 4), bulbMat, 12, false);
        for (let b = 0; b < 12; b++) this.setInstance(bulbs, b, x + Math.cos((b / 12) * Math.PI * 2) * 4.6, 2.8, z - 2 + Math.sin((b / 12) * Math.PI * 2) * 4.6);
        if (this.profile.pointLights > 0) {
          const pl = new THREE.PointLight(0xffa64d, 0, 18, 2);
          pl.position.set(x, 2.5, z - 2);
          this.pointLights.push(pl);
          this.scene.add(pl);
        }
        break;
      }
      case 'eza_zozo': {
        // EZA ZOZO : petite adresse togolaise près d'Adidoadin, avec terrasse et grill visible.
        this.box(18, 0.12, 15, 0xd8c8aa, x, 0.06, z - 1, false);
        this.box(15, 5.4, 7.5, 0xf0c44c, x, 2.7, z - 4.5);
        this.solid(x, z - 4.5, 15, 7.5);
        this.box(16, 0.6, 8.5, 0x8b2c24, x, 5.7, z - 4.5, false);
        this.box(11.5, 3.2, 0.18, 0x493126, x, 2.1, z - 0.65, false);
        const sign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(10.5, 2.1)), new THREE.MeshBasicMaterial({ map: this.posterTexture('EZA ZOZO', 'SAVEURS TOGOLAISES', '#f2c94c', '#8b1e1e', 768, 150) }));
        sign.position.set(x, 4.35, z - 0.52);
        this.scene.add(sign);
        const awning = this.box(13, 0.28, 4, 0x8b1e1e, x, 3.4, z + 1.6, false);
        awning.rotation.x = -0.12;
        for (const dx of [-5.5, 0, 5.5]) {
          this.box(2.4, 0.18, 2.4, 0xe7d8ba, x + dx, 0.8, z + 4, false);
          this.box(0.18, 1.5, 0.18, 0x5b3a29, x + dx, 0.75, z + 4, false);
        }
        this.box(3.2, 1.1, 1.8, 0x363a3f, x + 6.2, 0.55, z + 1.7, false);
        this.box(2.8, 0.12, 1.4, 0xd96b27, x + 6.2, 1.18, z + 1.7, false);
        // Embellissements : toit en terrasse bordé d'un acrotère, vitrines chaudes, auvent rayé, parasols, chaises, plantes, guirlandes, panneau du jour.
        this.box(15.6, 0.5, 0.35, 0xfff3d6, x, 6.25, z - 0.9, false);
        this.box(0.35, 0.5, 7.9, 0xfff3d6, x - 7.8, 6.25, z - 4.5, false);
        this.box(0.35, 0.5, 7.9, 0xfff3d6, x + 7.8, 6.25, z - 4.5, false);
        const glow = new THREE.MeshLambertMaterial({ color: 0xffe2a0, emissive: 0xffa630, emissiveIntensity: 0.35 });
        this.nightMaterials.push(glow);
        for (const dx of [-5.2, 5.2]) {
          const win = new THREE.Mesh(this.geo(new THREE.BoxGeometry(2.6, 1.8, 0.1)), glow);
          win.position.set(x + dx, 2.4, z - 0.62);
          this.scene.add(win);
          this.box(2.9, 0.18, 0.2, 0x8b1e1e, x + dx, 3.4, z - 0.55, false);
        }
        for (let i = 0; i < 7; i++) this.box(13 / 7, 0.3, 4.02, i % 2 ? 0xfff3d6 : 0x8b1e1e, x - 6 + (i + 0.5) * (13 / 7) - 0.5, 3.42, z + 1.6, false).rotation.x = -0.12;
        for (const [dx, col] of [[-5.5, 0xd96b27], [0, 0x2f8f5b], [5.5, 0xf2c94c]] as const) {
          this.box(0.1, 2.2, 0.1, 0x5b3a29, x + dx, 1.1, z + 4, false);
          const par = new THREE.Mesh(this.geo(new THREE.ConeGeometry(2, 0.7, 10)), this.mats.color(col));
          par.position.set(x + dx, 2.5, z + 4);
          this.scene.add(par);
          for (const [cx, cz] of [[-1.7, 0], [1.7, 0], [0, 1.7], [0, -1.7]] as const) this.box(0.7, 0.55, 0.7, 0x7a4a2b, x + dx + cx, 0.28, z + 4 + cz, false);
        }
        for (const dx of [-8.2, 8.2]) {
          this.box(1, 0.8, 1, 0xb8643c, x + dx, 0.4, z - 0.2, false);
          const plant = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.9, 8, 6)), this.mats.color(0x2f8f3a));
          plant.position.set(x + dx, 1.5, z - 0.2);
          this.scene.add(plant);
        }
        const bulbs = new THREE.MeshBasicMaterial({ color: 0xfff0b0 });
        for (let i = 0; i < 12; i++) {
          const bulb = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.12, 6, 4)), bulbs);
          bulb.position.set(x - 6.5 + i * 1.2, 3.1 - Math.sin((i / 11) * Math.PI) * 0.35, z + 3.6);
          this.scene.add(bulb);
        }
        this.box(1.6, 1.1, 0.12, 0x2b2b2b, x - 8.5, 1.1, z + 2.2, false);
        this.box(0.1, 0.55, 0.1, 0x5b3a29, x - 8.5, 0.28, z + 2.2, false);
        for (let i = 0; i < 3; i++) {
          const smoke = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.35 + i * 0.12, 8, 6)), new THREE.MeshBasicMaterial({ color: 0xdddddd, transparent: true, opacity: 0.35 - i * 0.08 }));
          smoke.position.set(x + 6.2, 1.9 + i * 0.7, z + 1.7);
          this.scene.add(smoke);
        }
        break;
      }
      case 'port': {
        // Port en eau profonde : bassin protégé, terre-pleins, darse LCT simplifiée, quais et logistique terrestre.
        const cols = [0xe5383b, 0x1f6feb, 0x22a861, 0xf18f01, 0xffffff, 0x8e44ad];
        // Bassin et deux digues laissent une passe nette vers le large.
        this.box(68, 0.035, 94, 0x277fa7, x + 1, 0.012, z + 60, false);
        this.box(3.2, 1.1, 86, 0x8e9499, x - 32, 0.5, z + 59, false);
        this.box(3.2, 1.1, 64, 0x8e9499, x + 34, 0.5, z + 48, false);
        for (const bx of [x - 32, x + 34]) {
          const head = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(2.4, 2.8, 1.2, 18)), this.mats.color(0x777f86));
          head.position.set(bx, 0.55, z + (bx < x ? 102 : 80));
          this.scene.add(head);
          this.box(0.3, 4.2, 0.3, 0xdfe4ea, bx, 2.7, head.position.z, false);
          this.box(0.65, 0.55, 0.65, bx < x ? 0x22c55e : 0xef4444, bx, 4.95, head.position.z, false);
        }
        // Zone sous douane, entrée poids-lourds, entrepôts et voies du parc à conteneurs : tout le terre-plein commence
        // au sud du boulevard du bord de mer (son trottoir s'arrête à z ≈ 19,6). Avant, les entrepôts étaient posés sur la chaussée.
        this.box(50, 0.12, 14.5, 0x858c93, x - 3, 0.06, z + 7.25, false);
        this.solid(x - 3, z + 7.75, 50, 13.5); // la bande du portail reste libre : on y arrive à pied
        // Direction générale du Port (photo du siège) : tour ronde en verre doré réfléchissant à bandeaux horizontaux, deux tambours
        // en béton ocre à bande vitrée verticale, deux piliers blancs jusqu'au disque TOGO PORT, bandeau courbe du nom, antenne
        // au sommet, grille blanche sur la rue. Façade vers le boulevard (nord).
        {
          const hx = x - 26;
          const hz = z + 6;
          const gold = new THREE.MeshLambertMaterial({ color: 0x5f9ed1, emissive: 0xffe2a8, emissiveIntensity: 0 }); // verre bleu réfléchissant
          this.nightMaterials.push(gold);
          this.nightScale.set(gold, 0.15);
          const ochre = 0xeceff2; // panneaux composites blancs
          this.box(15, 0.12, 10.5, 0xe9e4d8, hx, 0.06, hz, false); // parvis
          // Bâtiment sur pilotis (photos) : rez-de-chaussée ouvert, tour de verre doré au centre, deux tambours de verre devant
          // deux grands murs ocre, ailes basses ocre à bandes de fenêtres, cheminée ronde au bout.
          const GOLD_TOP = 17;
          for (const [px, pz] of [[-3, -1.6], [3, -1.6], [-6.2, 0.4], [6.2, 0.4], [-9.4, 1.2], [9.4, 1.2], [-3, 2.4], [3, 2.4]] as const) {
            const col = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.3, 0.3, 3, 10)), this.mats.color(0xd9dde2));
            col.position.set(hx + px, 1.5, hz + pz);
            this.scene.add(col);
          }
          const tower = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(3.6, 3.6, GOLD_TOP - 3, 32)), gold);
          tower.position.set(hx, (GOLD_TOP + 3) / 2, hz);
          this.scene.add(tower);
          this.solid(hx, hz, 7.2, 7.2);
          for (let ry = 4.2; ry < GOLD_TOP; ry += 1.5) {
            const ring = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(3.66, 3.66, 0.14, 32, 1, true)), this.mats.color(0xeef0f2));
            ring.position.set(hx, ry, hz);
            this.scene.add(ring);
          }
          const cap = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(3.85, 3.85, 0.6, 32)), this.mats.color(0xf2f4f6));
          cap.position.set(hx, GOLD_TOP + 0.25, hz);
          this.scene.add(cap);
          // Lisse lumineuse d'acrotère (LED bleue qui s'allume la nuit) et couronne vitrée sur le toit
          const ledMat = new THREE.MeshLambertMaterial({ color: 0x1b4f8a, emissive: 0x4fd1ff, emissiveIntensity: 0 });
          this.nightMaterials.push(ledMat);
          this.nightScale.set(ledMat, 1.8);
          const led = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(3.9, 3.9, 0.18, 32)), ledMat);
          led.position.set(hx, GOLD_TOP + 0.65, hz);
          this.scene.add(led);
          const crown = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(2.3, 2.6, 1.9, 24)), gold);
          crown.position.set(hx, GOLD_TOP + 1.7, hz);
          this.scene.add(crown);
          const roofRing = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(2.7, 2.7, 0.2, 24)), this.mats.color(0xf2f4f6));
          roofRing.position.set(hx, GOLD_TOP + 2.75, hz);
          this.scene.add(roofRing);
          // Meneaux verticaux en aluminium blanc autour de la tour
          for (let i = 0; i < 20; i++) {
            const an = (i / 20) * Math.PI * 2;
            const fin = this.box(0.1, GOLD_TOP - 3, 0.1, 0xf2f4f6, hx + Math.sin(an) * 3.68, (GOLD_TOP + 3) / 2, hz + Math.cos(an) * 3.68, false);
            fin.rotation.y = an;
          }
          for (const side of [-1, 1]) {
            const dx = hx + side * 5.6;
            // Mur ocre plein derrière le tambour, déborde sur le côté
            this.box(3.6, 12.5, 1.6, ochre, hx + side * 8.2, 9.25, hz + 1.6);
            this.solid(hx + side * 8.2, hz + 1.6, 3.6, 1.6);
            // Tambour de verre doré
            const drum = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(3, 3, 9.5, 28)), gold);
            drum.position.set(dx, 7.75, hz - 0.2);
            this.scene.add(drum);
            this.solid(dx, hz - 0.2, 5.6, 5.6);
            for (let ry = 3.9; ry < 12.5; ry += 1.4) {
              const ring = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(3.05, 3.05, 0.12, 28, 1, true)), this.mats.color(0xeef0f2));
              ring.position.set(dx, ry, hz - 0.2);
              this.scene.add(ring);
            }
            const top = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(3.15, 3.15, 0.4, 28)), this.mats.color(0x14367a));
            top.position.set(dx, 12.6, hz - 0.2);
            this.scene.add(top);
            // Aile basse ocre à bande de fenêtres, et cheminée ronde à l'extrémité
            if (side > 0) continue; // côté est : les piles de conteneurs
            const wx = hx + side * 14.2;
            this.box(8, 5.4, 5.6, ochre, wx, 2.7, hz + 1.2);
            this.solid(wx, hz + 1.2, 8, 5.6);
            for (const wxo of [-2.8, -0.9, 1, 2.9]) this.box(1.2, 1, 0.08, 0x2b3a4a, wx + wxo, 3.5, hz - 1.64, false);
            this.box(8.2, 0.3, 5.8, 0x14367a, wx, 5.55, hz + 1.2, false);
          }
          const chim = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(1.2, 1.2, 9.5, 18)), this.mats.color(ochre));
          chim.position.set(hx - 19.5, 4.75, hz + 1.2);
          this.scene.add(chim);
          // Rez-de-chaussée : cœur vitré sombre sous la tour
          const foot = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(3.4, 3.4, 3, 32, 1, true, Math.PI - 1.1, 2.2)), this.mats.color(0x2b3a4a));
          foot.position.set(hx, 1.5, hz);
          this.scene.add(foot);
          // Disque du logo (anneau jaune, ancre bleue, ruban TOGO ★ PORT), dessiné une fois
          const logo = document.createElement('canvas');
          logo.width = logo.height = 256;
          const g = logo.getContext('2d')!;
          g.fillStyle = '#ffffff';
          g.beginPath();
          g.arc(128, 128, 126, 0, Math.PI * 2);
          g.fill();
          g.lineWidth = 10;
          g.strokeStyle = '#1f3f9c';
          g.stroke();
          g.lineWidth = 26;
          g.strokeStyle = '#f2d12e';
          g.beginPath();
          g.arc(128, 122, 84, Math.PI * 0.85, Math.PI * 2.15);
          g.stroke();
          g.fillStyle = '#1f3f9c';
          g.strokeStyle = '#1f3f9c';
          g.lineWidth = 16;
          g.beginPath();
          g.arc(128, 52, 14, 0, Math.PI * 2);
          g.stroke();
          g.fillRect(120, 62, 16, 120);
          g.fillRect(92, 84, 72, 12);
          g.lineWidth = 14;
          g.beginPath();
          g.arc(128, 132, 52, Math.PI * 0.15, Math.PI * 0.85);
          g.stroke();
          g.beginPath();
          g.moveTo(68, 150);
          g.lineTo(90, 172);
          g.lineTo(62, 178);
          g.fill();
          g.beginPath();
          g.moveTo(188, 150);
          g.lineTo(166, 172);
          g.lineTo(194, 178);
          g.fill();
          g.fillStyle = '#1f3f9c';
          g.beginPath();
          g.moveTo(40, 196);
          g.quadraticCurveTo(128, 240, 216, 196);
          g.lineTo(206, 222);
          g.quadraticCurveTo(128, 260, 50, 222);
          g.fill();
          g.fillStyle = '#ffffff';
          g.font = 'bold 26px sans-serif';
          g.textAlign = 'center';
          g.fillText('TOGO ★ PORT', 128, 232);
          const logoTex = new THREE.CanvasTexture(logo);
          logoTex.colorSpace = THREE.SRGBColorSpace;
          this.mats.textures.push(logoTex);
          // Vrai logo si le fichier public/brands/togo-port.png est présent (rogné dans le disque) ; sinon le tracé simplifié ci-dessus
          void this.loadLogo(`${import.meta.env.BASE_URL}brands/togo-port.png`).then((img) => {
            if (!img || img.naturalWidth === 0) return;
            const side = Math.min(img.naturalWidth * 0.7, img.naturalHeight * 0.88);
            g.save();
            g.fillStyle = '#ffffff';
            g.beginPath();
            g.arc(128, 128, 126, 0, Math.PI * 2);
            g.fill();
            g.clip();
            g.drawImage(img, img.naturalWidth / 2 - side / 2, img.naturalHeight * 0.47 - side / 2, side, side, 6, 6, 244, 244);
            g.restore();
            logoTex.needsUpdate = true;
          });
          const logoMat = new THREE.MeshBasicMaterial({ map: logoTex, transparent: true });
          // Bandeau courbe : texte bleu sur blanc, autour de la tour
          const ban = document.createElement('canvas');
          ban.width = 1024;
          ban.height = 96;
          const bg = ban.getContext('2d')!;
          bg.fillStyle = '#ffffff';
          bg.fillRect(0, 0, 1024, 96);
          bg.fillStyle = '#1f3f9c';
          bg.fillRect(0, 0, 1024, 6);
          bg.fillRect(0, 90, 1024, 6);
          bg.font = 'bold 62px sans-serif';
          bg.textAlign = 'center';
          bg.textBaseline = 'middle';
          bg.fillText('PORT AUTONOME DE LOMÉ', 512, 50);
          const banTex = new THREE.CanvasTexture(ban);
          banTex.colorSpace = THREE.SRGBColorSpace;
          this.mats.textures.push(banTex);
          const banMat = new THREE.MeshBasicMaterial({ map: banTex, side: THREE.DoubleSide });
          // Deux piliers blancs sur le devant, portant le panneau du logo
          const fz = hz - 4.0;
          for (const dx of [-1.3, 1.3]) {
            const pil = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.2, 0.2, 18.6, 12)), this.mats.color(0xf2f4f6));
            pil.position.set(hx + dx, 9.3, fz);
            this.scene.add(pil);
          }
          this.box(4, 3.8, 0.3, 0xf2f4f6, hx, 18.4, fz, false);
          const disc = new THREE.Mesh(this.geo(new THREE.CircleGeometry(1.6, 40)), logoMat);
          disc.position.set(hx, 18.4, fz - 0.17);
          disc.rotation.y = Math.PI;
          this.scene.add(disc);
          // Bandeau courbe du nom, en travers des deux piliers
          const arc = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(4.0, 4.0, 1.0, 36, 1, true, Math.PI - 1.0, 2.0)), banMat);
          arc.position.set(hx, 6.0, hz);
          this.scene.add(arc);
          // Antenne de télécommunication au sommet
          this.box(0.25, 9, 0.25, 0xc9ced4, hx - 1, 22.3, hz + 0.5, false);
          for (const ay of [19.5, 22, 24.5]) this.box(1.4, 0.12, 0.12, 0xc9ced4, hx - 1, ay, hz + 0.5, false);
          const mast = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.4, 0.4, 0.4)), this.mats.color(0xe5383b));
          mast.position.set(hx - 1, 26.9, hz + 0.5);
          this.scene.add(mast);
          // Grille blanche sur la rue, haie, palmier et trois mâts de drapeaux
          for (let i = -6; i <= 6; i++) this.box(0.1, 1.5, 0.1, 0xf2f4f6, hx + i * 1.1, 0.8, hz - 5.6, false);
          this.box(13, 0.1, 0.1, 0xf2f4f6, hx, 1.4, hz - 5.6, false);
          this.box(13, 0.1, 0.1, 0xf2f4f6, hx, 0.4, hz - 5.6, false);
          this.box(5, 0.7, 0.7, 0x2f7a2e, hx - 5, 0.45, hz - 4.6, false);
          for (const [k, flx] of [hx + 5, hx + 6, hx + 7].entries()) {
            this.box(0.1, 6.5, 0.1, 0xf2f4f6, flx, 3.3, hz - 4.8, false);
            this.box(1.1, 0.7, 0.04, [0x1f8a3c, 0xf2d12e, 0x1f3f9c][k]!, flx + 0.57, 6.1, hz - 4.8, false);
          }
          const trunk = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.14, 0.22, 4.6, 7)), this.mats.color(0x8a6a45));
          trunk.position.set(hx + 3.6, 2.3, hz - 4.8);
          this.scene.add(trunk);
          for (let i = 0; i < 6; i++) {
            const leaf = this.box(0.4, 0.07, 2.1, 0x3f8f3a, hx + 3.6 + Math.sin((i * Math.PI) / 3) * 0.9, 4.55, hz - 4.8 + Math.cos((i * Math.PI) / 3) * 0.9, false);
            leaf.rotation.set(0.35, (i * Math.PI) / 3, 0);
          }
        }
        // Entrepôt moderne (à l'est) : bardage gris clair, bande bleue, toit à faible pente, quais de chargement
        this.box(11, 5, 6, 0xd9dde2, x + 17, 2.5, z + 5);
        this.box(11.1, 0.7, 6.1, 0x1f4e9c, x + 17, 4.3, z + 5, false);
        this.box(11.4, 0.35, 6.4, 0x9aa3ad, x + 17, 5.15, z + 5, false);
        for (const dx of [-3.2, 0, 3.2]) this.box(2.2, 2.6, 0.08, 0x5b6470, x + 17 + dx, 1.3, z + 1.98, false);
        // Portail poids-lourds : auvent blanc sur portiques, trois voies avec feux vert ou rouge et barrières
        this.box(26, 0.45, 4.6, 0xf2f4f6, x, 4.4, z + 1.2, false);
        this.box(26.2, 0.18, 4.8, 0x1f4e9c, x, 4.1, z + 1.2, false);
        for (const lx of [x - 12, x - 4, x + 4, x + 12]) this.box(0.5, 4.2, 0.5, 0xdfe4ea, lx, 2.1, z + 1.2, false);
        const laneLed = new THREE.MeshLambertMaterial({ color: 0x0b2a14, emissive: 0x22e06a, emissiveIntensity: 0 });
        this.nightMaterials.push(laneLed);
        this.nightScale.set(laneLed, 1.4);
        for (const [k, lx] of [x - 8, x, x + 8].entries()) {
          this.box(5.5, 0.025, 0.16, 0xffffff, lx, 0.135, z + 0.6, false);
          const led = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.7, 0.35, 0.12)), k === 1 ? this.mats.color(0xd9534f) : laneLed);
          led.position.set(lx, 3.8, z + 3.45);
          this.scene.add(led);
          this.box(4.2, 0.14, 0.14, k === 1 ? 0xd9534f : 0xf2f4f6, lx - 0.4, 1.0, z + 1.9, false); // barrière
          this.box(0.9, 1.1, 0.9, 0x2b2f36, lx - 2.6, 0.55, z + 1.9, false); // borne de badge
        }
        const palSign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(15, 1.45)), new THREE.MeshBasicMaterial({ map: this.posterTexture('PORT AUTONOME DE LOMÉ', 'TOGO PORT', '#0d4770', '#f2c94c', 1024, 100) }));
        palSign.position.set(x - 3, 5.8, z + 1.25);
        this.scene.add(palSign);
        // Camions en attente, alignés le long du terre-plein, sans milliers de maillages.
        for (let i = 0; i < 3; i++) {
          const truck = this.buildCar([0xffffff, 0x1f6feb, 0xe5383b][i % 3]!, 5.8);
          truck.scale.set(1.05, 1, 1.22);
          truck.rotation.y = Math.PI / 2;
          truck.position.set(x - 14 + i * 8, 0, z + 12.5);
          this.scene.add(truck);
        }
        for (let i = 0; i < 24; i++) this.box(5.8, 2.4, 2.3, cols[i % cols.length]!, x - 14 + (i % 4) * 6.4, 1.2 + Math.floor(i / 12) * 2.4, z + 4 + (Math.floor(i / 4) % 3) * 2.6);
        this.solid(x - 4.4, z + 6.6, 27, 8);
        this.box(16, 0.1, 30, 0x4a5058, x + 2, 0.4, z + 30, false); // quai en enrobé sombre
        for (const lx of [x - 2, x + 4.5, x + 9.2]) this.box(0.18, 0.02, 29, 0xf2c94c, lx, 0.46, z + 30, false); // marquage jaune des voies
        this.box(0.5, 0.06, 30, 0xf2c94c, x + 9.9, 0.48, z + 30, false); // bordure de quai jaune
        this.box(16.4, 0.6, 30.4, 0x8f98a3, x + 2, 0.05, z + 30, false);
        for (let i = 0; i < 6; i++) this.box(0.4, 0.5, 0.4, 0x222222, x + 9.6, 0.65, z + 18 + i * 5, false); // bollards
        // Portiques de quai (grues à conteneurs) : chariot sur la flèche, câbles, palonnier et conteneur porté
        // Portiques modernes (type super post-panamax), rouges comme ceux du terminal de Lomé : portique à quatre pieds et entretoises, salle des machines,
        // pylône en A haubané, longue flèche au-dessus du navire et contre-flèche côté terre, feux d'obstacle rouges la nuit.
        const craneLamp = new THREE.MeshLambertMaterial({ color: 0x5a0a0a, emissive: 0xff2a1f, emissiveIntensity: 0 });
        this.nightMaterials.push(craneLamp);
        this.nightScale.set(craneLamp, 1.6);
        for (const gz of [z + 22, z + 34]) {
          const W = 0xd2401f; // rouge des portiques de Lomé
          const B = 0x9c2f17;
          for (const dx of [-3, 3]) for (const dz of [-1.6, 1.6]) this.box(0.55, 14, 0.55, W, x + 6 + dx, 7, gz + dz, false);
          for (const dx of [-3, 3]) this.box(0.5, 0.5, 3.7, B, x + 6 + dx, 0.6, gz, false); // bogies sur rail
          for (const hy of [5.5, 10]) for (const dz of [-1.6, 1.6]) this.box(6.6, 0.4, 0.4, B, x + 6, hy, gz + dz, false); // entretoises
          this.box(7.2, 1.1, 3.8, W, x + 6, 14, gz, false); // poutre de portique
          this.box(30, 0.9, 1.3, W, x + 14, 15.2, gz, false); // flèche au-dessus des navires
          this.box(30, 0.2, 1.4, B, x + 14, 15.75, gz, false);
          this.box(5, 2, 3, 0xdfe4ea, x + 2.5, 16.6, gz, false); // salle des machines (contre-flèche)
          this.box(5.1, 0.35, 3.1, B, x + 2.5, 17.7, gz, false);
          for (const dz of [-1, 1]) {
            const leg = this.box(0.35, 7, 0.35, W, x + 5.2, 19.2, gz + dz, false); // pylône en A
            leg.rotation.x = dz * 0.08;
          }
          this.box(0.4, 0.4, 2.4, W, x + 5.2, 22.6, gz, false);
          for (const [sx, sl] of [[x + 13, 18], [x + 22, 22]] as const) {
            // Haubans du pylône vers la flèche
            const stay = this.box(0.1, 0.1, sl * 0.62, 0x9aa3ad, (x + 5.2 + sx) / 2, 19.2, gz, false);
            stay.rotation.y = Math.PI / 2;
            stay.rotation.z = Math.atan2(22.6 - 15.6, sx - (x + 5.2));
            stay.scale.z = Math.hypot(sx - (x + 5.2), 22.6 - 15.6) / (sl * 0.62);
          }
          this.box(1.6, 1.3, 1.6, 0x2b2f36, x + 10, 14.1, gz, false); // cabine vitrée
          for (const lx of [x + 5.2, x + 28.5]) {
            const lamp = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.45, 0.45, 0.45)), craneLamp);
            lamp.position.set(lx, lx === x + 5.2 ? 23 : 16, gz);
            this.scene.add(lamp);
          }
          const trolley = this.box(1.8, 0.7, 1.6, 0x3a3f47, x + 6, 14.5, gz, false);
          const cable = this.box(0.12, 1, 0.12, 0x222222, x + 6, 10, gz, false);
          const spreader = this.box(2.6, 0.3, 1.2, 0xffce00, x + 6, 6, gz, false);
          const load = this.box(2.3, 1.1, 2.4, 0xe5383b, x + 6, 5.3, gz, false);
          load.visible = false;
          this.cranes.push({ trolley, cable, spreader, load, quayX: x + 5, shipX: x + 15, gz, offset: this.cranes.length * 3 });
        }
        // Portiques de parc RTG jaunes et verts, visibles derrière les piles de conteneurs.
        for (let i = 0; i < 3; i++) {
          const gz = z + 6 + i * 6.2;
          for (const dx of [-7, 7]) this.box(0.45, 8.5, 0.45, 0xe0ad16, x - 3 + dx, 4.25, gz, false);
          this.box(14.5, 0.65, 0.65, 0xe0ad16, x - 3, 8.4, gz, false);
          this.box(2.3, 0.85, 1.1, 0x2d7d55, x - 3, 7.6, gz, false);
        }
        // Mâts d'éclairage du terminal : couronnes de projecteurs qui s'allument à la nuit tombée
        const flood = new THREE.MeshLambertMaterial({ color: 0xbfc5cc, emissive: 0xfff1c9, emissiveIntensity: 0 });
        this.nightMaterials.push(flood);
        this.nightScale.set(flood, 1.8);
        for (const [mx, mz] of [[x - 26, z + 12.5], [x + 9.5, z + 17], [x + 9.5, z + 43], [x - 6, z + 40]] as const) {
          this.box(0.35, 18, 0.35, 0xc9ced4, mx, 9, mz, false);
          this.box(2.2, 0.3, 2.2, 0x6b7280, mx, 18.1, mz, false);
          const head = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.8, 0.5, 1.8)), flood);
          head.position.set(mx, 17.7, mz);
          this.scene.add(head);
        }
        // Terre-plein du quai : rangées de conteneurs empilés (1 à 3 niveaux) entre les portiques et la plage
        const qr = rng(1960);
        for (const qx of [x - 4.5, x - 1.8]) {
          for (let k = 0; k < 4; k++) {
            const levels = 1 + Math.floor(qr() * 3);
            for (let l = 0; l < levels; l++) this.box(2.3, 2.4, 5.8, cols[Math.floor(qr() * cols.length)]!, qx, 1.65 + l * 2.42, z + 19 + k * 6.3, false);
          }
        }
        // Tracteurs portuaires : prennent le conteneur au pied du portique et l'emmènent au parc, puis reviennent
        for (const [i, gz] of [z + 22, z + 34].entries()) {
          const g = new THREE.Group();
          const add = (w: number, h: number, d: number, c: number, px: number, py: number, pz: number) => {
            const m = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, h, d)), this.mats.color(c));
            m.position.set(px, py, pz);
            m.castShadow = this.profile.shadows;
            g.add(m);
            return m;
          };
          add(1.9, 1.5, 1.6, 0xffce00, 0, 1.25, 2.6); // cabine
          add(0.4, 0.8, 0.4, 0x222222, 0.6, 2.2, 2.2); // échappement
          add(2.1, 0.35, 7.2, 0x3a3f47, 0, 0.75, -0.6); // remorque
          for (const [wx, wz] of [[-0.95, 2.6], [0.95, 2.6], [-0.95, -2.8], [0.95, -2.8], [-0.95, -1.6], [0.95, -1.6]] as const) {
            const w = add(0.35, 0.9, 0.9, 0x161616, wx, 0.45, wz);
            w.rotation.z = Math.PI / 2;
          }
          const load = add(2.3, 2.4, 5.8, cols[(i + 1) % cols.length]!, 0, 2.15, -0.6);
          this.scene.add(g);
          this.tractors.push({ g, load, gz, quayX: x + 5, yardX: x - 10, yardZ: z + 9, t: i * 9 });
        }
        // Porte-conteneurs qui fait la rotation : arrivée du large, accostage, déchargement puis chargement
        // des conteneurs par les portiques, départ. Pile du quai qui grossit et diminue en conséquence.
        const ship1 = this.buildShip(0x16181c, 30, true, 'MSC');
        this.scene.add(ship1);
        const yard: THREE.Mesh[] = [];
        for (let i = 0; i < 12; i++) {
          const c = this.box(5.8, 2.4, 2.3, cols[(i + 2) % cols.length]!, x - 14 + (i % 4) * 6.4, 1.2 + 4.8, z + 1 + (Math.floor(i / 4) % 3) * 2.6, false);
          c.visible = false;
          yard.push(c);
        }
        this.berth = { g: ship1, x: x + 15, zBerth: z + 30, zFar: z + 240, t: 20, stack: ship1.userData.stack as THREE.Object3D[], yard };
        const ship2 = this.buildShip(0x7a1f1f, 24);
        ship2.position.set(x - 12, 0, z + 32);
        this.scene.add(ship2);
        const tug = this.buildShip(0xe5383b, 7, false);
        tug.position.set(x + 4, 0, z + 52);
        tug.rotation.y = 0.6;
        this.scene.add(tug);
        // Cargo qui entre au port puis repart vers le large
        const cargo = this.buildShip(0x1d2a44, 34, true, 'CMA CGM');
        this.scene.add(cargo);
        this.ships.push({ g: cargo, x: x + 30, zNear: z + 60, zFar: z + 220, t: 0 });
        break;
      }
      case 'monument': {
        // Place de l'Indépendance (plan OpenStreetMap) : rue en anneau autour d'un îlot fleuri,
        // bassin au sud du monument, tour de béton blanc évidée abritant la statue de l'homme libéré.
        const ringRoad = new THREE.Mesh(this.geo(new THREE.RingGeometry(11.5, 15, 48)), this.mats.color(C.road));
        ringRoad.rotation.x = -Math.PI / 2;
        ringRoad.position.set(x, 0.03, z);
        const lawn = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(11.5, 11.5, 0.2, 48)), this.mats.color(0x74b45a));
        lawn.position.set(x, 0.1, z);
        lawn.receiveShadow = this.profile.shadows;
        const kerb = new THREE.Mesh(this.geo(new THREE.TorusGeometry(11.5, 0.25, 6, 48)), this.mats.color(0xe5383b));
        kerb.rotation.x = -Math.PI / 2;
        kerb.position.set(x, 0.22, z);
        this.scene.add(ringRoad, lawn, kerb);
        // Composition réelle (photo aérienne) : esplanade dallée centrale, quatre allées dallées (nord, est, ouest et sud-ouest),
        // deux pelouses à l'ouest et deux grands bassins en secteur à l'est, chacun avec son plan d'eau bleu.
        const paved = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(6.2, 6.2, 0.16, 40)), this.mats.color(0xe9e0cf));
        paved.position.set(x, 0.24, z);
        this.scene.add(paved);
        // Quatre allées comme sur la photo aérienne : à 3 h (est), 9 h (ouest), et à 11 h et 7 h à l'ouest, de part et d'autre de l'allée ouest ;
        // les deux grands bassins occupent les secteurs nord-est et sud-est
        // Tout le lieu est tourné de `yaw` : la composition est dessinée avec la photo (est = tapis rouge, face au palais des Congrès),
        // on retranche donc cet angle pour que, dans la ville, l'allée « est » regarde bien vers le palais.
        const PY = venueYaw('monument');
        for (const a0 of [Math.PI / 2, 3.665, (3 * Math.PI) / 2, 5.76]) {
          const a = a0 - PY;
          const path = this.box(3.4, 0.055, 4.8, 0xe5dfd2, x + Math.sin(a) * 8.6, 0.25, z + Math.cos(a) * 8.6, false);
          path.rotation.y = a;
          // Dallage en damier clair et gris, haies jaunes basses de chaque côté de l'allée
          const tiles = this.instanced(new THREE.BoxGeometry(0.9, 0.03, 0.9), this.mats.color(0xc9c5bb), 28, false);
          let tk = 0;
          for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
            if ((r + c) % 2) continue;
            const along = 6.5 + r * 0.92;
            const across = (c - 1) * 0.95;
            if (tk < 28) this.setInstance(tiles, tk++, x + Math.sin(a) * along + Math.cos(a) * across, 0.29, z + Math.cos(a) * along - Math.sin(a) * across, 1, 1, 1, a);
          }
          for (const side of [-2, 2]) {
            const hedge = this.box(0.32, 0.38, 4.8, 0xb9c43a, x + Math.sin(a) * 8.6 + Math.cos(a) * side, 0.4, z + Math.cos(a) * 8.6 - Math.sin(a) * side, false);
            hedge.rotation.y = a;
          }
          // alignement de petits buis ronds de chaque côté de l'allée
          for (let k = 0; k < 3; k++) for (const side of [-2.1, 2.1]) {
            const t = 7 + k * 1.5;
            const bush = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.34, 7, 5)), this.mats.color(0x3f8f4a));
            bush.position.set(x + Math.sin(a) * t + Math.cos(a) * side, 0.5, z + Math.cos(a) * t - Math.sin(a) * side);
            this.scene.add(bush);
          }
        }
        for (const a0 of [(3 * Math.PI) / 4, Math.PI / 4]) {
          const a = a0 - PY;
          // Secteur d'anneau (vu du ciel : éventail comme sur la photo), centré sur la direction `a`
          const wedge = (r0: number, r1: number, half: number, y: number, color: number) => {
            const N = 10;
            const pos: number[] = [];
            const idx: number[] = [];
            for (let i = 0; i <= N; i++) {
              const ang = a - half + (2 * half * i) / N;
              pos.push(x + Math.sin(ang) * r0, y, z + Math.cos(ang) * r0, x + Math.sin(ang) * r1, y, z + Math.cos(ang) * r1);
              if (i > 0) {
                const k = i * 2;
                idx.push(k - 2, k - 1, k + 1, k - 2, k + 1, k);
              }
            }
            const g = new THREE.BufferGeometry();
            g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
            g.setIndex(idx);
            g.computeVertexNormals();
            const m = new THREE.Mesh(this.geo(g), this.mats.color(color));
            (m.material as THREE.Material).side = THREE.DoubleSide;
            this.scene.add(m);
          };
          wedge(3.7, 9.6, 0.66, 0.3, 0xe7efe9); // rebord clair
          wedge(4.0, 9.2, 0.6, 0.32, 0x3f8a52); // fond vert
          wedge(5.0, 7.6, 0.34, 0.34, 0x5fb4e6); // plan d'eau bleu
        }
        // Petits obélisques de pierre sur les pelouses, et deux ronds de buis taillés (décor de la photo aérienne)
        for (const [ox, oz] of [[-6.2, -3.6], [-5.2, 3.8]] as const) {
          const ob = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.45, 1.3, 4)), this.mats.color(0xe4e0d6));
          const [rox, roz] = rotateXZ(ox, oz, -PY);
          ob.position.set(x + rox, 0.85, z + roz);
          this.scene.add(ob);
        }
        for (const [ox, oz] of [[-6.6, 1.2], [-3.3, 6.6]] as const) {
          const ring = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.75, 0.2, 6, 16)), this.mats.color(0x2f7a3a));
          ring.rotation.x = -Math.PI / 2;
          const [rox, roz] = rotateXZ(ox, oz, -PY);
          ring.position.set(x + rox, 0.32, z + roz);
          this.scene.add(ring);
        }
        const monBefore = this.scene.children.length;
        const monSolids = this.solids.length;
        // ─── Monument de l'Indépendance, d'après la planche de référence ───────────────────────────────────────────────
        // Grande paroi centrale courbe à sommet en arche, percée d'une ouverture en forme de silhouette (femme aux bras levés
        // portant un disque, intérieur de la découpe en ton bronze) ; deux grands panneaux verticaux ajourés (perforations
        // circulaires) ouverts en ailes vers l'avant, sommet incliné, plus hauts à l'extérieur ; deux lames minces et hautes
        // contre la paroi ; devant, statue de pierre blanche sur piédestal, socle de pierre à porte en retrait, deux volées de
        // marches à tapis rouge ; îlot carré de pelouse bordé de haie ; au dos, l'inscription et la porte en bas-relief.
        const mon = new THREE.Group();
        mon.position.set(x, 0, z);
        this.scene.add(mon);
        const stone = new THREE.MeshLambertMaterial({ color: 0xb9a68c, emissive: 0xffe2b0, emissiveIntensity: 0 });
        const stone2 = new THREE.MeshLambertMaterial({ color: 0xa8957b, emissive: 0xffe2b0, emissiveIntensity: 0 });
        this.nightMaterials.push(stone, stone2);
        this.nightScale.set(stone, 0.3);
        this.nightScale.set(stone2, 0.3);
        const lattice = this.mats.color(0x1d2538);
        const whiteDot = this.mats.color(0xf4f1ea);
        const marble = this.mats.color(0xf1efe9);
        const mbox = (w: number, h: number, d: number, col: number | THREE.Material, px: number, py: number, pz: number, ry = 0): THREE.Mesh => {
          const b = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, h, d)), typeof col === 'number' ? this.mats.color(col) : col);
          b.position.set(px, py, pz);
          b.rotation.y = ry;
          b.castShadow = this.profile.shadows;
          mon.add(b);
          return b;
        };
        // Carré de pelouse sous le monument, au milieu de l'esplanade dallée (comme sur la photo aérienne)
        mbox(13, 0.12, 15, 0x5aa04a, 0, 0.3, -2.2);
        mbox(13.6, 0.1, 15.6, 0xc9bfa8, 0, 0.27, -2.2);
        // Îlot carré de pelouse, bordé d'une haie basse, et marge dallée
        mbox(21, 0.3, 19, 0x2f7a3a, 0, 0.15, 0.4);
        mbox(19.8, 0.34, 17.8, 0x6fb25a, 0, 0.17, 0.4);
        // Paroi centrale courbe (concave vers l'avant) : colonnes de petits blocs, découpe en silhouette
        const RC = 8;
        const ZC = RC - 2.4; // sommet de l'arc en z = -2,4
        const HALF = 4.9; // la paroi centrale est la traverse du « H » : droite, entre les deux montants
        const topOf = (u: number) => 12.4 + 3.6 * Math.sqrt(Math.max(0, 1 - (u / (HALF + 0.3)) ** 2));
        /** Vrai si le point (u, y) de la paroi est dans la découpe en forme de silhouette. */
        const hole = (u: number, y: number): boolean => {
          const au = Math.abs(u);
          if (y < 7) return au < 1.0 + (7 - y) * 0.2; // jupe évasée vers le bas
          if (y < 9.6) return au < 1.0 + (y - 7) * 0.1; // taille puis épaules
          // bras levés : anneau elliptique autour de (0, 12) ; l'espace entre les bras reste ouvert
          const ex = au / 2.5;
          const ey = (y - 12) / 2.7;
          const r = Math.hypot(ex, ey);
          return (r < 1 && r > 0.38) || (au < 0.55 && y < 11.4);
        };
        const cell = 0.5;
        const mats4: THREE.Matrix4[] = [];
        const cols: THREE.Color[] = [];
        const tmpQ = new THREE.Quaternion();
        const cNear = new THREE.Color(0xa7743f);
        const cStone = new THREE.Color(0xffffff);
        for (let u = -HALF + cell / 2; u < HALF; u += cell) {
          const phi = 0;
          const pz = ZC - RC;
          tmpQ.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -phi);
          for (let y = 0.35 + cell / 2; y < topOf(u); y += cell) {
            if (hole(u, y)) continue;
            mats4.push(new THREE.Matrix4().compose(new THREE.Vector3(u, y, pz), tmpQ, new THREE.Vector3(cell * 1.06, cell * 1.06, 1.0)));
            // Bords de la découpe : ton bronze, comme l'intérieur des découpes sur la planche
            const edge = hole(u - cell, y) || hole(u + cell, y) || hole(u, y - cell) || hole(u, y + cell);
            cols.push(edge ? cNear : cStone);
          }
        }
        const wallCells = new THREE.InstancedMesh(this.geo(new THREE.BoxGeometry(1, 1, 1)), new THREE.MeshLambertMaterial({ color: 0xffffff }), mats4.length);
        // Même teinte et même lueur de nuit que la pierre : matériau dédié, couleur par instance
        const cellMat = wallCells.material as THREE.MeshLambertMaterial;
        cellMat.color.set(0xb9a68c);
        cellMat.emissive.set(0xffe2b0);
        this.nightMaterials.push(cellMat);
        this.nightScale.set(cellMat, 0.3);
        mats4.forEach((m4, i) => {
          wallCells.setMatrixAt(i, m4);
          wallCells.setColorAt(i, cols[i]!);
        });
        wallCells.instanceMatrix.needsUpdate = true;
        if (wallCells.instanceColor) wallCells.instanceColor.needsUpdate = true;
        wallCells.castShadow = this.profile.shadows;
        mon.add(wallCells);
        this.solid(x, z - 2.2, 2 * HALF, 1.6, 16);
        // Panneaux ajourés en ailes : plus hauts à l'extérieur, perforations circulaires dans des niches sombres
        /**
         * Aile ajourée (les quatre sont semblables) : `ang` > 0 ouvre l'aile vers l'avant (ailes avant), < 0 vers l'arrière (ailes
         * arrière, visibles derrière les premières) ; plus haute à l'extérieur, niches sombres à pastilles blanches.
         */
        const wing = (side: -1 | 1, hx: number, hz: number, ang: number, W: number, hIn: number, hOut: number, nCols: number) => {
          const g = new THREE.Group();
          g.position.set(side * hx, 0, hz);
          g.rotation.y = -side * ang;
          const shape = new THREE.Shape();
          const x0 = side < 0 ? -W : 0;
          const x1 = side < 0 ? 0 : W;
          shape.moveTo(x0, 0.35);
          shape.lineTo(x1, 0.35);
          shape.lineTo(x1, side < 0 ? hIn : hOut);
          shape.lineTo(x0, side < 0 ? hOut : hIn);
          shape.closePath();
          const body = new THREE.Mesh(this.geo(new THREE.ExtrudeGeometry(shape, { depth: 1.1, bevelEnabled: false })), stone);
          body.castShadow = this.profile.shadows;
          g.add(body);
          const nRows = 9;
          const cw = (W - 1.0) / nCols;
          // Le décor est posé sur les DEUX faces de l'aile (z = 1.1 et z = 0) : de l'extérieur, on voit le même ajourage que de l'intérieur.
          const slots = new THREE.InstancedMesh(this.geo(new THREE.BoxGeometry(cw * 0.58, 2.0, 0.08)), lattice, nCols * nRows * 2);
          const dots = new THREE.InstancedMesh(this.geo(new THREE.CylinderGeometry(0.17, 0.17, 0.05, 10).rotateX(Math.PI / 2)), whiteDot, nCols * nRows * 4);
          let sk = 0;
          let dk = 0;
          const dummy = new THREE.Matrix4();
          for (const [slotZ, dotZ] of [[1.14, 1.18], [-0.04, -0.08]] as const) {
            for (let c = 0; c < nCols; c++) for (let r = 0; r < nRows; r++) {
              const dist = 0.5 + cw * (c + 0.5);
              const wy = 2.2 + r * 2.35;
              const topAt = hIn + ((hOut - hIn) * dist) / W;
              const show = wy + 1.1 < topAt - 0.4;
              slots.setMatrixAt(sk++, dummy.makeTranslation(side * dist, show ? wy : -30, slotZ));
              for (const oy of [-0.5, 0.5]) dots.setMatrixAt(dk++, dummy.makeTranslation(side * dist, show ? wy + oy : -30, dotZ));
            }
          }
          g.add(slots, dots);
          // Nervures verticales entre les colonnes de niches, sur chaque face
          for (let c = 0; c <= nCols; c++) {
            const rx = side * (0.18 + cw * c + (c === nCols ? 0.5 : 0));
            const top = hIn + ((hOut - hIn) * Math.abs(rx)) / W - 0.5;
            for (const ribZ of [1.18, -0.08]) {
              const rib = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.16, top - 0.4, 0.16)), stone2);
              rib.position.set(rx, 0.4 + (top - 0.4) / 2, ribZ);
              g.add(rib);
            }
          }
          mon.add(g);
          // Emprise : le rectangle englobant de l'aile (qui peut partir en diagonale ou le long de z)
          this.solid(x + side * (hx + (Math.cos(ang) * W) / 2), z + hz + (Math.sin(ang) * W) / 2, Math.abs(Math.cos(ang)) * W * 0.8 + 1.2, Math.abs(Math.sin(ang)) * W * 0.8 + 1.2, Math.max(hIn, hOut));
        };
        // Deux ailes avant (ouvertes vers l'avant) et deux ailes arrière (ouvertes vers l'arrière), toutes du même modèle
        // Plan en « H » vu du dessus : deux montants droits (de part et d'autre de la traverse centrale) dont chaque bout
        // s'évase en diagonale vers un coin ; les quatre ailes sont semblables, plus hautes à l'extérieur
        const Z0 = ZC - RC; // axe de la traverse
        for (const side of [-1, 1] as const) {
          wing(side, 5.2, Z0, Math.PI / 2, 3.2, 17.5, 17.5, 1); // montant, côté avant
          wing(side, 5.2, Z0, -Math.PI / 2, 4.7, 17.5, 17.5, 2); // montant, côté arrière
          wing(side, 5.2, Z0 + 3.2, Math.PI / 4, 6.8, 17.5, 24, 3); // aile avant
          wing(side, 5.2, Z0 - 4.7, -0.83, 7.15, 17.5, 24, 3); // aile arrière
        }
        // Socle de pierre : massif gris en pierres sèches, à porte en retrait au centre, dessus clair
        const cobble = this.mats.color(0x8e9094);
        mbox(8.4, 1.5, 5.6, cobble, 0, 0.9, 3.2);
        mbox(8.6, 0.16, 5.8, 0xe6e2d8, 0, 1.72, 3.2);
        mbox(1.6, 1.1, 0.3, 0x2a2a30, 0, 0.75, 6.12); // porte en retrait
        mbox(2.0, 0.12, 0.5, 0xe6e2d8, 0, 0.2, 6.3);
        // Deux volées de marches à tapis rouge, bordées de joues blanches
        for (const sx of [-1, 1]) {
          for (let k = 0; k < 7; k++) {
            const sy = 0.2 + k * 0.23;
            const sz = 7.5 - k * 0.52;
            mbox(2.6, 0.22, 0.6, 0xe9e4d8, sx * 6.2, sy, sz);
            mbox(1.6, 0.025, 0.62, 0xc4121d, sx * 6.2, sy + 0.12, sz);
          }
          mbox(0.28, 1.4, 4.3, 0xe9e4d8, sx * 7.6, 0.8, 5.4);
          mbox(0.28, 1.4, 4.3, 0xe9e4d8, sx * 4.8, 0.8, 5.4);
        }
        // Statue : femme de pierre blanche aux bras levés portant un disque, sur un piédestal en deux vases
        mbox(2.0, 0.5, 2.0, 0xf1efe9, 0, 2.05, 2.8);
        const vase = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.55, 0.9, 1.1, 14)), marble);
        vase.position.set(0, 2.85, 2.8);
        const vase2 = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.85, 0.5, 0.7, 14)), marble);
        vase2.position.set(0, 3.7, 2.8);
        const skirt = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.35, 0.78, 2.3, 14)), marble);
        skirt.position.set(0, 5.2, 2.8);
        const torso = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.34, 0.3, 1.1, 12)), marble);
        torso.position.set(0, 6.9, 2.8);
        const head = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.26, 12, 10)), marble);
        head.position.set(0, 7.75, 2.8);
        mon.add(vase, vase2, skirt, torso, head);
        for (const sx of [-1, 1]) {
          const arm = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.1, 0.12, 1.9, 8)), marble);
          arm.position.set(sx * 0.62, 8.4, 2.8);
          arm.rotation.z = -sx * 0.32;
          mon.add(arm);
        }
        const disc = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.55, 0.55, 0.07, 16)), marble);
        disc.position.set(0, 9.45, 2.8);
        disc.rotation.x = Math.PI / 2;
        mon.add(disc);
        const starMat = new THREE.MeshLambertMaterial({ color: 0xe6b43a, emissive: 0xffd24a, emissiveIntensity: 0 });
        this.nightMaterials.push(starMat);
        this.nightScale.set(starMat, 1.2);
        const star = new THREE.Mesh(this.geo(new THREE.OctahedronGeometry(0.3)), starMat);
        star.position.set(0, 9.95, 2.8);
        mon.add(star);
        // Dos de la paroi : inscription gravée et porte en bas-relief
        {
          const cv = document.createElement('canvas');
          cv.width = 512;
          cv.height = 768;
          const g2 = cv.getContext('2d');
          if (g2) {
            g2.fillStyle = '#b9a68c';
            g2.fillRect(0, 0, 512, 768);
            g2.fillStyle = '#5a4a38';
            g2.textAlign = 'center';
            g2.textBaseline = 'middle';
            const lines: [string, number, number][] = [['PROCLAMATION', 48, 70], ['DE', 40, 130], ['L’INDÉPENDANCE', 48, 190], ['DU TOGO', 52, 255], ['27 AVRIL 1960', 46, 340], ['TRAVAIL', 50, 470], ['LIBERTÉ', 50, 540], ['PATRIE', 50, 610]];
            for (const [t, size, y] of lines) {
              g2.font = `700 ${size}px serif`;
              g2.fillText(t, 256, y, 470);
            }
          }
          const tex = new THREE.CanvasTexture(cv);
          tex.colorSpace = THREE.SRGBColorSpace;
          this.mats.textures.push(tex);
          const plate = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(4.6, 6.9)), new THREE.MeshLambertMaterial({ map: tex }));
          plate.position.set(0, 9.3, ZC - RC - 0.58);
          plate.rotation.y = Math.PI;
          mon.add(plate);
          const door = mbox(4.6, 3.4, 0.14, 0x6b5a45, 0, 2.1, ZC - RC - 0.5);
          door.scale.set(1, 1, 1);
          const emblem = mbox(1.3, 1.3, 0.1, 0x8a775a, 0, 2.2, ZC - RC - 0.6, 0);
          emblem.rotation.z = Math.PI / 4;
        }
        // Spots de pelouse (petites lampes au sol) de part et d'autre du socle
        for (const sx of [-1, 1]) mbox(0.3, 0.3, 0.3, 0x2a2a30, sx * 9.2, 0.45, 7.4);
        // Le monument réel est immense : à l'échelle de cette place (anneau de 10 m), on le réduit autour de son centre
        const MON = 0.4; // plus compact : sur la photo, le monument est petit au milieu de l'esplanade ronde
        const monGroup = new THREE.Group();
        monGroup.matrixAutoUpdate = false;
        monGroup.matrix.makeTranslation(x, 0, z + 2.2 * MON).multiply(new THREE.Matrix4().makeScale(MON, MON, MON)).multiply(new THREE.Matrix4().makeTranslation(-x, 0, -z));
        for (const o of this.scene.children.slice(monBefore)) monGroup.add(o);
        this.scene.add(monGroup);
        this.mergeParents.push(monGroup);
        for (const sol of this.solids.slice(monSolids)) {
          sol.x0 = x + (sol.x0 - x) * MON;
          sol.x1 = x + (sol.x1 - x) * MON;
          sol.z0 = z + 2.2 * MON + (sol.z0 - z) * MON;
          sol.z1 = z + 2.2 * MON + (sol.z1 - z) * MON;
        }
        this.solidGrid = null;
        // Palmiers et massifs bas répartis symétriquement, comme sur la place officielle.
        // Décor lumineux de nuit (éteint pendant une coupure) : monument éclairé par des projecteurs et des rubans aux couleurs du
        // Togo, couronne de plots lumineux vert, jaune et rouge autour de la pelouse, bassins qui brillent, guirlande dans les palmiers
        // `base` est la couleur de jour (lumière éteinte) : elle reprend celle du support pour qu'aucune tache sombre ne se voie de jour.
        const lit = (emissive: number, scale = 1, base = 0x2a2a2a) => {
          const m = new THREE.MeshLambertMaterial({ color: base, emissive, emissiveIntensity: 0 });
          this.nightMaterials.push(m);
          this.nightScale.set(m, scale);
          return m;
        };
        /** Matériau clignotant : l'éclat monte et descend en continu, chaque phase décalée des autres. */
        const blink = (emissive: number, phase: number, speed: number, base = 0x2a2a2a) => {
          const m = new THREE.MeshLambertMaterial({ color: base, emissive, emissiveIntensity: 0 });
          this.blinkMats.push({ m, scale: 1, phase, speed });
          return m;
        };
        const dotColors = [0x00c060, 0xffd21a, 0xff2d3a];
        const dotMats = dotColors.map((c) => [0, 1, 2].map((ph) => blink(c, (ph * Math.PI * 2) / 3, 2.4, c)));
        const gWhite = lit(0xfff2c0, 1.1, 0xe9e0cf); // pierre claire de l'esplanade
        const gBlue = lit(0x39a8ff, 0.7, 0x5fb4e6); // bleu du plan d'eau
        // Projecteurs au sol, dirigés vers le monument (socle et statue éclairés)
        for (let k = 0; k < 8; k++) {
          const a = (k * Math.PI) / 4 + Math.PI / 8;
          const spot = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.5, 0.3, 0.5)), gWhite);
          spot.position.set(x + Math.cos(a) * 6.2, 0.4, z + Math.sin(a) * 6.2);
          this.scene.add(spot);
        }
        const halo = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.9, 0.9, 0.15, 12)), gWhite);
        halo.position.set(x, 1.6, z + 2.2 * MON + 2.8 * MON);
        this.scene.add(halo);
        // Couronne de plots lumineux autour de la pelouse, alternant les trois couleurs
        for (let k = 0; k < 36; k++) {
          const a = (k / 36) * Math.PI * 2;
          const dot = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.28, 0.28, 0.2, 8)), dotMats[k % 3]![Math.floor(k / 3) % 3]!);
          dot.position.set(x + Math.cos(a) * 12.05, 0.34, z + Math.sin(a) * 12.05);
          this.scene.add(dot);
        }
        // Bassins : une lueur bleue (le dessus des bassins reprend ce matériau)
        for (const a0 of [(3 * Math.PI) / 4, Math.PI / 4]) {
          const a = a0 - PY;
          const glow = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(1.5, 1.5, 0.12, 14)), gBlue);
          glow.position.set(x + Math.sin(a) * 6.2, 0.38, z + Math.cos(a) * 6.2);
          this.scene.add(glow);
        }
        if (this.profile.pointLights > 0) {
          const pl = new THREE.PointLight(0xffe0a0, 0, 40, 2);
          pl.position.set(x, 5, z + 6);
          this.pointLights.push(pl);
          this.scene.add(pl);
        }
        break;
      }
      case 'hotel_2fevrier': {
        // Tour réelle (photos de nuit) : lame de verre bleu nuit aux fenêtres éclairées, colonne de pierre claire à une extrémité
        // portant la bande lumineuse bleue (barres horizontales) et l'inscription verticale « HÔTEL 2 FÉVRIER », podium à panneaux
        // beiges et jaune pâle, feux d'obstacle rouges au sommet.
        const H = 58;
        const top = 4 + H;
        // Podium (photos) : socle blanc sur deux niveaux, hautes lames verticales devant un vitrage sombre (lumière chaude la nuit),
        // corniche épaisse, toit-terrasse vert, arbres et bornes le long du trottoir
        const PH = 7;
        this.box(17.2, PH, 10.2, 0x26323d, x, PH / 2, z); // vitrage en retrait
        this.solid(x, z, 18, 11);
        const warm = new THREE.MeshLambertMaterial({ color: 0x3a4652, emissive: 0xffc47a, emissiveIntensity: 0 });
        this.nightMaterials.push(warm);
        this.nightScale.set(warm, 0.35);
        // Bandeau vitré éclairé du rez-de-chaussée et de l'étage (façade avant et côtés)
        for (const yy of [1.6, 4.9]) {
          const band = new THREE.Mesh(this.geo(new THREE.BoxGeometry(17.3, 2.2, 10.3)), warm);
          band.position.set(x, yy, z);
          this.scene.add(band);
        }
        // Lames verticales blanches tout autour (avant, arrière, côtés)
        const finGeoX = new THREE.BoxGeometry(0.34, PH - 0.4, 0.7);
        const finsX = this.instanced(finGeoX, this.mats.color(0xf2f1ec), 2 * 13, true);
        let fi = 0;
        for (const fz of [z + 5.35, z - 5.35]) for (let k = 0; k < 13; k++) this.setInstance(finsX, fi++, x - 8.4 + k * 1.4, (PH - 0.4) / 2, fz);
        const finsZ = this.instanced(new THREE.BoxGeometry(0.7, PH - 0.4, 0.34), this.mats.color(0xf2f1ec), 2 * 8, true);
        fi = 0;
        for (const fx of [x - 8.85, x + 8.85]) for (let k = 0; k < 8; k++) this.setInstance(finsZ, fi++, fx, (PH - 0.4) / 2, z - 4.9 + k * 1.4);
        // Corniche épaisse et acrotère, toit-terrasse végétalisé
        this.box(18.6, 0.7, 11.6, 0xf4f3ef, x, PH - 0.05, z);
        this.box(18.2, 0.08, 11.2, 0x7fa68a, x, PH + 0.34, z, false);
        this.box(18.6, 0.5, 0.2, 0xe6e4dc, x, PH + 0.55, z + 5.7, false);
        this.box(18.6, 0.5, 0.2, 0xe6e4dc, x, PH + 0.55, z - 5.7, false);
        // Bornes le long du trottoir et arbres devant la façade
        for (let k = 0; k < 8; k++) {
          if (Math.abs(-8 + k * 2.3) < 3.4) continue; // passage devant l'entrée
          this.box(0.22, 0.95, 0.22, 0xbfc3c7, x - 8 + k * 2.3, 0.48, z + 8.9, false);
        }
        for (const dx of [-7.5, 7.5]) this.tree(x + dx, z + 7.2);
        // Lame de verre : bleu nuit, montants fins et dalles d'étage discrètes
        this.box(14.4, H, 5.4, 0x1e3247, x, 4 + H / 2, z); // grandes faces entièrement vitrées
        const flats = this.instanced(new THREE.BoxGeometry(14.2, 0.08, 5.48), this.mats.color(0x34506a), 36, false);
        for (let k = 0; k < 36; k++) this.setInstance(flats, k, x, 5.6 + k * 1.55, z);
        const mullions = this.instanced(new THREE.BoxGeometry(0.06, H - 1, 5.5), this.mats.color(0x4d6a82), 14, false);
        for (let k = 0; k < 14; k++) this.setInstance(mullions, k, x - 6.955 + k * 1.07, 4 + H / 2, z);
        // Fenêtres éclairées la nuit, éparses comme sur les photos
        this.litGrid(x, z + 2.7, 1, 13, 34, 1.07, 6.4, 1.55, 0.7, 0.9, 0.5);
        this.litGrid(x, z - 2.7, -1, 13, 34, 1.07, 6.4, 1.55, 0.7, 0.9, 0.5);
        // Deux colonnes de pierre claire (plus hautes que la lame), une à chaque bout : l'une regarde la BCEAO, l'autre le Palais des
        // Congrès. Chacune porte sur sa face de bout la bande bleue centrée, « HÔTEL 2 FÉVRIER » à gauche, « Radisson » + BLU à droite.
        const cw = 1.2; // plaque de pierre mince : vue de côté, la tour reste vitrée d'un bout à l'autre
        const cd = 6.8;
        // Pierre éclairée par en dessous la nuit (lueur bleutée-mauve des photos)
        const stone = new THREE.MeshLambertMaterial({ color: 0xd9d3c7, emissive: 0x7d7ab8, emissiveIntensity: 0 });
        this.nightMaterials.push(stone);
        this.nightScale.set(stone, 0.22);
        const ends = [-1, 1] as const;
        for (const e of ends) {
          const core = new THREE.Mesh(this.geo(new THREE.BoxGeometry(cw, H + 2.5, cd)), stone);
          core.position.set(x + e * 7.8, 4 + (H + 2.5) / 2, z);
          core.castShadow = this.profile.shadows;
          core.receiveShadow = this.profile.shadows;
          this.scene.add(core);
          this.solid(x + e * 7.8, z, cw, cd);
        }
        // Bande lumineuse bleue : saignée sombre, tube vertical et barres horizontales (bleu le jour, lumineuses la nuit)
        const led = new THREE.MeshLambertMaterial({ color: 0x2338c8, emissive: 0x1530ff, emissiveIntensity: 0 });
        this.nightMaterials.push(led);
        this.nightScale.set(led, 0.95);
        // Bande centrée sur une face : (fx, fz) centre de la face, `nx`/`nz` sa normale sortante
        const ledFace = (fx: number, fz: number, nx: number, nz: number) => {
          const alongX = nz !== 0;
          const w = 1.3;
          // Du podium jusqu'au sommet de la colonne
          const y0 = 4.3;
          const y1 = 4 + H + 2.4;
          const len = y1 - y0;
          const recess = new THREE.Mesh(this.geo(new THREE.BoxGeometry(alongX ? w : 0.1, len, alongX ? 0.1 : w)), this.mats.color(0x1a2238));
          recess.position.set(fx + nx * 0.01, y0 + len / 2, fz + nz * 0.01);
          this.scene.add(recess);
          const tube = new THREE.Mesh(this.geo(new THREE.BoxGeometry(alongX ? 0.34 : 0.16, len, alongX ? 0.16 : 0.34)), led);
          tube.position.set(fx + nx * 0.05, y0 + len / 2, fz + nz * 0.05);
          this.scene.add(tube);
          const nBars = 25;
          const bars = this.instanced(new THREE.BoxGeometry(alongX ? 1.15 : 0.14, 0.2, alongX ? 0.14 : 1.15), led, nBars, false);
          for (let k = 0; k < nBars; k++) this.setInstance(bars, k, fx + nx * 0.07, y0 + 1.2 + (k * (len - 2.4)) / (nBars - 1), fz + nz * 0.07);
        };
        for (const e of ends) ledFace(x + e * (7.8 + cw / 2), z, e, 0); // les deux bouts de la tour
        // Inscriptions verticales lumineuses la nuit (lues de haut en bas) : texture de texte sur fond de pierre
        // Le jour : lettres foncées sur la pierre (photos de jour) ; la nuit : les mêmes lettres s'allument en blanc
        const textTex = (draw: (g: CanvasRenderingContext2D, ink: string, accent: string) => void, w: number, h: number) => {
          const paint = (bg: string, ink: string, accent: string) => {
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const g2 = canvas.getContext('2d')!;
            g2.fillStyle = bg;
            g2.fillRect(0, 0, w, h);
            draw(g2, ink, accent);
            const tex = new THREE.CanvasTexture(canvas);
            tex.colorSpace = THREE.SRGBColorSpace;
            tex.anisotropy = 4;
            return tex;
          };
          const m = new THREE.MeshLambertMaterial({ map: paint('#d9d3c7', '#3b3f4a', '#2b55e0'), emissive: 0xffffff, emissiveMap: paint('#000000', '#ffffff', '#4d6dff'), emissiveIntensity: 0 });
          this.nightMaterials.push(m);
          this.nightScale.set(m, 0.9);
          return m;
        };
        const hotelMat = textTex((g, ink) => {
          g.fillStyle = ink;
          g.font = '800 168px Ubuntu, Arial, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('HÔTEL 2 FÉVRIER', 1024, 118);
        }, 2048, 224);
        const brandMat = textTex((g, ink, accent) => {
          g.fillStyle = ink;
          this.scriptWord(g, 'Radisson', 800, 200, 330, ink);
          // Trait bleu sous le nom
          g.strokeStyle = accent;
          g.lineWidth = 30;
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(140, 352);
          g.quadraticCurveTo(800, 320, 1480, 342);
          g.stroke();
        }, 1600, 400);
        const bluMat = (() => {
          const canvas = document.createElement('canvas');
          canvas.width = 128;
          canvas.height = 128;
          const g = canvas.getContext('2d')!;
          g.fillStyle = '#2f5bea';
          g.fillRect(0, 0, 128, 128);
          g.fillStyle = '#ffffff';
          g.font = '700 46px Arial, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('BLU', 64, 66);
          const tex = new THREE.CanvasTexture(canvas);
          tex.colorSpace = THREE.SRGBColorSpace;
          const m = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0 });
          this.nightMaterials.push(m);
          this.nightScale.set(m, 0.7);
          return m;
        })();
        // Composition des photos sur le bout de chaque colonne (côté BCEAO et côté Palais des Congrès) :
        // « HÔTEL 2 FÉVRIER » à gauche de la bande bleue centrée, « Radisson » + carré BLU à droite (pour qui regarde la face)
        const compose = (fx: number, fz: number, nx: number, nz: number) => {
          const ry = Math.atan2(nx, nz);
          const lx = -nz; // vecteur « gauche » de l'observateur qui regarde la face
          const lz = nx;
          const ox = fx + nx * 0.03;
          const oz = fz + nz * 0.03;
          const hotel = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(13, 1.42)), hotelMat);
          hotel.position.set(ox + lx * 1.85, top - 4.2, oz + lz * 1.85);
          hotel.rotation.set(0, ry, -Math.PI / 2);
          this.scene.add(hotel);
          // « Radisson » en grand, tout en haut de la colonne, sur presque toute la moitié droite de la face
          const brand = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(10.8, 2.7)), brandMat);
          brand.position.set(ox - lx * 1.95, top - 3.1, oz - lz * 1.95); // haut du mot au ras du sommet de la pierre
          brand.rotation.set(0, ry, -Math.PI / 2);
          this.scene.add(brand);
          const blu = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(1.7, 1.7)), bluMat);
          blu.position.set(ox - lx * 1.95, top - 9.6, oz - lz * 1.95);
          blu.rotation.set(0, ry, 0);
          this.scene.add(blu);
        };
        for (const e of ends) compose(x + e * (7.8 + cw / 2), z, e, 0);
        // Couronnement technique, mât et feux d'obstacle rouges aux angles
        this.box(14.6, 1.4, 5.6, 0x2a3b4c, x, top + 0.7, z);
        this.box(0.25, 5, 0.25, 0xc8ccd2, x, top + 3.9, z, false);
        const red = new THREE.MeshBasicMaterial({ color: 0xff2a2a });
        for (const [ax, ay, az] of [[x - 8.4, top + 2.6, z + 3.3], [x - 8.4, top + 2.6, z - 3.3], [x + 8.4, top + 2.6, z + 3.3], [x + 8.4, top + 2.6, z - 3.3], [x, top + 6.5, z]] as const) {
          const b = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.22, 8, 6)), red);
          b.position.set(ax, ay, az);
          this.scene.add(b);
        }
        // Enseigne basse, entrée vitrée sous marquise, parvis jusqu'à la route, piscine sur le podium
        // Enseigne de l'entrée (photos) : lettres « Radisson » jaunes penchées posées sur la façade (pas de panneau), trait bleu
        // dessous, carré BLU bordé, « HÔTEL 2 FÉVRIER » en dessous ; lumineuse la nuit
        {
          const canvas = document.createElement('canvas');
          canvas.width = 1024;
          canvas.height = 240;
          const g = canvas.getContext('2d')!;
          g.clearRect(0, 0, 1024, 240);
          this.scriptWord(g, 'Radisson', 360, 110, 150, '#f4c51e', '#7a5a00');
          g.strokeStyle = '#f4c51e';
          g.lineWidth = 12;
          g.lineCap = 'round';
          g.beginPath();
          g.moveTo(70, 168);
          g.quadraticCurveTo(360, 150, 640, 160);
          g.stroke();
          g.fillStyle = '#2f5bea';
          g.fillRect(690, 22, 136, 136);
          g.strokeStyle = '#9fb6ff';
          g.lineWidth = 5;
          g.strokeRect(694, 26, 128, 128);
          g.fillStyle = '#ffffff';
          g.font = '700 46px Arial, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('BLU', 758, 92);
          g.fillStyle = '#e8c234';
          g.font = '700 44px Ubuntu, Arial, sans-serif';
          g.fillText('HÔTEL 2 FÉVRIER', 600, 208);
          const tex = new THREE.CanvasTexture(canvas);
          tex.colorSpace = THREE.SRGBColorSpace;
          const m = new THREE.MeshLambertMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0, transparent: true, alphaTest: 0.05 });
          this.nightMaterials.push(m);
          this.nightScale.set(m, 0.6);
          // Bandeau sombre derrière les lettres (façade), puis les lettres
          this.box(8.6, 1.7, 0.08, 0x2a2f36, x, PH - 0.05, z + 5.79, false);
          const sign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(8, 1.875)), m);
          sign.position.set(x, PH - 0.05, z + 5.86);
          this.scene.add(sign);
        }
        this.box(12, 0.05, 3.4, 0xd9d2c3, x, 0.125, z + 7.2, false);
        this.box(4.2, 2.3, 0.12, 0x9cc3dc, x, 1.15, z + 5.6, false);
        for (const dx of [-2.15, 0, 2.15]) this.box(0.14, 2.3, 0.18, 0x2b2f36, x + dx, 1.15, z + 5.62, false);
        this.box(6, 0.25, 2.4, 0x14213d, x, 2.45, z + 6.7, false);
        for (const dx of [-2.8, 2.8]) this.box(0.16, 2.35, 0.16, 0xc8ccd2, x + dx, 1.17, z + 7.75, false);
        this.box(5, 0.15, 3, 0x6ec3f0, x - 5.5, PH + 0.42, z + 3.4, false);
        break;
      }
      case 'bceao':
      case 'boad': {
        // La BCEAO est une tour beige verticale ; la BOAD est au contraire un ensemble brutaliste
        // bas, relié et coiffé de volumes arrondis inspirés des tatas du nord du Togo.
        const bce = v.id === 'bceao';
        if (!bce) {
          // BOAD (photos) : deux tours de pierre grise reliées par un corps vitré bronze qui plonge en « U », hérissé d'ailettes
          // verticales et couronné de dents de scie ; médaillon rond et motif de losanges sur la pierre ; arche devant le creux,
          // dôme doré à chevrons, rangée de drapeaux. Ensemble large et peu profond : il tient entre la rue et la concession voisine.
          const stoneC = 0xb8b4aa;
          const bronze = new THREE.MeshLambertMaterial({ color: 0x4a3626, emissive: 0xffc47a, emissiveIntensity: 0 });
          this.nightMaterials.push(bronze);
          this.nightScale.set(bronze, 0.05);
          const D = 6.5;
          const TH = 20; // plus large que haute, comme sur les photos
          this.box(29, 0.12, D + 1.5, 0xd9d4c8, x, 0.06, z, false);
          // Panneau du couronnement : croix rouge et blanche (sommet des travées vitrées, photos)
          const xMat = (() => {
            const c = document.createElement('canvas');
            c.width = 128;
            c.height = 96;
            const g = c.getContext('2d')!;
            g.fillStyle = '#efe9e2';
            g.fillRect(0, 0, 128, 96);
            g.strokeStyle = '#b3262e';
            g.lineWidth = 16;
            g.beginPath();
            g.moveTo(8, 8);
            g.lineTo(120, 88);
            g.moveTo(120, 8);
            g.lineTo(8, 88);
            g.stroke();
            g.strokeStyle = '#ffffff';
            g.lineWidth = 5;
            g.stroke();
            const tex = new THREE.CanvasTexture(c);
            tex.colorSpace = THREE.SRGBColorSpace;
            return new THREE.MeshLambertMaterial({ map: tex });
          })();
          const crown = (cx2: number, cy: number, w: number, d: number) => {
            const b = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, 0.95, d)), xMat);
            b.position.set(cx2, cy + 0.47, z);
            this.scene.add(b);
          };
          // Corps vitré en U : tranches dont le haut suit une parabole (bas au centre) ; au centre, il passe en pont au-dessus d'une
          // grande arche ouverte (on voit le ciel dessous). Derrière, les pentes du U sont habillées de rouge.
          const N = 17;
          const span = 15;
          const centerWins: [number, number, number][] = [];
          const archR = 5.4;
          const archH = 4.2;
          for (let k = 0; k < N; k++) {
            const t = (k + 0.5) / N - 0.5; // -0,5 … 0,5
            const sx = x + t * span;
            const dx = t * span;
            const hh = 6.8 + (TH - 1.5 - 6.8) * (2 * t) ** 2;
            const bottom = Math.abs(dx) < archR ? archH * Math.sqrt(1 - (dx / archR) ** 2) : 0;
            const sliceH = hh - bottom;
            const slice = new THREE.Mesh(this.geo(new THREE.BoxGeometry(span / N + 0.02, sliceH, D - 1)), bronze);
            slice.position.set(sx, bottom + sliceH / 2, z);
            this.scene.add(slice);
            // Ailette verticale claire devant chaque tranche, croix rouge et blanche au sommet
            this.box(0.14, sliceH, 0.3, 0xcfcac0, sx + span / N / 2, bottom + sliceH / 2, z + (D - 1) / 2 + 0.1, false);
            crown(sx, hh, span / N + 0.04, D - 0.9);
            // Fenêtres du corps central : une par étage et par travée, allumées la nuit (environ 2 sur 3), devant et derrière
            for (let fl = 0; bottom + 1.2 + fl * 2.2 < hh - 1; fl++) {
              if (((k * 7 + fl * 13) % 10) >= 7) continue;
              for (const f of [1, -1] as const) centerWins.push([sx, bottom + 1.2 + fl * 2.2, z + f * ((D - 1) / 2 + 0.06)]);
            }
            // Habillage rouge des pentes, côté arrière
            const slope = Math.abs(2 * t);
            if (slope > 0.3 && slope < 0.95) this.box(span / N + 0.02, sliceH * 0.55, 0.08, 0x9a2a2a, sx, hh - sliceH * 0.275, z - (D - 1) / 2 - 0.05, false);
          }
          {
            const winMat = new THREE.MeshLambertMaterial({ color: 0x3a2a1e, emissive: 0xffd08a, emissiveIntensity: 0 });
            this.nightMaterials.push(winMat);
            this.nightScale.set(winMat, 0.6);
            const wins = this.instanced(new THREE.BoxGeometry(span / N - 0.3, 1.1, 0.05), winMat, centerWins.length, false);
            centerWins.forEach(([wx, wy, wz], n) => this.setInstance(wins, n, wx, wy, wz));
          }
          // Obstacles : les deux pieds de l'arche (le passage dessous reste libre)
          for (const e of [-1, 1] as const) this.solid(x + e * (archR + (span / 2 - archR) / 2), z, span / 2 - archR, D - 1);
          // Les deux tours : moitié extérieure en pierre (médaillon, losanges), moitié intérieure vitrée bronze à ailettes
          const medal = (label: string) => {
            const c = document.createElement('canvas');
            c.width = 256;
            c.height = 256;
            const g = c.getContext('2d')!;
            g.fillStyle = '#b8b4aa';
            g.fillRect(0, 0, 256, 256);
            g.fillStyle = '#1f6f45';
            g.beginPath();
            g.arc(128, 128, 116, 0, Math.PI * 2);
            g.fill();
            g.strokeStyle = '#e9d27a';
            g.lineWidth = 10;
            g.beginPath();
            g.arc(128, 128, 98, 0, Math.PI * 2);
            g.stroke();
            g.fillStyle = '#ffffff';
            g.font = '800 64px Arial, sans-serif';
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.fillText(label, 128, 132);
            const tex = new THREE.CanvasTexture(c);
            tex.colorSpace = THREE.SRGBColorSpace;
            return new THREE.MeshLambertMaterial({ map: tex });
          };
          const medalMat = medal('BOAD');
          const diamonds = (() => {
            const c = document.createElement('canvas');
            c.width = 128;
            c.height = 256;
            const g = c.getContext('2d')!;
            g.fillStyle = '#b8b4aa';
            g.fillRect(0, 0, 128, 256);
            g.strokeStyle = '#f4f2ec';
            g.lineWidth = 9;
            for (const cy of [70, 128, 186]) {
              g.beginPath();
              g.moveTo(64, cy - 44);
              g.lineTo(108, cy);
              g.lineTo(64, cy + 44);
              g.lineTo(20, cy);
              g.closePath();
              g.stroke();
            }
            const tex = new THREE.CanvasTexture(c);
            tex.colorSpace = THREE.SRGBColorSpace;
            return new THREE.MeshLambertMaterial({ map: tex });
          })();
          for (const e of [-1, 1] as const) {
            const stoneX = x + e * 12;
            const glassX = x + e * 9;
            this.box(4.4, TH + 1, D, stoneC, stoneX, (TH + 1) / 2, z);
            this.box(0.25, 0.4, D + 0.3, 0x9e9a90, stoneX, TH + 1.2, z, false); // couronnement
            const glass = new THREE.Mesh(this.geo(new THREE.BoxGeometry(2.4, TH, D - 0.6)), bronze);
            glass.position.set(glassX, TH / 2, z);
            this.scene.add(glass);
            for (const fx of [-0.8, 0, 0.8]) this.box(0.14, TH, 0.3, 0xcfcac0, glassX + fx, TH / 2, z + (D - 0.6) / 2 + 0.1, false);
            crown(glassX, TH, 2.5, D - 0.5);
            this.solid(x + e * 11, z, 7, D);
            // Médaillon en haut et losanges à mi-hauteur, devant et derrière
            for (const f of [1, -1] as const) {
              const m = new THREE.Mesh(this.geo(new THREE.CircleGeometry(1.15, 28)), medalMat);
              m.position.set(stoneX, TH - 2.4, z + f * (D / 2 + 0.03));
              m.rotation.y = f === 1 ? 0 : Math.PI;
              this.scene.add(m);
              const d = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(1.5, 3)), diamonds);
              d.position.set(stoneX, TH * 0.5, z + f * (D / 2 + 0.03));
              d.rotation.y = f === 1 ? 0 : Math.PI;
              this.scene.add(d);
            }
            // Fenêtres éclairées la nuit dans le vitrage des tours
            this.litGrid(glassX, z + (D - 0.6) / 2 + 0.02, 1, 2, 7, 1.1, 2.5, 2.3, 0.7, 1.2, 0.3);
          }
          // Arche fine devant le creux du U
          // Bord de l'arche (devant et derrière), au ras du dessous du pont
          for (const f of [1, -1] as const) {
            const arch = new THREE.Mesh(this.geo(new THREE.TorusGeometry(archR, 0.2, 8, 40, Math.PI)), this.mats.color(0x8a7a66));
            arch.position.set(x, 0, z + f * ((D - 1) / 2 + 0.05));
            arch.scale.set(1, archH / archR, 1);
            this.scene.add(arch);
          }
          // Dôme doré à chevrons légèrement en avant du bâtiment (photos), sur un socle rond, dans son bassin
          const domeZ = D / 2 + 3.4;
          const base = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(2.6, 2.7, 0.8, 24)), this.mats.color(0xe9e5dc));
          base.position.set(x, 0.4, z + domeZ);
          this.scene.add(base);
          const domeC = document.createElement('canvas');
          domeC.width = 256;
          domeC.height = 128;
          const dg = domeC.getContext('2d')!;
          dg.fillStyle = '#d6a845';
          dg.fillRect(0, 0, 256, 128);
          dg.strokeStyle = '#8a5a1e';
          dg.lineWidth = 5;
          for (const yy of [40, 70, 98]) {
            dg.beginPath();
            for (let xx = 0; xx <= 256; xx += 16) dg.lineTo(xx, yy + ((xx / 16) % 2 ? -8 : 8));
            dg.stroke();
          }
          const domeTex = new THREE.CanvasTexture(domeC);
          domeTex.colorSpace = THREE.SRGBColorSpace;
          domeTex.wrapS = THREE.RepeatWrapping;
          domeTex.repeat.set(4, 1);
          const dome = new THREE.Mesh(this.geo(new THREE.SphereGeometry(2.6, 28, 12, 0, Math.PI * 2, 0, Math.PI / 2)), new THREE.MeshLambertMaterial({ map: domeTex }));
          dome.scale.y = 0.62;
          dome.position.set(x, 0.8, z + domeZ);
          this.scene.add(dome);
          // Bassin (photos) : eau claire à reflets, plus profonde au centre ; la nuit, éclairée par en dessous (projecteurs immergés)
          const waterTex = this.waterTexture('#1b7fc4', '#36a6e3', '#7fd3f2');
          const poolMat = new THREE.MeshLambertMaterial({ map: waterTex, emissive: 0x2fb6ff, emissiveMap: waterTex, emissiveIntensity: 0 });
          this.nightMaterials.push(poolMat);
          this.nightScale.set(poolMat, 0.55);
          const pool = new THREE.Mesh(this.geo(new THREE.CircleGeometry(4.6, 48)), poolMat);
          pool.rotation.x = -Math.PI / 2;
          pool.position.set(x, 0.1, z + domeZ);
          pool.onBeforeRender = () => {
            const t = performance.now() / 1000;
            waterTex.offset.set(Math.sin(t * 0.3) * 0.03, t * 0.015);
          };
          this.scene.add(pool);
          // Projecteurs immergés le long du bord (petits halos qui s'allument la nuit)
          const spotMat = new THREE.MeshLambertMaterial({ color: 0xbfefff, emissive: 0x9fe6ff, emissiveIntensity: 0 });
          this.nightMaterials.push(spotMat);
          this.nightScale.set(spotMat, 1.2);
          for (let k = 0; k < 12; k++) {
            const a2 = (k / 12) * Math.PI * 2;
            const sp = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.22, 10)), spotMat);
            sp.rotation.x = -Math.PI / 2;
            sp.position.set(x + Math.cos(a2) * 4.25, 0.11, z + domeZ + Math.sin(a2) * 4.25);
            this.scene.add(sp);
          }
          // Lampadaires de l'esplanade
          const lampMat = new THREE.MeshLambertMaterial({ color: 0xfff3c4, emissive: 0xffe2a0, emissiveIntensity: 0 });
          this.nightMaterials.push(lampMat);
          for (const e of [-1, 1] as const) {
            for (const lz of [domeZ - 3.2, domeZ + 3.2]) {
              this.box(0.1, 3, 0.1, 0x2b2f36, x + e * 5.4, 1.5, z + lz, false);
              const bulb = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.2, 10, 8)), lampMat);
              bulb.position.set(x + e * 5.4, 3.1, z + lz);
              this.scene.add(bulb);
            }
          }
          // Margelle large en pierre et rebord intérieur
          const rim = new THREE.Mesh(this.geo(new THREE.RingGeometry(4.6, 5.3, 48)), this.mats.color(0xeae4d6));
          rim.rotation.x = -Math.PI / 2;
          rim.position.set(x, 0.16, z + domeZ);
          this.scene.add(rim);
          const lip = new THREE.Mesh(this.geo(new THREE.TorusGeometry(5.3, 0.12, 6, 48)), this.mats.color(0xd8d0bf));
          lip.rotation.x = Math.PI / 2;
          lip.position.set(x, 0.2, z + domeZ);
          this.scene.add(lip);
          // Jets d'eau en couronne autour du dôme
          const jetMat = new THREE.MeshBasicMaterial({ color: 0xe8f7ff, transparent: true, opacity: 0.75 });
          for (let k = 0; k < 10; k++) {
            const a2 = (k / 10) * Math.PI * 2;
            const jet = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.09, 1.3, 6)), jetMat);
            jet.position.set(x + Math.cos(a2) * 3.7, 0.75, z + domeZ + Math.sin(a2) * 3.7);
            jet.rotation.set(Math.sin(a2) * 0.35, 0, -Math.cos(a2) * 0.35);
            this.scene.add(jet);
          }
          // Palmiers dans l'enceinte : de part et d'autre du bassin, devant chaque tour et dans le jardin arrière
          const palm = (px: number, pz: number, h = 4.2) => {
            const trunk = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.13, 0.2, h, 7)), this.mats.color(0x8a6a44));
            trunk.position.set(px, h / 2, pz);
            trunk.rotation.z = ((px * 7 + pz * 3) % 3 - 1) * 0.05;
            trunk.castShadow = this.profile.shadows;
            this.scene.add(trunk);
            const leafMat = this.mats.color(0x2e8b3e);
            for (let k = 0; k < 7; k++) {
              const a3 = (k / 7) * Math.PI * 2 + px;
              const leaf = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.35, 0.06, 1.9)), leafMat);
              leaf.position.set(px + Math.cos(a3) * 0.8, h + 0.05, pz + Math.sin(a3) * 0.8);
              leaf.rotation.set(0, -a3 + Math.PI / 2, 0);
              leaf.rotateX(0.45);
              leaf.castShadow = this.profile.shadows;
              this.scene.add(leaf);
            }
            const nut = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.22, 8, 6)), this.mats.color(0x5b4a2a));
            nut.position.set(px, h - 0.1, pz);
            this.scene.add(nut);
            this.solid(px, pz, 0.5, 0.5);
          };
          for (const e of [-1, 1] as const) {
            if (e === 1) {
              // Côté gauche, l'allée de l'entrée passe là : pas de palmier
              palm(x + e * 6.6, z + domeZ - 1.2, 4.4);
              palm(x + e * 6.8, z + domeZ + 2.4, 3.8);
            }
            palm(x + e * 13.6, z + domeZ + 2.6, 4.6);
            palm(x + e * 9, z - 5.2, 4);
          }
          // Rangée de drapeaux devant (couleurs des pays de la région)
          const flagColors = [0x006a4e, 0xe5383b, 0xffce00, 0x1f6feb, 0xf77f00, 0x009e60];
          flagColors.forEach((c, k) => {
            // De part et d'autre du bassin
            const fx = x + (k < 3 ? -13.2 + k * 1.2 : 10.8 + (k - 3) * 1.2);
            this.box(0.07, 4, 0.07, 0xd0d4da, fx, 2, z + D / 2 + 1.2, false);
            this.box(0.9, 0.55, 0.03, c, fx + 0.47, 3.65, z + D / 2 + 1.2, false);
          });
          // Clôture (photos, vue de dos) : muret blanc à niches en arc surmonté d'une haie, tout autour ; ouverture devant l'entrée
          const fz0 = z - 6.2;
          const fz1 = z + domeZ + 5.7; // la clôture avant passe devant le bassin
          const fx0 = x - 15;
          const fx1 = x + 14.4;
          const fenceSeg = (ax: number, az: number, bx: number, bz: number) => {
            const len = Math.hypot(bx - ax, bz - az);
            if (len < 0.3) return;
            const mx = (ax + bx) / 2;
            const mz = (az + bz) / 2;
            const alongX = Math.abs(bx - ax) > Math.abs(bz - az);
            this.box(alongX ? len : 0.3, 1.15, alongX ? 0.3 : len, 0xf1efe9, mx, 0.58, mz);
            this.box(alongX ? len : 0.5, 0.55, alongX ? 0.5 : len, 0x3f7d3a, mx, 1.42, mz, false); // haie
            this.solid(mx, mz, alongX ? len : 0.4, alongX ? 0.4 : len);
            // Niches en arc tous les 1,6 m (côté extérieur)
            const n = Math.floor(len / 1.6);
            for (let k = 0; k < n; k++) {
              const t = (k + 0.5) / n;
              const nx = ax + (bx - ax) * t;
              const nz = az + (bz - az) * t;
              const niche = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.42, 14, 0, Math.PI)), this.mats.color(0xc9c4b8));
              const out = alongX ? (nz > z ? 1 : -1) : (nx > x ? 1 : -1);
              niche.position.set(nx + (alongX ? 0 : out * 0.16), 0.45, nz + (alongX ? out * 0.16 : 0));
              niche.rotation.y = alongX ? (out > 0 ? 0 : Math.PI) : (out > 0 ? Math.PI / 2 : -Math.PI / 2);
              this.scene.add(niche);
            }
          };
          const gate0 = x - 13; // large portail devant l'entrée (pied de la tour gauche)
          const gate1 = x - 5;
          fenceSeg(fx0, fz1, gate0, fz1);
          fenceSeg(gate1, fz1, fx1, fz1);
          fenceSeg(fx0, fz0, fx1, fz0);
          fenceSeg(fx0, fz0, fx0, fz1);
          fenceSeg(fx1, fz0, fx1, fz1);
          // Pelouse et arbres dans le jardin derrière le bâtiment
          this.box(fx1 - fx0 - 0.6, 0.05, 2.4, 0x7fb069, x - 0.3, 0.05, z - 4.7, false);
          // Entrée agrandie : grande marquise sur deux piliers, portes vitrées larges, perron et allée dallée jusqu'au portail
          this.entrance(x - 9, z + D / 2 - 0.3, 3.6, 3);
          for (const px of [-11.6, -6.4]) this.box(0.35, 3.6, 0.35, 0xe9e5dc, x + px, 1.8, z + D / 2 + 1.6);
          this.box(6, 0.3, 2.6, 0xe9e5dc, x - 9, 3.75, z + D / 2 + 0.9, false);
          this.box(5.6, 0.06, 1.8, 0x2f5bea, x - 9, 3.58, z + D / 2 + 0.9, false);
          this.box(5, 0.05, fz1 - (z + D / 2) + 0.4, 0xd9d2c3, x - 9, 0.11, (fz1 + z + D / 2) / 2, false);
          // Piliers du portail coiffés de lanternes
          for (const gx of [gate0, gate1]) {
            this.box(0.7, 2, 0.7, 0xf1efe9, gx, 1, fz1);
            const lan = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.22, 10, 8)), lampMat);
            lan.position.set(gx, 2.3, fz1);
            this.scene.add(lan);
          }
          break;
        }
        // BCEAO (photos) : tour dorée faite de pylônes verticaux — le central plus haut, fendu d'une saignée sombre barrée de
        // traverses et coiffé du médaillon rond de la Banque —, séparés par des fentes sombres ; pylônes extérieurs plus bas au sommet
        // biseauté. Au pied, mur d'enceinte beige au grand ovale en relief, bornes blanches en cône, arbres.
        const H = 46;
        const gold = 0xcdb77c;
        const dark = 0x3a2c22;
        const tz = z - 1;
        // Plan presque rond à quatre faces identiques (photos) : sur chaque face, pylône central doré fendu d'une saignée barrée de
        // traverses et coiffé du médaillon, pylônes latéraux au sommet biseauté ; angles coupés par des pans dorés en biais.
        const S = 5.2; // demi-côté du plan
        this.box(16, 0.15, 16, 0xe9e4d8, x, 0.08, z, false);
        this.box(2 * S + 1.6, 3, 2 * S + 1.6, 0xd8cdb2, x, 1.5, tz);
        this.solid(x, tz, 2 * S + 1.6, 2 * S + 1.6);
        // Noyau sombre (vitrage brun) visible dans les fentes
        this.box(2 * S - 0.6, H - 2, 2 * S - 0.6, dark, x, 3 + (H - 2) / 2, tz);
        const medal = document.createElement('canvas');
        medal.width = 256;
        medal.height = 256;
        const mg = medal.getContext('2d')!;
        mg.fillStyle = '#cdb77c';
        mg.fillRect(0, 0, 256, 256);
        mg.fillStyle = '#4a3a2c';
        mg.beginPath();
        mg.arc(128, 128, 118, 0, Math.PI * 2);
        mg.fill();
        mg.strokeStyle = '#e8dcb8';
        mg.lineWidth = 8;
        mg.beginPath();
        mg.arc(128, 128, 104, 0, Math.PI * 2);
        mg.stroke();
        // Emblème stylisé : rostre vertical à dents (poisson-scie) et corps
        mg.strokeStyle = '#efe6cc';
        mg.lineWidth = 9;
        mg.beginPath();
        mg.moveTo(128, 40);
        mg.lineTo(128, 196);
        mg.stroke();
        for (let k = 0; k < 6; k++) {
          const yy = 52 + k * 14;
          mg.beginPath();
          mg.moveTo(128 - 16, yy);
          mg.lineTo(128 + 16, yy);
          mg.stroke();
        }
        mg.beginPath();
        mg.ellipse(128, 168, 30, 26, 0, 0, Math.PI * 2);
        mg.stroke();
        mg.beginPath();
        mg.moveTo(100, 210);
        mg.lineTo(128, 194);
        mg.lineTo(156, 210);
        mg.stroke();
        const medalTex = new THREE.CanvasTexture(medal);
        medalTex.colorSpace = THREE.SRGBColorSpace;
        const medalMat = new THREE.MeshLambertMaterial({ map: medalTex });
        const goldMat = this.mats.color(gold);
        const darkMat = this.mats.color(dark);
        const part = (g: THREE.Group, geo: THREE.BufferGeometry, mat: THREE.Material, px: number, py: number, pz: number) => {
          const m = new THREE.Mesh(this.geo(geo), mat);
          m.position.set(px, py, pz);
          m.castShadow = this.profile.shadows;
          m.receiveShadow = this.profile.shadows;
          g.add(m);
          return m;
        };
        for (let f = 0; f < 4; f++) {
          // Une face construite en repère local (vers +z), puis tournée d'un quart de tour à chaque fois
          const g = new THREE.Group();
          g.position.set(x, 0, tz);
          g.rotation.y = (f * Math.PI) / 2;
          const fz = S - 0.8; // centre des pylônes de cette face
          part(g, new THREE.BoxGeometry(3.6, H, 1.6), goldMat, 0, 3 + H / 2, fz);
          // Saignée centrale et traverses
          part(g, new THREE.BoxGeometry(1.1, H - 12, 0.2), darkMat, 0, 3 + (H - 12) / 2 + 2, fz + 0.82);
          for (let k = 0; k < 11; k++) part(g, new THREE.BoxGeometry(1.1, 0.25, 0.3), goldMat, 0, 7 + k * 3, fz + 0.86);
          // Médaillon en haut
          const md = part(g, new THREE.CircleGeometry(1.5, 32), medalMat, 0, 3 + H - 3.6, fz + 0.83);
          md.castShadow = false;
          // Pylônes latéraux, plus bas, sommet en pente vers l'extérieur
          for (const sgn of [-1, 1]) {
            const ph = H - 4;
            const w = 1.8;
            part(g, new THREE.BoxGeometry(w, ph, 1.4), goldMat, sgn * 2.9, 3 + ph / 2, fz - 0.1);
            const shape = new THREE.Shape();
            shape.moveTo(-w / 2, 0);
            shape.lineTo(w / 2, 0);
            shape.lineTo(sgn > 0 ? -w / 2 : w / 2, w * 1.1);
            shape.closePath();
            part(g, new THREE.ExtrudeGeometry(shape, { depth: 1.4, bevelEnabled: false }), goldMat, sgn * 2.9, 3 + ph, fz - 0.8);
          }
          // Pan d'angle en biais (angle coupé), un peu plus bas
          const corner = part(g, new THREE.BoxGeometry(2.4, H - 8, 1), goldMat, S - 0.9, 3 + (H - 8) / 2, S - 0.9);
          corner.rotation.y = Math.PI / 4;
          this.scene.add(g);
        }
        // Édicule et mât au sommet
        this.box(3.4, 1.6, 3.4, 0xb9a46d, x, 3 + H + 0.8, tz);
        this.box(0.18, 4, 0.18, 0xc8ccd2, x + 0.6, 3 + H + 3.6, tz, false);
        // Fenêtres éclairées la nuit dans les fentes, sur les quatre faces
        const nf = Math.floor((H - 6) / 2.2);
        for (const sgn of [-1, 1] as const) {
          this.litGrid(x - 1.98, tz + sgn * (S + 0.02), sgn, 1, nf, 1, 5.5, 2.2, 0.36, 1, 0.25);
          this.litGrid(x + 1.98, tz + sgn * (S + 0.02), sgn, 1, nf, 1, 5.5, 2.2, 0.36, 1, 0.25);
          this.litGridSide(x + sgn * (S + 0.02), tz - 1.98, sgn, 1, nf, 1, 5.5, 2.2);
          this.litGridSide(x + sgn * (S + 0.02), tz + 1.98, sgn, 1, nf, 1, 5.5, 2.2);
        }
        // Mur d'enceinte beige devant la tour, grand ovale en relief, inscription, ouverture d'entrée à droite
        const wz = z + 6.6;
        this.box(9.5, 2.6, 0.5, 0xd6c6a6, x - 2.25, 1.3, wz);
        this.solid(x - 2.25, wz, 9.5, 0.6);
        const oval = new THREE.Mesh(this.geo(new THREE.CircleGeometry(1, 40)), this.mats.color(0xeee4cc));
        oval.scale.set(3.2, 1.05, 1);
        oval.position.set(x - 1.6, 1.35, wz + 0.26);
        this.scene.add(oval);
        this.box(6.4, 0.12, 0.05, 0xc8b48a, x - 1.6, 1.35, wz + 0.28, false);
        const sign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(2.2, 0.5)), new THREE.MeshBasicMaterial({ map: this.posterTexture('BCEAO', '', '#d6c6a6', '#5a4630', 512, 116) }));
        sign.position.set(x - 5.6, 1.9, wz + 0.27);
        this.scene.add(sign);
        // Bornes blanches en cône le long du trottoir
        for (let k = 0; k < 9; k++) {
          const b = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.22, 0.6, 10)), this.mats.color(0xf2f2ee));
          b.position.set(x - 7.2 + k * 1.15, 0.3, z + 7.8);
          this.scene.add(b);
        }
        // Arbres de part et d'autre
        this.tree(x - 7, z + 3.5);
        this.tree(x + 6.8, z + 3);
        this.tree(x - 6.5, z - 5.5);
        this.entrance(x + 3.6, z + 3.55, 2, 2.2);
        break;
      }
      case 'palais_congres': {
        // Palais des Congrès de Lomé (photos) : longue façade basse à deux niveaux légèrement concave — rez-de-chaussée ouvert sur
        // piliers, grand mur-rideau bleu quadrillé entre deux bandeaux de marbre blanc — ; au centre, la sculpture blanche en
        // « corne » sur ses jambes en V, anneau à l'inscription ; derrière, la grande salle ovale coiffée d'une couronne de dents de scie ;
        // devant, la vaste esplanade de granit clair. Mâts de drapeaux sur toute la longueur du toit.
        const marble = 0xe7e5df;
        const plaza = new THREE.Mesh(this.geo(new THREE.CircleGeometry(15, 40)), this.mats.color(0xdcd9d1));
        plaza.rotation.x = -Math.PI / 2;
        plaza.scale.set(1.5, 0.62, 1);
        plaza.position.set(x, 0.035, z + 11);
        plaza.receiveShadow = this.profile.shadows;
        this.scene.add(plaza);
        // Larges bandes de granit plus claires dans l'axe, comme sur l'esplanade réelle
        for (const [bx, bw] of [[-5.5, 3.2], [5.5, 3.2], [0, 1.6]] as const) this.box(bw, 0.03, 15, 0xeceae4, x + bx, 0.06, z + 11, false);
        // Mur-rideau : vitrage bleu réfléchissant à quadrillage, éclairé la nuit (sauf coupure)
        const cv = document.createElement('canvas');
        cv.width = 128;
        cv.height = 128;
        const g2 = cv.getContext('2d');
        if (g2) {
          g2.fillStyle = '#4f86b4';
          g2.fillRect(0, 0, 128, 128);
          g2.fillStyle = '#7fb0d6';
          g2.fillRect(0, 0, 128, 40);
          g2.strokeStyle = '#d4e6f3';
          g2.lineWidth = 4;
          for (const gx of [0, 32, 64, 96]) { g2.beginPath(); g2.moveTo(gx, 0); g2.lineTo(gx, 128); g2.stroke(); }
          for (const gy of [0, 43, 86]) { g2.beginPath(); g2.moveTo(0, gy); g2.lineTo(128, gy); g2.stroke(); }
        }
        const gridTex = new THREE.CanvasTexture(cv);
        gridTex.colorSpace = THREE.SRGBColorSpace;
        this.mats.textures.push(gridTex);
        const curtain = new THREE.MeshLambertMaterial({ map: gridTex, emissive: 0xffd27a, emissiveIntensity: 0 });
        this.nightMaterials.push(curtain);
        this.nightScale.set(curtain, 0.75);
        const flagCols = [0x006a4e, 0xffce00, 0xd21034, 0xffffff];
        for (let i = 0; i <= 20; i++) {
          const dx = -20 + i * 2;
          const dz = -4 + 0.018 * dx * dx;
          const yaw = Math.atan(0.036 * dx);
          const place = (m: THREE.Mesh, ox = 0, oz = 0) => {
            m.rotation.y = yaw;
            m.position.x = x + dx + ox * Math.cos(yaw) + oz * Math.sin(yaw);
            m.position.z = z + dz - ox * Math.sin(yaw) + oz * Math.cos(yaw);
          };
          // Dalle basse, bandeau du bas, vitrage, bandeau du haut (en débord)
          place(this.box(2.25, 0.7, 7, marble, x + dx, 3.5, z + dz));
          const gl = this.box(2.2, 3.6, 5.6, 0xffffff, x + dx, 5.65, z + dz, false);
          gl.material = curtain;
          place(gl);
          place(this.box(2.25, 0.95, 7.2, marble, x + dx, 7.85, z + dz));
          // Rez-de-chaussée : pilotis devant et vitrage en retrait au fond
          for (const oz of [-3.1, 3.1]) place(this.box(0.5, 3.2, 0.5, 0xeceae4, x + dx, 1.6, z + dz), 1.0, oz);
          const back = this.box(2.2, 2.8, 0.1, 0x3a4c5c, x + dx, 1.5, z + dz, false);
          place(back, 0, -2.2);
          // Mât de drapeau sur le toit : un drapeau tous les deux modules
          const pole = this.box(0.05, 2.6, 0.05, 0xc8ccd2, x + dx, 9.6, z + dz + 0.2, false);
          pole.rotation.y = yaw;
          const flag = this.box(0.7, 0.4, 0.04, flagCols[i % 4]!, x + dx + 0.38, 10.6, z + dz + 0.2, false);
          flag.rotation.y = yaw;
          this.solid(x + dx, z + dz, 2.3 * Math.cos(yaw) + 7 * Math.abs(Math.sin(yaw)), 7 * Math.cos(yaw) + 2.3 * Math.abs(Math.sin(yaw)));
        }
        // Grande salle ovale derrière : mur blanc, couronne de dents de scie sombres et toit en retrait
        const hallZ = z - 13.5;
        const hall = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(11, 11, 11.4, 40)), this.mats.color(0xeceae4));
        hall.scale.set(1, 1, 0.78);
        hall.position.set(x, 5.7, hallZ);
        hall.castShadow = this.profile.shadows;
        this.scene.add(hall);
        this.solid(x, hallZ, 22, 17);
        // Toit vert plissé en gradins : trois couronnes de plis triangulaires (prismes) qui descendent du centre vers le bord,
        // au-dessus d'un bandeau blanc en saillie ; au sommet, un lanterneau. Comme sur la photo aérienne de la grande salle.
        const rimBand = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(11.6, 11.2, 0.9, 40)), this.mats.color(0xdedcd4));
        rimBand.scale.set(1, 1, 0.78);
        rimBand.position.set(x, 11.7, hallZ);
        this.scene.add(rimBand);
        const foldShape = new THREE.Shape();
        foldShape.moveTo(-0.62, 0);
        foldShape.lineTo(0.62, 0);
        foldShape.lineTo(0, 0.95);
        foldShape.closePath();
        const tiers: [number, number, number, number, number][] = [
          // rayon du centre du pli, nombre de plis, longueur, hauteur de départ, inclinaison
          [10.0, 34, 2.7, 12.15, 0.32],
          [7.6, 26, 2.5, 12.85, 0.3],
          [5.3, 18, 2.3, 13.5, 0.26],
        ];
        const greens = [this.mats.color(0x6f9a74), this.mats.color(0x5f8a66)];
        tiers.forEach(([R, n, len, y0, tilt], ti) => {
          const geo = this.geo(new THREE.ExtrudeGeometry(foldShape, { depth: len, bevelEnabled: false }).translate(0, 0, -len / 2));
          for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2;
            const fold = new THREE.Mesh(geo, greens[(k + ti) % 2]!);
            fold.rotation.order = 'YXZ';
            fold.rotation.set(tilt, Math.atan2(Math.cos(a), 0.78 * Math.sin(a)), 0);
            fold.position.set(x + Math.cos(a) * R, y0, hallZ + Math.sin(a) * R * 0.78);
            fold.castShadow = this.profile.shadows;
            this.scene.add(fold);
          }
        });
        const crownTop = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(3.4, 4.2, 0.9, 24)), greens[0]!);
        crownTop.scale.set(1, 1, 0.78);
        crownTop.position.set(x, 14.4, hallZ);
        const lantern = this.box(3.6, 0.7, 2.2, 0xdad8d0, x, 15.1, hallZ, false);
        this.scene.add(crownTop);
        void lantern;
        // Sculpture d'entrée : lame blanche en « corne » sur trois jambes en V, anneau à l'inscription
        const sx = x;
        const sz = z + 2.6;
        const white = this.mats.color(0xf3f2ee);
        const ring = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(2.7, 2.7, 0.45, 30)), white);
        ring.position.set(sx, 4.6, sz);
        const blade = new THREE.Mesh(this.geo(new THREE.ConeGeometry(1.6, 7.4, 20)), white);
        blade.scale.set(1, 1, 0.42);
        blade.position.set(sx + 0.35, 8.4, sz - 0.2);
        blade.rotation.z = -0.14;
        blade.castShadow = this.profile.shadows;
        this.scene.add(ring, blade);
        for (const [lx, lz, tilt] of [[-1.25, 0.5, 0.2], [1.25, 0.5, -0.2], [0, -1.1, 0]] as const) {
          const leg = this.box(0.7, 4.4, 0.7, 0xf0efea, sx + lx, 2.2, sz + lz);
          leg.rotation.z = tilt;
        }
        this.solid(sx, sz, 3, 3);
        const sign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(4.4, 0.5)), new THREE.MeshBasicMaterial({ map: this.posterTexture('PALAIS DES CONGRÈS DE LOMÉ', '', '#f3f2ee', '#14213d', 1024, 100) }));
        sign.position.set(sx, 4.65, sz + 2.72);
        this.scene.add(sign);
        // Éclairage de nuit : sculpture et piliers au projecteur, lampadaires de l'esplanade, mâts de drapeaux éclairés, salle en lumière chaude
        const glowW = new THREE.MeshLambertMaterial({ color: 0x2a2a2a, emissive: 0xffe2b0, emissiveIntensity: 0 });
        this.nightMaterials.push(glowW);
        this.nightScale.set(glowW, 1.5);
        for (const [fx, fz] of [[-2.6, 5.4], [2.6, 5.4], [0, 6.2]] as const) {
          const fl = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.9, 0.3, 0.6)), glowW);
          fl.position.set(sx + fx, 0.2, sz + fz);
          this.scene.add(fl);
        }
        for (const lx of [-22, -14, -7, 7, 14, 22]) {
          this.box(0.16, 5.2, 0.16, 0x3a3f47, x + lx, 2.6, z + 15, false);
          const head = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.9, 0.25, 0.5)), glowW);
          head.position.set(x + lx, 5.3, z + 15);
          this.scene.add(head);
        }
        for (let i = 0; i <= 20; i += 2) {
          const dx = -20 + i * 2;
          const dz = -4 + 0.018 * dx * dx;
          const wash = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.4, 0.2, 0.5)), glowW);
          wash.position.set(x + dx, 0.15, z + dz + 3.9);
          wash.rotation.y = Math.atan(0.036 * dx);
          this.scene.add(wash);
        }
        if (this.profile.pointLights > 0) {
          for (const [lx, ly, lz, dist] of [[0, 4.5, 6.5, 24], [-12, 4.5, 2, 22], [12, 4.5, 2, 22], [0, 5.5, 13, 26]] as const) {
            const pl = new THREE.PointLight(0xffe2b0, 0, dist, 1.6);
            pl.position.set(x + lx, ly, z + lz);
            this.scene.add(pl);
            this.pointLights.push(pl);
          }
        }
        break;
      }
      case 'cnss': {
        // Silhouette réelle du siège : longue façade concave, pavillons cylindriques ocre,
        // noyau central marqué CNSS et jardin circulaire devant l'entrée.
        // La taille réelle vient de VENUE_LAYOUTS.cnss (réduction appliquée à tout le lieu).
        this.box(42, 0.16, 26, 0xd9d1bf, x, 0.08, z, false);
        // Vitres des ailes, de la tour centrale et des pavillons : s'allument la nuit (sauf coupure)
        const paneMat = new THREE.MeshLambertMaterial({ color: 0x2f5064, emissive: 0xffd27a, emissiveIntensity: 0 });
        this.nightMaterials.push(paneMat);
        this.nightScale.set(paneMat, 0.22);
        // Façade concave à cinq niveaux : bandeaux de béton clair et rubans de verre bleu à meneaux, parapet en couronne
        const cv = document.createElement('canvas');
        cv.width = 128;
        cv.height = 256;
        const g2 = cv.getContext('2d');
        if (g2) {
          g2.fillStyle = '#e4e1da';
          g2.fillRect(0, 0, 128, 256);
          for (let f = 0; f < 5; f++) {
            g2.fillStyle = '#4a79a8';
            g2.fillRect(0, f * 51 + 9, 128, 34);
            g2.fillStyle = '#7fa8cf';
            g2.fillRect(0, f * 51 + 9, 128, 10);
            g2.fillStyle = '#e4e1da';
            for (const mx of [0, 42, 84, 126]) g2.fillRect(mx, f * 51 + 9, 4, 34);
          }
        }
        const ribbonTex = new THREE.CanvasTexture(cv);
        ribbonTex.colorSpace = THREE.SRGBColorSpace;
        this.mats.textures.push(ribbonTex);
        const ribbon = new THREE.MeshLambertMaterial({ map: ribbonTex, emissive: 0xffd27a, emissiveIntensity: 0 });
        this.nightMaterials.push(ribbon);
        this.nightScale.set(ribbon, 0.2);
        const concrete = 0xe6e3dc;
        for (let i = 0; i <= 14; i++) {
          const dx = -19.6 + i * 2.8;
          const dz = z - 9 + 0.012 * dx * dx;
          const yaw = Math.atan(0.024 * dx);
          const seg = this.box(2.85, 12.6, 6.2, concrete, x + dx, 6.3, dz);
          seg.rotation.y = yaw;
          const face = this.box(2.8, 12.2, 0.14, 0xffffff, x + dx + Math.sin(yaw) * 3.15, 6.3, dz + Math.cos(yaw) * 3.15, false);
          face.material = ribbon;
          face.rotation.y = yaw;
          const para = this.box(2.95, 0.7, 6.5, 0xd9d5cc, x + dx, 12.95, dz, false);
          para.rotation.y = yaw;
          this.solid(x + dx, dz, 2.85 * Math.cos(yaw) + 6.2 * Math.abs(Math.sin(yaw)), 6.2 * Math.cos(yaw) + 2.85 * Math.abs(Math.sin(yaw)));
        }
        // Ailes d'extrémité : volumes blancs anguleux, la face de l'aile droite en pan vitré incliné
        for (const sx of [-1, 1]) {
          this.box(5.2, 14.4, 7.2, 0xeeece6, x + sx * 23.2, 7.2, z - 4.6);
          this.solid(x + sx * 23.2, z - 4.6, 5.2, 7.2);
          const slope = this.box(0.35, 11.5, 2.6, 0xffffff, x + sx * 20.55, 6.6, z - 1.4, false);
          slope.material = ribbon;
          slope.rotation.y = sx * 0.5;
          slope.rotation.z = sx * -0.14;
        }
        // Tour centrale : noyau ocre vertical, couronne blanche portant les lettres bleues CNSS
        this.box(7.6, 17.6, 6.4, 0xe8e4dc, x, 8.8, z - 9.6);
        this.solid(x, z - 9.6, 7.6, 6.4);
        this.box(2.6, 17.9, 0.5, 0xb98862, x, 8.95, z - 6.4, false);
        this.box(5.8, 2.9, 4.6, 0xe3dfd6, x, 19.05, z - 9.6);
        this.box(6.2, 0.35, 5, 0xc9c4b8, x, 20.6, z - 9.6, false);
        // Enseigne : grandes lettres bleues CNSS, centrées, sur le bandeau blanc tout en haut de la tour (lisibles de loin)
        const signTex = this.lettersTexture('CNSS', '#1d4ea8', '#f6f4ee', 1024, 320);
        const sign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(5.6, 2.3)), new THREE.MeshBasicMaterial({ map: signTex }));
        sign.position.set(x, 19.05, z - 7.27);
        this.scene.add(sign);
        // Même enseigne sur la face arrière du bandeau, pour la vue depuis le nord de la carte
        const signBack = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(5.6, 2.3)), new THREE.MeshBasicMaterial({ map: signTex }));
        signBack.position.set(x, 19.05, z - 11.93);
        signBack.rotation.y = Math.PI;
        this.scene.add(signBack);
        // Deux tours cylindriques ocre de part et d'autre de l'entrée, fenêtres en meurtrière
        for (const dx of [-5.2, 5.2]) {
          const tower = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(2.1, 2.2, 12.6, 22)), this.mats.color(0xc58a63));
          tower.position.set(x + dx, 6.3, z - 3.2);
          tower.castShadow = this.profile.shadows;
          this.scene.add(tower);
          const cap = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(2.25, 2.25, 0.4, 22)), this.mats.color(0xdcd6c8));
          cap.position.set(x + dx, 12.8, z - 3.2);
          this.scene.add(cap);
          for (const fy of [4.5, 9.2]) {
            const slit = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.5, 0.6, 0.08)), paneMat);
            slit.position.set(x + dx, fy, z - 1.1);
            this.scene.add(slit);
          }
          this.solid(x + dx, z - 3.2, 4.4, 4.4);
        }
        // Bloc d'entrée entre les tours : deux balcons-dalles à ailerons verticaux, grand auvent, hall vitré en retrait
        this.box(8.2, 11, 3.2, 0xe2ded6, x, 5.5, z - 4.8);
        for (const [by, bd] of [[7.6, 3.6], [10.2, 3.0]] as const) {
          this.box(9, 0.5, bd, 0xeceae4, x, by, z - 2.6 + (3.6 - bd) * 0.2, false);
          for (let k = 0; k < 8; k++) this.box(0.22, 1.7, 0.5, 0xd9d5cc, x - 4.2 + k * 1.2, by - 1.05, z - 0.9 + (3.6 - bd) * 0.2, false);
          const gl = this.box(7.6, 1.7, 0.1, 0xffffff, x, by - 1.05, z - 2.6, false);
          gl.material = ribbon;
        }
        this.box(10.6, 0.5, 5.4, 0xdedad2, x, 4.5, z - 0.8, false);
        this.box(6.6, 3.8, 0.2, 0x273038, x, 2.2, z - 3.1, false);
        for (const dx of [-4.4, -2.2, 0, 2.2, 4.4]) this.box(0.28, 4, 0.28, 0xb4b8ba, x + dx, 2.2, z + 1.7, false);
        // Jardin circulaire devant l'entrée : pelouse, haie basse et massif fleuri en couronne, bordure rouge et blanche, sculpture
        const gz = z + 9.3; // jardin rond repoussé vers l'intérieur de l'enceinte, loin du portail
        // Parvis dallé devant l'entrée (point d'arrivée des visiteurs), perron à trois marches et deux allées dallées de part et d'autre du jardin jusqu'au portail
        this.box(30, 0.12, 6.6, 0xd9d1bf, x, 0.13, z + 4.2, false);
        for (let k = 0; k < 3; k++) this.box(9.4 - k * 0.6, 0.16, 0.7, k % 2 ? 0xe2dccd : 0xcbc2ad, x, 0.1 + k * 0.1, z + 2.5 - k * 0.65, false); // marches : la plus haute est contre le hall
        for (const sx of [-1, 1]) this.box(4.4, 0.1, 11.5, 0xd9d1bf, x + sx * 8.6, 0.17, z + 11.4, false);
        for (const sx of [-1, 1]) for (const lz of [3.4, 7.8, 12.2, 16]) this.box(0.9, 0.5, 0.9, 0x8e9094, x + sx * 11.2, 0.25, z + lz, false);
        const drive = new THREE.Mesh(this.geo(new THREE.RingGeometry(4.3, 5.9, 40)), this.mats.color(0x777b7d));
        drive.rotation.x = -Math.PI / 2;
        drive.position.set(x, 0.13, gz);
        this.scene.add(drive);
        const garden = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(3.6, 3.6, 0.2, 40)), this.mats.color(0x58a64f));
        garden.position.set(x, 0.16, gz);
        this.scene.add(garden);
        const hedge = new THREE.Mesh(this.geo(new THREE.TorusGeometry(3.2, 0.36, 6, 48)), this.mats.color(0x2f6b3a));
        hedge.rotation.x = -Math.PI / 2;
        hedge.position.set(x, 0.55, gz);
        hedge.scale.set(1, 1, 0.8);
        this.scene.add(hedge);
        const bloomCols = [0xe5383b, 0xff8fa3, 0xffce00, 0xe5383b];
        for (let k = 0; k < 30; k++) {
          const ang = (k / 30) * Math.PI * 2;
          const fb = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.2, 5, 4)), this.mats.color(bloomCols[k % bloomCols.length]!));
          fb.position.set(x + Math.cos(ang) * 3.2, 0.95, gz + Math.sin(ang) * 3.2);
          this.scene.add(fb);
        }
        for (let k = 0; k < 22; k++) {
          const ang = (k / 22) * Math.PI * 2;
          const kb = this.box(0.6, 0.22, 0.28, k % 2 ? 0xf4f1ea : 0xd42a2a, x + Math.cos(ang) * 3.85, 0.2, gz + Math.sin(ang) * 3.85, false);
          kb.rotation.y = -ang + Math.PI / 2;
        }
        // Sculpture blanche : une mère et son enfant portés par deux mains en coupe, disque rouge au pied
        const whiteS = this.mats.color(0xf4f2ee);
        const sBase = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(1.0, 1.1, 0.7, 16)), whiteS);
        sBase.position.set(x, 0.55, gz);
        this.scene.add(sBase);
        for (const sg of [-1, 1]) {
          const hand = this.box(0.35, 2.4, 1.1, 0xf4f2ee, x + sg * 0.75, 1.9, gz);
          hand.rotation.z = sg * -0.4;
        }
        const body = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.28, 0.4, 1.4, 10)), whiteS);
        body.position.set(x, 3.0, gz);
        const head = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.27, 10, 8)), whiteS);
        head.position.set(x, 3.95, gz);
        const child = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.34, 10, 8)), whiteS);
        child.position.set(x + 0.55, 3.35, gz + 0.1);
        this.scene.add(body, head, child);
        const disc = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.55, 0.55, 0.1, 18)), this.mats.color(0xc4121d));
        disc.rotation.x = Math.PI / 2;
        disc.position.set(x, 0.85, gz + 1.2);
        this.scene.add(disc);
        // Cyprès en colonne le long de la façade, palmiers sur les côtés
        for (const [cx2, cz2, hh] of [[-11.5, z + 2.2, 7.5], [-13, z + 3, 6], [11.5, z + 2.2, 7.5], [13, z + 3, 6], [-17, z + 1, 6.5], [17, z + 1, 6.5]] as const) {
          const cy = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.95, hh, 8)), this.mats.color(0x2d6a3a));
          cy.position.set(x + cx2, hh / 2, cz2);
          cy.scale.set(1, 1, 0.9);
          this.scene.add(cy);
        }
        this.tree(x - 15, z + 9);
        this.tree(x + 15, z + 9);
        // Perron à deux marches, mâts à drapeau du Togo, fontaine, massifs fleuris, pelouses et lampadaires éclairés la nuit
        this.box(10.8, 0.3, 1.2, 0xd9d1bf, x, 0.15, z + 4.5, false);
        this.box(9.4, 0.18, 0.9, 0xcbc2ad, x, 0.09, z + 5.3, false);
        for (const sx of [-1, 1]) {
          const mx = x + sx * 8.2;
          this.box(0.14, 9, 0.14, 0xc8ccd2, mx, 4.5, z + 6, false);
          const fl = [0x006a4e, 0xffce00, 0x006a4e, 0xffce00, 0x006a4e];
          fl.forEach((c, i) => this.box(2, 0.2, 0.04, c, mx + 1.1, 8.55 - i * 0.2, z + 6, false));
          this.box(0.75, 1, 0.05, 0xd21034, mx + 0.38, 8.15, z + 6.02, false);
        }
        for (const sx of [-1, 1]) {
          const lawn = this.box(11, 0.1, 12, 0x6fb25a, x + sx * 16, 0.12, z + 6, false);
          lawn.receiveShadow = this.profile.shadows;
        }
        const lampGlow = new THREE.MeshLambertMaterial({ color: 0xfff4d6, emissive: 0xffd27a, emissiveIntensity: 0 });
        this.nightMaterials.push(lampGlow);
        for (const [lx, lz] of [[-11, 11], [11, 11], [-11, 3], [11, 3], [-17, 9], [17, 9]] as const) {
          this.box(0.14, 3.6, 0.14, 0x3a3f47, x + lx, 1.8, z + lz, false);
          const head = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.55, 0.22, 0.55)), lampGlow);
          head.position.set(x + lx, 3.7, z + lz);
          this.scene.add(head);
        }
        // Éclairage soigné : lumière chaude sur le parvis et l'entrée, projecteurs au pied de la façade, lampadaires qui éclairent le sol
        if (this.profile.pointLights > 0) {
          for (const [lx, ly, lz, dist] of [[0, 6, 4, 26], [-10, 5, 8, 20], [10, 5, 8, 20], [0, 5, 11, 22]] as const) {
            const pl = new THREE.PointLight(0xffe2ac, 0, dist, 1.6);
            pl.position.set(x + lx, ly, z + lz);
            this.scene.add(pl);
            this.pointLights.push(pl);
          }
        }
        const uplight = new THREE.MeshLambertMaterial({ color: 0x2a2a2a, emissive: 0xffe2ac, emissiveIntensity: 0 });
        this.nightMaterials.push(uplight);
        this.nightScale.set(uplight, 0.8);
        for (const ux of [-17, -12, -8, 8, 12, 17]) {
          const sp = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.7, 0.25, 0.5)), uplight);
          sp.position.set(x + ux, 0.2, z - 5.4 + 0.012 * ux * ux);
          this.scene.add(sp);
        }
        // Mise en lumière façon photo du soir : tours ocre et sculpture au projecteur, hall allumé, bornes lumineuses autour du jardin
        const warm = new THREE.MeshLambertMaterial({ color: 0x2a2a2a, emissive: 0xffd9a0, emissiveIntensity: 0 });
        this.nightMaterials.push(warm);
        this.nightScale.set(warm, 0.8);
        for (const ux of [-5.2, 5.2]) {
          const cone = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(2.0, 2.3, 12.4, 22, 1, true)), new THREE.MeshLambertMaterial({ color: 0xd08b62, emissive: 0xffb070, emissiveIntensity: 0, side: THREE.DoubleSide }));
          cone.position.set(x + ux, 6.2, z - 3.2 + 0.02);
          cone.scale.set(1.02, 1, 1.02);
          this.nightMaterials.push(cone.material as THREE.MeshLambertMaterial);
          this.nightScale.set(cone.material as THREE.Material, 0.5);
          this.scene.add(cone);
          const flood = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.8, 0.3, 0.6)), warm);
          flood.position.set(x + ux, 0.25, z - 0.4);
          this.scene.add(flood);
        }
        const hall = this.box(6.4, 3.6, 0.1, 0xffffff, x, 2.2, z - 3.0, false);
        hall.material = warm;
        for (let k = 0; k < 16; k++) {
          const ang = (k / 16) * Math.PI * 2;
          const bol = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.16, 0.16, 0.6, 8)), warm);
          bol.position.set(x + Math.cos(ang) * 4.6, 0.4, z + 9.3 + Math.sin(ang) * 4.6);
          this.scene.add(bol);
        }
        if (this.profile.pointLights > 0) {
          const sculpt = new THREE.PointLight(0xfff0cf, 0, 12, 1.8);
          sculpt.position.set(x, 3.2, z + 11.6);
          this.scene.add(sculpt);
          this.pointLights.push(sculpt);
        }
        // Guérite de l'entrée (vitre éclairée)
        this.box(2.6, 2.6, 2.2, 0xe9e1d3, x + 10.2, 1.3, z + 15.6);
        this.box(3, 0.25, 2.6, 0x176345, x + 10.2, 2.7, z + 15.6, false);
        const gw = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.6, 1, 0.08)), paneMat);
        gw.position.set(x + 10.2, 1.5, z + 14.46);
        this.scene.add(gw);
        // Clôture de l'enceinte : muret bas et grille noire sur les quatre côtés, portail ouvert au centre de la façade
        this.fenceRect(x - 22, x + 22, z - 13.5, z + 17.5, [{ x, w: 15 }]); // légèrement rapprochée de la route // portail large et cour plus profonde : l'entrée respire
        break;
      }
      case 'amb_usa':
        this.embassy(x, z, 'AMBASSADE DES ÉTATS-UNIS', this.stripes([0xb22234, 0xffffff, 0xb22234, 0xffffff, 0xb22234, 0xffffff, 0xb22234], false, (g) => this.patch(g, 0x3c3b6e, 1, 0.86, 0.5, 0.37)), true);
        break;
      case 'amb_chine':
        this.embassy(x, z, 'AMBASSADE DE CHINE', this.stripes([0xde2910], false, (g) => this.patch(g, 0xffde00, 0.35, 0.35, 0.45, 0.45)));
        break;
      case 'amb_france':
        this.embassy(x, z, 'AMBASSADE DE FRANCE', this.stripes([0x002395, 0xffffff, 0xed2939], true));
        break;
      case 'amb_allemagne':
        this.embassy(x, z, 'AMBASSADE D’ALLEMAGNE', this.stripes([0x000000, 0xdd0000, 0xffce00], false));
        break;
      case 'amb_ghana':
        this.embassy(x, z, 'AMBASSADE DU GHANA', this.stripes([0xce1126, 0xfcd116, 0x006b3f], false, (g) => this.patch(g, 0x000000, 0.3, 0.3, 1.2, 0)));
        break;
      case 'amb_nigeria':
        this.embassy(x, z, 'AMBASSADE DU NIGERIA', this.stripes([0x008751, 0xffffff, 0x008751], true));
        break;
      case 'presidence': {
        // Palais de Lomé II : volume très horizontal brun/cuivré, façade en retrait sous une
        // colonnade sombre et grande coupole dorée. On ne reproduit que ce qui est visible publiquement.
        this.box(46, 0.15, 32, 0xbfdc9c, x, 0.08, z, false);
        for (const [bw, bd, bx, bz] of [[46, 0.6, 0, -16], [0.6, 32, -23, 0], [0.6, 32, 23, 0], [19, 0.6, -13.5, 16], [19, 0.6, 13.5, 16]] as const) {
          this.box(bw, 2.2, bd, 0xf3efe6, x + bx, 1.1, z + bz, false);
        }
        for (const dx of [-4.5, 4.5]) this.box(2, 3, 2, 0xd9d3c4, x + dx, 1.5, z + 16);
        this.box(6, 0.2, 18, 0xe9e4d8, x, 0.12, z + 7, false);
        this.box(8, 0.4, 4, 0xd9d3c4, x, 0.3, z + 9, false);
        this.box(7, 0.42, 3, 0x5fb4e6, x, 0.32, z + 9, false);
        for (let i = 0; i < 4; i++) {
          for (const dx of [-4, 4]) {
            this.box(0.14, 6, 0.14, 0xc8ccd2, x + dx, 3, z + 13 - i * 4, false);
            this.box(1.4, 0.3, 0.04, 0x006a4e, x + dx + 0.7, 5.6, z + 13 - i * 4, false);
            this.box(1.4, 0.3, 0.04, 0xffce00, x + dx + 0.7, 5.3, z + 13 - i * 4, false);
            this.box(0.5, 0.5, 0.05, 0xd21034, x + dx + 0.25, 5.45, z + 13 - i * 4 + 0.01, false);
          }
        }
        this.box(38, 8.2, 12, 0x8b4f2e, x, 4.1, z - 8);
        this.solid(x, z - 8, 36, 12);
        this.box(40, 0.9, 13.4, 0x60331f, x, 8.65, z - 8, false);
        this.box(31, 5.6, 0.45, 0x2a211d, x, 4.4, z - 1.75, false);
        for (let i = 0; i < 15; i++) this.box(0.55, 7.5, 0.75, 0xb77a4d, x - 17.5 + i * 2.5, 3.75, z - 1.35);
        this.box(12, 9.5, 4.4, 0x9b5f37, x, 4.75, z - 2.1);
        this.box(13.2, 1, 5.1, 0x63351f, x, 9.8, z - 2.1, false);
        const pres = new THREE.Mesh(this.geo(new THREE.SphereGeometry(5, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2)), this.mats.color(0xd5a62e));
        pres.scale.y = 0.72;
        pres.position.set(x, 9.1, z - 7.5);
        pres.castShadow = this.profile.shadows;
        this.scene.add(pres);
        const drum = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(4.25, 4.8, 1.5, 28)), this.mats.color(0xa76d2f));
        drum.position.set(x, 8.45, z - 7.5);
        this.scene.add(drum);
        this.box(0.14, 8, 0.14, 0xc8ccd2, x, 4, z + 2.2, false);
        this.box(2.4, 0.5, 0.05, 0x006a4e, x + 1.2, 7.7, z + 2.2, false);
        this.box(2.4, 0.5, 0.05, 0xffce00, x + 1.2, 7.2, z + 2.2, false);
        this.box(0.8, 0.8, 0.06, 0xd21034, x + 0.4, 7.45, z + 2.21, false);
        for (const dx of [-15, 15]) for (const dz of [-1, 6]) this.tree(x + dx, z + dz);
        break;
      }
      case 'palais_lome': {
        // Ancien Palais des Gouverneurs (1905) dans son parc face à la mer : arcades blanches, toit de tuiles.
        this.box(28, 0.15, 18, 0xa9d48a, x, 0.08, z, false);
        this.box(20, 7, 8, 0xfbf6ea, x, 3.5, z - 3);
        this.solid(x, z - 3, 20, 8);
        this.box(6, 9, 9, 0xfbf6ea, x, 4.5, z - 2.5);
        const roof = new THREE.Mesh(this.geo(new THREE.ConeGeometry(12, 3, 4, 1)), this.mats.color(0xb5533c));
        roof.rotation.y = Math.PI / 4;
        roof.scale.set(1, 1, 0.42);
        roof.position.set(x, 8.5, z - 3);
        this.scene.add(roof);
        for (let i = 0; i < 9; i++) this.box(0.5, 3, 0.5, 0xffffff, x - 9 + i * 2.25, 1.5, z + 1.2);
        this.box(20, 0.4, 1.6, 0xeeeae0, x, 3.2, z + 1.2, false);
        this.box(4, 0.2, 9, 0xe9e4d8, x, 0.12, z + 5, false);
        for (const [dx, dz] of [[-11, 4], [-8, 7], [8, 7], [11, 4], [-12, -6], [12, -6]] as const) this.tree(x + dx, z + dz);
        this.entrance(x + 1.125, z + 1.1, 1.7, 2.6);
        break;
      }
      case 'yas': {
        // Siège Yas Togo (ex-Togocom) : tour de dix niveaux, deux grands pans de verre bleu à ailerons bruns séparés par un noyau
        // central de pierre ocre, cadre ocre sur les côtés et en couronne, bannières jaunes et bleues (toit et façade) ;
        // devant, la galerie basse à frise de losanges, haies, pin et pierre dressée ; pylône radio voisin.
        const OCHRE = 0xd2a85f;
        const mk = (draw: (g: CanvasRenderingContext2D) => void, w: number, h: number, repeat?: [number, number]): THREE.CanvasTexture => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const g = c.getContext('2d');
          if (g) draw(g);
          const t = new THREE.CanvasTexture(c);
          t.colorSpace = THREE.SRGBColorSpace;
          if (repeat) {
            t.wrapS = THREE.RepeatWrapping;
            t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(repeat[0], repeat[1]);
          }
          this.mats.textures.push(t);
          return t;
        };
        // Vitrage : bleu réfléchissant, petits carreaux (meneaux fins)
        const glassTex = mk((g) => {
          const gr = g.createLinearGradient(0, 0, 0, 128);
          gr.addColorStop(0, '#86b6e0');
          gr.addColorStop(1, '#4b82b4');
          g.fillStyle = gr;
          g.fillRect(0, 0, 128, 128);
          g.strokeStyle = '#1f3d5a';
          g.lineWidth = 2;
          for (let k = 0; k <= 128; k += 32) { g.beginPath(); g.moveTo(k, 0); g.lineTo(k, 128); g.stroke(); }
          for (let k = 0; k <= 128; k += 16) { g.beginPath(); g.moveTo(0, k); g.lineTo(128, k); g.stroke(); }
        }, 128, 128, [2, 4]);
        const glassMat = new THREE.MeshLambertMaterial({ map: glassTex, emissive: 0xffd27a, emissiveIntensity: 0 });
        this.nightMaterials.push(glassMat);
        this.nightScale.set(glassMat, 0.4);
        this.box(36, 0.15, 17, 0xc8b58f, x, 0.08, z, false);
        // Corps de la tour : deux pans vitrés, noyau central, cadre ocre sur les côtés et en couronne
        for (const sx of [-1, 1]) {
          this.box(12, 22, 7, 0x4b82b4, x + sx * 7.8, 11, z - 4);
          const front = this.box(12, 22, 0.12, 0xffffff, x + sx * 7.8, 11, z - 0.47, false);
          front.material = glassMat;
          const side = this.box(0.12, 22, 7, 0xffffff, x + sx * 13.85, 11, z - 4, false);
          side.material = glassMat;
          // Ailerons verticaux bruns le long du vitrage
          for (const fx of [-4.2, -1.4, 1.4, 4.2]) this.box(0.22, 22, 0.4, 0x9a6a4c, x + sx * 7.8 + fx, 11, z - 0.3, false);
          this.box(1.7, 24.4, 7.6, OCHRE, x + sx * 14.7, 12.2, z - 4);
        }
        this.solid(x, z - 4, 31.5, 7.4);
        this.box(2.6, 27.2, 7.6, 0xc99a63, x, 13.6, z - 4); // le noyau dépasse du toit, comme sur la photo
        this.box(1.1, 26.6, 0.3, 0xa9784f, x, 13.3, z - 0.1, false);
        this.box(32.6, 2.3, 8, OCHRE, x, 23.6, z - 4);
        this.box(32.9, 0.35, 8.3, 0xb98d52, x, 24.9, z - 4, false);
        // Bannières de toit jaunes et bleues, drapeau du Togo et mât
        const roofBanner = (bx: number, bw: number, text: string) => {
          const tex = mk((g) => {
            g.fillStyle = '#ffcb05';
            g.fillRect(0, 0, 768, 256);
            g.fillStyle = '#17385c';
            g.fillRect(0, 0, 768, 22);
            g.fillRect(0, 234, 768, 22);
            g.textAlign = 'center';
            g.textBaseline = 'middle';
            g.font = '900 150px sans-serif';
            g.fillText(text.toLowerCase(), 300, 118, 560);
            g.font = '800 62px sans-serif';
            g.fillText('TOGO', 650, 118, 190);
          }, 768, 256);
          const m = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(bw, bw * (256 / 768))), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, fog: false }));
          m.position.set(bx, 26.2, z - 0.1);
          m.userData.decor = true;
          this.scene.add(m);
          this.box(bw, 0.15, 0.4, 0x17385c, bx, 25.05 - 0.0, z - 0.3, false);
          m.position.y = 25.05 + (bw * (256 / 768)) / 2 + 0.1;
        };
        roofBanner(x - 9, 10, 'YAS');
        roofBanner(x + 10, 8, 'YAS');
        this.box(0.14, 3.2, 0.14, 0xc8ccd2, x + 1.2, 26.6, z - 4, false);
        this.box(1.1, 0.7, 0.05, 0x006a4e, x + 1.8, 27.8, z - 4, false);
        // Grandes bannières sur le vitrage : forme jaune « Le réseau qui fait la fierté du Togo » et disque bleu « yas »
        const bnL = mk((g) => {
          g.fillStyle = '#ffcb05';
          g.beginPath();
          g.moveTo(10, 40); g.bezierCurveTo(80, 0, 400, 10, 500, 60); g.bezierCurveTo(520, 130, 380, 230, 220, 240); g.bezierCurveTo(60, 245, 0, 130, 10, 40);
          g.fill();
          g.fillStyle = '#17385c';
          g.font = '800 54px sans-serif';
          g.fillText('Le réseau', 50, 92, 420);
          g.fillText('qui fait la fierté', 50, 150, 430);
          g.fillText('du Togo', 50, 208, 420);
        }, 512, 256);
        const banL = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(14, 7)), new THREE.MeshBasicMaterial({ map: bnL, transparent: true, toneMapped: false, fog: false }));
        banL.position.set(x - 7.4, 16.8, z - 0.4);
        this.scene.add(banL);
        const bnR = mk((g) => {
          g.fillStyle = '#17385c';
          g.beginPath(); g.ellipse(128, 110, 112, 100, -0.35, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#ffcb05';
          g.font = '900 120px sans-serif';
          g.textAlign = 'center';
          g.fillText('yas', 128, 148, 200);
        }, 256, 220);
        const banR = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(9, 7.6)), new THREE.MeshBasicMaterial({ map: bnR, transparent: true, toneMapped: false, fog: false }));
        banR.position.set(x + 8, 15.6, z - 0.4);
        this.scene.add(banR);
        // Galerie basse : soubassement brun, vitrage sombre, frise de losanges brun et blanc
        this.box(34, 4.2, 5, 0x6d4c3d, x, 2.1, z + 2.2);
        this.solid(x, z + 2.2, 34, 5);
        const friezeTex = mk((g) => {
          g.fillStyle = '#6d4c3d';
          g.fillRect(0, 0, 64, 64);
          g.strokeStyle = '#efe6d8';
          g.lineWidth = 4;
          g.beginPath(); g.moveTo(32, 6); g.lineTo(58, 32); g.lineTo(32, 58); g.lineTo(6, 32); g.closePath(); g.stroke();
          g.fillStyle = '#b98d6a';
          g.beginPath(); g.moveTo(32, 20); g.lineTo(44, 32); g.lineTo(32, 44); g.lineTo(20, 32); g.closePath(); g.fill();
        }, 64, 64, [17, 1]);
        const frieze = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(34, 1.5)), new THREE.MeshBasicMaterial({ map: friezeTex }));
        frieze.position.set(x, 3.45, z + 4.72);
        this.scene.add(frieze);
        const gl = this.box(30, 2, 0.1, 0xffffff, x, 1.4, z + 4.72, false);
        gl.material = glassMat;
        this.box(34.6, 0.35, 5.6, 0xb98d52, x, 4.35, z + 2.2, false);
        // Haies arrondies, buissons, pin et pierre dressée devant la galerie
        for (let k = 0; k < 14; k++) {
          const hx = x - 16.2 + k * 2.5;
          const hedge = new THREE.Mesh(this.geo(new THREE.SphereGeometry(1.05, 8, 6)), this.mats.color(k % 2 ? 0x3f8a46 : 0x4a9a50));
          hedge.position.set(x + hx - x, 0.7, z + 6.3 + (k % 3) * 0.2);
          hedge.scale.set(1.2, 0.8, 0.9);
          this.scene.add(hedge);
        }
        const pine = new THREE.Mesh(this.geo(new THREE.ConeGeometry(1.1, 5.2, 8)), this.mats.color(0x2f6b3a));
        pine.position.set(x + 2.6, 2.6, z + 7.6);
        this.scene.add(pine);
        const stone = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.7, 1.6, 6)), this.mats.color(0x8a7d6c));
        stone.position.set(x - 4.5, 0.8, z + 8.4);
        this.scene.add(stone);
        // Pylône radio voisin (rouge et blanc)
        this.box(0.35, 30, 0.35, 0xc8332b, x + 19.5, 15, z - 3, false);
        for (let i = 0; i < 5; i++) this.box(3.4 - i * 0.45, 0.12, 0.12, i % 2 ? 0xf1f1f1 : 0xc8332b, x + 19.5, 5 + i * 5, z - 3, false);
        this.entrance(x, z + 4.75, 2.6);
        break;
      }
      case 'carrefour_otr': {
        // Carrefour à feux : passages piétons sur le boulevard et la rue, quatre feux tricolores.
        const zebra = (cx: number, cz: number, alongX: boolean) => {
          for (let i = -3; i <= 3; i++) this.box(alongX ? 0.6 : 3.2, 0.03, alongX ? 3.2 : 0.6, 0xffffff, cx + (alongX ? i * 1 : 0), 0.05, cz + (alongX ? 0 : i * 1), false);
        };
        zebra(x, z - 6, true);
        zebra(x, z + 7, true);
        zebra(x - 7, z + 2.2, false);
        for (const axis of ['z', 'x'] as const) {
          const set = this.signalSet();
          for (const dir of [1, -1] as const) this.signalPost(x, z, axis, dir, set);
          this.lights.push({ ...set.lamps, halo: set.halo, sig: 0, axis });
        }
        break;
      }
      case 'otr': {
        // Complexe de sept niveaux : deux ailes en mur-rideau bleu, panneau central rouge cuivré
        // percé de longues fenêtres et enseigne en toiture.
        this.box(22, 0.12, 16, 0xe1ddd3, x, 0.06, z - 1, false);
        this.box(19, 20, 8.5, 0x31566c, x, 10, z - 4);
        this.solid(x, z - 4, 19, 8.5);
        for (const dx of [-9.8, 9.8]) this.box(0.65, 21, 9, 0xc8c9c6, x + dx, 10.5, z - 4);
        this.box(11, 15.5, 0.35, 0xb44f3e, x, 9, z + 0.42, false);
        for (let i = 0; i < 5; i++) this.box(8.5, 0.72, 0.12, 0x203f50, x, 4.2 + i * 2.65, z + 0.64, false);
        this.box(20.5, 0.8, 9.4, 0x3c3f42, x, 20.4, z - 4, false);
        this.box(6, 0.45, 3.2, 0xd8d4ca, x + 3.5, 4, z + 2, false);
        const sign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(17, 1.6)), new THREE.MeshBasicMaterial({ map: this.posterTexture('OFFICE TOGOLAIS DES RECETTES', '', '#e8ecef', '#26333b', 1024, 100) }));
        sign.position.set(x, 21.7, z - 3.9);
        this.scene.add(sign);
        this.entrance(x + 3.5, z + 0.7, 2.6);
        for (let i = 0; i < 2; i++) {
          this.box(0.14, 6, 0.14, 0xc8ccd2, x - 6 + i * 1.6, 3, z + 4.5, false);
          this.box(1.4, 0.3, 0.04, 0x006a4e, x - 5.3 + i * 1.6, 5.6, z + 4.5, false);
          this.box(1.4, 0.3, 0.04, 0xffce00, x - 5.3 + i * 1.6, 5.3, z + 4.5, false);
        }
        break;
      }
      case 'carrefour_gta': {
        // GTA est avant tout un grand nœud routier d'Agbalépédogan : anneau sobre, voies larges,
        // marquage, station-service et arrêt de motos/bus. Pas de monument inventé au centre.
        const ring = new THREE.Mesh(this.geo(new THREE.RingGeometry(GTA_ISLAND, GTA_RING, 40)), this.mats.color(C.road));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, 0.03, z);
        const island = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(GTA_ISLAND, GTA_ISLAND, 0.35, 32)), this.mats.color(0xbfdc9c));
        island.position.set(x, 0.18, z);
        const kerb = new THREE.Mesh(this.geo(new THREE.TorusGeometry(GTA_ISLAND, 0.18, 6, 32)), this.mats.color(0xffffff));
        kerb.rotation.x = -Math.PI / 2;
        kerb.position.set(x, 0.36, z);
        this.scene.add(ring, island, kerb);
        this.solid(x, z, GTA_ISLAND * 1.6, GTA_ISLAND * 1.6);
        this.roundaboutDecor(x, z, GTA_RING, GTA_ISLAND, true);
        // Bordure rouge/blanc, visible sur les grands carrefours de Lomé.
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2;
          const block = this.box(1.05, 0.32, 0.34, i % 2 ? 0xffffff : 0xd22d2d, x + Math.cos(a) * GTA_ISLAND, 0.34, z + Math.sin(a) * GTA_ISLAND, false);
          block.rotation.y = -a;
        }
        // Stations du carrefour : modèle Zener, comme les stations-service de la ville (version compacte, même emprise 8,5 × 6,2 m) :
        // deux ombrelles pyramidales bleue et verte sur des fûts, îlots de pompes à bordures rouges et blanches, logo Zener
        const fuel = (fx: number, fz: number) => {
          const BLUE = 0x1b4fa3;
          const GREEN = 0x3aa535;
          this.box(8.5, 0.12, 6.2, 0x777b80, fx, 0.08, fz, false);
          ([[-2.2, BLUE], [2.2, GREEN]] as const).forEach(([dx, col]) => {
            this.box(0.35, 3.6, 0.35, 0xdfe2e5, fx + dx, 1.8, fz, false);
            const roof = new THREE.Mesh(this.geo(new THREE.ConeGeometry(2.9, 1.1, 4)), this.mats.color(col));
            roof.rotation.y = Math.PI / 4;
            roof.position.set(fx + dx, 4.15, fz);
            this.scene.add(roof);
            // Îlot de pompes : bordure rouge et blanche, deux pompes de part et d'autre du fût
            this.box(2.6, 0.2, 1.1, 0xd71920, fx + dx, 0.2, fz, false);
            this.box(2.4, 0.22, 0.9, 0xffffff, fx + dx, 0.22, fz, false);
            for (const px of [-0.8, 0.8]) this.box(0.5, 1.4, 0.45, 0xe7e8e5, fx + dx + px, 1, fz, false);
          });
          const board = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(1.6, 1.6)), new THREE.MeshBasicMaterial({ map: this.zenerLogo(), toneMapped: false }));
          board.position.set(fx, 2.6, fz + 2.9);
          this.box(0.2, 2.6, 0.2, 0xdfe2e5, fx, 1.3, fz + 2.85, false);
          this.scene.add(board);
        };
        fuel(x + 14, z - 10);
        fuel(x - 14, z + 10);
        // (L'ancien immeuble « GTA Assurances » à l'ouest du rond-point est retiré : il était posé sur le début de l'avenue
        // de la Chance. Le lieu GTA Assurances du jeu est construit à part.)
        // Arrêt de quartier, distinct des bâtiments commerciaux.
        this.box(5.2, 0.35, 1.8, 0xfff4ea, x + 13, 3.25, z + 9, false);
        for (const dx of [-2.2, 2.2]) this.box(0.22, 3, 0.22, 0x3c4650, x + 13 + dx, 1.5, z + 9, false);
        const stop = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(4.4, 1.05)), new THREE.MeshBasicMaterial({ map: this.posterTexture('GTA', 'ARRÊT • ZÉM • BUS', '#176345', '#ffffff', 512, 110) }));
        stop.position.set(x + 13, 2.4, z + 8.08);
        this.scene.add(stop);
        break;
      }
      case 'hopital_dogta': {
        // Hôpital Dogta-Lafiè (Agoè-Nyivé, ouvert en 2023) : huit blocs modulaires préfabriqués — accueil central, médecine,
        // chirurgie, mère-enfant, VIP, laboratoire, administration/logistique et urgences — reliés par une coursive vitrée.
        // Le complexe s'étend à l'est de la bretelle (l'axe nord-sud de la RN1 passe à l'ouest).
        // D'après les photos du site : volumes en bardage beige, panneaux verts, claustras sombres, escaliers extérieurs en acier
        const WHITE = 0xe6dcc0;
        const SAND = 0xcdbf9e;
        const TEAL = SAND;
        const BLUE = SAND;
        const GREEN = 0x2c9f5c;
        const STEEL = 0x4a5058;
        const glass = this.litGlass();
        const sign = (text: string, w: number, h: number, sx: number, sy: number, sz: number, bg: string, fg = '#ffffff') => {
          const m = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(w, h)), new THREE.MeshBasicMaterial({ map: this.posterTexture(text, '', bg, fg, 512, Math.round((512 * h) / w)) }));
          m.position.set(sx, sy, sz);
          this.scene.add(m);
        };
        // Bloc : volume blanc, bandes vitrées par niveau côté façade, soubassement et acrotère colorés
        const block = (x0: number, x1: number, z0: number, z1: number, h: number, accent: number, green = false, strips = true, door = false) => {
          const w = x1 - x0;
          const d = z1 - z0;
          const cx = x + (x0 + x1) / 2;
          const cz = z + (z0 + z1) / 2;
          this.box(w, h, d, WHITE, cx, h / 2, cz);
          this.solid(cx, cz, w, d, h + 0.5);
          this.box(w + 0.3, 0.5, d + 0.3, accent, cx, 0.25, cz, false);
          this.box(w + 0.4, 0.45, d + 0.4, accent, cx, h + 0.22, cz, false);
          const floors = Math.max(1, Math.floor(h / 3.5));
          // Rez-de-chaussée : bandeau vitré ; étages : bandes verticales vitrées entre les pans de bardage (comme sur les photos)
          const g0 = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w - 1.4, 1.5, 0.1)), glass);
          g0.position.set(cx, 1.9, z + z1 + 0.05);
          this.scene.add(g0);
          for (let k = 1; k < Math.floor(w / 2.4); k++) this.box(0.08, 1.55, 0.14, 0xaeb8c0, cx - (w - 1.4) / 2 + k * 2.4, 1.9, z + z1 + 0.08, false);
          if (door) {
            // Entrée du bloc : cadre sombre, porte vitrée claire, petit auvent et seuil
            const fz = z + z1;
            this.box(2.6, 2.7, 0.18, 0x2b2f36, cx, 1.35, fz + 0.1, false);
            const leaf = new THREE.Mesh(this.geo(new THREE.BoxGeometry(2.1, 2.4, 0.1)), this.glowGlass(0x9fc9e8));
            leaf.position.set(cx, 1.25, fz + 0.21);
            this.scene.add(leaf);
            this.box(0.06, 2.4, 0.12, 0x2b2f36, cx, 1.25, fz + 0.24, false);
            this.box(3.4, 0.14, 1.3, STEEL, cx, 2.95, fz + 0.7, false);
            this.box(3, 0.1, 1.2, 0xcfd3d6, cx, 0.06, fz + 0.7, false);
          }
          // Joints verticaux des panneaux de bardage (tous les 1,3 m), comme sur la façade réelle
          for (let k = 1; k < Math.floor(w / 1.3); k++) this.box(0.04, h - 0.8, 0.03, 0xbfb08c, cx - w / 2 + k * 1.3, h / 2 + 0.1, z + z1 + 0.015, false);
          if (h > 4.8 && strips) {
            const nStrip = Math.max(1, Math.floor(w / 5));
            for (let k = 0; k < nStrip; k++) {
              const sx = cx - w / 2 + ((k + 0.5) * w) / nStrip;
              const strip = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.1, h - 3.6, 0.1)), glass);
              strip.position.set(sx, 3.2 + (h - 3.6) / 2, z + z1 + 0.05);
              this.scene.add(strip);
              this.box(1.5, h - 3.2, 0.06, 0x8a8f96, sx, 3.0 + (h - 3.2) / 2, z + z1 + 0.02, false);
            }
          }
          if (green) this.box(0.3, h - 1.2, Math.max(2, d - 3), GREEN, x + x1 + 0.15, h / 2 + 0.3, cz, false);
          // Fenêtres éclairées la nuit sur les côtés et à l'arrière du bloc (certaines éteintes)
          const rowsN = Math.max(1, floors);
          this.litGridSide(x + x1, cz, 1, Math.max(1, Math.floor(d / 2.8)), rowsN, 2.6, 2.4, 3.4);
          this.litGridSide(x + x0, cz, -1, Math.max(1, Math.floor(d / 2.8)), rowsN, 2.6, 2.4, 3.4);
          this.litGrid(cx, z + z0, -1, Math.max(1, Math.floor(w / 2.8)), rowsN, 2.6, 2.4, 3.4, 0.9, 1.2);
          // Toit : acrotère clair et groupes techniques
          this.box(1.6, 0.9, 1.1, 0xaab0b8, cx + w * 0.25, h + 0.9, cz, false);
          return { cx, cz };
        };
        // Parvis et voirie interne
        this.box(66, 0.1, 34, 0xa9b1b9, x + 24, 0.05, z - 8, false);
        this.box(66, 0.12, 0.3, TEAL, x + 24, 0.06, z + 9, false);
        // 1. Accueil / distribution centrale : grand hall vitré à auvent et croix rouge
        const c = block(-8, 8, -10, 0, 12.4, TEAL, false, false); // façade plane : le volume vitré et l'enseigne s'y posent ; le bardage beige monte au-dessus de la résille verte, comme sur la photo
        // Devanture : mur-rideau vitré à meneaux d'acier, portes automatiques centrales, auvent large à bandeau vert, perron et jardinières
        const sky = this.glowGlass(0x9fc9e8); // vitrage clair : se lit sur le bardage beige, s'éclaire la nuit
        const curtain = new THREE.Mesh(this.geo(new THREE.BoxGeometry(12.4, 3.4, 0.14)), sky);
        curtain.position.set(c.cx, 2.0, z + 0.3);
        this.scene.add(curtain);
        for (let k = 0; k <= 8; k++) this.box(0.12, 3.5, 0.24, 0x2b2f36, c.cx - 6.2 + k * 1.55, 2.0, z + 0.38, false);
        this.box(12.6, 0.16, 0.26, 0x2b2f36, c.cx, 3.72, z + 0.38, false);
        this.box(12.6, 0.16, 0.26, 0x2b2f36, c.cx, 0.3, z + 0.38, false);
        // Portes automatiques : deux vantaux coulissants dans un cadre sombre, poignées et seuil
        this.box(4.2, 3.0, 0.2, 0x2b2f36, c.cx, 1.55, z + 0.5, false);
        for (const dx of [-0.85, 0.85]) {
          const leaf = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.6, 2.7, 0.1)), sky);
          leaf.position.set(c.cx + dx, 1.5, z + 0.64);
          this.scene.add(leaf);
          this.box(0.06, 1.0, 0.1, 0xd0d4d8, c.cx + dx * 0.2, 1.3, z + 0.72, false);
        }
        this.box(0.06, 2.8, 0.14, 0x2b2f36, c.cx, 1.5, z + 0.66, false);
        this.box(4.6, 0.1, 0.8, 0xcfd3d6, c.cx, 0.1, z + 0.8, false);
        this.box(14, 0.28, 3.8, 0xb9bfc4, c.cx, 3.5, z + 2.0); // auvent d'entrée en tôle nervurée
        this.box(14.2, 1.15, 0.2, GREEN, c.cx, 2.78, z + 3.9, false); // bandeau d'enseigne plus haut, pour un texte lisible
        const banner = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(13.4, 0.95)), new THREE.MeshBasicMaterial({ map: this.bannerTexture('ACCUEIL · ADMISSIONS', '#1f8a4c', '#ffffff') }));
        banner.position.set(c.cx, 2.78, z + 4.02);
        this.scene.add(banner);
        for (const dx of [-6.6, -2.2, 2.2, 6.6]) {
          this.box(0.18, 3.4, 0.18, STEEL, c.cx + dx, 1.7, z + 3.7, false);
          // Contreventement en équerre sous la tôle, comme sur la photo
          for (const sg of [-1, 1]) {
            const brace = this.box(0.1, 1.5, 0.1, STEEL, c.cx + dx + sg * 0.55, 3.0, z + 3.7, false);
            brace.rotation.z = -sg * 0.7;
          }
        }
        for (let k = 0; k < 28; k++) this.box(0.08, 0.1, 3.8, 0x9aa0a6, c.cx - 6.8 + k * 0.5, 3.69, z + 2.0, false);
        const downGlow = new THREE.MeshLambertMaterial({ color: 0xfff4d6, emissive: 0xffd27a, emissiveIntensity: 0 });
        this.nightMaterials.push(downGlow);
        for (const dx of [-5, -1.7, 1.7, 5]) {
          const dl = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.5, 0.06, 0.5)), downGlow);
          dl.position.set(c.cx + dx, 3.33, z + 2.2);
          this.scene.add(dl);
        }
        this.box(11, 0.16, 1.2, 0xd9d2c3, c.cx, 0.08, z + 4.6, false);
        this.box(9.6, 0.1, 1.2, 0xcbc2ad, c.cx, 0.05, z + 5.7, false);
        for (const dx of [-7.2, 7.2]) {
          this.box(2.6, 0.6, 0.9, 0xb9b3a8, c.cx + dx, 0.3, z + 1.3);
          for (let k = 0; k < 3; k++) {
            const pl = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.28, 1.3, 6)), this.mats.color(k === 1 ? 0x8a2f4a : 0x4f9a52));
            pl.position.set(c.cx + dx + (k - 1) * 0.8, 1.2, z + 1.3);
            this.scene.add(pl);
          }
        }
        // Volume vitré de l'accueil, enveloppé d'une résille verte en métal déployé (bandes d'étage et ailettes) : l'intérieur
        // chaud se voit la nuit à travers. Le logo lumineux est sur le bardage beige à sa droite.
        const warm = new THREE.MeshLambertMaterial({ color: 0x9db3bf, emissive: 0xffd9a0, emissiveIntensity: 0 });
        this.nightMaterials.push(warm);
        this.nightScale.set(warm, 0.85);
        const volume = new THREE.Mesh(this.geo(new THREE.BoxGeometry(10.2, 6.7, 1.0)), warm);
        volume.position.set(c.cx - 2.6, 7.15, z + 0.6);
        this.scene.add(volume);
        for (let k = 0; k < 4; k++) this.box(10.5, 0.8, 1.4, GREEN, c.cx - 2.6, 3.95 + k * 2.1, z + 0.72, false);
        for (let k = 0; k <= 20; k++) this.box(0.1, 6.7, 1.42, 0x238a4d, c.cx - 7.5 + k * 0.5, 7.15, z + 0.72, false);
        this.box(0.5, 6.7, 1.45, GREEN, c.cx + 2.5, 7.15, z + 0.72, false);
        // Toiture du volume vitré : dalle beige débordante, bordée de vert, qui ferme le dessus de la résille
        this.box(10.9, 0.3, 1.7, SAND, c.cx - 2.6, 10.7, z + 0.75);
        this.box(10.9, 0.14, 0.14, GREEN, c.cx - 2.6, 10.9, z + 1.55, false);
        // Couvertine verte sur tout le dessus de la résille (rien n'est laissé ouvert, vu de dessus ou de biais)
        this.box(11.1, 0.16, 1.9, GREEN, c.cx - 2.6, 10.93, z + 0.75, false);
        this.box(0.3, 0.5, 1.9, GREEN, c.cx + 2.9, 10.95, z + 0.75, false);
        this.box(0.3, 0.5, 1.9, GREEN, c.cx - 8.1, 10.95, z + 0.75, false);
        // Enseigne en relief directement sur le bardage, comme sur la photo : croix bleue et verte, « HÔPITAL » en bleu,
        // « DOGTA-LAFIÈ » en vert ; une ombre portée légère derrière donne le relief
        const signTex = this.dogtaSignTexture();
        const signShadow = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(4.8, 1.69)), new THREE.MeshBasicMaterial({ map: signTex, transparent: true, color: 0x2a2a2a, opacity: 0.4 }));
        signShadow.position.set(c.cx + 5.5, 7.34, z + 0.05);
        this.scene.add(signShadow);
        const logo = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(4.8, 1.69)), new THREE.MeshBasicMaterial({ map: signTex, transparent: true }));
        // Entièrement à droite de la dernière ailette verte (qui avance de 1,4 m et masquerait le bord gauche vu de biais)
        logo.position.set(c.cx + 5.45, 7.4, z + 0.09);
        this.scene.add(logo);
        // Coursive vitrée (colonne vertébrale) reliant tous les blocs
        const spine = new THREE.Mesh(this.geo(new THREE.BoxGeometry(46, 2.6, 3)), glass);
        spine.position.set(x + 30, 1.5, z - 4.5);
        this.scene.add(spine);
        this.box(46.4, 0.3, 3.4, 0xaeb8c0, x + 30, 3, z - 4.5, false);
        // 2-4. Médecine, chirurgie, mère-enfant : trois ailes en peigne au nord de la coursive
        block(12, 22, -24, -6, 9.8, BLUE, true);
        block(26, 36, -24, -6, 9.8, TEAL);
        block(40, 50, -24, -6, 9.8, SAND, true);
        // 5. VIP (terrasse végétalisée) et 6. laboratoire, en façade sud de la coursive
        const vip = block(14, 26, -3, 5, 6.2, SAND, false, true, true);
        this.box(11, 0.3, 7, 0x4e9a4a, vip.cx, 6.4, vip.cz, false);
        block(30, 38, -3, 4, 3.6, BLUE, false, true, true);
        // 7. Administration et logistique (derrière l'accueil) et 8. urgences (angle sud-est)
        block(-8, 8, -24, -12, 6.4, STEEL);
        const er = block(41, 55, -3, 6, 4.6, GREEN, false, true, true);
        this.box(14, 0.35, 5, GREEN, er.cx, 3.6, z + 8.4); // auvent des urgences
        for (const dx of [-6, 6]) this.box(0.3, 3.6, 0.3, 0xaeb8c0, er.cx + dx, 1.8, z + 10.7, false);
        sign('URGENCES · SAMU', 9, 1, er.cx, 3.1, z + 6.15, '#1f8a4c');
        // Ambulances du SAMU devant les urgences
        for (const dx of [-3.4, 3.4]) {
          const amb = this.buildCar(0xffffff, 4.4, { kind: 'van', stripe: 0xd21034 });
          amb.position.set(er.cx + dx, 0, z + 12);
          amb.rotation.y = Math.PI;
          this.scene.add(amb);
          this.box(0.1, 0.3, 3.2, 0xd21034, er.cx + dx, 1.25, z + 12, false);
        }
        // Parking, drapeau et arbres le long de la bretelle
        for (let i = 0; i < 6; i++) this.box(0.1, 0.02, 3.6, 0xffffff, x + 14 + i * 3, 0.13, z + 13, false);
        this.box(0.14, 9, 0.14, 0xaeb8c0, x - 11, 4.5, z + 6, false);
        this.box(2.2, 1.3, 0.05, 0x006a4e, x - 9.9, 8, z + 6, false);
        this.tree(x + 20, z + 17);
        this.tree(x + 52, z + 16);
        // Clôture de l'enceinte comme celle de la CNSS : portail principal devant l'accueil, portail des urgences à l'est
        // Escaliers extérieurs en acier entre les ailes (palier tous les 1,9 m), comme sur les photos
        for (const sx of [24, 38]) {
          for (const [px, pz] of [[-1.7, -1.1], [1.7, -1.1], [-1.7, 1.1], [1.7, 1.1]] as const) this.box(0.12, 9.4, 0.12, STEEL, x + sx + px, 4.7, z - 9 + pz, false);
          this.box(4, 0.16, 3, 0x9aa0a6, x + sx, 9.55, z - 9, false); // toiture de la cage d'escalier
          for (let f = 1; f <= 5; f++) {
            this.box(3.5, 0.12, 2.4, STEEL, x + sx, f * 1.9, z - 9, false);
            const flight = this.box(3.2, 0.1, 0.5, STEEL, x + sx, f * 1.9 - 0.95, z - 9 + (f % 2 ? -0.9 : 0.9), false);
            flight.rotation.z = (f % 2 ? 1 : -1) * 0.5;
          }
        }
        // Cheminement couvert sur poteaux d'acier devant les ailes de soins, potelets blancs au bord de la chaussée
        this.box(30, 0.18, 3, 0xcfd3d6, x + 26, 3.4, z + 7, false);
        for (let i = 0; i <= 6; i++) for (const pz of [5.7, 8.3]) this.box(0.16, 3.4, 0.16, STEEL, x + 11 + i * 5, 1.7, z + pz, false);
        for (let i = 0; i < 12; i++) {
          // Le devant de l'entrée reste libre : pas de potelets entre les deux lampadaires d'accès
          if (Math.abs(-12 + i * 2.2) < 9) continue;
          const bol = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.13, 0.13, 0.85, 8)), this.mats.color(0xdfe3e6));
          bol.position.set(x - 12 + i * 2.2, 0.43, z + 10.2);
          this.scene.add(bol);
        }
        // Héliport sur le toit de l'aile de chirurgie
        const pad = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(3.2, 3.2, 0.12, 24)), this.mats.color(0x3a4a5a));
        pad.position.set(x + 31, 7.5, z - 15);
        this.scene.add(pad);
        const padRing = new THREE.Mesh(this.geo(new THREE.TorusGeometry(2.7, 0.07, 6, 28)), this.mats.color(0xffffff));
        padRing.rotation.x = Math.PI / 2;
        padRing.position.set(x + 31, 7.6, z - 15);
        this.scene.add(padRing);
        for (const dx of [-0.8, 0.8]) this.box(0.28, 2.2, 0.05, 0xffffff, x + 31 + dx, 7.62, z - 15, false).rotation.x = -Math.PI / 2;
        this.box(1.6, 0.28, 0.05, 0xffffff, x + 31, 7.62, z - 15, false).rotation.x = -Math.PI / 2;
        // Totem au logo près du portail principal, pelouse fleurie, lampadaires éclairés la nuit, bancs et palmiers
        // Totem hors de la clôture, à droite du portail : grand panneau blanc uni (non assombri par la lumière) sur deux poteaux
        for (const dx of [-2.6, 2.6]) this.box(0.3, 5, 0.3, 0x4a5058, x + 12 + dx, 2.5, z + 21.6);
        const board = new THREE.Mesh(this.geo(new THREE.BoxGeometry(7.6, 4.2, 0.2)), new THREE.MeshBasicMaterial({ color: 0xffffff }));
        board.position.set(x + 12, 5.2, z + 21.8);
        this.scene.add(board);
        const totem = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(6.8, 3.58)), new THREE.MeshBasicMaterial({ map: this.logoTexture('dogta'), transparent: true }));
        totem.position.set(x + 12, 5.2, z + 21.93);
        this.scene.add(totem);
        this.scene.add(totem);
        const lawnH = this.box(66, 0.1, 3, 0x6fb25a, x + 24, 0.12, z + 17.8, false);
        lawnH.receiveShadow = this.profile.shadows;
        for (let k = 1; k < 16; k++) {
          const fl = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.28, 6, 5)), this.mats.color([0xe5383b, 0xffce00, 0xff8fa3, 0xffffff][k % 4]!));
          fl.position.set(x + 4 + k * 3.6, 0.38, z + 17.2);
          this.scene.add(fl);
        }
        const lampGlow = new THREE.MeshLambertMaterial({ color: 0xfff4d6, emissive: 0xffd27a, emissiveIntensity: 0 });
        this.nightMaterials.push(lampGlow);
        for (const lx of [-8, 8, 22, 36, 50]) {
          this.box(0.14, 3.6, 0.14, 0x3a3f47, x + lx, 1.8, z + 14.8, false);
          const head = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.55, 0.22, 0.55)), lampGlow);
          head.position.set(x + lx, 3.7, z + 14.8);
          this.scene.add(head);
        }
        for (const bx of [24]) this.box(2.2, 0.14, 0.6, 0x7a5a3a, x + bx, 0.5, z + 7.2, false);
        for (const tx of [12, 28, 36, 44]) this.tree(x + tx, z + 18);
        this.fenceRect(x - 12, x + 60, z - 28, z + 20, [{ x, w: 14 }, { x: x + 48, w: 8 }]);
        break;
      }
      case 'chr_commune': {
        // Hôpital : bâtiment principal à croix rouge, pavillons, urgences avec ambulance
        const big = v.id === 'chr_commune';
        this.building(x, z - 5, big ? 26 : 20, 10, big ? 10 : 8, 0xffffff, 0x22a861);
        this.building(x + (big ? 17 : 14), z - 4, 7, 8, 5, 0xf3efe6, 0x22a861);
        this.box(0.7, 3.2, 0.3, 0xe5383b, x, (big ? 10 : 8) + 2.2, z, false);
        this.box(3.2, 0.7, 0.3, 0xe5383b, x, (big ? 10 : 8) + 2.2, z, false);
        const sign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(14, 1.3)), new THREE.MeshBasicMaterial({ map: this.posterTexture(big ? 'CHR LOMÉ-COMMUNE' : 'HÔPITAL DOGTA-LAFIÈ', '', '#22a861', '#ffffff', 1024, 100) }));
        sign.position.set(x, 4.5, z + 0.1);
        this.scene.add(sign);
        const amb = this.buildCar(0xffffff, 4.4, { kind: 'van', stripe: 0xd21034 });
        amb.position.set(x - 9, 0, z + 4);
        this.scene.add(amb);
        break;
      }
      case 'stade_kegue': {
        // Stade de Kégué : pelouse rayée avec son tracé et ses buts, piste d'athlétisme, quatre tribunes à gradins aux couleurs
        // du Togo (vert, jaune, rouge), tribune d'honneur couverte au nord, pylônes éclairés, tableau d'affichage et portail
        // d'entrée sur le boulevard (au sud). Posé au nord du boulevard de Kégué.
        const zs = z - 11;
        const FLAG = [0x006a4e, 0xffce00, 0xd21034];
        this.box(54, 0.08, 44, 0xd8d3c8, x, 0.04, zs, false); // parvis et ceinture de béton
        // Piste et lignes de couloirs
        this.box(40, 0.1, 30, 0xc2633a, x, 0.08, zs, false);
        for (const dz of [-14.2, -13, -11.8, 11.8, 13, 14.2]) this.box(37, 0.015, 0.12, 0xffffff, x, 0.14, zs + dz, false);
        for (const dx of [-19.4, -18.2, 18.2, 19.4]) this.box(0.12, 0.015, 25, 0xffffff, x, 0.14, zs, false).position.x = x + dx;
        // Pelouse : bandes de tonte alternées, puis tracé complet
        this.box(30, 0.14, 20, 0x3f9b4a, x, 0.1, zs, false);
        for (let i = 0; i < 6; i++) this.box(5, 0.01, 20, i % 2 ? 0x4aa855 : 0x378a42, x - 12.5 + i * 5, 0.18, zs, false);
        const line = (w: number, d: number, lx: number, lz: number) => this.box(w, 0.012, d, 0xffffff, lx, 0.19, lz, false);
        line(30, 0.18, x, zs - 10); line(30, 0.18, x, zs + 10); line(0.18, 20, x - 15, zs); line(0.18, 20, x + 15, zs); line(0.18, 20, x, zs);
        for (const sx of [-1, 1]) {
          line(5.5, 0.18, x + sx * 12.25, zs - 6); line(5.5, 0.18, x + sx * 12.25, zs + 6); line(0.18, 12, x + sx * 9.5, zs);
          line(2, 0.18, x + sx * 14, zs - 3); line(2, 0.18, x + sx * 14, zs + 3); line(0.18, 6, x + sx * 13, zs);
          // But : deux poteaux, barre transversale et filet léger
          for (const gz of [-3.6, 3.6]) this.box(0.14, 2.4, 0.14, 0xffffff, x + sx * 15.1, 1.3, zs + gz, false);
          this.box(0.14, 0.14, 7.4, 0xffffff, x + sx * 15.1, 2.5, zs, false);
          this.box(1.6, 2.3, 7.2, 0xe6edf2, x + sx * 15.9, 1.2, zs, false).material = this.mats.color(0xe6edf2, 0.9);
        }
        const circle = new THREE.Mesh(this.geo(new THREE.RingGeometry(2.55, 2.73, 40)), this.mats.color(0xffffff));
        circle.rotation.x = -Math.PI / 2;
        circle.position.set(x, 0.19, zs);
        this.scene.add(circle);
        // Tribunes à gradins : trois rangs de sièges par côté, blocs vert / jaune / rouge, derrière un mur d'enceinte blanc
        const tier = (w: number, d: number, tx: number, tz: number, rank: number, seg: number, alongX: boolean) => {
          const n = Math.max(3, Math.round(w / seg));
          for (let k = 0; k < n; k++) {
            const sw = w / n;
            const off = -w / 2 + sw * (k + 0.5);
            this.box(alongX ? sw : d, 1.2 + rank * 1.3, alongX ? d : sw, FLAG[(k + rank) % 3]!, alongX ? tx + off : tx, (1.2 + rank * 1.3) / 2, alongX ? tz : tz + off, false);
          }
        };
        for (const [sgn, tiers] of [[-1, 3], [1, 3]] as const) {
          for (let r = 0; r < tiers; r++) {
            tier(46, 1.7, x, zs + sgn * (15.8 + r * 1.7), r, 7.5, true);
          }
          this.box(46, 7.2, 0.8, 0xece8de, x, 3.6, zs + sgn * 21.6, false);
          this.box(46.2, 0.5, 0.9, FLAG[sgn === -1 ? 0 : 2]!, x, 7.2, zs + sgn * 21.6, false);
        }
        for (const sgn of [-1, 1] as const) {
          for (let r = 0; r < 2; r++) tier(26, 1.6, x + sgn * (20.6 + r * 1.6), zs, r, 6.5, false);
          this.box(0.8, 5.4, 26, 0xece8de, x + sgn * 24.6, 2.7, zs, false);
        }
        this.solid(x, zs, 52, 44);
        // Tribune d'honneur (nord) : toit en porte-à-faux sur piliers, enseigne et loge officielle
        const roof = this.box(46, 0.35, 9, 0xf4f1ea, x, 9.4, zs - 19, false);
        roof.rotation.x = -0.14;
        this.box(46.4, 0.45, 0.5, FLAG[1]!, x, 9.2, zs - 14.9, false);
        for (let k = -2; k <= 2; k++) this.box(0.5, 9.2, 0.5, 0xc8ccd2, x + k * 10, 4.6, zs - 22.4, false);
        this.box(14, 2.4, 1.2, 0xe9e5db, x, 8, zs - 21.8, false);
        this.box(13, 1.4, 0.1, 0x8fb4c8, x, 8, zs - 21.1, false);
        // Auvent plus bas sur la tribune sud (côté entrée)
        const roofS = this.box(46, 0.3, 5, 0xf4f1ea, x, 7.8, zs + 18.6, false);
        roofS.rotation.x = 0.1;
        for (let k = -2; k <= 2; k++) this.box(0.4, 7.8, 0.4, 0xc8ccd2, x + k * 10, 3.9, zs + 21, false);
        // Pylônes d'éclairage aux quatre coins : mât et panneau de projecteurs, éclairés la nuit
        const flood = new THREE.MeshBasicMaterial({ color: 0xfff6c8 });
        this.nightMaterials.push(flood as unknown as THREE.MeshLambertMaterial);
        for (const [dx, dz] of [[-26, -22], [26, -22], [-26, 22], [26, 22]] as const) {
          const mast = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.22, 0.34, 20, 8)), this.mats.color(0xc8ccd2));
          mast.position.set(x + dx, 10, zs + dz);
          this.scene.add(mast);
          this.box(4, 2.6, 0.5, 0x3a3f47, x + dx, 20.4, zs + dz, false).rotation.x = dz < 0 ? 0.35 : -0.35;
          const bank = new THREE.Mesh(this.geo(new THREE.BoxGeometry(3.6, 2.2, 0.15)), flood);
          bank.position.set(x + dx, 20.3, zs + dz + (dz < 0 ? 0.35 : -0.35));
          bank.rotation.x = dz < 0 ? 0.35 : -0.35;
          this.scene.add(bank);
        }
        // Tableau d'affichage à l'est, tourné vers la pelouse
        this.box(0.6, 3.4, 8, 0x20242a, x + 24.2, 8.6, zs, false);
        const sb = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(7.2, 2.6)), new THREE.MeshBasicMaterial({ map: this.posterTexture('0 – 0', 'KÉGUÉ • LOMÉ', '#14213d', '#ffce00', 512, 185) }));
        sb.position.set(x + 23.85, 8.6, zs);
        sb.rotation.y = -Math.PI / 2;
        this.scene.add(sb);
        this.nightMaterials.push(sb.material as unknown as THREE.MeshLambertMaterial);
        // Portail d'entrée au sud, sur le boulevard : deux piliers, linteau à l'enseigne, mâts et drapeaux aux couleurs du Togo
        for (const dx of [-5, 5]) this.box(1.6, 6.5, 1.6, 0xece8de, x + dx, 3.25, zs + 22.6, false);
        this.box(13, 1.8, 1.8, 0xece8de, x, 7.4, zs + 22.6, false);
        const gate = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(10, 1.5)), new THREE.MeshBasicMaterial({ map: this.posterTexture('STADE DE KÉGUÉ', 'LOMÉ • TOGO', '#006a4e', '#ffffff', 512, 77) }));
        gate.position.set(x, 7.4, zs + 23.55);
        this.scene.add(gate);
        this.nightMaterials.push(gate.material as unknown as THREE.MeshLambertMaterial);
        for (const [i, dx] of ([-8, -10, 8, 10] as const).entries()) {
          this.box(0.15, 7, 0.15, 0xc8ccd2, x + dx, 3.5, zs + 23, false);
          this.box(0.1, 1.1, 1.8, FLAG[i % 3]!, x + dx, 6.4, zs + 23.9, false);
        }
        for (const dx of [-3.4, 3.4]) this.box(1.6, 2.2, 1.4, 0xf4f1ea, x + dx, 1.1, zs + 24.6, false); // guichets
        this.box(9, 0.08, 6, 0xc9c3b5, x, 0.06, zs + 25.5, false); // parvis devant le portail
        break;
      }
      case 'echangeur_kegue':
      case 'echangeur_agoe': {
        const b = FLYOVERS[v.id];
        const flyover = new THREE.Group();
        flyover.position.set(b.x, 0, b.z);
        flyover.rotation.y = b.yaw;
        this.scene.add(flyover);
        this.mergeParents.push(flyover);
        const part = (w: number, h: number, d: number, color: number, lx: number, y: number, lz: number) => {
          const mesh = this.box(w, h, d, color, 0, 0, 0, false);
          mesh.userData.venueId = v.id;
          mesh.position.set(lx, y, lz);
          flyover.add(mesh);
          return mesh;
        };
        // La surface routière est construite dans buildRoads ; ici, la structure d'un échangeur moderne : tablier sur piles
        // rondes à chevêtre, rampes sur remblais à murs de soutènement, glissières en béton et main courante, lampadaires
        // à bras et lignes de rive. Le tracé (hauteur, longueur) ne change pas : la circulation reste la même.
        const concrete = 0xd6d3cb;
        const rampLen = Math.hypot(b.ramp, b.height);
        // Dalles un peu sous l'asphalte (dessiné à part) : à la même hauteur, la dalle grise l'emportait de loin
        part(b.half * 2, 0.8, b.width, 0xc4c8cd, 0, b.height - 0.5, 0);
        // Corniche plus claire sous le bord du tablier
        for (const side of [-1, 1]) part(b.half * 2, 0.35, 0.3, 0xeeece6, 0, b.height - 0.95, side * (b.width / 2 - 0.1));
        // Piles rondes et chevêtres, de part et d'autre de la voie qui passe dessous
        for (const sign of [-1, 1]) {
          const px = sign * (b.half - 1.6);
          for (const side of [-1, 1]) {
            const [wx, wz] = bridgePoint(b, px, side * (b.width / 2 - 2));
            if (this.groundRoadAt(wx, wz, 0.6)) continue;
            const col = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.55, 0.65, b.height - 1.4, 14)), this.mats.color(concrete));
            col.position.set(px, (b.height - 1.4) / 2, side * (b.width / 2 - 2));
            col.castShadow = this.profile.shadows;
            col.userData.venueId = v.id;
            flyover.add(col);
          }
          part(1.1, 0.6, b.width - 0.6, concrete, px, b.height - 1.1, 0);
        }
        // Rampes : dalle inclinée sur des piles (pas de remblai plein : des routes au sol, comme les bretelles d'Agoè,
        // passent dessous ; un remblai les faisait disparaître dans le béton)
        for (const sign of [-1, 1]) {
          const slope = -sign * Math.atan2(b.height, b.ramp);
          part(rampLen, 0.8, b.width, 0xc4c8cd, sign * (b.half + b.ramp / 2), b.height / 2 - 0.5, 0).rotation.z = slope;
          for (const t of [0.3, 0.6]) {
            const along = sign * (b.half + b.ramp * t);
            const h = b.height * (1 - t) - 0.8;
            if (h < 1.2) continue;
            for (const side of [-1, 1]) {
              // Pas de pile sur une chaussée qui passe sous la rampe
              const [wx, wz] = bridgePoint(b, along, side * (b.width / 2 - 1.5));
              if (this.groundRoadAt(wx, wz, 0.6)) continue;
              const col = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.4, 0.5, h, 12)), this.mats.color(concrete));
              col.position.set(along, h / 2, side * (b.width / 2 - 1.5));
              col.castShadow = this.profile.shadows;
              col.userData.venueId = v.id;
              flyover.add(col);
            }
          }
        }
        // Glissières en béton (type GBA) et main courante métallique, sur le tablier et le long des rampes
        for (const side of [-1, 1]) {
          const z = side * (b.width / 2 - 0.2);
          part(b.half * 2, 0.85, 0.4, 0xebe8e1, 0, b.height + 0.42, z);
          part(b.half * 2, 0.08, 0.08, 0x8d949c, 0, b.height + 1.05, z);
          for (const sign of [-1, 1]) {
            const slope = -sign * Math.atan2(b.height, b.ramp);
            part(rampLen, 0.85, 0.4, 0xebe8e1, sign * (b.half + b.ramp / 2), b.height / 2 + 0.42, z).rotation.z = slope;
            part(rampLen, 0.08, 0.08, 0x8d949c, sign * (b.half + b.ramp / 2), b.height / 2 + 1.05, z).rotation.z = slope;
          }
          // Lignes de rive blanches sur le tablier et les rampes
          part(b.half * 2, 0.02, 0.18, 0xffffff, 0, b.height + 0.06, side * 2.6);
          for (const sign of [-1, 1]) {
            const slope = -sign * Math.atan2(b.height, b.ramp);
            part(rampLen, 0.02, 0.18, 0xffffff, sign * (b.half + b.ramp / 2), b.height / 2 + 0.06, side * 2.6).rotation.z = slope;
          }
        }
        // Lampadaires à bras, en quinconce, sur la glissière ; lampe allumée la nuit
        const lampMat = new THREE.MeshLambertMaterial({ color: 0xfff4d6, emissive: 0xffd27a, emissiveIntensity: 0 });
        this.nightMaterials.push(lampMat);
        const lampAt = (lx: number, y0: number, side: number) => {
          const z = side * (b.width / 2 - 0.2);
          part(0.16, 5, 0.16, 0x6f7781, lx, y0 + 2.5, z);
          part(0.12, 0.12, 1.8, 0x6f7781, lx, y0 + 5, z - side * 0.9);
          const head = this.box(0.7, 0.14, 0.32, 0, 0, 0, 0, false);
          head.material = lampMat;
          head.position.set(lx, y0 + 4.92, z - side * 1.7);
          head.userData.venueId = v.id;
          flyover.add(head);
        };
        for (const [i, lx] of [-b.half + 2, -b.half / 3, b.half / 3, b.half - 2].entries()) lampAt(lx, b.height + 0.85, i % 2 ? 1 : -1);
        for (const sign of [-1, 1]) {
          const along = b.half + b.ramp * 0.5;
          lampAt(sign * along, b.height * 0.5 + 0.85, sign);
        }
        break;
      }
      case 'carrefour_deux_lions':
      case 'colombe_paix': {
        // Rond-point au croisement de deux routes : anneau de chaussée, îlot fleuri, bordure, monument au centre
        const lions = v.id === 'carrefour_deux_lions';
        const cx = lions ? DEUX_LIONS_X : COLOMBE_X;
        const cz = lions ? DEUX_LIONS_Z : COLOMBE_Z;
        const R = lions ? 9 : COLOMBE_RING;
        const I = lions ? 4.2 : COLOMBE_ISLAND;
        const ring = new THREE.Mesh(this.geo(new THREE.RingGeometry(I, R, 40)), this.mats.color(C.road));
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(cx, 0.035, cz);
        const island = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(I, I, 0.35, 32)), this.mats.color(0xbfdc9c));
        island.position.set(cx, 0.18, cz);
        const kerb = new THREE.Mesh(this.geo(new THREE.TorusGeometry(I, 0.18, 6, 32)), this.mats.color(0xffffff));
        kerb.rotation.x = -Math.PI / 2;
        kerb.position.set(cx, 0.36, cz);
        // Le monument occupe l'îlot : on n'y ajoute pas de palmier
        this.roundaboutDecor(cx, cz, R, I, false);
        this.scene.add(ring, island, kerb);
        this.solid(cx, cz, I * 1.6, I * 1.6);
        for (const [dx, dz] of [[1.6, 1.6], [-1.6, -1.6], [1.6, -1.6], [-1.6, 1.6]] as const) this.box(0.9, 0.4, 0.9, 0xf18f01, cx + dx * (I / 3.2), 0.5, cz + dz * (I / 3.2), false);
        if (lions) {
          // Monument réel : deux lions dorés debout, adossés et tournés vers l'extérieur,
          // reprenant les supports des armoiries togolaises avec arcs et flèches.
          const plinth = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(2.35, 2.7, 0.9, 16)), this.mats.color(0xe9e4d8));
          plinth.position.set(cx, 0.7, cz);
          plinth.castShadow = this.profile.shadows;
          this.scene.add(plinth);
          for (const sgn of [-1, 1]) {
            const lx = cx + sgn * 0.72;
            this.box(0.95, 2.25, 0.9, 0xc9a227, lx, 2.5, cz, false);
            for (const dz of [-0.28, 0.28]) this.box(0.3, 1.55, 0.3, 0xb8901c, lx + sgn * 0.1, 1.45, cz + dz, false);
            const mane = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.72, 12, 9)), this.mats.color(0xb8901c));
            mane.scale.set(0.8, 1, 1);
            mane.position.set(cx + sgn * 1.02, 4.05, cz);
            this.scene.add(mane);
            this.box(0.58, 0.5, 0.58, 0xd0ad2e, cx + sgn * 1.58, 4.08, cz, false);
            for (const dz of [-0.34, 0.34]) {
              const arm = this.box(0.28, 1.75, 0.28, 0xc9a227, cx + sgn * 1.15, 2.95, cz + dz, false);
              arm.rotation.z = sgn * -0.28;
            }
            const bow = new THREE.Mesh(this.geo(new THREE.TorusGeometry(0.72, 0.08, 6, 16, Math.PI)), this.mats.color(0x79551a));
            bow.rotation.set(0, Math.PI / 2, sgn > 0 ? Math.PI / 2 : -Math.PI / 2);
            bow.position.set(cx + sgn * 1.82, 3.05, cz);
            this.scene.add(bow);
            this.box(0.08, 1.75, 0.08, 0x79551a, cx + sgn * 1.82, 3.05, cz, false);
          }
          // Les deux bassins sont au nord du monument, de part et d'autre de la quatrième voie.
          // Le bassin occidental est plus long ; l'axe nord passe dans l'intervalle central.
          for (const [bx, bz, bw, bd] of [[cx - 14, cz - 17, 10, 20], [cx + 14, cz - 14, 11, 14]] as const) {
            this.box(bw, 0.07, bd, 0x4a91b8, bx, 0.025, bz, false);
            this.box(bw + 0.7, 0.14, 0.35, 0xb7b1a5, bx, 0.09, bz - bd / 2 - 0.25, false);
            this.box(bw + 0.7, 0.14, 0.35, 0xb7b1a5, bx, 0.09, bz + bd / 2 + 0.25, false);
            this.box(0.35, 0.14, bd, 0xb7b1a5, bx - bw / 2 - 0.25, 0.09, bz, false);
            this.box(0.35, 0.14, bd, 0xb7b1a5, bx + bw / 2 + 0.25, 0.09, bz, false);
          }
        } else {
          // Monument réel : quatre arches courbes portent un globe, surmonté d'une grande
          // colombe blanche aux ailes déployées avec un rameau dans le bec.
          const stone = this.mats.color(0xf2f0e9);
          const paleStone = this.mats.color(0xd9d8d1);
          const plinth = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(2.65, 2.9, 0.42, 32)), paleStone);
          plinth.position.set(cx, 0.48, cz);
          plinth.castShadow = this.profile.shadows;
          this.scene.add(plinth);
          for (let k = 0; k < 4; k++) {
            const a = k * Math.PI / 2 + Math.PI / 4;
            const ux = Math.cos(a);
            const uz = Math.sin(a);
            const curve = new THREE.QuadraticBezierCurve3(
              new THREE.Vector3(cx + ux * 2.25, 0.65, cz + uz * 2.25),
              new THREE.Vector3(cx + ux * 1.7, 3.55, cz + uz * 1.7),
              new THREE.Vector3(cx + ux * 0.58, 5.75, cz + uz * 0.58),
            );
            const arch = new THREE.Mesh(this.geo(new THREE.TubeGeometry(curve, 10, 0.3, 7, false)), stone);
            arch.castShadow = this.profile.shadows;
            this.scene.add(arch);
          }
          const globe = new THREE.Mesh(this.geo(new THREE.SphereGeometry(1.42, 20, 14)), stone);
          globe.position.set(cx, 6.55, cz);
          globe.castShadow = this.profile.shadows;
          this.scene.add(globe);
          // Cercles discrets du globe, visibles sans multiplier les polygones.
          for (const ry of [0, Math.PI / 2]) {
            const meridian = new THREE.Mesh(this.geo(new THREE.TorusGeometry(1.44, 0.035, 5, 28)), paleStone);
            meridian.position.copy(globe.position);
            meridian.rotation.y = ry;
            this.scene.add(meridian);
          }
          const equator = new THREE.Mesh(this.geo(new THREE.TorusGeometry(1.44, 0.035, 5, 28)), paleStone);
          equator.position.copy(globe.position);
          equator.rotation.x = Math.PI / 2;
          this.scene.add(equator);

          const body = new THREE.Mesh(this.geo(new THREE.SphereGeometry(1, 16, 10)), stone);
          body.scale.set(0.48, 0.42, 1.08);
          body.position.set(cx, 8.3, cz + 0.05);
          body.rotation.x = -0.16;
          body.castShadow = this.profile.shadows;
          const head = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.38, 14, 9)), stone);
          head.position.set(cx, 8.63, cz + 0.88);
          head.castShadow = this.profile.shadows;
          const beak = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.13, 0.48, 8)), this.mats.color(0xc9a227));
          beak.rotation.x = Math.PI / 2;
          beak.position.set(cx, 8.62, cz + 1.27);
          for (const ex of [-0.27, 0.27]) {
            const eye = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.055, 7, 5)), this.mats.color(0x202020));
            eye.position.set(cx + ex, 8.73, cz + 1.11);
            this.scene.add(eye);
          }
          // Silhouette continue des ailes, plus proche de la sculpture que les anciens parallélépipèdes.
          const wingShape = new THREE.Shape();
          wingShape.moveTo(-0.15, 0);
          wingShape.lineTo(-1.05, 0.7);
          wingShape.lineTo(-2.05, 1.75);
          wingShape.lineTo(-2.65, 1.2);
          wingShape.lineTo(-3.15, 0.45);
          wingShape.lineTo(-2.25, 0.62);
          wingShape.lineTo(-1.15, 0.25);
          wingShape.lineTo(0, -0.12);
          wingShape.lineTo(1.15, 0.25);
          wingShape.lineTo(2.25, 0.62);
          wingShape.lineTo(3.15, 0.45);
          wingShape.lineTo(2.65, 1.2);
          wingShape.lineTo(2.05, 1.75);
          wingShape.lineTo(1.05, 0.7);
          wingShape.closePath();
          const wings = new THREE.Mesh(this.geo(new THREE.ExtrudeGeometry(wingShape, { depth: 0.18, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 1 })), stone);
          wings.position.set(cx, 8.35, cz - 0.1);
          wings.castShadow = this.profile.shadows;
          const branch = this.box(1.15, 0.055, 0.055, 0x477a3a, cx + 0.42, 8.5, cz + 1.49, false);
          branch.rotation.z = -0.18;
          for (const [dx, dy] of [[0.12, 0.08], [0.38, -0.05], [0.66, 0.07], [0.88, -0.04]] as const) {
            const leaf = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.1, 7, 5)), this.mats.color(0x5f934e));
            leaf.scale.set(1.8, 0.55, 0.5);
            leaf.position.set(cx + dx, 8.5 + dy, cz + 1.49);
            this.scene.add(leaf);
          }
          this.scene.add(body, head, beak, wings);
        }
        break;
      }
      case 'moov_africa': {
        // Direction générale de Moov Africa Togo (photos) : immeuble de quatre niveaux habillé de dalles vert-gris ; à gauche un bloc étroit
        // sous le grand panneau blanc au logo ; au centre, des balcons en retrait à garde-corps sombres sous un bandeau orange
        // « DIRECTION GÉNÉRALE » ; un bandeau bleu « Moov Africa » coiffe l'entrée à perron ; à droite un bloc de fenêtres à cadre crème ;
        // mât télécom et cadre publicitaire sur le toit, panneau d'affichage à gauche, barrière orange.
        const mkTex = (draw: (g: CanvasRenderingContext2D) => void, w: number, h: number, rep?: [number, number]): THREE.CanvasTexture => {
          const c = document.createElement('canvas');
          c.width = w;
          c.height = h;
          const g = c.getContext('2d');
          if (g) draw(g);
          const t = new THREE.CanvasTexture(c);
          t.colorSpace = THREE.SRGBColorSpace;
          if (rep) {
            t.wrapS = THREE.RepeatWrapping;
            t.wrapT = THREE.RepeatWrapping;
            t.repeat.set(rep[0], rep[1]);
          }
          this.mats.textures.push(t);
          return t;
        };
        const cladTex = mkTex((g) => {
          g.fillStyle = '#c4c9b8';
          g.fillRect(0, 0, 64, 64);
          g.strokeStyle = '#a9af9c';
          g.lineWidth = 2;
          g.strokeRect(0, 0, 64, 64);
          g.beginPath(); g.moveTo(32, 0); g.lineTo(32, 64); g.moveTo(0, 32); g.lineTo(64, 32); g.stroke();
        }, 64, 64, [4, 4]);
        const clad = new THREE.MeshLambertMaterial({ map: cladTex });
        const paneMat = new THREE.MeshLambertMaterial({ color: 0x3d4a58, emissive: 0xffd27a, emissiveIntensity: 0 });
        this.nightMaterials.push(paneMat);
        this.nightScale.set(paneMat, 0.28);
        const ORANGE = 0xf28a1a;
        const BLUE = 0x1b4fd3;
        const cream = 0xe9dfc2;
        const windowAt = (wx: number, wy: number, wz: number, ww = 1.5, wh = 1.9) => {
          this.box(ww + 0.25, wh + 0.25, 0.1, cream, wx, wy, wz, false);
          const pane = new THREE.Mesh(this.geo(new THREE.BoxGeometry(ww * 0.82, wh * 0.84, 0.1)), paneMat);
          pane.position.set(wx, wy, wz + 0.04);
          this.scene.add(pane);
          this.box(0.07, wh, 0.12, cream, wx, wy, wz + 0.05, false);
        };
        this.box(25, 0.15, 14, 0xe4dfd2, x, 0.08, z + 0.5, false);
        // Bloc gauche, haut et étroit, et bloc droit : dalles vert-gris
        const left = this.box(5.6, 14.4, 7, 0xffffff, x - 8.6, 7.2, z - 3);
        left.material = clad;
        const right = this.box(7.2, 14.4, 7, 0xffffff, x + 8.2, 7.2, z - 3);
        right.material = clad;
        this.solid(x, z - 3, 22, 7);
        this.box(5.8, 0.5, 7.2, 0xdcdfd2, x - 8.6, 14.6, z - 3, false);
        this.box(7.4, 0.5, 7.2, 0xdcdfd2, x + 8.2, 14.6, z - 3, false);
        for (let f = 0; f < 4; f++) {
          for (const dx of [-9.5, -7.7]) windowAt(x + dx, 2.4 + f * 3.4, z + 0.55, 0.95, 2.4);
          for (const dx of [6.2, 9.8]) windowAt(x + dx, 2.4 + f * 3.4, z + 0.55, 1.9, 2.1);
        }
        // Grand panneau blanc au logo, sur le bloc gauche
        const logoTex = mkTex((g) => {
          g.fillStyle = '#ffffff';
          g.fillRect(0, 0, 512, 256);
          // Croissant orange qui part du bas à gauche, passe sous le nom et remonte vers le losange
          g.fillStyle = '#ff7a1a';
          g.beginPath();
          g.moveTo(20, 215);
          g.bezierCurveTo(150, 250, 380, 240, 430, 150);
          g.bezierCurveTo(440, 110, 430, 80, 410, 60);
          g.bezierCurveTo(430, 110, 400, 170, 330, 200);
          g.bezierCurveTo(230, 235, 110, 232, 20, 215);
          g.fill();
          g.beginPath();
          g.moveTo(150, 40);
          g.bezierCurveTo(260, 10, 360, 30, 420, 70);
          g.bezierCurveTo(350, 45, 260, 40, 150, 40);
          g.fill();
          g.fillStyle = '#1b4fd3';
          g.font = '900 84px sans-serif';
          g.fillText('Moov', 60, 120, 300);
          g.fillText('Africa', 60, 195, 300);
          // Losange blanc cerné d'orange, marqué d'une croix
          g.fillStyle = '#ff7a1a';
          g.beginPath(); g.moveTo(420, 62); g.lineTo(478, 120); g.lineTo(420, 178); g.lineTo(362, 120); g.closePath(); g.fill();
          g.fillStyle = '#ffffff';
          g.beginPath(); g.moveTo(420, 90); g.lineTo(450, 120); g.lineTo(420, 150); g.lineTo(390, 120); g.closePath(); g.fill();
        }, 512, 256);
        const logoPanel = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(5.6, 2.8)), new THREE.MeshBasicMaterial({ map: logoTex, toneMapped: false }));
        logoPanel.position.set(x - 8.6, 16.2, z + 0.55);
        this.scene.add(logoPanel);
        this.box(5.8, 3, 0.3, 0xf2f2ee, x - 8.6, 16.2, z + 0.35, false);
        // Centre en retrait : fond de dalles, trois niveaux de balcons à garde-corps sombres, colonnes blanches
        const core = this.box(10.2, 14.4, 2.2, 0xffffff, x, 7.2, z - 5.6);
        core.material = clad;
        for (const f of [0, 1, 2]) {
          const slabY = 4.4 + f * 3.4;
          this.box(10.4, 0.45, 3.6, 0xd7d9d0, x, slabY, z - 2.5, false);
          this.box(10.4, 1.0, 0.1, 0x2d3338, x, slabY + 0.7, z - 0.75, false);
          for (let k = 0; k < 14; k++) this.box(0.06, 1.0, 0.08, 0x2d3338, x - 4.8 + k * 0.74, slabY + 0.7, z - 0.72, false);
          for (const wx of [-3.4, -0.4, 2.8]) windowAt(x + wx, slabY - 1.6, z - 4.4, 2, 2);
        }
        for (const cx of [-2.2, 1.6]) this.box(0.4, 14, 0.4, 0xeceae2, x + cx, 7, z - 0.8, false);
        // Bandeau orange « DIRECTION GÉNÉRALE » sur le dernier niveau, et bandeau bleu « Moov Africa » au-dessus de l'entrée
        const dgTex = mkTex((g) => {
          g.fillStyle = '#f28a1a';
          g.fillRect(0, 0, 1024, 160);
          g.fillStyle = '#ffffff';
          g.font = '800 104px sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText('DIRECTION GÉNÉRALE', 512, 84, 980);
        }, 1024, 160);
        const dg = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(10.4, 1.62)), new THREE.MeshBasicMaterial({ map: dgTex, toneMapped: false }));
        dg.position.set(x, 13.5, z - 0.62);
        this.scene.add(dg);
        this.box(10.6, 1.9, 0.5, ORANGE, x, 13.5, z - 0.9, false);
        const mvTex = this.animCanvas(1024, 140, (g, t) => this.drawMoov(g, t, 1024, 140, true));
        const mv = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(10.4, 1.42)), new THREE.MeshBasicMaterial({ map: mvTex, toneMapped: false }));
        mv.position.set(x, 3.7, z - 0.18);
        this.scene.add(mv);
        this.box(10.6, 1.6, 0.45, BLUE, x, 3.7, z - 0.45, false);
        // Entrée : portes vitrées aux affiches bleues et orange, perron à trois volées de marches, barrière orange
        for (const dx of [-1.1, 1.1]) this.box(1.9, 2.8, 0.14, BLUE, x + dx, 1.5, z - 4.42, false);
        this.box(0.35, 0.9, 0.05, ORANGE, x - 1.1, 1.5, z - 4.33, false);
        this.box(0.35, 0.9, 0.05, ORANGE, x + 1.1, 1.5, z - 4.33, false);
        for (let k = 0; k < 4; k++) this.box(8.4 - k * 0.5, 0.22, 0.7, k % 2 ? 0xe5e1d4 : 0xd8d3c4, x, 0.12 + k * 0.17, z + 0.1 - k * 0.65, false);
        this.box(3.2, 1.1, 0.14, ORANGE, x + 9.2, 0.65, z + 2.3, false);
        for (const bx of [7.7, 10.7]) this.box(0.12, 1.1, 0.12, ORANGE, x + bx, 0.55, z + 2.3, false);
        // Mât d'éclairage avec petit panneau blanc, panneau d'affichage à gauche
        this.box(0.18, 6, 0.18, 0xc8ccd2, x + 0.9, 3, z + 2.6, false);
        this.box(1.4, 1.1, 0.12, 0xf4f4ee, x + 0.9, 5.8, z + 2.6, false);
        // Écran d'accueil : le logo Moov Africa sur fond bleu (texte blanc, croissant orange, losange blanc à croix)
        const screenTex = this.animCanvas(500, 333, (g, t) => this.drawMoov(g, t, 500, 333, false));
        const poster = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(3.6, 2.4)), new THREE.MeshBasicMaterial({ map: screenTex, toneMapped: false }));
        poster.position.set(x - 5.6, 1.9, z + 5.4);
        poster.rotation.y = 0.25;
        this.scene.add(poster);
        this.box(3.9, 2.7, 0.15, 0x2d3338, x - 5.6, 1.9, z + 5.3, false).rotation.y = 0.25;
        for (const lx of [-1.4, 1.4]) this.box(0.18, 0.8, 0.18, 0x2d3338, x - 5.6 + lx, 0.4, z + 5.3, false);
        // Toit : cadre publicitaire vide et mât télécom à lattis
        this.box(8, 5.5, 0.4, 0xb8b5ab, x + 1, 17.4, z - 6.4, false);
        this.box(0.5, 12, 0.5, 0xd7dadc, x + 9.5, 20.4, z - 4.5, false);
        for (let k = 0; k < 6; k++) this.box(1.6 - k * 0.14, 0.12, 0.12, 0xd7dadc, x + 9.5, 15.8 + k * 1.8, z - 4.5, false);
        break;
      }
      case 'akodessewa': {
        // Marché des féticheurs d'Akodessewa : plein air sur terre battue, deux rangées d'étals sous toiles, allée centrale,
        // grand fétiche de bois au milieu (crânes, étoffe rouge), enseigne à l'entrée et marchands.
        this.box(20, 0.1, 13, 0xb08a5c, x, 0.05, z - 1, false);
        this.box(20.4, 0.14, 0.3, 0x7a5a36, x, 0.07, z + 5.6, false);
        for (let i = 0; i < 4; i++) this.fetishStall(x - 7.2 + i * 4.8, z - 4.6, 700 + i);
        for (let i = 0; i < 4; i++) this.fetishStall(x - 7.2 + i * 4.8, z + 2.4, 710 + i);
        this.solid(x, z - 4.6, 20, 1.8);
        this.solid(x, z + 2.4, 20, 1.8);
        // Fétiche central : socle, figure sculptée, étoffe rouge, crânes à la base et plumes
        this.box(1.6, 0.4, 1.6, 0x6b4a2f, x, 0.2, z - 1, false);
        this.box(0.55, 1.5, 0.5, 0x4a3320, x, 1.15, z - 1);
        this.box(0.7, 0.7, 0.12, 0xb2282b, x, 1.0, z - 0.72, false);
        const head = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.34, 8, 6)), this.mats.color(0x3d2a1a));
        head.position.set(x, 2.2, z - 1);
        this.scene.add(head);
        for (const dx of [-0.12, 0.12]) this.box(0.08, 0.08, 0.05, 0xf1ead8, x + dx, 2.28, z - 0.68, false);
        for (let i = 0; i < 5; i++) this.box(0.07, 0.5, 0.04, [0xe5383b, 0xffce00, 0x22a861][i % 3]!, x - 0.24 + i * 0.12, 2.65, z - 1, false).rotation.z = (i - 2) * 0.12;
        const bone = this.mats.color(0xe8e0cf);
        for (let i = 0; i < 6; i++) {
          const sk = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.14, 6, 5)), bone);
          sk.position.set(x - 0.6 + (i % 3) * 0.6, 0.5, z - 0.4 + Math.floor(i / 3) * 0.5);
          this.scene.add(sk);
        }
        this.solid(x, z - 1, 1.6, 1.6);
        const label = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(10, 1.1)), new THREE.MeshBasicMaterial({ map: this.posterTexture('MARCHÉ D’AKODESSEWA', 'FÉTICHES • HERBES • AMULETTES', '#4a2410', '#ffe9b8', 768, 96) }));
        label.position.set(x, 3.4, z + 5.9);
        this.box(0.2, 3.4, 0.2, 0x4a3320, x - 4.8, 1.7, z + 5.9, false);
        this.box(0.2, 3.4, 0.2, 0x4a3320, x + 4.8, 1.7, z + 5.9, false);
        this.scene.add(label);
        for (const [dx, dz, rot, seed] of [[-5, -1.2, Math.PI / 2, 731], [5, -1.2, -Math.PI / 2, 732], [-2.4, 4.6, Math.PI, 733]] as const) this.marketSeller(x + dx, z + dz, rot, seed);
        break;
      }
      case 'marche_hedzranawoe':
      case 'marche_agoe': {
        // Marchés de quartier : longues halles ventilées et allée centrale encombrée d'étals.
        const clothes = v.id === 'marche_hedzranawoe';
        this.box(34, 0.12, 22, 0x9a9489, x, 0.06, z - 2, false);
        for (const dx of [-8, 8]) {
          const roof = this.box(13.8, 0.32, 9.5, dx < 0 ? 0x7c8790 : 0x929ca4, x + dx, 4.15, z - 5, false);
          roof.rotation.z = dx < 0 ? -0.035 : 0.035;
          for (const px of [-6, 6]) for (const pz of [-4, 4]) this.box(0.2, 4, 0.2, 0x5b6b7f, x + dx + px, 2, z - 5 + pz, false);
          this.box(12, 0.25, 7, 0xd9c7a3, x + dx, 0.13, z - 5, false);
          // Comptoirs alignés sous les hangars ; Hédzranawoé montre davantage de friperie.
          for (let i = 0; i < 3; i++) this.marketStall(x + dx - 4 + i * 4, z - 5, [0xe5383b, 0xffce00, 0x22a861, 0x1f6feb][(i + (dx > 0 ? 1 : 0)) % 4]!, 410 + i + (dx > 0 ? 8 : 0), clothes);
        }
        this.solid(x, z - 5, 30, 10);
        const cols = [0xe5383b, 0xffce00, 0x22a861, 0x1f6feb, 0xf18f01];
        for (let i = 0; i < 6; i++) {
          this.marketStall(x - 12 + i * 4.8, z + 3.3, cols[i % cols.length]!, 520 + i, clothes && i % 2 === 0);
        }
        // Agoè-Assiyéyé garde l'aspect du site provisoire de Togo Grain ; Hédzranawoé son allée de friperie.
        const label = clothes ? 'MARCHÉ HÉDZRANAWOÉ' : 'MARCHÉ AGOÈ-ASSIYÉYÉ';
        const sign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(12, 1.2)), new THREE.MeshBasicMaterial({ map: this.posterTexture(label, clothes ? 'FRIPERIE • VIVRES' : 'SITE TOGO GRAIN', '#17603a', '#ffffff', 768, 96) }));
        sign.position.set(x, 5.1, z + 5.2);
        this.scene.add(sign);
        for (const [dx, dz, rot, seed] of [[-9, 1.7, 0, 601], [0, 1.7, Math.PI, 602], [9, 1.7, 0, 603]] as const) this.marketSeller(x + dx, z + dz, rot, seed + (clothes ? 20 : 0));
        break;
      }
      case 'chu_campus': {
        // Plan schématique de l'ensemble pavillonnaire : axe nord–sud, ailes
        // côté campus, desserte à l'est et entrée au nord-est depuis Eyadéma.
        this.box(7.4, 0.1, 24, 0xd8dfcb, x, 0.05, z, false);
        this.box(1.5, 0.04, 21, 0xaaa397, x + 2.6, 0.12, z, false);
        this.box(4, 0.04, 2, 0xaaa397, x + 1.7, 0.12, z - 10, false);
        // Raccord oblique : ne pas faire déboucher une façade sur la chaussée.
        const access = this.box(1.8, 0.04, 4.6, 0xaaa397, x + 4.4, 0.12, z - 11, false);
        access.rotation.y = -Math.PI / 4;
        const pavilion = (dx: number, dz: number, w: number, d: number, h: number) => {
          this.box(w, h, d, 0xf3efe6, x + dx, h / 2, z + dz);
          this.solid(x + dx, z + dz, w, d);
          this.box(w + 0.12, 0.18, d + 0.12, 0x8c9c8e, x + dx, h + 0.09, z + dz, false);
          for (const side of [-1, 1]) this.box(w * 0.7, 0.5, 0.04, 0x7194a5, x + dx, h * 0.6, z + dz + side * (d / 2 + 0.025), false);
        };
        pavilion(0, 1, 1.1, 19, 2.2);
        for (const dz of [-6, 1, 8]) {
          // Deux ailes et une cour entre elles autour de chaque noyau.
          pavilion(-1.7, dz - 1.8, 3.2, 1.3, 2.4);
          pavilion(-1.7, dz + 1.8, 3.2, 1.3, 2.4);
          const roof = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.95, 0.95, 0.2, 8)), this.mats.color(0x8c9c8e));
          roof.position.set(x, 2.6, z + dz);
          this.scene.add(roof);
          this.box(0.7, 0.08, 1.8, 0xbfdc9c, x - 2, 0.13, z + dz, false);
        }
        pavilion(1.2, -6.8, 1.1, 2.6, 1.8);
        pavilion(1.2, 4.5, 1.1, 2.6, 1.8);
        // Limites basses, avec une ouverture réelle au nord-est pour l'arrivée.
        for (const [dx, dz, w, d] of [[-3.6, 0, 0.15, 24], [0, 11.9, 7.2, 0.15], [0, -11.9, 7.2, 0.15], [3.6, 1.5, 0.15, 20.8]] as const) {
          this.box(w, 0.45, d, 0xe1d9c9, x + dx, 0.225, z + dz);
          this.solid(x + dx, z + dz, w, d);
        }
        this.box(0.16, 1.6, 0.16, 0xeeeeea, x + 3.5, 0.8, z - 8.6, false);
        this.box(0.12, 0.85, 0.25, 0xe5383b, x + 3.5, 1.6, z - 8.6, false);
        this.box(0.12, 0.25, 0.85, 0xe5383b, x + 3.5, 1.6, z - 8.6, false);
        break;
      }
      case 'chu':
        this.building(x, z - 4, 18, 10, 9, 0xffffff, 0x22a861);
        this.box(0.6, 3, 0.3, 0xe5383b, x, 11, z + 1.2, false);
        this.box(3, 0.6, 0.3, 0xe5383b, x, 11, z + 1.2, false);
        break;
      case 'universite':
        this.building(x - 8, z - 6, 12, 9, 10, 0xf3efe6, 0x1f6feb);
        this.building(x + 8, z - 6, 12, 9, 7, 0xfdf3dc, 0x1f6feb);
        this.box(28, 0.15, 10, 0xbfdc9c, x, 0.08, z + 6, false);
        break;
      case 'station_oryx':
      case 'station_total':
      case 'station_lome2':
      case 'station_boulevard': {
        // Station Zener : deux ombrelles pyramidales (bleue et verte) sur un fût central, îlots de pompes à bordures rouges et blanches,
        // boutique bleue à liseré vert (enseigne Bonici), totem du logo et des prix, point de gaz domestique SODIGAZ en bleu
        const BLUE = 0x1b4fa3;
        const GREEN = 0x3aa535;
        const glass = this.litGlass();
        this.box(30, 0.1, 22, 0xb9bcc0, x, 0.05, z, false);
        // Boutique au fond : corps blanc cassé, soubassement bleu, liseré vert-jaune, enseigne Bonici
        this.box(12, 3.6, 5, 0xd9dcdf, x - 7, 1.8, z - 7);
        this.solid(x - 7, z - 7, 12, 5);
        this.box(12.1, 1.1, 5.1, BLUE, x - 7, 0.55, z - 7, false);
        this.box(12.2, 0.2, 5.2, 0xb7d82b, x - 7, 3.15, z - 7, false);
        this.box(12.3, 0.4, 5.3, BLUE, x - 7, 3.75, z - 7, false);
        // Grande vitrine encadrée de bleu et de vert, logo sur le mur à gauche
        this.box(7.4, 2.5, 0.12, BLUE, x - 6.2, 1.5, z - 4.46, false);
        this.box(7.4, 0.3, 0.16, GREEN, x - 6.2, 2.9, z - 4.44, false);
        const shop = new THREE.Mesh(this.geo(new THREE.BoxGeometry(7, 2, 0.1)), glass);
        shop.position.set(x - 6.2, 1.4, z - 4.38);
        this.scene.add(shop);
        const wall = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(2.6, 2.6)), new THREE.MeshBasicMaterial({ map: this.zenerLogo(), toneMapped: false }));
        wall.position.set(x - 11.5, 2.15, z - 4.46);
        this.scene.add(wall);
        const bonici = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(3.4, 0.8)), new THREE.MeshBasicMaterial({ map: this.posterTexture('Bonici', '', '#14171c', '#ffffff', 256, 60) }));
        bonici.position.set(x - 6.2, 3.35, z - 4.4);
        this.scene.add(bonici);
        // Ombrelles : un fût, un dessous en pyramide inversée, un dessus plat ; plaques lumineuses sous le dessus
        const umbrella = (cx: number, color: number): void => {
          // Fût au centre de l'ombrelle, sur un socle ; les pompes sont de part et d'autre
          this.box(1.1, 0.3, 1.1, 0xdfe2e5, cx, 0.15, z + 1.8, false);
          this.box(0.7, 4.9, 0.7, color, cx, 2.45, z + 1.8);
          this.solid(cx, z + 1.8, 0.9, 0.9);
          const rim = new THREE.Mesh(this.geo(new THREE.ConeGeometry(6.2, 0.75, 4)), this.mats.color(color));
          rim.rotation.set(Math.PI, Math.PI / 4, 0);
          rim.position.set(cx, 5.18, z + 1.8);
          rim.scale.set(1, 1, 0.8);
          this.scene.add(rim);
          // Plaques lumineuses en losange collées au dessous en pente : deux de chaque côté du fût, comme sur les photos
          const lamp = new THREE.MeshBasicMaterial({ color: 0xfff8e0 });
          const slopeX = Math.atan(0.75 / 4.38);
          const slopeZ = Math.atan(0.75 / 3.5);
          for (const [ax, d] of [['x', -3.1], ['x', -1.7], ['x', 1.7], ['x', 3.1], ['z', -2.5], ['z', -1.4], ['z', 1.4], ['z', 2.5]] as const) {
            const half = ax === 'x' ? 4.38 : 3.5;
            const holder = new THREE.Group();
            holder.position.set(ax === 'x' ? cx + d : cx, 4.8 + (0.75 * Math.abs(d)) / half - 0.04, ax === 'x' ? z + 1.8 : z + 1.8 + d);
            if (ax === 'x') holder.rotation.z = Math.sign(d) * slopeX;
            else holder.rotation.x = -Math.sign(d) * slopeZ;
            const pan = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.75, 0.04, 0.75)), lamp);
            pan.rotation.y = Math.PI / 4;
            holder.add(pan);
            this.scene.add(holder);
          }
        };
        umbrella(x + 3, BLUE);
        umbrella(x + 11, GREEN);
        // Éclairage de nuit sous les ombrelles : la piste, les pompes et le véhicule restent bien visibles
        const pl = new THREE.PointLight(0xfff0d0, 0, 26, 1.6);
        pl.position.set(x + 7, 4.3, z + 2.4);
        this.scene.add(pl);
        this.pointLights.push(pl);
        // Îlots de pompes parallèles à la rue (axe x), fût de l'ombrelle au milieu : deux pompes de chaque côté du fût,
        // écrans sur les deux faces ; les véhicules se rangent le long de l'îlot
        for (const [cx, tone] of [[3, BLUE], [11, GREEN]] as const) {
          this.box(5.8, 0.25, 1.5, 0xcfd3d8, x + cx, 0.13, z + 1.8, false);
          for (let k = 0; k < 6; k++) this.box(0.97, 0.27, 1.52, k % 2 ? 0xf4f4f1 : 0xd42a2a, x + cx - 2.42 + k * 0.97, 0.14, z + 1.8, false);
          for (const px of [cx - 1.7, cx + 1.7]) {
            this.box(0.9, 1.8, 0.7, 0xf4f4f1, x + px, 1.05, z + 1.8);
            this.solid(x + px, z + 1.8, 1, 0.8);
            this.box(0.95, 0.4, 0.74, tone, x + px, 2.1, z + 1.8, false);
            for (const f of [-1, 1]) {
              this.box(0.5, 0.35, 0.05, 0x2fd07f, x + px, 1.6, z + 1.8 + f * 0.37, false);
              this.box(0.1, 0.9, 0.1, 0x222428, x + px + 0.55, 1.2, z + 1.8 + f * 0.3, false);
            }
          }
        }
        const totemFrom = this.scene.children.length;
        // Totem : haute dalle blanche, anneau Zener, « Self Service 24H/24 », panneau vert des prix (chiffres rouges), puis SODIGAZ et Bonici
        const tx = x + 14.2;
        const tz = z + 8.4;
        const face = tz + 0.27;
        const plane = (w: number, h: number, mat: THREE.Material, px: number, py: number, pz: number): void => {
          const m = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(w, h)), mat);
          m.position.set(px, py, pz);
          this.scene.add(m);
        };
        this.box(1.9, 9.4, 0.5, 0xf4f6f4, tx, 4.7, tz);
        this.box(0.14, 9.4, 0.52, 0x9aa1a8, tx + 0.98, 4.7, tz, false);
        plane(1.8, 1.8, new THREE.MeshBasicMaterial({ map: this.zenerLogo(), toneMapped: false }), tx, 8.25, face);
        plane(1.6, 0.34, new THREE.MeshBasicMaterial({ map: this.posterTexture('Self Service 24H/24 7J/7', '', '#f4f6f4', '#1b4fa3', 512, 110) }), tx, 6.95, face);
        this.box(1.65, 2.1, 0.12, GREEN, tx - 0.05, 5.9, face + 0.05, false);
        this.box(1.2, 1.5, 0.05, 0x11151a, tx, 5.85, face + 0.12, false);
        const led = new THREE.MeshBasicMaterial({ color: 0xff3b2a });
        for (let k = 0; k < 4; k++) {
          const row = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.5, 0.2, 0.02)), led);
          row.position.set(tx + 0.2, 6.35 - k * 0.38, face + 0.16);
          this.scene.add(row);
        }
        plane(1.7, 0.7, new THREE.MeshBasicMaterial({ map: this.posterTexture('SODIGAZ', 'Bonici · Bluen', '#ffffff', '#1b4fa3', 512, 210) }), tx, 4.2, face);
        this.box(1.5, 1.1, 0.05, 0xdbe4f2, tx, 2.5, face, false);
        this.box(2.8, 0.3, 1.5, 0xd42a2a, tx, 0.15, tz + 0.2, false);
        for (let k = 0; k < 4; k++) this.box(0.7, 0.32, 1.52, 0xf4f4f1, tx - 1.05 + k * 0.7, 0.16, tz + 0.2, false);
        this.box(2.0, 0.4, 0.6, 0x3a3d42, tx, 0.2, tz, false);
        // Le totem est perpendiculaire à la route (comme un vrai pylône de station) : ses faces regardent les automobilistes qui
        // arrivent de chaque sens. Tout ce qui est collé à sa face (logo, prix, SODIGAZ) est doublé sur le côté opposé.
        {
          const parts = this.scene.children.slice(totemFrom);
          const rotate = (o: THREE.Object3D, theta: number) => {
            const dx = o.position.x - tx;
            const dz = o.position.z - tz;
            o.position.x = tx + dx * Math.cos(theta) + dz * Math.sin(theta);
            o.position.z = tz - dx * Math.sin(theta) + dz * Math.cos(theta);
            o.rotation.y += theta;
          };
          const mirrors: THREE.Object3D[] = [];
          for (const o of parts) {
            if (o.position.z - tz > 0.15) {
              const m = o.clone();
              // Face opposée : symétrique par rapport à l'axe du totem, tournée d'un demi-tour
              m.position.x = 2 * tx - o.position.x;
              m.position.z = 2 * tz - o.position.z;
              m.rotation.y = o.rotation.y + Math.PI;
              mirrors.push(m);
            }
          }
          for (const m of mirrors) this.scene.add(m);
          for (const o of [...parts, ...mirrors]) rotate(o, Math.PI / 2);
        }
        // Point de gaz SODIGAZ (bleu) : cage grillagée, bouteilles de gaz alignées, enseigne
        const gx = x + 12;
        const gz = z - 8;
        this.box(5.6, 0.12, 3, 0xb0b4b8, gx, 0.06, gz, false);
        this.box(5.6, 0.12, 0.12, BLUE, gx, 2.1, gz - 1.5, false);
        this.box(5.6, 2.1, 0.08, 0x8da3c7, gx, 1.05, gz - 1.5, false);
        this.box(0.12, 2.1, 3, BLUE, gx - 2.8, 1.05, gz, false);
        this.box(0.12, 2.1, 3, BLUE, gx + 2.8, 1.05, gz, false);
        this.solid(gx, gz, 5.8, 3.2);
        const bottleG = this.geo(new THREE.CylinderGeometry(0.26, 0.26, 0.95, 10));
        for (let i = 0; i < 8; i++) {
          for (const row of [-0.5, 0.6]) {
            const bo = new THREE.Mesh(bottleG, this.mats.color(row < 0 ? 0x1f62c9 : 0x2f7de6));
            bo.position.set(gx - 2.1 + i * 0.6, 0.5, gz + row);
            this.scene.add(bo);
          }
        }
        const gaz = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(4.2, 0.9)), new THREE.MeshBasicMaterial({ map: this.posterTexture('SODIGAZ', '', '#1b4fa3', '#ffffff', 512, 110) }));
        gaz.position.set(gx, 2.55, gz - 1.4);
        this.scene.add(gaz);
        // Compresseur d'air et fût de lubrifiant sous l'ombrelle
        this.box(0.9, 1, 0.9, 0xd21034, x - 3.2, 0.5, z + 3.5, false);
        break;
      }
      case 'lavage_auto': {
        // Aire de lavage auto-moto à droite (à l'est) de la station Zener de Hédzranawoé, sur l'herbe libre entre la station
        // et l'aéroport. Tout tient dans 11 × 14 m (x de −5,5 à +5,5, z de −7 à +7) : rien ne déborde sur la station ni ailleurs.
        // Baie traversante sous un abri de tôle : la voiture du client entre côté rue (+z), s'arrête devant le laveur
        // et ressort au fond (−z). Mur carrelé à l'ouest avec robinets, nettoyeur haute pression, citerne sur pied,
        // seaux, bidons de savon, aspirateur, caniveau à grille ; une moto en lavage à côté ; enseigne et prix.
        // Décalé de 0,5 m vers l'est (coordonnées entières) : 1,5 m d'herbe reste entre la station et l'aire
        const X = x + 0.5;
        const cyl = (r: number, h: number, color: number, cx: number, cy: number, cz: number, seg = 12): THREE.Mesh => {
          const m = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(r, r, h, seg)), this.mats.color(color));
          m.position.set(cx, cy, cz);
          this.scene.add(m);
          return m;
        };
        const plate = (text: string, sub: string, w: number, h: number, px: number, py: number, pz: number, bg: string, fg: string) => {
          const tex = this.posterTexture(text, sub, bg, fg, 512, Math.round((512 * h) / w));
          const m = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(w, h)), new THREE.MeshBasicMaterial({ map: tex }));
          m.position.set(px, py, pz);
          this.scene.add(m);
        };
        const BLUE = 0x1d6fd6;
        // Dalle de lavage (un peu plus sombre et au-dessus de celle de la station), bordure jaune, caniveau à grille en travers
        this.box(11, 0.06, 14, 0x8c9297, X, 0.08, z, false);
        for (const bx of [-5.45, 5.45]) this.box(0.1, 0.07, 14, 0xf2c200, X + bx, 0.1, z, false);
        this.box(10.6, 0.04, 0.45, 0x3b4046, X, 0.12, z + 4.6, false);
        for (let i = 0; i < 11; i++) this.box(0.06, 0.05, 0.45, 0x8a9096, X - 5 + i, 0.14, z + 4.6, false);
        const puddle = new THREE.Mesh(this.geo(new THREE.CircleGeometry(1, 16)), new THREE.MeshBasicMaterial({ color: 0x4f6b80, transparent: true, opacity: 0.4 }));
        puddle.rotation.x = -Math.PI / 2;
        puddle.position.set(X - 1.2, 0.13, z + 2.8);
        this.scene.add(puddle);
        // Allée goudronnée de 3,6 m : de l'entrée nord de la baie jusqu'au bout de la voie d'accès (au nord-est, hors de l'aire)
        this.addStrip([[x - 0.6, z - 7], [x - 0.6, z - 9.5], [x + 10, z - 11]], 3.6, this.surface('#7d8693', 0.22, 'asphalt'), 0.03);
        // Abri : 4 poteaux aux coins (hors du passage des voitures), toit de tôle à nervures
        for (const px of [-5, 5]) for (const pz of [-4.2, 4.2]) {
          this.box(0.2, 3.6, 0.2, 0x5d646b, X + px, 1.8, z + pz);
          this.solid(X + px, z + pz, 0.3, 0.3);
        }
        const roofParts: THREE.Object3D[] = [this.box(10.8, 0.08, 9, 0xc8ccd0, X, 3.62, z, false)];
        for (let i = 0; i < 8; i++) roofParts.push(this.box(0.05, 0.06, 9, 0xa9aeb3, X - 5.1 + i * 1.46, 3.68, z, false));
        for (const o of roofParts) o.userData.seeThrough = true; // hors fusion des objets fixes (sa visibilité change)
        this.seeThroughRoofs.push({ parts: roofParts, x0: X - 5.4, x1: X + 5.4, z0: z - 4.5, z1: z + 4.5 });
        // Mur carrelé bleu à l'ouest, avec deux robinets
        this.box(0.25, 2.2, 8.4, BLUE, X - 5.25, 1.1, z);
        this.solid(X - 5.25, z, 0.4, 8.4);
        for (const pz of [-2, 2]) {
          this.box(0.3, 0.12, 0.12, 0xc9ccd0, X - 5, 1, z + pz, false);
          this.box(0.08, 0.08, 0.25, 0xd8282f, X - 4.9, 1.12, z + pz, false);
        }
        // Nettoyeur haute pression jaune contre le mur, tuyau noir jusqu'au laveur, lance posée
        this.box(0.5, 0.7, 0.7, 0xf2c200, X - 4.65, 0.47, z + 3.3);
        this.box(0.52, 0.14, 0.72, 0x2b2b2b, X - 4.65, 0.9, z + 3.3, false);
        this.solid(X - 4.65, z + 3.3, 0.6, 0.8);
        this.box(0.05, 0.05, 3.2, 0x1a1a1a, X - 4.2, 0.14, z + 1.5, false);
        this.box(3.6, 0.05, 0.05, 0x1a1a1a, X - 2.4, 0.14, z - 0.1, false);
        // Citerne d'eau noire sur pied métallique, au fond (coin nord-ouest), descente bleue vers le nettoyeur
        for (const [sx, sz] of [[-0.6, -0.6], [0.6, -0.6], [-0.6, 0.6], [0.6, 0.6]] as const) this.box(0.1, 2, 0.1, 0x6b6f73, X - 4.2 + sx, 1, z - 5.6 + sz);
        this.box(1.4, 0.1, 1.4, 0x6b6f73, X - 4.2, 2, z - 5.6, false);
        cyl(0.7, 1.4, 0x1c1c1c, X - 4.2, 2.75, z - 5.6, 16);
        cyl(0.25, 0.12, 0x1c1c1c, X - 4.2, 3.5, z - 5.6);
        this.solid(X - 4.2, z - 5.6, 1.5, 1.5);
        this.box(0.06, 0.06, 8.6, 0x2f6fd6, X - 4.95, 0.12, z - 1.2, false);
        // Seaux, éponges, bidons de savon le long du mur
        for (const [bx, bz, c] of [[-4.6, -1, BLUE], [-4.6, 0.6, 0xe24b2b], [0.4, 2.6, 0xf2c200]] as const) {
          cyl(0.22, 0.4, c, X + bx, 0.32, z + bz);
          this.box(0.2, 0.07, 0.13, 0xf5d547, X + bx, 0.55, z + bz, false);
        }
        for (const [jz, c] of [[-3.2, 0x16a34a], [-2.8, 0xf2c200], [-2.4, 0x16a34a]] as const) this.box(0.24, 0.55, 0.3, c, X - 4.75, 0.4, z + jz);
        // Moto en lavage, côté est de l'abri (hors du passage), mousse sur la selle
        const moto = this.buildMoto(0x1b2a6b);
        moto.position.set(X + 3.9, 0.1, z + 0.5);
        this.scene.add(moto);
        this.solid(X + 3.9, z + 0.5, 0.9, 2);
        for (const [fx, fy, fz, r] of [[3.9, 0.95, 0.5, 0.2], [3.9, 0.75, 1.1, 0.14]] as const) {
          const foam = new THREE.Mesh(this.geo(new THREE.SphereGeometry(r, 8, 6)), this.mats.color(0xffffff));
          foam.scale.y = 0.45;
          foam.position.set(X + fx, fy, z + fz);
          this.scene.add(foam);
        }
        // Aspirateur industriel
        cyl(0.28, 0.6, 0x8a9096, X + 4.3, 0.4, z - 3);
        cyl(0.3, 0.08, 0x2b2b2b, X + 4.3, 0.74, z - 3);
        this.solid(X + 4.3, z - 3, 0.6, 0.6);
        // Banc d'attente des clients, côté est vers la rue
        this.box(1.8, 0.08, 0.42, 0x2f8f4e, X + 4.2, 0.45, z + 5.6, false);
        for (const lx of [-0.75, 0.75]) this.box(0.08, 0.42, 0.38, 0x2f8f4e, X + 4.2 + lx, 0.22, z + 5.6, false);
        // Enseigne sur deux poteaux à l'angle sud-ouest (côté rue), prix sur un petit panneau
        for (const px of [-5.2, -2]) this.box(0.12, 3.6, 0.12, 0x5d646b, X + px, 1.8, z + 6.7);
        this.box(3.6, 1, 0.1, BLUE, X - 3.6, 3.7, z + 6.7, false);
        plate('LAVAGE AUTO-MOTO', '🚗  🏍️  💦', 3.5, 0.9, X - 3.6, 3.7, z + 6.76, '#1d6fd6', '#ffffff');
        plate('🧽 500 F', '✨ 1 000 F', 1.2, 0.7, X - 3.6, 2.6, z + 6.76, '#ffffff', '#1d3a8a');
        break;
      }
      case 'station_zem': {
        // Siège-station Gozem : tour de 5 niveaux (une activité par étage), rez-de-chaussée en baie à motos
        // et hall vitré, enseigne sur le toit ; devant, l'abri jaune des conducteurs indépendants.
        const GREEN = 0x0b6b3a;
        const LIME = 0xb6e84a;
        const WHITE = 0xf7faf5;
        const glass = this.litGlass();
        const sign = (text: string, w: number, h: number, sx: number, sy: number, sz: number, bg = '#0b6b3a', fg = '#ffffff', both = false) => {
          const tex = this.posterTexture(text, '', bg, fg, 512, Math.round(512 * h / w));
          const m = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(w, h)), new THREE.MeshBasicMaterial({ map: tex }));
          m.position.set(sx, sy, sz);
          this.scene.add(m);
          if (both) {
            const back = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(w, h)), new THREE.MeshBasicMaterial({ map: tex }));
            back.position.set(sx, sy, sz - 0.24);
            back.rotation.y = Math.PI;
            this.scene.add(back);
          }
        };
        const bz = z - 3;
        const fz = bz + 4.5;
        // Parvis dallé avec liseré vert-citron
        this.box(21, 0.1, 17, 0x9aa3ad, x, 0.05, z - 0.5, false);
        this.box(21, 0.12, 0.3, LIME, x, 0.06, z + 8, false);
        // Rez-de-chaussée : hall vitré à droite, baie à motos ouverte à gauche
        this.box(7.4, 3.4, 9, WHITE, x + 3.8, 1.7, bz);
        this.solid(x + 3.8, bz, 7.4, 9);
        const lobby = new THREE.Mesh(this.geo(new THREE.BoxGeometry(6.4, 2.6, 0.1)), glass);
        lobby.position.set(x + 3.8, 1.6, fz + 0.06);
        this.scene.add(lobby);
        for (const dx of [0.6, 3.8, 7]) this.box(0.12, 2.8, 0.14, GREEN, x + dx, 1.5, fz + 0.1, false);
        this.box(7.4, 0.35, 1.4, GREEN, x + 3.8, 3.1, fz + 0.7); // auvent d'entrée
        this.box(7.6, 3.4, 0.4, GREEN, x - 3.8, 1.7, bz - 4.3);
        this.solid(x - 3.8, bz - 4.3, 7.6, 0.4);
        this.box(7.6, 0.12, 8.6, 0x5b6b7f, x - 3.8, 0.06, bz, false); // sol de la baie
        for (const dx of [-7.3, -0.2]) this.box(0.4, 3.4, 0.4, GREEN, x + dx, 1.7, fz - 0.4);
        // Baie : motos de la flotte alignées, bandes de stationnement
        for (let i = 0; i < 5; i++) {
          this.box(0.08, 0.02, 3.2, 0xffffff, x - 7 + i * 1.5, 0.13, bz + 0.6, false);
          const m = this.buildMoto(i % 2 === 0 ? LIME : 0x16a34a);
          m.position.set(x - 6.3 + i * 1.5, 0, bz + 0.6);
          m.rotation.y = Math.PI / 2 + (i % 3 === 0 ? 0.1 : 0);
          this.scene.add(m);
        }
        // Tour de 5 niveaux : volume blanc, liserés citron à chaque étage, montant vert à gauche
        this.box(15.2, 15, 9, WHITE, x, 3.4 + 7.5, bz);
        this.box(1.1, 15.2, 9.3, GREEN, x - 7.2, 3.4 + 7.6, bz);
        const SERVICES = ['RIDE', 'DELIVERY', 'MONEY', 'GARAGE', 'SUPPORT'];
        for (let f = 0; f < 5; f++) {
          const y = 3.4 + f * 3 + 1.55;
          this.box(15.5, 0.18, 9.4, LIME, x, 3.4 + f * 3, bz, false);
          for (let k = 0; k < 4; k++) {
            const px = x - 0.6 + k * 2.4;
            const pane = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.9, 1.5, 0.08)), glass);
            pane.position.set(px, y, fz + 0.04);
            this.scene.add(pane);
            this.box(2.1, 0.1, 0.16, GREEN, px, y - 0.8, fz + 0.08, false);
          }
          // Étiquette du service de l'étage
          sign(SERVICES[f]!, 4.2, 1.1, x - 4.7, y, fz + 0.07);
          // Fenêtres sur le côté pignon
          for (const dz of [-2.4, 0.6]) {
            const sw = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.08, 1.4, 1.6)), glass);
            sw.position.set(x + 7.62, y, bz + dz);
            this.scene.add(sw);
          }
        }
        this.solid(x, bz, 15.2, 9, 18.4);
        // Toit : acrotère vert, grande enseigne double face, mât d'antenne, citerne et panneaux solaires
        this.box(15.6, 0.7, 9.4, GREEN, x, 18.75, bz, false);
        for (const dx of [-7.4, 7.4]) this.box(0.3, 3.2, 0.3, 0x5b6b7f, x + dx, 20.5, bz - 0.5, false);
        this.box(15.2, 3.2, 0.2, GREEN, x, 20.5, bz - 0.5, false);
        sign('GOZEM', 14.6, 3, x, 20.5, bz - 0.38, '#0b6b3a', '#b6e84a', true);
        this.box(0.12, 6, 0.12, 0x5b6b7f, x + 6, 21.7, bz + 2.5, false);
        this.box(1.2, 0.08, 0.08, 0x5b6b7f, x + 6, 24.2, bz + 2.5, false);
        for (let i = 0; i < 3; i++) {
          const panel = this.box(2, 0.08, 1.3, 0x1d3557, x - 5.5 + i * 2.3, 19.4, bz + 2.8, false);
          panel.rotation.x = -0.35;
        }
        // Parvis : borne « ZEM », tricycles-cargos de livraison, banc et lampadaire
        sign('ZÉM', 1.4, 0.8, x + 9.2, 3.4, z + 4, '#b6e84a', '#0b6b3a');
        this.box(0.12, 3, 0.12, 0x5b6b7f, x + 9.2, 1.5, z + 4, false);
        for (let i = 0; i < 2; i++) {
          const cx = x + 6 + i * 2.6;
          this.box(1.5, 1.2, 1.7, i === 0 ? LIME : WHITE, cx, 0.95, z + 5.2); // caisse cargo
          this.box(0.9, 0.9, 0.9, GREEN, cx, 0.75, z + 6.3, false); // cabine
          for (const wx of [-0.7, 0.7]) this.box(0.2, 0.6, 0.6, 0x14171a, cx + wx, 0.3, z + 5.4, false);
          this.box(0.2, 0.6, 0.6, 0x14171a, cx, 0.3, z + 6.4, false);
        }
        this.box(2.4, 0.12, 0.6, 0xf1ece1, x + 1.5, 0.5, z + 7.2, false);
        for (const dx of [0.5, 2.5]) this.box(0.1, 0.5, 0.5, 0x5b6b7f, x + dx, 0.25, z + 7.2, false);
        // Abri jaune des conducteurs indépendants, comme sur les stations de rue
        this.box(6, 0.2, 3.4, 0xffce00, x - 5.5, 2.6, z + 5.5);
        this.box(0.12, 2.6, 0.12, 0x5b6b7f, x - 8.2, 1.3, z + 5.5, false);
        this.box(0.12, 2.6, 0.12, 0x5b6b7f, x - 2.8, 1.3, z + 5.5, false);
        for (let i = 0; i < 4; i++) {
          const m = this.buildMoto([0xe5383b, 0x1f6feb, 0x14213d, 0x22a861][i]!);
          m.position.set(x - 7.9 + i * 1.6, 0, z + 5.5);
          this.scene.add(m);
        }
        break;
      }
      case 'gare_sotral': {
        // Gare des bus urbains Sotral : quai couvert, bus bleus et guichet (réduite à 65 % pour tenir entre la route du nord et le siège de Moov).
        const k = 0.65;
        this.box(26 * k, 0.15, 17 * k, 0x8d96a2, x, 0.08, z - k, false);
        this.box(24 * k, 0.4, 4 * k, 0xffffff, x, 4, z - 3 * k);
        for (let i = 0; i < 5; i++) this.box(0.25, 4, 0.25, 0x5b6b7f, x + (-10 + i * 5) * k, 2, z - 4.5 * k, false);
        this.building(x, z - 7.5 * k, 10 * k, 3.5 * k, 3.5, 0xfdf3dc, 0x1f5fae);
        for (let i = 0; i < 3; i++) {
          const bus = this.buildCoach(this.opts.busLines[i % Math.max(1, this.opts.busLines.length)]!);
          bus.scale.setScalar(k);
          bus.position.set(x + (-8 + i * 8) * k, 0, z);
          this.scene.add(bus);
        }
        const ssign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(10 * k, 1.4 * k)), new THREE.MeshBasicMaterial({ map: this.posterTexture('GARE SOTRAL', '', '#ffffff', '#1f5fae', 768, 100) }));
        ssign.position.set(x, 5.4, z + 6.8 * k);
        this.box(0.3, 5.4, 0.3, 0x5b6b7f, x - 5 * k, 2.7, z + 6.8 * k, false);
        this.box(0.3, 5.4, 0.3, 0x5b6b7f, x + 5 * k, 2.7, z + 6.8 * k, false);
        this.scene.add(ssign);
        break;
      }
      case 'agbalepedo': {
        // Gare routière d'Agbalépédogan au nord-ouest de GTA, bordée par la rue Pythagore.
        // Le portail est distinct de la voie GTA–Deux-Lions, qui longe désormais le site à l'est.
        this.box(24, 0.15, 16, 0x8d96a2, x, 0.08, z - 1, false);
        for (const [w, d, dx, dz] of [[24, 0.3, 0, -9], [0.3, 18, -12, 0], [0.3, 11, 12, -3.5], [0.3, 3.5, 12, 7.25]] as const) this.box(w, 1.7, d, 0xd8d1c3, x + dx, 0.85, z + dz, false);
        this.box(22, 0.4, 3.2, 0xffffff, x, 4, z - 5.5);
        this.box(22, 0.4, 3.2, 0xffffff, x, 4, z + 0.5);
        for (let i = 0; i < 5; i++) {
          const qx = x - 10 + i * 5;
          this.box(0.25, 4, 0.25, 0x5b6b7f, qx, 2, z - 4, false);
          this.box(0.25, 4, 0.25, 0x5b6b7f, qx, 2, z + 2, false);
          this.box(0.16, 0.02, 2.8, 0xffffff, qx, 0.17, z - 5.5, false);
        }
        this.building(x - 7.5, z - 10, 7, 3.5, 3.5, 0xfdf3dc, 0x1f6feb);
        this.building(x, z - 10, 6.5, 3.5, 3.5, 0xfdf3dc, 0xd21034);
        this.building(x + 7, z - 10, 6, 3.5, 3.5, 0xfdf3dc, 0x22a861);
        const lines = this.opts.busLines;
        for (let i = 0; i < Math.min(4, lines.length * 2); i++) {
          const bus = this.buildCoach(lines[i % lines.length]!);
          bus.position.set(x - 8.4 + i * 5.6, 0, z - 5.5);
          this.scene.add(bus);
        }
        for (let i = 0; i < 3; i++) {
          this.box(1.5, 0.9, 1.1, [0xf18f01, 0xffce00, 0x22a861][i]!, x - 7 + i * 7, 0.45, z + 5, false);
          this.box(2.2, 0.08, 2.2, [0x1f6feb, 0xe5383b, 0xffce00][i]!, x - 7 + i * 7, 2.2, z + 5, false);
          this.box(0.08, 2.2, 0.08, 0x5b3a1e, x - 7 + i * 7, 1.1, z + 5, false);
        }
        // La grande mosquée se trouve dans l'enceinte historique de la gare.
        this.box(5.4, 3.6, 4.2, 0xf2ead9, x - 8.2, 1.8, z + 4.2);
        const dome = new THREE.Mesh(this.geo(new THREE.SphereGeometry(1.7, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2)), this.mats.color(0x3b8d57));
        dome.position.set(x - 8.2, 3.65, z + 4.2);
        this.scene.add(dome);
        this.box(0.55, 6.5, 0.55, 0xf2ead9, x - 11, 3.25, z + 3.7, false);
        const minaret = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.48, 1.5, 8)), this.mats.color(0x3b8d57));
        minaret.position.set(x - 11, 7.25, z + 3.7);
        this.scene.add(minaret);
        const gsign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(15, 1.6)), new THREE.MeshBasicMaterial({ map: this.posterTexture('GARE ROUTIÈRE D’AGBALÉPÉDOGAN', '', '#14213d', '#ffce00', 1024, 100) }));
        gsign.position.set(x, 5.6, z + 7);
        this.box(0.3, 5.6, 0.3, 0x5b6b7f, x - 7, 2.8, z + 7, false);
        this.box(0.3, 5.6, 0.3, 0x5b6b7f, x + 7, 2.8, z + 7, false);
        this.scene.add(gsign);
        break;
      }
      case 'supermarche': {
        // Grande surface : façade vitrée, enseigne, parking avec voitures
        this.building(x, z - 5, 22, 10, 6, 0xffffff, 0x22a861);
        const vit = new THREE.MeshLambertMaterial({ color: 0x8ec5ff, emissive: 0x2b6cb0, emissiveIntensity: 0.2 });
        this.nightMaterials.push(vit);
        const front = new THREE.Mesh(this.geo(new THREE.BoxGeometry(16, 2.4, 0.1)), vit);
        front.position.set(x - 2, 1.4, z + 0.06);
        this.scene.add(front);
        const sign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(14, 1.5)), new THREE.MeshBasicMaterial({ map: this.posterTexture('SUPERMARCHÉ', '', '#22a861', '#ffffff', 1024, 110) }));
        sign.position.set(x, 4.6, z + 0.2);
        this.scene.add(sign);
        this.box(22, 0.06, 7, 0x6b7380, x, 0.04, z + 5, false);
        for (let i = 0; i < 6; i++) this.box(0.15, 0.02, 4, 0xffffff, x - 9 + i * 3.6, 0.09, z + 5, false);
        [0xe5383b, 0xffffff, 0x1f6feb].forEach((col, i) => {
          const car = this.buildCar(col, 4.2);
          car.rotation.y = Math.PI / 2;
          car.position.set(x - 7.2 + i * 7.2, 0, z + 5);
          this.scene.add(car);
        });
        break;
      }
      case 'aeroport': {
        // Aéroport de Lomé-Tokoin : centre recalé sur 6.16561 N, 1.25451 E entre GTA et le Port.
        // Piste 04/22 orientée à 39° du nord, aérogare au nord-ouest ; repère local puis rotation.
        const outer = new THREE.Group();
        outer.position.set(x, 0, z);
        outer.rotation.y = AIRPORT_ROT;
        outer.scale.setScalar(AIRPORT_SCALE);
        const inner = new THREE.Group();
        inner.position.set(4.5, 0, 11.5);
        outer.add(inner);
        this.mergeParents.push(inner);
        const scene = this.scene;
        const solids = this.solids.length;
        const self = this as unknown as { scene: THREE.Object3D };
        self.scene = inner;
        let airportSolids: { x0: number; x1: number; z0: number; z1: number }[] = [];
        try {
          this.buildAirport(0, 0);
        } finally {
          self.scene = scene;
          airportSolids = this.solids.splice(solids); // emprises encore exprimées dans le repère local
        }
        scene.add(outer);
        outer.updateMatrixWorld(true);
        // Transforme chaque obstacle local dans le repère de la ville. L'ancien code les supprimait,
        // ce qui autorisait les livraisons à traverser l'aérogare, les avions et la tour.
        const addAirportObstacle = (s: { x0: number; x1: number; z0: number; z1: number }) => {
          const corners = [[s.x0, s.z0], [s.x0, s.z1], [s.x1, s.z0], [s.x1, s.z1]].map(([px, pz]) => inner.localToWorld(new THREE.Vector3(px, 0, pz)));
          this.solidGrid = null;
          this.solids.push({
            x0: Math.min(...corners.map((p) => p.x)),
            x1: Math.max(...corners.map((p) => p.x)),
            z0: Math.min(...corners.map((p) => p.z)),
            z1: Math.max(...corners.map((p) => p.z)),
          });
        };
        airportSolids.forEach(addAirportObstacle);
        this.solidGrid = null;
        // La piste et le taxiway sont des zones interdites aux motos. Des rectangles courts suivent
        // leur orientation sans condamner tout le côté public de l'aérogare.
        for (let lx = -65; lx <= 55; lx += 10) addAirportObstacle({ x0: lx - 5.5, x1: lx + 5.5, z0: -35.8, z1: -24.2 });
        for (let lx = -67; lx <= 57; lx += 10) addAirportObstacle({ x0: lx - 5.5, x1: lx + 5.5, z0: -23.2, z1: -16.8 });
        break;
      }
      case 'cathedrale': {
        // Cathédrale du Sacré-Cœur : polychromie ocre/blanc, nef à toit incliné,
        // façade gothique à deux tours, lancettes, contreforts et haute flèche centrale.
        const ochre = 0xb96049;
        const cream = 0xf0e1bf;
        const roof = 0x3f704d;
        this.box(19, 0.12, 27, 0xd8cfbd, x, 0.06, z - 4, false);
        this.box(9.2, 8.4, 19, ochre, x, 4.2, z - 6.5);
        this.box(13.5, 4.8, 18, ochre, x, 2.4, z - 6.8);
        // Plan basilical visible du ciel : nef longue, faux transept saillant et abside polygonale.
        this.box(18, 7.2, 5.2, ochre, x, 3.6, z - 12.3);
        this.solid(x, z - 6.5, 18, 23);
        // Deux pans de toiture au-dessus de la nef, au lieu de l'ancienne dalle plate.
        for (const sx of [-1, 1]) {
          const plane = this.box(5.8, 0.38, 19.5, roof, x + sx * 2.25, 9.55, z - 6.5, false);
          plane.rotation.z = -sx * 0.58;
          const aisle = this.box(3.6, 0.28, 18, roof, x + sx * 5.1, 5.15, z - 6.8, false);
          aisle.rotation.z = -sx * 0.28;
        }
        // Toitures perpendiculaires du transept, également vertes comme sur l'édifice réel.
        for (const sz of [-1, 1]) {
          const transeptRoof = this.box(18.5, 0.34, 3.3, roof, x, 7.55, z - 12.3 + sz * 1.1, false);
          transeptRoof.rotation.x = sz * 0.42;
        }
        const apse = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(4.6, 4.6, 5.6, 8)), this.mats.color(ochre));
        apse.position.set(x, 2.8, z - 17.2);
        this.solid(x, z - 17.2, 9.2, 9.2);
        apse.castShadow = this.profile.shadows;
        this.scene.add(apse);
        const apseRoof = new THREE.Mesh(this.geo(new THREE.ConeGeometry(4.9, 2.2, 8)), this.mats.color(roof));
        apseRoof.position.set(x, 6.7, z - 17.2);
        apseRoof.rotation.y = Math.PI / 8;
        this.scene.add(apseRoof);
        // Contreforts et fenêtres latérales rythmant la nef.
        for (const sx of [-1, 1]) for (let i = 0; i < 5; i++) {
          const wz = z - 10.5 + i * 3;
          this.box(0.55, 5.4, 1, cream, x + sx * 6.35, 2.7, wz, false);
          this.box(0.12, 1.8, 0.75, 0x35526a, x + sx * 6.66, 3.5, wz, false);
        }
        // Façade : tours ocre bordées de pierre claire et quatre niveaux de baies.
        for (const sx of [-3.2, 3.2]) {
          this.box(2.8, 14.5, 3.1, ochre, x + sx, 7.25, z + 3.4);
          for (const edge of [-1, 1]) this.box(0.3, 14.8, 3.25, cream, x + sx + edge * 1.25, 7.4, z + 3.4, false);
          for (const y of [4.8, 8.1, 11.2]) {
            this.box(0.72, 1.65, 0.14, 0x30485b, x + sx, y, z + 5.01, false);
            const cap = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.36, 12, 0, Math.PI)), this.mats.color(0x30485b));
            cap.position.set(x + sx, y + 0.82, z + 5.02);
            this.scene.add(cap);
          }
          const spire = new THREE.Mesh(this.geo(new THREE.ConeGeometry(1.8, 6.5, 4)), this.mats.color(cream));
          spire.position.set(x + sx, 17.75, z + 3.4);
          spire.rotation.y = Math.PI / 4;
          this.scene.add(spire);
        }
        this.box(3.8, 9.2, 1.4, ochre, x, 4.6, z + 3.7);
        const gableShape = new THREE.Shape();
        gableShape.moveTo(-1.9, 0);
        gableShape.lineTo(1.9, 0);
        gableShape.lineTo(0, 3.5);
        gableShape.closePath();
        const gable = new THREE.Mesh(this.geo(new THREE.ShapeGeometry(gableShape)), this.mats.color(ochre));
        gable.position.set(x, 9.1, z + 4.42);
        this.scene.add(gable);
        this.box(1.9, 3.6, 0.16, 0x543227, x, 1.8, z + 4.44, false);
        this.box(0.28, 3.9, 0.18, cream, x - 1.05, 2, z + 4.46, false);
        this.box(0.28, 3.9, 0.18, cream, x + 1.05, 2, z + 4.46, false);
        const rose = new THREE.Mesh(this.geo(new THREE.CircleGeometry(1.1, 20)), this.mats.color(0x3d5a80));
        rose.position.set(x, 6.7, z + 4.45);
        this.scene.add(rose);
        const roseRing = new THREE.Mesh(this.geo(new THREE.TorusGeometry(1.15, 0.14, 6, 24)), this.mats.color(cream));
        roseRing.position.set(x, 6.7, z + 4.47);
        this.scene.add(roseRing);
        // Croix sommitale entre les deux clochers.
        this.box(0.18, 2.2, 0.18, 0xd8c58e, x, 13.8, z + 4.1, false);
        this.box(1.1, 0.18, 0.18, 0xd8c58e, x, 14.2, z + 4.1, false);
        // Flèche élancée au-dessus de la croisée, repère majeur dans les vues de toiture.
        for (const dx of [-0.72, 0.72]) this.box(0.16, 5.2, 0.16, cream, x + dx, 12.1, z - 11.8, false);
        const crossingSpire = new THREE.Mesh(this.geo(new THREE.ConeGeometry(1.05, 7, 4)), this.mats.color(cream));
        crossingSpire.position.set(x, 17.9, z - 11.8);
        crossingSpire.rotation.y = Math.PI / 4;
        this.scene.add(crossingSpire);
        break;
      }
      case 'grande_mosquee': {
        // Grande mosquée de Zongo : cour dallée avec vasque d'ablutions, salle de prière blanche à arcades,
        // grande coupole verte sur tambour, quatre coupoles d'angle, deux minarets à balcons, croissants dorés.
        const WHITE = 0xfbfbf7;
        const GREEN = 0x1f7a4d;
        const GOLD = 0xe3b23c;
        const crescent = (cx: number, cy: number, cz: number, r: number) => {
          const c = new THREE.Mesh(this.geo(new THREE.TorusGeometry(r, r * 0.17, 6, 18, Math.PI * 1.55)), this.mats.color(GOLD));
          c.position.set(cx, cy, cz);
          c.rotation.z = Math.PI * 0.72;
          this.scene.add(c);
        };
        const dome = (cx: number, cy: number, cz: number, r: number, color: number) => {
          const d = new THREE.Mesh(this.geo(new THREE.SphereGeometry(r, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2)), this.mats.color(color));
          d.position.set(cx, cy, cz);
          d.castShadow = this.profile.shadows;
          this.scene.add(d);
          const spire = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.04, 0.07, r * 0.7, 6)), this.mats.color(GOLD));
          spire.position.set(cx, cy + r + r * 0.25, cz);
          this.scene.add(spire);
          crescent(cx, cy + r + r * 0.62, cz, r * 0.2);
        };
        // Cour dallée (damier clair) et bordure verte
        this.box(17, 0.12, 17, 0xe6efe9, x, 0.06, z - 0.5, false);
        for (let i = -3; i <= 3; i++) for (let j = 0; j < 4; j++) if ((i + j) % 2 === 0) this.box(2, 0.02, 2, 0xd3e3d9, x + i * 2.2, 0.13, z + 3 + j * 1.6 - 0.2, false);
        // Salle de prière : volume principal, soubassement vert, corniche et créneaux
        this.box(12, 5.4, 10, WHITE, x, 2.7, z - 2);
        this.solid(x, z - 2, 12, 10);
        this.box(12.3, 0.7, 10.3, GREEN, x, 0.35, z - 2, false);
        this.box(12.4, 0.35, 10.4, GREEN, x, 5.55, z - 2, false);
        for (let i = -5; i <= 5; i++) this.box(0.6, 0.55, 0.35, WHITE, x + i * 1.1, 6, z + 3.05, false);
        // Façade à cinq arcades : fond sombre, arc en demi-cercle, encadrement vert
        for (let i = -2; i <= 2; i++) {
          const ax = x + i * 2.2;
          const centre = i === 0;
          const w = centre ? 2 : 1.5;
          const h = centre ? 3 : 2.4;
          this.box(w + 0.35, h + 0.35, 0.1, GREEN, ax, h / 2 + 0.55, z + 3.03, false);
          this.box(w, h, 0.12, centre ? 0x3a2a1a : 0x1d3b34, ax, h / 2 + 0.55, z + 3.06, false);
          for (const [r, col, dz] of [[(w + 0.35) / 2, GREEN, 3.04], [w / 2, centre ? 0x3a2a1a : 0x1d3b34, 3.07]] as const) {
            const arc = new THREE.Mesh(this.geo(new THREE.CircleGeometry(r, 18, 0, Math.PI)), this.mats.color(col));
            arc.position.set(ax, h + (r === w / 2 ? 0.55 : 0.725), z + dz);
            this.scene.add(arc);
          }
        }
        // Grande coupole sur tambour à fenêtres, quatre coupoles d'angle
        const drum = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(3.3, 3.5, 1.4, 20)), this.mats.color(WHITE));
        drum.position.set(x, 6.25, z - 2);
        drum.castShadow = this.profile.shadows;
        this.scene.add(drum);
        for (let k = 0; k < 8; k++) {
          const ang = (k / 8) * Math.PI * 2;
          const win = this.box(0.5, 0.8, 0.12, GREEN, x + Math.sin(ang) * 3.35, 6.35, z - 2 + Math.cos(ang) * 3.35, false);
          win.rotation.y = ang;
        }
        dome(x, 6.95, z - 2, 3.5, GREEN);
        for (const [dx, dz] of [[-4.6, -5.7], [4.6, -5.7], [-4.6, 1.7], [4.6, 1.7]] as const) {
          this.box(2, 0.9, 2, WHITE, x + dx, 5.95, z + dz, false);
          dome(x + dx, 6.4, z + dz, 1.15, 0x2a9060);
        }
        // Deux minarets à fût carré, balcons, lanterne cylindrique, calotte verte et croissant
        for (const sx of [-1, 1]) {
          const mx = x + sx * 7.2;
          const mz = z + 2.2;
          this.box(1.9, 8, 1.9, WHITE, mx, 4, mz);
          this.solid(mx, mz, 2.1, 2.1);
          this.box(2.1, 0.4, 2.1, GREEN, mx, 8.1, mz, false);
          this.box(2.5, 0.25, 2.5, WHITE, mx, 8.4, mz, false);
          for (const [ox, oz, w, d] of [[0, 1.2, 2.5, 0.1], [0, -1.2, 2.5, 0.1], [1.2, 0, 0.1, 2.5], [-1.2, 0, 0.1, 2.5]] as const) this.box(w, 0.55, d, WHITE, mx + ox, 8.8, mz + oz, false);
          const lantern = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.7, 0.8, 3.4, 14)), this.mats.color(WHITE));
          lantern.position.set(mx, 10.2, mz);
          lantern.castShadow = this.profile.shadows;
          this.scene.add(lantern);
          for (const wy of [9.6, 10.9]) this.box(0.3, 0.7, 0.1, GREEN, mx, wy, mz + 0.72, false);
          this.box(1.7, 0.2, 1.7, GREEN, mx, 12, mz, false);
          const cap = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.85, 1.9, 14)), this.mats.color(GREEN));
          cap.position.set(mx, 13.05, mz);
          this.scene.add(cap);
          crescent(mx, 14.35, mz, 0.38);
        }
        // Vasque d'ablutions octogonale au centre de la cour
        const basin = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(1.1, 1.25, 0.55, 8)), this.mats.color(0xcfc7b4));
        basin.position.set(x - 4.2, 0.4, z + 3.6);
        this.scene.add(basin);
        const water = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.95, 8)), new THREE.MeshBasicMaterial({ color: 0x6ec1e4 }));
        water.rotation.x = -Math.PI / 2;
        water.position.set(x - 4.2, 0.68, z + 3.6);
        this.scene.add(water);
        this.box(0.14, 1, 0.14, 0xcfc7b4, x - 4.2, 1, z + 3.6, false);
        this.solid(x - 4.2, z + 3.6, 2.4, 2.4);
        // Palmiers de la cour
        for (const px of [x + 4.4, x + 6.2]) {
          const trunk = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.14, 0.2, 3.6, 7)), this.mats.color(0x7a5a38));
          trunk.position.set(px, 1.8, z + 4.8);
          this.scene.add(trunk);
          const crown = new THREE.Mesh(this.geo(new THREE.SphereGeometry(1.2, 9, 6)), this.mats.color(C.palm));
          crown.scale.set(1, 0.45, 1);
          crown.position.set(px, 3.75, z + 4.8);
          this.scene.add(crown);
        }
        // Enceinte basse à claustra, portail face à la rue z = -30 : on n'entre que par l'allée.
        for (const [wx, wz, ww, wd] of [[x, z - 8.5, 17, 0.3], [x - 8.5, z - 0.5, 0.3, 17], [x + 8.5, z - 0.5, 0.3, 17], [x - 5.5, z + 8, 6, 0.3], [x + 5.5, z + 8, 6, 0.3]] as const) {
          this.box(ww, 1.3, wd, 0xf1ece1, wx, 0.65, wz, false);
          this.box(ww + 0.1, 0.15, wd + 0.1, GREEN, wx, 1.38, wz, false);
          this.solid(wx, wz, ww, wd);
        }
        for (const gx of [x - 2.5, x + 2.5]) {
          this.box(0.7, 2.8, 0.7, GREEN, gx, 1.4, z + 8, false);
          this.box(0.9, 0.2, 0.9, GOLD, gx, 2.9, z + 8, false);
        }
        this.box(5.9, 0.4, 0.5, GREEN, x, 2.7, z + 8, false);
        // Allée dallée du portail jusqu'au trottoir
        this.box(3.6, 0.1, 5, 0xd9d2c3, x, 0.05, z + 10.5, false);
        break;
      }
      case 'cfe': {
        // CFE réel, dans l'enceinte de la CCIT : bâtiment administratif beige de deux niveaux,
        // encadrements gris, fenêtres protégées, clôture noire et enseigne du guichet unique.
        // Dalle rognée côté est : elle s'arrête avant le trottoir de la rue (x + 6.5), au lieu de le recouvrir
        this.box(15, 0.12, 13, 0xd8d0c0, x - 1, 0.06, z - 1, false);
        this.box(12.5, 7.2, 7.5, 0xd9b38f, x, 3.6, z - 3);
        this.solid(x, z - 3, 12.5, 7.5);
        this.box(12.8, 0.45, 7.8, 0x70777d, x, 7.35, z - 3, false);
        this.box(3.2, 7.35, 0.3, 0x777d82, x, 3.68, z + 0.88, false);
        const glass = this.litGlass();
        for (const floor of [2.1, 5.25]) for (const dx of [-4.35, -2.25, 2.25, 4.35]) {
          const pane = new THREE.Mesh(this.geo(new THREE.BoxGeometry(1.35, 1.45, 0.12)), glass);
          pane.position.set(x + dx, floor, z + 0.82);
          this.scene.add(pane);
          for (const bar of [-0.42, 0, 0.42]) this.box(0.055, 1.5, 0.1, 0x33383f, x + dx + bar, floor, z + 0.9, false);
        }
        this.box(2.1, 2.6, 0.18, 0x374957, x, 1.3, z + 0.96, false);
        const cfeSign = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(10.6, 1.25)), new THREE.MeshBasicMaterial({ map: this.posterTexture('C.F.E', 'CENTRE DE FORMALITÉS DES ENTREPRISES • GUICHET UNIQUE', '#eee7dc', '#26343e', 1024, 120) }));
        cfeSign.position.set(x, 6.65, z + 0.99);
        this.scene.add(cfeSign);
        // Clôture sur rue avec portail central ; elle reste en dehors du point d'arrivée.
        for (let i = 0; i < 18; i++) {
          const px = x - 8 + i * 0.94;
          if (Math.abs(px - x) < 1.8 || px > x + 6.4) continue;
          this.box(0.06, 1.9, 0.06, 0x20252b, px, 0.95, z + 5.2, false);
        }
        // La lisse supérieure s'interrompt elle aussi au portail, afin de ne pas barrer l'entrée.
        this.box(6, 0.08, 0.08, 0x20252b, x - 5, 1.75, z + 5.2, false);
        this.box(4.4, 0.08, 0.08, 0x20252b, x + 4.45, 1.75, z + 5.2, false);
        for (const dx of [-5.2, 5.2]) this.tree(x + dx, z + 2.7);
        break;
      }
      case 'studio_ori_infos':
        // Studio Ori-Infos : rédaction du média en ligne (violet et vert citron de la marque), voyant « à l'antenne »
        this.mediaHq(x, z, { main: 0x5b2be0, accent: 0xc9f31d, dark: 0x1b1034, logo: 'ori', onAir: true });
        break;
      case 'capture_media':
        // Capture Média : studio photo-vidéo et communication (noir et jaune), gros objectif sur la façade
        this.mediaHq(x, z, { main: 0x23262b, accent: 0xffd60a, dark: 0x0b0d10, logo: 'capture', lens: true });
        break;
      default: {
        if (v.id.startsWith('bank_')) {
          this.bankBranch(x, z, v.id.split('_')[1] ?? '', v.id);
          break;
        }
        if (v.id.startsWith('mode_')) {
          this.clothesShop(x, z, v);
          break;
        }
        const accents = [0x1f6feb, 0xe5383b, 0x22a861, 0xffce00, 0xf18f01];
        const a = accents[Math.abs([...v.id].reduce((h, ch) => h * 31 + ch.charCodeAt(0), 7)) % accents.length]!;
        this.building(x, z - 3, 8, 6, 5, 0xffffff, a);
      }
    }
  }

  /**
   * Rotation d'un porte-conteneurs (cycle de 5 min) : 0–70 s arrivée et accostage, 70–145 s déchargement,
   * 145–220 s chargement, 220–300 s départ vers le large. Chaque mouvement de portique dure 6 s :
   * descente du palonnier, levée du conteneur, translation entre navire et quai, dépose, retour.
   */
  private updatePort(dt: number): void {
    // Tracteurs : attente sous le portique (chargé), trajet vers le parc, dépose, retour à vide
    for (const tr of this.tractors) {
      tr.t = (tr.t + dt) % 24;
      const t = tr.t;
      const toYard = t >= 5 && t < 12;
      const back = t >= 14;
      // Itinéraire : le long du quai (axe z) jusqu'à la plage, puis vers l'ouest jusqu'au parc
      const path = (k: number): [number, number, number] => {
        const leg1 = Math.abs(tr.gz - tr.yardZ);
        const leg2 = Math.abs(tr.quayX - tr.yardX);
        const d = k * (leg1 + leg2);
        if (d < leg1) return [tr.quayX, tr.gz + Math.sign(tr.yardZ - tr.gz) * d, tr.yardZ < tr.gz ? Math.PI : 0];
        return [tr.quayX - (d - leg1), tr.yardZ, -Math.PI / 2];
      };
      let k = 0;
      if (toYard) k = (t - 5) / 7;
      else if (t >= 12 && t < 14) k = 1;
      else if (back) k = 1 - (t - 14) / 10;
      const [px, pz, rot] = path(Math.min(1, Math.max(0, k)));
      tr.g.position.set(px, 0.4, pz);
      tr.g.rotation.y = back ? rot + Math.PI : rot;
      tr.load.visible = t < 12;
    }
    const b = this.berth;
    if (!b) return;
    b.t = (b.t + dt) % 300;
    const t = b.t;
    const ease = (k: number) => k * k * (3 - 2 * k);
    let z = b.zBerth;
    if (t < 70) z = b.zBerth + (b.zFar - b.zBerth) * (1 - ease(t / 70));
    else if (t >= 220) z = b.zBerth + (b.zFar - b.zBerth) * ease((t - 220) / 80);
    b.g.position.set(b.x, 0, z);
    b.g.rotation.y = t < 220 ? Math.PI : 0;
    // Conteneurs à bord / sur le quai selon l'avancement des opérations
    const n = b.stack.length;
    const unloading = t >= 70 && t < 145;
    const loading = t >= 145 && t < 220;
    const moved = unloading ? Math.floor(((t - 70) / 75) * n) : loading ? n - Math.floor(((t - 145) / 75) * n) : 0;
    b.stack.forEach((c, i) => (c.visible = i >= moved));
    const onQuay = Math.round((moved / Math.max(1, n)) * b.yard.length);
    b.yard.forEach((c, i) => (c.visible = i < onQuay));
    const working = unloading || loading;
    for (const c of this.cranes) {
      const u = working ? ((t + c.offset) % 6) / 6 : 0;
      // Va-et-vient : vers le navire puis vers le quai (déchargement) ou l'inverse (chargement)
      const [from, to] = unloading ? [c.shipX, c.quayX] : [c.quayX, c.shipX];
      const lowFrom = from === c.shipX ? 6.4 : 2.2;
      const lowTo = to === c.shipX ? 6.4 : 2.2;
      let tx = from;
      let sy = 12;
      let carrying = false;
      if (!working) {
        tx = c.quayX;
      } else if (u < 0.15) sy = 12 - (12 - lowFrom) * (u / 0.15); // descente à vide
      else if (u < 0.3) {
        sy = lowFrom + (12 - lowFrom) * ((u - 0.15) / 0.15); // levée avec le conteneur
        carrying = true;
      } else if (u < 0.55) {
        tx = from + (to - from) * ease((u - 0.3) / 0.25); // translation
        carrying = true;
      } else if (u < 0.7) {
        tx = to;
        sy = 12 - (12 - lowTo) * ((u - 0.55) / 0.15); // dépose
        carrying = true;
      } else {
        tx = to + (from - to) * ease((u - 0.7) / 0.3); // retour à vide
      }
      c.trolley.position.x = tx;
      c.spreader.position.set(tx, sy, c.gz);
      c.cable.position.set(tx, (14.2 + sy) / 2, c.gz);
      c.cable.scale.y = Math.max(0.1, 14.2 - sy);
      c.load.visible = carrying;
      c.load.position.set(tx, sy - 0.75, c.gz);
    }
  }

  /** Texture d'une annonce de panneau (affiche dessinée, remplacée par l'image dès qu'elle est chargée), partagée. */
  private readonly adTextures = new Map<string, { tex: THREE.Texture }>();
  /**
   * Image d'annonce pour un panneau 2:1 : si elle a déjà ce format on la garde ; sinon elle est posée en entier, centrée, sur son
   * propre fond agrandi et flouté (bandes latérales discrètes), au lieu d'être déformée.
   */
  private fitBoardImage(tex: THREE.Texture): THREE.Texture {
    const src = tex.image as CanvasImageSource & { width: number; height: number };
    if (!src || !src.width || !src.height) return tex;
    const aspect = src.width / src.height;
    if (Math.abs(aspect - 2) < 0.3) return tex;
    const W = 1024;
    const H = 512;
    const cv = document.createElement('canvas');
    cv.width = W;
    cv.height = H;
    const g = cv.getContext('2d');
    if (!g) return tex;
    // Fond : l'image couvre tout le panneau, floutée et assombrie
    const cover = Math.max(W / src.width, H / src.height);
    g.save();
    try {
      g.filter = 'blur(14px)';
    } catch {
      /* flou indisponible : fond net */
    }
    g.drawImage(src, (W - src.width * cover) / 2, (H - src.height * cover) / 2, src.width * cover, src.height * cover);
    g.restore();
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.fillRect(0, 0, W, H);
    // Affiche entière au centre
    const fit = Math.min(W / src.width, H / src.height);
    const w = src.width * fit;
    const h = src.height * fit;
    g.drawImage(src, (W - w) / 2, (H - h) / 2, w, h);
    const out = new THREE.CanvasTexture(cv);
    out.anisotropy = 4;
    tex.dispose();
    return out;
  }

  private adTexture(ad: Ad): THREE.Texture {
    let e = this.adTextures.get(ad.id);
    if (!e) {
      e = { tex: this.adArtTexture(ad.title, ad.sub, ad.bg, ad.fg, 2, 1) };
      this.adTextures.set(ad.id, e);
      const entry = e;
      if (ad.image) {
        new THREE.TextureLoader().load(ad.image, (loaded) => {
          // Panneau large (2:1) : une affiche portrait n'est plus étirée, elle est posée en entier au centre sur un fond flou
          const img = this.fitBoardImage(loaded);
          img.colorSpace = THREE.SRGBColorSpace;
          this.mats.textures.push(img);
          entry.tex = img;
          for (const sc of this.screens) if (sc.pool[sc.shown]?.id === ad.id) this.showAd(sc, sc.shown);
          for (const m of this.adMats.get(ad.id) ?? []) {
            m.map = img;
            m.needsUpdate = true;
          }
        });
      }
    }
    return e.tex;
  }
  private readonly adMats = new Map<string, THREE.MeshBasicMaterial[]>();

  /** Écrans géants des panneaux : changement d'annonce toutes les 8 s, avec un bref allumage. */
  private readonly screens: { mat: THREE.MeshBasicMaterial; meshes: THREE.Object3D[]; pool: Ad[]; shown: number; offset: number; flash?: number }[] = [];
  private showAd(sc: (typeof this.screens)[number], k: number): void {
    const ad = sc.pool[k]!;
    sc.shown = k;
    sc.mat.map = this.adTexture(ad);
    sc.mat.needsUpdate = true;
    for (const m of sc.meshes) m.userData.adId = ad.id;
  }
  private updateScreens(now: number): void {
    const t = now / 1000;
    for (const sc of this.screens) {
      const k = Math.floor(t / 8 + sc.offset) % sc.pool.length;
      if (k !== sc.shown) {
        this.showAd(sc, k);
        sc.flash = t;
      }
      // Allumage : l'image monte en luminosité en 0,4 s, comme un écran qui change de programme
      const f = sc.flash === undefined ? 1 : Math.min(1, (t - sc.flash) / 0.4);
      sc.mat.color.setScalar(0.35 + 0.65 * f);
    }
  }

  private adArtTexture(title: string, sub: string, bg: string, fg: string, w: number, h: number): THREE.CanvasTexture {
    const tex = new THREE.CanvasTexture(drawAdArt(title, sub, bg, fg, w, h));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.mats.textures.push(tex);
    return tex;
  }

  /** Texture d'affiche dessinée sur canvas (texte de jeu traduit, aucune image externe). */
  /**
   * Enseignes dessinées d'après les logos fournis : Ori Infos (objectif violet « ö » sur fond vert citron, « infos » en
   * étiquette) et Capture (objectif noir sur fond jaune, « L'Afrique en un seul clic »). Tracé au canevas, sans image importée.
   */
  private dogtaSignCache: THREE.CanvasTexture | null = null;

  /**
   * Enseigne de façade de l'hôpital Dogta-Lafiè (fond transparent) : la croix du logo officiel, puis « HÔPITAL » en bleu
   * et « DOGTA-LAFIÈ » en vert, comme sur le bâtiment réel. La croix est découpée dans le logo fourni (public/brands) ;
   * un dessin de repli s'affiche tant qu'il n'est pas chargé.
   */
  private dogtaSignTexture(): THREE.CanvasTexture {
    if (this.dogtaSignCache) return this.dogtaSignCache;
    const w = 1024;
    const h = 360;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    const BLUE = '#0b5a9e';
    const GREEN = '#1ba04f';
    const text = () => {
      if (!g) return;
      g.textBaseline = 'alphabetic';
      const fit = (t: string, color: string, size: number, y: number) => {
        g.font = `900 ${size}px system-ui, sans-serif`;
        const m = g.measureText(t).width;
        if (m > 700) g.font = `900 ${Math.floor((size * 700) / m)}px system-ui, sans-serif`;
        g.fillStyle = color;
        g.fillText(t, 300, y);
      };
      fit('HÔPITAL', BLUE, 130, 150);
      fit('DOGTA-LAFIÈ', GREEN, 130, 290);
    };
    const bar = (x0: number, y0: number, bw: number, bh: number) => {
      if (!g) return;
      g.beginPath();
      g.roundRect(x0, y0, bw, bh, 30);
      g.fill();
    };
    if (g) {
      // Repli : croix dessinée (bleue en haut à droite, verte en bas à gauche)
      g.fillStyle = BLUE;
      bar(100, 14, 90, 332);
      bar(16, 126, 258, 100);
      g.save();
      g.beginPath();
      g.moveTo(-10, 80);
      g.lineTo(110, 130);
      g.quadraticCurveTo(190, 170, 200, 380);
      g.lineTo(-10, 380);
      g.closePath();
      g.clip();
      g.fillStyle = GREEN;
      bar(100, 14, 90, 332);
      bar(16, 126, 258, 100);
      g.restore();
      text();
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.mats.textures.push(tex);
    this.dogtaSignCache = tex;
    void this.loadLogo(`${import.meta.env.BASE_URL}brands/dogta-lafie.png`).then((img) => {
      if (!img || !g) return;
      g.clearRect(0, 0, w, h);
      // La croix occupe le tiers gauche du logo fourni (112 × 158 px sur 300 × 158)
      const sw = Math.min(img.width, Math.round(img.width * 0.42));
      const k = h / img.height;
      g.drawImage(img, 0, 0, sw, img.height, 10, 0, sw * k, h);
      text();
      try {
        const data = g.getImageData(0, 0, w, h);
        const px = data.data;
        for (let i = 0; i < px.length; i += 4) {
          const m = Math.min(px[i]!, px[i + 1]!, px[i + 2]!);
          if (m > 246) px[i + 3] = 0;
          else if (m > 226) px[i + 3] = Math.round((px[i + 3]! * (246 - m)) / 20);
        }
        g.putImageData(data, 0, 0);
      } catch {
        /* image non lisible */
      }
      tex.needsUpdate = true;
    });
    return tex;
  }

  private dogtaTex: THREE.CanvasTexture | null = null;

  private logoTexture(kind: 'ori' | 'capture' | 'dogta'): THREE.CanvasTexture {
    if (kind === 'dogta' && this.dogtaTex) return this.dogtaTex;
    const w = 1024;
    const h = kind === 'dogta' ? 539 : 256; // le logo de l'hôpital est presque deux fois plus large que haut (300 × 158)
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    if (g) {
      if (kind === 'ori') {
        g.fillStyle = '#c9f31d';
        g.fillRect(0, 0, w, h);
        // Icône : objectif (anneau violet), pavillon à gauche, deux bulles
        const PURPLE = '#5b2be0';
        g.fillStyle = PURPLE;
        g.beginPath();
        g.moveTo(40, 96);
        g.lineTo(40, 176);
        g.lineTo(96, 136);
        g.closePath();
        g.fill();
        g.lineWidth = 26;
        g.strokeStyle = PURPLE;
        g.beginPath();
        g.arc(176, 150, 52, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.arc(170, 52, 13, 0, Math.PI * 2);
        g.arc(206, 40, 10, 0, Math.PI * 2);
        g.fill();
        // « ri » et étiquette « infos »
        g.fillStyle = PURPLE;
        g.font = '900 150px system-ui, sans-serif';
        g.textBaseline = 'alphabetic';
        g.fillText('ri', 262, 200);
        g.fillStyle = '#ffffff';
        g.strokeStyle = '#111111';
        g.lineWidth = 8;
        g.beginPath();
        g.roundRect(520, 110, 300, 100, 22);
        g.fill();
        g.stroke();
        g.fillStyle = '#111111';
        g.font = '900 84px system-ui, sans-serif';
        g.fillText('infos', 548, 188);
        g.fillStyle = PURPLE;
        g.font = '700 34px system-ui, sans-serif';
        g.fillText('STUDIO • L’INFO, LE FUN ET VOUS !', 262, 238);
      } else if (kind === 'capture') {
        g.fillStyle = '#ffd60a';
        g.fillRect(0, 0, w, h);
        // Objectif noir avec reflet blanc et ondes dorées, cadre de visée
        g.fillStyle = '#111111';
        g.beginPath();
        g.arc(150, 128, 90, 0, Math.PI * 2);
        g.fill();
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.arc(100, 80, 26, 0, Math.PI * 2);
        g.fill();
        g.strokeStyle = '#ffd60a';
        g.lineWidth = 9;
        for (const r of [28, 46, 64]) {
          g.beginPath();
          g.arc(155, 118, r, 0.15 * Math.PI, 0.85 * Math.PI);
          g.stroke();
        }
        g.strokeStyle = '#111111';
        g.lineWidth = 8;
        for (const [x0, y0, dx, dy] of [[28, 28, 1, 1], [272, 28, -1, 1], [28, 228, 1, -1], [272, 228, -1, -1]] as const) {
          g.beginPath();
          g.moveTo(x0 + dx * 40, y0);
          g.lineTo(x0, y0);
          g.lineTo(x0, y0 + dy * 40);
          g.stroke();
        }
        g.fillStyle = '#111111';
        g.textBaseline = 'alphabetic';
        g.font = '900 120px system-ui, sans-serif';
        g.fillText('CAPTURE', 330, 150);
        g.font = '700 38px system-ui, sans-serif';
        g.fillText('L’AFRIQUE EN UN SEUL CLIC', 334, 205);
      } else {
        // Hôpital Dogta-Lafiè (HDL), exploité par la SOGEHP : croix en deux parties, bleue (haut, droite) et verte (gauche, bas),
        // séparées par un filet courbe ; nom en bleu, exploitant en vert. Reproduction du logo officiel, sur fond transparent.
        const BLUE = '#0b5a9e';
        const GREEN = '#1ba04f';
        g.clearRect(0, 0, w, h);
        g.save();
        g.translate(0, (h - 256) / 2); // repli vectoriel affiché le temps de charger le vrai logo
        const bar = (x0: number, y0: number, bw: number, bh: number) => {
          g.beginPath();
          g.roundRect(x0, y0, bw, bh, 26);
          g.fill();
        };
        g.fillStyle = BLUE;
        bar(90, 14, 76, 228);
        bar(16, 88, 224, 80);
        g.save();
        g.beginPath();
        g.moveTo(-10, 60);
        g.lineTo(96, 96);
        g.quadraticCurveTo(168, 124, 176, 262);
        g.lineTo(-10, 262);
        g.closePath();
        g.clip();
        g.fillStyle = GREEN;
        bar(90, 14, 76, 228);
        bar(16, 88, 224, 80);
        g.restore();
        g.strokeStyle = 'rgba(255,255,255,1)';
        g.lineWidth = 9;
        g.globalCompositeOperation = 'destination-out';
        g.beginPath();
        g.moveTo(96, 96);
        g.quadraticCurveTo(168, 124, 176, 262);
        g.stroke();
        g.globalCompositeOperation = 'source-over';
        g.textBaseline = 'alphabetic';
        const fit = (text: string, weight: number, size: number, color: string, y: number) => {
          g.font = `${weight} ${size}px system-ui, sans-serif`;
          const maxW = 720;
          const m = g.measureText(text).width;
          if (m > maxW) g.font = `${weight} ${Math.floor((size * maxW) / m)}px system-ui, sans-serif`;
          g.fillStyle = color;
          g.fillText(text, 290, y);
        };
        fit('HÔPITAL DOGTA-LAFIÈ (HDL)', 800, 64, BLUE, 96);
        fit('SOGEHP', 800, 62, GREEN, 164);
        fit('Hôpital Niveau 4', 500, 50, BLUE, 224);
        g.restore();
      }
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = kind === 'dogta' ? 8 : 4; // texte net même vu de biais
    this.mats.textures.push(tex);
    if (kind === 'dogta') {
      this.dogtaTex = tex;
      // Logo officiel fourni (public/brands/dogta-lafie.png) : il remplace le repli dessiné ; le fond blanc devient transparent
      void this.loadLogo(`${import.meta.env.BASE_URL}brands/dogta-lafie.png`).then((img) => {
        if (!img || !g) return;
        g.clearRect(0, 0, w, h);
        const k = Math.min(w / img.width, h / img.height);
        const iw = img.width * k;
        const ih = img.height * k;
        g.drawImage(img, (w - iw) / 2, (h - ih) / 2, iw, ih);
        try {
          const data = g.getImageData(0, 0, w, h);
          const px = data.data;
          for (let i = 0; i < px.length; i += 4) {
            const m = Math.min(px[i]!, px[i + 1]!, px[i + 2]!);
            if (m > 246) px[i + 3] = 0;
            else if (m > 226) px[i + 3] = Math.round((px[i + 3]! * (246 - m)) / 20);
          }
          g.putImageData(data, 0, 0);
        } catch {
          /* image non lisible : on garde le fond tel quel */
        }
        tex.needsUpdate = true;
      });
    }
    return tex;
  }

  private readonly logoImages = new Map<string, Promise<HTMLImageElement | null>>();

  private zenerLogoTex: THREE.CanvasTexture | null = null;
  /** Logo Zener (public/brands/zener.png) sur fond blanc ; un anneau bleu et vert le remplace le temps du chargement. */
  private zenerLogo(): THREE.CanvasTexture {
    if (this.zenerLogoTex) return this.zenerLogoTex;
    const S = 512;
    const cv = document.createElement('canvas');
    cv.width = S;
    cv.height = S;
    const g = cv.getContext('2d')!;
    const paintFallback = (): void => {
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, S, S);
      g.lineWidth = 64;
      g.strokeStyle = '#1b4fa3';
      g.beginPath();
      g.arc(S / 2, 190, 130, Math.PI * 0.5, Math.PI * 1.5);
      g.stroke();
      g.strokeStyle = '#3aa535';
      g.beginPath();
      g.arc(S / 2, 190, 130, Math.PI * 1.5, Math.PI * 2.5);
      g.stroke();
      g.fillStyle = '#1b4fa3';
      g.font = '900 120px sans-serif';
      g.textAlign = 'center';
      g.fillText('ZENER', S / 2, 440);
    };
    paintFallback();
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 16;
    tex.generateMipmaps = true;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    this.mats.textures.push(tex);
    this.zenerLogoTex = tex;
    void this.loadLogo(`${import.meta.env.BASE_URL}brands/zener.png`).then((img) => {
      if (!img) return;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, S, S);
      // Le fichier a une grande marge blanche : on ne garde que le logo (anneau, nom et slogan) pour qu'il remplisse le cadre
      const sx = img.width * 0.02;
      const sy = img.height * 0.11;
      const sw = img.width * 0.96;
      const sh = img.height * 0.84;
      const k = Math.min((S * 0.96) / sw, (S * 0.96) / sh);
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, sx, sy, sw, sh, (S - sw * k) / 2, (S - sh * k) / 2, sw * k, sh * k);
      tex.needsUpdate = true;
    });
    return tex;
  }

  private loadLogo(url: string): Promise<HTMLImageElement | null> {
    let p = this.logoImages.get(url);
    if (!p) {
      p = new Promise((ok) => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => ok(img);
        img.onerror = () => ok(null);
        img.src = url;
      });
      this.logoImages.set(url, p);
    }
    return p;
  }

  /**
   * Enseigne d'un bâtiment de marque : dégradé aux couleurs du partenaire, liseré clair et nom ; avec un logo, il est posé sur une
   * plaque blanche arrondie (à gauche d'une enseigne large, au centre d'un totem carré) et se charge sans bloquer la ville.
   */
  private brandSignTexture(label: string, sub: string, color: string, logo: string | null | undefined, w: number, h: number): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.mats.textures.push(tex);
    const square = h > w * 0.7;
    const paint = (img: HTMLImageElement | null) => {
      const g = cv.getContext('2d');
      if (!g) return;
      const base = new THREE.Color(color);
      const lite = base.clone().lerp(new THREE.Color(0xffffff), 0.22).getStyle();
      const grad = g.createLinearGradient(0, 0, w, h);
      grad.addColorStop(0, lite);
      grad.addColorStop(1, base.clone().multiplyScalar(0.78).getStyle());
      g.fillStyle = grad;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,.14)';
      g.beginPath();
      g.arc(w * 0.9, h * 0.1, h * 0.7, 0, Math.PI * 2);
      g.fill();
      g.strokeStyle = 'rgba(255,255,255,.75)';
      g.lineWidth = Math.max(2, h * 0.035);
      g.strokeRect(g.lineWidth * 1.6, g.lineWidth * 1.6, w - g.lineWidth * 3.2, h - g.lineWidth * 3.2);
      const plate = (x: number, y: number, side: number) => {
        g.fillStyle = '#ffffff';
        g.beginPath();
        g.roundRect(x, y, side, side, side * 0.18);
        g.fill();
        if (img) {
          const k = Math.min((side * 0.82) / img.width, (side * 0.82) / img.height);
          g.drawImage(img, x + (side - img.width * k) / 2, y + (side - img.height * k) / 2, img.width * k, img.height * k);
        }
      };
      g.textBaseline = 'middle';
      g.fillStyle = '#ffffff';
      if (square) {
        if (img) {
          const side = w * 0.62;
          plate((w - side) / 2, h * 0.1, side);
          g.textAlign = 'center';
          g.font = `900 ${Math.round(w * 0.13)}px system-ui, sans-serif`;
          g.fillText(label, w / 2, h * 0.82, w * 0.86);
        } else {
          g.textAlign = 'center';
          g.font = `900 ${Math.round(w * 0.16)}px system-ui, sans-serif`;
          g.fillText(label, w / 2, h * 0.5, w * 0.86);
        }
      } else {
        const side = h * 0.78;
        const left = img ? h * 0.11 + side + h * 0.14 : w * 0.05;
        if (img) plate(h * 0.11, h * 0.11, side);
        g.textAlign = 'left';
        g.font = `900 ${Math.round(h * (sub ? 0.34 : 0.4))}px system-ui, sans-serif`;
        g.fillText(label, left, sub ? h * 0.42 : h * 0.5, w - left - w * 0.04);
        if (sub) {
          g.font = `700 ${Math.round(h * 0.16)}px system-ui, sans-serif`;
          g.fillStyle = 'rgba(255,255,255,.88)';
          g.fillText(sub, left, h * 0.74, w - left - w * 0.04);
        }
      }
      tex.needsUpdate = true;
    };
    paint(null);
    if (logo) void this.loadLogo(logo).then((img) => img && paint(img));
    return tex;
  }

  /** Bandeau d'enseigne large : texte gras centré, très grand, fond uni et filet clair (lisible de loin). */
  private bannerTexture(text: string, bg: string, fg: string): THREE.CanvasTexture {
    const w = 2048;
    const h = 145;
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    if (g) {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = fg;
      g.lineWidth = 6;
      g.strokeRect(10, 10, w - 20, h - 20);
      g.fillStyle = fg;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      let size = Math.round(h * 0.7);
      g.font = `900 ${size}px system-ui, sans-serif`;
      const m = g.measureText(text).width;
      if (m > w * 0.92) {
        size = Math.floor((size * w * 0.92) / m);
        g.font = `900 ${size}px system-ui, sans-serif`;
      }
      g.fillText(text, w / 2, h / 2 + 4);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.mats.textures.push(tex);
    return tex;
  }

  /** Enseigne en grosses lettres centrées (mot court : sigle d'un organisme), avec un liseré de la couleur des lettres. */
  private lettersTexture(word: string, color: string, bg: string, w = 1024, h = 320): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    if (g) {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.strokeStyle = color;
      g.lineWidth = h * 0.05;
      g.strokeRect(h * 0.06, h * 0.06, w - h * 0.12, h - h * 0.12);
      g.fillStyle = color;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.font = `900 ${Math.round(h * 0.62)}px system-ui, Arial, sans-serif`;
      g.fillText(word, w / 2, h * 0.53, w * 0.82);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    this.mats.textures.push(tex);
    return tex;
  }

  /**
   * Mot en écriture penchée façon logo manuscrit, sans police cursive installée : lettres serif italiques serrées, cisaillées,
   * avec un léger contour pour les lier. Les polices cursives connues sont tentées d'abord si elles existent sur l'appareil.
   */
  private scriptWord(g: CanvasRenderingContext2D, text: string, cx: number, cy: number, size: number, color: string, outline?: string): void {
    g.save();
    g.translate(cx, cy);
    g.transform(1, 0, -0.32, 1, 0, 0); // penche les lettres vers la droite
    g.font = `italic 700 ${size}px "Brush Script MT", "Segoe Script", "Lucida Handwriting", "Z003", "URW Chancery L", Georgia, "Times New Roman", serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    if ('letterSpacing' in g) (g as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = `${-Math.round(size * 0.04)}px`;
    if (outline) {
      g.lineJoin = 'round';
      g.lineWidth = Math.max(2, size * 0.035);
      g.strokeStyle = outline;
      g.strokeText(text, 0, 0);
    }
    g.fillStyle = color;
    g.fillText(text, 0, 0);
    g.restore();
  }

  private posterTexture(title: string, sub: string, bg: string, fg: string, w = 512, h = 256): THREE.CanvasTexture {
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    if (g) {
      g.fillStyle = bg;
      g.fillRect(0, 0, w, h);
      g.fillStyle = 'rgba(255,255,255,.18)';
      g.beginPath();
      g.arc(w * 0.85, h * 0.2, h * 0.55, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = fg;
      g.font = `900 ${Math.round(h * 0.26)}px system-ui, sans-serif`;
      g.textBaseline = 'middle';
      g.fillText(title, w * 0.06, h * 0.4, w * 0.88);
      g.font = `700 ${Math.round(h * 0.12)}px system-ui, sans-serif`;
      g.fillText(sub, w * 0.06, h * 0.72, w * 0.88);
    }
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;
    this.mats.textures.push(tex);
    return tex;
  }

  /**
   * Parcelles en mer façon « mur de pub » : grille de cases flottantes au large de la plage.
   * Cases libres pâles (touchables pour louer), cases réservées grises, parcelles en ligne avec leur affiche.
   */
  /** Lagunes : plan d'eau calme, berge de sable, jacinthes d'eau, pirogue ; on n'y marche pas. */
  /** Eau claire à reflets (dégradé du centre vers les bords, rides blanches) ; la surface ondule doucement. */
  private waterTexture(deep: string, mid: string, shore: string): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = 256;
    c.height = 256;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(128, 128, 20, 128, 128, 128);
    grad.addColorStop(0, deep);
    grad.addColorStop(0.6, mid);
    grad.addColorStop(1, shore);
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(255,255,255,0.32)';
    g.lineWidth = 2;
    for (let k = 0; k < 48; k++) {
      const rx = (k * 53) % 256;
      const ry = (k * 97) % 256;
      g.beginPath();
      g.moveTo(rx, ry);
      g.quadraticCurveTo(rx + 8, ry - 4, rx + 16, ry);
      g.stroke();
    }
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    this.mats.textures.push(tex);
    return tex;
  }

  /**
   * Lagunes : berge de sable puis bande d'herbe, eau à reflets qui ondule (un peu lumineuse la nuit, reflet de la ville),
   * roseaux et nénuphars sur les bords, palmiers sur la berge, ponton de bois et pirogue.
   */
  private buildLagoons(): void {
    for (const [i, l] of LAGOONS.entries()) {
      const ell = (rx: number, rz: number, color: THREE.Material | number, y: number) => {
        const m = new THREE.Mesh(this.geo(new THREE.CircleGeometry(1, 48)), typeof color === 'number' ? this.mats.color(color) : color);
        m.rotation.x = -Math.PI / 2;
        m.scale.set(rx, rz, 1);
        m.position.set(l.x, y, l.z);
        m.receiveShadow = this.profile.shadows;
        this.scene.add(m);
        return m;
      };
      ell(l.rx + 3, l.rz + 3, 0x6fa85a, 0.04); // herbe
      ell(l.rx + 1.4, l.rz + 1.4, 0xd9c08c, 0.06); // sable
      const tex = this.waterTexture('#1d6f93', '#3b9cc2', '#86cfe0');
      const waterMat = new THREE.MeshLambertMaterial({ map: tex, emissive: 0x2a7fb0, emissiveIntensity: 0 });
      this.nightMaterials.push(waterMat);
      this.nightScale.set(waterMat, 0.18);
      const water = ell(l.rx, l.rz, waterMat, 0.09);
      water.onBeforeRender = () => {
        const t = performance.now() / 1000;
        tex.offset.set(Math.sin(t * 0.25 + i) * 0.03, t * 0.012);
      };
      const r = rng(77 + i);
      // Nénuphars
      for (let k = 0; k < 9; k++) {
        const a = r() * Math.PI * 2;
        const d = 0.55 + r() * 0.3;
        const pad = new THREE.Mesh(this.geo(new THREE.CircleGeometry(0.35 + r() * 0.25, 10)), this.mats.color(0x4f8a3c));
        pad.rotation.x = -Math.PI / 2;
        pad.position.set(l.x + Math.cos(a) * l.rx * d, 0.11, l.z + Math.sin(a) * l.rz * d);
        this.scene.add(pad);
        if (k % 3 === 0) {
          const fl = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.1, 8, 6)), this.mats.color(k % 2 ? 0xf7a8c8 : 0xffffff));
          fl.position.set(pad.position.x, 0.15, pad.position.z);
          this.scene.add(fl);
        }
      }
      // Roseaux en touffes sur le pourtour
      const reedMat = this.mats.color(0x5e8f3a);
      for (let k = 0; k < 26; k++) {
        const a = (k / 26) * Math.PI * 2 + r() * 0.15;
        const rx = l.x + Math.cos(a) * (l.rx + 0.2);
        const rz = l.z + Math.sin(a) * (l.rz + 0.2);
        for (let q = 0; q < 3; q++) {
          const reed = new THREE.Mesh(this.geo(new THREE.ConeGeometry(0.05, 0.9 + r() * 0.6, 4)), reedMat);
          reed.position.set(rx + (r() - 0.5) * 0.5, 0.5, rz + (r() - 0.5) * 0.5);
          reed.rotation.z = (r() - 0.5) * 0.3;
          this.scene.add(reed);
        }
      }
      // Palmiers sur la berge (côté nord, hors des routes)
      for (const a of [Math.PI * 1.15, Math.PI * 1.5, Math.PI * 1.85]) {
        const px = l.x + Math.cos(a) * (l.rx + 2.2);
        const pz = l.z + Math.sin(a) * (l.rz + 2.2);
        if (this.onRoad(px, pz, 1)) continue;
        const h = 3.6 + r();
        const trunk = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.12, 0.18, h, 7)), this.mats.color(0x8a6a44));
        trunk.position.set(px, h / 2, pz);
        this.scene.add(trunk);
        for (let k = 0; k < 7; k++) {
          const a3 = (k / 7) * Math.PI * 2 + px;
          const leaf = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.32, 0.06, 1.7)), this.mats.color(0x2e8b3e));
          leaf.position.set(px + Math.cos(a3) * 0.75, h + 0.05, pz + Math.sin(a3) * 0.75);
          leaf.rotation.set(0, -a3 + Math.PI / 2, 0);
          leaf.rotateX(0.45);
          this.scene.add(leaf);
        }
      }
      // Ponton de bois (côté sud) et pirogue amarrée
      const dz = l.z + l.rz - 0.4;
      this.box(1.2, 0.1, 3, 0x8b6a45, l.x - l.rx * 0.3, 0.2, dz - 0.6, false);
      for (const [ox, oz] of [[-0.5, -1.9], [0.5, -1.9], [-0.5, 0.6], [0.5, 0.6]] as const) this.box(0.1, 0.6, 0.1, 0x5b4128, l.x - l.rx * 0.3 + ox, 0.1, dz + oz, false);
      this.box(3.2, 0.35, 0.8, 0x6b4423, l.x - l.rx * 0.3 + 1.6, 0.2, dz - 1.6, false);
      // Obstacle : rectangle intérieur de l'ellipse
      this.solid(l.x, l.z, l.rx * 1.5, l.rz * 1.5);
    }
  }

  private buildSea(): void {
    if (this.opts.sea) {
      this.seaMaxZ = this.opts.sea.grid.originZ + this.opts.sea.grid.rows * this.opts.sea.grid.cell + 6;
      this.buildPlotGrid('sea', this.opts.sea, 0.08);
    }
    for (const z of this.opts.zones ?? []) {
      // Une ancienne configuration du serveur ne doit jamais ramener le grand espace de droite
      // sur l'aéroport, le Port ou les quartiers. Il commence après le bord physique du terrain.
      const zone = z.id === 'east'
        ? { ...z, grid: { ...z.grid, originX: Math.max(z.grid.originX, EAST_AD_MIN_X) } }
        : z;
      // Sur les lagunes, les cases flottent juste au-dessus de l'eau
      this.buildPlotGrid(zone.id, zone, zone.id.startsWith('lac') ? 0.14 : 0.08);
      this.maxPanX = Math.max(this.maxPanX, zone.grid.originX + zone.grid.cols * zone.grid.cell);
    }
  }

  private buildPlotGrid(zone: string, sea: { grid: SeaGridSpec; plots: SeaPlotSpec[] }, y0: number): void {
    const { cols, rows, cell, originX, originZ } = sea.grid;
    this.plotGrids.set(zone, sea.grid);
    const taken = new Set<number>();
    for (const p of sea.plots) for (let i = 0; i < p.w; i++) for (let j = 0; j < p.h; j++) taken.add((p.y + j) * cols + p.x + i);
    // La grille terrestre reste visible dans son espace dédié, désormais situé au-delà du
    // contournement. Sa teinte sable la distingue des parcelles flottantes bleues.
    const waterCells = zone === 'sea' || zone.startsWith('lac');
    // Sur les lagunes : cases libres à peine visibles (contour d'eau claire translucide), cases prises en radeaux de bois,
    // pour que le lac reste un lac et non une dalle grise
    const lake = zone.startsWith('lac');
    const lakeFree = new THREE.MeshLambertMaterial({ color: 0xe6f6ff, transparent: true, opacity: 0.28, depthWrite: false });
    const free = this.instanced(new THREE.BoxGeometry(cell - (lake ? 0.9 : 0.4), lake ? 0.04 : 0.12, cell - (lake ? 0.9 : 0.4)), lake ? lakeFree : this.mats.color(waterCells ? 0xdcecfb : 0xd8c9a8), cols * rows, false);
    const held = this.instanced(new THREE.BoxGeometry(cell - (lake ? 0.7 : 0.4), lake ? 0.16 : 0.12, cell - (lake ? 0.7 : 0.4)), this.mats.color(lake ? 0xb98a55 : waterCells ? 0x9aa9bb : 0xa89776), cols * rows, false);
    let nf = 0;
    let nh = 0;
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        const cx = originX + x * cell + cell / 2;
        const cz = originZ + y * cell + cell / 2;
        if (taken.has(y * cols + x)) this.setInstance(held, nh++, cx, y0, cz);
        else this.setInstance(free, nf++, cx, y0, cz);
      }
    }
    free.count = nf;
    held.count = Math.max(0, nh);
    // Plan invisible au-dessus de la grille : une touche donne la case visée
    const pick = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(cols * cell, rows * cell)), new THREE.MeshBasicMaterial({ visible: false }));
    pick.rotation.x = -Math.PI / 2;
    pick.position.set(originX + (cols * cell) / 2, y0 + 0.07, originZ + (rows * cell) / 2);
    pick.userData.seaGrid = zone;
    this.scene.add(pick);
    this.boards.push(pick);
    for (const p of sea.plots) {
      if (!p.live || !p.title) continue;
      const w = p.w * cell - 0.4;
      const h = p.h * cell - 0.4;
      const tex = this.adArtTexture(p.title, p.sub ?? '', p.bg ?? '#1f6feb', p.fg ?? '#ffffff', w, h);
      const mat = new THREE.MeshBasicMaterial({ map: tex });
      const m = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(w, h)), mat);
      // Image de l'annonce (validée) : remplace l'affiche texte dès qu'elle est chargée
      if (p.image) {
        new THREE.TextureLoader().load(p.image, (img) => {
          img.colorSpace = THREE.SRGBColorSpace;
          this.mats.textures.push(img);
          mat.map = img;
          mat.needsUpdate = true;
        });
      }
      m.rotation.x = -Math.PI / 2;
      m.position.set(originX + (p.x + p.w / 2) * cell, y0 + 0.12, originZ + (p.y + p.h / 2) * cell);
      m.userData.plotId = p.id;
      this.scene.add(m);
      this.boards.push(m);
    }
  }

  /**
   * Lieux de marque des partenaires : boutique aux couleurs du partenaire, enseigne cliquable.
   * Un emplacement sur une route ou un lieu existant est ignoré (la ville reste cohérente).
   */
  /**
   * Terre-pleins centraux du boulevard Eyadéma au nord de la ville : bordure en béton qui suit la courbe de la route,
   * gazon, haies taillées, palmiers, fleurs et lampadaires à double bras (comme sur les grands boulevards de Lomé). Ils
   * s'interrompent aux carrefours (rue de l'OTR, rue de service, rond-point GTA, route de Kégué…) par une extrémité
   * arrondie, pour que les voies puissent se croiser. Purement décoratifs : la circulation n'en est pas affectée.
   */
  private buildMedians(): void {
    const gaps: [number, number][] = [[-152, 10], [-177, 9], [-224, 19], [-289, 10], [-318, 6]];
    const inGap = (z: number) => gaps.some(([gz, w]) => Math.abs(z - gz) < w);
    const STEP = 4;
    const hedge = [0x3f9a4f, 0x2f8a4a, 0x57a85a];
    const bloom = [0xe5383b, 0xffce00, 0xff7aa8, 0xffffff];
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1b8 });
    this.nightMaterials.push(lampMat as unknown as THREE.MeshLambertMaterial);
    const palm = (px: number, pz: number) => {
      const trunk = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.14, 0.22, 3.6, 8)), this.mats.color(0x7a5a3a));
      trunk.position.set(px, 1.95, pz);
      this.scene.add(trunk);
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2;
        const frond = this.box(2.2, 0.07, 0.45, k % 2 ? 0x2f8a4a : 0x3f9a4f, px + Math.cos(a) * 0.95, 3.85, pz + Math.sin(a) * 0.95, false);
        frond.rotation.y = -a;
        frond.rotation.z = 0.28;
      }
    };
    const nose = (px: number, pz: number) => {
      this.solid(px, pz, 1.5, 1.5, 0.3); // on ne marche pas sur le terre-plein (bas : la circulation, elle, n'y est pas bloquée)
      const cap = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.75, 0.75, 0.24, 14)), this.mats.color(0xe9e5db));
      cap.position.set(px, 0.12, pz);
      const turf = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.52, 0.52, 0.06, 14)), this.mats.color(0x6bbf59));
      turf.position.set(px, 0.27, pz);
      this.scene.add(cap, turf);
      this.box(0.5, 0.3, 0.5, 0xd22d2d, px, 0.4, pz, false);
    };
    let k = 0;
    for (let z = -122; z > -376; z -= STEP, k++) {
      const m = z - STEP / 2;
      if (inGap(z) || inGap(z - STEP) || inGap(m)) {
        // Extrémité arrondie à l'entrée du carrefour
        if (!inGap(z) && inGap(z - STEP)) nose(bend(0, z), z);
        if (inGap(z) && !inGap(z - STEP) && !inGap(m)) nose(bend(0, z - STEP), z - STEP);
        continue;
      }
      const mx = bend(0, m);
      if (this.blocked(mx, m, 0.4)) continue;
      // Le terre-plein est un obstacle : le joueur le contourne par les carrefours (ouvertures) au lieu de marcher dessus
      this.solid(mx, m, 1.5, STEP + 0.06, 0.3);
      const ang = Math.atan2(bend(0, z - STEP) - bend(0, z), -STEP);
      const curb = this.box(1.5, 0.24, STEP + 0.06, 0xe9e5db, mx, 0.12, m, false);
      const turf = this.box(1.0, 0.07, STEP - 0.1, 0x6bbf59, mx, 0.27, m, false);
      curb.rotation.y = turf.rotation.y = ang;
      // Haie taillée une fois sur deux, fleurs dessus par moments ; bandes rouge/blanc sur la bordure
      if (k % 2 === 0) {
        const h = this.box(0.7, 0.5, STEP - 0.8, hedge[k % hedge.length]!, mx, 0.55, m, false);
        h.rotation.y = ang;
      }
      if (k % 3 === 1) this.box(0.36, 0.22, 0.36, bloom[k % bloom.length]!, mx, 0.9, m, false);
      const stripe = this.box(1.52, 0.05, 0.5, k % 2 ? 0xffffff : 0xd22d2d, mx, 0.265, m + STEP / 2 - 0.3, false);
      stripe.rotation.y = ang;
      if (k % 3 === 0) palm(mx, m);
      // Lampadaire à double bras tous les 24 m, éclairé la nuit
      if (k % 6 === 3) {
        this.box(0.2, 6.4, 0.2, 0x4a5058, mx, 3.4, m, false);
        for (const side of [-1, 1]) {
          this.box(1.6, 0.12, 0.12, 0x4a5058, mx + side * 0.8, 6.5, m, false);
          const head = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.9, 0.2, 0.5)), lampMat);
          head.position.set(mx + side * 1.6, 6.42, m);
          this.scene.add(head);
        }
      }
    }
  }

  /**
   * Lampadaires le long de toutes les rues secondaires et routes du nord (nouvelles routes comprises) : un mât courbé tous
   * les 26 m, alternativement de chaque côté, tête éclairée la nuit. Jamais sur une chaussée, un lieu ou un terrain.
   * (Les boulevards de la grille ont leurs poteaux électriques, et le boulevard Eyadéma ses lampadaires de terre-plein.)
   */
  private buildStreetLights(): void {
    const spots: { x: number; z: number; dx: number; dz: number }[] = [];
    let flip = 1;
    for (const road of CITY_ROADS) {
      if (road === GRAND_BYPASS || AGOE_RAMPS.includes(road)) continue;
      let carry = 8;
      for (let i = 1; i < road.length; i++) {
        const [ax, az] = road[i - 1]!;
        const [bx, bz] = road[i]!;
        const len = Math.hypot(bx - ax, bz - az);
        if (len < 1) continue;
        const ux = (bx - ax) / len;
        const uz = (bz - az) / len;
        for (let d = carry; d < len; d += 26) {
          const x = ax + ux * d;
          const z = az + uz * d;
          flip = -flip;
          // Normale de la route, côté alternatif ; le bras part vers la chaussée
          const nx = -uz * flip;
          const nz = ux * flip;
          const px = x + nx * (ROAD_W / 2 + 1.6);
          const pz = z + nz * (ROAD_W / 2 + 1.6);
          if (this.onRoad(px, pz, 1.3) || this.blocked(px, pz, 0.7) || inLagoon(px, pz, 2)) continue;
          if (Math.hypot(px - CITY_RING.x, pz - CITY_RING.z) < CITY_RING.R + 3) continue;
          spots.push({ x: px, z: pz, dx: -nx, dz: -nz });
        }
        carry = (carry + Math.ceil((len - carry) / 26) * 26) - len;
        if (carry < 0) carry = 8;
      }
    }
    if (spots.length === 0) return;
    const pole = this.instanced(new THREE.CylinderGeometry(0.08, 0.12, 6.4, 8), this.mats.color(0x4a5058), spots.length, false);
    const arm = this.instanced(new THREE.BoxGeometry(1.7, 0.1, 0.1), this.mats.color(0x4a5058), spots.length, false);
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1b8 });
    this.nightMaterials.push(lampMat as unknown as THREE.MeshLambertMaterial);
    const head = this.instanced(new THREE.BoxGeometry(0.85, 0.16, 0.42), lampMat, spots.length, false);
    spots.forEach((p, i) => {
      const rot = -Math.atan2(p.dz, p.dx);
      this.setInstance(pole, i, p.x, 3.2, p.z);
      this.setInstance(arm, i, p.x + p.dx * 0.8, 6.35, p.z + p.dz * 0.8, 1, 1, 1, rot);
      this.setInstance(head, i, p.x + p.dx * 1.55, 6.28, p.z + p.dz * 1.55, 1, 1, 1, rot);
    });
  }

  /** Rond-point des cinq rues (voir CITY_RING) : chaussée circulaire, îlot fleuri et habillage commun. */
  private buildCityRoundabouts(): void {
    const { x, z, R, I } = CITY_RING;
    const ring = new THREE.Mesh(this.geo(new THREE.CircleGeometry(R, 48)), this.surface('#7d8693', 0.22, 'asphalt'));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(x, 0.04, z);
    ring.receiveShadow = this.profile.shadows;
    const curb = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(I + 0.35, I + 0.35, 0.34, 32)), this.mats.color(0xf3efe6));
    curb.position.set(x, 0.19, z);
    const island = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(I, I, 0.4, 32)), this.mats.color(0x6bbf59));
    island.position.set(x, 0.22, z);
    this.scene.add(ring, curb, island);
    this.solid(x, z, I * 1.8, I * 1.8);
    this.roundaboutDecor(x, z, R, I, true);
  }

  private readonly vipMats: THREE.Material[] = [];
  private readonly vipAnim: { gem: THREE.Mesh; beam: THREE.Mesh; ring: THREE.Mesh; y: number; phase: number }[] = [];

  /**
   * Espaces VIP libres : dalle lumineuse cernée d'un cadre, quatre bornes, faisceau de lumière vertical et gemme qui tourne
   * (visibles de loin depuis le dessus), plus une épingle « Espace VIP » cliquable. Or : doré ; Argent : argenté.
   */
  private buildVipSpots(): void {
    const mat = (c: number, o = 1, add = false) => {
      const m = new THREE.MeshBasicMaterial({ color: c, transparent: o < 1, opacity: o, depthWrite: o >= 1, blending: add ? THREE.AdditiveBlending : THREE.NormalBlending });
      this.vipMats.push(m);
      return m;
    };
    for (const sp of this.opts.vipSpots ?? []) {
      const kind = sp.tier === 'SILVER' ? 'silver' : sp.tier === 'BRONZE' ? 'bronze' : 'gold';
      // Or : grand emplacement ; Argent : moyen ; Bronze : petit
      const size = { gold: [21, 15], silver: [14, 12], bronze: [10, 9] }[kind];
      // Le cadre est rogné côté route : jamais sur la chaussée ni sur le trottoir
      const fit = this.fitVipRect(sp.x, sp.z, size[0]!, size[1]!);
      const W = fit.w;
      const D = fit.d;
      const col = { gold: 0xffc83d, silver: 0xdbe3ee, bronze: 0xd08a4e }[kind];
      const group = new THREE.Group();
      group.position.set(sp.x + fit.cx, 0, sp.z + fit.cz);
      const pad = new THREE.Mesh(this.geo(new THREE.BoxGeometry(W, 0.1, D)), mat(col, 0.3));
      pad.position.y = 0.09;
      group.add(pad);
      const edge = (w: number, d: number, x: number, z: number) => {
        const e = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, 0.16, d)), mat(col));
        e.position.set(x, 0.14, z);
        group.add(e);
      };
      edge(W, 0.35, 0, -D / 2);
      edge(W, 0.35, 0, D / 2);
      edge(0.35, D, -W / 2, 0);
      edge(0.35, D, W / 2, 0);
      for (const [px, pz] of [[-W / 2, -D / 2], [W / 2, -D / 2], [-W / 2, D / 2], [W / 2, D / 2]] as const) {
        const post = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.28, 0.34, 2.4, 8)), this.mats.color(0x20242c));
        post.position.set(px, 1.2, pz);
        const cap = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.42, 10, 8)), mat(col));
        cap.position.set(px, 2.6, pz);
        group.add(post, cap);
      }
      const beam = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(1.4, 2.6, 30, 16, 1, true)), mat(col, 0.16, true));
      beam.position.y = 15;
      beam.renderOrder = 2;
      const gem = new THREE.Mesh(this.geo(new THREE.OctahedronGeometry(1.5)), mat(col));
      gem.position.y = 5.5;
      gem.scale.y = 1.4;
      const ring = new THREE.Mesh(this.geo(new THREE.TorusGeometry(2.3, 0.1, 6, 36)), mat(col, 0.9));
      ring.rotation.x = Math.PI / 2;
      ring.position.y = 5.5;
      group.add(beam, gem, ring);
      this.scene.add(group);
      this.vipAnim.push({ gem, beam, ring, y: 5.5, phase: (sp.x * 0.13 + sp.z * 0.07) % 6 });
      // Épingle cliquable
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `pin pin-vip ${kind}`;
      b.setAttribute('aria-label', sp.label);
      const ic = document.createElement('span');
      ic.className = 'pin-icon';
      ic.textContent = { gold: '👑', silver: '⭐', bronze: '🥉' }[kind];
      const tx = document.createElement('span');
      tx.className = 'pin-label';
      tx.textContent = sp.label;
      b.append(ic, tx);
      b.addEventListener('click', () => this.opts.onVipSpot?.(sp.id));
      this.pinLayer.appendChild(b);
      this.pins.push({ id: `vip:${sp.id}`, el: b, pos: new THREE.Vector3(sp.x + fit.cx, 8.2, sp.z + fit.cz) });
    }
  }

  /**
   * Rectangle réellement dessiné d'un espace VIP : on part de la taille nominale et on rentre chaque côté qui touche une route
   * (chaussée + trottoir), sans descendre sous 55 % de la taille. Renvoie sa taille et le décalage de son centre.
   */
  private fitVipRect(x: number, z: number, w: number, d: number): { w: number; d: number; cx: number; cz: number } {
    const CLEAR = 2.4;
    let x0 = -w / 2;
    let x1 = w / 2;
    let z0 = -d / 2;
    let z1 = d / 2;
    const hit = (ax: number, az: number, bx: number, bz: number): boolean => {
      const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az)));
      for (let i = 0; i <= n; i++) if (this.onRoad(x + ax + ((bx - ax) * i) / n, z + az + ((bz - az) * i) / n, CLEAR)) return true;
      return false;
    };
    for (let k = 0; k < 40; k++) {
      let moved = false;
      if (x1 - x0 > w * 0.55 && hit(x0, z0, x0, z1)) { x0 += 0.5; moved = true; }
      if (x1 - x0 > w * 0.55 && hit(x1, z0, x1, z1)) { x1 -= 0.5; moved = true; }
      if (z1 - z0 > d * 0.55 && hit(x0, z0, x1, z0)) { z0 += 0.5; moved = true; }
      if (z1 - z0 > d * 0.55 && hit(x0, z1, x1, z1)) { z1 -= 0.5; moved = true; }
      if (!moved) break;
    }
    return { w: x1 - x0, d: z1 - z0, cx: (x0 + x1) / 2, cz: (z0 + z1) / 2 };
  }

  /** Gemmes qui tournent et flottent, faisceaux et anneaux qui pulsent. */
  private updateVipSpots(): void {
    if (this.vipAnim.length === 0) return;
    const t = performance.now() / 1000;
    for (const v of this.vipAnim) {
      v.gem.rotation.y = t * 1.4 + v.phase;
      v.gem.position.y = v.y + Math.sin(t * 1.6 + v.phase) * 0.35;
      v.ring.position.y = v.gem.position.y;
      v.ring.scale.setScalar(1 + Math.sin(t * 2 + v.phase) * 0.08);
      (v.beam.material as THREE.MeshBasicMaterial).opacity = 0.13 + Math.sin(t * 2.2 + v.phase) * 0.05;
    }
  }

  private buildBrands(): void {
    for (const b of this.opts.brands ?? []) {
      if (!this.isFree(b.x, b.z, 4)) continue;
      this.brandModel(b);
      // Zone de toucher invisible sur tout le bâtiment : avant, seules l'enseigne et le totem réagissaient au clic
      const [hw, hh, hd, hz] = ({ tower: [12, 28, 8, -1], restaurant: [13, 6, 8, -2.5], shop: [13.5, 6, 8.5, -2], station: [15, 6, 10, 0.5], transport: [14, 5, 10, -1.5], clinic: [13.5, 9, 8.5, -2], hotel: [11.5, 15, 7.5, -3] } as Record<string, number[]>)[b.model ?? 'agency'] ?? [13.5, 8, 8.5, -2];
      const hit = new THREE.Mesh(this.geo(new THREE.BoxGeometry(hw!, hh!, hd!)), new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, colorWrite: false }));
      hit.position.set(b.x, hh! / 2, b.z + hz!);
      hit.userData.brandId = b.id;
      this.scene.add(hit);
      this.boards.push(hit);
      this.brandSpots.push(b);
    }
  }

  /**
   * Bâtiment de marque d'un partenaire : un modèle choisi par l'admin (inspiré des lieux du jeu : tour Yas, gare Gozem,
   * restaurant EZA ZOZO…), aux couleurs et au nom du partenaire. Façade vers le sud ; emprise d'environ 16 × 14.
   * L'enseigne est cliquable (fiche du partenaire, lien vers son site).
   */
  private brandModel(b: BrandSpot): void {
    const { x, z } = b;
    const main = new THREE.Color(b.color).getHex();
    const dark = new THREE.Color(b.color).multiplyScalar(0.6).getHex();
    const pale = new THREE.Color(b.color).lerp(new THREE.Color(0xffffff), 0.82).getHex();
    const glass = 0x8fb4c8;
    const white = 0xf4f2ee;
    const steel = 0x59626b;
    // Vitres qui s'allument la nuit
    const winMat = new THREE.MeshLambertMaterial({ color: 0x35566b, emissive: 0xffd27a, emissiveIntensity: 0 });
    this.nightMaterials.push(winMat);
    this.nightScale.set(winMat, 0.55);
    // Grandes vitres (vitrines, façades vitrées) : elles s'éclairent aussi la nuit, comme les fenêtres
    const glowMat = new THREE.MeshLambertMaterial({ color: glass, emissive: 0xffd27a, emissiveIntensity: 0 });
    this.nightMaterials.push(glowMat);
    this.nightScale.set(glowMat, 0.2);
    const glassBox = (w: number, h: number, d: number, gx: number, gy: number, gz: number, cast = true): THREE.Mesh => {
      const m = this.box(w, h, d, glass, gx, gy, gz, cast);
      m.material = glowMat;
      return m;
    };
    const lampMat = new THREE.MeshBasicMaterial({ color: 0xfff1b8 });
    this.nightMaterials.push(lampMat as unknown as THREE.MeshLambertMaterial);
    const sign = (w: number, h: number, y: number, sz: number, sub = '') => {
      const m = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(w, h)), new THREE.MeshBasicMaterial({ map: this.brandSignTexture(b.label, sub, b.color, b.logo, 768, Math.max(64, Math.round((768 * h) / w))) }));
      m.position.set(x, y, sz);
      m.userData.brandId = b.id;
      this.scene.add(m);
      this.boards.push(m);
      this.nightMaterials.push(m.material as unknown as THREE.MeshLambertMaterial);
    };
    /** Fenêtres alignées : cadre clair, vitre éclairée la nuit, traverse. `n` colonnes centrées sur cx. */
    const windows = (cx: number, fz: number, ys: number[], n: number, step: number, w = 1.1, h = 1.5) => {
      for (const wy of ys) for (let i = 0; i < n; i++) {
        const wx = cx + (i - (n - 1) / 2) * step;
        this.box(w + 0.25, h + 0.25, 0.1, steel, wx, wy, fz, false);
        const pane = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w * 0.8, h * 0.78, 0.12)), winMat);
        pane.position.set(wx, wy, fz + 0.03);
        this.scene.add(pane);
        this.box(0.06, h, 0.14, steel, wx, wy, fz + 0.05, false);
      }
    };
    const planter = (px: number, pz: number, w = 1.6) => {
      this.box(w, 0.55, 0.7, 0xb9b3a8, px, 0.3, pz);
      const shrub = new THREE.Mesh(this.geo(new THREE.SphereGeometry(w * 0.42, 8, 6)), this.mats.color(0x3f8f4a));
      shrub.position.set(px, 0.85, pz);
      shrub.scale.y = 0.8;
      this.scene.add(shrub);
    };
    const flag = (px: number, pz: number) => {
      this.box(0.12, 7.5, 0.12, 0xc8ccd2, px, 3.75, pz, false);
      this.box(1.8, 0.95, 0.05, main, px + 0.95, 6.8, pz, false);
      this.box(1.8, 0.3, 0.06, white, px + 0.95, 6.8, pz, false);
    };
    const lamp = (px: number, pz: number) => {
      this.box(0.14, 3.4, 0.14, steel, px, 1.7, pz, false);
      const head = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.5, 0.18, 0.5)), lampMat);
      head.position.set(px, 3.45, pz);
      this.scene.add(head);
    };
    /** Totem lumineux à l'entrée : socle, fût blanc, tête aux couleurs et logo (ou nom). */
    const totem = (px: number, pz: number) => {
      this.box(1.7, 0.3, 1, 0xb9b3a8, px, 0.15, pz);
      this.box(1.4, 3.5, 0.55, white, px, 2.05, pz);
      this.box(1.5, 0.35, 0.65, main, px, 3.95, pz, false);
      const face = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(1.25, 1.25)), new THREE.MeshBasicMaterial({ map: this.brandSignTexture(b.label, '', b.color, b.logo, 256, 256) }));
      face.position.set(px, 2.8, pz + 0.29);
      face.userData.brandId = b.id;
      this.scene.add(face);
      this.boards.push(face);
      this.nightMaterials.push(face.material as unknown as THREE.MeshLambertMaterial);
      this.box(1.1, 0.12, 0.45, dark, px, 1.1, pz + 0.05, false);
    };
    // Parvis : dalle, pelouse bordée de haies, allée dallée, mât au drapeau de la marque, lampadaires et totem
    this.box(16, 0.12, 14, 0xe4e0d6, x, 0.06, z + 0.5, false);
    for (const sx of [-1, 1]) {
      this.box(5.6, 0.05, 3.2, 0x7fb069, x + sx * 5.3, 0.15, z + 5.6, false);
      this.box(5.6, 0.6, 0.6, 0x3f8f4a, x + sx * 5.3, 0.4, z + 7.1, false);
    }
    this.box(3.2, 0.05, 14, 0xd9d2c3, x, 0.15, z + 0.5, false);
    flag(x - 7.2, z + 6.3);
    lamp(x + 7.4, z + 6.8);
    lamp(x - 7.4, z - 5.6);
    totem(x + 6.2, z + 5.2);
    switch (b.model) {
      case 'tower': {
        // Siège en tour vitrée (comme Yas) : socle à hall vitré, fût à rubans de fenêtres, couronne éclairée, antenne et enseigne
        this.box(12, 3.2, 8, dark, x, 1.6, z - 1);
        glassBox(8.4, 2.3, 0.1, x, 1.7, z + 3.06, false);
        glassBox(9, 20, 7, x, 13.2, z - 1.5);
        for (let k = 0; k < 6; k++) this.box(9.1, 0.25, 7.1, white, x, 4.5 + k * 3.2, z - 1.5, false);
        windows(x, z + 2.04, [6.1, 9.3, 12.5, 15.7, 18.9, 22], 5, 1.7, 1.2, 1.6);
        for (const dx of [-4.6, 4.6]) this.box(0.5, 20.4, 7.2, main, x + dx, 13.2, z - 1.5, false);
        this.box(9.6, 1.4, 7.6, main, x, 23.9, z - 1.5);
        this.box(9.9, 0.25, 7.9, white, x, 24.7, z - 1.5, false);
        this.box(3, 1.6, 3, steel, x - 2, 25.6, z - 2, false);
        this.box(0.18, 6, 0.18, 0xc8ccd2, x + 2.5, 28, z - 2, false);
        this.box(6, 0.15, 3, main, x, 3.4, z + 4, false);
        for (const dx of [-2.8, 2.8]) this.box(0.2, 3.3, 0.2, 0xc8ccd2, x + dx, 1.65, z + 5.3, false);
        this.entrance(x, z + 3, 2.4, 2.4);
        this.solid(x, z - 1, 12, 8);
        sign(8, 1.8, 23.9, z + 2.35);
        break;
      }
      case 'restaurant': {
        // Restaurant ou maquis (comme EZA ZOZO) : salle vitrée, toit débordant, cheminée, guirlandes et terrasse à parasols
        this.box(12, 4.2, 7, white, x, 2.1, z - 2.5);
        this.box(13, 0.6, 8, dark, x, 4.5, z - 2.5);
        this.box(1, 1.6, 1, 0xb9b3a8, x - 4, 5.6, z - 4, false);
        glassBox(10, 2, 0.1, x, 1.7, z + 1.06, false);
        windows(x, z + 1.1, [2.2], 2, 8, 1.6, 1.8);
        this.entrance(x, z + 1, 2, 2.4);
        this.box(12, 0.12, 4.5, 0xc9a77c, x, 0.14, z + 3.4, false);
        for (const dx of [-4.2, 4.2]) {
          this.box(0.12, 2.2, 0.12, 0x6b5440, x + dx, 1.1, z + 3.4, false);
          const top = new THREE.Mesh(this.geo(new THREE.ConeGeometry(1.7, 0.7, 8)), this.mats.color(dx < 0 ? white : main));
          top.position.set(x + dx, 2.4, z + 3.4);
          this.scene.add(top);
          this.box(1.4, 0.7, 0.9, 0x8a6a4a, x + dx, 0.35, z + 3.4, false);
        }
        for (let k = 0; k < 9; k++) {
          const bulb = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.11, 6, 4)), lampMat);
          bulb.position.set(x - 5.6 + k * 1.4, 3.7 - Math.sin((k / 8) * Math.PI) * -0.25, z + 4.2);
          this.scene.add(bulb);
        }
        this.box(0.9, 1.2, 0.08, 0x2b2f33, x + 3.2, 1.2, z + 1.15, false);
        planter(x - 3.2, z + 1.5);
        this.solid(x, z - 2.5, 12, 7);
        sign(9, 1.5, 3.6, z + 1.12, 'RESTAURANT');
        break;
      }
      case 'shop': {
        // Boutique ou supérette : vitrine éclairée avec étagères, auvent rayé, enseigne en bandeau, caisses empilées
        this.box(13, 5, 8, white, x, 2.5, z - 2);
        glassBox(11.5, 3, 0.1, x, 1.8, z + 2.06, false);
        for (const dx of [-4.2, -1.4, 4.2]) for (const sy of [0.9, 1.9, 2.7]) this.box(2.2, 0.08, 0.5, pale, x + dx, sy, z + 1.7, false);
        for (let k = 0; k < 7; k++) this.box(1.8, 0.12, 1.8, k % 2 ? main : white, x - 5.4 + k * 1.8, 3.6, z + 2.9, false).rotation.x = 0.35;
        this.box(13.4, 0.5, 8.4, dark, x, 5.2, z - 2);
        this.box(2.4, 0.8, 0.12, white, x + 5.2, 4.4, z + 2.1, false);
        for (let k = 0; k < 3; k++) this.box(0.8, 0.5, 0.6, [0xe5383b, 0xffce00, 0x22a861][k]!, x - 5.6 + k * 0.9, 0.3, z + 3.6);
        this.entrance(x, z + 2, 2.4, 2.5);
        planter(x - 4.5, z + 4.6);
        this.solid(x, z - 2, 13, 8);
        sign(10, 1.4, 4.5, z + 2.07);
        break;
      }
      case 'station': {
        // Station-service moderne : grand auvent plat blanc cerclé de la couleur de la marque, plafond à spots encastrés, piliers carrés,
        // deux îlots de pompes à tête colorée, boutique sur le côté, logo sur le bandeau et au totem
        this.box(15, 0.1, 9, 0x4a4f57, x, 0.1, z + 1.5, false);
        this.box(15.2, 0.5, 8, white, x, 5.05, z + 1.5, true);
        this.box(15.5, 0.2, 8.5, white, x, 5.45, z + 1.5, false);
        this.box(15.5, 0.75, 0.25, main, x, 5.1, z + 5.7, false);
        this.box(15.5, 0.75, 0.25, main, x, 5.1, z - 2.7, false);
        for (const sx of [-1, 1]) this.box(0.25, 0.75, 8.5, main, x + sx * 7.7, 5.1, z + 1.5, false);
        // Piliers carrés aux deux bouts de l'îlot central
        for (const dx of [-6.2, 6.2]) {
          this.box(0.8, 4.8, 0.8, 0xe6e8ea, x + dx, 2.4, z + 1.5);
          this.box(0.84, 0.5, 0.84, main, x + dx, 4.4, z + 1.5, false);
          this.solid(x + dx, z + 1.5, 1, 1);
        }
        for (let ix = 0; ix < 4; ix++) {
          for (let iz = 0; iz < 3; iz++) {
            const spot = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.7, 0.05, 0.7)), lampMat);
            spot.position.set(x - 5.25 + ix * 3.5, 4.77, z - 0.5 + iz * 2);
            this.scene.add(spot);
          }
        }
        const underLight = new THREE.PointLight(0xfff0d0, 0, 24, 1.6);
        underLight.position.set(x, 4.3, z + 1.5);
        this.scene.add(underLight);
        this.pointLights.push(underLight);
        // Îlot central parallèle à la rue : quatre pompes à écrans sur les deux faces, voies de chaque côté
        this.box(13, 0.25, 1.5, 0xb9bec5, x, 0.2, z + 1.5, false);
        for (let k = 0; k < 13; k++) this.box(0.98, 0.27, 1.52, k % 2 ? 0xf4f4f1 : main, x - 6 + k, 0.21, z + 1.5, false);
        for (const dx of [-3.6, -1.2, 1.2, 3.6]) {
          this.box(0.9, 1.7, 0.6, 0xf4f4f1, x + dx, 1.1, z + 1.5);
          this.solid(x + dx, z + 1.5, 1, 0.8);
          this.box(1, 0.45, 0.64, main, x + dx, 2.1, z + 1.5, false);
          for (const f of [-1, 1]) {
            this.box(0.5, 0.35, 0.05, 0x22262b, x + dx, 1.5, z + 1.5 + f * 0.32, false);
            this.box(0.1, 0.9, 0.1, 0x222428, x + dx + 0.55, 1.2, z + 1.5 + f * 0.27, false);
          }
        }
        this.box(8, 3.4, 4, white, x, 1.7, z - 4.8);
        windows(x, z - 2.74, [1.8], 3, 2.4, 1.6, 1.3);
        this.box(1.6, 2.3, 0.12, dark, x + 3, 1.15, z - 2.72, false);
        this.box(8.4, 0.3, 4.4, main, x, 3.5, z - 4.8, false);
        this.solid(x, z - 4.8, 8, 4);
        sign(12, 0.6, 5.1, z + 5.84);
        sign(5, 0.9, 3, z - 2.73);
        break;
      }
      case 'transport': {
        // Société de transport (comme la gare Gozem) : bureau vitré, préau, motos et voitures aux couleurs de la marque
        this.box(9, 4, 6, white, x - 2.5, 2, z - 3.5);
        this.box(9.4, 0.5, 6.4, main, x - 2.5, 4.2, z - 3.5);
        glassBox(7, 2.2, 0.1, x - 2.5, 1.6, z - 0.44, false);
        windows(x - 2.5, z - 0.4, [2.4], 3, 2.6, 1.5, 1.3);
        this.entrance(x - 2.5, z - 0.45, 2, 2.3);
        this.box(5, 0.3, 9, main, x + 5, 3.2, z + 0.5, false);
        this.box(5.2, 0.12, 9.2, white, x + 5, 3.4, z + 0.5, false);
        for (const dz of [-3.5, 4.5]) this.box(0.3, 3.2, 0.3, 0xd7dbe0, x + 5, 1.6, z + dz, false);
        for (let k = 0; k < 4; k++) {
          const mx = x + 4 + (k % 2) * 2;
          const mz = z - 2 + Math.floor(k / 2) * 3.4;
          this.box(0.5, 0.7, 1.6, 0x23262b, mx, 0.45, mz, false);
          this.box(0.55, 0.25, 0.9, main, mx, 0.95, mz, false);
          this.box(0.5, 0.5, 0.35, white, mx, 1.35, mz - 0.3, false);
        }
        this.box(0.12, 2.6, 0.12, steel, x - 7, 1.3, z - 0.4, false);
        this.box(1.1, 0.5, 0.05, main, x - 7, 2.5, z - 0.4, false);
        this.solid(x - 2.5, z - 3.5, 9, 6);
        sign(8, 1.3, 3.4, z - 0.43);
        break;
      }
      case 'clinic': {
        // Clinique ou pharmacie : deux niveaux blancs à bandeau de couleur, rangées de fenêtres, croix lumineuse, rampe d'accès
        this.box(13, 7, 8, white, x, 3.5, z - 2);
        this.box(13.1, 0.5, 8.1, main, x, 3.6, z - 2, false);
        this.box(13.4, 0.4, 8.4, dark, x, 7.1, z - 2, false);
        windows(x, z + 2.04, [5.4], 4, 2.8, 1.4, 1.5);
        windows(x + 4, z + 2.04, [1.9], 1, 1, 1.4, 1.6);
        windows(x - 4, z + 2.04, [1.9], 1, 1, 1.4, 1.6);
        this.entrance(x, z + 2, 2.6, 2.5);
        const cross = new THREE.MeshBasicMaterial({ color: 0x22a861 });
        this.nightMaterials.push(cross as unknown as THREE.MeshLambertMaterial);
        for (const [w, h] of [[2.4, 0.8], [0.8, 2.4]]) {
          const m = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, h, 0.3)), cross);
          m.position.set(x + 5.2, 8.7, z + 1.6);
          this.scene.add(m);
        }
        this.box(2.2, 0.3, 5, 0xd9d3c4, x - 5.2, 0.2, z + 3.8, false);
        planter(x + 4.2, z + 3.2);
        this.solid(x, z - 2, 13, 8);
        sign(7, 1.2, 7.6, z + 2.07);
        break;
      }
      case 'hotel': {
        // Hôtel : immeuble à balcons filants et fenêtres, marquise d'entrée, enseigne en couronnement, piscine bordée de transats
        this.box(11, 14, 7, white, x - 1.5, 7, z - 3);
        for (let k = 0; k < 4; k++) this.box(11.2, 0.3, 1, main, x - 1.5, 3.5 + k * 3, z + 0.9, false);
        windows(x - 1.5, z + 0.56, [2.2, 5.2, 8.2, 11.2], 4, 2.4, 1.3, 1.6);
        this.box(11.4, 0.5, 7.4, dark, x - 1.5, 14.2, z - 3, false);
        this.box(5, 0.3, 3, dark, x - 1.5, 3, z + 2, false);
        for (const dx of [-3.5, 0.5]) this.box(0.2, 3, 0.2, 0xc8ccd2, x - 1.5 + dx, 1.5, z + 3.3, false);
        this.entrance(x - 1.5, z + 0.5, 2.2, 2.3);
        this.box(3.5, 0.1, 5, 0x3fa7d6, x + 6, 0.16, z + 2, false);
        for (const dz of [0.4, 1.6, 2.8]) this.box(0.5, 0.2, 1, white, x + 4.1, 0.3, z + dz, false);
        this.solid(x - 1.5, z - 3, 11, 7);
        sign(8, 1.4, 14.9, z + 0.57, 'HÔTEL');
        break;
      }
      default: {
        // Agence (banque, assurance, télécom) : façade vitrée sur deux niveaux, bandeau de marque, auvent, distributeur
        this.box(13, 7, 8, white, x, 3.5, z - 2);
        glassBox(11, 5.4, 0.1, x, 3.4, z + 2.06, false);
        windows(x, z + 2.1, [5.4], 4, 2.8, 1.5, 1.4);
        this.box(13.4, 0.8, 8.4, main, x, 7.2, z - 2);
        this.box(13.6, 0.2, 8.6, white, x, 7.7, z - 2, false);
        this.box(6, 0.25, 2.2, dark, x, 3, z + 3, false);
        for (const dx of [-2.6, 2.6]) this.box(0.18, 3, 0.18, 0xc8ccd2, x + dx, 1.5, z + 4, false);
        this.entrance(x, z + 2, 2.4, 2.5);
        this.box(1, 2, 0.5, 0x3a3f47, x - 4.4, 1, z + 2.3, false);
        glassBox(0.7, 0.5, 0.05, x - 4.4, 1.4, z + 2.57, false);
        planter(x + 4.2, z + 3.2);
        this.solid(x, z - 2, 13, 8);
        sign(10, 1.4, 7.2, z + 2.27);
        break;
      }
    }
  }

  /** Grands panneaux publicitaires le long du boulevard et des avenues. */
  private buildBillboards(): void {
    const ads = this.opts.ads;
    const free = this.opts.freeBoard;
    // Emplacements numérotés (un panneau réservé garde son numéro) : si un lieu occupe l'endroit,
    // le panneau glisse le long de sa route jusqu'à une place libre. Puis des panneaux en plus
    // le long de toutes les routes, pour les campagnes « tous panneaux ».
    // Tous les panneaux sont tournés face au sud, vers la caméra de la carte : posés de profil le long des avenues
    // nord-sud, ils n'étaient qu'un trait illisible. Le long de ces avenues, ils glissent dans l'axe de la route (slideZ).
    const base: [number, number, number, boolean][] = [];
    for (const z of [ROADS_Z[0]! - 10, ROADS_Z[1]! - 10, ROADS_Z[2]! - 10]) for (let x = -120; x <= 120; x += 48) base.push([x + 10, z, 0, false]);
    for (const x of [ROADS_X[1]! + 12, ROADS_X[3]! + 12]) for (let z = -120; z <= -10; z += 45) base.push([x, z + 12, 0, true]);
    const extra: [number, number, number, boolean][] = [];
    for (const rz of ROADS_Z) for (let x = -128; x <= 128; x += 26) extra.push([x, rz + (rz === 14 ? -10 : 10), 0, false]);
    for (const rx of ROADS_X) for (let z = -100; z <= 0; z += 26) extra.push([rx + (rx < 0 ? 12 : -12), z, 0, true]);
    const placed: [number, number][] = [];
    // Aucun panneau sur la place de l'Indépendance ni à ses abords (anneau de 13,5 m + marge) : le monument reste dégagé
    // Même règle autour de la cathédrale, du Grand Marché, de la BOAD, de l'hôtel du 2 Février et de la BCEAO (façades à voir), du siège de la CNSS (jardin, fontaine et enceinte), du siège-station Gozem (tour, baie à motos, abri) et des sièges Moov Africa et Yas (façade et bannières à voir)
    const clearVenues = [{ id: 'monument', r: 26 }, { id: 'cnss', r: 34 }, { id: 'station_zem', r: 30 }, { id: 'moov_africa', r: 26 }, { id: 'yas', r: 30 }, { id: 'bank_boa_1', r: 22 }, { id: 'akodessewa', r: 20 }, { id: 'cathedrale', r: 24 }, { id: 'marche_assigame', r: 22 }, { id: 'boad', r: 22 }, { id: 'hotel_2fevrier', r: 18 }, { id: 'bceao', r: 16 }].flatMap((c) => {
      const v = this.opts.venues.find((x) => x.id === c.id);
      return v ? [{ x: v.x, z: v.z, r: c.r }] : [];
    });
    // Devant la maison du joueur : la caméra de rue s'y tient en sortant, un pied de panneau la bouchait
    clearVenues.push({ x: this.opts.home.x, z: this.opts.home.z, r: 22 });
    const inPlace = (qx: number, qz: number) => clearVenues.some((c) => Math.hypot(qx - c.x, qz - c.z) < c.r);
    const footprintFree = (x: number, z: number, rot: number) => {
      // Le panneau fait 13 m de large et porte deux pieds : chaque point de son emprise doit
      // rester hors chaussée, hors mur et hors lieu, pas uniquement son centre.
      for (const along of [-6.7, -4.5, 0, 4.5, 6.7]) for (const normal of [-1.5, 0, 1.5]) {
        const qx = x + Math.cos(rot) * along + Math.sin(rot) * normal;
        const qz = z - Math.sin(rot) * along + Math.cos(rot) * normal;
        if (inPlace(qx, qz) || this.onRoad(qx, qz, 1.2) || this.blocked(qx, qz, 0.9) || !this.isFree(qx, qz, 0.9)) return false;
      }
      return true;
    };
    const settle = ([x, z, rot, slideZ]: [number, number, number, boolean]): [number, number, number] | null => {
      for (const d of [0, 8, -8, 16, -16, 24, -24]) {
        let px = slideZ ? x : x + d;
        let pz = slideZ ? z + d : z;
        // suit la courbe de la route qui le porte
        if (slideZ) px += bend(nearest(px, ROADS_X), pz);
        else pz += bend(nearest(pz, ROADS_Z), px);
        // Le panneau fait 13 de large : on le tient loin des lagunes
        if (!footprintFree(px, pz, rot) || inLagoon(px, pz, 8) || placed.some(([qx, qz]) => Math.hypot(qx - px, qz - pz) < 22)) continue;
        placed.push([px, pz]);
        return [px, pz, rot];
      }
      return null;
    };
    // Repli : dans le centre dense, aucun emplacement d'origine n'est libre (les lieux et leurs parvis occupent tout) et les
    // panneaux numérotés disparaissaient. On cherche alors, au plus près de l'emplacement voulu, le long des routes réelles,
    // une place qui ne touche ni route, ni bâtiment ou mur (obstacles réels), ni lagune, ni zone de terrain, ni espace VIP.
    const roadPts = roadSamples();
    const relaxedFree = (x: number, z: number): boolean => {
      for (const along of [-6.7, 0, 6.7]) for (const normal of [-1.5, 0, 1.5]) {
        const qx = x + along;
        const qz = z + normal;
        if (inPlace(qx, qz) || this.onRoad(qx, qz, 1.2) || this.blocked(qx, qz, 0.9) || inLagoon(qx, qz, 8)) return false;
        for (const lz of this.opts.land ?? []) {
          const g = lz.layout;
          if (qx > g.originX - 4 && qx < g.originX + g.cols * g.cell + 4 && qz > g.originZ - 4 && qz < g.originZ + (lz.planRows ?? g.rows) * g.cell + 4) return false;
        }
        if ((this.opts.vipSpots ?? []).some((v) => Math.abs(v.x - qx) < 13 && Math.abs(v.z - qz) < 11)) return false;
      }
      return true;
    };
    const fallback = ([bx, bz]: [number, number, number, boolean]): [number, number, number] | null => {
      const cand: [number, number, number][] = [];
      for (const [sx, sz] of roadPts) {
        if (Math.abs(sx - bx) > 160 || Math.abs(sz - bz) > 160) continue;
        for (const [ox, oz] of [[0, 11.5], [0, -11.5], [13.5, 0], [-13.5, 0]] as const) {
          const cx = sx + ox;
          const cz = sz + oz;
          cand.push([cx, cz, Math.hypot(cx - bx, cz - bz)]);
        }
      }
      cand.sort((a, b) => a[2] - b[2]);
      for (const [cx, cz] of cand) {
        if (placed.some(([qx, qz]) => Math.hypot(qx - cx, qz - cz) < 24)) continue;
        if (!relaxedFree(cx, cz)) continue;
        placed.push([cx, cz]);
        return [cx, cz, 0];
      }
      return null;
    };
    const spots = [...base, ...extra].map((s, i) => settle(s) ?? (i < NUMBERED_BOARDS ? fallback(s) : null));
    // Grands panneaux sur pieds, visibles de loin sur la carte (format 2:1)
    const post = this.geo(new THREE.BoxGeometry(0.5, 10, 0.5));
    const board = this.geo(new THREE.BoxGeometry(13, 6.5, 0.35));
    const face = this.geo(new THREE.PlaneGeometry(12.4, 6));
    const BOARD_Y = 12.8;
    const BOARD_TILT = (8 * Math.PI) / 180;
    spots.forEach((spot, i) => {
      if (!spot) return;
      const [x, z, rot] = spot;
      // Campagne réservée sur cet emplacement, sinon rotation des campagnes « tous panneaux »
      const own = ads.filter((a) => a.slot === i);
      const shared = ads.filter((a) => a.slot === -1);
      // Sans annonce, les emplacements numérotés restent debout, à louer ; les panneaux en plus n'apparaissent qu'avec des annonces
      const vacant = own.length === 0 && shared.length === 0;
      if (vacant && (!free || i >= NUMBERED_BOARDS)) return;
      const pool = vacant ? [{ id: 'free', slot: i, title: free!.title, sub: free!.sub, bg: '#ffffff', fg: '#1b1f24' }] : own.length > 0 ? own : shared;
      const ad = pool[i % pool.length]!;
      const g = new THREE.Group();
      const start = i % pool.length;
      const p1 = new THREE.Mesh(post, this.mats.color(0x3a3f47));
      p1.position.set(-4.5, 5, 0);
      const p2 = p1.clone();
      p2.position.x = 4.5;
      const b = new THREE.Mesh(board, this.mats.color(0x1b1f24));
      b.position.y = BOARD_Y;
      const mat = new THREE.MeshBasicMaterial({ map: this.adTexture(ad) });
      if (pool.length === 1) this.adMats.set(ad.id, [...(this.adMats.get(ad.id) ?? []), mat]);
      this.nightMaterials.push(mat as unknown as THREE.MeshLambertMaterial);
      const f = new THREE.Mesh(face, mat);
      f.position.set(0, BOARD_Y, 0.19);
      const back = new THREE.Mesh(face, mat);
      back.position.set(0, BOARD_Y, -0.19);
      back.rotation.y = Math.PI;
      // Cadre métallique, étiquette « AD » et projecteurs (éclairés la nuit)
      const frame = new THREE.Mesh(this.geo(new THREE.BoxGeometry(13.4, 0.35, 0.5)), this.mats.color(0x9aa1a8));
      frame.position.set(0, BOARD_Y + 3.35, 0);
      const frameB = frame.clone();
      frameB.position.y = BOARD_Y - 3.35;
      const tag = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(1.4, 0.6)), new THREE.MeshBasicMaterial({ map: this.posterTexture('AD', '', '#ffffff', '#1b1f24', 128, 56) }));
      tag.position.set(5.6, BOARD_Y + 3.95, 0.2);
      const lampGeo = this.geo(new THREE.BoxGeometry(0.7, 0.3, 0.9));
      const plate: THREE.Mesh[] = [];
      for (const lx of [-4, 0, 4]) {
        const arm = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.12, 0.12, 1.4)), this.mats.color(0x3a3f47));
        arm.position.set(lx, BOARD_Y + 3.6, 0.8);
        const lamp = new THREE.Mesh(lampGeo, this.mats.color(0xfff2b0));
        lamp.position.set(lx, BOARD_Y + 3.6, 1.5);
        g.add(arm, lamp);
        plate.push(arm, lamp);
      }
      g.add(p1, p2, b, f, back, frame, frameB, tag);
      // Le panneau est incliné vers la caméra de la carte (comme un vrai panneau penché vers la route) : vu de dessus, il reste lisible
      const c = Math.cos(BOARD_TILT);
      const sn = Math.sin(BOARD_TILT);
      for (const m of [f, back, b, frame, frameB, tag, ...plate]) {
        const dy = m.position.y - BOARD_Y;
        const dz = m.position.z;
        m.position.y = BOARD_Y + dy * c + dz * sn;
        m.position.z = -dy * sn + dz * c;
        m.rotation.x = -BOARD_TILT;
      }
      for (const m of [f, back, b]) {
        m.userData.panel = i;
        if (vacant) m.userData.freeSlot = i;
        else m.userData.adId = ad.id;
      }
      this.boards.push(f, back, b);
      // Écran géant : les annonces de ce panneau défilent tour à tour (décalées d'un panneau à l'autre)
      if (pool.length > 1) this.screens.push({ mat, meshes: [f, back, b], pool, shown: start, offset: i * 1.7 });
      g.position.set(x, 0, z);
      g.rotation.y = rot;
      g.traverse((o) => {
        if (o instanceof THREE.Mesh) o.castShadow = this.profile.shadows;
      });
      this.scene.add(g);
      // Poteaux, cadres, bras et projecteurs regroupés par matériau (l'affiche cliquable reste à part)
      this.mergeParents.push(g);
    });
  }

  /** Car de ligne peint aux couleurs d'une compagnie. */
  private buildCoach(line: BusLine): THREE.Group {
    const g = this.buildCar(0xffffff, 10);
    const tex = this.posterTexture(line.name, '', line.color, '#ffffff', 512, 96);
    const side = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(9, 0.9)), new THREE.MeshBasicMaterial({ map: tex }));
    side.position.set(1.13, 1.0, 0);
    side.rotation.y = Math.PI / 2;
    const side2 = side.clone();
    side2.position.x = -1.13;
    side2.rotation.y = -Math.PI / 2;
    g.add(side, side2);
    this.nightMaterials.push(side.material as unknown as THREE.MeshLambertMaterial);
    return g;
  }

  /**
   * Maison du joueur dans sa concession clôturée (mur, portail sur la rue, cour) :
   * maison en bande pour l'entrer-coucher, maison à véranda pour la chambre-salon, villa à étage pour la villa.
   */
  private buildHome(h: CityVenue): void {
    const { x, z } = h;
    if (h.housing === null) {
      // À la rue : natte et sac sous un abri de fortune
      this.box(2.2, 0.06, 1.2, 0xc9a26b, x, 0.03, z + 2, false);
      this.box(0.8, 0.5, 0.5, 0x5b3a1e, x + 1.4, 0.25, z + 2, false);
      this.box(3, 0.08, 2, 0x9aa3ad, x, 1.8, z + 2).rotation.x = 0.15;
      for (const dx of [-1.4, 1.4]) this.box(0.1, 1.8, 0.1, 0x6b4a2b, x + dx, 0.9, z + 2.9, false);
      // Bâche bleue sur le côté, cartons au sol et bidon d'eau
      this.box(0.06, 1.6, 1.8, 0x1f6feb, x - 1.55, 0.9, z + 2, false);
      this.box(1.1, 0.12, 0.8, 0xb98a55, x + 0.9, 0.06, z + 1.2, false);
      this.box(0.35, 0.5, 0.35, 0xffce00, x - 0.9, 0.25, z + 3, false);
      return;
    }
    const villa = h.housing === 'VILLA';
    const single = h.housing === 'ENTRER_COUCHER';
    const W = villa ? 15 : 13;
    const D = villa ? 14 : 12;
    const cz = z - D / 2 + 5; // façade de la clôture à z + 5, côté rue
    // Espace vert autour de la concession : pelouse, allée jusqu'à la rue, arbres, palmiers, massifs fleuris et bancs.
    // Construit avant la rotation éventuelle de la maison : on teste la chaussée au point réellement occupé une fois tourné.
    {
      const turned = (px: number, pz: number): [number, number] => (this.homeYaw === 0 ? [px, pz] : [2 * x - px, 2 * z - pz]);
      const free = (px: number, pz: number, m = 1.2) => {
        const [qx, qz] = turned(px, pz);
        return !this.onRoad(qx, qz, m);
      };
      const PW = W + 14;
      const PD = D + 12;
      // Pelouse en bandes (on ne pose que les bandes hors chaussée)
      for (let i = 0; i < PW; i += 2) for (let j = 0; j < PD; j += 2) {
        const px = x - PW / 2 + i + 1;
        const pz = cz - PD / 2 + j + 1;
        if (!free(px, pz, 0.6)) continue;
        this.box(2.02, 0.05, 2.02, (i + j) % 4 ? 0x78b85e : 0x6fae55, px, 0.035, pz, false);
      }
      // Allée dallée du portail jusqu'au bout de la pelouse
      for (let t = 0; t < 6; t += 1) {
        const pz = cz + D / 2 + 0.5 + t;
        if (free(x, pz, 0.4)) this.box(2.4, 0.06, 1, 0xd9d2c3, x, 0.06, pz, false);
      }
      // Arbres, palmiers et massifs de fleurs autour du mur (pas devant le portail)
      const spots: [number, number, 'tree' | 'palm' | 'flowers'][] = [
        [x - W / 2 - 3.5, cz - D / 2 - 2.5, 'tree'], [x + W / 2 + 3.5, cz - D / 2 - 2.5, 'tree'],
        [x - W / 2 - 3.5, cz + 1, 'palm'], [x + W / 2 + 3.5, cz + 1, 'palm'],
        [x - W / 2 - 3, cz + D / 2 + 3.5, 'palm'], [x + W / 2 + 3, cz + D / 2 + 3.5, 'palm'],
        [x, cz - D / 2 - 3.2, 'tree'],
        [x - W / 2 - 1.6, cz + 3, 'flowers'], [x + W / 2 + 1.6, cz + 3, 'flowers'],
        [x - W / 2 - 1.6, cz - 3, 'flowers'], [x + W / 2 + 1.6, cz - 3, 'flowers'],
      ];
      const r = rng(Math.round(x * 13 + z * 7));
      for (const [px, pz, kind] of spots) {
        if (!free(px, pz, 2)) continue;
        if (kind === 'tree') this.tree(px, pz);
        else if (kind === 'palm') {
          const h = 3.8 + r();
          const trunk = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(0.12, 0.18, h, 7)), this.mats.color(0x8a6a44));
          trunk.position.set(px, h / 2, pz);
          trunk.castShadow = this.profile.shadows;
          this.scene.add(trunk);
          for (let k = 0; k < 7; k++) {
            const a3 = (k / 7) * Math.PI * 2 + px;
            const leaf = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.32, 0.06, 1.7)), this.mats.color(0x2e8b3e));
            leaf.position.set(px + Math.cos(a3) * 0.75, h + 0.05, pz + Math.sin(a3) * 0.75);
            leaf.rotation.set(0, -a3 + Math.PI / 2, 0);
            leaf.rotateX(0.45);
            leaf.castShadow = this.profile.shadows;
            this.scene.add(leaf);
          }
          this.solid(px, pz, 0.5, 0.5);
        } else {
          // Massif : bordure de briques, terre, fleurs de couleur
          this.box(2.6, 0.18, 1.2, 0xa0522d, px, 0.09, pz, false);
          this.box(2.4, 0.06, 1, 0x5b3a1e, px, 0.19, pz, false);
          const cols = [0xe5383b, 0xffce00, 0xff7aa8, 0xffffff, 0xf18f01];
          for (let k = 0; k < 9; k++) {
            const fl = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.13, 8, 6)), this.mats.color(cols[k % cols.length]!));
            fl.position.set(px - 1 + (k % 5) * 0.5, 0.32, pz - 0.25 + Math.floor(k / 5) * 0.5);
            this.scene.add(fl);
          }
        }
      }
      // Deux bancs à l'arrière, sous les arbres (l'avant est réservé au parking)
      for (const sx of [-1, 1]) {
        const bx = x + sx * 3.6;
        const bz = cz - D / 2 - 2.2;
        if (!free(bx, bz, 1)) continue;
        this.box(1.6, 0.08, 0.5, 0x8b5a2b, bx, 0.48, bz, false);
        this.box(1.6, 0.4, 0.08, 0x8b5a2b, bx, 0.7, bz + 0.22, false);
        for (const lx of [-0.7, 0.7]) this.box(0.08, 0.45, 0.45, 0x2b2f36, bx + lx, 0.22, bz, false);
      }
    }
    const wallH = villa ? 2.6 : 2;
    const wallC = villa ? 0xf4efe6 : single ? 0xc9c4b8 : 0xf3d9a4;
    // Cour : sable pour les maisons de cour, pavés pour la villa
    this.box(W - 0.4, 0.08, D - 0.4, villa ? 0xd6d0c4 : 0xd8b98a, x, 0.04, cz, false);
    // Mur de clôture (4 côtés, ouverture du portail au milieu de la façade), chaperon et soubassement
    const gate = villa ? 4.2 : 3;
    const seg = (W - gate) / 2;
    const walls: [number, number, number, number][] = [
      [W, 0.3, x, cz - D / 2],
      [0.3, D, x - W / 2, cz],
      [0.3, D, x + W / 2, cz],
      [seg, 0.3, x - gate / 2 - seg / 2, cz + D / 2],
      [seg, 0.3, x + gate / 2 + seg / 2, cz + D / 2],
    ];
    for (const [bw, bd, bx, bz] of walls) {
      this.box(bw, wallH, bd, wallC, bx, wallH / 2, bz);
      this.box(bw + 0.12, 0.14, bd + 0.12, villa ? 0xc0522d : 0x8c8478, bx, wallH + 0.07, bz, false);
      this.box(bw + 0.04, 0.45, bd + 0.04, 0x9b8f7e, bx, 0.22, bz, false);
      this.solid(bx, bz, Math.max(bw, 0.6), Math.max(bd, 0.6));
    }
    // Piliers et portail métallique peint
    for (const s of [-1, 1]) this.box(0.6, wallH + 0.5, 0.6, wallC, x + s * (gate / 2 + 0.3), (wallH + 0.5) / 2, cz + D / 2);
    this.box(gate, wallH - 0.2, 0.08, villa ? 0x2b2f36 : single ? 0x1f6feb : 0x2a9d8f, x, (wallH - 0.2) / 2 + 0.1, cz + D / 2 - 0.1, false);
    const glass = this.litGlass();
    const cyl = (rt: number, rb: number, h: number, color: number, cx: number, cy: number, cz2: number, seg = 10) => {
      const m = new THREE.Mesh(this.geo(new THREE.CylinderGeometry(rt, rb, h, seg)), this.mats.color(color));
      m.position.set(cx, cy, cz2);
      m.castShadow = this.profile.shadows;
      this.scene.add(m);
      return m;
    };
    const pane = (w: number, hh: number, px: number, py: number, pz: number, frame = 0xffffff) => {
      this.box(w + 0.18, hh + 0.18, 0.06, frame, px, py, pz - 0.02, false);
      const g = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, hh, 0.07)), glass);
      g.position.set(px, py, pz);
      this.scene.add(g);
      this.box(0.05, hh, 0.09, frame, px, py, pz + 0.01, false);
    };
    const dish = (px: number, py: number, pz: number) => {
      const d = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.45, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2)), this.mats.color(0xe8edf0));
      d.position.set(px, py, pz);
      d.rotation.x = -Math.PI / 2.6;
      this.scene.add(d);
      this.box(0.05, 0.5, 0.05, 0x5b6b7f, px, py - 0.25, pz, false);
    };
    // Maison construite d'un autre modèle que celui de la classe : on la pose dans la concession (cour, mur et portail gardés)
    const classic = villa ? 'villa' : single ? 'block' : 'veranda';
    if (h.style && h.style !== classic && (HOUSE_STYLES as readonly string[]).includes(h.style)) {
      const house = buildHouse(this.mats, h.style as HouseStyle);
      const fit = Math.min(1, (W - 1.6) / house.w, (D - 2.4) / house.d);
      house.group.scale.setScalar(fit);
      house.group.position.set(x, 0.05, cz - 0.6);
      house.group.traverse((m) => {
        if (m instanceof THREE.Mesh) m.castShadow = this.profile.shadows;
      });
      this.scene.add(house.group);
      this.solid(x, cz - 0.6, house.w * fit, house.d * fit);
      this.tree(x + W / 2 - 2, cz + D / 2 - 2.5);
      return;
    }
    if (villa) {
      // Villa à étage : rez-de-chaussée à colonnes, balcon filant, étage, toit en tuiles, piscine, garage et jardin soigné
      const hz = cz - 2;
      const fz = hz + 3.25;
      this.box(9, 3.2, 6.5, 0xffffff, x, 1.6, hz);
      this.box(8, 3, 5.5, 0xfbfaf6, x, 4.7, hz - 0.3);
      this.solid(x, hz, 9, 6.5);
      this.box(9.2, 0.35, 6.7, 0xc0522d, x, 0.17, hz, false); // soubassement
      this.box(9.4, 0.25, 7.2, 0xd0d4da, x, 3.25, hz + 0.3, false); // dalle du balcon
      // Balcon : garde-corps à barreaux
      for (let i = 0; i <= 10; i++) this.box(0.05, 0.9, 0.05, 0xffffff, x - 4.5 + i * 0.9, 3.8, hz + 3.88, false);
      this.box(9.1, 0.07, 0.09, 0xffffff, x, 4.27, hz + 3.88, false);
      for (const sx of [-1, 1]) this.box(0.07, 0.07, 1, 0xffffff, x + sx * 4.5, 4.27, hz + 3.4, false);
      // Colonnes du porche et fronton
      for (const dx of [-1.5, 1.5]) cyl(0.17, 0.2, 3, 0xffffff, x + dx, 1.5, hz + 4.2, 12);
      this.box(4, 0.2, 1.7, 0xffffff, x, 3.1, hz + 4.05, false);
      this.box(3.4, 0.15, 2, 0xd0d4da, x, 0.12, hz + 4.3, false); // perron
      this.box(1.6, 2.4, 0.1, 0x6b4423, x, 1.2, fz + 0.03, false);
      this.box(0.1, 2.4, 0.12, 0xe3b23c, x, 1.2, fz + 0.08, false);
      // Toit à quatre pans en tuiles et cheminée
      const roof = new THREE.Mesh(this.geo(new THREE.ConeGeometry(6.6, 2.4, 4)), this.mats.color(0xc0522d));
      roof.position.set(x, 7.4, hz - 0.3);
      roof.rotation.y = Math.PI / 4;
      roof.scale.set(1, 1, 0.75);
      roof.castShadow = this.profile.shadows;
      this.scene.add(roof);
      this.box(0.7, 1.6, 0.7, 0xf4efe6, x - 2.2, 7.6, hz - 0.8);
      // Fenêtres à encadrement, volets et climatiseurs
      for (const dx of [-3.2, 3.2]) {
        pane(1.4, 1.4, x + dx, 1.9, fz + 0.03);
        pane(1.4, 1.3, x + dx, 4.9, hz + 2.5);
        this.box(0.35, 1.4, 0.08, 0x2b2f36, x + dx - 0.95, 1.9, fz + 0.03, false);
        this.box(0.35, 1.4, 0.08, 0x2b2f36, x + dx + 0.95, 1.9, fz + 0.03, false);
      }
      pane(1.2, 2.1, x, 4.7, hz + 2.5);
      this.box(0.9, 0.5, 0.4, 0xe8edf0, x + 4.15, 5.2, hz + 2.1, false);
      dish(x - 3.2, 7.2, hz - 1.6);
      // Garage ouvert à droite, voiture garée à gauche
      this.box(3.4, 2.2, 3.2, 0xfbfaf6, x + 5.4 - 0.5, 1.1, cz - D / 2 + 2);
      this.solid(x + 4.9, cz - D / 2 + 2, 3.4, 3.2);
      this.box(1.8, 1.4, 3.8, 0x1d3557, x - 4.8, 0.75, cz + 3.6);
      this.box(1.5, 0.45, 1.8, 0x22324a, x - 4.8, 1.65, cz + 3.4, false);
      this.solid(x - 4.8, cz + 3.6, 1.8, 3.8);
      // Piscine : margelle, eau et deux marches
      this.box(3.6, 0.1, 2.4, 0xe8e2d6, x + 4.3, 0.06, cz + 3.2, false);
      const water = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(3, 1.8)), new THREE.MeshBasicMaterial({ color: 0x45b8e0 }));
      water.rotation.x = -Math.PI / 2;
      water.position.set(x + 4.3, 0.13, cz + 3.2);
      this.scene.add(water);
      // Haies, palmiers et lampadaires du portail
      for (const [hx, hzz, hw] of [[x - 5, cz - D / 2 + 0.6, 4], [x + 0.5, cz - D / 2 + 0.6, 5]] as const) this.box(hw, 0.9, 0.7, 0x2f7d3a, hx, 0.45, hzz, false);
      for (const sx of [-1, 1]) {
        cyl(0.04, 0.05, 2.8, 0x2b2f36, x + sx * (gate / 2 + 0.3), wallH + 1.9, cz + D / 2, 6);
        const bulb = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.18, 8, 6)), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
        bulb.position.set(x + sx * (gate / 2 + 0.3), wallH + 3.35, cz + D / 2);
        this.scene.add(bulb);
      }
      this.box(1.6, 2.4, 1.6, 0xf4efe6, x + W / 2 - 1.4, 1.2, cz + D / 2 - 1.4); // guérite du gardien
      this.box(1.75, 0.15, 1.75, 0xc0522d, x + W / 2 - 1.4, 2.5, cz + D / 2 - 1.4, false);
      this.tree(x + W / 2 - 1.8, cz - D / 2 + 2);
      this.tree(x - W / 2 + 1.8, cz - D / 2 + 2);
      for (const [px, pz] of [[x - W / 2 + 1.5, cz + 0.5], [x - W / 2 + 1.5, cz - 3]] as const) {
        cyl(0.12, 0.18, 3.2, 0x7a5a38, px, 1.6, pz, 7);
        const crown = new THREE.Mesh(this.geo(new THREE.SphereGeometry(1.2, 9, 6)), this.mats.color(C.palm));
        crown.scale.set(1, 0.45, 1);
        crown.position.set(px, 3.4, pz);
        this.scene.add(crown);
      }
    } else if (single) {
      // Maison en bande : rangée de chambres « entrer-coucher » aux portes numérotées, tôle ondulée, fenêtres grillagées
      const hz = cz - D / 2 + 2.4;
      this.box(W - 1.2, 2.8, 4, 0xe9dcc3, x, 1.4, hz);
      this.solid(x, hz, W - 1.2, 4);
      this.box(W - 1, 0.35, 4.1, 0x9b8f7e, x, 0.17, hz, false); // soubassement
      const roof = this.box(W - 0.6, 0.12, 5, 0x9aa3ad, x, 3.05, hz + 0.3);
      roof.rotation.x = 0.12;
      for (let i = -6; i <= 6; i++) {
        const rib = this.box(0.07, 0.1, 5, 0x7f8790, x + i * 0.9, 3.15, hz + 0.3, false);
        rib.rotation.x = 0.12;
      }
      for (let i = 0; i < 4; i++) {
        const dx = -W / 2 + 2.2 + i * ((W - 4.4) / 3);
        this.box(0.9, 1.9, 0.08, i === 1 ? 0x1f6feb : [0x6b4423, 0x2a9d8f, 0x6b4423, 0xe5383b][i]!, x + dx, 0.95, hz + 2.04, false);
        this.box(0.18, 0.18, 0.04, 0xffffff, x + dx, 2.2, hz + 2.07, false); // numéro de chambre
        this.box(0.6, 0.5, 0.08, 0x5d7a8c, x + dx + 0.95, 1.7, hz + 2.04, false);
        for (const bar of [-0.2, -0.07, 0.07, 0.2]) this.box(0.025, 0.55, 0.04, 0x2b2f36, x + dx + 0.95 + bar, 1.7, hz + 2.09, false);
        this.box(0.5, 0.08, 0.5, 0xc9c4b8, x + dx, 0.04, hz + 2.4, false); // seuil
      }
      // Douche et WC communs, fût d'eau avec couvercle, fil à linge
      this.box(2, 2.2, 1.8, 0xc9c4b8, x + W / 2 - 1.6, 1.1, cz + 2.4);
      this.solid(x + W / 2 - 1.6, cz + 2.4, 2, 1.8);
      this.box(2.2, 0.1, 2, 0x9aa3ad, x + W / 2 - 1.6, 2.25, cz + 2.4, false);
      this.box(0.8, 0.02, 1, 0x1f6feb, x + W / 2 - 1.6, 1.1, cz + 3.31, false);
      cyl(0.42, 0.42, 1, 0x1f6feb, x - W / 2 + 1.4, 0.5, cz + 2.8, 12);
      cyl(0.44, 0.44, 0.08, 0xdfe6ee, x - W / 2 + 1.4, 1.03, cz + 2.8, 12);
      this.box(5, 0.03, 0.03, 0xffffff, x - 1, 1.9, cz + 1);
      for (let i = 0; i < 4; i++) this.box(0.6, 0.7, 0.03, [0xe5383b, 0xffce00, 0x22a861, 0x1d3557][i]!, x - 3 + i * 1.3, 1.5, cz + 1, false);
      // Réchaud à charbon, bassine, chaises en plastique et lampe sous l'auvent
      cyl(0.28, 0.2, 0.35, 0x34383c, x - 2.2, 0.18, cz + 3.8, 8);
      cyl(0.32, 0.26, 0.2, 0xe5383b, x - 3, 0.1, cz + 3.4, 10);
      for (const dx of [0.5, 1.6]) {
        this.box(0.45, 0.04, 0.45, 0xf1ece1, x + dx, 0.5, cz + 3.6, false);
        this.box(0.45, 0.5, 0.04, 0xf1ece1, x + dx, 0.75, cz + 3.4, false);
        for (const lx of [-0.18, 0.18]) for (const lz of [-0.18, 0.18]) this.box(0.04, 0.48, 0.04, 0xdfd8c8, x + dx + lx, 0.25, cz + 3.6 + lz, false);
      }
      const bulb = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.1, 8, 6)), new THREE.MeshBasicMaterial({ color: 0xfff3c4 }));
      bulb.position.set(x, 2.5, hz + 2.3);
      this.scene.add(bulb);
      this.tree(x - W / 2 + 1.6, cz - D / 2 + 1.8);
    } else {
      // Chambre-salon : maison de cour à véranda ombragée, toit de tôle, volets, mobilier de terrasse, château d'eau
      const hz = cz - 1.5;
      this.box(9, 3.2, 6, 0xf3d9a4, x, 1.6, hz);
      this.solid(x, hz, 9, 6);
      this.box(9.1, 0.5, 6.1, 0x2a9d8f, x, 0.25, hz, false);
      this.box(9.1, 0.12, 6.1, 0xe8dcc0, x, 3.2, hz, false); // corniche
      for (const s of [-1, 1]) {
        const pan = this.box(10, 0.12, 4.2, 0x9aa3ad, x, 3.85, hz + s * 1.75);
        pan.rotation.x = s * 0.32;
      }
      this.box(10, 0.14, 0.14, 0x7f8790, x, 4.25, hz, false); // faîtage
      this.box(9, 0.15, 2.2, 0xcbb592, x, 0.1, hz + 4.1, false); // véranda
      for (const dx of [-4.2, -1.4, 1.4, 4.2]) this.box(0.25, 2.8, 0.25, 0xffffff, x + dx, 1.4, hz + 5, false);
      this.box(9.6, 0.12, 2.6, 0x9aa3ad, x, 2.85, hz + 4.1, false);
      this.box(9.6, 0.1, 0.1, 0x2a9d8f, x, 2.78, hz + 5.35, false); // lambrequin
      this.box(1, 2.1, 0.08, 0x6b4423, x - 1.6, 1.05, hz + 3.04, false);
      this.box(1, 2.1, 0.08, 0x6b4423, x + 1.6, 1.05, hz + 3.04, false);
      for (const dx of [-3.4, 3.4]) {
        pane(1.2, 1, x + dx, 1.8, hz + 3.06, 0xf1ece1);
        this.box(0.5, 1.2, 0.06, 0x2a9d8f, x + dx - 0.85, 1.8, hz + 3.06, false);
        this.box(0.5, 1.2, 0.06, 0x2a9d8f, x + dx + 0.85, 1.8, hz + 3.06, false);
      }
      // Véranda meublée : table et chaises plastiques, pots de fleurs, natte
      this.box(1.2, 0.05, 0.8, 0xf1ece1, x + 2.8, 0.7, hz + 4.2, false);
      for (const [lx, lz] of [[-0.5, -0.3], [0.5, -0.3], [-0.5, 0.3], [0.5, 0.3]] as const) this.box(0.05, 0.6, 0.05, 0xdfd8c8, x + 2.8 + lx, 0.4, hz + 4.2 + lz, false);
      for (const dx of [2, 3.6]) this.box(0.45, 0.45, 0.45, 0x1f6feb, x + dx, 0.34, hz + 4.9, false);
      this.box(1.6, 0.03, 1, 0xc9a26b, x - 2.6, 0.2, hz + 4.2, false);
      for (const dx of [-4.2, 4.2]) {
        cyl(0.22, 0.17, 0.35, 0xb5562f, x + dx, 0.32, hz + 5.5, 8);
        const bush = new THREE.Mesh(this.geo(new THREE.SphereGeometry(0.32, 8, 6)), this.mats.color(0x2f7d3a));
        bush.position.set(x + dx, 0.7, hz + 5.5);
        this.scene.add(bush);
      }
      // Château d'eau sur pylône et antenne parabolique
      for (const [lx, lz] of [[-0.5, -0.5], [0.5, -0.5], [-0.5, 0.5], [0.5, 0.5]] as const) this.box(0.1, 2.6, 0.1, 0x5b6b7f, x + W / 2 - 1.6 + lx, 1.3, cz - D / 2 + 2 + lz, false);
      cyl(0.75, 0.75, 1.1, 0x1f6feb, x + W / 2 - 1.6, 3.15, cz - D / 2 + 2, 14);
      this.solid(x + W / 2 - 1.6, cz - D / 2 + 2, 1.4, 1.4);
      dish(x - 3, 4.6, hz - 1);
      this.tree(x + W / 2 - 2, cz + 3); // manguier de la cour
      this.box(0.6, 0.5, 0.6, 0xb5562f, x - W / 2 + 1.2, 0.25, cz + 4.2, false);
      // Moto du foyer garée contre le mur
      const moto = this.buildMoto(0xe5383b);
      moto.position.set(x - W / 2 + 1.2, 0, cz + 1.2);
      moto.rotation.y = Math.PI / 2;
      moto.scale.setScalar(0.9);
      this.scene.add(moto);
    }
  }

  /** Kiosques et boutiquins posés sur le trottoir des boulevards (téléphonie, boissons, couture, pharmacie…). */
  private buildRoadsideKiosks(): void {
    const r = rng(4242);
    type Kiosk = { x: number; z: number; yaw: number; color: number };
    const list: Kiosk[] = [];
    const clear = (x: number, z: number) =>
      this.isFree(x, z, 1.6) && !this.houseSpots.some((s) => Math.abs(s.x - x) < (s.w + 1.8) / 2 + 2.4 && Math.abs(s.z - z) < (s.d + 1.8) / 2 + 2.4) && !list.some((o) => Math.hypot(o.x - x, o.z - z) < 6);
    const off = ROAD_W / 2 + 2.3;
    for (const rz of ROADS_Z) {
      for (let x = MIN_X + 8; x <= roadEastEnd(rz) - 4; x += 16) {
        if (ROADS_X.some((rx) => Math.abs(rx - x) < 8)) continue;
        for (const side of [-1, 1]) {
          if (r() < 0.35) continue;
          const z = rz + bend(rz, x) + side * off;
          if (clear(x, z)) list.push({ x, z, yaw: side < 0 ? 0 : Math.PI, color: SHOP_COLORS[Math.floor(r() * SHOP_COLORS.length)]! });
        }
      }
    }
    for (const rx of ROADS_X) {
      if (rx === 0) continue;
      for (let z = 8; z >= ROAD_END_Z + 8; z -= 16) {
        if (ROADS_Z.some((rz) => Math.abs(rz - z) < 8)) continue;
        for (const side of [-1, 1]) {
          if (r() < 0.35) continue;
          const x = rx + bend(rx, z) + side * off;
          if (clear(x, z)) list.push({ x, z, yaw: side < 0 ? Math.PI / 2 : -Math.PI / 2, color: SHOP_COLORS[Math.floor(r() * SHOP_COLORS.length)]! });
        }
      }
    }
    const n = list.length;
    if (n === 0) return;
    const body = this.instanced(new THREE.BoxGeometry(2.6, 2.3, 2.1), this.mats.color(0xffffff), n);
    const roof = this.instanced(new THREE.BoxGeometry(3, 0.16, 2.6), this.mats.color(0x5b6b7f), n, false);
    const awning = this.instanced(new THREE.BoxGeometry(3, 0.08, 1.2), this.mats.color(0xffffff), n * 2, false);
    const sign = this.instanced(new THREE.BoxGeometry(2.4, 0.45, 0.08), this.mats.color(0x14213d), n, false);
    const hatch = this.instanced(new THREE.BoxGeometry(1.7, 1, 0.06), this.mats.color(0x7fb8d6), n, false);
    const stock = this.instanced(new THREE.BoxGeometry(0.5, 0.45, 0.5), this.mats.color(0xffffff), n * 2, false);
    list.forEach((k, i) => {
      const at = (lx: number, lz: number): [number, number] => {
        const [dx, dz] = rotateXZ(lx, lz, k.yaw);
        return [k.x + dx, k.z + dz];
      };
      const [bx, bz] = at(0, 0);
      this.setInstance(body, i, bx, 1.15, bz, 1, 1, 1, k.yaw);
      body.setColorAt(i, this.tmp.c.setHex(k.color));
      this.setInstance(roof, i, bx, 2.38, bz, 1, 1, 1, k.yaw);
      const [hx, hz] = at(0, 1.07);
      this.setInstance(hatch, i, hx, 1.4, hz, 1, 1, 1, k.yaw);
      const [sx, sz] = at(0, 1.1);
      this.setInstance(sign, i, sx, 2.0, sz, 1, 1, 1, k.yaw);
      for (let a = 0; a < 2; a++) {
        const [ax, az] = at(a === 0 ? -0.75 : 0.75, 1.5);
        this.setInstance(awning, i * 2 + a, ax, 2.3, az, 0.5, 1, 1, k.yaw);
        awning.setColorAt(i * 2 + a, this.tmp.c.setHex(a === 0 ? 0xffffff : k.color));
        const [gx, gz] = at(a === 0 ? -0.9 : 0.9, 1.45);
        this.setInstance(stock, i * 2 + a, gx, 0.23, gz, 1, 1, 1, k.yaw);
        stock.setColorAt(i * 2 + a, this.tmp.c.setHex(SHOP_COLORS[(i + a * 3) % SHOP_COLORS.length]!));
      }
      this.solid(bx, bz, Math.abs(Math.cos(k.yaw)) > 0.5 ? 2.8 : 2.4, Math.abs(Math.cos(k.yaw)) > 0.5 ? 2.4 : 2.8);
    });
    for (const m of [body, awning, stock]) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  /** Moto (zémidjan) : 2 roues à jante, réservoir, selle, guidon, phare. */
  /** Moto (voir vehicles.ts), avec ombres portées selon le profil graphique. */
  private buildMoto(color: number): THREE.Group {
    return this.shadowed(drawMoto(this.mats, color));
  }

  /** Voiture, taxi, fourgon, bus ou camion (voir vehicles.ts) ; le modèle se déduit de la longueur si non précisé. */
  private buildCar(color: number, len: number, o: { kind?: CarKind; stripe?: number } = {}): THREE.Group {
    return this.shadowed(drawCar(this.mats, { kind: o.kind ?? carKindFor(len), color, stripe: o.stripe }));
  }

  private shadowed(g: THREE.Group): THREE.Group {
    g.traverse((o) => {
      if (o instanceof THREE.Mesh) o.castShadow = this.profile.shadows;
    });
    return g;
  }

  /** Passants sur les trottoirs et zémidjans sur les routes. */
  private buildStreetLife(): void {
    const r = rng(42);
    const nWalkers = Math.round(this.profile.zems * 1.4);
    for (let i = 0; i < nWalkers; i++) {
      const g = buildPerson(this.mats, randomLook(r), true);
      g.scale.setScalar(0.95 + r() * 0.1);
      const axis: 'x' | 'z' = r() < 0.6 ? 'x' : 'z';
      const road = axis === 'x' ? ROADS_Z[Math.floor(r() * ROADS_Z.length)]! : ROADS_X[Math.floor(r() * ROADS_X.length)]!;
      const dir: 1 | -1 = r() < 0.5 ? 1 : -1;
      // À gauche du sens de marche : vers +x, côté −z ; vers +z, côté +x.
      const lane = road + (axis === 'x' ? -dir : dir) * (ROAD_W / 2 + 0.9);
      const eastEnd = axis === 'x' ? trafficEast(road) : MAX_X;
      this.walkers.push({ g, axis, lane, pos: axis === 'x' ? MIN_X + r() * (eastEnd - MIN_X) : ROAD_END_Z + r() * (14 - ROAD_END_Z), dir, speed: 1.2 + r() * 0.8, phase: r() * 6 });
      this.scene.add(g);
    }
    const n = this.profile.zems * 2;
    // Modèles cuits une fois : moto, vélo (peinture blanche teintée par instance) et conducteurs en pose de conduite
    const set = (g: THREE.Object3D, tintPaint?: THREE.Material): number[] =>
      bakeGroup(g, tintPaint ? (m) => m === tintPaint : undefined).map((b) => {
        const mesh = new THREE.InstancedMesh(this.geo(b.geometry), b.materials, Math.max(1, n));
        mesh.castShadow = this.profile.shadows;
        mesh.frustumCulled = false;
        mesh.count = 0;
        if (tintPaint && b.materials.includes(tintPaint)) mesh.userData.tint = true;
        this.scene.add(mesh);
        this.zemSets.push({ mesh, count: 0 });
        return this.zemSets.length - 1;
      });
    const moto = set(drawMoto(this.mats, 0xffffff), this.mats.color(0xffffff, 0.3));
    const bike = set(buildBike(this.mats, 0xfefefe), this.mats.color(0xfefefe, 0.35));
    // Zémidjans : gilet vert ou jaune et casque ; cyclistes : tenues du quotidien
    const zemRiders = [4, 3, 4].map((color, k) => set(buildRider(this.mats, { ...randomLook(rng(700 + k)), female: false, outfit: 'casual', fabric: 'plain', color }, { ...ZEM_SEAT, helmet: [0x1b1b1b, 0x196a45, 0xe9c46a][k]! })));
    const bikeRiders = [0, 1].map((k) => set(buildRider(this.mats, randomLook(rng(900 + k)), { seatY: 0.92, seatZ: -0.22, lean: 0.25, bike: true })));
    const motoPaints = [0xe5383b, 0x1d3557, 0x111111, 0xe9c46a, 0x1f6feb];
    const bikePaints = [0x1f6feb, 0x22a861, 0x111111, 0xc8102e];
    for (let i = 0; i < n; i++) {
      // Un deux-roues sur cinq est un vélo, plus lent
      const isBike = i % 5 === 4;
      const axis: 'x' | 'z' = i % 3 === 2 ? 'z' : 'x';
      const dir: 1 | -1 = i % 2 ? 1 : -1;
      const road = axis === 'x' ? ROADS_Z[i % ROADS_Z.length]! : ROADS_X[i % ROADS_X.length]!;
      // À droite, comme les voitures
      const lane = road + (axis === 'x' ? dir : -dir) * (isBike ? BIKE_LANE : ZEM_LANE);
      const eastEnd = axis === 'x' ? trafficEast(road) : MAX_X;
      let pos = axis === 'x' ? MIN_X + r() * (eastEnd - MIN_X) : ROAD_END_Z + r() * (14 - ROAD_END_Z);
      for (let attempt = 0; attempt < 14 && this.zems.some((m) => m.axis === axis && m.dir === dir && Math.abs(m.lane - lane) < 0.8 && Math.abs(m.pos - pos) < 5); attempt++) {
        pos = axis === 'x' ? MIN_X + r() * (eastEnd - MIN_X) : ROAD_END_Z + r() * (14 - ROAD_END_Z);
      }
      const speed = isBike ? 2.5 + r() * 1.5 : 5 + r() * 4;
      this.zems.push({ axis, dir, lane, pos, speed, v: speed, len: isBike ? 1.9 : 2.6, gap: Infinity, leadV: speed, stuck: 0 });
      const sets = [...(isBike ? bike : moto), ...(isBike ? bikeRiders[i % bikeRiders.length]! : zemRiders[i % zemRiders.length]!)];
      const idx = sets.map((k) => this.zemSets[k]!.count++);
      this.zemSlots.push({ sets, idx });
      const paint = isBike ? bikePaints[i % bikePaints.length]! : motoPaints[i % motoPaints.length]!;
      sets.forEach((k, j) => {
        const z = this.zemSets[k]!;
        if (z.mesh.userData.tint) z.mesh.setColorAt(idx[j]!, this.tmp.c.setHex(paint));
      });
    }
    for (const z of this.zemSets) {
      z.mesh.count = z.count;
      if (z.mesh.instanceColor) z.mesh.instanceColor.needsUpdate = true;
    }
    this.fleet = [...this.cars.filter((c) => !c.off), ...this.zems];
  }

  private addPin(v: CityVenue): void {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = v.id === this.opts.home.id ? 'pin pin-home' : 'pin';
    b.setAttribute('aria-label', v.label);
    const ic = document.createElement('span');
    ic.className = 'pin-icon';
    ic.textContent = v.emoji;
    const tx = document.createElement('span');
    tx.className = 'pin-label';
    tx.textContent = v.label; // textContent : aucun HTML interprété
    b.append(ic, tx);
    // Lieux des partenaires Or (Gozem, EZA ZOZO) et Argent (Capture Média, Ori-Infos) : couronne ou étoile sur l'épingle
    const tier = PARTNER_VENUE_TIER[v.id];
    if (tier) {
      b.classList.add(tier === 'GOLD' ? 'pin-gold' : 'pin-silver');
      const badge = document.createElement('span');
      badge.className = 'pin-tier';
      badge.textContent = tier === 'GOLD' ? '👑' : '⭐';
      badge.setAttribute('aria-hidden', 'true');
      ic.appendChild(badge);
    }
    b.addEventListener('click', () => this.opts.onPick(v.id));
    this.pinLayer.appendChild(b);
    // L'épingle flotte au-dessus du bâtiment, en retrait de la façade : le retrait suit l'orientation du lieu
    // (un lieu tourné vers le nord, comme Chaussures et Mode de Bè, avait son épingle au-dessus de la route)
    const [ox, oz] = rotateXZ(0, -3, venueYaw(v.id));
    this.pins.push({ id: v.id, el: b, pos: new THREE.Vector3(v.x + ox, 9, v.z + oz) });
  }

  private find(id: string): CityVenue | undefined {
    return id === this.opts.home.id ? this.opts.home : this.opts.venues.find((v) => v.id === id);
  }

  // ---------- entrées ----------

  private readonly onKey = (e: KeyboardEvent): void => {
    const target = e.target as HTMLElement | null;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
    const k = e.key.toLowerCase();
    if (!['w', 'a', 's', 'd', 'z', 'q', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) return;
    if (e.type === 'keydown') this.keys.add(k);
    else this.keys.delete(k);
  };

  /** Tourne la carte de `rad` radians (boutons de la barre) ; 0 la remet face au nord. */
  rotateMap(rad: number): void {
    if (rad === 0) this.mapYaw = 0;
    else this.mapYaw += rad;
  }

  private readonly noMenu = (e: Event): void => e.preventDefault();

  private readonly onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.zoom = THREE.MathUtils.clamp(this.zoom * (e.deltaY > 0 ? 1.1 : 0.9), 0.45, this.view === 'map' ? MAP_MAX_ZOOM : 1.8);
  };

  private readonly onDown = (e: PointerEvent): void => {
    unlockStreetSound();
    // Capture : le relâchement est reçu même hors du canvas (sinon la carte « colle » à la souris)
    try {
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    } catch {
      /* pointeur déjà relâché */
    }
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      this.pinchDist = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      this.pinchAngle = Math.atan2(b!.y - a!.y, b!.x - a!.x);
      this.down = null;
      return;
    }
    this.down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
  };

  private readonly onMove = (e: PointerEvent): void => {
    // Bouton relâché sans pointerup reçu : on oublie ce pointeur
    if (e.pointerType === 'mouse' && e.buttons === 0 && this.touches.has(e.pointerId)) {
      this.onCancel(e);
      this.down = null;
      return;
    }
    const prev = this.touches.get(e.pointerId);
    if (!prev) return;
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.touches.size === 2 && this.pinchDist > 0) {
      const [a, b] = [...this.touches.values()];
      const d = Math.hypot(a!.x - b!.x, a!.y - b!.y);
      if (d > 0) this.zoom = THREE.MathUtils.clamp((this.zoom * this.pinchDist) / d, 0.45, this.view === 'map' ? MAP_MAX_ZOOM : 1.8);
      this.pinchDist = d;
      if (this.view === 'map') {
        // Torsion à deux doigts : la carte tourne dans le sens des doigts
        const ang = Math.atan2(b!.y - a!.y, b!.x - a!.x);
        let da = ang - this.pinchAngle;
        if (da > Math.PI) da -= Math.PI * 2;
        else if (da < -Math.PI) da += Math.PI * 2;
        this.mapYaw += da;
        this.pinchAngle = ang;
      }
      return;
    }
    if (!this.down) return;
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    if (Math.hypot(e.clientX - this.down.x, e.clientY - this.down.y) > 10) this.down.moved = true;
    if (!this.down.moved) return;
    if (this.view === 'map') {
      if (e.pointerType === 'mouse' && ((e.buttons & 2) !== 0 || e.shiftKey)) {
        // Clic droit (ou Maj) + glisser : tourner la carte
        this.mapYaw += dx * 0.008;
        return;
      }
      // Glisser pour parcourir la carte (dans le sens de la carte tournée)
      const k = 0.14 * this.zoom;
      const sa = Math.sin(this.mapYaw);
      const ca = Math.cos(this.mapYaw);
      this.focus.x = THREE.MathUtils.clamp(this.focus.x - (ca * dx + sa * dy) * k, this.minPanX, this.maxPanX);
      this.focus.z = THREE.MathUtils.clamp(this.focus.z - (-sa * dx + ca * dy) * k, this.minPanZ, Math.max(this.maxPanZ, this.seaMaxZ));
    } else {
      this.yaw -= dx * 0.008; // glisser pour tourner la caméra
    }
  };

  private readonly onCancel = (e: PointerEvent): void => {
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinchDist = 0;
  };

  private readonly onUp = (e: PointerEvent): void => {
    this.onCancel(e);
    const d = this.down;
    this.down = null;
    if (!d || d.moved || performance.now() - d.t > 600 || this.travelDone) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.pointer, this.camera);
    // Panneau publicitaire touché (carte ou rue) : on ouvre la fiche du partenaire
    const hit = this.raycaster.intersectObjects(this.boards, false)[0];
    if (hit && typeof hit.object.userData.adId === 'string') {
      this.opts.onBillboard(hit.object.userData.adId, typeof hit.object.userData.panel === 'number' ? hit.object.userData.panel : undefined);
      return;
    }
    if (hit && typeof hit.object.userData.freeSlot === 'number') {
      this.opts.onFreeBoard?.(hit.object.userData.freeSlot);
      return;
    }
    if (hit && typeof hit.object.userData.plotId === 'string') {
      this.opts.onPlot?.(hit.object.userData.plotId);
      return;
    }
    // Sol d'une zone de terrain à vendre touché : on ouvre le lot
    const landHit = this.land ? this.raycaster.intersectObjects(this.land.pick, false)[0] : undefined;
    if (landHit && typeof landHit.object.userData.landZone === 'string') {
      const zone = this.opts.land?.find((z) => z.id === landHit.object.userData.landZone);
      if (zone) {
        const { originX, originZ, cols, rows, cell } = zone.layout;
        const col = Math.floor((landHit.point.x - originX) / cell);
        const row = Math.floor((landHit.point.z - originZ) / cell);
        if (col >= 0 && col < cols && row >= 0 && row < rows) {
          this.opts.onLandCell?.(zone.id, row * cols + col);
          return;
        }
      }
    }
    const zoneGrid = hit && typeof hit.object.userData.seaGrid === 'string' ? this.plotGrids.get(hit.object.userData.seaGrid) : undefined;
    if (hit && zoneGrid) {
      const { cell, originX, originZ } = zoneGrid;
      this.opts.onSeaCell?.(Math.floor((hit.point.x - originX) / cell), Math.floor((hit.point.z - originZ) / cell), hit.object.userData.seaGrid as string);
      return;
    }
    if (hit && typeof hit.object.userData.brandId === 'string') {
      this.opts.onBrand?.(hit.object.userData.brandId);
      return;
    }
    // Bâtiment, parvis ou espace vert d'un lieu touché : ouvrir sa fiche (comme l'épingle)
    const picked = this.raycaster.intersectObjects(this.venueObjects, true)[0];
    let o: THREE.Object3D | null = picked?.object ?? null;
    while (o && !o.userData.venueId) o = o.parent;
    if (o && picked) {
      this.opts.onPick(o.userData.venueId as string);
      return;
    }
    if (this.view !== 'street') return;
    // Tap au sol (rue) : marcher jusqu'au point touché
    const ray = this.raycaster.ray;
    if (Math.abs(ray.direction.y) < 1e-4) return;
    const t = -ray.origin.y / ray.direction.y;
    if (t <= 0) return;
    const p = ray.at(t, new THREE.Vector3());
    this.route = [new THREE.Vector3(THREE.MathUtils.clamp(p.x, MIN_X, MAX_X), 0, THREE.MathUtils.clamp(p.z, MIN_Z, WALK_MAX_Z))];
    this.speed = 4.5;
    this.marker.position.set(this.route[0]!.x, 0.06, this.route[0]!.z);
    (this.marker.material as THREE.MeshBasicMaterial).opacity = 0.9;
  };

  private readonly onVisibility = (): void => {
    if (document.hidden) {
      cancelAnimationFrame(this.raf);
      this.raf = 0;
    } else if (!this.disposed && !this.raf) {
      this.lastFrame = 0;
      this.raf = requestAnimationFrame(this.loop);
    }
  };

  private camScale = 1;

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // En portrait, champ plus large pour voir autant de ville qu'en paysage
    this.camera.fov = this.fovFor(w < h);
    // Téléphone / tablette : caméra plus reculée et plus haute (vue d'ensemble façon Lagos Life)
    this.camScale = w < h ? 1.9 : w < 1100 ? 1.35 : 1;
    this.camera.updateProjectionMatrix();
  }

  // ---------- jour / nuit ----------

  private applyDayNight(minute: number): void {
    let a = SKY_KEYS[0]!;
    let b = SKY_KEYS[SKY_KEYS.length - 1]!;
    for (let i = 0; i < SKY_KEYS.length - 1; i++) {
      if (minute >= SKY_KEYS[i]!.m && minute <= SKY_KEYS[i + 1]!.m) {
        a = SKY_KEYS[i]!;
        b = SKY_KEYS[i + 1]!;
        break;
      }
    }
    const f = b.m === a.m ? 0 : (minute - a.m) / (b.m - a.m);
    const bg = this.scene.background as THREE.Color;
    bg.copy(a.sky).lerp(b.sky, f);
    (this.scene.fog as THREE.Fog).color.copy(bg);
    const sunI = a.sun + (b.sun - a.sun) * f;
    // Sur la carte, la nuit reste un peu plus claire pour garder les lieux lisibles
    const mapLift = this.view === 'map' ? 0.2 * (1 - sunI) : 0;
    // À hauteur d'homme la nuit reste lisible : le joueur et les lieux ne doivent pas virer au noir
    const streetLift = this.view === 'street' ? 1 - Math.min(1, sunI * 2.2) : 0;
    this.sun.intensity = 0.12 + sunI * 1.2 + mapLift + 0.3 * streetLift;
    this.hemi.intensity = a.hemi + (b.hemi - a.hemi) * f + mapLift + 0.16 * streetLift;
    if (mapLift > 0) bg.lerp(this.tmp.c.setHex(0x2a3a6e), 0.35 * (1 - sunI));
    const ang = ((minute - 360) / 720) * Math.PI;
    const p = this.player.position;
    if (sunI > 0.02) {
      this.sun.color.setHex(0xfff1d0).lerp(this.tmp.c.setHex(0xff9a5a), 1 - Math.min(1, sunI));
      this.sun.position.set(p.x + Math.cos(ang) * 60, Math.max(10, Math.sin(ang) * 80), p.z - 25);
    } else {
      this.sun.color.setHex(0x8fa8ff); // clair de lune
      this.sun.position.set(p.x - 30, 60, p.z - 30);
    }
    this.sun.target.position.copy(p);
    const skyU = this.skyMaterial.uniforms;
    (skyU.topColor!.value as THREE.Color).copy(bg).multiplyScalar(sunI > 0.15 ? 0.76 : 0.55);
    (skyU.horizonColor!.value as THREE.Color).copy(bg).lerp(this.tmp.c.setHex(sunI > 0.15 ? 0xf8d3a0 : 0x7483b4), 0.28);
    (skyU.groundColor!.value as THREE.Color).setHex(sunI > 0.15 ? 0xd8b080 : 0x151c35);
    (skyU.sunColor!.value as THREE.Color).setHex(sunI > 0.55 ? 0xffedc5 : 0xff9b68);
    (skyU.sunDirection!.value as THREE.Vector3).copy(this.sun.position).sub(p).normalize();
    skyU.sunStrength!.value = Math.max(0, sunI);
    this.nightLevel = 1 - Math.min(1, sunI * 2.2);
    this.applyNight();
  }

  /** Éclairage nocturne des bâtiments, enseignes et lampadaires : éteint pendant une coupure d'électricité. */
  private applyNight(): void {
    const night = this.powerCut ? 0 : this.nightLevel;
    for (const m of this.nightMaterials) m.emissiveIntensity = night * 1.9 * (this.nightScale.get(m) ?? 1);
    for (const l of this.pointLights) l.intensity = night * 12;
    // Lueur douce autour du joueur la nuit (téléphone, lampe, éclairage ambiant) pour qu'il ne vire pas au noir
    if (!this.playerGlow) {
      this.playerGlow = new THREE.PointLight(0xfff2dc, 0, 9, 1.5);
      this.playerGlow.position.set(0.4, 2.2, -1.6); // côté caméra, derrière le joueur
      this.player.add(this.playerGlow);
    }
    this.playerGlow.intensity = this.powerCut ? night * 4 : night * 9;
  }

  /** Scène de la station-service : sa moto ou sa voiture sous le joueur, et le pompiste qui fait le plein (pompe, tuyau, gilet). */
  private stationKey: string | null = null;
  private stationProps: { g: THREE.Group; arm: THREE.Object3D | null; attendant: THREE.Group; nozzle: THREE.Object3D | null; hose: THREE.Object3D; faceYaw: number; fuelUntil: number } | null = null;

  setStation(kind: 'MOTO' | 'CAR' | null, venueId?: string): void {
    if (kind && venueId && !this.find(venueId)) return; // lieu pas encore posé : l'appelant réessaiera
    const key = kind ? `${kind}:${venueId ?? ''}` : null;
    if (key === this.stationKey) return;
    this.stationKey = key;
    if (this.stationProps) {
      this.scene.remove(this.stationProps.g);
      this.stationProps = null;
    }
    if (!kind) {
      this.riding = null;
      this.ownMoto = false;
      this.riddenOn = false;
      if (this.zemDriver) this.zemDriver.visible = true;
      return;
    }
    // Le joueur est sur sa moto (ou au volant de sa voiture), pas de conducteur devant lui
    this.riding = kind === 'MOTO' ? 'ZEM' : 'CAR';
    this.ownMoto = kind === 'MOTO';
    if (this.zemDriver) this.zemDriver.visible = false;
    // Le véhicule se range sous l'auvent, entre deux îlots de pompes (et non sur le trottoir, parmi les arbres du boulevard),
    // face à la boutique : la caméra voit l'auvent, les pompes et la boutique
    const sv = venueId ? this.find(venueId) : undefined;
    // Position (repère du lieu) : le long de l'îlot, côté rue, à côté d'une pompe ; l'îlot est parallèle à la rue, on roule le long de l'axe x
    const spot = sv?.id.startsWith('brand_') ? { lx: 1.2, moto: 3.6, car: 4.0, pumpX: 1.2, pumpZ: 1.5 } : { lx: 4.7, moto: 3.5, car: 3.9, pumpX: 4.7, pumpZ: 1.8 };
    if (sv) {
      // Place du véhicule le long de l'îlot, juste à côté d'une vraie pompe
      const [wx, wz] = rotateXZ(spot.lx, kind === 'MOTO' ? spot.moto : spot.car, venueYaw(sv.id));
      this.player.position.set(sv.x + wx, 0, sv.z + wz);
      this.player.rotation.y = venueYaw(sv.id) + Math.PI / 2; // face à l'axe de la rue (+x du lieu), la pompe sur la droite
      this.yaw = venueYaw(sv.id) + Math.PI; // la caméra regarde depuis la rue : moto, pompe et pompiste de profil
      this.focus.copy(this.player.position);
      this.snapCamera();
    }
    const p = this.player.position;
    const ry = this.player.rotation.y;
    const fx = Math.sin(ry);
    const fz = Math.cos(ry);
    const rx = Math.cos(ry); // à droite du joueur
    const rz = -Math.sin(ry);
    const side = sv ? (kind === 'MOTO' ? 0.85 : 1.4) : kind === 'MOTO' ? 1.35 : 2.1;
    const g = new THREE.Group();
    // Pompe : colonne verte à afficheur lumineux, pistolet accroché
    // À la station, c'est la vraie pompe de l'îlot voisin (x = 5 dans le repère du lieu) ; ailleurs, une pompe posée à côté
    const realPump = sv ? rotateXZ(spot.pumpX, spot.pumpZ, venueYaw(sv.id)) : null;
    const pumpX = realPump ? sv!.x + realPump[0] : p.x + rx * (side + 1.25) + fx * 0.1;
    const pumpZ = realPump ? sv!.z + realPump[1] : p.z + rz * (side + 1.25) + fz * 0.1;
    const pump = new THREE.Group();
    const body = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.62, 1.55, 0.46)), this.mats.color(0x1f9d55));
    body.position.y = 0.78;
    const top = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.7, 0.14, 0.54)), this.mats.color(0xf4f4f1));
    top.position.y = 1.6;
    const face = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.4, 0.3, 0.02)), new THREE.MeshBasicMaterial({ color: 0xffe08a }));
    face.position.set(0, 1.2, 0.24);
    pump.add(body, top, face);
    pump.position.set(pumpX, 0, pumpZ);
    pump.rotation.y = Math.atan2(-rx, -rz);
    if (!realPump) g.add(pump);
    // Pompiste : debout entre la pompe et le véhicule, face au joueur, gilet orange, pistolet à la main
    const att = buildPerson(this.mats, randomLook(rng(4242)));
    const ahead = sv ? 1.05 : 0.15; // à la station, à hauteur du réservoir, devant la roue arrière : visible à côté du joueur
    att.position.set(p.x + rx * side + fx * ahead, 0, p.z + rz * side + fz * ahead);
    att.rotation.y = Math.atan2(-rx, -rz);
    const vest = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.44, 0.5, 0.28)), this.mats.color(0xff7a1a));
    vest.position.set(0, 1.17, 0);
    att.add(vest);
    const arm = att.getObjectByName('armR') ?? null;
    const fore = arm?.getObjectByName('forearm');
    let nozzle: THREE.Object3D | null = null;
    if (fore) {
      nozzle = new THREE.Mesh(this.geo(new THREE.BoxGeometry(0.06, 0.06, 0.28)), this.mats.color(0x111111));
      nozzle.position.set(0, -0.3, 0.12);
      fore.add(nozzle);
    }
    g.add(att);
    // Tuyau noir de la pompe au pistolet, avec un peu de mou
    const a = new THREE.Vector3(pumpX, 1.0, pumpZ);
    const b = new THREE.Vector3(att.position.x, 1.0, att.position.z);
    const mid = a.clone().lerp(b, 0.5);
    mid.y = 0.35;
    const hose = new THREE.Mesh(this.geo(new THREE.TubeGeometry(new THREE.CatmullRomCurve3([a, mid, b]), 14, 0.03, 6)), this.mats.color(0x16181d));
    g.add(hose);
    this.scene.add(g);
    // Le plein se fait quelques secondes après l'arrivée, puis le pompiste range le pistolet
    this.stationProps = { g, arm, attendant: att, nozzle, hose, faceYaw: att.rotation.y, fuelUntil: performance.now() + 6000 };
  }

  /** Textures dessinées en continu (enseignes animées) : redessinées une dizaine de fois par seconde, sans coût hors de la rue. */
  private readonly animTex: { tex: THREE.CanvasTexture; g: CanvasRenderingContext2D; draw: (g: CanvasRenderingContext2D, t: number) => void }[] = [];
  private animLast = 0;

  private animCanvas(w: number, h: number, draw: (g: CanvasRenderingContext2D, t: number) => void): THREE.CanvasTexture {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d')!;
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    this.mats.textures.push(tex);
    draw(g, 0);
    this.animTex.push({ tex, g, draw });
    return tex;
  }

  private updateAnimTex(now: number): void {
    if (this.animTex.length === 0 || now - this.animLast < 90) return;
    this.animLast = now;
    for (const a of this.animTex) {
      a.draw(a.g, now / 1000);
      a.tex.needsUpdate = true;
    }
  }

  /** Logo Moov Africa animé : texte blanc sur fond bleu, croissant orange qui se dessine, losange à croix qui pulse, reflet qui balaie. */
  private drawMoov(g: CanvasRenderingContext2D, t: number, w: number, h: number, wide: boolean): void {
    g.save();
    g.fillStyle = '#1b4fd3';
    g.fillRect(0, 0, w, h);
    const p = Math.min(1, ((t % 5) / 1.8));
    g.save();
    g.beginPath();
    g.rect(0, 0, w * p, h);
    g.clip();
    g.fillStyle = '#ff7a1a';
    g.beginPath();
    if (wide) {
      g.moveTo(24, h * 0.86); g.bezierCurveTo(w * 0.3, h * 1.1, w * 0.7, h * 1.02, w * 0.9, h * 0.52);
      g.bezierCurveTo(w * 0.7, h * 0.84, w * 0.3, h * 0.92, 24, h * 0.86);
    } else {
      g.moveTo(40, 232); g.bezierCurveTo(180, 262, 400, 250, 420, 150);
      g.bezierCurveTo(425, 110, 410, 80, 390, 62); g.bezierCurveTo(400, 130, 370, 200, 290, 225);
      g.bezierCurveTo(200, 250, 100, 245, 40, 232);
    }
    g.fill();
    g.restore();
    g.fillStyle = '#ffffff';
    g.textBaseline = 'alphabetic';
    if (wide) {
      g.font = '900 78px sans-serif';
      g.fillText('Moov Africa', w * 0.1, h * 0.7, w * 0.62);
    } else {
      g.font = '900 88px sans-serif';
      g.fillText('Moov', 120, 125, 250);
      g.fillText('Africa', 118, 215, 270);
    }
    // Losange blanc cerné d'orange, marqué d'une croix : il pulse et oscille doucement
    const cx = wide ? w * 0.93 : 405;
    const cy = wide ? h * 0.5 : 145;
    const r = (wide ? h * 0.36 : 45) * (1 + 0.1 * Math.sin(t * 3));
    g.translate(cx, cy);
    g.rotate(Math.sin(t * 1.6) * 0.18);
    g.fillStyle = '#ff7a1a';
    g.beginPath(); g.moveTo(0, -r); g.lineTo(r, 0); g.lineTo(0, r); g.lineTo(-r, 0); g.closePath(); g.fill();
    g.fillStyle = '#ffffff';
    g.beginPath(); g.moveTo(0, -r * 0.52); g.lineTo(r * 0.52, 0); g.lineTo(0, r * 0.52); g.lineTo(-r * 0.52, 0); g.closePath(); g.fill();
    g.restore();
    // Reflet blanc qui traverse le panneau
    g.save();
    const sx = (((t * 0.35) % 1.6) - 0.3) * w;
    const gr = g.createLinearGradient(sx - w * 0.08, 0, sx + w * 0.08, 0);
    gr.addColorStop(0, 'rgba(255,255,255,0)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.22)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, w, h);
    g.restore();
  }

  /** Le pompiste sert le plein pendant quelques secondes. */
  stationFuel(): void {
    if (this.stationProps) this.stationProps.fuelUntil = performance.now() + 6500;
  }

  private updateStation(now: number): void {
    const sp = this.stationProps;
    if (!sp?.arm) return;
    const t = performance.now();
    const fuelling = t < sp.fuelUntil;
    const att = sp.attendant;
    sp.nozzle && (sp.nozzle.visible = fuelling);
    sp.hose.visible = fuelling;
    // Cap : vers le véhicule pendant le plein ; ensuite il se tourne vers le joueur, avec de petits mouvements d'attente
    const toPlayer = Math.atan2(this.player.position.x - att.position.x, this.player.position.z - att.position.z);
    const target = fuelling ? sp.faceYaw : toPlayer + Math.sin(now / 1700) * 0.12;
    const d = Math.atan2(Math.sin(target - att.rotation.y), Math.cos(target - att.rotation.y));
    att.rotation.y += d * 0.06;
    if (fuelling) {
      // Le bras tient le pistolet à hauteur du réservoir et bouge doucement
      sp.arm.rotation.x = -1.05 + Math.sin(now / 420) * 0.05;
      sp.arm.rotation.z = 0.15;
      att.position.y = 0;
    } else {
      // Au repos : bras le long du corps, respiration, il se balance d'un pied sur l'autre
      sp.arm.rotation.x += (-0.12 + Math.sin(now / 900) * 0.04 - sp.arm.rotation.x) * 0.1;
      sp.arm.rotation.z += (0.08 - sp.arm.rotation.z) * 0.1;
      att.position.y = Math.abs(Math.sin(now / 1100)) * 0.012;
    }
  }

  /** Fait clignoter les guirlandes et plots lumineux : éteints le jour et pendant une coupure d'électricité. */
  private updateBlink(now: number): void {
    if (this.blinkMats.length === 0) return;
    const night = this.powerCut ? 0 : this.nightLevel;
    const t = now / 1000;
    for (const b of this.blinkMats) {
      const wave = 0.5 + 0.5 * Math.sin(t * b.speed + b.phase);
      b.m.emissiveIntensity = night * 1.9 * b.scale * (0.12 + 0.88 * wave * wave);
    }
  }

  // ---------- boucle ----------

  private snapCamera(): void {
    this.computeCamera();
    this.camera.position.copy(this.camPos);
    this.camera.lookAt(this.camLook);
  }

  private computeCamera(): void {
    const p = this.player.position;
    // Prise en charge par le SAMU : caméra fixe de trois quarts, qui cadre le joueur, le brancard et l'arrière de l'ambulance
    const L = this.amb?.load;
    if (L && this.view === 'street') {
      const mx = (L.player.x + L.out.x) / 2;
      const mz = (L.player.z + L.out.z) / 2;
      const dx = L.out.x - L.player.x;
      const dz = L.out.z - L.player.z;
      const d = Math.max(0.01, Math.hypot(dx, dz));
      const ux = dx / d;
      const uz = dz / d;
      // Recul derrière le joueur et décalage sur le côté du brancard
      this.camPos.set(mx - ux * (5 + d / 2) - uz * 4, 5.2, mz - uz * (5 + d / 2) + ux * 4);
      this.camLook.set(mx, 0.9, mz);
      return;
    }
    if (this.view === 'map') {
      const follow = 1 - Math.exp(-Math.min(0.1, this.realDt || 1 / 60) * 5); // suivi lissé, indépendant de la cadence
      if (this.travelDone) this.focus.lerp(p, follow); // suivre le trajet
      else if (this.amb?.phase === 'coming') this.focus.lerp(this.amb.rig.group.position, follow); // suivre l'ambulance qui arrive
      // Vue à environ 48° (comme la carte de référence Lagos Life) : on lit les façades et les panneaux ; essais précédents : 55°, 66° et 60°, trop plongeants
      this.camPos.set(this.focus.x + Math.sin(this.mapYaw) * 90 * this.zoom, 100 * this.zoom, this.focus.z + Math.cos(this.mapYaw) * 90 * this.zoom);
      this.camLook.copy(this.focus);
      // Le brouillard et la portée suivent le recul de la caméra : dézoomée, la carte reste lisible (plus de voile blanc)
      const fog = this.scene.fog as THREE.Fog;
      const reach = Math.max(1, this.zoom);
      if (fog.near !== 140 * reach) {
        fog.near = 140 * reach;
        fog.far = 320 * reach;
        this.camera.far = 500 * reach;
        this.camera.updateProjectionMatrix();
      }
    } else {
      // Vue en plongée derrière le personnage (comme une caméra de jeu de rue) : on voit le perso en entier et la rue
      let dist = 5.4 * this.zoom * this.camScale;
      // Caméra qui passe devant tout bâtiment ou mur situé entre elle et le personnage. On suit le rayon
      // tête → caméra au-dessus des emprises : un bâtiment plus bas que le rayon à cet endroit ne gêne pas.
      // (Remplace un lancer de rayon sur toute la scène, très coûteux avec des milliers de maillages.)
      const sx = -Math.sin(this.yaw);
      const sz = -Math.cos(this.yaw);
      const rise = (3.3 + 1.8 * this.zoom) * this.camScale - 1.6;
      for (let d = 0.6; d <= dist; d += 0.25) {
        if (this.blocked(p.x + sx * d, p.z + sz * d, 0.35, 1.6 + (rise * d) / dist)) {
          dist = Math.max(1.2, d - 0.5);
          break;
        }
      }
      this.camPos.set(p.x - Math.sin(this.yaw) * dist, this.groundY + (3.3 + 1.8 * this.zoom) * this.camScale, p.z - Math.cos(this.yaw) * dist);
      this.camLook.set(p.x + Math.sin(this.yaw) * 5.2, this.groundY + 1.1, p.z + Math.cos(this.yaw) * 5.2);
    }
  }

  private readonly quality: Quality;
  private adaptationLevel = 0;
  private slowFor = 0;
  private emaDt = 1 / 60;

  /**
   * Qualité adaptative : deux paliers espacés réduisent d'abord la résolution, puis les ombres.
   * On ne remonte pas automatiquement pendant la partie afin d'éviter pompage et micro-saccades.
   */
  private adapt(): void {
    if (this.adaptationLevel >= 2) return;
    const dt = this.realDt;
    if (dt <= 0 || dt > 0.25) return; // onglet masqué ou reprise : mesure ignorée
    this.emaDt += (dt - this.emaDt) * 0.1;
    this.slowFor = this.emaDt > 1 / 23 ? this.slowFor + dt : Math.max(0, this.slowFor - dt * 2);
    if (this.slowFor < 2.5) return;
    this.slowFor = 0;
    this.adaptationLevel++;
    const scale = this.adaptationLevel === 1 ? 0.76 : 0.58;
    this.renderer.setPixelRatio(Math.max(0.6, pixelRatioFor(this.quality) * scale));
    if (this.adaptationLevel === 2) this.renderer.shadowMap.enabled = false;
    this.resize();
  }

  private paused = false;
  /** Ville masquée (trajet vu depuis l'intérieur du bus) : la simulation et le trajet continuent, sans rendu. */
  private hidden = false;

  /** Capture de la vue 3D actuelle (PNG) ; null si la scène n'est pas affichée. */
  capture(): Promise<Blob | null> {
    if (this.hidden || this.disposed) return Promise.resolve(null);
    // Dessiner puis lire dans la même tâche : le tampon est encore valide (pas de preserveDrawingBuffer).
    this.renderer.render(this.scene, this.camera);
    return new Promise((done) => this.renderer.domElement.toBlob(done, 'image/png'));
  }

  setHidden(on: boolean): void {
    this.hidden = on;
    this.pinLayer.style.display = on || this.paused ? 'none' : '';
  }

  /** Pause pendant qu'on est dans un bâtiment : plus de rendu ni de son de rue, la scène reste prête. */
  setActive(on: boolean): void {
    if (this.paused === !on) return;
    this.paused = !on;
    this.pinLayer.style.display = on ? '' : 'none';
    if (on) {
      this.lastFrame = 0;
      this.renderer.shadowMap.needsUpdate = true;
      cancelAnimationFrame(this.raf);
      this.raf = requestAnimationFrame(this.loop);
    } else {
      cancelAnimationFrame(this.raf);
      updateStreetSound(0, 0, false);
    }
  }

  private readonly loop = (now: number): void => {
    if (this.disposed || this.paused) return;
    this.raf = requestAnimationFrame(this.loop);
    const minDt = 1000 / this.profile.maxFps;
    if (this.lastFrame && now - this.lastFrame < minDt - 1) return;
    const dt = this.lastFrame ? Math.min(0.1, (now - this.lastFrame) / 1000) : 0;
    this.realDt = this.lastFrame ? (now - this.lastFrame) / 1000 : 0;
    this.lastFrame = now;
    const p = this.player.position;
    let moving = false;

    // 1) Trajet ou marche vers un point
    const next = this.route[0];
    if (next) {
      const dx = next.x - p.x;
      const dz = next.z - p.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.1) {
        this.groundY = next.y;
        this.route.shift();
        // Le ruban rouge s'efface derrière le joueur, tronçon par tronçon
        if (this.routeRibbon) this.routeRibbon.geometry.setDrawRange((this.trip.points - this.route.length) * 6, Infinity);
        if (this.route.length === 0) {
          this.clearRoute();
          this.riding = null;
          // Arrivé : face au lieu
          if (this.arriveYaw !== null) {
            this.player.rotation.y = this.arriveYaw;
            this.yaw = this.arriveYaw;
            this.arriveYaw = null;
          }
          const done = this.travelDone;
          this.travelDone = null;
          done?.();
        }
      } else {
        // `dt` est plafonné à 100 ms : après un onglet suspendu, la moto ne saute plus plusieurs mètres
        // en une image au travers d'une voiture ou d'un carrefour.
        // Reprise progressive après un arrêt (voiture devant, feu) : pas de démarrage sec, c'est ce qui faisait « trembler » la moto
        const full = this.speed * dt * (this.travelDone ? this.tripEase : 1);
        const step = Math.min(dist, full);
        let advanced = true;
        if (this.travelDone) {
          // Trajet planifié : le joueur respecte aussi les véhicules ambiants et attend que la voie se libère.
          const targetPoint = this.tmp.v.set(p.x + (dx / dist) * step, 0, p.z + (dz / dist) * step);
          const radius = this.riding === 'BUS' ? 1.15 : this.riding === 'CAR' || this.riding === 'WORO' ? 0.9 : this.riding === 'ZEM' ? 0.58 : 0.35;
          // Un véhicule arrêté devant (feu rouge, embouteillage) ne bloque pas le joueur indéfiniment : et comme
          // la circulation s'arrête aussi pour lui, l'attente mutuelle figeait le trajet. Au bout de 2,5 s il passe.
          // Feux tricolores : en véhicule, le joueur s'arrête au rouge (et à l'orange s'il peut encore freiner) comme la circulation,
          // et ralentit à l'approche de la ligne d'arrêt.
          let redStop = false;
          if (this.riding && this.groundY < 2) {
            const ux = dx / dist;
            const uz = dz / dist;
            const axis: 'x' | 'z' = Math.abs(ux) > Math.abs(uz) ? 'x' : 'z';
            let slow = 1;
            for (let i = 0; i < SIGNALS.length; i++) {
              const sg = SIGNALS[i]!;
              const rx = sg.x - p.x;
              const rz = sg.z - p.z;
              const fwd = rx * ux + rz * uz;
              if (fwd <= 0 || fwd > 30 || Math.abs(rx * uz - rz * ux) > ROAD_W / 2 + 1) continue;
              const ahead = fwd - ROAD_W / 2 - 2.2; // distance jusqu'à la ligne d'arrêt
              if (ahead < -0.5) continue; // déjà engagé dans le carrefour : on le dégage
              const light = signalState(i, axis, this.lightT);
              if (light === 'green' || (light === 'amber' && ahead < brakingDistance(this.speed))) continue;
              slow = Math.min(slow, Math.max(0.15, ahead / 8));
              if (ahead <= full + 0.3) redStop = true;
            }
            // Distance de sécurité : on garde 2,5 m plus 1,3 s de route derrière le véhicule de devant, on ralentit progressivement
            // dès qu'on s'en approche, on s'arrête à 1,5 m et on le suit à sa vitesse
            const half = this.riding === 'BUS' ? 3.8 : this.riding === 'CAR' || this.riding === 'WORO' ? 2.2 : 1.1;
            const lead = this.leadAhead(ux, uz, 40, half);
            if (lead) {
              const speedNow = this.speed * this.tripEase;
              const safe = 2.5 + speedNow * 1.3;
              if (lead.gap < safe) slow = Math.min(slow, Math.max(0.05, (lead.gap - 1.5) / Math.max(0.5, safe - 1.5)));
              if (lead.gap < 3 && lead.v < 0.5) this.followT += dt;
              else this.followT = Math.max(0, this.followT - dt * 2);
            } else this.followT = Math.max(0, this.followT - dt * 2);
            this.tripEase = Math.min(this.tripEase, slow);
          }
          // Près de l'arrivée, un véhicule garé ou à l'arrêt ne fait plus contourner ni attendre : on rejoint le point d'arrêt
          const nearEnd = this.route.length <= 1 && dist < 3.5;
          let blocked = !redStop && !nearEnd && this.groundY < 2 && this.trafficOnSegment(p, targetPoint, radius);
          // Véhicule devant : la moto (ou la voiture) cherche d'abord un passage sur le côté, comme on double dans la vraie vie, au
          // lieu d'attendre puis de traverser le véhicule. Elle essaie 30° puis 52° de chaque côté (voie libre, sans mur), mais au plus
          // 2,5 s : ensuite elle attend derrière (jusqu'à 10 s) plutôt que de tourner en rond.
          let swerved = false;
          // Collé plus de 4 s derrière un véhicule immobile (hors feu rouge) : on cherche aussi à le doubler
          if ((blocked || (!redStop && this.followT > 4)) && this.tripWait < 10 && this.swerveT < 2.5) {
            const ux = dx / dist;
            const uz = dz / dist;
            for (const ang of [0.5, -0.5, 0.9, -0.9]) {
              const c = Math.cos(ang);
              const sn = Math.sin(ang);
              const cand = new THREE.Vector3(p.x + (ux * c - uz * sn) * step, 0, p.z + (ux * sn + uz * c) * step);
              if (this.trafficOnSegment(p, cand, radius) || this.blocked(cand.x, cand.z, radius, 0.5)) continue;
              p.x = cand.x;
              p.z = cand.z;
              this.trip.done += step * 0.5;
              this.tripEase = Math.max(this.tripEase, 0.45);
              this.swerveT += dt;
              swerved = true;
              blocked = false;
              break;
            }
          } else if (!blocked) this.swerveT = Math.max(0, this.swerveT - dt * 2);
          if (redStop) {
            this.tripEase = 0.1;
            advanced = false;
          } else if (swerved) {
            /* contourné : on repart vers le prochain point à l'image suivante */
          } else if (blocked && this.tripWait < 10) {
            this.tripWait += dt;
            this.tripEase = 0.15;
            advanced = false;
          } else {
            if (!blocked) this.tripWait = Math.max(0, this.tripWait - dt * 2);
            this.tripEase = Math.min(1, this.tripEase + dt * 2.5);
            p.x = targetPoint.x;
            p.z = targetPoint.z;
            this.trip.done += step;
            this.groundY += (next.y - this.groundY) * Math.min(1, step / dist);
            // Le point est atteint avant la fin du pas : le reste du pas est parcouru vers le point suivant, sans image « perdue »
            // (sinon, à 8 m/s, un à-coup revenait à chaque point du tracé)
            const left = full - step;
            const after = this.route[1];
            if (left > 1e-4 && after && step >= dist - 1e-6 && !blocked) {
              const ex = after.x - p.x;
              const ez = after.z - p.z;
              const ed = Math.hypot(ex, ez);
              if (ed > 1e-4) {
                const m = Math.min(ed, left);
                p.x += (ex / ed) * m;
                p.z += (ez / ed) * m;
                this.trip.done += m;
                this.groundY = next.y;
                this.route.shift();
                if (this.routeRibbon) this.routeRibbon.geometry.setDrawRange((this.trip.points - this.route.length) * 6, Infinity);
              }
            }
          }
        } else if (!this.moveTo(p.x + (dx / dist) * step, p.z + (dz / dist) * step)) {
          this.route = []; // un mur : on s'arrête devant
          advanced = false;
        }
        const target = Math.atan2(dx, dz);
        const diff = Math.atan2(Math.sin(target - this.player.rotation.y), Math.cos(target - this.player.rotation.y));
        this.player.rotation.y += diff * Math.min(1, dt * 10);
        if (this.view === 'street') this.yaw += Math.atan2(Math.sin(this.player.rotation.y - this.yaw), Math.cos(this.player.rotation.y - this.yaw)) * Math.min(1, dt * 3);
        moving = advanced;
      }
    } else if (this.view === 'street' && !this.ambHold) {
      // 2) Clavier (ZQSD / WASD / flèches) et joystick : la caméra suit le regard
      const k = this.keys;
      const fwd = (k.has('w') || k.has('z') || k.has('arrowup') ? 1 : 0) - (k.has('s') || k.has('arrowdown') ? 1 : 0) + this.joy.y;
      const turn = (k.has('d') || k.has('arrowright') ? 1 : 0) - (k.has('a') || k.has('q') || k.has('arrowleft') ? 1 : 0) + this.joy.x;
      if (Math.abs(turn) > 0.05) this.yaw -= turn * dt * 2.2;
      // Pas de conduite à la main : au guidon ou au volant, on choisit sa destination et le trajet se fait tout seul
      if (Math.abs(fwd) > 0.05 && !this.rideKind) {
        const f = THREE.MathUtils.clamp(fwd, -1, 1);
        moving = this.moveTo(p.x + Math.sin(this.yaw) * f * 4.5 * dt, p.z + Math.cos(this.yaw) * f * 4.5 * dt);
        this.player.rotation.y = f > 0 ? this.yaw : this.yaw + Math.PI;
      }
    }

    // Véhicule sous le personnage pendant un trajet
    for (const [mode, v] of Object.entries(this.vehicles) as [Exclude<TravelMode, 'WALK'>, THREE.Group][]) {
      v.visible = this.riding === mode;
      if (v.visible) {
        v.position.set(p.x, this.groundY, p.z);
        v.rotation.y = this.player.rotation.y;
        // Passager : moto avancée, le joueur est sur la selle arrière derrière le conducteur.
        // Sa propre moto : le joueur est sur la selle du conducteur.
        if (mode === 'ZEM') {
          const k = this.ownMoto ? -0.12 : 0.5;
          v.position.x += Math.sin(v.rotation.y) * k;
          v.position.z += Math.cos(v.rotation.y) * k;
        }
      }
    }
    // Course en taxi : on voit le joueur assis dans l'habitacle, pas son corps perché sur le toit
    this.player.visible = (this.riding !== 'WORO' && this.riding !== 'CAR') || this.ambHold;
    if (this.taxiRider) this.taxiRider.visible = this.riding === 'WORO';
    if (this.carDriver) this.carDriver.visible = this.riding === 'CAR';
    // Pendant la prise en charge par le SAMU, c'est la scène de l'ambulance qui place le personnage
    this.updateAmbulance(now, dt);
    if (!this.ambHold) {
      const seated = this.riding !== null;
      this.player.position.y = this.groundY + (seated ? (this.riding === 'ZEM' ? 0 : 0.8) : moving ? Math.abs(Math.sin(this.walkPhase)) * 0.06 : 0);
      if (moving && !seated) this.walkPhase += dt * 10;
      if (this.riding !== 'ZEM') clearRidePose(this.player);
      animateWalk(this.player, this.walkPhase, moving && !seated ? 0.6 : 0);
      if (this.riding === 'ZEM') {
        // Sur la moto : conducteur (pieds sur les cale-pieds, mains au guidon) ou passager derrière. Le joueur est décalé de 0,12 m
        // en arrière du modèle de moto quand il conduit, de 0,5 m en avant quand il est passager.
        const own = this.ownMoto;
        ridePose(this.player, own ? motoRideSpec(ZEM_SEAT) : motoPillionSpec(), this.tmp.v.set(0, 0, own ? -0.12 : 0.5));
      } else if (seated) seatLegs(this.player);
    }
    // Repère au-dessus du joueur : plus grand sur la carte, il rebondit doucement
    {
      const travelling = !!this.travelDone;
      const k = this.view === 'map' ? 2.4 * this.zoom : 0.35; // en rue : un tout petit repère, sans tracé
      const lift = this.view === 'map' ? 7 * this.zoom : this.riding === 'BUS' || this.riding === 'WORO' || this.riding === 'CAR' ? 3.6 : 2.7;
      const bob = Math.sin(now / 260) * 0.25 * k;
      this.youMarker.position.set(p.x, this.groundY, p.z);
      this.youMarker.visible = travelling || this.view === 'map';
      const arrow = this.youMarker.children[1]!;
      const rim = this.youMarker.children[0]!;
      arrow.position.y = lift + bob;
      rim.position.y = lift + bob + 0.06 * k;
      arrow.scale.setScalar(k);
      rim.scale.setScalar(k);
      const ring = this.youMarker.children[2]!;
      ring.visible = this.view === 'map';
      ring.position.y = 0.2;
      const pulse = 1 + ((now / 900) % 1) * 0.8;
      ring.scale.setScalar(k * pulse);
      ((ring as THREE.Mesh).material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - ((now / 900) % 1));
      this.routeFlag.scale.setScalar(Math.max(1, 2.2 * this.zoom));
      this.routeFlag.visible = this.view === 'map' && this.route.length > 0;
      if (this.routeRibbon) this.routeRibbon.visible = false; // plus de tracé rouge : le repère et la barre de progression suffisent
    }
    const mm = this.marker.material as THREE.MeshBasicMaterial;
    mm.opacity = Math.max(0, mm.opacity - dt * 0.8);

    // Lieu proche (rue)
    if (this.view === 'street' && !this.travelDone) {
      // Le lieu le plus proche (et non le premier de la liste) : deux entrées voisines (station et supermarché, par exemple) ne se
      // confondent plus ; à égalité, le lieu où l'on vient d'arriver garde la priorité
      const v = this.nearestEntry(p.x, p.z, 7, this.arrived);
      const id = v?.id ?? null;
      if (id !== this.near) {
        this.near = id;
        this.opts.onNear(id);
      }
      // Devant l'entrée (à 2,6 m ; on ne repart qu'à 4 m pour éviter les allers-retours)
      const at = this.nearestEntry(p.x, p.z, 4, this.arrived, 2.6);
      if ((at?.id ?? null) !== this.arrived) {
        this.arrived = at?.id ?? null;
        this.opts.onArrive?.(this.arrived);
      }
    }

    if (this.customer && !this.customer.parcel && !this.customer.car) {
      const c = this.customer;
      const spot = this.customerSpot();
      const dx = spot.x - c.g.position.x;
      const dz = spot.z - c.g.position.z;
      const d = Math.hypot(dx, dz);
      if (d > 0.15) {
        // On l'a déjà servi (OK appuyé) : il presse le pas, pour que le geste ne reste pas en attente
        const v = this.work?.act ? 6 : 2.4;
        c.g.position.x += (dx / d) * Math.min(d, v * dt);
        c.g.position.z += (dz / d) * Math.min(d, v * dt);
        c.g.rotation.y = Math.atan2(dx, dz);
        c.phase += dt * (this.work?.act ? 16 : 9);
        animateWalk(c.g, c.phase, 0.55);
      } else {
        c.arrived = true;
        if (spot.sit && !c.seated) {
          // Il s'assoit dans le fauteuil, de dos au miroir
          sitPose(c.g);
          c.seated = true;
        }
        c.g.rotation.y = spot.sit ? spot.face : Math.atan2(p.x - c.g.position.x, p.z - c.g.position.z);
        if (!spot.sit) animateWalk(c.g, 0, 0);
      }
    }
    this.updateWork(dt);
    this.updateVipSpots();
    this.updateBeach();
    this.updateStreetLife(dt);
    this.updateRemotes(dt);
    // Bruits de la rue selon les véhicules proches (2 fois par seconde)
    this.soundT -= this.realDt;
    if (this.soundT <= 0) {
      this.soundT = 0.5;
      const near = (axis: 'x' | 'z', lane: number, pos: number) => Math.hypot((axis === 'x' ? pos : lane) - p.x, (axis === 'x' ? lane : pos) - p.z) < 28;
      const street = this.view === 'street' && !document.hidden;
      updateStreetSound(street ? this.cars.filter((c) => !c.off && near(c.axis, c.lane, c.pos)).length : 0, street ? this.zems.filter((z) => near(z.axis, z.lane, z.pos)).length : 0, street);
    }
    this.updateFlights(dt);
    this.computeCamera();
    for (const r of this.seeThroughRoofs) {
      const under = p.x > r.x0 && p.x < r.x1 && p.z > r.z0 && p.z < r.z1;
      if (r.parts[0]!.visible === under) for (const o of r.parts) o.visible = !under;
    }
    const k = Math.min(1, dt * 5);
    this.camera.position.lerp(this.camPos, k);
    this.tmp.w.lerp(this.camLook, k);
    this.camera.lookAt(this.tmp.w);
    this.sky.position.copy(this.camera.position);
    this.applyDayNight(this.getMinuteOfDay());
    this.updateRain(dt);
    if (this.hidden) return;
    this.adapt();
    this.updateScreens(now);
    this.updateBlink(now);
    this.updateStation(now);
    this.updateAnimTex(now);
    this.renderer.render(this.scene, this.camera);
    this.updatePins();
  };

  /** Navire : coque (œuvres vives rouges), pont, conteneurs empilés, château et cheminée ; remorqueur sans conteneurs. */
  /**
   * Navire moderne, proue vers +z. Porte-conteneurs : coque effilée à étrave droite et bulbe, ligne de flottaison blanche,
   * passerelles de saisissage entre les baies, château blanc à l'arrière (vitres de passerelle allumées la nuit, ailerons),
   * cheminée aux couleurs de la compagnie, mât de proue avec feu. Remorqueur (`cargo` faux) : coque rouge et blanche,
   * timonerie vitrée haute, défenses noires.
   */
  private buildShip(hull: number, len: number, cargo = true, brand?: string): THREE.Group {
    const g = new THREE.Group();
    const add = (w: number, h: number, d: number, c: number | THREE.Material, x: number, y: number, z: number) => {
      const m = new THREE.Mesh(this.geo(new THREE.BoxGeometry(w, h, d)), typeof c === 'number' ? this.mats.color(c) : c);
      m.position.set(x, y, z);
      m.castShadow = this.profile.shadows;
      g.add(m);
      return m;
    };
    const w = Math.max(3, len * 0.16);
    // Plan de coque : arrière à tableau, flancs droits, étrave affinée sur le dernier quart
    const hullShape = (hw: number, half: number) => {
      const sh = new THREE.Shape();
      const bow = half * (cargo ? 0.42 : 0.5);
      sh.moveTo(-hw * 0.92, half);
      sh.lineTo(hw * 0.92, half);
      sh.quadraticCurveTo(hw, half - 0.6, hw, half - 1.2);
      sh.lineTo(hw, -half + bow);
      sh.quadraticCurveTo(hw * 0.9, -half + bow * 0.25, 0, -half);
      sh.quadraticCurveTo(-hw * 0.9, -half + bow * 0.25, -hw, -half + bow);
      sh.lineTo(-hw, half - 1.2);
      sh.quadraticCurveTo(-hw, half - 0.6, -hw * 0.92, half);
      return sh;
    };
    // Shape (x, y = −z) extrudé sur la hauteur, puis couché : y du dessin → −z, épaisseur → +y
    const slab = (hw: number, half: number, h: number, c: number, y: number) => {
      const geo = new THREE.ExtrudeGeometry(hullShape(hw, half), { depth: h, bevelEnabled: false, curveSegments: 6 }).rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(this.geo(geo), this.mats.color(c));
      m.position.y = y;
      m.castShadow = this.profile.shadows;
      g.add(m);
      return m;
    };
    const half = len / 2;
    if (!cargo) {
      // Remorqueur portuaire
      slab(w / 2, half, 1.1, 0x9b2226, -0.2);
      slab(w / 2, half, 1.3, hull, 0.9);
      slab(w / 2 - 0.05, half - 0.05, 0.12, 0xf2f4f6, 2.2);
      for (const sx of [-1, 1]) add(0.25, 0.5, len * 0.8, 0x161616, sx * (w / 2 + 0.05), 1.5, 0); // défenses
      add(w * 0.7, 1.4, len * 0.34, 0xf2f4f6, 0, 3, -len * 0.05);
      add(w * 0.62, 1.1, len * 0.26, 0xf2f4f6, 0, 4.25, -len * 0.05);
      add(w * 0.64, 0.5, len * 0.27, this.litGlass(), 0, 4.35, -len * 0.05); // timonerie vitrée
      add(0.25, 1.6, 0.25, 0x2b2f36, 0, 5.6, -len * 0.08);
      add(0.8, 1.2, 0.8, 0xffce00, 0, 3.6, -len * 0.3); // cheminée
      return g;
    }
    // Œuvres vives rouges, bande blanche de flottaison, coque haute, pont gris clair
    slab(w / 2, half, 1.3, 0x9b2226, -0.4);
    slab(w / 2 + 0.01, half + 0.01, 0.16, 0xf2f4f6, 0.9);
    slab(w / 2, half, 2.1, hull, 1.05);
    slab(w / 2 - 0.12, half - 0.12, 0.14, 0xc9ced4, 3.15);
    // Bulbe d'étrave sous la flottaison
    const bulb = new THREE.Mesh(this.geo(new THREE.SphereGeometry(w * 0.2, 10, 8)), this.mats.color(0x9b2226));
    bulb.scale.set(1, 1, 2.2);
    bulb.position.set(0, 0.1, half - w * 0.1);
    g.add(bulb);
    // Gaillard d'avant, brise-lames et mât de proue avec feu
    add(w * 0.8, 0.9, len * 0.08, hull, 0, 3.7, half - len * 0.09);
    add(w * 0.75, 0.8, 0.15, 0xf2f4f6, 0, 4.2, half - len * 0.14);
    add(0.18, 3, 0.18, 0xf2f4f6, 0, 5.4, half - len * 0.07);
    const cols = [0xe5383b, 0x1f6feb, 0x22a861, 0xf18f01, 0xffffff, 0xffce00, 0x6b7280, 0x0f766e];
    // Baies de conteneurs (trois niveaux), passerelles de saisissage blanches entre les baies
    const bays = Math.floor((len * 0.6) / 2.6);
    for (let i = 0; i < bays; i++) {
      const bz = half - len * 0.2 - i * 2.6;
      for (let k = 0; k < 3; k++) add(w - 0.6, 1.1, 2.3, cols[(i * 3 + k * 5) % cols.length]!, 0, 3.8 + k * 1.15, bz).userData.layer = k;
      if (i % 2 === 1) add(w - 0.3, 2.6, 0.14, 0xe6e9ec, 0, 4.5, bz + 1.3);
    }
    // Conteneurs du pont, du haut de la pile vers le bas : ordre de déchargement par les portiques
    g.userData.stack = g.children.filter((c) => c.userData.layer !== undefined).sort((a, b) => b.userData.layer - a.userData.layer);
    // Nom de l'armateur en grandes lettres blanches sur les deux flancs (comme MSC sur ses porte-conteneurs)
    if (brand) {
      const cv = document.createElement('canvas');
      cv.width = 512;
      cv.height = 96;
      const cg = cv.getContext('2d')!;
      cg.fillStyle = '#ffffff';
      cg.font = 'bold 84px sans-serif';
      cg.textAlign = 'center';
      cg.textBaseline = 'middle';
      cg.fillText(brand, 256, 52);
      const tex = new THREE.CanvasTexture(cv);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.mats.textures.push(tex);
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false });
      for (const side of [-1, 1]) {
        const name = new THREE.Mesh(this.geo(new THREE.PlaneGeometry(len * 0.42, len * 0.08)), mat);
        name.position.set(side * (w / 2 + 0.03), 2.1, -len * 0.05);
        name.rotation.y = side * Math.PI / 2;
        g.add(name);
      }
    }
    // Château arrière : superstructure blanche à étages, passerelle vitrée et ailerons, mât radar
    const cz = -half + len * 0.13;
    add(w - 0.5, 5.2, len * 0.12, 0xf2f4f6, 0, 5.8, cz);
    for (const fy of [4.4, 5.8, 7.2]) add(w - 0.45, 0.35, len * 0.122, this.litGlass(), 0, fy, cz + 0.02);
    add(w + 0.9, 0.5, 1.4, 0xf2f4f6, 0, 8.4, cz + len * 0.04); // passerelle et ailerons
    add(w + 0.8, 0.4, 1.42, this.litGlass(), 0, 8.1, cz + len * 0.04);
    add(0.2, 2.2, 0.2, 0x2b2f36, 0, 9.8, cz);
    add(1.4, 0.12, 0.25, 0x2b2f36, 0, 10.6, cz);
    // Cheminée de compagnie : bande de couleur sur fond blanc, sommet noir
    add(1.3, 2.4, 1.6, 0xf2f4f6, 0, 9.2, cz - len * 0.07);
    add(1.32, 0.6, 1.62, hull === 0x14213d ? 0xf2c94c : 0x1f6feb, 0, 9.4, cz - len * 0.07);
    add(1.34, 0.35, 1.64, 0x161616, 0, 10.55, cz - len * 0.07);
    return g;
  }

  /** Avion de ligne moyen-courrier low-poly : silhouette crédible sans pénaliser la carte. */
  private buildPlane(livery: number): THREE.Group {
    const g = new THREE.Group();
    const white = this.mats.color(0xffffff);
    const mesh = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
      const o = new THREE.Mesh(this.geo(geo), m);
      o.position.set(x, y, z);
      o.castShadow = this.profile.shadows;
      g.add(o);
      return o;
    };
    // Cellule orientée vers +x : nez arrondi, cabine cylindrique et cône arrière effilé.
    const body = mesh(new THREE.CylinderGeometry(1.18, 1.18, 17.5, 16), white, -0.1, 2.45, 0);
    body.rotation.z = Math.PI / 2;
    const nose = mesh(new THREE.SphereGeometry(1.18, 16, 10), white, 8.9, 2.45, 0);
    nose.scale.set(1.5, 1, 1);
    const tailCone = mesh(new THREE.ConeGeometry(1.18, 4.2, 16), white, -10.8, 2.45, 0);
    tailCone.rotation.z = Math.PI / 2;
    // Bande de compagnie et hublots réellement séparés, regroupés en une seule instance.
    mesh(new THREE.BoxGeometry(17.2, 0.26, 2.39), this.mats.color(livery), -0.2, 1.95, 0);
    const windows = new THREE.InstancedMesh(this.geo(new THREE.BoxGeometry(0.58, 0.3, 0.06)), this.mats.color(0x172b3a), 18);
    const wm = new THREE.Matrix4();
    let wi = 0;
    for (const side of [-1, 1]) for (let i = 0; i < 9; i++) {
      wm.makeTranslation(5.9 - i * 1.45, 2.82, side * 1.17);
      windows.setMatrixAt(wi++, wm);
    }
    windows.castShadow = false;
    g.add(windows);
    // Pare-brise incliné du cockpit.
    for (const side of [-1, 1]) {
      const cockpit = mesh(new THREE.BoxGeometry(0.8, 0.38, 0.06), this.mats.color(0x102535), 8.65, 2.85, side * 0.82);
      cockpit.rotation.y = side * -0.34;
      cockpit.rotation.z = -0.12;
    }
    // Ailes en flèche : une géométrie plane commune, bien lisible depuis la vue aérienne.
    const wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      3.2, 2.25, 0.45, -2.6, 2.25, 0.75, -5.3, 2.25, 11.2, -3.5, 2.25, 11.2,
      3.2, 2.25, -0.45, -2.6, 2.25, -0.75, -5.3, 2.25, -11.2, -3.5, 2.25, -11.2,
    ], 3));
    wingGeo.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
    wingGeo.computeVertexNormals();
    const wingMat = this.mats.color(0xe5e9ee).clone();
    wingMat.side = THREE.DoubleSide;
    const wings = new THREE.Mesh(this.geo(wingGeo), wingMat);
    wings.castShadow = this.profile.shadows;
    g.add(wings);
    // Deux turboréacteurs sous les ailes, avec entrée d'air et fan sombres.
    for (const side of [-1, 1]) {
      const engine = mesh(new THREE.CylinderGeometry(0.62, 0.52, 2.8, 12), this.mats.color(0xc9d1db), 0.5, 1.2, side * 4.25);
      engine.rotation.z = Math.PI / 2;
      const intake = mesh(new THREE.TorusGeometry(0.54, 0.11, 6, 12), this.mats.color(0x4b5563), 1.92, 1.2, side * 4.25);
      intake.rotation.y = Math.PI / 2;
      const fan = mesh(new THREE.CircleGeometry(0.43, 12), this.mats.color(0x202a34), 1.94, 1.2, side * 4.25);
      fan.rotation.y = Math.PI / 2;
    }
    // Empennage horizontal effilé.
    const tailGeo = new THREE.BufferGeometry();
    tailGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -7.4, 2.9, 0.3, -11.1, 2.9, 0.35, -11.6, 2.9, 4.7, -10.2, 2.9, 4.7,
      -7.4, 2.9, -0.3, -11.1, 2.9, -0.35, -11.6, 2.9, -4.7, -10.2, 2.9, -4.7,
    ], 3));
    tailGeo.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
    tailGeo.computeVertexNormals();
    const tail = new THREE.Mesh(this.geo(tailGeo), wingMat);
    tail.castShadow = this.profile.shadows;
    g.add(tail);
    // Dérive verticale triangulaire aux couleurs de la compagnie.
    const finGeo = new THREE.BufferGeometry();
    finGeo.setAttribute('position', new THREE.Float32BufferAttribute([
      -7.8, 2.7, 0, -11.5, 2.7, 0, -10.8, 6.6, 0,
    ], 3));
    finGeo.setIndex([0, 1, 2]);
    finGeo.computeVertexNormals();
    const finMat = this.mats.color(livery).clone();
    finMat.side = THREE.DoubleSide;
    const fin = new THREE.Mesh(this.geo(finGeo), finMat);
    fin.castShadow = this.profile.shadows;
    g.add(fin);
    // Train d'atterrissage groupé : visible au sol, rétracté automatiquement après le décollage.
    const gear = new THREE.Group();
    const strutGeo = this.geo(new THREE.CylinderGeometry(0.08, 0.08, 1.15, 6));
    const wheelGeo = this.geo(new THREE.CylinderGeometry(0.28, 0.28, 0.18, 10));
    for (const [gx, gz] of [[6.4, 0], [-1.8, -1.35], [-1.8, 1.35]] as const) {
      const strut = new THREE.Mesh(strutGeo, this.mats.color(0x6b7280));
      strut.position.set(gx, 1.05, gz);
      const wheel = new THREE.Mesh(wheelGeo, this.mats.color(0x202124));
      wheel.rotation.x = Math.PI / 2;
      wheel.position.set(gx, 0.42, gz);
      gear.add(strut, wheel);
    }
    g.add(gear);
    g.userData.gear = gear;
    // Feux de navigation aux saumons d'aile.
    mesh(new THREE.SphereGeometry(0.16, 7, 5), this.mats.color(0x22c55e), -4.45, 2.28, 11.15);
    mesh(new THREE.SphereGeometry(0.16, 7, 5), this.mats.color(0xef4444), -4.45, 2.28, -11.15);
    return g;
  }

  /** Cycle d'un vol : roulage, décollage, montée, puis approche et atterrissage (≈ 70 s). */
  private updateFlights(dt: number): void {
    for (const r of this.radars) r.rotation.y += dt * 1.2;
    // Cargo : arrive du large (90 s), reste à quai, repart (cycle de 4 minutes)
    for (const sh of this.ships) {
      sh.t = (sh.t + dt) % 240;
      const k = sh.t < 90 ? 1 - sh.t / 90 : sh.t < 150 ? 0 : (sh.t - 150) / 90;
      sh.g.position.set(sh.x, 0, sh.zNear + (sh.zFar - sh.zNear) * k);
      sh.g.rotation.y = sh.t < 150 ? Math.PI : 0; // proue vers le port à l'arrivée, vers le large au départ
    }
    this.updatePort(dt);
    this.lightT = (this.lightT + dt) % SIGNAL_CYCLE;
    for (const l of this.lights) {
      const state = signalState(l.sig, l.axis, this.lightT);
      if (state !== l.state) {
        l.state = state;
        // Lampe éteinte presque noire (sinon, la nuit, on croit voir deux feux allumés), lampe allumée vive avec halo
        (l.green.material as THREE.MeshBasicMaterial).color.setHex(state === 'green' ? 0x14e06a : 0x07170e);
        (l.amber.material as THREE.MeshBasicMaterial).color.setHex(state === 'amber' ? 0xffb000 : 0x1a1405);
        (l.red.material as THREE.MeshBasicMaterial).color.setHex(state === 'red' ? 0xff2a1f : 0x1c0706);
        l.halo?.forEach((h, k) => (h.opacity = (k === 0 ? state === 'red' : k === 1 ? state === 'amber' : state === 'green') ? 0.28 : 0));
      }
    }
    for (const f of this.flights) {
      f.t = (f.t + dt) % 70;
      const t = f.t;
      const len = f.x1 - f.x0;
      let x: number;
      let y = 0;
      let pitch = 0;
      let visible = true;
      if (t < 8) x = f.x0; // attente en bout de piste
      else if (t < 20) {
        const k = (t - 8) / 12; // accélération au sol
        x = f.x0 + len * 0.7 * k * k;
      } else if (t < 32) {
        const k = (t - 20) / 12; // rotation et montée
        x = f.x0 + len * 0.7 + k * 120;
        y = k * k * 60;
        pitch = 0.18;
      } else if (t < 46) {
        x = f.x0; // hors de vue (en vol)
        visible = false;
      } else if (t < 60) {
        const k = (t - 46) / 14; // approche depuis l'est, descente puis toucher
        x = f.x1 + 140 - k * 160;
        y = Math.max(0, (1 - k) * 45);
        pitch = y > 0 ? -0.06 : 0;
      } else {
        const k = (t - 60) / 10; // freinage puis retour vers l'ouest au roulage
        x = f.x1 - 20 - len * 0.6 * k;
      }
      f.g.visible = visible;
      f.g.position.set(x, y, f.z);
      const gear = f.g.userData.gear as THREE.Group | undefined;
      if (gear) gear.visible = y < 3;
      // Le nez pointe vers +x à l'aller, vers −x à l'approche
      f.g.rotation.set(0, t >= 46 ? Math.PI : 0, t >= 46 ? -pitch : pitch);
    }
  }

  /**
   * L'ambulance de l'urgence est en route (sirène) : tout véhicule à moins de 32 m d'elle s'arrête et se range sur le côté droit
   * pour lui laisser le passage ; il repart quand elle s'est éloignée. Un véhicule engagé dans un carrefour le dégage d'abord
   * (jamais arrêté au milieu), et les feux rouges restent respectés.
   */
  private ambulanceYield(v: Car | Zem): boolean {
    const a = this.amb;
    if (!a || !a.rig.group.visible || a.phase !== 'coming') return false;
    const ap = a.rig.group.position;
    const bend = laneBend(v.axis, v.lane, v.pos);
    const x = v.axis === 'x' ? v.pos : v.lane + bend;
    const z = v.axis === 'x' ? v.lane + bend : v.pos;
    if (Math.hypot(ap.x - x, ap.z - z) > 32) return false;
    const cross = v.axis === 'x' ? ROADS_X : ROADS_Z;
    const box = ROAD_W / 2 + 1;
    return !cross.some((c) => Math.abs(c - v.pos) < box);
  }

  /**
   * Carrefour devant le véhicule : distance libre jusqu'au bord de l'intersection s'il doit s'y arrêter,
   * Infinity sinon. Règles, dans l'ordre :
   * 1. déjà engagé (centre dans le carrefour) : on le dégage ;
   * 2. véhicule de l'autre axe engagé, ou piéton sur le passage : on attend ;
   * 3. pas de place après le carrefour (file arrêtée) : on n'y entre pas (évite l'interblocage) ;
   * 4. carrefour à feux : rouge = arrêt, orange = arrêt si on peut encore freiner confortablement ;
   * 5. sans feux : réservation du premier axe arrivé, cédée à l'autre axe au bout de 8 s d'attente.
   */
  private junctionGap(v: Car | Zem): number {
    const cross = v.axis === 'x' ? ROADS_X : ROADS_Z;
    const box = ROAD_W / 2 + 1;
    let inter = NaN;
    let best = Infinity;
    for (const c of cross) {
      if (Math.abs(c - v.pos) < box) return Infinity;
      const d = (c - v.pos) * v.dir;
      if (d > 0 && d < best) {
        best = d;
        inter = c;
      }
    }
    const entry = best - box - v.len / 2;
    if (Number.isNaN(inter) || entry > 16) return Infinity;
    if (entry < -0.5) return Infinity; // l'avant est déjà sur le carrefour : on ne s'arrête plus au milieu
    const stopHere = Math.max(0, entry);
    const road = nearest(v.lane, v.axis === 'x' ? ROADS_Z : ROADS_X);
    let conflict = false;
    for (const o of this.fleet) {
      if (o.axis === v.axis || Math.abs(o.lane - inter) >= ROAD_W) continue;
      const d = Math.abs(o.pos - v.lane);
      if (d < box) return stopHere;
      if (d < box + o.len / 2 + o.v * 1.2) conflict = true;
    }
    for (const w of this.walkers) {
      if (w.axis !== v.axis && Math.abs(w.lane - inter) < ROAD_W && Math.abs(w.pos - road) < ROAD_W / 2 + 0.6) return stopHere;
    }
    // Ne pas bloquer le carrefour : le véhicule de tête, arrêté, doit avoir laissé la place de se ranger après.
    // Elle cède après 8 s : quatre files qui s'attendent l'une l'autre ne doivent pas figer le carrefour (interblocage).
    if (v.leadV < 1 && v.gap < best + box - v.len / 2 + 1.5 && v.stuck < 8) return stopHere;
    const rx = v.axis === 'x' ? inter : road;
    const rz = v.axis === 'x' ? road : inter;
    const sig = signalAt(rx, rz);
    if (sig >= 0) {
      const state = signalState(sig, v.axis, this.lightT);
      if (state === 'green') return Infinity;
      if (state === 'amber' && entry < brakingDistance(v.v)) return Infinity;
      return stopHere;
    }
    if (!conflict) return Infinity;
    // Trop près pour s'arrêter confortablement : engagé de fait, on passe (le véhicule croisé attendra).
    if (entry < brakingDistance(v.v) * 0.5) return Infinity;
    const key = junctionKey(rx, rz);
    const now = this.simT;
    const r = this.reservations.get(key);
    if (!r || now - r.seen > 0.6 || (r.axis !== v.axis && now - r.since > 8)) {
      this.reservations.set(key, { axis: v.axis, since: now, seen: now });
      return Infinity;
    }
    if (r.axis === v.axis) {
      r.seen = now;
      return Infinity;
    }
    return stopHere;
  }

  /** Le piéton peut-il avancer jusqu'à `next` ? Au bord d'une chaussée, il attend le vert ou que la voie soit libre. */
  private walkerMayCross(w: Walker, next: number): boolean {
    const cross = w.axis === 'x' ? ROADS_X : ROADS_Z;
    const half = ROAD_W / 2 + 0.3;
    for (const c of cross) {
      if (Math.abs(next - c) >= half || Math.abs(w.pos - c) < half) continue;
      // Il s'apprête à poser le pied sur la chaussée c
      const road = nearest(w.lane, w.axis === 'x' ? ROADS_Z : ROADS_X);
      const sig = signalAt(w.axis === 'x' ? c : road, w.axis === 'x' ? road : c);
      if (sig >= 0) return signalState(sig, w.axis, this.lightT) === 'green';
      for (const o of this.fleet) {
        if (o.axis !== w.axis && Math.abs(o.lane - c) < ROAD_W && Math.abs(o.pos - w.lane) < 4 + o.v * 2.5) return false;
      }
    }
    return true;
  }

  /** Sens dans lesquels on peut prendre la route d'arrivée d'un raccord (sens unique et extrémités respectés). */
  private joinCandidates(join: RouteJoin): (1 | -1)[] {
    const nr = PATH_ROUTES[join.route]!;
    if (nr.oneWay) return [nr.oneWay];
    if (join.s < 1) return [1];
    if (join.s > nr.total - 1) return [-1];
    return [1, -1];
  }

  /** Sens possibles dont la place est libre au point de raccord (aucune voiture à moins de 7 m devant ni derrière). */
  private joinDirs(join: RouteJoin, self: PathCar): (1 | -1)[] {
    return this.joinCandidates(join).filter((d) => !this.pathCars.some((q) => q !== self && !q.off && q.route === join.route && q.dir === d && Math.abs(q.pos - join.s) < 7));
  }

  /** Place la voiture sur son tracé : position scène, sens de marche et voie de droite. */
  private pathPlace(p: PathCar): void {
    const r = PATH_ROUTES[p.route]!;
    const pos = Math.min(r.total, Math.max(0, p.pos));
    let i = 1;
    while (i < r.cum.length - 1 && r.cum[i]! < pos) i++;
    const a = r.pts[i - 1]!;
    const b = r.pts[i]!;
    const seg = Math.max(1e-6, r.cum[i]! - r.cum[i - 1]!);
    const t = (pos - r.cum[i - 1]!) / seg;
    const dx = ((b[0] - a[0]) / seg) * p.dir;
    const dz = ((b[1] - a[1]) / seg) * p.dir;
    // Cap lissé : virage, raccord et demi-tour se font en tournant (la voiture ne claque plus d'un côté à l'autre de la route)
    // Segment de longueur nulle (point en double sur le tracé) : pas de direction, on garde le cap (sinon le véhicule pivotait vers l'est)
    const flat = Math.hypot(b[0] - a[0], b[1] - a[1]) < 0.05;
    const ta = flat ? (p.ha ?? 0) : Math.atan2(dz, dx);
    if (p.ha === undefined) p.ha = ta;
    else {
      let da = ta - p.ha;
      da = Math.atan2(Math.sin(da), Math.cos(da));
      if (Math.abs(da) > 3.1) da = da < 0 ? -3.1 : 3.1;
      p.ha += da * 0.22;
    }
    p.hx = Math.cos(p.ha);
    p.hz = Math.sin(p.ha);
    // Conduite à droite : la droite du sens de marche (hx, hz) est (−hz, hx)
    const cx = a[0] + (b[0] - a[0]) * t;
    const cz = a[1] + (b[1] - a[1]) * t;
    p.x = cx - p.hz * (1.7 + (p.yieldOff ?? 0));
    p.z = cz + p.hx * (1.7 + (p.yieldOff ?? 0));
    // Sur le contournement, la voiture monte la rampe et roule sur le tablier ; ailleurs elle reste au sol (sous le pont)
    p.y = r.deck ? flyoverHeight(cx, cz) : 0;
    p.pitch = r.deck ? Math.atan2(flyoverHeight(cx + dx * 1.5, cz + dz * 1.5) - flyoverHeight(cx - dx * 1.5, cz - dz * 1.5), 3) : 0;
  }

  /** Angle à tourner (radians, 0 à π) pour s'engager sur un tracé à la position `s` dans le sens `dir`, depuis le cap `ha`. */
  private turnAt(route: number, s: number, dir: 1 | -1, ha: number | undefined): number {
    if (ha === undefined) return 0;
    const r = PATH_ROUTES[route]!;
    const pos = Math.min(r.total, Math.max(0, s));
    let i = 1;
    while (i < r.cum.length - 1 && r.cum[i]! < pos) i++;
    const a = r.pts[i - 1]!;
    const b = r.pts[i]!;
    const ta = Math.atan2((b[1] - a[1]) * dir, (b[0] - a[0]) * dir);
    return Math.abs(Math.atan2(Math.sin(ta - ha), Math.cos(ta - ha)));
  }

  private pathOffscreen(p: PathCar): boolean {
    return this.offscreenAt(p.x, p.z);
  }

  /**
   * Point hors de l'image (avec une marge) : seul un véhicule qu'on ne voit pas peut être retiré ou replacé ailleurs.
   * Avant, « hors de vue » voulait dire à plus de 60 à 90 m du centre : sur la carte dézoomée, on voyait les véhicules disparaître.
   */
  private offscreenAt(x: number, z: number): boolean {
    const v = this.screenPt.set(x, 1, z).project(this.camera);
    return v.z > 1 || Math.abs(v.x) > 1.25 || Math.abs(v.y) > 1.25;
  }

  /** Un pas de conduite d'une voiture de rue secondaire : s'arrête derrière le véhicule, le zém ou le joueur qui la précède. */
  private stepPathCar(p: PathCar, dt: number, slow: number): void {
    p.speed = p.cruise * slow;
    let gap = Infinity;
    let leadV = p.speed;
    const blocked = p.wait < 7;
    // Demi-longueur vers l'avant : un semi-remorque de 17 m ne s'arrête pas à 2,3 m de l'obstacle comme une voiture (sa cabine passait dans le joueur)
    const front = Math.max(2.3, p.len / 2 - 0.5);
    if (blocked) {
      const reach = 4 + p.v * 1.3 + 3 + (front - 2.3);
      // Un véhicule qui vient en face n'est jamais « celui de devant » : au croisement de deux voies très proches (bretelle qui
      // s'insère, virage), les deux voitures face à face s'arrêtaient l'une pour l'autre et ne repartaient plus
      const look = (ox: number, oz: number, ov: number, half: number, ohx = 0, ohz = 0) => {
        if (ohx * p.hx + ohz * p.hz < -0.5) return;
        const dx = ox - p.x;
        const dz = oz - p.z;
        const fwd = dx * p.hx + dz * p.hz;
        if (fwd < 0.3 || fwd > reach + half) return;
        if (Math.abs(dx * p.hz - dz * p.hx) > 1.9 + half * 0.3) return;
        const g = fwd - front - half;
        if (g < gap) {
          gap = g;
          leadV = ov;
        }
      };
      // Carrefour entre deux tracés : un véhicule qui coupe notre route (angle > 35°) à moins de 6,5 m devant nous passe d'abord
      // s'il a la priorité ; entre deux voitures de tracés, le rang le plus petit passe, ce qui évite les paquets de voitures
      const cross = (ox: number, oz: number, ohx: number, ohz: number, yields: boolean) => {
        if (!yields || Math.abs(ohx * p.hx + ohz * p.hz) > 0.82) return;
        const dx = ox - p.x;
        const dz = oz - p.z;
        const fwd = dx * p.hx + dz * p.hz;
        if (fwd < 0.3 || fwd > 6.5 || Math.abs(dx * p.hz - dz * p.hx) > 4.6) return;
        const g = fwd - 3.6;
        if (g < gap) {
          gap = g;
          leadV = 0;
        }
      };
      // Seuls les véhicules proches comptent : on écarte tout de suite ceux qui sont loin (bien au-delà de la portée du regard)
      const far = reach + 26;
      for (const q of this.pathCars) {
        // Une voiture sur le pont et une autre dessous ne se gênent pas
        if (q === p || q.off || Math.abs(q.x - p.x) > far || Math.abs(q.z - p.z) > far || Math.abs(q.y - p.y) > 2) continue;
        look(q.x, q.z, q.v, q.len / 2 - 0.7, q.hx, q.hz);
        cross(q.x, q.z, q.hx, q.hz, q.uid < p.uid);
      }
      for (const o of p.y > 2 ? [] : this.fleet) {
        // Écart grossier (la courbure d'une voie reste de quelques mètres) : inutile de calculer la position exacte d'un véhicule lointain
        if (Math.abs((o.axis === 'x' ? o.pos : o.lane) - p.x) > far + 10 || Math.abs((o.axis === 'x' ? o.lane : o.pos) - p.z) > far + 10) continue;
        const b = laneBend(o.axis, o.lane, o.pos);
        const ox = o.axis === 'x' ? o.pos : o.lane + b;
        const oz = o.axis === 'x' ? o.lane + b : o.pos;
        look(ox, oz, o.v, o.len / 2, o.axis === 'x' ? o.dir : 0, o.axis === 'x' ? 0 : o.dir);
        // Les voitures de la grille ont priorité sur celles des tracés secondaires
        cross(ox, oz, o.axis === 'x' ? o.dir : 0, o.axis === 'x' ? 0 : o.dir, true);
      }
      if (Math.abs(this.groundY - p.y) < 2) look(this.player.position.x, this.player.position.z, 0, this.riding === 'BUS' ? 3.8 : 1);
      // L'ambulance passe : on s'arrête derrière elle ou on la laisse passer
      const amb = this.amb?.rig.group;
      if (amb?.visible && Math.abs(amb.position.y - p.y) < 2) look(amb.position.x, amb.position.z, 0, 2.6);
      // Cède le passage : à moins de 28 m de l'ambulance en route, la voiture s'arrête et se range à droite
      if (this.amb?.phase === 'coming' && amb?.visible && Math.hypot(amb.position.x - p.x, amb.position.z - p.z) < 28) {
        gap = Math.min(gap, 0.5);
        leadV = 0;
        p.yieldOff = (p.yieldOff ?? 0) + (1.25 - (p.yieldOff ?? 0)) * Math.min(1, dt * 2.2);
      } else p.yieldOff = (p.yieldOff ?? 0) * (1 - Math.min(1, dt * 2.2));
    }
    // Le joueur reste un obstacle même après une longue attente (au bout de 7 s les autres véhicules sont ignorés pour défaire les
    // blocages, mais un camion ne doit jamais rouler sur le joueur arrêté au Port)
    let playerHold = false;
    if (Math.abs(this.groundY - p.y) < 2) {
      const half = this.riding === 'BUS' ? 3.8 : 1.4;
      const dx = this.player.position.x - p.x;
      const dz = this.player.position.z - p.z;
      const fwd = dx * p.hx + dz * p.hz;
      if (fwd > 0.3 && fwd < 12 + front && Math.abs(dx * p.hz - dz * p.hx) < 1.9 + half * 0.3) {
        const g = fwd - front - half;
        if (g < 6) playerHold = true;
        if (g < gap) {
          gap = g;
          leadV = 0;
        }
      }
    }
    const carGap = gap;
    // Feux du quartier d'affaires : le feu rouge (ou l'orange qu'on ne peut plus franchir en freinant) arrête la voiture
    for (let i = FIRST_DISTRICT_SIGNAL; i < SIGNALS.length; i++) {
      const sg = SIGNALS[i]!;
      const dx = sg.x - p.x;
      const dz = sg.z - p.z;
      const fwd = dx * p.hx + dz * p.hz;
      if (fwd < 0 || fwd > 40 || Math.abs(dx * p.hz - dz * p.hx) > 4 || Math.abs(this.groundY - p.y) > 2) continue;
      const state = signalState(i, Math.abs(p.hz) > Math.abs(p.hx) ? 'z' : 'x', this.lightT);
      const ahead = fwd - 6 - p.len / 2;
      if (state === 'green' || ahead < -0.5 || (state === 'amber' && ahead < brakingDistance(p.v))) continue;
      if (ahead < gap) {
        gap = Math.max(0, ahead);
        leadV = 0;
      }
    }
    // Jamais de file figée : une voiture immobile depuis plus de 8 s, arrêtée par un autre véhicule (pas par un feu rouge),
    // se remet en marche en frôlant le véhicule de tête, ce qui défait les blocages en chaîne aux carrefours
    if (p.wait > 8 && carGap < 6 && !playerHold) p.ghostT = 4;
    if ((p.ghostT ?? 0) > 0) {
      p.ghostT = (p.ghostT ?? 0) - dt;
      if (gap === carGap && !playerHold) {
        gap = 12;
        leadV = p.cruise * 0.5;
      }
    }
    // Raccord devant : si la route d'arrivée est occupée dans les deux sens, on attend 7 m avant le carrefour (jamais en travers)
    // et au bout de 1,2 s on s'engage quand même (les voitures de la route d'arrivée s'arrêtent alors derrière nous)
    {
      const rt = PATH_ROUTES[p.route]!;
      const jn = rt.next === undefined ? ROUTE_JOINS[p.route]?.[p.dir === 1 ? 1 : 0] ?? null : null;
      if (jn && p.wait < 1.2) {
        const toEnd = p.dir === 1 ? rt.total - p.pos : p.pos;
        if (toEnd < 22 && this.joinDirs(jn, p).length === 0) {
          const ahead = toEnd - 7 - p.len / 2;
          if (ahead < gap) {
            gap = Math.max(0, ahead);
            leadV = 0;
          }
        }
      }
    }
    p.gap = Math.max(0, gap);
    p.leadV = leadV;
    const next = drive(p, p.gap, p.leadV, dt);
    p.wait = p.v < 0.2 ? p.wait + dt : 0;
    // File immobile depuis trop longtemps (carrefour, tracé coupé) : la voiture se retire dès qu'elle est hors de vue
    if (p.wait > 6 && this.pathOffscreen(p)) {
      p.off = true;
      p.v = 0;
      p.wait = 0;
      return;
    }
    p.pos = next;
    const total = PATH_ROUTES[p.route]!.total;
    const chain = PATH_ROUTES[p.route]!.next;
    const join = (p.pos > total || p.pos < 0) && chain === undefined ? ROUTE_JOINS[p.route]?.[p.pos > total ? 1 : 0] ?? null : null;
    if (join) {
      // Bout de tracé qui débouche sur une autre route : la voiture s'y engage (dans un sens possible), si la place est libre
      // Sens possibles, de préférence sans demi-tour sur place : un véhicule qui repartait d'où il venait pivotait sur lui-même
      // (surtout visible pour un bus). Bus et camions ne font jamais ce demi-tour : ils attendent qu'un autre sens se libère.
      const long = isLongKind(TRAFFIC[p.type]?.kind);
      const ahead = (d: 1 | -1) => this.turnAt(join.route, join.s, d, p.ha) < 2.2;
      const all = this.joinDirs(join, p);
      const forward = all.filter(ahead);
      // Hors de vue, le demi-tour ne se voit pas : un bus sans autre issue peut alors repartir (il ne reste pas bloqué)
      const strict = long && !this.pathOffscreen(p);
      const free = forward.length > 0 || strict ? forward : all;
      const fallback = p.wait >= 1.2 ? this.joinCandidates(join).filter((d) => !strict || ahead(d))[0] : undefined;
      const dir: 1 | -1 | undefined = free[Math.floor(Math.random() * free.length)] ?? fallback;
      if (dir === undefined) {
        p.pos = Math.min(total, Math.max(0, p.pos));
        p.v = 0;
      } else {
        p.route = join.route;
        p.dir = dir;
        p.pos = join.s;
        p.v = Math.max(p.v, p.cruise * 0.5);
      }
    } else if ((p.pos > total || p.pos < 0) && chain !== undefined) {
      // Bout d'une bretelle à sens unique : demi-tour sur la bretelle voisine, si sa voie est libre
      const nr = PATH_ROUTES[chain]!;
      const dir = nr.oneWay ?? 1;
      const start = dir === 1 ? 0 : nr.total;
      // Bus et camions ne font pas ce demi-tour sur place sous les yeux du joueur : arrêt au bout, puis départ une fois hors de vue
      if (isLongKind(TRAFFIC[p.type]?.kind) && !this.pathOffscreen(p)) {
        p.pos = Math.min(total, Math.max(0, p.pos));
        p.v = 0;
      } else if (this.pathCars.some((q) => q !== p && !q.off && q.route === chain && Math.abs(q.pos - start) < 9)) {
        p.pos = Math.min(total, Math.max(0, p.pos));
        p.v = 0;
        if (this.pathOffscreen(p)) p.off = true;
      } else if (this.pathOffscreen(p) && !this.offscreenAt(...(dir === 1 ? nr.pts[0]! : nr.pts[nr.pts.length - 1]!))) {
        // La voiture est hors de vue mais le début de la bretelle suivante est à l'image : pas d'apparition devant le joueur
        p.off = true;
        p.v = 0;
        p.wait = 0;
      } else {
        p.route = chain;
        p.dir = dir;
        p.pos = start;
        p.v = p.cruise * 0.4;
      }
    } else if ((p.pos > total || p.pos < 0) && !this.pathOffscreen(p)) {
      // Bout du tracé sous les yeux du joueur (route sans issue, comme l'accès à l'aérogare) : demi-tour sur place
      // plutôt qu'une téléportation au début du tracé, qui faisait disparaître et réapparaître la voiture.
      // Bus et camions n'y pivotent pas sur place : ils marquent l'arrêt au bout (terminus) et repartent une fois hors de vue.
      const long = isLongKind(TRAFFIC[p.type]?.kind);
      if (!long) p.dir = p.dir === 1 ? -1 : 1;
      p.pos = Math.min(total, Math.max(0, p.pos));
      p.v = 0;
    } else if (p.pos > total || p.pos < 0) {
      const start = p.dir === 1 ? 0 : total;
      // Le début du tracé est à l'image alors que la voiture, elle, n'y est plus : la replacer là la ferait surgir devant le joueur.
      // Elle quitte donc la route et réapparaîtra ailleurs, hors de vue.
      const r0 = PATH_ROUTES[p.route]!;
      const sp = p.dir === 1 ? r0.pts[0]! : r0.pts[r0.pts.length - 1]!;
      if (!this.offscreenAt(sp[0], sp[1])) {
        p.off = true;
        p.v = 0;
        p.wait = 0;
        p.pos = start;
        return;
      }
      const taken = this.pathCars.some((q) => q !== p && !q.off && q.route === p.route && q.dir === p.dir && Math.abs(q.pos - start) < 9);
      if (taken) {
        // Début de tracé occupé : la voiture quitte la route et réapparaîtra ailleurs, au lieu de bloquer la file au bout du tracé
        p.off = true;
        p.v = 0;
        p.wait = 0;
        p.pos = start;
        return;
      }
      p.pos = start;
      p.v = p.cruise * 0.5;
    }
    this.pathPlace(p);
  }

  /** Position dans (ou juste avant) un carrefour : un véhicule n'y apparaît pas, il surgirait sur la voie croisée. */
  private atJunction(v: Car | Zem, pos: number): boolean {
    return (v.axis === 'x' ? ROADS_X : ROADS_Z).some((c) => Math.abs(c - pos) < ROAD_W + 3);
  }

  /** Réapparition en bord de carte uniquement si la portion de file est libre. */
  private trafficSpawnClear(v: Car | Zem, pos: number, gap = 9): boolean {
    for (const o of this.fleet) if (o !== v && o.axis === v.axis && Math.abs(o.lane - v.lane) < 0.8 && Math.abs(o.pos - pos) < gap) return false;
    return true;
  }

  /**
   * Un pas de conduite : obstacle le plus proche (véhicule de tête, feu, carrefour, personnage), vitesse
   * ajustée progressivement, puis avance. Mur imprévu sur la voie : demi-tour sur l'autre voie.
   */
  private stepVehicle(v: Car | Zem, dt: number, radius: number, laneOffset: number): void {
    const junction = this.junctionGap(v);
    const red = this.redGap(v);
    const player = this.playerGap(v);
    // L'ambulance approche : on s'arrête tout de suite (freinage franc) et on se range sur le côté
    const giving = this.ambulanceYield(v);
    const amb = giving ? 0.5 : Infinity;
    v.yieldOff = (v.yieldOff ?? 0) + ((giving ? 1.25 : 0) - (v.yieldOff ?? 0)) * Math.min(1, dt * 2.2);
    const gap = Math.min(v.gap, junction, red, player, amb);
    const candidate = drive(v, gap, gap === v.gap ? v.leadV : 0, dt);
    // Immobilisé anormalement (ni feu rouge ni joueur devant) : après 25 s hors de vue, ou 60 s au plus,
    // il fait demi-tour et repart dans l'autre sens au lieu de rester figé.
    // Une file d'attente n'est pas un blocage : seul le véhicule de tête (rien à moins de 8 m devant) compte.
    // Aux heures de pointe, les files durent plus de 25 s sans que personne ne doive faire demi-tour.
    v.stuck = v.v < 0.2 && red === Infinity && player === Infinity && !giving && !(v.gap < 8 && v.leadV < 1.5) ? v.stuck + dt : 0;
    // Embouteillage durable : après 40 s à l'arrêt hors de vue (hors feu rouge), la voiture quitte la file au lieu de la bloquer
    const car = v as Car;
    car.jam = v.v < 0.2 && red === Infinity && player === Infinity && !giving ? (car.jam ?? 0) + dt : 0;
    if (car.jam > 40 && 'type' in car && this.offscreen(v)) {
      car.off = true;
      car.jam = 0;
      this.fleet = this.fleet.filter((o) => o !== v);
      return;
    }
    if (v.stuck > 60 || (v.stuck > 25 && this.offscreen(v))) {
      this.uTurn(v, laneOffset);
      return;
    }
    if (candidate === v.pos) return;
    const cb = laneBend(v.axis, v.lane, candidate);
    const cx = v.axis === 'x' ? candidate : v.lane + cb;
    const cz = v.axis === 'x' ? v.lane + cb : candidate;
    // Sécurité : même si une parcelle est mal configurée, aucun véhicule ne traverse un mur.
    // Les obstacles bas (bordure du terre-plein, h ≤ 0,5 m) ne comptent que pour les piétons : voitures et bus passent de part et d'autre
    if (!this.blocked(cx, cz, radius, 0.5)) {
      v.pos = candidate;
      v.blockT = 0;
    } else this.blockedTurn(v, laneOffset, dt, candidate);
  }

  /**
   * Obstacle imprévu devant : demi-tour sur l'autre voie, une seule fois. Si l'autre sens est bloqué lui aussi (le véhicule est
   * pris dans l'emprise d'un obstacle), il restait sur place et basculait d'une voie à l'autre à chaque image : il clignotait.
   * Il reste maintenant immobile dans sa voie, disparaît s'il est hors de vue, et finit par s'en dégager.
   */
  private blockedTurn(v: Car | Zem, laneOffset: number, dt: number, candidate: number): void {
    const now = performance.now() / 1000;
    if (v.turnAt === undefined || now - v.turnAt > 6) {
      v.turnAt = now;
      v.blockT = 0;
      this.uTurn(v, laneOffset);
      return;
    }
    v.v = 0;
    v.blockT = (v.blockT ?? 0) + dt;
    if ('type' in v && this.offscreen(v)) {
      (v as Car).off = true;
      v.turnAt = undefined;
      this.fleet = this.fleet.filter((o) => o !== v);
      return;
    }
    // Coincé sous les yeux du joueur depuis plus de 5 s : on le laisse passer plutôt que de le figer pour toujours
    if (v.blockT > 5) {
      v.pos = candidate;
      v.blockT = 0;
    }
  }

  /**
   * Fin de réseau : un véhicule qui arrive au boulevard du bord de mer tourne à droite (vers l'ouest) au lieu de
   * filer sur la plage ; à l'ouest, il prend parfois une avenue vers le nord. Avant le carrefour du Port, il fait demi-tour.
   */
  private followRoad(v: Car | Zem, before: number, laneOffset: number): void {
    if (v.axis === 'z' && v.dir === 1 && v.pos > COAST_Z) {
      v.pos = nearest(v.lane, ROADS_X);
      v.axis = 'x';
      v.dir = -1;
      v.lane = COAST_Z - laneOffset;
    } else if (v.axis === 'x' && nearest(v.lane, ROADS_Z) === COAST_Z) {
      // Demi-tour visible avant le Port (la borne de la route est 10 m plus loin : la voiture n'est plus renvoyée
      // à l'autre bout de la ville juste après avoir tourné, ce qui la faisait disparaître)
      if (v.dir === 1 && v.pos > COAST_EAST_STOP) this.uTurn(v, laneOffset);
      else if (v.dir === -1) {
        const avenue = ROADS_X.find((x) => before > x && v.pos <= x);
        if (avenue !== undefined && Math.random() < 0.4) {
          v.axis = 'z';
          v.dir = -1;
          v.lane = avenue + laneOffset;
          v.pos = COAST_Z;
        }
      }
    } else if (v.axis === 'x' && v.dir === 1 && trafficEast(v.lane) < MAX_X && v.pos > trafficEast(v.lane) - 4) {
      // Boulevard sans issue (aéroport) : demi-tour au bout de la chaussée. Avant, le véhicule roulait dans l'herbe,
      // restait bloqué au-delà du bout de la route et réapparaissait sans cesse à côté de la piste (clignotement).
      this.uTurn(v, laneOffset);
    }
  }

  /**
   * Position de réapparition d'un véhicule le long de sa route : le plus souvent autour du point regardé (la voiture arrive
   * juste hors de l'image), pour que la circulation reste continue à l'écran même sur de très longues routes, au lieu d'être
   * répartie sur toute la ville et de ne rien montrer devant le joueur.
   */
  private spawnNear(axis: 'x' | 'z', lo: number, hi: number): number {
    if (Math.random() < 0.5) return lo + Math.random() * (hi - lo);
    const c = axis === 'x' ? this.camLook.x : this.camLook.z;
    return Math.min(hi, Math.max(lo, c + (Math.random() * 2 - 1) * 150));
  }

  /** Route assez proche du point regardé pour qu'une réapparition s'y voie bientôt. */
  private roadNear(axis: 'x' | 'z', lane: number): boolean {
    return Math.abs(lane - (axis === 'x' ? this.camLook.z : this.camLook.x)) < 170;
  }

  /** Bus et camions : trop longs pour tourner sur eux-mêmes ; à la vue du joueur, ils attendent (terminus) au lieu de pivoter. */
  private isLong(v: Car | Zem): boolean {
    const kind = 'type' in v ? TRAFFIC[(v as Car).type]?.kind : undefined;
    return isLongKind(kind);
  }

  private uTurn(v: Car | Zem, laneOffset: number): void {
    if (this.isLong(v) && !this.offscreen(v)) {
      v.v = 0;
      return;
    }
    const road = nearest(v.lane, v.axis === 'x' ? ROADS_Z : ROADS_X);
    v.dir = v.dir === 1 ? -1 : 1;
    v.lane = road + (v.axis === 'x' ? v.dir : -v.dir) * laneOffset;
    v.v = 0;
    v.stuck = 0;
  }

  /** Véhicule assez loin du point regardé pour qu'un changement de voie passe inaperçu. */
  private offscreen(v: Car | Zem): boolean {
    const x = v.axis === 'x' ? v.pos : v.lane;
    const z = v.axis === 'x' ? v.lane : v.pos;
    return this.offscreenAt(x, z);
  }

  /**
   * Véhicule au bout de sa route. Hors de l'image, il repart de l'autre bout comme avant. Sous les yeux du joueur, il ne
   * disparaît plus : au bout nord d'une avenue il tourne sur le boulevard, ailleurs il fait demi-tour.
   */
  private endOfRoad(v: Car | Zem, lo: number, hi: number, laneOffset: number, gap: number, jump: number): void {
    const over = v.pos > hi;
    if (this.offscreen(v)) {
      // L'autre bout de la route est à l'image : la voiture n'y surgit pas, elle réapparaîtra plus tard près du regard
      const dest = over ? lo : hi;
      const dx = v.axis === 'x' ? dest : v.lane;
      const dz = v.axis === 'x' ? v.lane : dest;
      if (!this.offscreenAt(dx, dz) && this.cars.includes(v as Car)) {
        (v as Car).off = true;
        v.v = 0;
        this.fleet = this.fleet.filter((o) => o !== v);
        return;
      }
      if (over) v.pos = this.trafficSpawnClear(v, lo, gap) ? lo : hi + jump;
      else v.pos = this.trafficSpawnClear(v, hi, gap) ? hi : lo - jump;
      return;
    }
    const avenue = nearest(v.lane, ROADS_X);
    if (v.axis === 'z' && !over && avenue !== 0 && avenue <= roadEastEnd(ROAD_END_Z)) {
      const dir: 1 | -1 = Math.random() < 0.5 ? 1 : -1;
      v.axis = 'x';
      v.dir = dir;
      v.lane = ROAD_END_Z + dir * laneOffset;
      v.pos = avenue;
      return;
    }
    this.uTurn(v, laneOffset);
    v.pos = Math.min(hi, Math.max(lo, v.pos));
  }

  /**
   * Part du parc automobile en circulation selon l'heure : les embouteillages se concentrent aux pointes du matin (6 h – 8 h 30)
   * et du soir (17 h 30 – 21 h 30), avec tout le parc au pas ; le reste du temps la circulation reste fluide (jamais saturée).
   */
  private trafficDensity(): number {
    const m = this.getMinuteOfDay();
    // Jamais une ville vide : même la nuit, des voitures circulent (avant 0,15 la nuit et 0,45 en journée : on ne voyait presque plus personne)
    if ((m >= 360 && m < 510) || (m >= 1050 && m < 1290)) return 1;
    if ((m >= 300 && m < 360) || (m >= 510 && m < 600) || (m >= 960 && m < 1050) || (m >= 1290 && m < 1350)) return 0.75;
    if (m >= 1350 || m < 300) return 0.4;
    return 0.55;
  }

  /** Aux heures de pointe, chacun roule au pas : les files se forment aux feux et aux carrefours. */
  private trafficSlowdown(dt: number): number {
    const d = this.trafficDensity();
    const target = d >= 1 ? 0.7 : d >= 0.7 ? 0.9 : 1;
    // Transition douce : pas de freinage brutal de toute la flotte au passage de 6 h ou de 17 h 30
    this.slowNow += (target - this.slowNow) * Math.min(1, dt * 0.15);
    return this.slowNow;
  }

  /** Met la circulation au niveau voulu : tout de suite au chargement, sinon une voiture à la fois, hors de vue. */
  private syncTraffic(instant = false): void {
    const target = Math.round(this.cars.length * this.trafficDensity());
    let on = this.cars.filter((c) => !c.off).length;
    let changed = false;
    // Rues secondaires : même courbe de densité, au fil de l'eau ou tout de suite au chargement
    // Les camions du Port roulent toute la journée : ils ne comptent pas dans la densité horaire
    const regular = this.pathCars.filter((p) => !PATH_ROUTES[p.route]!.trucks);
    const pTarget = Math.round(regular.length * this.trafficDensity());
    let pOn = regular.filter((p) => !p.off).length;
    if (instant) {
      regular.forEach((p, i) => (p.off = i >= pTarget));
      this.pathCars.forEach((p) => PATH_ROUTES[p.route]!.trucks && (p.off = false));
    } else {
      for (let step = 0; step < 4 && pOn !== pTarget; step++) {
        let pool = regular.filter((p) => (pOn > pTarget ? !p.off && this.pathOffscreen(p) : p.off));
        if (pOn < pTarget) {
          const close = pool.filter((p) => {
            const a = PATH_ROUTES[p.route]!.pts[0]!;
            return Math.hypot(a[0] - this.camLook.x, a[1] - this.camLook.z) < 260;
          });
          if (close.length > 0 && Math.random() < 0.6) pool = close;
        }
        const p = pool[Math.floor(Math.random() * pool.length)];
        if (!p) break;
        if (pOn > pTarget) {
          p.off = true;
          pOn--;
          continue;
        }
        const total = PATH_ROUTES[p.route]!.total;
        // Parmi quelques essais hors de l'image, on garde la place la plus proche du point regardé : la voiture arrive bientôt à l'écran
        let best = -1;
        let bestD = Infinity;
        for (let attempt = 0; attempt < 10; attempt++) {
          const pos = Math.random() * total;
          p.pos = pos;
          this.pathPlace(p);
          if (!this.pathOffscreen(p) || this.pathCars.some((q) => q !== p && !q.off && q.route === p.route && q.dir === p.dir && Math.abs(q.pos - pos) < 18)) continue;
          const dd = Math.hypot(p.x - this.camLook.x, p.z - this.camLook.z);
          if (dd < bestD) {
            bestD = dd;
            best = pos;
          }
        }
        if (best >= 0) {
          p.pos = best;
          p.ha = undefined;
          this.pathPlace(p);
          p.off = false;
          p.v = p.cruise * 0.4;
          p.wait = 0;
          pOn++;
        }
      }
    }
    if (instant) {
      // Chaque voiture retenue doit trouver une place libre sur sa file, sinon elle reste au garage.
      this.fleet = [...this.zems];
      let kept = 0;
      // Tirage au hasard (et non dans l'ordre de la liste) : les voitures ajoutées en dernier, comme celles de la RN1 vers Tsévié,
      // ont leur chance d'être sur la route dès le chargement
      const order = [...this.cars].sort(() => Math.random() - 0.5);
      for (const c of order) {
        c.off = true;
        if (kept >= target) continue;
        const [lo, hi] = c.axis === 'x' ? [MIN_X, trafficEast(c.lane)] : [avenueEnd(c.lane), 12];
        for (let attempt = 0; attempt < 12; attempt++) {
          if (attempt > 0) c.pos = lo + Math.random() * (hi - lo);
          if (!this.atJunction(c, c.pos) && this.trafficSpawnClear(c, c.pos, 11)) {
            c.off = false;
            this.fleet.push(c);
            kept++;
            break;
          }
        }
      }
      return;
    }
    for (let step = 0; step < 3 && on !== target; step++) {
      let pool = this.cars.filter((c) => (on > target ? !c.off && this.offscreen(c) : c.off));
      if (on < target) {
        const close = pool.filter((c) => this.roadNear(c.axis, c.lane));
        if (close.length > 0 && Math.random() < 0.6) pool = close;
      }
      const c = pool[Math.floor(Math.random() * pool.length)];
      if (!c) break;
      if (on > target) {
        c.off = true;
        on--;
        changed = true;
        continue;
      }
      const [lo, hi] = c.axis === 'x' ? [MIN_X - 10, trafficEast(c.lane) + 10] : [avenueEnd(c.lane), COAST_Z];
      // Réapparition loin du regard, sur une portion de file libre
      for (let attempt = 0; attempt < 8; attempt++) {
        c.pos = this.spawnNear(c.axis, lo, hi);
        if (this.offscreen(c) && !this.atJunction(c, c.pos) && this.trafficSpawnClear(c, c.pos)) {
          c.off = false;
          c.v = c.cruise * 0.4;
          c.stuck = 0;
          on++;
          changed = true;
          break;
        }
      }
    }
    if (changed) this.fleet = [...this.cars.filter((c) => !c.off), ...this.zems];
  }

  private updateStreetLife(dt: number): void {
    if (Math.floor(this.simT * 2) !== Math.floor((this.simT + dt) * 2)) this.syncTraffic();
    // La nuit (22 h – 5 h), les rues se vident : un passant sur quatre reste dehors
    const hour = Math.floor(this.getMinuteOfDay() / 60);
    const night = hour >= 22 || hour < 5;
    this.walkers.forEach((w, i) => {
      w.g.visible = !night || i % 4 === 0;
    });
    for (const w of this.walkers) {
      const next = w.pos + w.speed * w.dir * dt;
      const waiting = !this.walkerMayCross(w, next);
      if (!waiting) w.pos = next;
      const [lo, hi] = w.axis === 'x' ? [MIN_X, roadEastEnd(w.lane)] : [avenueEnd(w.lane), 12];
      if (w.pos > hi || w.pos < lo) {
        const road = nearest(w.lane, w.axis === 'x' ? ROADS_Z : ROADS_X);
        w.dir = w.dir === 1 ? -1 : 1;
        // En changeant de sens, il rejoint l'autre trottoir pour rester à sa gauche.
        w.lane = road + (w.axis === 'x' ? -w.dir : w.dir) * (ROAD_W / 2 + 0.9);
      }
      if (!waiting) w.phase += dt * 7 * w.speed;
      const wb = laneBend(w.axis, w.lane, w.pos);
      if (w.axis === 'x') w.g.position.set(w.pos, 0, w.lane + wb);
      else w.g.position.set(w.lane + wb, 0, w.pos);
      w.g.rotation.y = laneHeading(w.axis, w.lane, w.pos, w.dir);
      // Passants loin de la caméra : ni dessinés ni animés (minuscules sur la carte, cachés par le brouillard en rue)
      w.g.visible = w.g.position.distanceToSquared(this.camLook) < (this.view === 'map' ? 70 * 70 : 110 * 110);
      if (w.g.visible) animateWalk(w.g, w.phase, waiting ? 0 : 0.5);
    }
    this.simT += dt;
    this.laneIndex.update(this.fleet);
    if (this.carSets.length > 0) {
      const counters = this.carSets.map(() => 0);
      const t = this.tmpCar;
      const slow = this.trafficSlowdown(dt);
      for (const [ci, c] of this.cars.entries()) {
        const set = this.carSets[c.type];
        if (!set || c.off) continue;
        c.speed = c.cruise * slow;
        const before = c.pos;
        this.stepVehicle(c, dt, 1.05, 1.7);
        this.followRoad(c, before, 1.7);
        const [lo, hi] = c.axis === 'x' ? [MIN_X - 10, trafficEast(c.lane) + 10] : [avenueEnd(c.lane), COAST_Z];
        if (c.pos > hi || c.pos < lo) this.endOfRoad(c, lo, hi, 1.7, 9, 10);
        const rot = laneHeading(c.axis, c.lane, c.pos, c.dir);
        const cb = laneBend(c.axis, c.lane, c.pos);
        t.q.setFromAxisAngle(this.up, rot);
        // Rangé sur le côté droit (sens de marche) quand l'ambulance passe
        const side = (c.yieldOff ?? 0) * (c.axis === 'x' ? c.dir : -c.dir);
        t.m.compose(c.axis === 'x' ? t.p.set(c.pos, 0, c.lane + cb + side) : t.p.set(c.lane + cb + side, 0, c.pos), t.q, t.s.set(1.7, 1.7, 1.7));
        set.color(counters[c.type]!, this.tmp.c.setHex(trafficPaint(c.type, ci)));
        set.set(counters[c.type]!++, t.m);
      }
      // Rues secondaires : voitures sur les tracés (mêmes modèles, mêmes compteurs d'instances)
      for (const p of this.pathCars) {
        const set = this.carSets[p.type];
        if (!set || p.off) continue;
        this.stepPathCar(p, dt, slow);
        t.q.setFromAxisAngle(this.up, Math.atan2(p.hx, p.hz));
        // Le modèle regarde vers +z : lever le nez, c'est tourner autour de son axe x dans le sens négatif
        if (p.pitch) t.q.multiply(this.tmp.pitch.setFromAxisAngle(X_AXIS, -p.pitch));
        t.m.compose(t.p.set(p.x, p.y, p.z), t.q, t.s.set(1.7, 1.7, 1.7));
        set.color(counters[p.type]!, this.tmp.c.setHex(trafficPaint(p.type, p.uid + 1000)));
        set.set(counters[p.type]!++, t.m);
      }
      this.carSets.forEach((s, i) => {
        if (!s) return;
        s.count(counters[i]!);
        s.commit(true);
      });
    }
    if (this.zemSets.length === 0) return;
    this.zems.forEach((z, i) => {
      const before = z.pos;
      this.stepVehicle(z, dt, 0.48, 1.6);
      this.followRoad(z, before, 1.6);
      const [lo, hi] = z.axis === 'x' ? [MIN_X - 10, trafficEast(z.lane) + 10] : [avenueEnd(z.lane), COAST_Z];
      if (z.pos > hi || z.pos < lo) this.endOfRoad(z, lo, hi, 1.6, 6, 7);
      const zb = laneBend(z.axis, z.lane, z.pos);
      const zside = (z.yieldOff ?? 0) * (z.axis === 'x' ? z.dir : -z.dir);
      const x = z.axis === 'x' ? z.pos : z.lane + zb + zside;
      const zz = z.axis === 'x' ? z.lane + zb + zside : z.pos;
      const rot = laneHeading(z.axis, z.lane, z.pos, z.dir);
      const slot = this.zemSlots[i]!;
      slot.sets.forEach((k, j) => this.setInstance(this.zemSets[k]!.mesh, slot.idx[j]!, x, 0, zz, 1, 1, 1, rot));
    });
    for (const z of this.zemSets) z.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Position, orientation et véhicule du joueur (envoyés aux autres joueurs). */
  getPose(): { x: number; z: number; yaw: number; ride: Ride | null } {
    const ride = this.riding === 'ZEM' && this.ownMoto ? 'MOTO' : this.riding;
    return { x: this.player.position.x, z: this.player.position.z, yaw: this.player.rotation.y, ride };
  }

  /** Véhicule d'un autre joueur, vu de l'extérieur avec les mêmes modèles que le sien. */
  private buildRemoteRide(ride: Ride): THREE.Group {
    if (ride === 'BUS') return this.buildCar(0x1f6feb, 9);
    if (ride === 'WORO') return this.buildCar(0xffce00, 4.2, { kind: 'hatch', stripe: 0x111111 });
    if (ride === 'CAR') return this.buildCar(0xd9dde3, 4.2, { kind: 'sedan' });
    const moto = this.buildMoto(0xe5383b);
    if (ride === 'ZEM') moto.add(buildRider(this.mats, { ...randomLook(rng(4242)), female: false, outfit: 'casual', fabric: 'plain', color: 4 }, { ...ZEM_SEAT, helmet: 0x196a45 }));
    return moto;
  }

  /** Met à jour les autres joueurs visibles : création, cible de déplacement, suppression des absents. */
  setRemotePlayers(list: { id: string; name: string; look: PersonLook; x: number; z: number; yaw: number; ride?: Ride | null }[]): void {
    const keep = new Set<string>();
    for (const r of list) {
      keep.add(r.id);
      const lookKey = JSON.stringify(r.look);
      let e = this.remotes.get(r.id);
      if (e && e.lookKey !== lookKey) {
        this.scene.remove(e.g);
        if (e.veh) this.scene.remove(e.veh);
        e.label.remove();
        this.remotes.delete(r.id);
        e = undefined;
      }
      if (!e) {
        const g = buildPerson(this.mats, r.look);
        g.position.set(r.x, 0, r.z);
        g.rotation.y = r.yaw;
        this.scene.add(g);
        const label = document.createElement('div');
        label.className = 'player-tag';
        label.textContent = r.name;
        this.pinLayer.appendChild(label);
        e = { g, label, tx: r.x, tz: r.z, tyaw: r.yaw, phase: 0, lookKey, ride: null, veh: null };
        this.remotes.set(r.id, e);
      }
      // Monté dans un véhicule ou descendu : on le voit à bord (bus, taxi, zém…) et non marcher à toute vitesse
      const ride = r.ride ?? null;
      if (ride !== e.ride) {
        if (e.veh) this.scene.remove(e.veh);
        e.veh = ride ? this.buildRemoteRide(ride) : null;
        if (e.veh) this.scene.add(e.veh);
        e.ride = ride;
      }
      e.tx = r.x;
      e.tz = r.z;
      e.tyaw = r.yaw;
      if (e.label.textContent !== r.name) e.label.textContent = r.name;
    }
    for (const [id, e] of this.remotes) {
      if (keep.has(id)) continue;
      this.scene.remove(e.g);
      if (e.veh) this.scene.remove(e.veh);
      e.label.remove();
      this.remotes.delete(id);
    }
  }

  private updateRemotes(dt: number): void {
    for (const e of this.remotes.values()) {
      const dx = e.tx - e.g.position.x;
      const dz = e.tz - e.g.position.z;
      const d = Math.hypot(dx, dz);
      // En véhicule, un long trajet avance de bien plus de 60 m entre deux mises à jour : on le suit sans sauter
      if (d > (e.ride ? 250 : 60)) {
        // Téléporté (changement de lieu) : pas de longue marche à travers la ville
        e.g.position.x = e.tx;
        e.g.position.z = e.tz;
      } else if (d > 0.05) {
        const step = Math.min(d, Math.max(3, d * 2) * dt);
        e.g.position.x += (dx / d) * step;
        e.g.position.z += (dz / d) * step;
        e.g.rotation.y = Math.atan2(dx, dz);
        if (!e.ride) {
          e.phase += dt * 8;
          animateWalk(e.g, e.phase, 0.55);
          e.g.position.y = 0;
          continue;
        }
      } else {
        e.g.rotation.y += Math.atan2(Math.sin(e.tyaw - e.g.rotation.y), Math.cos(e.tyaw - e.g.rotation.y)) * Math.min(1, dt * 6);
      }
      animateWalk(e.g, 0, 0);
      e.g.position.y = 0;
      if (!e.veh) continue;
      // Assis à bord, comme le joueur lui-même : passager du zém derrière le conducteur, ou sur sa propre moto
      e.g.position.y = e.ride === 'ZEM' || e.ride === 'MOTO' ? -0.05 : 0.8;
      seatLegs(e.g);
      const k = e.ride === 'ZEM' ? 0.5 : e.ride === 'MOTO' ? -0.12 : 0;
      e.veh.rotation.y = e.g.rotation.y;
      e.veh.position.set(e.g.position.x + Math.sin(e.g.rotation.y) * k, 0, e.g.position.z + Math.cos(e.g.rotation.y) * k);
    }
  }

  private updatePins(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const p = this.player.position;
    for (const e of this.remotes.values()) {
      const far = Math.hypot(e.g.position.x - p.x, e.g.position.z - p.z) > (this.view === 'street' ? 40 : 400);
      this.tmp.v.set(e.g.position.x, 2.3, e.g.position.z).project(this.camera);
      const visible = !far && this.tmp.v.z < 1 && Math.abs(this.tmp.v.x) < 1.05 && Math.abs(this.tmp.v.y) < 1.05;
      e.label.style.display = visible ? '' : 'none';
      if (visible) e.label.style.transform = `translate(${(((this.tmp.v.x + 1) / 2) * w).toFixed(1)}px, ${(((1 - this.tmp.v.y) / 2) * h).toFixed(1)}px) translate(-50%, -100%)`;
    }
    for (const pin of this.pins) {
      // Épingles VIP : beaucoup d'emplacements, on ne montre que ceux proches du regard sur la carte
      const far = this.view === 'street' ? Math.hypot(pin.pos.x - p.x, pin.pos.z - p.z) > 45 : pin.id.startsWith('vip:') && Math.hypot(pin.pos.x - this.camLook.x, pin.pos.z - this.camLook.z) > 130;
      this.tmp.v.copy(pin.pos).project(this.camera);
      const visible = !far && this.tmp.v.z < 1 && Math.abs(this.tmp.v.x) < 1.1 && Math.abs(this.tmp.v.y) < 1.1;
      pin.el.style.display = visible ? '' : 'none';
      if (visible) {
        const x = ((this.tmp.v.x + 1) / 2) * w;
        const y = ((1 - this.tmp.v.y) / 2) * h;
        pin.el.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
      }
    }
  }

  /** Libère toutes les ressources GPU et les écouteurs. */
  dispose(): void {
    this.clearWork();
    this.ambulanceClear();
    this.land?.geos.forEach((g) => g.dispose());
    this.land?.own.forEach((m) => m.dispose());
    updateStreetSound(0, 0, false);
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObs.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerup', this.onUp);
    el.removeEventListener('pointercancel', this.onCancel);
    el.removeEventListener('wheel', this.onWheel);
    el.removeEventListener('contextmenu', this.noMenu);
    window.removeEventListener('keydown', this.onKey);
    window.removeEventListener('keyup', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.travelDone?.();
    this.travelDone = null;
    this.clearRoute();
    this.instances.forEach((i) => i.dispose());
    this.carSets.forEach((i) => i?.dispose());
    this.scene.traverse((o) => {
      if (o instanceof THREE.InstancedMesh) o.dispose();
    });
    this.geos.forEach((g) => g.dispose());
    this.nightMaterials.forEach((m) => m.dispose());
    this.signalMats.forEach((m) => m.dispose());
    this.mergedMats.forEach((m) => m.dispose());
    this.skyMaterial.dispose();
    (this.marker.material as THREE.Material).dispose();
    this.vipMats.forEach((m) => m.dispose());
    this.beachMats.forEach((m) => m.dispose());
    this.seaDistrict?.geos.forEach((g) => g.dispose());
    this.seaDistrict?.own.forEach((m) => m.dispose());
    this.mats.dispose();
    this.scene.clear();
    this.pinLayer.remove();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    el.remove();
  }
}
