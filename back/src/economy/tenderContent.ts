// Marchés publics (tenders) : catalogue de contenus (titre + description, bilingue) par secteur. Calcul pur,
// aucun accès réseau ni base de données — seulement de la saveur textuelle (pas une somme d'argent), piochée
// de façon déterministe par `pickTenderContent` (index tournant) ou `randomTenderContent` (index aléatoire via
// `node:crypto`, admissible ici car ce n'est jamais un calcul affectant une somme d'argent).
import { randomInt } from 'node:crypto';

export interface TenderContent {
  titleFr: string;
  titleEn: string;
  descriptionFr: string;
  descriptionEn: string;
}

const C = (titleFr: string, titleEn: string, descriptionFr: string, descriptionEn: string): TenderContent => ({ titleFr, titleEn, descriptionFr, descriptionEn });

/** 2 à 4 couples titre+description par secteur, ton municipal/étatique togolais. */
export const TENDER_CONTENT: Record<string, TenderContent[]> = {
  pagnes: [
    C('Dotation de pagnes pour une cérémonie officielle', 'Wax print supply for an official ceremony', 'Fournir des pagnes aux couleurs de la cérémonie pour les agents municipaux et les invités.', "Supply wax prints in the ceremony's colours for municipal staff and guests."),
    C('Uniformes en pagne pour une école publique', 'Wax-print uniforms for a public school', "Coudre des uniformes en pagne pour les élèves d'une école publique à la rentrée.", 'Sew wax-print uniforms for pupils of a public school at the start of the school year.'),
  ],
  maquis: [
    C("Restauration d'un événement municipal", 'Catering for a municipal event', "Préparer les repas d'un événement organisé par la mairie, pour plusieurs dizaines de convives.", 'Prepare meals for an event organised by the town hall, for dozens of guests.'),
    C('Cantine de chantier public', 'Public worksite canteen', "Nourrir les ouvriers d'un chantier public pendant la durée des travaux.", 'Feed the workers of a public worksite for the duration of the works.'),
  ],
  couture: [
    C('Confection d’uniformes pour un service public', 'Making uniforms for a public service', "Coudre des uniformes pour les agents d'un service public (santé, voirie, sécurité).", 'Sew uniforms for staff of a public service (health, roads, security).'),
    C('Drapeaux et banderoles pour une fête nationale', 'Flags and banners for a national celebration', "Confectionner drapeaux et banderoles pour la célébration d'une fête nationale.", 'Make flags and banners for a national celebration.'),
  ],
  pret_a_porter: [
    C('Habillement des agents d’accueil municipaux', 'Clothing for municipal reception staff', "Fournir des tenues prêtes à porter pour les agents d'accueil d'un service municipal.", 'Supply ready-to-wear outfits for reception staff of a municipal service.'),
    C('Dotation vestimentaire pour une équipe sportive scolaire', 'Clothing supply for a school sports team', 'Habiller une équipe sportive représentant une école publique lors d’une compétition.', 'Clothe a sports team representing a public school at a competition.'),
  ],
  cyber: [
    C('Numérisation des registres d’une mairie', "Digitising a town hall's registers", "Saisir et numériser les registres administratifs papier d'une mairie de quartier.", 'Type and digitise the paper administrative registers of a district town hall.'),
    C('Formation informatique des agents municipaux', 'Computer training for municipal staff', 'Former des agents municipaux à l’usage de base d’un ordinateur et d’Internet.', 'Train municipal staff in basic computer and internet use.'),
  ],
  transport: [
    C('Transport scolaire d’un quartier', 'School transport for a district', "Assurer le transport quotidien des élèves d'une école publique vers leur quartier.", 'Provide daily transport for pupils of a public school to their district.'),
    C('Navette pour un centre de santé communautaire', 'Shuttle for a community health centre', 'Transporter patients et agents entre un centre de santé communautaire et le quartier.', 'Transport patients and staff between a community health centre and the district.'),
  ],
  btp: [
    C('Réfection de la voirie du quartier X', "Resurfacing of district X's roads", "Réparer les nids-de-poule et refaire le revêtement d'une rue très fréquentée du quartier.", 'Fix potholes and resurface a busy street in the district.'),
    C('Construction d’un marché couvert au quartier Y', 'Building a covered market in district Y', 'Construire un marché couvert pour abriter les commerçants d’un quartier en saison des pluies.', 'Build a covered market to shelter traders of a district during the rainy season.'),
  ],
  sante: [
    C('Campagne de vaccination de proximité', 'Local vaccination campaign', 'Organiser une campagne de vaccination dans un quartier, avec le soutien du centre de santé local.', 'Organise a vaccination campaign in a district, supported by the local health centre.'),
    C('Consultations médicales gratuites pour un quartier', 'Free medical check-ups for a district', 'Offrir une journée de consultations médicales gratuites aux habitants d’un quartier défavorisé.', 'Offer a day of free medical check-ups to residents of an underprivileged district.'),
  ],
  compta: [
    C('Audit comptable d’un service municipal', 'Accounting audit of a municipal service', 'Vérifier les comptes d’un service municipal et produire un rapport pour la mairie.', 'Check the accounts of a municipal service and produce a report for the town hall.'),
    C('Appui à l’établissement du budget d’une école publique', "Support for drawing up a public school's budget", 'Aider une école publique à préparer et équilibrer son budget annuel.', 'Help a public school prepare and balance its annual budget.'),
  ],
  droit: [
    C('Conseil juridique pour un contrat municipal', 'Legal advice for a municipal contract', 'Relire et conseiller la mairie sur un contrat avant sa signature.', 'Review and advise the town hall on a contract before signing.'),
    C('Médiation pour un litige foncier de quartier', 'Mediation for a district land dispute', 'Accompagner la résolution amiable d’un litige foncier entre riverains.', 'Support the amicable settlement of a land dispute between neighbours.'),
  ],
  pharmacie: [
    C('Dotation en médicaments essentiels d’un centre de santé', 'Essential medicine supply for a health centre', 'Fournir des médicaments essentiels à un centre de santé communautaire en rupture de stock.', 'Supply essential medicines to a community health centre out of stock.'),
    C('Campagne de distribution de moustiquaires imprégnées', 'Treated mosquito net distribution campaign', 'Distribuer des moustiquaires imprégnées aux familles d’un quartier contre le paludisme.', 'Distribute treated mosquito nets to families in a district against malaria.'),
  ],
  coiffure: [
    C('Préparation des agents pour une cérémonie officielle', 'Grooming staff for an official ceremony', 'Coiffer les agents municipaux avant une cérémonie officielle de la ville.', 'Groom municipal staff before an official ceremony of the city.'),
    C('Journée beauté pour un centre pour personnes âgées', "Beauty day for a senior citizens' centre", 'Offrir une journée de coiffure et de soins aux résidents d’un centre pour personnes âgées.', "Offer a day of hairdressing and care to residents of a senior citizens' centre."),
  ],
  hotellerie: [
    C('Hébergement d’une délégation officielle', 'Accommodation for an official delegation', 'Héberger et restaurer une délégation en visite officielle dans la ville.', 'House and feed a delegation on an official visit to the city.'),
    C('Accueil d’un séminaire de l’administration', 'Hosting an administration seminar', 'Accueillir un séminaire de formation des agents de l’administration pendant plusieurs jours.', 'Host a training seminar for administration staff over several days.'),
  ],
  logistique: [
    C('Acheminement de matériel électoral', 'Delivery of election material', 'Transporter le matériel électoral vers les bureaux de vote d’une circonscription.', 'Transport election material to the polling stations of a constituency.'),
    C('Transport de vivres pour une zone sinistrée', 'Transport of food supplies to a disaster-hit area', 'Acheminer des vivres et du matériel de secours vers une zone touchée par les inondations.', 'Deliver food supplies and relief material to an area hit by flooding.'),
  ],
  mecanique: [
    C('Entretien de la flotte de véhicules municipaux', 'Servicing the municipal vehicle fleet', 'Assurer l’entretien et les réparations des véhicules de service d’une mairie.', "Service and repair a town hall's fleet of service vehicles."),
    C('Réparation des motos de la police de proximité', 'Repair of community police motorbikes', 'Réparer et entretenir les motos utilisées par la police de proximité d’un quartier.', "Repair and maintain the motorbikes used by a district's community police."),
  ],
  telecoms: [
    C('Installation téléphonique d’un nouveau bureau municipal', 'Phone setup for a new municipal office', 'Installer les lignes et forfaits téléphoniques d’un nouveau bureau de la mairie.', 'Set up phone lines and plans for a new town hall office.'),
    C('Points d’accès Internet pour une bibliothèque publique', 'Internet access points for a public library', 'Équiper une bibliothèque publique de points d’accès Internet pour les usagers.', 'Equip a public library with Internet access points for users.'),
  ],
  rh: [
    C('Recrutement d’agents pour un service municipal', 'Recruiting staff for a municipal service', 'Organiser le recrutement d’agents contractuels pour un service municipal en sous-effectif.', 'Organise the recruitment of contract staff for an understaffed municipal service.'),
    C('Formation des agents à l’accueil du public', 'Training staff in public reception', 'Former les agents d’un guichet municipal à un meilleur accueil du public.', 'Train staff of a municipal counter in better public reception.'),
  ],
  banque: [
    C('Appui à une caisse de micro-crédit communautaire', 'Support for a community micro-credit fund', 'Mettre en place un dispositif d’épargne et de petits crédits pour les commerçants d’un marché.', 'Set up a savings and small-loan scheme for traders of a market.'),
    C('Sensibilisation à l’épargne pour les artisans d’un quartier', "Savings awareness for a district's craftspeople", 'Animer des séances de sensibilisation à l’épargne auprès des artisans d’un quartier.', 'Run savings awareness sessions for craftspeople in a district.'),
  ],
  architecture: [
    C('Plans d’un centre de santé communautaire', 'Plans for a community health centre', 'Dessiner les plans d’un nouveau centre de santé communautaire pour la mairie.', 'Draw up plans for a new community health centre for the town hall.'),
    C('Étude d’aménagement d’une place publique', 'Design study for a public square', 'Étudier l’aménagement d’une place publique pour en faire un lieu de vie du quartier.', 'Study the layout of a public square to turn it into a district gathering place.'),
  ],
  environnement: [
    C('Collecte des déchets d’un marché municipal', 'Waste collection at a municipal market', 'Organiser la collecte et le tri des déchets d’un grand marché municipal.', 'Organise waste collection and sorting at a large municipal market.'),
    C('Nettoyage d’un caniveau de quartier', 'Cleaning a district drainage ditch', 'Curer et nettoyer un caniveau bouché avant la saison des pluies.', 'Clear and clean a blocked drainage ditch before the rainy season.'),
  ],
  cybersecurite: [
    C('Sécurisation du site Internet d’une administration', "Securing an administration's website", 'Auditer et renforcer la sécurité du site Internet d’un service de l’État.', "Audit and strengthen the security of a government service's website."),
    C('Formation des agents à la cybersécurité', 'Cybersecurity training for staff', 'Former des agents administratifs à reconnaître l’hameçonnage et protéger leurs mots de passe.', 'Train administrative staff to recognise phishing and protect their passwords.'),
  ],
  data: [
    C('Analyse des données d’un recensement de quartier', "Analysis of a district census' data", 'Analyser les données collectées lors d’un recensement de quartier pour la mairie.', 'Analyse the data collected during a district census for the town hall.'),
    C('Tableau de bord de suivi des impôts locaux', 'Dashboard for tracking local taxes', 'Construire un tableau de bord pour suivre le recouvrement des impôts locaux.', 'Build a dashboard to track the collection of local taxes.'),
  ],
  agronomie: [
    C('Appui à un champ communautaire', 'Support for a community field', 'Accompagner la culture d’un champ communautaire destiné à nourrir une école publique.', 'Support the farming of a community field meant to feed a public school.'),
    C('Fourniture de plants pour un reboisement municipal', 'Supplying seedlings for a municipal reforestation', 'Fournir des plants pour une campagne de reboisement organisée par la mairie.', 'Supply seedlings for a reforestation campaign organised by the town hall.'),
  ],
  education: [
    C('Soutien scolaire pour les élèves d’une école publique', 'Tutoring for pupils of a public school', 'Organiser des séances de soutien scolaire gratuites pour les élèves en difficulté d’une école publique.', 'Organise free tutoring sessions for struggling pupils of a public school.'),
    C('Cours de rattrapage avant les examens d’État', 'Catch-up classes before state exams', 'Préparer des élèves aux examens d’État avec des cours de rattrapage ciblés.', 'Prepare pupils for state exams with targeted catch-up classes.'),
  ],
  journalisme: [
    C('Campagne de communication d’un service municipal', 'Communication campaign for a municipal service', 'Concevoir une campagne de communication pour faire connaître un nouveau service municipal.', 'Design a communication campaign to promote a new municipal service.'),
    C('Couverture d’un événement officiel pour la mairie', 'Covering an official event for the town hall', 'Couvrir en photos et en articles un événement officiel organisé par la mairie.', 'Cover an official event organised by the town hall in photos and articles.'),
  ],
  informatique: [
    C('Numérisation des services d’une mairie', "Digitising a town hall's services", 'Développer un petit logiciel de suivi des dossiers pour un service municipal.', 'Develop a small case-tracking application for a municipal service.'),
    C('Maintenance informatique d’une école publique', 'IT maintenance for a public school', 'Assurer la maintenance des ordinateurs d’une salle informatique d’école publique.', "Maintain the computers of a public school's computer room."),
  ],
  electricite: [
    C('Éclairage public d’une rue de quartier', 'Street lighting for a district road', 'Installer l’éclairage public sur une rue mal éclairée d’un quartier.', 'Install street lighting on a poorly-lit district road.'),
    C('Raccordement électrique d’un centre de santé', 'Electrical connection for a health centre', 'Réaliser le raccordement et la mise en sécurité électrique d’un centre de santé communautaire.', 'Carry out the electrical connection and safety work for a community health centre.'),
  ],
};

