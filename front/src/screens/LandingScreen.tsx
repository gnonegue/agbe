import { useEffect, useRef, useState } from 'react';
import { useSiteReveal } from '../lib/useSiteReveal';
import type { TFunction } from 'i18next';
import { getAdOffer } from '../api/endpoints';
import { useTranslation } from 'react-i18next';
import type { Locale } from '../api/types';
import { changeLang } from '../i18n';
import { promptInstall, useInstall } from '../lib/install';
import { HOWTO } from '../lib/pages';
import { RANKING } from '../lib/musicCatalog';
import AppGlyph from '../phone/AppGlyph';
import SiteFooter from '../ui/SiteFooter';
import SiteNav from '../ui/SiteNav';
import TogoBackdrop from '../ui/TogoBackdrop';

// Sections de la page, toutes visibles (et donc lues par les moteurs de recherche) : le parcours de l'entrepreneur
// d'abord (chaque étape existe dans le jeu), puis la vie au quotidien et les buts du jeu (« Vision et concept »).
// Les pictogrammes sont ceux des applications du téléphone du jeu.
const SECTIONS = {
  business: [
    ['market', 'trade'],
    ['trade', 'port'],
    ['invest', 'invest'],
    ['company', 'company'],
    ['people', 'hire'],
    ['payroll', 'charges'],
  ],
  life: [
    ['work', 'work'],
    ['eat', 'market'],
    ['health', 'health'],
    ['faith', 'faith'],
    ['estate', 'home'],
    ['ride', 'vehicle'],
  ],
  vision: [
    ['flag', 'live'],
    ['school', 'learn'],
    ['rocket', 'youth'],
    ['map', 'discover'],
    ['music', 'artists'],
    ['globe', 'bond'],
  ],
} as const;
type Section = keyof typeof SECTIONS;
// Services publics que le jeu fait pratiquer (impôts, cotisations, formalités, foncier)
const PUBLIC = ['otr', 'cnss', 'amu', 'cfe', 'land'] as const;
// Musique togolaise dans le jeu (appli Musique) : ce que le joueur y trouve, et quelques artistes à découvrir
// (choisis parmi ceux de l'appli, avec leur nom tel qu'il y figure)
const MUSIC = ['listen', 'support', 'languages', 'ambient'] as const;
const MUSIC_ARTISTS = ['toofan', 'kingMensah', 'santrinos', 'cecileMeba', 'sethlo', 'pakiChenzu', 'tonyX', 'senza', 'mastapopa', 'kingMaz', 'mardy']
  .map((k) => RANKING.find((a) => a.key === k))
  .filter((a) => a !== undefined);
// Captures du jeu (public/landing), prises sur téléphone : deux dans l'accroche, puis le diaporama, qui montre aussi
// les écrans des démarches (entreprise, paie, AMU, titre foncier)
const SHOTS = ['home', 'city'] as const;
const GALLERY = ['map', 'bus', 'home', 'city', 'phone', 'market', 'company', 'payroll', 'health', 'estate'] as const;

// Diaporama automatique : une image toutes les 4 s
const AUTO_MS = 4000;

/**
 * Diaporama de captures : défile tout seul, glissement au doigt (défilement natif aimanté), flèches et points.
 * Le défilement automatique s'arrête pendant qu'on s'en sert (survol, doigt, clavier), hors de l'écran, sur le bouton
 * pause, et n'a pas lieu si l'appareil demande moins d'animations.
 * Toutes les images restent dans la page (lisibles par les moteurs de recherche), chargées à l'approche.
 */
