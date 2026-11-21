import { useEffect, useState, type FormEvent } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { forgotPassword, getProviders, googleComplete, googleDone, googleLink, googlePending, googleStartUrl, login, playAsGuest, register, resetPasswordWithToken, usernameAvailable, verifyMfa } from '../api/endpoints';
import type { Locale } from '../api/types';
import type { ReturnParams } from '../lib/urlParams';
import { changeLang, errorText } from '../i18n';
import { ageFrom, E164, EMAIL, isPasswordOk, MFA_CODE, normalizeIdentifier, normalizePhone, USERNAME } from '../lib/validate';
import { CONTACT, TERMS } from '../lib/pages';
import CurrencySwitch from '../ui/CurrencySwitch';
import LangSwitch from '../ui/LangSwitch';
import PasswordInput from '../ui/PasswordInput';
import TogoBackdrop from '../ui/TogoBackdrop';

interface Props {
  notice: string | null;
  /** Jeton du lien reçu par e-mail : ouvre directement le formulaire du nouveau mot de passe. */
  resetToken?: string | null;
  onResetDone?: () => void;
  /** Retour de Google lu dans l'adresse : finir l'inscription, confirmer son mot de passe, code 2FA, ou erreur. */
  google?: ReturnParams['google'];
  onGoogleHandled?: () => void;
  onAuthenticated: () => void;
  /** Retour à la page d'accueil (visiteur arrivé depuis celle-ci). */
  onBack?: () => void;
}

type Mode = 'login' | 'register' | 'mfa' | 'guest' | 'forgot' | 'forgotSent' | 'reset' | 'googleSignup' | 'googleLink';

/** Nom d'utilisateur proposé d'après le nom Google (ou l'adresse) : minuscules, chiffres, « _ » et « . ». */
const suggestUsername = (name: string | undefined, email: string | undefined): string => {
  const base = (name || email?.split('@')[0] || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 20);
  return USERNAME.test(base) ? base : '';
};

const GoogleMark = () => (
  <svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true">
    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
  </svg>
);

