import { setCurrency } from './lib/currency';
import { goAdmin, wantsAdmin } from './lib/adminNav';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { refreshSession, setAuthLostHandler, ApiError } from './api/client';
import { getCharacter, getMe, logout } from './api/endpoints';
import type { Me, State } from './api/types';
import i18n, { changeLang } from './i18n';
import { hadSession, setHadSession } from './lib/prefs';
import { consumeReturnParams, type ReturnParams } from './lib/urlParams';
import AuthScreen from './screens/AuthScreen';
import HowToPlayScreen from './screens/HowToPlayScreen';
import TermsScreen from './screens/TermsScreen';
import AdsScreen from './screens/AdsScreen';
import ContactScreen from './screens/ContactScreen';
import LandingScreen from './screens/LandingScreen';
import { ADS, browsingSite, HOME, isPublicPage, setBrowsingSite, sitePage, wantsBook } from './lib/pages';
import { Splash } from './ui/Splash';

// Le jeu (Three.js, ≈ 1,4 Mo) et la création du personnage (aperçu 3D) sont chargés à part :
// la page d'accueil et la connexion s'affichent vite, même en 3G.
const GameScreen = lazy(() => import('./screens/GameScreen'));
const CreateCharacter = lazy(() => import('./screens/CreateCharacter'));

// Back-office : chargé à part, seulement pour les comptes ADMIN
const AdminScreen = lazy(() => import('./screens/AdminScreen'));
// Initialisation d'une nouvelle installation (/init) : chargée à part, elle ne sert qu'une fois
const InitScreen = lazy(() => import('./screens/InitScreen'));
// Réservation d'un espace de pub depuis le site : chargée à part (elle reprend les formulaires et l'aperçu du jeu)
const BookAdScreen = lazy(() => import('./screens/BookAdScreen'));
const wantsInit = window.location.pathname.replace(/\/+$/, '') === '/init';

// Paiement simulé : développement uniquement. En production, `import.meta.env.DEV` vaut `false`,
// la branche est éliminée et le composant n'entre pas dans le bundle.
const MockPay = import.meta.env.DEV ? lazy(() => import('./screens/MockPay')) : null;

type Phase = 'boot' | 'offline' | 'landing' | 'auth' | 'create' | 'game' | 'mockPay' | 'admin' | 'book';

// Paramètres de retour de paiement lus une seule fois, avant tout rendu, puis effacés de l'URL.
const initialParams: ReturnParams = consumeReturnParams();

/** Erreur passagère (réseau, 429, 5xx) : on ne déconnecte pas l'utilisateur. */
const isTransient = (e: unknown) =>
  e instanceof ApiError && (e.code === 'network_error' || e.status === 0 || e.status === 429 || e.status >= 500);

