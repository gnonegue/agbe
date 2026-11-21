// Études supérieures : domaines et leçons par défaut (paramètre « study », modifiable dans le back-office).
import type { Lesson } from '../school/courses';

export interface Domain {
  id: string;
  emoji: string;
  nameFr: string;
  nameEn: string;
  lessons: Lesson[];
}

const L = (textFr: string, textEn: string, qFr: string, qEn: string, choicesFr: string[], choicesEn: string[], answer: number): Lesson => ({ textFr, textEn, qFr, qEn, choicesFr, choicesEn, answer });

export const DEFAULT_DOMAINS: Domain[] = [
  {
    id: 'informatique',
    emoji: '💻',
    nameFr: 'Informatique et développement',
    nameEn: 'Computing and software development',
    lessons: [
      L('Un site web se construit avec HTML pour la structure, CSS pour l’apparence et JavaScript pour le comportement.', 'A website is built with HTML for structure, CSS for looks and JavaScript for behaviour.', 'Quel langage donne l’apparence (couleurs, mise en page) ?', 'Which language handles looks (colours, layout)?', ['HTML', 'CSS', 'SQL'], ['HTML', 'CSS', 'SQL'], 1),
      L('Une base de données range les informations en tables ; SQL sert à les lire et à les modifier, par exemple avec SELECT.', 'A database stores information in tables; SQL reads and edits it, for example with SELECT.', 'Quelle commande SQL lit des données ?', 'Which SQL command reads data?', ['SELECT', 'PRINT', 'OPEN'], ['SELECT', 'PRINT', 'OPEN'], 0),
      L('Git garde l’historique du code : chaque « commit » est une version qu’on peut retrouver, et plusieurs développeurs peuvent travailler ensemble.', 'Git keeps the history of the code: each commit is a version you can get back, and several developers can work together.', 'À quoi sert un commit ?', 'What is a commit for?', ['À supprimer le code', 'À enregistrer une version du code', 'À envoyer un SMS'], ['To delete the code', 'To save a version of the code', 'To send an SMS'], 1),
    ],
  },
  {
    id: 'compta',
    emoji: '📊',
    nameFr: 'Comptabilité et gestion',
    nameEn: 'Accounting and management',
    lessons: [
      L('La comptabilité fonctionne en partie double : chaque opération est inscrite au débit d’un compte et au crédit d’un autre, pour le même montant.', 'Accounting uses double entry: each operation is recorded as a debit in one account and a credit in another, for the same amount.', 'Dans la partie double, le total des débits est…', 'In double entry, total debits are…', ['plus grand que les crédits', 'égal au total des crédits', 'toujours nul'], ['greater than credits', 'equal to total credits', 'always zero'], 1),
      L('Le bilan est la photo du patrimoine : l’actif (ce que l’entreprise possède) et le passif (ce qu’elle doit et ses capitaux).', 'The balance sheet is a snapshot of wealth: assets (what the company owns) and liabilities (what it owes, plus equity).', 'Que contient l’actif ?', 'What do assets contain?', ['Ce que l’entreprise possède', 'Ses dettes seulement', 'Ses salariés'], ['What the company owns', 'Its debts only', 'Its employees'], 0),
      L('En zone UEMOA, la TVA togolaise est de 18 % : l’entreprise la collecte et la reverse à l’Office Togolais des Recettes.', 'In the UEMOA zone, Togolese VAT is 18%: the company collects it and pays it to the Office Togolais des Recettes.', 'Quel est le taux de TVA au Togo ?', 'What is the VAT rate in Togo?', ['8 %', '18 %', '28 %'], ['8%', '18%', '28%'], 1),
    ],
  },
  {
    id: 'journalisme',
    emoji: '📰',
    nameFr: 'Journalisme et communication',
    nameEn: 'Journalism and communication',
    lessons: [
      L('Une information complète répond à cinq questions : qui, quoi, où, quand et pourquoi.', 'A complete story answers five questions: who, what, where, when and why.', 'Laquelle de ces questions fait partie des cinq ?', 'Which of these questions is one of the five?', ['Combien de likes ?', 'Où est-ce arrivé ?', 'Qui a payé ?'], ['How many likes?', 'Where did it happen?', 'Who paid?'], 1),
      L('Avant de publier, on vérifie : deux sources indépendantes valent mieux qu’une rumeur partagée sur les réseaux.', 'Before publishing, you check: two independent sources beat a rumour shared on social media.', 'Que faire d’une information vue une seule fois sur les réseaux ?', 'What to do with a story seen only once on social media?', ['La publier vite', 'La vérifier auprès de sources', 'L’ignorer toujours'], ['Publish it fast', 'Check it with sources', 'Always ignore it'], 1),
      L('L’article suit la pyramide inversée : l’essentiel en premier, les détails ensuite, pour que le lecteur pressé comprenne tout de suite.', 'An article follows the inverted pyramid: the key point first, details after, so a hurried reader gets it at once.', 'Que met-on au début d’un article ?', 'What goes at the start of an article?', ['Les détails', 'L’essentiel', 'Les remerciements'], ['The details', 'The key point', 'The thanks'], 1),
    ],
  },
  {
    id: 'commerce',
    emoji: '🤝',
    nameFr: 'Commerce et vente',
    nameEn: 'Sales and trade',
    lessons: [
      L('La marge est la différence entre le prix de vente et le coût d’achat : c’est elle qui paie le loyer, le transport et le salaire.', 'Margin is the difference between selling price and purchase cost: it pays rent, transport and wages.', 'Un article acheté 600 et vendu 800 donne une marge de…', 'An item bought at 600 and sold at 800 gives a margin of…', ['200', '600', '1 400'], ['200', '600', '1,400'], 0),
      L('Un client satisfait revient et en amène d’autres : on l’accueille, on l’écoute, on propose, puis on le suit après la vente.', 'A happy customer comes back and brings others: welcome, listen, offer, then follow up after the sale.', 'Quelle est la première étape d’une vente ?', 'What is the first step of a sale?', ['Accueillir et écouter le client', 'Baisser le prix', 'Fermer la boutique'], ['Welcome and listen to the customer', 'Lower the price', 'Close the shop'], 0),
      L('Le mobile money (Flooz, T-Money) permet d’encaisser sans monnaie : c’est un moyen de paiement très utilisé au Togo.', 'Mobile money (Flooz, T-Money) lets you get paid without change: a widely used payment method in Togo.', 'Quel avantage a le mobile money pour un vendeur ?', 'What is the advantage of mobile money for a seller?', ['Pas besoin de rendre la monnaie', 'Il n’y a jamais de frais', 'Il remplace le stock'], ['No change to give back', 'There are never any fees', 'It replaces stock'], 0),
    ],
  },
  {
    id: 'btp',
    emoji: '🏗️',
    nameFr: 'BTP et génie civil',
    nameEn: 'Construction and civil engineering',
    lessons: [
      L('Le béton se fait avec du ciment, du sable, du gravier et de l’eau ; trop d’eau le rend fragile.', 'Concrete is made of cement, sand, gravel and water; too much water makes it weak.', 'Quel ingrédient en excès affaiblit le béton ?', 'Which ingredient in excess weakens concrete?', ['L’eau', 'Le gravier', 'Le ciment'], ['Water', 'Gravel', 'Cement'], 0),
      L('On construit toujours de bas en haut : fondations d’abord, puis poteaux et murs, puis toiture.', 'You always build from the bottom up: foundations first, then columns and walls, then the roof.', 'Que construit-on en premier ?', 'What do you build first?', ['La toiture', 'Les fondations', 'La peinture'], ['The roof', 'The foundations', 'The paint'], 1),
      L('Sur un chantier, le casque, les chaussures de sécurité et les gants ne sont pas facultatifs : un accident coûte une vie et des semaines.', 'On a site, helmet, safety shoes and gloves are not optional: an accident costs a life and weeks.', 'Quel équipement protège la tête ?', 'Which equipment protects the head?', ['Les gants', 'Le casque', 'Les bottes'], ['Gloves', 'The helmet', 'Boots'], 1),
    ],
  },
  {
    id: 'electricite',
    emoji: '⚡',
    nameFr: 'Électricité et énergie',
    nameEn: 'Electricity and energy',
    lessons: [
      L('La loi d’Ohm relie tension, courant et résistance : U = R × I.', 'Ohm’s law links voltage, current and resistance: U = R × I.', 'Avec R = 10 Ω et I = 2 A, la tension U vaut…', 'With R = 10 Ω and I = 2 A, the voltage U is…', ['5 V', '12 V', '20 V'], ['5 V', '12 V', '20 V'], 2),
      L('Le disjoncteur coupe le courant en cas de surcharge ou de court-circuit : il protège l’installation et les personnes.', 'The circuit breaker cuts power on overload or short-circuit: it protects the installation and people.', 'Quel est le rôle du disjoncteur ?', 'What is the breaker’s role?', ['Augmenter la tension', 'Couper en cas de surcharge', 'Chauffer les fils'], ['Raise voltage', 'Cut off on overload', 'Heat the wires'], 1),
      L('La prise de terre évacue les courants de fuite : sans elle, une carcasse métallique peut devenir dangereuse.', 'Earthing carries away leakage currents: without it, a metal casing can become dangerous.', 'À quoi sert la prise de terre ?', 'What is earthing for?', ['À évacuer les fuites de courant', 'À éclairer', 'À réduire la facture'], ['To carry away current leaks', 'To light up', 'To cut the bill'], 0),
    ],
  },
  {
    id: 'stylisme',
    emoji: '🧵',
    nameFr: 'Stylisme et modélisme',
    nameEn: 'Fashion design and pattern making',
    lessons: [
      L('Un bon vêtement commence par de bonnes mesures : tour de poitrine, de taille, de hanches et longueur.', 'A good garment starts with good measurements: bust, waist, hips and length.', 'Que prend-on avant de couper ?', 'What do you take before cutting?', ['Les mesures du client', 'Le prix du tissu seulement', 'Une photo de la boutique'], ['The customer’s measurements', 'Only the fabric price', 'A photo of the shop'], 0),
      L('Le patron est le modèle en papier qui sert à découper le tissu ; on le trace avant de couper.', 'The pattern is the paper model used to cut the fabric; you draw it before cutting.', 'À quoi sert le patron ?', 'What is the pattern for?', ['À découper le tissu avec précision', 'À repasser', 'À vendre le pagne'], ['To cut the fabric precisely', 'To iron', 'To sell the wax print'], 0),
      L('Le pagne wax se vend en pièces de 6 yards ; avec un motif à raccorder, on prévoit un peu plus de tissu.', 'Wax print is sold in 6-yard pieces; with a motif to match, plan a little more fabric.', 'Combien de yards compte une pièce entière de pagne ?', 'How many yards in a full piece of wax print?', ['3', '6', '12'], ['3', '6', '12'], 1),
    ],
  },
  {
    id: 'coiffure',
    emoji: '💇',
    nameFr: 'Coiffure et esthétique',
    nameEn: 'Hairdressing and beauty',
    lessons: [
      L('L’hygiène d’abord : on désinfecte peignes, ciseaux et tondeuses entre deux clients pour éviter les infections.', 'Hygiene first: disinfect combs, scissors and clippers between clients to avoid infections.', 'Que fait-on entre deux clients ?', 'What do you do between two clients?', ['On désinfecte le matériel', 'On range sans nettoyer', 'On change le prix'], ['Disinfect the tools', 'Put away without cleaning', 'Change the price'], 0),
      L('Avant une tresse ou une coupe, on observe le cheveu et le cuir chevelu : sec, gras, fragile ? Le soin dépend du diagnostic.', 'Before braiding or cutting, look at the hair and scalp: dry, oily, fragile? Care depends on the diagnosis.', 'Que fait-on avant de choisir un soin ?', 'What do you do before choosing a treatment?', ['Un diagnostic du cheveu', 'Rien', 'Un shampoing de 2 heures'], ['A hair diagnosis', 'Nothing', 'A 2-hour shampoo'], 0),
      L('Un salon vit de ses clientes fidèles : bien accueillir, respecter l’heure du rendez-vous et soigner le résultat.', 'A salon lives on loyal clients: welcome well, respect appointment times and take care of the result.', 'Qu’est-ce qui fidélise une cliente ?', 'What keeps a client loyal?', ['Un bon accueil et un bon résultat', 'Des retards', 'Un salon sale'], ['A good welcome and a good result', 'Delays', 'A dirty salon'], 0),
    ],
  },
  {
    id: 'sante',
    emoji: '🩺',
    nameFr: 'Sciences infirmières et médecine',
    nameEn: 'Nursing and medicine',
    lessons: [
      L('Le paludisme est transmis par la piqûre du moustique anophèle femelle. Dormir sous une moustiquaire imprégnée protège la nuit.', 'Malaria is spread by the bite of the female anopheles mosquito. Sleeping under a treated net protects at night.', 'Quel insecte transmet le paludisme ?', 'Which insect spreads malaria?', ['La mouche', 'Le moustique anophèle', 'La fourmi'], ['The fly', 'The anopheles mosquito', 'The ant'], 1),
      L('La température normale du corps est d’environ 37 °C. Au-dessus de 38 °C, on parle de fièvre.', 'Normal body temperature is about 37 °C. Above 38 °C it is a fever.', 'Quelle est la température normale du corps ?', 'What is normal body temperature?', ['35 °C', '37 °C', '40 °C'], ['35 °C', '37 °C', '40 °C'], 1),
      L('Se laver les mains au savon avant chaque soin évite de transmettre les microbes d’un malade à l’autre.', 'Washing hands with soap before each treatment avoids passing germs from one patient to another.', 'Pourquoi se laver les mains avant un soin ?', 'Why wash hands before a treatment?', ['Pour éviter les infections', 'Pour aller plus vite', 'Ça ne sert à rien'], ['To avoid infections', 'To go faster', 'It is useless'], 0),
    ],
  },
  {
    id: 'pharmacie',
    emoji: '💊',
    nameFr: 'Pharmacie',
    nameEn: 'Pharmacy',
    lessons: [
      L('Un antibiotique agit contre les bactéries ; il ne soigne pas les maladies dues à un virus, comme la grippe.', 'An antibiotic works against bacteria; it does not cure illnesses caused by a virus, such as flu.', 'Contre quoi agit un antibiotique ?', 'What does an antibiotic work against?', ['Les virus', 'Les bactéries', 'La fatigue'], ['Viruses', 'Bacteria', 'Tiredness'], 1),
      L('La posologie, c’est la dose et le rythme de prise prescrits : par exemple un comprimé matin et soir pendant cinq jours.', 'The dosage is the prescribed amount and rhythm: for example one tablet morning and evening for five days.', 'Que désigne la posologie ?', 'What does dosage mean?', ['Le prix du médicament', 'La dose et le rythme de prise', 'La date de fabrication'], ['The price of the drug', 'The amount and rhythm of intake', 'The manufacturing date'], 1),
      L('Les médicaments vendus au bord de la route sont souvent faux ou mal conservés : on les achète en pharmacie agréée.', 'Drugs sold by the roadside are often fake or badly stored: buy them in a licensed pharmacy.', 'Où acheter un médicament sûr ?', 'Where should you buy a safe drug?', ['Au bord de la route', 'Au marché', 'En pharmacie agréée'], ['By the roadside', 'At the market', 'In a licensed pharmacy'], 2),
    ],
  },
  {
    id: 'droit',
    emoji: '⚖️',
    nameFr: 'Droit et sciences juridiques',
    nameEn: 'Law',
    lessons: [
      L('La Constitution est la règle la plus haute du pays : les lois, décrets et arrêtés doivent la respecter.', 'The Constitution is the highest rule of the country: laws, decrees and orders must respect it.', 'Quelle est la norme la plus haute ?', 'What is the highest rule?', ['Un arrêté', 'La Constitution', 'Un règlement intérieur'], ['An order', 'The Constitution', 'Internal rules'], 1),
      L('L’OHADA harmonise le droit des affaires dans dix-sept pays africains, dont le Togo : sociétés, contrats, recouvrement.', 'OHADA harmonises business law in seventeen African countries, including Togo: companies, contracts, debt recovery.', 'Que harmonise l’OHADA ?', 'What does OHADA harmonise?', ['Le droit des affaires', 'Le code de la route', 'Les programmes scolaires'], ['Business law', 'The highway code', 'School curricula'], 0),
      L('Un contrat oblige les parties qui l’ont accepté librement ; un tiers n’est pas engagé par un contrat qu’il n’a pas signé.', 'A contract binds the parties who freely accepted it; a third party is not bound by a contract it did not sign.', 'Qui est engagé par un contrat ?', 'Who is bound by a contract?', ['Tout le quartier', 'L’État seulement', 'Les parties qui l’ont accepté'], ['The whole neighbourhood', 'Only the State', 'The parties who accepted it'], 2),
    ],
  },
  {
    id: 'education',
    emoji: '📚',
    nameFr: 'Sciences de l’éducation',
    nameEn: 'Education',
    lessons: [
      L('Au Togo, l’école primaire dure six ans (du CP1 au CM2), puis le collège quatre ans et le lycée trois ans.', 'In Togo, primary school lasts six years (CP1 to CM2), then four years of lower secondary and three of upper secondary.', 'Combien d’années dure le primaire ?', 'How many years does primary school last?', ['Quatre', 'Six', 'Huit'], ['Four', 'Six', 'Eight'], 1),
      L('Une leçon se prépare à partir d’un objectif clair : ce que l’élève saura faire à la fin. Le déroulement et l’évaluation en découlent.', 'A lesson is planned from a clear objective: what the pupil will be able to do at the end. Steps and assessment follow from it.', 'Par quoi commence la préparation d’une leçon ?', 'What does lesson planning start with?', ['L’objectif', 'La note', 'La récréation'], ['The objective', 'The mark', 'Break time'], 0),
      L('L’évaluation formative a lieu pendant l’apprentissage pour aider l’élève à progresser ; la sommative fait le bilan à la fin.', 'Formative assessment happens during learning to help the pupil improve; summative assessment sums up at the end.', 'Quand a lieu l’évaluation formative ?', 'When does formative assessment happen?', ['Après les vacances', 'Pendant l’apprentissage', 'Jamais'], ['After the holidays', 'During learning', 'Never'], 1),
    ],
  },
  {
    id: 'agronomie',
    emoji: '🌱',
    nameFr: 'Agronomie et agriculture',
    nameEn: 'Agronomy and farming',
    lessons: [
      L('Alterner le maïs avec une légumineuse comme le niébé ou l’arachide enrichit le sol en azote : c’est la rotation des cultures.', 'Alternating maize with a legume such as cowpea or groundnut enriches the soil in nitrogen: this is crop rotation.', 'Quelle culture enrichit le sol en azote ?', 'Which crop enriches the soil in nitrogen?', ['Le maïs', 'Le manioc', 'Le niébé'], ['Maize', 'Cassava', 'Cowpea'], 2),
      L('Le coton, le café et le cacao sont des cultures d’exportation du Togo ; le maïs, le manioc et l’igname nourrissent le pays.', 'Cotton, coffee and cocoa are Togo’s export crops; maize, cassava and yam feed the country.', 'Laquelle est une culture d’exportation du Togo ?', 'Which is one of Togo’s export crops?', ['Le coton', 'Le blé', 'La pomme'], ['Cotton', 'Wheat', 'Apples'], 0),
      L('Le compost, fait de déchets végétaux et de fumier décomposés, est un engrais naturel qui garde l’eau dans le sol.', 'Compost, made of decomposed plant waste and manure, is a natural fertiliser that keeps water in the soil.', 'Qu’est-ce que le compost ?', 'What is compost?', ['Un pesticide', 'Un engrais naturel', 'Une semence'], ['A pesticide', 'A natural fertiliser', 'A seed'], 1),
    ],
  },
  {
    id: 'hotellerie',
    emoji: '🛎️',
    nameFr: 'Hôtellerie, restauration et tourisme',
    nameEn: 'Hospitality and tourism',
    lessons: [
      L('À la réception, le check-in est l’enregistrement du client à son arrivée, le check-out son départ et le règlement de la note.', 'At reception, check-in is the guest’s registration on arrival, check-out is leaving and settling the bill.', 'Comment s’appelle l’enregistrement à l’arrivée ?', 'What is registration on arrival called?', ['Le check-in', 'Le check-out', 'Le room service'], ['Check-in', 'Check-out', 'Room service'], 0),
      L('En cuisine, les produits frais se gardent au réfrigérateur en dessous de 4 °C : c’est la chaîne du froid.', 'In the kitchen, fresh products are kept in the fridge below 4 °C: this is the cold chain.', 'À quelle température garder les produits frais ?', 'At what temperature should fresh products be kept?', ['Vers 25 °C', 'Vers 15 °C', 'En dessous de 4 °C'], ['Around 25 °C', 'Around 15 °C', 'Below 4 °C'], 2),
      L('Le Koutammakou, pays des Batammariba et de leurs maisons-tours, est inscrit au patrimoine mondial de l’UNESCO depuis 2004.', 'Koutammakou, land of the Batammariba and their tower houses, has been a UNESCO World Heritage site since 2004.', 'Quel site togolais est au patrimoine mondial ?', 'Which Togolese site is World Heritage?', ['Le Koutammakou', 'Le Grand Marché', 'Le port de Lomé'], ['Koutammakou', 'The Grand Market', 'Lomé port'], 0),
    ],
  },
  {
    id: 'logistique',
    emoji: '🚚',
    nameFr: 'Transport et logistique',
    nameEn: 'Transport and logistics',
    lessons: [
      L('Le port en eau profonde de Lomé sert de porte d’entrée aux pays sans accès à la mer : Burkina Faso, Niger, Mali.', 'Lomé’s deep-water port is a gateway for landlocked countries: Burkina Faso, Niger, Mali.', 'Pour quels pays le port de Lomé est-il une porte d’entrée ?', 'For which countries is Lomé port a gateway?', ['La France et l’Espagne', 'Le Burkina, le Niger et le Mali', 'Le Brésil'], ['France and Spain', 'Burkina, Niger and Mali', 'Brazil'], 1),
      L('Avec l’incoterm FOB, le vendeur charge la marchandise à bord du navire ; ensuite, les risques passent à l’acheteur.', 'With the FOB incoterm, the seller loads the goods on board the ship; after that, the risks pass to the buyer.', 'En FOB, qui porte les risques après le chargement ?', 'Under FOB, who bears the risks after loading?', ['Le vendeur', 'L’acheteur', 'La douane'], ['The seller', 'The buyer', 'Customs'], 1),
      L('En entrepôt, la règle FIFO fait sortir d’abord ce qui est entré en premier, pour éviter les produits périmés.', 'In a warehouse, the FIFO rule ships first what came in first, to avoid expired products.', 'Que veut dire FIFO ?', 'What does FIFO mean?', ['Premier entré, premier sorti', 'Dernier entré, premier sorti', 'Au hasard'], ['First in, first out', 'Last in, first out', 'At random'], 0),
    ],
  },
  {
    id: 'mecanique',
    emoji: '🔧',
    nameFr: 'Mécanique et maintenance',
    nameEn: 'Mechanics and maintenance',
    lessons: [
      L('Un moteur à quatre temps enchaîne admission, compression, combustion-détente et échappement.', 'A four-stroke engine goes through intake, compression, combustion-expansion and exhaust.', 'Combien de temps compte ce moteur ?', 'How many strokes does this engine have?', ['Deux', 'Quatre', 'Six'], ['Two', 'Four', 'Six'], 1),
      L('L’huile moteur lubrifie les pièces en mouvement et réduit leur usure : la vidange se fait à intervalles réguliers.', 'Engine oil lubricates moving parts and reduces wear: oil changes are done at regular intervals.', 'À quoi sert l’huile moteur ?', 'What is engine oil for?', ['Gonfler les pneus', 'Lubrifier et réduire l’usure', 'Nettoyer les vitres'], ['Inflating tyres', 'Lubricating and reducing wear', 'Cleaning windows'], 1),
      L('La maintenance préventive entretient une machine avant la panne ; la corrective la répare après.', 'Preventive maintenance services a machine before it breaks down; corrective maintenance repairs it afterwards.', 'Comment appelle-t-on l’entretien fait avant la panne ?', 'What is servicing before a breakdown called?', ['Corrective', 'Préventive', 'Décorative'], ['Corrective', 'Preventive', 'Decorative'], 1),
    ],
  },
  {
    id: 'telecoms',
    emoji: '📡',
    nameFr: 'Télécommunications et réseaux',
    nameEn: 'Telecoms and networks',
    lessons: [
      L('Une adresse IP identifie un appareil sur un réseau, comme une adresse postale identifie une maison.', 'An IP address identifies a device on a network, as a postal address identifies a house.', 'Qu’identifie une adresse IP ?', 'What does an IP address identify?', ['Un mot de passe', 'Un appareil sur le réseau', 'Une couleur d’écran'], ['A password', 'A device on the network', 'A screen colour'], 1),
      L('La fibre optique transporte l’information sous forme de lumière, très vite et sur de longues distances.', 'Optical fibre carries information as light, very fast and over long distances.', 'Sous quelle forme la fibre transporte-t-elle l’information ?', 'In what form does fibre carry information?', ['De la lumière', 'De l’eau', 'Du son'], ['Light', 'Water', 'Sound'], 0),
      L('2G, 3G, 4G et 5G désignent les générations de réseaux mobiles : chaque génération offre plus de débit.', '2G, 3G, 4G and 5G name the generations of mobile networks: each one offers more speed.', 'Que désigne la 4G ?', 'What does 4G mean?', ['Une marque de téléphone', 'Un type de batterie', 'Une génération de réseau mobile'], ['A phone brand', 'A battery type', 'A generation of mobile network'], 2),
    ],
  },
  {
    id: 'rh',
    emoji: '🗂️',
    nameFr: 'Ressources humaines et administration',
    nameEn: 'Human resources and administration',
    lessons: [
      L('Un CDI est un contrat à durée indéterminée ; un CDD est conclu pour une durée déterminée ou une mission précise.', 'A CDI is a permanent contract; a CDD is signed for a fixed term or a specific assignment.', 'Qu’est-ce qu’un CDD ?', 'What is a CDD?', ['Un contrat à durée déterminée', 'Un contrat sans fin', 'Un stage non payé'], ['A fixed-term contract', 'An endless contract', 'An unpaid internship'], 0),
      L('Au Togo, les cotisations sociales des salariés (retraite, risques professionnels, famille) sont versées à la CNSS.', 'In Togo, employees’ social contributions (pension, work risks, family) are paid to the CNSS.', 'À quel organisme vont les cotisations sociales ?', 'Which body receives social contributions?', ['La CEET', 'La CNSS', 'La TdE'], ['CEET', 'CNSS', 'TdE'], 1),
      L('La période d’essai permet à l’employeur et au salarié de vérifier que le poste convient avant l’engagement définitif.', 'The trial period lets employer and employee check that the job suits before the final commitment.', 'À quoi sert la période d’essai ?', 'What is the trial period for?', ['À prendre des congés', 'À toucher une prime', 'À vérifier que le poste convient'], ['Taking leave', 'Getting a bonus', 'Checking the job suits'], 2),
    ],
  },
  {
    id: 'banque',
    emoji: '🏦',
    nameFr: 'Banque et assurance',
    nameEn: 'Banking and insurance',
    lessons: [
      L('La BCEAO émet le franc CFA pour les huit pays de l’UEMOA et fixe la politique monétaire de la zone.', 'The BCEAO issues the CFA franc for the eight WAEMU countries and sets the zone’s monetary policy.', 'Qui émet le franc CFA en Afrique de l’Ouest ?', 'Who issues the CFA franc in West Africa?', ['La BCEAO', 'La BOAD', 'Une banque commerciale'], ['The BCEAO', 'The BOAD', 'A commercial bank'], 0),
      L('L’intérêt est le prix de l’argent prêté : 100 000 FCFA placés un an à 5 % rapportent 5 000 FCFA.', 'Interest is the price of lent money: 100,000 FCFA saved for one year at 5% earns 5,000 FCFA.', 'Combien rapportent 100 000 FCFA à 5 % sur un an ?', 'How much do 100,000 FCFA earn at 5% over a year?', ['500 FCFA', '5 000 FCFA', '50 000 FCFA'], ['500 FCFA', '5,000 FCFA', '50,000 FCFA'], 1),
      L('L’assuré paie une prime ; en cas de sinistre (accident, incendie), l’assureur l’indemnise selon le contrat.', 'The insured pays a premium; in case of a claim (accident, fire), the insurer compensates according to the contract.', 'Comment s’appelle la somme payée par l’assuré ?', 'What is the sum paid by the insured called?', ['Le sinistre', 'L’indemnité', 'La prime'], ['The claim', 'The compensation', 'The premium'], 2),
    ],
  },
  {
    id: 'architecture',
    emoji: '📐',
    nameFr: 'Architecture et urbanisme',
    nameEn: 'Architecture and urban planning',
    lessons: [
      L('Sur un plan à l’échelle 1/100, un centimètre représente un mètre réel.', 'On a 1:100 scale drawing, one centimetre stands for one real metre.', 'Que représentent 5 cm sur un plan au 1/100 ?', 'What do 5 cm on a 1:100 drawing stand for?', ['5 m', '50 cm', '50 m'], ['5 m', '50 cm', '50 m'], 0),
      L('En climat chaud, des ouvertures face à face font circuler l’air : la ventilation traversante rafraîchit sans climatiseur.', 'In a hot climate, facing openings let air flow: cross-ventilation cools without air conditioning.', 'Comment rafraîchir une maison sans climatiseur ?', 'How do you cool a house without air conditioning?', ['Des murs sans fenêtres', 'La ventilation traversante', 'Un toit noir'], ['Walls without windows', 'Cross-ventilation', 'A black roof'], 1),
      L('Avant de bâtir, on obtient un permis de construire auprès de la mairie, qui vérifie le respect des règles d’urbanisme.', 'Before building, you get a building permit from the town hall, which checks the planning rules are respected.', 'Quel document faut-il avant de bâtir ?', 'Which document do you need before building?', ['Une carte grise', 'Un passeport', 'Un permis de construire'], ['A vehicle registration', 'A passport', 'A building permit'], 2),
    ],
  },
  {
    id: 'environnement',
    emoji: '🌍',
    nameFr: 'Environnement et assainissement',
    nameEn: 'Environment and sanitation',
    lessons: [
      L('Trier les déchets permet de recycler les plastiques et les métaux et de composter les restes organiques.', 'Sorting waste allows plastics and metals to be recycled and organic leftovers to be composted.', 'Pourquoi trier les déchets ?', 'Why sort waste?', ['Pour les recycler et composter', 'Pour les brûler tous', 'Pour les jeter à la mer'], ['To recycle and compost them', 'To burn them all', 'To throw them in the sea'], 0),
      L('L’érosion côtière fait reculer la plage à l’est de Lomé ; des épis et des enrochements protègent le littoral.', 'Coastal erosion makes the beach retreat east of Lomé; groynes and rock armour protect the coastline.', 'Qu’est-ce qui protège le littoral de l’érosion ?', 'What protects the coastline from erosion?', ['Le sable retiré', 'Les épis et enrochements', 'Les déchets'], ['Removed sand', 'Groynes and rock armour', 'Rubbish'], 1),
      L('Une eau douteuse se rend potable en la faisant bouillir ou en la traitant au chlore, avant de la boire.', 'Doubtful water is made safe by boiling it or treating it with chlorine before drinking.', 'Comment rendre une eau douteuse potable ?', 'How do you make doubtful water safe?', ['La laisser au soleil une heure', 'Ajouter du sucre', 'La faire bouillir ou la chlorer'], ['Leave it in the sun for an hour', 'Add sugar', 'Boil or chlorinate it'], 2),
    ],
  },
  {
    id: 'cybersecurite',
    emoji: '🛡️',
    nameFr: 'Cybersécurité',
    nameEn: 'Cybersecurity',
    lessons: [
      L('L’hameçonnage (phishing) imite un message de confiance — banque, opérateur — pour voler un mot de passe ou un code mobile money.', 'Phishing imitates a trusted message — bank, operator — to steal a password or a mobile money code.', 'Que cherche un message d’hameçonnage ?', 'What does a phishing message want?', ['Vous offrir un cadeau', 'Voler vos identifiants', 'Réparer votre téléphone'], ['To give you a gift', 'To steal your credentials', 'To fix your phone'], 1),
      L('L’authentification à deux facteurs ajoute au mot de passe une preuve en plus, comme un code reçu par SMS ou une application.', 'Two-factor authentication adds a second proof to the password, such as a code received by SMS or an app.', 'Que fait l’authentification à deux facteurs ?', 'What does two-factor authentication do?', ['Ajoute une seconde preuve', 'Supprime le mot de passe', 'Accélère internet'], ['Adds a second proof', 'Removes the password', 'Speeds up the internet'], 0),
      L('Des sauvegardes régulières, gardées hors ligne, permettent de tout restaurer après un rançongiciel sans payer la rançon.', 'Regular backups kept offline let you restore everything after ransomware without paying the ransom.', 'Quelle est la meilleure parade à un rançongiciel ?', 'What is the best defence against ransomware?', ['Payer vite', 'Éteindre l’écran', 'Des sauvegardes hors ligne'], ['Pay quickly', 'Turn off the screen', 'Offline backups'], 2),
    ],
  },
  {
    id: 'data',
    emoji: '🤖',
    nameFr: 'Science des données et IA',
    nameEn: 'Data science and AI',
    lessons: [
      L('La moyenne additionne les valeurs et divise par leur nombre ; la médiane est la valeur du milieu, moins sensible aux extrêmes.', 'The mean adds the values and divides by their count; the median is the middle value, less sensitive to extremes.', 'Quelle mesure résiste le mieux à une valeur extrême ?', 'Which measure best resists an extreme value?', ['La moyenne', 'La médiane', 'Le total'], ['The mean', 'The median', 'The total'], 1),
      L('Un modèle d’apprentissage automatique apprend à partir d’exemples ; on le teste sur des données qu’il n’a jamais vues.', 'A machine learning model learns from examples; it is tested on data it has never seen.', 'Sur quelles données teste-t-on un modèle ?', 'On what data is a model tested?', ['Des données jamais vues', 'Les mêmes que l’entraînement', 'Aucune'], ['Data it has never seen', 'The same as training', 'None'], 0),
      L('Des données de mauvaise qualité donnent de mauvais résultats : on nettoie d’abord doublons, erreurs et valeurs manquantes.', 'Poor-quality data gives poor results: first clean duplicates, errors and missing values.', 'Que fait-on avant d’analyser des données ?', 'What do you do before analysing data?', ['On les publie', 'On les supprime', 'On les nettoie'], ['Publish them', 'Delete them', 'Clean them'], 2),
    ],
  },
];
