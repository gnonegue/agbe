// Cours par défaut (paramètre « school.courses », modifiable dans le back-office).
// Leçons fondées sur les chiffres du document de conception (SMIG, CNSS, AMU, TVA, CFE).
export interface Lesson {
  textFr: string;
  textEn: string;
  qFr: string;
  qEn: string;
  choicesFr: string[];
  choicesEn: string[];
  answer: number;
}
export interface Course {
  id: string;
  venueId: string;
  emoji: string;
  nameFr: string;
  nameEn: string;
  teacher: string;
  /** Heure de début (heure de jeu) et durée. */
  startHour: number;
  hours: number;
  fee: number;
  /** Métiers débloqués par le certificat. */
  unlocks: string[];
  lessons: Lesson[];
}

export const DEFAULT_COURSES: Course[] = [
  {
    id: 'compta',
    venueId: 'universite',
    emoji: '📊',
    nameFr: 'Certificat de comptabilité et de paie (cours du soir)',
    nameEn: 'Bookkeeping and payroll certificate (evening class)',
    teacher: 'M. Komlan Adjété',
    startHour: 18,
    hours: 2,
    fee: 15_000,
    unlocks: ['accountant'],
    lessons: [
      { textFr: 'Le SMIG est le salaire minimum : aucun salaire brut mensuel ne peut être plus bas. Au Togo, il est de 52 500 FCFA.', textEn: 'The SMIG is the minimum wage: no monthly gross salary may be lower. In Togo it is 52,500 FCFA.', qFr: 'Quel est le SMIG mensuel au Togo ?', qEn: 'What is the monthly minimum wage in Togo?', choicesFr: ['35 000 FCFA', '52 500 FCFA', '75 000 FCFA'], choicesEn: ['35,000 FCFA', '52,500 FCFA', '75,000 FCFA'], answer: 1 },
      { textFr: 'Sur la fiche de paie, la CNSS retient 4 % du salaire brut au salarié. L’employeur, lui, paie 17,5 % en plus.', textEn: 'On the payslip, the CNSS takes 4% of gross salary from the employee. The employer pays an extra 17.5%.', qFr: 'Quelle est la part salariale de la CNSS ?', qEn: 'What is the employee CNSS share?', choicesFr: ['4 %', '10 %', '17,5 %'], choicesEn: ['4%', '10%', '17.5%'], answer: 0 },
      { textFr: 'L’assurance maladie universelle (AMU) coûte 10 % du salaire dans le privé : 5 % payés par l’employeur, 5 % par le salarié.', textEn: 'Universal health insurance (AMU) costs 10% of salary in the private sector: 5% paid by the employer, 5% by the employee.', qFr: 'Combien coûte l’AMU au total pour un salarié du privé ?', qEn: 'What is the total AMU rate for a private-sector employee?', choicesFr: ['5 %', '10 %', '21,5 %'], choicesEn: ['5%', '10%', '21.5%'], answer: 1 },
      { textFr: 'La TVA est un impôt sur la consommation : 18 % au Togo. L’entreprise la collecte sur ses ventes et la reverse.', textEn: 'VAT is a consumption tax: 18% in Togo. Businesses collect it on sales and pay it over.', qFr: 'Quel est le taux de TVA au Togo ?', qEn: 'What is the VAT rate in Togo?', choicesFr: ['10 %', '18 %', '25 %'], choicesEn: ['10%', '18%', '25%'], answer: 1 },
      { textFr: 'Les impôts des entreprises et la retenue à la source sur les salaires sont déclarés et payés à l’Office Togolais des Recettes.', textEn: 'Company taxes and payroll withholding tax are filed and paid to the Togolese Revenue Office.', qFr: 'À qui déclare-t-on et paie-t-on ses impôts ?', qEn: 'Who do you file and pay taxes to?', choicesFr: ['La CNSS', 'L’OTR', 'Le CFE'], choicesEn: ['The CNSS', 'The OTR', 'The CFE'], answer: 1 },
      { textFr: 'Le coût total employeur = salaire brut + parts patronales CNSS et AMU. C’est ce que coûte vraiment un salarié.', textEn: 'Total employer cost = gross salary + employer CNSS and AMU shares. That is what an employee really costs.', qFr: 'Pour 100 000 FCFA brut, combien coûte le salarié à l’employeur (CNSS 17,5 % + AMU 5 %) ?', qEn: 'For 100,000 FCFA gross, what does the employee cost the employer (CNSS 17.5% + AMU 5%)?', choicesFr: ['100 000 FCFA', '117 500 FCFA', '122 500 FCFA'], choicesEn: ['100,000 FCFA', '117,500 FCFA', '122,500 FCFA'], answer: 2 },
    ],
  },
  {
    id: 'entreprendre',
    venueId: 'universite',
    emoji: '🚀',
    nameFr: 'Créer son entreprise au Togo (cours du soir)',
    nameEn: 'Starting a business in Togo (evening class)',
    teacher: 'Mme Afi Lawson',
    startHour: 19,
    hours: 2,
    fee: 8_000,
    unlocks: [],
    lessons: [
      { textFr: 'Le CFE est le guichet unique : on y dépose son dossier et on reçoit RCCM, NIF et carte d’opérateur économique.', textEn: 'The CFE is the one-stop shop: file there and receive your RCCM, tax number and trader card.', qFr: 'Où crée-t-on son entreprise ?', qEn: 'Where do you register a business?', choicesFr: ['Au CFE', 'À l’OTR', 'À la mairie'], choicesEn: ['At the CFE', 'At the OTR', 'At the town hall'], answer: 0 },
      { textFr: 'Pour une entreprise individuelle, les frais du CFE sont de 25 400 FCFA pour un national ou un ressortissant CEDEAO.', textEn: 'For a sole proprietorship, CFE fees are 25,400 FCFA for nationals and ECOWAS citizens.', qFr: 'Combien coûte le CFE pour une entreprise individuelle ?', qEn: 'How much is the CFE fee for a sole proprietorship?', choicesFr: ['25 400 FCFA', '28 250 FCFA', '33 250 FCFA'], choicesEn: ['25,400 FCFA', '28,250 FCFA', '33,250 FCFA'], answer: 0 },
      { textFr: 'Chaque salarié doit être immatriculé à la CNSS dans les 8 jours suivant son embauche. Sinon : amende.', textEn: 'Each employee must be registered with the CNSS within 8 days of hiring. Otherwise: a fine.', qFr: 'Quel est le délai pour immatriculer un salarié à la CNSS ?', qEn: 'What is the deadline to register an employee with the CNSS?', choicesFr: ['8 jours', '30 jours', '3 mois'], choicesEn: ['8 days', '30 days', '3 months'], answer: 0 },
      { textFr: 'Rester informel coûte moins cher au début, mais ferme la porte des banques, des marchés publics et des gros clients.', textEn: 'Staying informal is cheaper at first, but closes the door to banks, public contracts and big clients.', qFr: 'Que perd-on en restant dans l’informel ?', qEn: 'What do you lose by staying informal?', choicesFr: ['L’accès aux banques et aux marchés publics', 'Rien du tout', 'Le droit de vendre au marché'], choicesEn: ['Access to banks and public contracts', 'Nothing at all', 'The right to sell at the market'], answer: 0 },
    ],
  },
  {
    id: 'couture',
    venueId: 'marche_assigame',
    emoji: '🧵',
    nameFr: 'Apprentissage de la couture (chez un patron)',
    nameEn: 'Tailoring apprenticeship (with a master)',
    teacher: 'Maman Ablavi, couturière',
    startHour: 17,
    hours: 3,
    fee: 10_000,
    unlocks: ['tailor'],
    lessons: [
      { textFr: 'Une pièce complète de pagne wax mesure 6 yards ; on en vend souvent des demi-pièces de 3 yards.', textEn: 'A full piece of wax print is 6 yards; half pieces of 3 yards are often sold.', qFr: 'Combien mesure une pièce complète de wax ?', qEn: 'How long is a full piece of wax print?', choicesFr: ['2 yards', '6 yards', '12 yards'], choicesEn: ['2 yards', '6 yards', '12 yards'], answer: 1 },
      { textFr: 'Avant de couper, on lave le tissu : sinon le vêtement rétrécit au premier lavage chez le client.', textEn: 'Wash the fabric before cutting: otherwise the garment shrinks at the customer’s first wash.', qFr: 'Avant de couper le pagne, on…', qEn: 'Before cutting the fabric, you…', choicesFr: ['le lave', 'le coupe directement', 'le repasse seulement'], choicesEn: ['wash it', 'cut it straight away', 'only iron it'], answer: 0 },
      { textFr: 'Le tour de poitrine se prend à l’endroit le plus fort, ruban bien horizontal.', textEn: 'Chest size is measured at the fullest point, tape kept level.', qFr: 'Où se mesure le tour de poitrine ?', qEn: 'Where is chest size measured?', choicesFr: ['À l’endroit le plus fort', 'Sous les bras', 'À la taille'], choicesEn: ['At the fullest point', 'Under the arms', 'At the waist'], answer: 0 },
      { textFr: 'Un bon couturier note les mesures de chaque client dans un carnet : le client fidèle revient.', textEn: 'A good tailor writes each customer’s measurements in a notebook: loyal customers come back.', qFr: 'Pour un client fidèle, on…', qEn: 'For a loyal customer, you…', choicesFr: ['garde ses mesures dans un carnet', 'reprend tout à zéro', 'devine ses mesures'], choicesEn: ['keep their measurements in a notebook', 'start from scratch', 'guess their measurements'], answer: 0 },
    ],
  },
  {
    id: 'mecanique',
    venueId: 'station_zem',
    emoji: '🔧',
    nameFr: 'Apprentissage de la mécanique moto (chez un patron)',
    nameEn: 'Motorbike mechanics apprenticeship (with a master)',
    teacher: 'M. Kossi, mécanicien',
    startHour: 16,
    hours: 3,
    fee: 12000,
    unlocks: ['moto_mechanic'],
    lessons: [
      { textFr: 'La vidange d’une moto de 125 cm³ se fait tous les 1 000 à 1 500 km, avec une huile moteur 4 temps adaptée.', textEn: 'The oil change of a 125 cc motorbike is due every 1,000 to 1,500 km, with a suitable 4-stroke engine oil.', qFr: 'Tous les combien de km vidange-t-on une moto de 125 cm³ ?', qEn: 'How often (in km) do you change the oil of a 125 cc bike?', choicesFr: ['Tous les 1 000 à 1 500 km', 'Tous les 10 000 km', 'Jamais'], choicesEn: ['Every 1,000 to 1,500 km', 'Every 10,000 km', 'Never'], answer: 0 },
      { textFr: 'La chaîne doit avoir environ 2 cm de jeu et être graissée : trop tendue ou trop lâche, elle s’use et casse.', textEn: 'The chain needs about 2 cm of play and must be greased: too tight or too loose, it wears out and breaks.', qFr: 'Quel jeu laisse-t-on à la chaîne ?', qEn: 'How much play do you leave in the chain?', choicesFr: ['Environ 2 cm', 'Aucun', 'Plus de 10 cm'], choicesEn: ['About 2 cm', 'None', 'More than 10 cm'], answer: 0 },
      { textFr: 'Un filtre à air encrassé fait consommer plus d’essence et fatigue le moteur : on le nettoie ou on le remplace.', textEn: 'A clogged air filter burns more fuel and strains the engine: clean it or replace it.', qFr: 'Que fait un filtre à air encrassé ?', qEn: 'What does a clogged air filter do?', choicesFr: ['Il fait consommer plus', 'Il économise l’essence', 'Rien du tout'], choicesEn: ['It increases fuel consumption', 'It saves fuel', 'Nothing at all'], answer: 0 },
      { textFr: 'Des plaquettes de frein usées grincent : on les change avant d’abîmer le disque, c’est une question de sécurité.', textEn: 'Worn brake pads squeal: replace them before the disc is damaged, it is a safety matter.', qFr: 'Que fait-on quand les plaquettes grincent ?', qEn: 'What do you do when the brake pads squeal?', choicesFr: ['On les change', 'On roule quand même', 'On met plus d’huile'], choicesEn: ['Replace them', 'Keep riding anyway', 'Add more oil'], answer: 0 },
    ],
  },
  {
    id: 'hotellerie',
    venueId: 'hotel_2fevrier',
    emoji: '🛎️',
    nameFr: 'Formation en hôtellerie et service en salle',
    nameEn: 'Hospitality and table-service training',
    teacher: 'Mme Akouvi, chef de salle',
    startHour: 15,
    hours: 3,
    fee: 10000,
    unlocks: ['hotel_waiter'],
    lessons: [
      { textFr: 'On accueille chaque client avec un sourire et un « Bonjour » avant tout service : la première impression compte.', textEn: 'Greet every guest with a smile and a “Good day” before any service: first impressions count.', qFr: 'Que dit-on d’abord au client ?', qEn: 'What do you say to the guest first?', choicesFr: ['Bonjour, bienvenue', 'Qu’est-ce que vous voulez ?', 'Rien'], choicesEn: ['Hello, welcome', 'What do you want?', 'Nothing'], answer: 0 },
      { textFr: 'Avant de servir, on se lave les mains, on attache ses cheveux et on garde une tenue propre.', textEn: 'Before serving, wash your hands, tie back your hair and keep a clean uniform.', qFr: 'Avant de servir, on…', qEn: 'Before serving, you…', choicesFr: ['se lave les mains', 'mange en service', 'touche les verres par le haut'], choicesEn: ['wash your hands', 'eat while serving', 'touch the glasses from the top'], answer: 0 },
      { textFr: 'Face à une réclamation, on écoute sans interrompre, on s’excuse et on propose une solution.', textEn: 'Faced with a complaint, listen without interrupting, apologise and offer a solution.', qFr: 'Face à une réclamation, on…', qEn: 'Faced with a complaint, you…', choicesFr: ['écoute, s’excuse et propose une solution', 'discute devant les autres clients', 'ignore le client'], choicesEn: ['listen, apologise and offer a solution', 'argue in front of other guests', 'ignore the guest'], answer: 0 },
      { textFr: 'Les prix sont affichés et l’addition est vérifiée avec le client avant le paiement : pas de mauvaise surprise.', textEn: 'Prices are displayed and the bill is checked with the guest before payment: no nasty surprises.', qFr: 'Avant le paiement, on…', qEn: 'Before payment, you…', choicesFr: ['vérifie l’addition avec le client', 'ajoute des frais cachés', 'part sans la remettre'], choicesEn: ['check the bill with the guest', 'add hidden fees', 'leave without handing it over'], answer: 0 },
    ],
  },
  {
    id: 'coiffure',
    venueId: 'marche_assigame',
    emoji: '💈',
    nameFr: 'Apprentissage de la coiffure et du barbier',
    nameEn: 'Hairdressing and barbering apprenticeship',
    teacher: 'Papa Edem, barbier',
    startHour: 17,
    hours: 2,
    fee: 8000,
    unlocks: ['barber'],
    lessons: [
      { textFr: 'Les outils (ciseaux, tondeuse, peignes) se désinfectent entre chaque client pour éviter la transmission d’infections.', textEn: 'Tools (scissors, clippers, combs) are disinfected between customers to prevent infections.', qFr: 'Quand désinfecte-t-on les outils ?', qEn: 'When do you disinfect the tools?', choicesFr: ['Entre chaque client', 'Jamais', 'Une fois par mois'], choicesEn: ['Between every customer', 'Never', 'Once a month'], answer: 0 },
      { textFr: 'On tond du bas vers le haut avec un sabot adapté, puis on égalise aux ciseaux : la dégradation se fait progressivement.', textEn: 'Clip from the bottom up with a suitable guard, then even out with scissors: fading is done gradually.', qFr: 'Dans quel sens tond-on ?', qEn: 'Which direction do you clip?', choicesFr: ['Du bas vers le haut', 'Au hasard', 'Du haut vers le bas uniquement'], choicesEn: ['From the bottom up', 'At random', 'Only top to bottom'], answer: 0 },
      { textFr: 'Une coiffure en tresses prend 3 à 6 heures : on prévient le client de la durée et on fixe le prix selon la longueur.', textEn: 'Braids take 3 to 6 hours: tell the customer how long and set the price by length.', qFr: 'Que dit-on au client pour des tresses ?', qEn: 'What do you tell the customer about braids?', choicesFr: ['La durée et le prix', 'Rien', 'Que c’est instantané'], choicesEn: ['The duration and the price', 'Nothing', 'That it is instant'], answer: 0 },
      { textFr: 'Un bon barbier affiche ses prix et note les préférences de ses clients : le client fidèle revient.', textEn: 'A good barber displays prices and notes customers’ preferences: loyal customers come back.', qFr: 'Pour fidéliser un client, on…', qEn: 'To keep a customer loyal, you…', choicesFr: ['note ses préférences', 'change de coupe sans demander', 'cache les prix'], choicesEn: ['note their preferences', 'change the cut without asking', 'hide the prices'], answer: 0 },
    ],
  },
  {
    id: 'permis',
    venueId: 'station_zem',
    emoji: '🪪',
    nameFr: 'Auto-école : code de la route et conduite',
    nameEn: 'Driving school: highway code and driving',
    teacher: 'M. Yao, moniteur',
    startHour: 9,
    hours: 2,
    fee: 25000,
    unlocks: ['cargo_rider'],
    lessons: [
      { textFr: 'À moto, le casque est obligatoire pour le conducteur et le passager : il sauve des vies.', textEn: 'On a motorbike, the helmet is compulsory for rider and passenger: it saves lives.', qFr: 'À moto, le casque est…', qEn: 'On a motorbike, the helmet is…', choicesFr: ['obligatoire', 'facultatif', 'réservé aux débutants'], choicesEn: ['compulsory', 'optional', 'only for beginners'], answer: 0 },
      { textFr: 'Un feu rouge impose l’arrêt complet avant la ligne ; l’orange annonce le rouge, on ralentit.', textEn: 'A red light means a full stop before the line; amber announces red, so slow down.', qFr: 'Au feu rouge, on…', qEn: 'At a red light, you…', choicesFr: ['s’arrête avant la ligne', 'passe vite', 'klaxonne et passe'], choicesEn: ['stop before the line', 'rush through', 'honk and go'], answer: 0 },
      { textFr: 'On ne conduit jamais après avoir bu de l’alcool : les réflexes diminuent et le risque d’accident explose.', textEn: 'Never drive after drinking alcohol: reflexes drop and accident risk soars.', qFr: 'Après avoir bu, on…', qEn: 'After drinking, you…', choicesFr: ['ne conduit pas', 'conduit lentement', 'conduit mieux'], choicesEn: ['do not drive', 'drive slowly', 'drive better'], answer: 0 },
      { textFr: 'Au Togo on roule à droite ; en voiture, la ceinture est obligatoire et l’on garde ses distances.', textEn: 'In Togo traffic drives on the right; in a car the seat belt is compulsory and you keep your distance.', qFr: 'De quel côté roule-t-on au Togo ?', qEn: 'Which side of the road do you drive on in Togo?', choicesFr: ['À droite', 'À gauche', 'Au milieu'], choicesEn: ['On the right', 'On the left', 'In the middle'], answer: 0 },
    ],
  },
];
