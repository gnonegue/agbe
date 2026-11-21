// Gabarits des e-mails : HTML « tables + styles en ligne » (compatible Gmail, Outlook, Apple Mail, webmails) et version texte.
// Tout texte variable est échappé ; les liens n'utilisent que PUBLIC_APP_URL et un jeton à usage unique.

/** Identifiant de l'image du logo jointe au message (affichée dans l'en-tête sans lien externe). */
export const LOGO_CID = 'agbe-logo';

export type MailLocale = 'fr' | 'en';

export interface RenderedMail {
  subject: string;
  html: string;
  text: string;
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Couleurs du jeu : vert du drapeau togolais, jaune, rouge ; encre bleu nuit.
const C = { green: '#0a7d4f', greenDark: '#06603c', greenSoft: '#e7f5ed', yellow: '#ffce00', red: '#d21034', ink: '#14213d', text: '#2b3550', muted: '#6b7690', line: '#e3e8f2', bg: '#f5f7fb' };

const COPY = {
  fr: {
    tagline: 'La vie au Togo',
    resetSubject: 'Réinitialise ton mot de passe AGBE',
    resetPreheader: 'Ce lien est valable {minutes} minutes et ne sert qu’une fois.',
    resetTitle: 'Un nouveau mot de passe ?',
    hello: 'Bonjour {name},',
    resetIntro: 'Tu as demandé à réinitialiser le mot de passe de ton compte AGBE. Clique sur le bouton ci-dessous pour en choisir un nouveau.',
    resetIntroAdmin: 'L’équipe AGBE t’envoie ce lien pour que tu choisisses toi-même un nouveau mot de passe pour ton compte.',
    resetCta: 'Choisir un nouveau mot de passe',
    expiry: 'Ce lien expire dans {minutes} minutes et ne peut servir qu’une seule fois.',
    fallback: 'Le bouton ne marche pas ? Copie ce lien dans ton navigateur :',
    safetyTitle: 'Tu n’es pas à l’origine de cette demande ?',
    safety: 'Ignore simplement ce message : ton mot de passe actuel reste valable. L’équipe AGBE ne te demandera jamais ton mot de passe par e-mail ou par message.',
    changedSubject: 'Ton mot de passe AGBE a été modifié',
    changedPreheader: 'Toutes tes sessions ont été fermées.',
    changedTitle: 'Mot de passe modifié',
    changedBody: 'Le mot de passe de ton compte AGBE vient d’être modifié. Pour ta sécurité, toutes tes sessions ont été fermées : reconnecte-toi avec ton nouveau mot de passe.',
    changedCta: 'Se connecter',
    changedSafetyTitle: 'Ce n’était pas toi ?',
    changedSafety: 'Demande tout de suite un nouveau lien depuis la page de connexion (« Mot de passe oublié ? ») et écris à l’équipe AGBE.',
    footer: 'Tu reçois cet e-mail parce qu’une adresse liée à un compte AGBE a été utilisée. Ceci est un message automatique, merci de ne pas y répondre.',
    player: 'joueur',
  },
  en: {
    tagline: 'Life in Togo',
    resetSubject: 'Reset your AGBE password',
    resetPreheader: 'This link is valid for {minutes} minutes and works only once.',
    resetTitle: 'Need a new password?',
    hello: 'Hello {name},',
    resetIntro: 'You asked to reset the password of your AGBE account. Click the button below to choose a new one.',
    resetIntroAdmin: 'The AGBE team sent you this link so you can choose a new password for your account yourself.',
    resetCta: 'Choose a new password',
    expiry: 'This link expires in {minutes} minutes and can be used only once.',
    fallback: 'The button doesn’t work? Copy this link into your browser:',
    safetyTitle: 'Didn’t request this?',
    safety: 'Just ignore this message: your current password stays valid. The AGBE team will never ask for your password by e-mail or message.',
    changedSubject: 'Your AGBE password was changed',
    changedPreheader: 'All your sessions were signed out.',
    changedTitle: 'Password changed',
    changedBody: 'The password of your AGBE account was just changed. For your safety, all your sessions were signed out: sign in again with your new password.',
    changedCta: 'Sign in',
    changedSafetyTitle: 'Wasn’t you?',
    changedSafety: 'Request a new link right away from the sign-in page (“Forgot password?”) and write to the AGBE team.',
    footer: 'You receive this e-mail because an address linked to an AGBE account was used. This is an automated message, please do not reply.',
    player: 'player',
  },
} as const;

const fill = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => esc(String(vars[k] ?? '')));
const plain = (s: string, vars: Record<string, string | number>) => s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));

