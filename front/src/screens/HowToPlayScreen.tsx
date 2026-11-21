import { useTranslation } from 'react-i18next';
import type { Locale } from '../api/types';
import { changeLang } from '../i18n';
import { HOME, HOWTO } from '../lib/pages';
import SiteFooter from '../ui/SiteFooter';
import SiteNav from '../ui/SiteNav';
import { useSiteReveal } from '../lib/useSiteReveal';

// Guide du débutant : les premiers pas, dans l'ordre où on les fait en commençant une partie
const BEGINNER = ['start', 'character', 'job', 'needs', 'bills', 'grow'] as const;
// Rubriques du guide du jeu (appli « Comment jouer » du téléphone) : mêmes textes, une seule source
const GUIDE = ['controls', 'needs', 'money', 'work', 'move', 'fuel', 'map', 'home', 'bills', 'health', 'kitchen', 'clothes', 'vip', 'currency', 'study', 'school', 'bank', 'grow', 'company', 'industry', 'tenders', 'land', 'sea', 'weather', 'trade', 'zem', 'worship', 'respect', 'guest', 'account', 'safety', 'win'] as const;
const GOALS = ['job', 'respect', 'bills', 'million', 'company', 'owner'] as const;

const Play = () => <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M8 5.5v13l10.5-6.5z" fill="currentColor" /></svg>;

/** Page publique « Comment jouer » : guide du débutant, puis tout le guide du jeu et les objectifs. */
export default function HowToPlayScreen({ onStart, member = false }: { onStart: () => void; member?: boolean }) {
  const page = useSiteReveal();
  const { t, i18n } = useTranslation();
  const lang: Locale = i18n.language === 'en' ? 'en' : 'fr';
  // Chaque langue a son adresse : la page partagée ou indexée s'ouvre dans la bonne langue
  const switchLang = (l: Locale) => {
    changeLang(l);
    window.history.replaceState(null, '', HOWTO[l]);
  };

  return (
    <div className="screen landing howto" ref={page}>
      <SiteNav current="howto" onLang={switchLang} onStart={onStart} member={member} />

      <main>
        <section className="landing-hero howto-hero">
          <div className="landing-wrap">
            <div className="landing-hero-text">
              <span className="landing-kicker">{t('howto.kicker')}</span>
              <h1>{t('howto.title')}</h1>
              <p className="landing-lead">{t('howto.intro')}</p>
              <div className="landing-cta">
                <button className="btn primary big landing-play" onClick={onStart}><Play />{t(member ? 'landing.resume' : 'landing.play')}</button>
                <a className="btn ghost" href={HOME[lang]}>{t('howto.back')}</a>
              </div>
            </div>
          </div>
        </section>

        <section className="landing-section" aria-labelledby="howto-beginner">
          <div className="landing-wrap">
            <h2 id="howto-beginner">{t('howto.beginner.title')}</h2>
            <ol className="howto-steps">
              {BEGINNER.map((k, i) => (
                <li key={k}>
                  <span className="howto-num" aria-hidden="true">{i + 1}</span>
                  <div>
                    <h3>{t(`howto.beginner.${k}.title`)}</h3>
                    <p>{t(`howto.beginner.${k}.text`)}</p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="landing-public" aria-labelledby="howto-goals">
          <div className="landing-wrap">
            <h2 id="howto-goals">{t('howto.goalsTitle')}</h2>
            <p>{t('howto.goalsText')}</p>
            <ul className="howto-goals">
              {GOALS.map((k) => (
                <li key={k}>{t(`guide.goals.${k}`)}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="landing-section" aria-labelledby="howto-guide">
          <div className="landing-wrap">
            <h2 id="howto-guide">{t('howto.guideTitle')}</h2>
            <ul className="howto-guide">
              {GUIDE.map((k) => (
                <li key={k}>
                  <h3>{t(`guide.${k}.title`)}</h3>
                  <p>{t(`guide.${k}.text`)}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="landing-final">
          <div className="landing-wrap">
            <div className="landing-final-text">
              <h2>{t('landing.final')}</h2>
              <button className="btn primary big landing-play" onClick={onStart}><Play />{t(member ? 'landing.resume' : 'landing.play')}</button>
            </div>
          </div>
        </section>
      </main>

      <SiteFooter />
    </div>
  );
}