export default function AuthScreen({ notice, resetToken = null, onResetDone, google = null, onGoogleHandled, onAuthenticated, onBack }: Props) {
  const { t, i18n } = useTranslation();
  const [mode, setMode] = useState<Mode>(resetToken ? 'reset' : 'login');
  const [info, setInfo] = useState<string | null>(null);
  const [confirmPw, setConfirmPw] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Connexion
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [code, setCode] = useState('');
  // Double authentification : code de l'application (6 chiffres) ou code de secours à usage unique (10 chiffres)
  const [useBackup, setUseBackup] = useState(false);

  // Inscription
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('+228');
  const [birthDate, setBirthDate] = useState('');
  const [terms, setTerms] = useState(false);

  const fail = (e: unknown) => setError(errorText(e instanceof ApiError ? e.code : 'unknown'));

  // Disponibilité du nom d'utilisateur, vérifiée pendant la saisie (inscription classique ou via Google).
  const [usernameStatus, setUsernameStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle');
  useEffect(() => {
    if (mode !== 'register' && mode !== 'googleSignup') return;
    const un = username.trim().toLowerCase();
    if (!USERNAME.test(un)) {
      setUsernameStatus('idle');
      return;
    }
    setUsernameStatus('checking');
    const id = setTimeout(() => {
      usernameAvailable(un)
        .then((r) => setUsernameStatus(r.available ? 'available' : 'taken'))
        .catch(() => setUsernameStatus('idle'));
    }, 400);
    return () => clearTimeout(id);
  }, [mode, username]);
  const usernameHint = usernameStatus === 'checking' ? t('auth.usernameChecking')
    : usernameStatus === 'available' ? t('auth.usernameFree')
    : usernameStatus === 'taken' ? t('auth.usernameTaken')
    : t('auth.usernameHint');
  const usernameHintClass = usernameStatus === 'available' ? 'ok' : usernameStatus === 'taken' ? 'taken' : 'muted';

  // Connexion avec Google : bouton proposé seulement si le serveur est configuré ; retour de Google à traiter au chargement
  const [googleOn, setGoogleOn] = useState(false);
  useEffect(() => {
    void getProviders().then((p) => setGoogleOn(p.google)).catch(() => undefined);
    if (!google || google.step === 'ok') return;
    if (google.step === 'error') {
      setError(t(`auth.google.err.${google.reason}`));
      onGoogleHandled?.();
      return;
    }
    googlePending()
      .then((p) => {
        if (p.kind === 'signup') {
          setEmail(p.email ?? '');
          setUsername(suggestUsername(p.name, p.email));
          setMode('googleSignup');
        } else if (p.kind === 'link') {
          setEmail(p.email ?? '');
          setMode('googleLink');
        } else if (p.mfaToken) {
          setMfaToken(p.mfaToken);
          setCode('');
          setMode('mfa');
          void googleDone().catch(() => undefined);
        }
      })
      .catch((e) => fail(e))
      .finally(() => onGoogleHandled?.());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitGoogleSignup(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    const un = username.trim().toLowerCase();
    const ph = normalizePhone(phone);
    if (!USERNAME.test(un)) return setError(t('auth.invalid.username'));
    if (!E164.test(ph)) return setError(t('auth.invalid.phone'));
    const age = ageFrom(birthDate);
    if (age === null || age > 120) return setError(t('auth.invalid.birthDate'));
    if (age < 18) return setError(t('auth.invalid.underage'));
    if (!terms) return setError(t('auth.invalid.terms'));
    setBusy(true);
    try {
      await googleComplete({ username: un, phone: ph, birthDate, acceptTerms: true, locale: (i18n.language === 'en' ? 'en' : 'fr') as Locale });
      onAuthenticated();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function submitGoogleLink(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (password.length < 1 || password.length > 128) return setError(t('auth.invalid.password'));
    setBusy(true);
    try {
      const challenge = await googleLink(password);
      setPassword('');
      if (challenge) {
        setMfaToken(challenge);
        setCode('');
        setMode('mfa');
      } else onAuthenticated();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const googleButton = googleOn ? (
    <>
      <a className="btn big google-cta" href={googleStartUrl((i18n.language === 'en' ? 'en' : 'fr') as Locale)}>
        <GoogleMark /> {t('auth.google.continue')}
      </a>
      <p className="google-or" aria-hidden="true">{t('auth.google.or')}</p>
    </>
  ) : null;

  async function submitLogin(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    // Même normalisation qu'à l'inscription (téléphone sans espaces/points/tirets, e-mail en minuscules)
    const id = normalizeIdentifier(identifier);
    if (id.length < 3 || id.length > 254 || !(EMAIL.test(id) || E164.test(id) || USERNAME.test(id.toLowerCase()))) return setError(t('auth.invalid.identifier'));
    if (password.length < 1 || password.length > 128) return setError(t('auth.invalid.password'));
    setBusy(true);
    try {
      const challenge = await login(id, password);
      if (challenge) {
        setMfaToken(challenge);
        setCode('');
        setMode('mfa');
      } else {
        setPassword('');
        onAuthenticated();
      }
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function submitForgot(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    const em = email.trim().toLowerCase();
    if (!EMAIL.test(em) || em.length > 254) return setError(t('auth.invalid.email'));
    setBusy(true);
    try {
      await forgotPassword(em);
      setMode('forgotSent');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function submitReset(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!resetToken) return setMode('forgot');
    if (!isPasswordOk(password)) return setError(t('auth.invalid.password'));
    if (password !== confirmPw) return setError(t('auth.resetMismatch'));
    setBusy(true);
    try {
      await resetPasswordWithToken(resetToken, password);
      setPassword('');
      setConfirmPw('');
      setInfo(t('auth.resetDone'));
      onResetDone?.();
      setMode('login');
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function submitMfa(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    if (!MFA_CODE.test(code) || code.length !== (useBackup ? 10 : 6)) return setError(t(useBackup ? 'auth.invalid.backupCode' : 'auth.invalid.code'));
    if (!mfaToken) return setMode('login');
    setBusy(true);
    try {
      await verifyMfa(mfaToken, code);
      setMfaToken(null);
      setPassword('');
      onAuthenticated();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function submitRegister(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    const un = username.trim().toLowerCase();
    const em = email.trim().toLowerCase();
    const ph = normalizePhone(phone);
    if (!USERNAME.test(un)) return setError(t('auth.invalid.username'));
    if (!EMAIL.test(em) || em.length > 254) return setError(t('auth.invalid.email'));
    if (!E164.test(ph)) return setError(t('auth.invalid.phone'));
    if (!isPasswordOk(password)) return setError(t('auth.invalid.password'));
    const age = ageFrom(birthDate);
    if (age === null || age > 120) return setError(t('auth.invalid.birthDate'));
    if (age < 18) return setError(t('auth.invalid.underage'));
    if (!terms) return setError(t('auth.invalid.terms'));
    setBusy(true);
    try {
      const locale = (i18n.language === 'en' ? 'en' : 'fr') as Locale;
      await register({
        username: un,
        email: em,
        phone: ph,
        password,
        birthDate,
        acceptTerms: true,
        locale,
      });
      setPassword('');
      onAuthenticated();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  async function submitGuest(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    const age = ageFrom(birthDate);
    if (age === null || age > 120) return setError(t('auth.invalid.birthDate'));
    if (age < 18) return setError(t('auth.invalid.underage'));
    if (!terms) return setError(t('auth.invalid.terms'));
    setBusy(true);
    try {
      await playAsGuest(birthDate, (i18n.language === 'en' ? 'en' : 'fr') as Locale);
      onAuthenticated();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  }

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
  };

  const pwField = (autoComplete: string) => (
    <label className="field">
      <span>{t('auth.password')}</span>
      <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={autoComplete} maxLength={128} required />
      {mode === 'register' && <small>{t('auth.passwordHint')}</small>}
    </label>
  );

  // Date maximale autorisée dans le sélecteur : aujourd'hui moins 18 ans
  const now = new Date();
  const maxBirth = `${now.getFullYear() - 18}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

  return (
    <div className="screen auth">
      <TogoBackdrop />
      {onBack && (
        <button type="button" className="btn ghost auth-back" onClick={onBack}>
          ← {t('app.back')}
        </button>
      )}
      <header className="brand">
        <div className="logo">{t('app.name')}</div>
        <p>{t('app.tagline')}</p>
      </header>
      <div className="flagband" aria-hidden="true" />
      <main className="card">
        {notice && <p className="notice">{notice}</p>}
        {info && <p className="notice">{info}</p>}

        {mode === 'googleSignup' ? (
          <form onSubmit={submitGoogleSignup} noValidate>
            <h2>{t('auth.google.signupTitle')}</h2>
            <p>{t('auth.google.signupText', { email })}</p>
            <label className="field">
              <span>{t('auth.username')}</span>
              <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={20} required />
              <small className={usernameHintClass}>{usernameHint}</small>
            </label>
            <label className="field">
              <span>{t('auth.phone')}</span>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" maxLength={16} required />
              <small>{t('auth.phoneHint')}</small>
            </label>
            <label className="field">
              <span>{t('auth.birthDate')}</span>
              <input type="date" value={birthDate} max={maxBirth} min="1900-01-01" onChange={(e) => setBirthDate(e.target.value)} required />
              <small>{t('auth.birthDateHint')}</small>
            </label>
            <div className="field">
              <span>{t('auth.language')}</span>
              <LangSwitch onChange={(l) => changeLang(l)} />
            </div>
            <div className="field">
              <span>{t('auth.currency')}</span>
              <CurrencySwitch />
            </div>
            <label className="check">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} required />
              <span><Trans i18nKey="auth.acceptTerms" components={{ terms: <a href={TERMS[i18n.language === 'en' ? 'en' : 'fr']} target="_blank" rel="noopener noreferrer" /> }} /></span>
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn primary big" disabled={busy}>{t('auth.google.signupSubmit')}</button>
            <button type="button" className="btn ghost" onClick={() => { void googleDone().catch(() => undefined); switchMode('login'); }}>{t('app.back')}</button>
          </form>
        ) : mode === 'googleLink' ? (
          <form onSubmit={submitGoogleLink} noValidate>
            <h2>{t('auth.google.linkTitle')}</h2>
            <p>{t('auth.google.linkText', { email })}</p>
            {pwField('current-password')}
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn primary big" disabled={busy}>{t('auth.google.linkSubmit')}</button>
            <button type="button" className="btn link" onClick={() => switchMode('forgot')}>{t('auth.forgot')}</button>
            <button type="button" className="btn ghost" onClick={() => { void googleDone().catch(() => undefined); switchMode('login'); }}>{t('app.back')}</button>
          </form>
        ) : mode === 'forgot' ? (
          <form onSubmit={submitForgot} noValidate>
            <h2>{t('auth.forgotTitle')}</h2>
            <p>{t('auth.forgotText')}</p>
            <label className="field">
              <span>{t('auth.email')}</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} required />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn primary big" disabled={busy}>{t('auth.forgotSubmit')}</button>
            <button type="button" className="btn ghost" onClick={() => switchMode('login')}>{t('app.back')}</button>
          </form>
        ) : mode === 'forgotSent' ? (
          <div>
            <h2>📬 {t('auth.forgotSentTitle')}</h2>
            <p>{t('auth.forgotSentText', { email: email.trim().toLowerCase() })}</p>
            <button type="button" className="btn primary big" onClick={() => switchMode('login')}>{t('app.back')}</button>
          </div>
        ) : mode === 'reset' ? (
          <form onSubmit={submitReset} noValidate>
            <h2>{t('auth.resetTitle')}</h2>
            <p>{t('auth.resetText')}</p>
            <label className="field">
              <span>{t('auth.resetNew')}</span>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" maxLength={128} required />
              <small>{t('auth.passwordHint')}</small>
            </label>
            <label className="field">
              <span>{t('auth.resetConfirm')}</span>
              <PasswordInput value={confirmPw} onChange={(e) => setConfirmPw(e.target.value)} autoComplete="new-password" maxLength={128} required />
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn primary big" disabled={busy}>{t('auth.resetSubmit')}</button>
            <button type="button" className="btn ghost" onClick={() => { onResetDone?.(); switchMode('login'); }}>{t('app.back')}</button>
          </form>
        ) : mode === 'mfa' ? (
          <form onSubmit={submitMfa} noValidate>
            <h2>{t('auth.mfaTitle')}</h2>
            <p>{useBackup ? t('auth.mfaBackupText') : t('auth.mfaText')}</p>
            <label className="field">
              <span>{useBackup ? t('auth.mfaBackupCode') : t('auth.mfaCode')}</span>
              <input
                key={useBackup ? 'backup' : 'totp'}
                inputMode="numeric"
                autoComplete={useBackup ? 'off' : 'one-time-code'}
                pattern={useBackup ? '\\d{10}' : '\\d{6}'}
                maxLength={useBackup ? 14 : 6}
                placeholder={useBackup ? '0000000000' : '000000'}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, useBackup ? 10 : 6))}
                autoFocus
                required
              />
              {useBackup && <small className="muted">{t('auth.mfaBackupHelp')}</small>}
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn primary big" disabled={busy}>{t('auth.mfaSubmit')}</button>
            <button type="button" className="btn ghost" onClick={() => { setUseBackup((v) => !v); setCode(''); setError(null); }}>
              {useBackup ? t('auth.mfaUseApp') : t('auth.mfaLostPhone')}
            </button>
            {useBackup && (
              <p className="muted" role="note">
                {t('auth.mfaNoCodes')} <a href={CONTACT[i18n.language === 'en' ? 'en' : 'fr']}>{t('auth.mfaContact')}</a>
              </p>
            )}
            <button type="button" className="btn ghost" onClick={() => { setUseBackup(false); setCode(''); switchMode('login'); }}>{t('app.back')}</button>
          </form>
        ) : mode === 'guest' ? (
          <form onSubmit={submitGuest} noValidate>
            <h2>{t('guest.title')}</h2>
            <p>{t('guest.text')}</p>
            <ul className="guest-limits">
              <li>✅ {t('guest.can')}</li>
              <li>🔒 {t('guest.cannot')}</li>
              <li>💾 {t('guest.keep')}</li>
            </ul>
            <label className="field">
              <span>{t('auth.birthDate')}</span>
              <input type="date" value={birthDate} max={maxBirth} min="1900-01-01" onChange={(e) => setBirthDate(e.target.value)} required />
              <small>{t('auth.birthDateHint')}</small>
            </label>
            <label className="check">
              <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} required />
              <span><Trans i18nKey="auth.acceptTerms" components={{ terms: <a href={TERMS[i18n.language === 'en' ? 'en' : 'fr']} target="_blank" rel="noopener noreferrer" /> }} /></span>
            </label>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn primary big" disabled={busy}>▶️ {t('guest.start')}</button>
            <button type="button" className="btn ghost" onClick={() => switchMode('login')}>{t('app.back')}</button>
          </form>
        ) : (
          <>
            <button type="button" className="btn big guest-cta" onClick={() => switchMode('guest')}>▶️ {t('guest.cta')}</button>
            {googleButton}
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={mode === 'login'} className={mode === 'login' ? 'tab active' : 'tab'} onClick={() => switchMode('login')}>
                {t('auth.login')}
              </button>
              <button role="tab" aria-selected={mode === 'register'} className={mode === 'register' ? 'tab active' : 'tab'} onClick={() => switchMode('register')}>
                {t('auth.register')}
              </button>
            </div>

            {mode === 'login' ? (
              <form onSubmit={submitLogin} noValidate>
                <label className="field">
                  <span>{t('auth.identifier')}</span>
                  <input
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    autoComplete="username"
                    maxLength={254}
                    placeholder={t('auth.identifierHint')}
                    required
                  />
                </label>
                {pwField('current-password')}
                {error && <p className="error" role="alert">{error}</p>}
                <button className="btn primary big" disabled={busy}>{t('auth.submitLogin')}</button>
                <button type="button" className="btn link" onClick={() => switchMode('forgot')}>{t('auth.forgot')}</button>
                <button type="button" className="btn link" onClick={() => switchMode('register')}>{t('auth.noAccount')}</button>
              </form>
            ) : (
              <form onSubmit={submitRegister} noValidate>
                <label className="field">
                  <span>{t('auth.username')}</span>
                  <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={20} required />
                  <small className={usernameHintClass}>{usernameHint}</small>
                </label>
                <label className="field">
                  <span>{t('auth.email')}</span>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} required />
                  <small>{t('auth.emailHint')}</small>
                </label>
                <label className="field">
                  <span>{t('auth.phone')}</span>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" maxLength={16} required />
                  <small>{t('auth.phoneHint')}</small>
                </label>
                {pwField('new-password')}
                <label className="field">
                  <span>{t('auth.birthDate')}</span>
                  <input type="date" value={birthDate} max={maxBirth} min="1900-01-01" onChange={(e) => setBirthDate(e.target.value)} required />
                  <small>{t('auth.birthDateHint')}</small>
                </label>
                <div className="field">
                  <span>{t('auth.language')}</span>
                  <LangSwitch onChange={(l) => changeLang(l)} />
                </div>
                <div className="field">
                  <span>{t('auth.currency')}</span>
                  <CurrencySwitch />
                </div>
                <label className="check">
                  <input type="checkbox" checked={terms} onChange={(e) => setTerms(e.target.checked)} required />
                  <span><Trans i18nKey="auth.acceptTerms" components={{ terms: <a href={TERMS[i18n.language === 'en' ? 'en' : 'fr']} target="_blank" rel="noopener noreferrer" /> }} /></span>
                </label>
                {error && <p className="error" role="alert">{error}</p>}
                <button className="btn primary big" disabled={busy}>{t('auth.submitRegister')}</button>
                <button type="button" className="btn link" onClick={() => switchMode('login')}>{t('auth.haveAccount')}</button>
              </form>
            )}
          </>
        )}
      </main>
    </div>
  );
}