interface Layout {
  lang: MailLocale;
  title: string;
  preheader: string;
  /** Pictogramme du médaillon (emoji). */
  icon: string;
  paragraphs: string[];
  cta?: { label: string; url: string };
  fallbackUrl?: string;
  note?: string;
  safety?: { title: string; text: string };
  /** Pied de page propre au message (sinon : message automatique, ne pas répondre). */
  footer?: string;
}

/** Cadre commun : bandeau drapeau, en-tête vert, carte blanche, bouton, encadré sécurité, pied de page. */
function layout(l: Layout): string {
  const t = COPY[l.lang];
  const paragraphs = l.paragraphs.map((p) => `<p style="margin:0 0 16px;font-size:16px;line-height:1.6;color:${C.text};">${p}</p>`).join('');
  const button = l.cta
    ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:28px auto 8px;"><tr><td align="center" bgcolor="${C.green}" style="border-radius:14px;"><a href="${esc(l.cta.url)}" target="_blank" style="display:inline-block;padding:16px 34px;font-family:Arial,Helvetica,sans-serif;font-size:17px;font-weight:700;color:#ffffff;text-decoration:none;border-radius:14px;border-bottom:3px solid ${C.greenDark};">${esc(l.cta.label)}</a></td></tr></table>`
    : '';
  const note = l.note ? `<p style="margin:14px 0 0;text-align:center;font-size:14px;line-height:1.5;color:${C.muted};">⏱ ${l.note}</p>` : '';
  const fallback = l.fallbackUrl
    ? `<p style="margin:26px 0 4px;font-size:13px;line-height:1.5;color:${C.muted};">${esc(t.fallback)}</p><p style="margin:0;font-size:13px;line-height:1.5;word-break:break-all;"><a href="${esc(l.fallbackUrl)}" target="_blank" style="color:${C.green};">${esc(l.fallbackUrl)}</a></p>`
    : '';
  return `<!doctype html>
<html lang="${l.lang}" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="x-apple-disable-message-reformatting">
<meta name="color-scheme" content="light only">
<meta name="supported-color-schemes" content="light only">
<title>${esc(l.title)}</title>
</head>
<body style="margin:0;padding:0;background:${C.bg};-webkit-text-size-adjust:100%;">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;">${esc(l.preheader)}&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;&#847;&zwnj;&nbsp;</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.bg}" style="background:${C.bg};">
<tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;font-family:Arial,Helvetica,sans-serif;">
    <tr><td>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-radius:20px 20px 0 0;overflow:hidden;"><tr>
        <td width="40%" height="6" bgcolor="#006a4e" style="font-size:0;line-height:0;height:6px;">&nbsp;</td>
        <td width="40%" height="6" bgcolor="${C.yellow}" style="font-size:0;line-height:0;height:6px;">&nbsp;</td>
        <td width="20%" height="6" bgcolor="${C.red}" style="font-size:0;line-height:0;height:6px;">&nbsp;</td>
      </tr></table>
    </td></tr>
    <tr><td bgcolor="${C.green}" align="center" style="background:${C.green};padding:30px 24px 26px;">
      <img src="cid:${LOGO_CID}" width="72" height="72" alt="" style="display:block;margin:0 auto 14px;width:72px;height:72px;border:0;border-radius:18px;">
      <div style="font-size:34px;line-height:1;font-weight:800;letter-spacing:6px;color:#ffffff;">AGBE</div>
      <div style="margin-top:8px;font-size:14px;letter-spacing:1px;color:#cdeedd;">${esc(t.tagline)}</div>
    </td></tr>
    <tr><td bgcolor="#ffffff" style="background:#ffffff;padding:36px 32px 32px;border-left:1px solid ${C.line};border-right:1px solid ${C.line};">
      <table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto 18px;"><tr><td align="center" width="76" height="76" bgcolor="${C.greenSoft}" style="width:76px;height:76px;border-radius:38px;font-size:36px;line-height:76px;">${l.icon}</td></tr></table>
      <h1 style="margin:0 0 22px;text-align:center;font-size:26px;line-height:1.25;color:${C.ink};">${esc(l.title)}</h1>
      ${paragraphs}
      ${button}
      ${note}
      ${
        l.safety
          ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:30px 0 0;"><tr>
        <td bgcolor="#fff8dc" style="background:#fff8dc;border-left:4px solid ${C.yellow};border-radius:10px;padding:14px 16px;">
          <div style="font-size:14px;font-weight:700;color:${C.ink};margin-bottom:4px;">🛡️ ${esc(l.safety.title)}</div>
          <div style="font-size:14px;line-height:1.55;color:${C.text};">${esc(l.safety.text)}</div>
        </td>
      </tr></table>`
          : ''
      }
      ${fallback}
    </td></tr>
    <tr><td bgcolor="#ffffff" style="background:#ffffff;border-left:1px solid ${C.line};border-right:1px solid ${C.line};border-bottom:1px solid ${C.line};border-radius:0 0 20px 20px;padding:0 32px 26px;">
      <div style="border-top:1px solid ${C.line};padding-top:18px;font-size:12px;line-height:1.55;color:${C.muted};text-align:center;">${esc(l.footer ?? t.footer)}</div>
    </td></tr>
  </table>