function fallback(sector: string): TenderContent {
  return C(`Marché public — ${sector}`, `Public tender — ${sector}`, `Marché public généré pour le secteur ${sector}.`, `Public tender generated for the ${sector} sector.`);
}

/** Sélection par index tournant (déterministe) : utile pour des tests reproductibles. */
export function pickTenderContent(sector: string, index: number): TenderContent {
  const list = TENDER_CONTENT[sector];
  if (!list || list.length === 0) return fallback(sector);
  return list[((index % list.length) + list.length) % list.length]!;
}

/** Sélection aléatoire (node:crypto, jamais Math.random) : utilisée par la génération automatique des marchés. */
export function randomTenderContent(sector: string): TenderContent {
  const list = TENDER_CONTENT[sector];
  if (!list || list.length === 0) return fallback(sector);
  return list[randomInt(list.length)]!;
}

/** Marché public qui englobe plusieurs domaines : toute entreprise de l'un d'eux peut candidater. */
export interface MultiTender {
  sectors: string[];
  content: TenderContent;
}

export const TENDER_MULTI: MultiTender[] = [
  { sectors: ['btp', 'architecture', 'electricite'], content: C('Construction d’une école publique clés en main', 'Turnkey public school construction', "Plans, gros œuvre et installation électrique d'une école publique de quartier.", 'Plans, structural works and electrical installation of a district public school.') },
  { sectors: ['sante', 'pharmacie', 'btp', 'electricite'], content: C('Réhabilitation d’un centre de santé communautaire', 'Refurbishment of a community health centre', 'Remettre en état un centre de santé : travaux, électricité, équipement médical et pharmacie.', 'Refurbish a health centre: works, electricity, medical equipment and pharmacy.') },
  { sectors: ['maquis', 'pagnes', 'couture', 'pret_a_porter', 'coiffure'], content: C('Organisation de la fête nationale d’un quartier', 'Organising a district national-day celebration', 'Restauration, tenues, pagnes officiels et coiffure pour la cérémonie du quartier.', 'Catering, outfits, official wax prints and hairdressing for the district ceremony.') },
  { sectors: ['transport', 'logistique', 'mecanique'], content: C('Mobilité d’une campagne de vaccination', 'Mobility for a vaccination campaign', 'Transport des équipes et des vaccins, et remise en état des véhicules utilisés.', 'Transport of teams and vaccines, and servicing of the vehicles used.') },
  { sectors: ['cyber', 'informatique', 'cybersecurite', 'data'], content: C('Mairie numérique de quartier', 'Digital district town hall', 'Numériser les registres, sécuriser le système et produire un tableau de bord pour la mairie.', 'Digitise registers, secure the system and build a dashboard for the town hall.') },
  { sectors: ['telecoms', 'informatique', 'electricite'], content: C('Connexion d’un marché couvert', 'Connecting a covered market', 'Installer l’électricité, les lignes téléphoniques et le réseau Internet d’un marché couvert.', 'Install electricity, phone lines and internet network for a covered market.') },
  { sectors: ['agronomie', 'environnement', 'logistique'], content: C('Filière locale de maraîchage', 'Local market-gardening chain', 'Soutenir la production, la collecte des déchets verts et l’acheminement vers les marchés.', 'Support production, green-waste collection and delivery to markets.') },
  { sectors: ['education', 'rh', 'journalisme'], content: C('Campagne de rentrée scolaire', 'Back-to-school campaign', 'Soutien scolaire, recrutement de moniteurs et communication auprès des familles.', 'Tutoring, recruiting monitors and communicating with families.') },
  { sectors: ['compta', 'droit', 'banque'], content: C('Appui à la création de coopératives', 'Support for setting up cooperatives', 'Comptabilité, conseil juridique et épargne pour des coopératives de quartier.', 'Accounting, legal advice and savings for district cooperatives.') },
  { sectors: ['hotellerie', 'maquis', 'transport'], content: C('Accueil d’un sommet régional', 'Hosting a regional summit', 'Hébergement, restauration et navettes pour les délégations d’un sommet.', 'Accommodation, catering and shuttles for summit delegations.') },
  { sectors: ['environnement', 'btp', 'sante'], content: C('Assainissement d’un quartier', 'District sanitation', 'Curage des caniveaux, petits travaux de voirie et sensibilisation sanitaire.', 'Clearing drains, small road works and sanitation awareness.') },
  { sectors: ['mecanique', 'electricite', 'btp'], content: C('Entretien du parc municipal', 'Municipal facilities upkeep', 'Entretenir les véhicules, l’éclairage et les bâtiments municipaux.', 'Maintain municipal vehicles, lighting and buildings.') },
  { sectors: ['journalisme', 'cyber', 'data'], content: C('Observatoire des services publics', 'Public services observatory', 'Collecter, analyser et publier des données sur la qualité des services d’un quartier.', 'Collect, analyse and publish data on service quality in a district.') },
  { sectors: ['pharmacie', 'sante', 'logistique'], content: C('Approvisionnement des centres de santé de la région', 'Supplying the region’s health centres', 'Médicaments, consultations mobiles et acheminement vers les centres isolés.', 'Medicines, mobile consultations and delivery to remote centres.') },
];

/** Marché multi-domaines tiré au hasard (node:crypto), dont les domaines sont tous connus des activités du jeu. */
export function randomMultiTender(knownSectors: string[]): MultiTender | null {
  const known = new Set(knownSectors);
  const list = TENDER_MULTI.map((m) => ({ ...m, sectors: m.sectors.filter((x) => known.has(x)) })).filter((m) => m.sectors.length >= 2);
  return list.length === 0 ? null : list[randomInt(list.length)]!;
}