function Slides({ ids, captionKey, label, t }: { ids: readonly string[]; captionKey: string; label: string; t: TFunction }) {
  const track = useRef<HTMLUListElement>(null);
  const [index, setIndex] = useState(0);
  const [atEnd, setAtEnd] = useState(false);
  // Tout tient à l'écran (ordinateur) : ni flèches ni points
  const [fits, setFits] = useState(false);
  useEffect(() => {
    const el = track.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setFits(el.scrollWidth <= el.clientWidth + 4));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Défilement automatique
  const [stopped, setStopped] = useState(false);
  const [held, setHeld] = useState(false);
  const [visible, setVisible] = useState(false);
  const [reduced, setReduced] = useState(false);
  const release = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pos = useRef({ index: 0, atEnd: false });
  pos.current = { index, atEnd };
  useEffect(() => {
    setReduced(window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    const el = track.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setVisible(e!.isIntersecting), { threshold: 0.5 });
    io.observe(el);
    return () => {
      io.disconnect();
      clearTimeout(release.current);
    };
  }, []);
  const auto = !fits && !reduced && !stopped;
  useEffect(() => {
    if (!auto || held || !visible) return;
    const id = setInterval(() => {
      if (document.hidden) return;
      const { index: i, atEnd: end } = pos.current;
      go(end || i >= ids.length - 1 ? 0 : i + 1);
    }, AUTO_MS);
    return () => clearInterval(id);
  });
  // Au doigt : pause pendant le geste, reprise quelques secondes après
  const hold = (ms?: number) => {
    clearTimeout(release.current);
    setHeld(true);
    if (ms) release.current = setTimeout(() => setHeld(false), ms);
  };
  const slides = () => [...(track.current?.children ?? [])] as HTMLElement[];
  const onScroll = () => {
    const el = track.current;
    if (!el) return;
    const items = slides();
    const first = items[0]?.offsetLeft ?? 0;
    // Diapositive courante : la plus proche du bord gauche
    let best = 0;
    items.forEach((li, i) => {
      if (Math.abs(li.offsetLeft - first - el.scrollLeft) < Math.abs(items[best]!.offsetLeft - first - el.scrollLeft)) best = i;
    });
    // Au bout du défilement, les dernières images ne peuvent plus venir au bord gauche : c'est la dernière qui est active
    const end = el.scrollLeft + el.clientWidth >= el.scrollWidth - 4;
    setIndex(end ? items.length - 1 : best);
    setAtEnd(end);
  };
  const go = (i: number) => {
    const el = track.current;
    const items = slides();
    const target = items[Math.max(0, Math.min(items.length - 1, i))];
    if (!el || !target) return;
    const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollTo({ left: target.offsetLeft - (items[0]?.offsetLeft ?? 0), behavior: smooth ? 'smooth' : 'auto' });
  };
  return (
    <div
      className="landing-slides"
      role="region"
      aria-roledescription="carousel"
      aria-label={label}
      onPointerEnter={(e) => e.pointerType === 'mouse' && hold()}
      onPointerLeave={(e) => e.pointerType === 'mouse' && setHeld(false)}
      onTouchStart={() => hold(8000)}
      onFocus={() => hold()}
      onBlur={() => setHeld(false)}
    >
      <ul className="landing-strip" ref={track} onScroll={onScroll} aria-live={auto ? 'off' : 'polite'}>
        {ids.map((g, i) => (
          <li key={g} aria-roledescription="slide" aria-label={t('landing.slides.position', { n: i + 1, total: ids.length })}>
            <figure>
              <span className="landing-mini"><img src={`/landing/${g}.webp`} width={440} height={932} alt={t(`${captionKey}.${g}`)} loading="lazy" decoding="async" /></span>
              <figcaption>{t(`${captionKey}.${g}`)}</figcaption>
            </figure>
          </li>
        ))}
      </ul>
      <div className="landing-slides-nav" hidden={fits}>
        <button type="button" className="landing-arrow" onClick={() => go(index - 1)} disabled={index === 0} aria-label={t('landing.slides.prev')}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <div className="landing-dots">
          {ids.map((g, i) => (
            <button key={g} type="button" className={i === index ? 'on' : ''} onClick={() => go(i)} aria-label={t('landing.slides.goto', { n: i + 1 })} aria-current={i === index} />
          ))}
        </div>
        {!reduced && (
          <button type="button" className="landing-arrow" onClick={() => setStopped((v) => !v)} aria-label={t(stopped ? 'landing.slides.play' : 'landing.slides.pause')} aria-pressed={stopped}>
            {stopped ? (
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg>
            ) : (
              <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" fill="currentColor" /></svg>
            )}
          </button>
        )}
        <button type="button" className="landing-arrow" onClick={() => go(index + 1)} disabled={atEnd || index === ids.length - 1} aria-label={t('landing.slides.next')}>
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M9 5l7 7-7 7" /></svg>
        </button>
      </div>
    </div>
  );
}

/** Page d'accueil des visiteurs : présente le jeu, ses buts, et invite à jouer ou à l'installer. */
export default function LandingScreen({ onStart, member = false }: { onStart: () => void; member?: boolean }) {
  const { t, i18n } = useTranslation();
  const lang: Locale = i18n.language === 'en' ? 'en' : 'fr';
  const install = useInstall();
  const [installHelp, setInstallHelp] = useState(false);
  const [installing, setInstalling] = useState(false);
  // Contact des annonceurs (réglage partners.contact) : sans réponse du serveur, la phrase reste sans adresse
  const [email, setEmail] = useState('');
  useEffect(() => {
    // Lien vers une section (#inspirations) : React vient de remplacer la page pré-rendue, on y retourne
    if (window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
    void getAdOffer().then((o) => setEmail(o.contact.email), () => undefined);
  }, []);

  // Barre d'action collée en bas (téléphone, tablette) : seulement quand les boutons du haut ne sont plus visibles
  // (et pas quand l'appel final, avec son propre bouton, est à l'écran)
  const heroCta = useRef<HTMLDivElement>(null);
  const page = useSiteReveal();
  const finalCta = useRef<HTMLButtonElement>(null);
  const [stuck, setStuck] = useState(false);
  const [finalSeen, setFinalSeen] = useState(false);
  useEffect(() => {
    const el = heroCta.current;
    const end = finalCta.current;
    if (!el || !end || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([e]) => setStuck(!e!.isIntersecting && e!.boundingClientRect.top < 0));
    const io2 = new IntersectionObserver(([e]) => setFinalSeen(e!.isIntersecting));
    io.observe(el);
    io2.observe(end);
    return () => {
      io.disconnect();
      io2.disconnect();
    };
  }, []);

  // Chaque langue a son adresse (/ et /en) : la page partagée ou indexée s'ouvre dans la bonne langue
  const switchLang = (l: Locale) => {
    changeLang(l);
    window.history.replaceState(null, '', l === 'en' ? '/en' : '/');
  };

  const onInstall = async () => {
    if (install === 'ios') return setInstallHelp((v) => !v);
    setInstalling(true);
    const prompted = await promptInstall();
    setInstalling(false);
    if (!prompted) setInstallHelp(true);
  };

  const actions = (big: boolean) => (
    <>
      <button className={big ? 'btn primary big landing-play' : 'btn primary landing-play'} onClick={onStart}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg>
        {t(member ? 'landing.resume' : 'landing.play')}
      </button>
      <div className="landing-cta-row">
        {!member && <button className="btn ghost" onClick={onStart}>{t('landing.login')}</button>}
        {install && (
          <button className="btn landing-install" onClick={() => void onInstall()} disabled={installing} aria-expanded={install === 'prompt' ? undefined : installHelp}>
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
            {t('landing.install.button')}
          </button>
        )}
      </div>
      {installHelp && install && install !== 'prompt' && <p className="landing-help" role="status">{t(`landing.install.${install}`)}</p>}
    </>
  );

  return (
    <div className="screen landing" ref={page}>
      <SiteNav current="home" onLang={switchLang} onStart={onStart} member={member} />

      <main>
        <section className="landing-hero">
          <div className="landing-wrap">
            <div className="landing-hero-text">
              <span className="landing-kicker">{t('landing.kicker')}</span>
              <h1>{t('landing.title')}</h1>
              <p className="landing-lead">{t('landing.lead')}</p>
              <div className="landing-cta" ref={heroCta}>{actions(true)}</div>
              <small className="landing-free">{t('landing.free')}</small>
              <a className="landing-guide-link" href={HOWTO[lang]}>{t('landing.howtoLink')} →</a>
            </div>
            <div className="landing-shots">
              {SHOTS.map((s) => (
                <figure key={s} className={`landing-phone ${s}`}>
                  <img src={`/landing/${s}.webp`} width={520} height={1125} alt={t(`landing.shots.${s}`)} decoding="async" />
                </figure>
              ))}
            </div>
          </div>
        </section>

        <section className="landing-gallery" aria-labelledby="landing-gallery">
          <div className="landing-wrap">
            <h2 id="landing-gallery">{t('landing.gallery.title')}</h2>
            <Slides ids={GALLERY} captionKey="landing.gallery" label={t('landing.gallery.title')} t={t} />
          </div>
        </section>

        {(Object.keys(SECTIONS) as Section[]).map((k, si) => (
          <div key={k}>
            <section className={`landing-section ${k}`} aria-labelledby={`landing-${k}`}>
              <div className="landing-wrap">
                <h2 id={`landing-${k}`}>{t(`landing.sections.${k}`)}</h2>
                <ol className="landing-cards">
                  {SECTIONS[k].map(([glyph, item], i) => (
                    <li key={item}>
                      <span className="landing-icon"><AppGlyph id={glyph} size={22} /></span>
                      <div>
                        <h3>
                          {k === 'business' && <span className="landing-step">{i + 1}</span>}
                          {t(`landing.${k}.${item}.title`)}
                        </h3>
                        <p>{t(`landing.${k}.${item}.text`)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              </div>
            </section>
            {si === 1 && (
              <section className="landing-music" aria-labelledby="landing-music">
                <div className="landing-wrap">
                  <div className="landing-music-text">
                    <div className="landing-music-head">
                      <span className="landing-music-icon"><AppGlyph id="music" size={26} /></span>
                      <h2 id="landing-music">{t('landing.music.title')}</h2>
                    </div>
                    <p>{t('landing.music.text')}</p>
                    <ul className="landing-music-points">
                      {MUSIC.map((m) => (
                        <li key={m}>{t(`landing.music.points.${m}`)}</li>
                      ))}
                    </ul>
                    <p className="landing-music-label">{t('landing.music.artists')}</p>
                    <ul className="landing-music-artists">
                      {MUSIC_ARTISTS.map((a) => (
                        <li key={a.key}>{a.name}</li>
                      ))}
                      <li className="more">{t('landing.music.more')}</li>
                    </ul>
                    <p className="landing-music-cta">
                      {t('landing.music.artistCta')}
                      {email && (
                        <>
                          {' '}
                          <a href={`mailto:${email}`}>{email}</a>
                        </>
                      )}
                    </p>
                  </div>
                  <figure className="landing-phone landing-music-shot">
                    <img src="/landing/music.webp" width={440} height={398} alt={t('landing.music.shot')} loading="lazy" decoding="async" />
                  </figure>
                </div>
              </section>
            )}
            {si === 0 && (
              <section className="landing-public" aria-labelledby="landing-public">
                <div className="landing-wrap landing-public-head">
                  <span className="landing-public-icon"><AppGlyph id="public" size={28} /></span>
                  <div>
                    <h2 id="landing-public">{t('landing.public.title')}</h2>
                    <p>{t('landing.public.text')}</p>
                    <ul>
                      {PUBLIC.map((p) => (
                        <li key={p}>{t(`landing.public.items.${p}`)}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </section>
            )}
          </div>
        ))}

        <section id="inspirations" className="landing-section landing-inspire" aria-labelledby="landing-inspire">
          <div className="landing-wrap">
            <h2 id="landing-inspire">{t('landing.inspire.title')}</h2>
            <p className="landing-inspire-intro">{t('landing.inspire.text')}</p>
            <ul className="landing-inspire-cards">
              <li>
                <h3>Les Sims</h3>
                <p>{t('landing.inspire.sims')}</p>
              </li>
              <li>
                <h3>Lagos Life</h3>
                <p>{t('landing.inspire.lagos')}</p>
                <p className="landing-inspire-links">
                  <a href="https://lagoslife.app" target="_blank" rel="noopener noreferrer">{t('landing.inspire.play')} · lagoslife.app</a>
                  <a href="https://lagoslife.net" target="_blank" rel="noopener noreferrer">{t('landing.inspire.site')} · lagoslife.net</a>
                </p>
              </li>
            </ul>
            <p className="landing-inspire-note">{t('landing.inspire.note')}</p>
          </div>
        </section>

        {/* Le Togo aux couleurs du drapeau, Lomé qui pulse sur la côte : là où commence la partie */}
        <section className="landing-final">
          <div className="landing-wrap">
            <div className="landing-final-map">
              <TogoBackdrop />
            </div>
            <div className="landing-final-text">
              <h2>{t('landing.final')}</h2>
              <button className="btn primary big landing-play" onClick={onStart} ref={finalCta}>
                <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg>
                {t(member ? 'landing.resume' : 'landing.play')}
              </button>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter>
          <div className="landing-partners">
            <span className="landing-icon"><AppGlyph id="ads" size={20} /></span>
            <p>
              <strong>{t('landing.partnersTitle')}</strong> {t('landing.partners')}
              {email && (
                <>
                  {' '}
                  {t('landing.writeUs')} <a href={`mailto:${email}`}>{email}</a>
                </>
              )}
            </p>
          </div>
      </SiteFooter>

      <div className={stuck && !finalSeen ? 'landing-sticky on' : 'landing-sticky'} aria-hidden={!stuck || finalSeen}>
        <button className="btn primary landing-play" onClick={onStart} tabIndex={stuck && !finalSeen ? 0 : -1}>
          <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg>
          {t(member ? 'landing.resume' : 'landing.play')}
        </button>
      </div>
    </div>
  );
}
