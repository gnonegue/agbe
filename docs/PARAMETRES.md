# Paramètres de jeu modifiables

Les règles d'équilibrage (prix, taux, horloge, besoins…) ne sont pas dans le code : elles sont stockées dans la table `game_setting` et lues par `SettingsService` (`back/src/settings/settings.service.ts`). Un administrateur peut les changer **sans redéployer**.

Pour chaque clé :

- tant qu'aucune valeur n'est enregistrée, la **valeur par défaut** ci-dessous s'applique ;
- chaque valeur est validée par un schéma strict : une valeur invalide est refusée (400) et un champ inconnu aussi ;
- la valeur est remplacée **en entier** (pas de fusion partielle) : envoie toujours l'objet complet ;
- les serveurs gardent les valeurs en cache jusqu'à 15 secondes, le changement est donc visible en moins de 15 s ;
- chaque modification est écrite dans le journal d'audit (`admin.setting_updated`).

## Rappel : les taux sont en points de base

Un **point de base (bp)** vaut 0,01 %. Donc **100 bp = 1 %**, 1 750 bp = 17,5 %, 10 000 bp = 100 %. Les clés dont le nom finit par `Bp` ou qui contiennent `rateBp` sont en points de base (maximum 100 000). Les montants d'argent sont des entiers en FCFA, sans décimales.

## Liste des paramètres