</td></tr>
</table>
</body>
</html>`;
}

export interface ResetMailInput {
  locale: MailLocale;
  /** Nom d'utilisateur ; à défaut, un mot générique. */
  name: string | null;
  link: string;
  minutes: number;
  /** Lien envoyé à l'initiative d'un administrateur. */
  byAdmin?: boolean;
}

export function renderResetMail(i: ResetMailInput): RenderedMail {
  const t = COPY[i.locale];
  const name = i.name ?? t.player;
  const vars = { name, minutes: i.minutes };
  const intro = i.byAdmin ? t.resetIntroAdmin : t.resetIntro;
  const html = layout({
    lang: i.locale,
    title: t.resetTitle,
    preheader: plain(t.resetPreheader, vars),
    icon: '🔐',
    paragraphs: [fill(t.hello, vars), esc(intro)],
    cta: { label: t.resetCta, url: i.link },
    note: fill(t.expiry, vars),
    fallbackUrl: i.link,
    safety: { title: t.safetyTitle, text: t.safety },
  });
  const text = [plain(t.hello, vars), '', intro, '', `${t.resetCta} :`, i.link, '', plain(t.expiry, vars), '', `${t.safetyTitle} ${t.safety}`, '', '— AGBE'].join('\n');
  return { subject: t.resetSubject, html, text };
}

export interface ChangedMailInput {
  locale: MailLocale;
  name: string | null;
  loginUrl: string;
}

export function renderPasswordChangedMail(i: ChangedMailInput): RenderedMail {
  const t = COPY[i.locale];
  const vars = { name: i.name ?? t.player };
  const html = layout({
    lang: i.locale,
    title: t.changedTitle,
    preheader: t.changedPreheader,
    icon: '✅',
    paragraphs: [fill(t.hello, vars), esc(t.changedBody)],
    cta: { label: t.changedCta, url: i.loginUrl },
    safety: { title: t.changedSafetyTitle, text: t.changedSafety },
  });
  const text = [plain(t.hello, vars), '', t.changedBody, '', `${t.changedCta} : ${i.loginUrl}`, '', `${t.changedSafetyTitle} ${t.changedSafety}`, '', '— AGBE'].join('\n');
  return { subject: t.changedSubject, html, text };
}

// ───────────── Formulaire de contact (page « Annonces » du site) ─────────────

/** Texte libre d'un visiteur ou de l'équipe : échappé, sauts de ligne conservés. */
const block = (s: string) => esc(s).replace(/\r?\n/g, '<br>');

export interface ContactNoticeInput {
  name: string;
  company: string | null;
  whatsapp: string;
  email: string | null;
  topic: string;
  message: string;
  adminUrl: string;
  /** Bug signalé depuis le jeu : contexte technique (compte, lieu, écran, navigateur). */
  context?: string | null;
}

/** Nouveau message reçu : envoyé à l'équipe (adresse du réglage partners.contact), toujours en français. */
export function renderContactNotice(i: ContactNoticeInput): RenderedMail {
  const who = i.company ? `${i.name} (${i.company})` : i.name;
  const wa = i.whatsapp ? `https://wa.me/${i.whatsapp}` : null;
  const bug = !!i.context;
  const rows: [string, string][] = [
    ['Nom', who],
    ['WhatsApp', i.whatsapp ? `+${i.whatsapp}` : '—'],
    ['E-mail', i.email ?? '—'],
    ['Sujet', i.topic],
    ...(i.context ? ([['Contexte', i.context]] as [string, string][]) : []),
  ];
  const html = layout({
    lang: 'fr',
    title: bug ? 'Bug signalé en jeu' : 'Nouveau message du site',
    preheader: `${who} : ${i.topic}`,
    icon: '✉️',
    paragraphs: [
      rows.map(([k, v]) => `<strong>${esc(k)} :</strong> ${esc(v)}`).join('<br>'),
      `<span style="display:block;padding:14px 16px;border-radius:10px;background:${C.bg};">${block(i.message)}</span>`,
      `${wa ? `Répondre sur WhatsApp : <a href="${esc(wa)}" style="color:${C.green};">${esc(wa)}</a>` : 'Pas de numéro WhatsApp pour ce joueur.'}${i.email ? '<br>Ou répondez simplement à cet e-mail : la réponse part vers l’adresse du joueur.' : ''}`,
    ],
    cta: { label: 'Ouvrir dans l’administration', url: i.adminUrl },
    footer: bug ? 'Bug signalé depuis l’appli « Signaler un bug » du jeu AGBE. Il est aussi enregistré dans l’administration (onglet Messages).' : 'Message envoyé depuis le formulaire de contact du site AGBE. Il est aussi enregistré dans l’administration (onglet Messages).',
  });
  const text = [...rows.map(([k, v]) => `${k} : ${v}`), '', i.message, '', ...(wa ? [`WhatsApp : ${wa}`] : []), `Administration : ${i.adminUrl}`].join('\n');
  return { subject: `[AGBE] Message du site : ${i.topic} — ${who}`, html, text };
}

