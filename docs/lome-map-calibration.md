# Recalage de la maquette de Lomé

Vérification du 21 octobre 2026. X croît vers l’est, Z vers le sud. Le centre-ville reste comprimé pour le jeu : les coordonnées de scène ne sont pas une projection GPS à échelle uniforme. Les positions relatives et les orientations ci-dessous sont les contraintes à conserver, avec des parcelles et des accès dégagés.

| Lieu | Référence géographique | Position de scène finale (x, z) |
| --- | --- | --- |
| Monument de l’Indépendance | 6.1299621 N, 1.2160115 E ; à l’ouest du Palais, au nord-est de l’hôtel | 20, -50 |
| Palais des Congrès | 6.1303069 N, 1.2173683 E ; façade concave vers la place, ouest-sud-ouest | 52, -56 |
| Hôtel du 2 Février | Au sud-ouest de la place | 15, -18 |
| Grand Marché | Environ 6.1257 N, 1.22154 E ; au sud-est du Palais, à l’ouest de la cathédrale | 69, -39 |
| Cathédrale | Environ 6.12493 N, 1.22639 E | 82, -39 |
| BOAD | 6.13609 N, 1.22307 E ; au nord du marché et au nord-est du Palais | 71, -80 |
| Colombe de la Paix | 6.14948 N, 1.23005 E ; distincte de la place de l’Indépendance, vers Tokoin et l’axe de l’aéroport | 90, -110 |
| CHU Campus | Emprise OSM centrée vers 6.18006 N, 1.21239 E ; côté ouest du boulevard, côté université, au sud de l’OTR | -10, -132 |
| CNSS | Côté ouest du boulevard, entre l’avenue de la Chance et le boulevard ; façade au sud, face à l’Université de Lomé | -16, -156 |
| OTR | Côté est du boulevard, juste après le carrefour OTR ; façade vers l’ouest | 21, -146 |
| Yas (Direction générale Togo Télécom) | 6.1938405 N, 1.2109873 E, à l’est du rond-point GTA, au sud de la route de la Nouvelle Présidence ; façade vers l’ouest | 38, -164 |
| Nouvelle Présidence | 6.1925166 N, 1.2222569 E, au sud de la route de la Nouvelle Présidence (portail côté route, au nord) | 80, -154 |
| CHR Lomé-Commune | 6.1917475 N, 1.2367265 E, boulevard Jean-Paul II, à l’est de la Présidence | 112, -205 |
| EZA ZOZO | À l’ouest de la voie locale d’Adidoadin ; orientation est approximative | -91, -240 |
| Deux Lions | 6.2176563 N, 1.1885203 E ; bassins au nord, de part et d’autre de la voie | -80, -266 |

Les orientations sont des estimations de lecture aérienne, pas des relevés d’arpentage. La Colombe et les échangeurs ont un placement routier simplifié. Les dimensions, voies secondaires et bretelles restent schématiques. L’orientation précise des statues des Deux Lions n’a pas été établie : elle n’a pas été modifiée arbitrairement.

Les tabliers OSM de Kégué et d’Agoè suivent un axe nord-ouest–sud-est (environ 30° et 22°). Leurs centres de scène sont (132, -241) et (0, -346). Le profil commun dans `FLYOVERS` pilote la chaussée, la structure et l’altitude des itinéraires ; la N1 et Jean-Paul II passent au niveau inférieur. Les bretelles d’Agoè partagent leur tracé entre rendu et graphe de navigation, en évitant le marché voisin.

## Sources

