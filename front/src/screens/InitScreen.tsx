import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ApiError } from '../api/client';
import { getInitStatus, runInit } from '../api/endpoints';
import i18n, { changeLang, errorText } from '../i18n';
import LangSwitch from '../ui/LangSwitch';
import PasswordInput from '../ui/PasswordInput';

type Status = 'loading' | 'disabled' | 'done' | 'form' | 'success';

/**
 * Page /init : initialise une nouvelle installation (base de données, données du jeu) et crée le premier administrateur.
 * Demande le mot de passe d'initialisation (INIT_SECRET du serveur) ; inutilisable une fois un administrateur créé.
 */
export default function InitScreen() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<Status>('loading');
  const [secret, setSecret] = useState('');
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('+228');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [birthDate, setBirthDate] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const maxBirth = new Date(Date.now() - 18 * 365.25 * 86_400_000).toISOString().slice(0, 10);

  useEffect(() => {
    getInitStatus()
      .then((s) => setStatus(!s.enabled ? 'disabled' : s.initialized ? 'done' : 'form'))
      .catch(() => setStatus('disabled'));
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError(t('init.mismatch'));
    setBusy(true);
    setError(null);
    try {
      await runInit({ secret, username, email, phone, password, birthDate, locale: i18n.language === 'en' ? 'en' : 'fr' });
      setStatus('success');
    } catch (err) {
      setError(errorText(err instanceof ApiError ? err.code : 'unknown'));
    } finally {
      setBusy(false);
    }
  };

  const message = (title: string, text: string) => (
    <>
      <h2>{title}</h2>
      <p>{text}</p>
      <a className="btn primary big" href="/">{t('init.toGame')}</a>
    </>
  );

  return (
    <div className="screen auth">
      <header className="brand">
        <div className="logo">{t('app.name')}</div>
        <p>{t('init.subtitle')}</p>
      </header>
      <div className="flagband" aria-hidden="true" />
      <main className="card">
        {status === 'loading' && <p className="muted">{t('app.loading')}</p>}
        {status === 'disabled' && message(t('init.disabledTitle'), t('init.disabledText'))}
        {status === 'done' && message(t('init.doneTitle'), t('init.doneText'))}
        {status === 'success' && message(t('init.successTitle'), t('init.successText'))}
        {status === 'form' && (
          <form onSubmit={(e) => void submit(e)} noValidate>
            <h2>{t('init.title')}</h2>
            <p>{t('init.intro')}</p>
            <label className="field">
              <span>{t('init.secret')}</span>
              <PasswordInput value={secret} onChange={(e) => setSecret(e.target.value)} autoComplete="off" required />
              <small>{t('init.secretHint')}</small>
            </label>
            <h3>{t('init.adminTitle')}</h3>
            <label className="field">
              <span>{t('auth.username')}</span>
              <input value={username} onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, ''))} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={20} required />
              <small>{t('auth.usernameHint')}</small>
            </label>
            <label className="field">
              <span>{t('auth.email')}</span>
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" maxLength={254} required />
            </label>
            <label className="field">
              <span>{t('auth.phone')}</span>
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" maxLength={16} required />
              <small>{t('auth.phoneHint')}</small>
            </label>
            <label className="field">
              <span>{t('auth.password')}</span>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={10} maxLength={128} required />
              <small>{t('init.passwordHint')}</small>
            </label>
            <label className="field">
              <span>{t('init.confirm')}</span>
              <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" maxLength={128} required />
            </label>
            <label className="field">
              <span>{t('auth.birthDate')}</span>
              <input type="date" value={birthDate} max={maxBirth} min="1900-01-01" onChange={(e) => setBirthDate(e.target.value)} required />
            </label>
            <div className="field">
              <span>{t('auth.language')}</span>
              <LangSwitch onChange={(l) => changeLang(l)} />
            </div>
            {error && <p className="error" role="alert">{error}</p>}
            <button className="btn primary big" disabled={busy}>{busy ? t('init.running') : t('init.submit')}</button>
          </form>
        )}
      </main>
    </div>
  );
}