const REPLY = {
  fr: { subject: 'Réponse de l’équipe AGBE', title: 'Réponse à votre message', hello: 'Bonjour {name},', yours: 'Votre message :', footer: 'Vous pouvez répondre directement à cet e-mail pour continuer l’échange avec l’équipe AGBE.' },
  en: { subject: 'Reply from the AGBE team', title: 'Reply to your message', hello: 'Hello {name},', yours: 'Your message:', footer: 'You can reply directly to this e-mail to keep talking with the AGBE team.' },
} as const;

export interface ContactReplyInput {
  locale: MailLocale;
  name: string;
  reply: string;
  original: string;
}

/** Réponse de l'équipe au visiteur, dans sa langue, avec son message d'origine en rappel. */
export function renderContactReply(i: ContactReplyInput): RenderedMail {
  const t = REPLY[i.locale];
  const html = layout({
    lang: i.locale,
    title: t.title,
    preheader: i.reply.slice(0, 90),
    icon: '💬',
    paragraphs: [fill(t.hello, { name: i.name }), block(i.reply), `<span style="display:block;padding:12px 14px;border-left:3px solid ${C.line};color:${C.muted};font-size:14px;">${esc(t.yours)}<br>${block(i.original)}</span>`],
    footer: t.footer,
  });
  const text = [plain(t.hello, { name: i.name }), '', i.reply, '', '— AGBE', '', t.yours, i.original].join('\n');
  return { subject: t.subject, html, text };
}

// ───────────── Marchés publics (tenders) ─────────────