| Clé | Valeur par défaut | Signification |
|---|---|---|
| `game.clock` | `{ "epochRealMs": <1er janvier 2026 UTC en ms>, "secondsPerGameDay": 3600 }` | Horloge du jeu. `epochRealMs` : instant réel (millisecondes Unix) du jour 0 du jeu. `secondsPerGameDay` : durée réelle d'un jour de jeu (3600 = 1 heure réelle pour 1 jour de jeu ; entre 60 et 864 000). Le seed fixe `epochRealMs` à la date du premier seed. **À ne pas modifier en production** : les échéances de loyer et les délais sont calculés avec cette horloge. |
| `needs.decay` | `{ "perGameHour": { "hunger": 2, "energy": 2, "hygiene": 1, "morale": 1 }, "maxDecayGameHours": 12, "healthLossWhenStarving": 2 }` | Usure des besoins. `perGameHour` : points perdus par heure de jeu. `maxDecayGameHours` : plafond d'heures de jeu comptées quand le joueur est absent (il ne se retrouve pas mort au retour). `healthLossWhenStarving` : points de santé perdus par heure de jeu quand la faim ou l'énergie est à 0. Valeurs de 0 à 100 (le plafond jusqu'à 720). |
| `food.meal` | `{ "minHunger": 20, "energyFloor": 70 }` | Repas : un plat (ou service d'hôtel, activité de restaurant) qui apporte au moins `minHunger` points de faim remonte l'énergie à `energyFloor` % au minimum (jamais abaissée). Une boisson ou une bouchée n'est pas un repas. |
| `emergency.samu` | `{ "callBelowHealth": 30, "hospitalId": "hopital_dogta", "stayGameHours": 3, "fee": 15000, "restore": { "health": 80, "energy": 80, "hunger": 75, "hygiene": 70, "morale": 70 } }` | Urgence SAMU : appelable quand la santé est à `callBelowHealth` ou moins ; transfert à l'hôpital `hospitalId`, personnage indisponible `stayGameHours` heures de jeu, besoins remontés aux valeurs `restore` (jamais abaissés), facture `fee` (moins la part AMU). Tant que la facture est impayée, pas de nouvel appel. |
| `health.workup` | objet | Parcours médical : `analyses` (nom, prix, valeurs normales, résultat selon la maladie ou `healthy`) et `byIllness` (constantes, examen, analyses demandées, interprétation, ordonnance). La somme des prix d'une ordonnance doit rester égale au `treatment` de la maladie dans `health.illnesses`. |
| `vehicles.catalog` | objet | Motos et voitures : `models` (prix, réservoir, consommation en ml/km, entretien tous les X km, coût d'entretien et de réparation), prix du litre, `stations` (lieux de plein et d'entretien), `maxVehicles`, `resale` (valeur de départ, perte par km, plancher) et `rules` (condition minimale pour rouler, risque de panne par intervalle d'entretien dépassé, dégâts d'une panne). |
| `work.maxJobs` | `3` | Nombre de métiers qu'un personnage peut occuper en même temps (1 à 10). Chaque métier garde son délai entre séances ; l'énergie, elle, est partagée. |
| `work.night` | `{ "fromHour": 20, "toHour": 6, "bonusBp": 5000 }` | Séance de travail commencée la nuit : paie majorée de `bonusBp` (5000 = +50 %). |
| `work.zemBike` | `{ "gozemFee": 1500, "ownerFee": 2000, "ownKm": 25 }` | Moto d'une séance de zém : location Gozem à la séance (`gozemFee`), versement fixe au propriétaire d'une moto confiée (`ownerFee`, après contrat signé à la station) et kilomètres consommés avec sa propre moto (`ownKm`, carburant et usure). FCFA. |
| `work.anyHour` | `["zem_driver", "delivery_driver"]` | Métiers exercés à toute heure, même si leur lieu de départ (`work.places`) est fermé. |
| `start.capital` | `{ "RICH": 1500000, "MIDDLE": 150000, "POOR": 75000 }` | Argent de départ (FCFA) selon la condition de naissance. |
| `start.housing` | `{ "RICH": "VILLA", "MIDDLE": "CHAMBRE_SALON", "POOR": "ENTRER_COUCHER" }` | Logement de départ selon la condition. Valeurs permises : `VILLA`, `CHAMBRE_SALON`, `ENTRER_COUCHER`. |
| `rent.monthly` | `{ "VILLA": 250000, "CHAMBRE_SALON": 25000, "ENTRER_COUCHER": 8000 }` | Loyer mensuel (FCFA) par type de logement. |
| `destiny.weights` | `{ "POOR": 55, "MIDDLE": 38, "RICH": 7 }` | Poids du tirage au sort du mode « laisser le destin décider ». Ce sont des poids relatifs (0 à 1000) : ici, 55 % pauvre, 38 % moyen, 7 % nanti, parce que la somme vaut 100, mais d'autres sommes fonctionnent aussi. |
| `start.quota` | `{ "RICH": { "maxShareBp": 1000, "minSlots": 2 }, "MIDDLE": { "maxShareBp": 6000, "minSlots": 5 } }` | Plafond de personnages par condition de départ, pour garder une population réaliste (peu de riches). `maxShareBp` : part maximale des personnages existants, en points de base (1000 = 10 %). `minSlots` : places toujours ouvertes, pour qu'un jeu qui démarre ne soit pas bloqué. Une condition est ouverte si, une fois le nouveau personnage compté, sa part ne dépasse pas `maxShareBp` (arrondi inférieur), ou si moins de `minSlots` personnages l'ont déjà. Fermée, elle est grisée à la création, le choix libre est refusé et le tirage du destin descend d'un cran. « Pauvre » n'est jamais limité. |
| `destiny.bonusRespect` | `10` | Points de respect offerts à qui accepte le tirage au sort (0 à 100). |
| `transfer.fee` | `{ "rateBp": 100, "min": 25, "max": 5000 }` | Frais d'un virement entre joueurs : taux en points de base (100 = 1 %), avec un minimum et un maximum en FCFA. |
| `transfer.limits` | `{ "minAccountAgeHours": 24, "dailySendMax": 50000, "dailyReceiveMax": 100000 }` | Anti multi-comptes. Ancienneté minimale du compte pour virer (heures réelles) et plafonds glissants sur 24 h réelles (FCFA envoyés, FCFA reçus). |
| `chat` | `{ "maxLength": 280, "minIntervalSeconds": 3, "historySize": 50, "autoHideReports": 3, "minAccountAgeHours": 1, "blockedWords": [], "presenceMax": 40 }` | Chat : longueur d'un message, délai entre deux messages, messages chargés à l'ouverture, signalements distincts qui masquent un message, ancienneté du compte pour écrire, mots interdits, joueurs visibles autour de soi. |
| `tontine` | `{ "minContribution": 1000, "maxContribution": 200000, "periods": [7, 30], "minMembers": 3, "maxMembers": 12, "missRespect": 15, "missMorale": 10, "maxActive": 3, "maxDefaultsToJoin": 2, "minAccountAgeHours": 24 }` | Tontine : cotisation, durées de tour (jours de jeu), taille, pénalité d'un tour manqué, tontines par joueur, tours manqués au-delà desquels on ne peut plus rejoindre, ancienneté du compte. |
| `market.goods` | liste | Marchandises du marché entre joueurs : prix de gros (indicatif), marge maximale en points de base (20 000 = deux fois le prix de gros), effets à l'usage. |
| `market.rules` | `{ "venues": [...], "weeklyRent": 3500, "maxWeeks": 8, "taxBp": 200, "maxStock": 500, "maxBuy": 50, "ranks": [...] }` | Marchés où louer un étal, loyer par semaine de jeu (au Trésor), taxe de marché payée par la vendeuse, stocks, rangs jusqu'à Nana Benz selon les ventes. |
| `health.illnesses` | liste | Maladies : poids de tirage, perte quotidienne de santé et d'énergie, prix du traitement (indicatif), guérison spontanée en jours (0 = jamais). |
| `health.rules` | `{ "dailyRiskBp": 250, "dirtyBelow": 30, "dirtyMultiplierBp": 20000, "weakBelow": 40, "weakMultiplierBp": 15000, "consultPrice": 2500, "healOnTreat": 30, "maxCatchUpDays": 7 }` | Risque quotidien de tomber malade et ses majorations, prix de la consultation, santé rendue par le traitement, jours de jeu rattrapés au plus après une absence. L'AMU rembourse `amu.coverageBp`. |
| `family.rules` | objet | Demandes de la famille : chance quotidienne, délai de réponse, montants selon la condition de naissance, effets du paiement ou du refus ; aide de la famille quand le solde passe sous `helpBelow`. |
| `ceremony.rules` | objet | Cérémonies entre joueurs : coût et respect par type (dot, baptême, funérailles, anniversaire), don minimum et maximum d'un invité, délai d'organisation, cérémonies par mois, lieux où l'on peut organiser une fête (`venues`). |
| `hotel` | objet | Hôtel : lieu, séjour maximal, catégories de chambres (nombre, prix par nuit indicatif, confort), service en chambre, salles à la journée (capacité, prix, respect), salle louée pour les fêtes. |
| `utilities.outages` | objet | Coupures de courant et d'eau : chance quotidienne, durée (heures de jeu), effet sur le moral et l'hygiène ; prix du groupe électrogène, du panneau solaire et de la citerne. |
| `economy.events` | liste | Événements de la semaine, communs à tous : chance par semaine, facteur sur les prix de gros (par marchandise ou `*`) et sur les transports (10 000 = inchangé). |
| `travel.intercity` | objet | Cars entre villes. `enabled` (`false` par défaut) : départs ouverts ou non ; fermés, on reste dans le Grand Lomé et seul le retour vers Lomé reste possible. Puis gare de chaque ville, liaisons (prix indicatif, durée en heures de jeu), énergie perdue par heure de route. |
| `company.playerJobs` | `{ "maxGross": 80000, "maxOpenOffers": 3 }` | Emploi entre joueurs : plafond du salaire brut mensuel d'une offre (FCFA ; le minimum est le SMIG) et nombre d'offres ouvertes par entreprise (1 à 20). Le patron et le salarié doivent avoir l'ancienneté de `transfer.limits.minAccountAgeHours`. |
| `company.portfolio` | `{ "maxCompanies": 3, "saleShifts": 120, "saleShiftsPerEmployee": 40, "employeeSaleBp": 3500, "maxCatchUpShifts": 8 }` | Entreprises multiples : nombre maximal d'entreprises ouvertes par joueur ; prix de vente d'une entreprise = bénéfice d'une séance × (`saleShifts` + `saleShiftsPerEmployee` × salariés actifs) ; chaque salarié actif vend seul `employeeSaleBp` (points de base) du bénéfice d'une séance à chaque séance écoulée, rattrapage plafonné à `maxCatchUpShifts` séances. |
| `home.furniture` | catalogue, emplacements, pièces, standing, revente | Aménagement du logement : `items` (meubles : prix, empreinte `w` × `d` en mètres, confort, `fixed` = pas de rotation), `slots` (meubles posés par type de logement), `rooms` (taille des pièces, même repère que la 3D), `resaleBp` (revente en points de base du prix payé), `starters` (meubles d'origine donnés au premier affichage du logement), `starterValueBp` et `giftValueBp` (valeur de revente des meubles d'origine et des meubles reçus en cadeau), `storageMax` (rangement), `standing` (seuils de confort). |
| `market.tenders` | voir ci-dessous | Marchés publics générés automatiquement : `sectors`, `cadenceGameHours` (12 par défaut), `multiSectorChanceBp` (part des marchés qui couvrent plusieurs domaines, 4000 par défaut), fourchettes de places, budget, délai et séances. Tous les domaines de `company.activities` reçoivent des marchés, même absents de `sectors`. |
| `jobs.public` | `{ "enabled": true, "minShifts": 12, "bands": { "DEBROUILLE": {"min":52500,"max":80000}, "QUALIFIE": {"min":85000,"max":150000}, "DIPLOME": {"min":160000,"max":450000} } }` | Emplois salariés des employeurs publics : un par métier du catalogue (présents dès l'installation, rien à semer). Salaire brut mensuel réparti dans la bande du niveau selon le gain par service du métier ; sans diplôme, du SMIG à 80 000. Le salarié réclame chaque mois clos (`POST /jobs/salary`) : le Trésor verse le net au prorata des services du métier terminés dans ce mois (`minShifts` services = salaire entier). `enabled: false` masque ces offres. |
| `jobs.taskPaid` | `["car_washer", "zem_driver", "delivery_driver", "cargo_rider", "street_vendor", "agent_commercial", "tailor", "barber", "moto_mechanic", "coiffeur_pro", "styliste"]` | Métiers payés **à la tâche** (chaque service est payé tout de suite). Tous les autres métiers sont **salariés** : le joueur postule (employeur public, `jobs.public`), les services faits comptent, et le salaire mensuel est réclamé chaque mois. Si `jobs.public.enabled` est faux, tout est à la tâche. |
| `partners.tiers` | `{ "BRONZE": { "boards": 0, "rotating": 1, "jobs": 0, "eventsPerMonth": 0, "monthlyPrice": 10000, … }, "SILVER": { "boards": 2, "rotating": 1, "jobs": 3, "eventsPerMonth": 1, "monthlyPrice": 20000, … }, "GOLD": { "boards": 4, "rotating": 2, "jobs": 10, "eventsPerMonth": 2, "monthlyPrice": 35000, … } }` | Formules VIP : prix mensuel (FCFA), panneaux fixes et rotatifs inclus (plafonds), offres d'emploi, événements par mois, durées (défaut, min, max en mois). Modifiables dans /admin, Formules et tarifs. Le panneau en libre-service (produits `board_7d` rotatif et `board_fixed_7d` fixe, +50 %, 7 jours) et les cases (`plot_<espace>`) sont des produits, pas des réglages. |
| `ad.rotation` | `{ "max": 8, "panels": 10 }` | Annonces rotatives en libre-service : `max` en même temps (au-delà, `rotation_full`) ; `panels` derniers numéros de panneaux (sur `ad.boards.count`) jamais vendus en fixe aux joueurs, pour que la rotation garde toujours des panneaux. Chaque annonce reste 8 s à l'écran. |
| `action.rest` | `{ "energyGain": 35, "cooldownGameHours": 2 }` | Se reposer : énergie gagnée (0 à 100) et délai avant de pouvoir se reposer à nouveau (heures de jeu, 0 à 48). |
| `action.wash` | `{ "price": 100, "hygieneGain": 45 }` | Se laver : tarif par douche (FCFA, au moins 1) et hygiène gagnée. La douche ne se paie pas sur le moment : elle est comptée et ajoutée à la facture d'eau du mois (abonnement `bills.monthly.WATER` + douches × tarif). |
| `payroll.rates` | `{ "smig": 52500, "cnssEmployeeBp": 400, "cnssEmployerBp": 1750, "amuEmployeeBp": 500, "amuEmployerBp": 500, "irppBrackets": [] }` | Fiche de paie. `smig` : salaire minimum (FCFA/mois). `cnssEmployeeBp` / `cnssEmployerBp` : cotisation CNSS salarié / employeur (400 = 4 %, 1 750 = 17,5 %). `amuEmployeeBp` / `amuEmployerBp` : assurance maladie AMU salarié / employeur (500 = 5 %). `irppBrackets` : tranches de l'impôt sur le revenu, liste de `{ "from": <montant FCFA>, "rateBp": <taux> }` (20 tranches au plus). Vide par défaut : l'IRPP est alors nul. **À faire valider par un expert-comptable** avant le lancement. |
| `partners.contact` | `{ "email": "dtdev.tg@gmail.com", "whatsapp": "" }` | Contact des annonceurs : l'e-mail est affiché sur la page d'accueil (« Écrivez-nous ») ; renvoyé aussi par `GET /boards/offer`. Vide = masqué. `email` : adresse e-mail ; `whatsapp` : numéro au format international (`+228…`). Vide = non affiché. |
| `tax.vatBp` | `1800` | TVA en points de base (1 800 = 18 %). Définie et modifiable, mais pas encore utilisée par le jeu. |
| `study` | voir `SETTING_DEFAULTS.study` | Études supérieures. `venueId` : lieu d'inscription ; `domains` : domaines (informatique, comptabilité, journalisme, commerce, BTP, électricité, stylisme, coiffure) avec leurs leçons ; `bt` : séances du bac technique (G2, G3, F3, F4, H) et domaine correspondant ; `cycles` : années, inscription annuelle (FCFA) et séances par année de chaque cursus ; `minCorrectBp` : part de bonnes réponses pour réussir l'examen ; `sessionEnergy`/`sessionHunger` : coût d'une séance ; `respectReward` ; `jobReq` : diplôme minimal (`BAC`, `BT`, `LICENCE`, `MASTER`, `DOCTORAT`) et domaines acceptés pour chaque métier. Les métiers eux-mêmes sont dans la table `job`. |
| `kitchen` | voir `SETTING_DEFAULTS.kitchen` | Cuisine à la maison. `items` : ingrédients et combustibles (`price` d'un achat qui apporte `pack` unités, `shelfDays` de conservation en jours de jeu, 0 = ne se périme pas, `venues` : lieux de vente). `appliances` : réfrigérateur (`FRIDGE`) et réchauds (`STOVE` avec `fuel` CHARCOAL, GAS ou ELECTRIC et `fuelItem` consommé à chaque cuisson). `recipes` : plat du catalogue `food_item`, `portions` obtenues, `effort` (fatigue) et ingrédients. `fridgeShelfBp` : multiplicateur de conservation avec un réfrigérateur ; `leftoverDays` / `leftoverFridgeDays` : conservation des restes ; `homeMoraleBonus` : moral en plus pour un plat maison ; `electricFee` : redevance par cuisson sur un réchaud électrique ; `maxLeftovers` : portions de restes gardées. Un test vérifie qu'une portion maison coûte moins cher que le plat au restaurant. |
| `industry` | voir `SETTING_DEFAULTS.industry` | Industrie : usines et zones franches à acheter (`plants` : `price`, `maxStaff`, `wagePerStaff` par salarié et par jour de jeu, `dailyRevenueBp` du prix par jour à pleine capacité ; `units` exemplaires ; bénéfice net = chiffre d'affaires proportionnel au personnel − salaires). `maxAccrualDays` : jours de bénéfice qui s'accumulent sans encaisser ; `transferTaxBp`/`maxAskMultiple` : revente entre joueurs. `investors` : grands investisseurs PNJ qui entrent au capital (`minPrice` du site, `maxShareBp`, `offerBp` valorisation en points de base du prix, ±15 % selon le jour, `buybackPremiumBp` majoration au rachat de leur part). |
| `land` | voir `SETTING_DEFAULTS.land` | Foncier (terrains par quarts de lot). `lotM2` (600) et `quarterM2` (150) : surface d'un lot et d'un quart ; `maxM2PerPlayer` (150 000 = 15 ha) ; `maxPicksPerPurchase` ; `purchaseFeeBp` (frais de dossier à l'achat) et `transferTaxBp` (droits d'enregistrement à la revente, payés par l'acheteur) ; `maxAskMultiple` (prix demandé au plus ce multiple de la valeur). `price` : prix du m² selon la position — `centerPerM2`/`edgePerM2` (FCFA/m² au centre `hubX,hubZ` et en rase campagne), `halfDistance` (distance où la prime de centralité est divisée par deux), `roads` + `roadBonusBp`/`roadRange` (bordure de route), `seaZ` + `seaBonusBp`/`seaRange` (littoral). `zones` : rectangles de cellules sur la carte (`originX/Z`, `cols`, `rows`, `cell`) avec un coefficient `tierBp` ; `fixedPerM2` impose le prix du m² (le lotissement d'Adidogomé est la zone `lotissement`, 1 334 FCFA/m² soit environ 800 000 le lot) ; `margin` (marge de sol, 0 en ville) et `sign` (enseigne d'entrée) ; `water: true` = parcelle en mer (prestige) : ponton de bois sur l'eau, sans route d'accès, distincte des cases de publicité `sea.plots` (une zone en mer ne doit pas les recouvrir : un test le vérifie). Par défaut `mer_lagon` (120 000 FCFA/m², double du plus cher à terre), `mer_large` et `mer_baie` (180 000, triple) et `mer_horizon` (200 000), plus la rive ouest de l'autre côté de la route sur l'eau (`mer_ouest` 180 000, `mer_ouest_sud` 200 000) et le grand terrain de front de mer `mer_corniche` (150 000), près de la plage, au bout de la corniche ouest, à gauche du port, à l'ouest de la grille de publicité (x < −200), mêmes lots et quarts qu'à terre. `startRows` : zone à extension — seules ces rangées sont ouvertes au départ, les suivantes s'ouvrent à mesure que des lots se vendent, `reserveRows` (2) toujours libres d'avance ; la part fermée est tracée en pointillé sur la carte. Les routes d'accès sont tracées par la carte elle-même : de la route la plus proche jusqu'au bord de chaque zone, par un tracé dégagé. Un test vérifie qu'aucune zone (extension comprise) n'en recouvre une autre ni ne sort du sol de la carte. Les zones couvrent la campagne (nord-est, ouest, Kégué, Baguida) et des parcelles en ville (`ville_*`). Le réglage `estate` est supprimé : ses coûts de maison sont dans `uses`. `steps` : démarches du titre (`feePerM2`, `minFee`, `gameHours`). `uses` : maisons (coût fixe) et activités (`costPerM2`, `dailyYieldBp` du capital par jour de jeu sur `lifeGameDays`). Les emplacements des zones sont à valider sur la carte 3D. |

Les prix des plats et les gains des métiers ne sont **pas** dans `game_setting` : ils sont dans les tables `food_item` et `job` (remplies par `npm run db:seed`) et aucune route d'administration ne les modifie pour l'instant.

## Voir les valeurs actuelles

```bash
curl -s https://agbe.exemple.tg/api/admin/settings -H "Authorization: Bearer $TOKEN"
```

La réponse contient toutes les clés avec la valeur effective (défaut ou valeur enregistrée).

## Modifier un paramètre

Condition : être administrateur **et** avoir activé la 2FA (voir `README.md`, « Créer un administrateur »).

### 1. Obtenir un jeton d'accès

Les routes de connexion exigent l'en-tête `X-AGBE-CSRF: 1`. Avec la 2FA, la connexion se fait en deux temps. Remplace l'adresse (en local : `http://127.0.0.1:3000`) et utilise `jq` pour extraire les valeurs (`sudo apt install jq`) :

```bash
API=https://agbe.exemple.tg    # en local : http://127.0.0.1:3000

MFA_TOKEN=$(curl -s -X POST "$API/api/auth/login" \
  -H 'Content-Type: application/json' -H 'X-AGBE-CSRF: 1' \
  -d '{"identifier":"ton.email@exemple.com","password":"TON_MOT_DE_PASSE"}' | jq -r .mfaToken)

TOKEN=$(curl -s -X POST "$API/api/auth/mfa" \
  -H 'Content-Type: application/json' -H 'X-AGBE-CSRF: 1' \
  -d "{\"mfaToken\":\"$MFA_TOKEN\",\"code\":\"123456\"}" | jq -r .accessToken)
```

`123456` est le code à 6 chiffres affiché par ton application d'authentification. Le jeton d'accès dure 15 minutes ; refais l'opération s'il expire (les limites de débit s'appliquent : 5 essais de code par minute).

### 2. Envoyer la nouvelle valeur

`PUT /api/admin/settings/:key` avec le corps `{ "value": ... }`. Exemple : passer les frais de virement à 2 % (200 bp), minimum 50 FCFA, maximum 10 000 FCFA :

```bash
curl -s -X PUT "$API/api/admin/settings/transfer.fee" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"value":{"rateBp":200,"min":50,"max":10000}}'
```

Réponse en cas de succès : `{"key":"transfer.fee","value":{"rateBp":200,"min":50,"max":10000}}`.

Autre exemple, la grille de l'IRPP (exemple fictif, **à remplacer par la vraie grille validée**) :

```bash
curl -s -X PUT "$API/api/admin/settings/payroll.rates" \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"value":{"smig":52500,"cnssEmployeeBp":400,"cnssEmployerBp":1750,"amuEmployeeBp":500,"amuEmployerBp":500,"irppBrackets":[{"from":0,"rateBp":0},{"from":900000,"rateBp":1000}]}}'
```

### Erreurs possibles

| Code | Cause |
|---|---|
| 401 | Jeton expiré ou absent. |
| 403 `mfa_required` | Le jeton ne vient pas d'une connexion avec 2FA : active la 2FA et reconnecte-toi. |
| 403 | Le compte n'a pas le rôle ADMIN. |
| 404 `unknown_setting` | Clé inexistante (vérifie l'orthographe avec la liste ci-dessus). |
| 400 | Valeur refusée par le schéma ; la réponse indique le champ fautif (ex. `rateBp: Number must be less than or equal to 100000`). |

## Autres routes d'administration

- `GET /api/admin/audit?limit=50` : dernières entrées du journal d'audit (200 au plus).
- `GET /api/admin/ledger/verify` : contrôle d'intégrité du grand livre.
- `GET /api/admin/stats` : nombre de comptes, de personnages, d'achats payés et chiffre d'affaires.

| `clothes.rules` | boutiques de vêtements | Ajouts : `closeBuybackBp`, `closeRentRefundBp`, `npcVisitsPerDay` (2 par défaut), `npcMaxCatchUpDays` (clients du quartier qui achètent seuls dans les boutiques de joueurs ouvertes). |