export default function App() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>('boot');
  const [me, setMe] = useState<Me | null>(null);
  const [state, setState] = useState<State | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const params = useRef<ReturnParams>(initialParams);
  const [resetToken, setResetToken] = useState<string | null>(initialParams.reset);
  const [pendingPurchase, setPendingPurchase] = useState<string | null>(initialParams.purchase);
  // Connexion ouverte depuis la page d'accueil : un bouton permet d'y revenir
  const [fromLanding, setFromLanding] = useState(false);
  // Page publique ouverte directement (lien, moteur de recherche) : « Comment jouer » ou les conditions d'utilisation
  const [page, setPage] = useState(sitePage);
  const howTo = page === 'howto';
  // Joueur connecté qui parcourt le site (venu des Réglages du jeu) : « Reprendre ma partie » le ramène dans le jeu
  const [member, setMember] = useState(false);

  // Perte de session en cours de partie (déconnexion, expiration…) : pas d'écran précédent à retrouver,
  // donc « retour » doit ramener au site plutôt que rester sans bouton.
  const [kickedOut, setKickedOut] = useState(false);
  const goAuth = useCallback((msg?: string) => {
    setMe(null);
    setState(null);
    setNotice(msg ?? null);
    setKickedOut(true);
    setPhase('auth');
  }, []);

  /** Après authentification : charge le compte, applique sa langue, choisit l'écran. */
  const enter = useCallback(async () => {
    try {
      const m = await getMe();
      setMe(m);
      if (m.locale === 'fr' || m.locale === 'en') changeLang(m.locale);
      if (m.currency) setCurrency(m.currency);
      if (MockPay && params.current.mockPay) {
        setPhase('mockPay');
        return;
      }
      if (m.role === 'ADMIN' && wantsAdmin()) {
        setPhase('admin');
        return;
      }
      // /admin sans être administrateur (invité ou joueur) : proposer la connexion à un compte administrateur plutôt que la partie
      if (wantsAdmin()) {
        setNotice(i18n.t('admin.loginNeeded'));
        setPhase('auth');
        return;
      }
      // Réservation d'une pub depuis le site : pas besoin de personnage
      if (wantsBook()) {
        setPhase('book');
        return;
      }
      if (!m.hasCharacter) {
        setPhase('create');
        return;
      }
      setState(await getCharacter());
      setPhase('game');
    } catch (e) {
      if (e instanceof ApiError && e.code === 'no_character') setPhase('create');
      else if (isTransient(e)) setPhase('offline');
      else goAuth();
    }
  }, [goAuth]);

  /** Restauration de session au démarrage, uniquement si une session a existé sur cet appareil. */
  const boot = useCallback(async () => {
    // Retour de Google : session déjà ouverte côté serveur (on la restaure), ou suite à donner sur l'écran de connexion.
    const g = params.current.google;
    if (g?.step === 'ok') setHadSession(true);
    else if (g) {
      setPhase('auth');
      return;
    }
    // Lien de réinitialisation reçu par e-mail : on affiche tout de suite le formulaire du nouveau mot de passe.
    if (params.current.reset) {
      setPhase('auth');
      return;
    }
    // Joueur connecté revenu sur le site depuis le jeu : la page demandée, sans relancer la partie
    if (hadSession() && browsingSite() && isPublicPage()) {
      setMember(true);
      setPhase('landing');
      return;
    }
    // Visiteur sans session : page d'accueil (sauf s'il vient pour le back-office ou pour réserver une pub)
    if (!hadSession()) {
      if (wantsBook()) setNotice(i18n.t('siteBook.loginNeeded'));
      setPhase(wantsAdmin() || wantsBook() ? 'auth' : 'landing');
      return;
    }
    setPhase('boot');
    // Réveil de l'API chez l'hébergeur, réseau 3G qui décroche : quelques essais espacés avant d'afficher « hors ligne »
    let r = await refreshSession();
    for (const wait of [1500, 4000]) {
      if (r !== 'transient') break;
      await new Promise((ok) => setTimeout(ok, wait));
      r = await refreshSession();
    }
    if (r === 'ok') await enter();
    else if (r === 'transient') setPhase('offline');
    else {
      setHadSession(false);
      setKickedOut(true);
      setPhase('auth');
    }
  }, [enter]);

  useEffect(() => {
    setAuthLostHandler(() => goAuth(t('errors.session_expired')));
    return () => setAuthLostHandler(null);
  }, [goAuth, t]);

  useEffect(() => {
    if (!wantsInit) void boot();
  }, [boot]);

  // /admin ↔ jeu : on bascule sans recharger la page
  useEffect(() => {
    const onHash = () => {
      if (wantsAdmin() && me?.role === 'ADMIN') setPhase('admin');
      else if (!wantsAdmin() && phase === 'admin') void enter();
    };
    window.addEventListener('hashchange', onHash);
    window.addEventListener('popstate', onHash);
    return () => {
      window.removeEventListener('hashchange', onHash);
      window.removeEventListener('popstate', onHash);
    };
  }, [me, phase, enter]);

  if (wantsInit) {
    return (
      <Suspense fallback={null}>
        <InitScreen />
      </Suspense>
    );
  }
  // Bouton principal des pages publiques : un joueur connecté reprend sa partie, un visiteur va à la connexion
  const start = () => {
    if (member) {
      setBrowsingSite(false);
      setMember(false);
      void boot();
      return;
    }
    setFromLanding(true);
    setPhase('auth');
  };
  const loading = <Splash />;
  if (phase === 'boot') return loading;
  if (phase === 'offline') {
    return <Offline onRetry={() => void boot()} />;
  }
  if (phase === 'admin') {
    return (
      <Suspense fallback={loading}>
        <AdminScreen
          onExit={() => goAdmin(false)}
        />
      </Suspense>
    );
  }
  if (phase === 'book' && me) {
    return (
      <Suspense fallback={loading}>
        <BookAdScreen
          me={me}
          onLogout={() => {
            // Compte invité : on le quitte pour se connecter ou créer un vrai compte, puis on revient ici
            void logout().finally(() => goAuth(i18n.t('siteBook.loginNeeded')));
          }}
        />
      </Suspense>
    );
  }
  // Conditions d'utilisation : lisibles par tous, joueur connecté compris (lien de l'inscription, des Réglages…)
  if (page === 'terms') return <TermsScreen />;
  // Annonces en ligne et contact : de même pour tous
  if (page === 'ads') return <AdsScreen paid={pendingPurchase !== null} />;
  if (page === 'contact') return <ContactScreen />;
  if (phase === 'landing' && howTo) {
    return (
      <HowToPlayScreen
        member={member}
        onStart={() => {
          // On quitte la page du guide : l'adresse redevient celle de l'accueil, puis la partie ou la connexion s'ouvre
          window.history.replaceState(null, '', i18n.language === 'en' ? HOME.en : HOME.fr);
          setPage('home');
          start();
        }}
      />
    );
  }
  if (phase === 'landing') return <LandingScreen member={member} onStart={start} />;
  if (phase === 'auth') return <AuthScreen notice={notice} resetToken={resetToken} google={params.current.google} onGoogleHandled={() => { params.current = { ...params.current, google: null }; }} onResetDone={() => { params.current = { ...params.current, reset: null }; setResetToken(null); }} onAuthenticated={() => void enter()} onBack={wantsBook() ? () => window.location.assign(ADS[i18n.language === 'en' ? 'en' : 'fr']) : wantsAdmin() ? () => window.location.assign(HOME[i18n.language === 'en' ? 'en' : 'fr']) : fromLanding ? () => setPhase('landing') : kickedOut ? () => window.location.assign(HOME[i18n.language === 'en' ? 'en' : 'fr']) : undefined} />;
  if (phase === 'mockPay' && MockPay && params.current.mockPay) {
    return (
      <Suspense fallback={loading}>
        <MockPay
          purchaseId={params.current.mockPay}
          onDone={(paidId) => {
            params.current = { mockPay: null, purchase: null, reset: null, google: null };
            setPendingPurchase(paidId);
            void enter();
          }}
        />
      </Suspense>
    );
  }
  if (phase === 'create') {
    return (
      <Suspense fallback={loading}>
        <CreateCharacter
          onCreated={(s) => {
            setState(s);
            setPhase('game');
          }}
        />
      </Suspense>
    );
  }
  if (phase === 'game' && state && me) {
    return (
      <Suspense fallback={loading}>
        <GameScreen
          me={me}
          initialState={state}
          pendingPurchase={pendingPurchase}
          onPurchaseHandled={() => setPendingPurchase(null)}
          onLoggedOut={(msg) => goAuth(msg)}
        />
      </Suspense>
    );
  }
  return null;
}

/** Serveur injoignable : nouvel essai automatique toutes les 15 s (et dès que le réseau revient), ou tout de suite au bouton. */
function Offline({ onRetry }: { onRetry: () => void }) {
  const { t } = useTranslation();
  const [left, setLeft] = useState(15);
  useEffect(() => {
    const id = window.setInterval(() => setLeft((n) => (n <= 1 ? 0 : n - 1)), 1000);
    const back = () => onRetry();
    window.addEventListener('online', back);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('online', back);
    };
  }, [onRetry]);
  useEffect(() => {
    if (left === 0) onRetry();
  }, [left, onRetry]);
  return (
    <div className="screen offline">
      <header className="brand">
        <div className="logo">{t('app.name')}</div>
      </header>
      <main className="card">
        <h1>{t('app.offlineTitle')}</h1>
        <p>{t('app.offlineText')}</p>
        <p className="muted">{t('app.autoRetry', { n: left })}</p>
        <button className="btn primary big" onClick={onRetry}>
          {t('app.retry')}
        </button>
      </main>
    </div>
  );
}