const TENDER = {
  fr: {
    awardedSubject: 'Votre entreprise a été retenue pour un marché public',
    awardedTitle: 'Marché public obtenu !',
    awardedBody: 'Bonne nouvelle : « {company} » a été retenue pour le marché public « {sector} ». Montant convenu : {amount}, à livrer dans un délai de {hours} h de jeu.',
    rejectedSubject: 'Résultat d’un marché public',
    rejectedTitle: 'Marché public non obtenu',
    rejectedBody: '« {company} » n’a pas été retenue pour le marché public « {sector} ». D’autres candidatures proposaient un meilleur prix ou un délai plus court. Tentez votre chance au prochain marché !',
    paidSubject: 'Marché public payé',
    paidTitle: 'Paiement reçu',
    paidBody: '« {company} » a livré le marché public « {sector} » dans les délais. Le Trésor public vient de verser {amount} sur le portefeuille de l’entreprise.',
    cta: 'Ouvrir l’appli Marché public',
    hello: 'Bonjour {name},',
  },
  en: {
    awardedSubject: 'Your company was awarded a public tender',
    awardedTitle: 'Public tender won!',
    awardedBody: 'Good news: “{company}” was selected for the public tender “{sector}”. Agreed amount: {amount}, to deliver within {hours} game hours.',
    rejectedSubject: 'Public tender result',
    rejectedTitle: 'Public tender not won',
    rejectedBody: '“{company}” was not selected for the public tender “{sector}”. Other applications offered a better price or a shorter delay. Try your luck on the next tender!',
    paidSubject: 'Public tender paid',
    paidTitle: 'Payment received',
    paidBody: '“{company}” delivered the public tender “{sector}” on time. The Treasury just paid {amount} into the company’s wallet.',
    cta: 'Open the Public Tenders app',
    hello: 'Hello {name},',
  },
} as const;

export interface TenderMailInput {
  locale: MailLocale;
  name: string | null;
  company: string;
  sector: string;
  amount: string;
  hours?: number;
  appUrl: string;
}

export function renderTenderAwardedMail(i: TenderMailInput): RenderedMail {
  const t = TENDER[i.locale];
  const vars = { name: i.name ?? '—', company: i.company, sector: i.sector, amount: i.amount, hours: i.hours ?? 0 };
  const html = layout({
    lang: i.locale,
    title: t.awardedTitle,
    preheader: fill(t.awardedBody, vars),
    icon: '🏛️',
    paragraphs: [fill(t.hello, vars), fill(t.awardedBody, vars)],
    cta: { label: t.cta, url: i.appUrl },
  });
  const text = [plain(t.hello, vars), '', plain(t.awardedBody, vars), '', '— AGBE'].join('\n');
  return { subject: t.awardedSubject, html, text };
}

export function renderTenderRejectedMail(i: TenderMailInput): RenderedMail {
  const t = TENDER[i.locale];
  const vars = { name: i.name ?? '—', company: i.company, sector: i.sector, amount: i.amount };
  const html = layout({
    lang: i.locale,
    title: t.rejectedTitle,
    preheader: fill(t.rejectedBody, vars),
    icon: '🏛️',
    paragraphs: [fill(t.hello, vars), fill(t.rejectedBody, vars)],
    cta: { label: t.cta, url: i.appUrl },
  });
  const text = [plain(t.hello, vars), '', plain(t.rejectedBody, vars), '', '— AGBE'].join('\n');
  return { subject: t.rejectedSubject, html, text };
}

export function renderTenderPaidMail(i: TenderMailInput): RenderedMail {
  const t = TENDER[i.locale];
  const vars = { name: i.name ?? '—', company: i.company, sector: i.sector, amount: i.amount };
  const html = layout({
    lang: i.locale,
    title: t.paidTitle,
    preheader: fill(t.paidBody, vars),
    icon: '💰',
    paragraphs: [fill(t.hello, vars), fill(t.paidBody, vars)],
    cta: { label: t.cta, url: i.appUrl },
  });
  const text = [plain(t.hello, vars), '', plain(t.paidBody, vars), '', '— AGBE'].join('\n');
  return { subject: t.paidSubject, html, text };
}

// ───────────── Prêt bancaire personnel ─────────────