- OpenStreetMap : [monument](https://www.openstreetmap.org/node/1709321768), [Palais](https://www.openstreetmap.org/node/8362720114), [marché](https://www.openstreetmap.org/way/763961094), [cathédrale](https://www.openstreetmap.org/way/49711568), [BOAD](https://www.openstreetmap.org/way/318426052), [Colombe](https://www.openstreetmap.org/way/461403103), [CHU Campus](https://www.openstreetmap.org/way/800739846), [Yas / Togo Télécom](https://www.openstreetmap.org/way/228164577), [Nouvelle Présidence](https://www.openstreetmap.org/relation/2688600), [ambassade des États-Unis](https://www.openstreetmap.org/node/4344370103), [OTR](https://www.openstreetmap.org/node/6403968887), [CHR Lomé-Commune](https://www.openstreetmap.org/node/10830716927), [Deux Lions](https://www.openstreetmap.org/node/8280183065).
- Tabliers OSM : [Kégué](https://www.openstreetmap.org/way/650727073), [Agoè](https://www.openstreetmap.org/way/406690635).
- [Adresse officielle BOAD](https://projets.boad.org/contacts/), [OTR](https://www.otr.tg/index.php/fr/component/contact/contact/1-office-togolais-des-recettes.html), [CNSS](https://cnss.tg/contacts/).
- Imagerie consultée : [Esri World Imagery](https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer), zones du centre, du corridor administratif, d’EZA ZOZO et de la BOAD. La date de prise de vue n’est pas garantie par la date de consultation.

## Règles d’implémentation

Les rotations doivent transformer ensemble les maquettes, leurs obstacles et leurs entrées. Les emprises réservées aux lieux se testent dans le même repère tourné, pour empêcher la génération de maisons dans les parvis. Les modifications de coordonnées passent par une nouvelle migration SQL et le seed ; ne pas modifier une migration déjà appliquée et ne pas réinitialiser les joueurs.

## Contrôles effectués

Build de production du front et vérification TypeScript du back réussis. Dans la scène chargée avec les migrations locales : 15 destinations vérifiées, entrées hors chaussée, arrivée exacte et aucun segment traversant un obstacle sur les trajets contrôlés. Sélection par rayon vérifiée sur 11 maquettes transformées. Le passage supérieur d’Agoè monte à 6,5 puis revient à 0 ; la traversée de la N1 reste à 0. Aucune opération de paiement ni réinitialisation de joueur n’a été exécutée pour ces contrôles.

Les contrôles routiers ont également nécessité de reculer la maquette GTA Assurances hors de la branche vers Deux Lions, de faire passer la voie de Kégué à l’extérieur du CHR et du stade, et d’interdire au raccord local d’accepter une extrémité située dans un bâtiment.

La place de l’Indépendance est centrée dans son îlot (x=0..40, z=-70..-30), avec 6,5 unités entre le bord extérieur de son anneau et chacun des axes est/ouest. Les accès nord et sud partagent son axe x=20 ; les façades du Palais et du monument suivent leur axe commun (environ −79,4° / 100,6°).

Le CHU Campus est représenté par un ensemble allongé nord–sud, avec trois groupes d’ailes basses reliées, des cours et une desserte à l’est. Son entrée est au nord-est, reliée en biais au boulevard ; les bâtiments universitaires restent à l’ouest. Cette simplification reprend la lecture de l’imagerie Esri et de l’emprise OSM 800739846, sans prétendre reproduire chaque service ni les dimensions réelles.


## Vérification du 23 octobre 2026 (Yas, Présidence, CHR)

Échelle de la maquette : environ 34 unités par km, rond-point GTA (6.1942 N, 1.2091 E) en (0, -176). Relevés OSM : Yas ≈ 210 m à l’est de GTA ; la route de la Nouvelle Présidence passe au nord de Yas et de la Présidence (≈ 1,2 km à l’est de GTA), puis le boulevard Jean-Paul II mène au CHR (≈ 1,6 km plus à l’est). L’ordre d’ouest en est est donc Yas → Présidence → CHR, tous au sud ou le long de cette route. Ils avaient été posés au nord de la route ; ils sont replacés au sud (Yas, Présidence) et le CHR sur le boulevard Jean-Paul II. Les coordonnées de scène restent compressées pour laisser la place aux ambassades voisines.

## Ajustements du 23 octobre 2026 (suite)

CNSS (-30, -150), station-service avant la CNSS (-52, -174, d'après Total Lomé 2 / MRS près du rond-point GTA), marché d'Hédzranawoé (104, -128) séparé de la station TotalEnergies (128, -116), Palais des Congrès agrandi d'environ 15 %, nouvelle gare Sotral (-96, -96, position approximative à confirmer). Migration `20261023220000_positions_cnss_gare_sotral`.

## Grand Lomé (24 octobre 2026) — extension nord et ouest

Le sol s'étend à x ≥ -300 et z ≥ -1110 (`MAP_MIN_X`, `MAP_MIN_Z` dans `World.ts`). La RN1 (avenue x = 0) est prolongée jusqu'à z = -1060 (Tsévié). Positions projetées à l'échelle de la maquette (34 unités/km, GTA en (0, -176)) depuis Nominatim/OpenStreetMap : Davié (6,387 N ; 1,204 E) ≈ (-19, -903), Tsévié (6,423 N ; 1,210 E) ≈ (5, -1040), Sogbossito (6,250 N ; 1,177 E) ≈ (-120, -389), Légbassito (6,262 N ; 1,150 E) ≈ (-222, -430), Apessito (route de Mission-Tové, 6,287 N ; 1,142 E) ≈ (-252, -524).

**À valider** : Overpass était indisponible, aucun tracé de route n'a été relevé. Le péage de Davié (z = -840), la route de Kpalimé (RN5, polyligne `KPALIME_ROAD`), le carrefour et le portique de Tsévié sont schématiques. Sogbossito et Légbassito sont rapprochés de l'ouest de la RN1 pour ne pas chevaucher la zone `nord_ouest`. Les 9 nouvelles zones (`apessito`, `sogbossito`, `legbassito`, `axe_nord_est`, `axe_nord_ouest`, `davie_sud_est`, `davie_nord_ouest`, `tsevie_est`, `tsevie_ouest`) sont dans `SETTING_DEFAULTS.land` ; la limite de zones passe de 30 à 60. Rendu 3D non vérifié visuellement.

### Route de Légbassito, marché et Apessito

`LEGBASSITO_ROAD` relie le carrefour de Deux Lions (-80, -266) à Mission-Tové en passant entre les zones (tracé calculé pour ne traverser aucune zone à vendre, marge de 3,6 de chaque côté) : marché de Légbassito (OSM 6,268 N ; 1,151 E) à (-194, -455), puis Apessito avec église, école et poste de police (relevés OSM) au bord de la route. Rendu vérifié en Chrome sans écran. Si une zone est déplacée, vérifier que le tracé ne la recoupe pas.
