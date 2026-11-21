// Conférences publiques par défaut (paramètre « conference », modifiable dans le back-office).
export interface ConferenceTopic {
  id: string;
  emoji: string;
  speaker: string;
  titleFr: string;
  titleEn: string;
  textFr: string;
  textEn: string;
}

export const DEFAULT_TOPICS: ConferenceTopic[] = [
  {
    id: 'epargne',
    emoji: '💰',
    speaker: 'Mme Essi Amegah, conseillère en microfinance',
    titleFr: 'Épargner même avec un petit revenu',
    titleEn: 'Saving even on a small income',
    textFr: 'Mettre de côté un peu chaque mois, même 10 % de ce qu’on gagne, protège contre les coups durs. La tontine et le compte d’épargne aident à tenir l’effort. Avant d’emprunter, on calcule ce que le crédit coûtera vraiment.',
    textEn: 'Setting a little aside every month, even 10% of what you earn, protects you against hard times. A tontine and a savings account help you keep it up. Before borrowing, work out what the loan will really cost.',
  },
  {
    id: 'commerce',
    emoji: '🛒',
    speaker: 'M. Koffi Mensah, commerçant à Assigamé',
    titleFr: 'Bien démarrer son commerce',
    titleEn: 'Starting a small business well',
    textFr: 'Avant d’ouvrir, on observe le marché : qui achète, à quel prix, et qui vend déjà. On sépare l’argent de la boutique de celui de la maison. Chaque vente et chaque dépense se note dans un cahier.',
    textEn: 'Before opening, study the market: who buys, at what price, and who already sells. Keep the shop’s money apart from the household’s. Write every sale and every expense in a notebook.',
  },
  {
    id: 'paludisme',
    emoji: '🦟',
    speaker: 'Dr Yao Agbeko, médecin au CHU',
    titleFr: 'Se protéger du paludisme',
    titleEn: 'Protecting yourself from malaria',
    textFr: 'Le paludisme se transmet par la piqûre de moustique, surtout la nuit. Dormir sous une moustiquaire imprégnée reste la meilleure protection. Une fièvre doit faire consulter vite : un test rapide confirme le paludisme.',
    textEn: 'Malaria is spread by mosquito bites, mostly at night. Sleeping under a treated mosquito net remains the best protection. A fever means seeing a doctor quickly: a rapid test confirms malaria.',
  },
  {
    id: 'numerique',
    emoji: '💻',
    speaker: 'Mme Afi Dogbe, développeuse',
    titleFr: 'Le numérique pour trouver du travail',
    titleEn: 'Using digital tools to find work',
    textFr: 'Un CV clair d’une page, avec une adresse mail sérieuse, fait bonne impression. On peut se former en ligne : bureautique, programmation, marketing. On protège ses comptes avec des mots de passe différents et on ne donne jamais un code reçu par SMS.',
    textEn: 'A clear one-page CV with a serious email address makes a good impression. You can learn online: office software, programming, marketing. Protect your accounts with different passwords and never give away a code received by SMS.',
  },
  {
    id: 'agriculture',
    emoji: '🌱',
    speaker: 'M. Kodjo Atsu, agronome',
    titleFr: 'Mieux vendre les produits de la terre',
    titleEn: 'Selling farm produce better',
    textFr: 'Transformer les produits locaux crée de la valeur : gari, huile de palme, jus de fruits. Bien sécher et bien stocker les récoltes limite les pertes. Se regrouper en coopérative aide à acheter moins cher et à mieux vendre.',
    textEn: 'Processing local produce adds value: gari, palm oil, fruit juice. Drying and storing harvests properly limits losses. Joining a cooperative helps you buy cheaper and sell better.',
  },
];