const LOAN = {
  fr: {
    grantedSubject: 'Ton prêt a été accordé',
    grantedTitle: 'Prêt accordé !',
    grantedBody: '{amount} viennent d’être versés sur ton portefeuille. Mensualité : {installment}, prélevée automatiquement tous les {period} jours de jeu jusqu’au remboursement complet.',
    collectedSubject: 'Mensualité de prêt prélevée',
    collectedTitle: 'Mensualité prélevée',
    collectedBody: '{amount} ont été prélevés pour ton prêt. Capital restant dû : {remaining}.',
    lateSubject: 'Retard sur ton prêt',
    lateTitle: 'Mensualité impayée',
    lateBody: 'Ton solde était insuffisant pour la mensualité de ton prêt. Une pénalité de retard s’applique désormais, et le prélèvement sera retenté automatiquement. Capital restant dû : {remaining}.',
    closedSubject: 'Prêt entièrement remboursé',
    closedTitle: 'Prêt remboursé !',
    closedBody: 'Ton prêt est entièrement remboursé. Tu peux en redemander un nouveau dès que tu en as besoin.',
    cta: 'Ouvrir l’appli Banque',
    hello: 'Bonjour {name},',
  },
  en: {
    grantedSubject: 'Your loan has been granted',
    grantedTitle: 'Loan granted!',
    grantedBody: '{amount} was just credited to your wallet. Instalment: {installment}, automatically collected every {period} game days until fully repaid.',
    collectedSubject: 'Loan instalment collected',
    collectedTitle: 'Instalment collected',
    collectedBody: '{amount} was collected for your loan. Remaining balance: {remaining}.',
    lateSubject: 'Your loan is late',
    lateTitle: 'Missed instalment',
    lateBody: 'Your balance was too low for your loan instalment. A late penalty now applies, and collection will be retried automatically. Remaining balance: {remaining}.',
    closedSubject: 'Loan fully repaid',
    closedTitle: 'Loan repaid!',
    closedBody: 'Your loan is fully repaid. You can request a new one whenever you need it.',
    cta: 'Open the Bank app',
    hello: 'Hello {name},',
  },
} as const;

export interface LoanMailInput {
  locale: MailLocale;
  name: string | null;
  amount?: string;
  installment?: string;
  period?: number;
  remaining?: string;
  appUrl: string;
}

export function renderLoanGrantedMail(i: LoanMailInput): RenderedMail {
  const t = LOAN[i.locale];
  const vars = { name: i.name ?? '—', amount: i.amount ?? '0', installment: i.installment ?? '0', period: i.period ?? 0 };
  const html = layout({
    lang: i.locale,
    title: t.grantedTitle,
    preheader: fill(t.grantedBody, vars),
    icon: '🏦',
    paragraphs: [fill(t.hello, vars), fill(t.grantedBody, vars)],
    cta: { label: t.cta, url: i.appUrl },
  });
  const text = [plain(t.hello, vars), '', plain(t.grantedBody, vars), '', '— AGBE'].join('\n');
  return { subject: t.grantedSubject, html, text };
}

export function renderLoanCollectedMail(i: LoanMailInput): RenderedMail {
  const t = LOAN[i.locale];
  const vars = { name: i.name ?? '—', amount: i.amount ?? '0', remaining: i.remaining ?? '0' };
  const html = layout({
    lang: i.locale,
    title: t.collectedTitle,
    preheader: fill(t.collectedBody, vars),
    icon: '🏦',
    paragraphs: [fill(t.hello, vars), fill(t.collectedBody, vars)],
    cta: { label: t.cta, url: i.appUrl },
  });
  const text = [plain(t.hello, vars), '', plain(t.collectedBody, vars), '', '— AGBE'].join('\n');
  return { subject: t.collectedSubject, html, text };
}

export function renderLoanLateMail(i: LoanMailInput): RenderedMail {
  const t = LOAN[i.locale];
  const vars = { name: i.name ?? '—', remaining: i.remaining ?? '0' };
  const html = layout({
    lang: i.locale,
    title: t.lateTitle,
    preheader: fill(t.lateBody, vars),
    icon: '⚠️',
    paragraphs: [fill(t.hello, vars), fill(t.lateBody, vars)],
    cta: { label: t.cta, url: i.appUrl },
  });
  const text = [plain(t.hello, vars), '', plain(t.lateBody, vars), '', '— AGBE'].join('\n');
  return { subject: t.lateSubject, html, text };
}

export function renderLoanClosedMail(i: LoanMailInput): RenderedMail {
  const t = LOAN[i.locale];
  const vars = { name: i.name ?? '—' };
  const html = layout({
    lang: i.locale,
    title: t.closedTitle,
    preheader: fill(t.closedBody, vars),
    icon: '🎉',
    paragraphs: [fill(t.hello, vars), fill(t.closedBody, vars)],
    cta: { label: t.cta, url: i.appUrl },
  });
  const text = [plain(t.hello, vars), '', plain(t.closedBody, vars), '', '— AGBE'].join('\n');
  return { subject: t.closedSubject, html, text };
}
