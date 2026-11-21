import { goAdmin } from '../lib/adminNav';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  changePassword, deleteAccount, restartLife, upgradeAccount, exportData, logout, logoutAll, regenerateBackupCodes, setLocale, setCurrencyPref, totpDisable, totpEnable, totpSetup,
} from '../api/endpoints';
import type { Locale } from '../api/types';
import { changeLang } from '../i18n';
import type { Quality } from '../lib/prefs';
import { E164, EMAIL, isPasswordOk, normalizePhone, OTP, USERNAME } from '../lib/validate';
import { downloadText } from '../lib/download';
import LangSwitch from '../ui/LangSwitch';
import CurrencySwitch from '../ui/CurrencySwitch';
import { replayTour } from '../lib/tour';
import { HOME, setBrowsingSite, TERMS } from '../lib/pages';
import { useGame } from './ctx';
import PasswordInput from '../ui/PasswordInput';
import TotpSetup from '../ui/TotpSetup';
import { isRealisticPeople } from '../game/kit';
import { saveRealPeople } from '../lib/prefs';

const QUALITIES: Quality[] = ['low', 'medium', 'high'];

export default function SettingsApp() {
  const { t, i18n } = useTranslation();
  const { me, quality, setQuality, run, busy, logout: goOut, toast, openApp, closePhone, openLook } = useGame();
  // Changer la qualité reconstruit toute la scène 3D, ce qui fige l'écran un instant : le bouton choisi s'allume d'abord,
  // puis le changement est appliqué à l'image suivante (sinon le bouton semblait mettre du temps à réagir).
  const [pickedQ, setPickedQ] = useState<Quality | null>(null);
  const shownQ = pickedQ ?? quality;
  const applyingQ = pickedQ !== null && pickedQ !== quality;
  const pickQuality = (q: Quality) => {
    if (q === quality) return;
    setPickedQ(q);
    window.requestAnimationFrame(() =>
      window.setTimeout(() => {
        setQuality(q);
        setPickedQ(null);
      }, 60),
    );
  };
  const [confirmAll, setConfirmAll] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [password, setPassword] = useState('');

  // Changement de mot de passe
  const [pwOpen, setPwOpen] = useState(false);
  const [pwCurrent, setPwCurrent] = useState('');
  const [pwNext, setPwNext] = useState('');
  const [pwConfirm, setPwConfirm] = useState('');
  const [pwError, setPwError] = useState<string | null>(null);

  // Double authentification
  const [totpOpen, setTotpOpen] = useState(false);
  const [totpPassword, setTotpPassword] = useState('');
  const [totp, setTotp] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [totpError, setTotpError] = useState<string | null>(null);
  // Codes de secours (téléphone perdu) : montrés une seule fois, à l'activation ou après régénération.
  const [backupCodes, setBackupCodes] = useState<string[] | null>(null);
  // true seulement juste après l'activation (toutes les sessions viennent d'être révoquées) : « continuer » doit alors
  // déconnecter côté client aussi ; après une simple régénération, la session en cours reste valable.
  const [backupForcesLogout, setBackupForcesLogout] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  // Après une régénération, le compteur du serveur n'est relu qu'au prochain chargement : on affiche le nombre connu
  const [leftNow, setLeftNow] = useState<number | null>(null);
  const [backupPassword, setBackupPassword] = useState('');
  const [backupError, setBackupError] = useState<string | null>(null);
  // Désactivation volontaire de la 2FA.
  const [disableOpen, setDisableOpen] = useState(false);
  const [disablePassword, setDisablePassword] = useState('');
  const [disableError, setDisableError] = useState<string | null>(null);

  async function onLang(l: Locale) {
    changeLang(l);
    await run(() => setLocale(l));
  }

  async function doExport() {
    const data = await run(exportData);
    if (data === null) return;
    // Téléchargement local d'un fichier JSON (blob same-origin, aucune ressource externe)
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'agbe-export.json';
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast(t('settings.exportDone'));
  }

  // Déconnexion : en cas d'échec (429, réseau, 5xx), on RESTE connecté et l'erreur traduite s'affiche.
  async function doLogout() {
    const ok = await run(async () => {
      await logout();
      return true;
    });
    if (ok) goOut();
  }

  async function doRestart() {
    const ok = await run(async () => {
      await restartLife();
      return true;
    });
    if (ok) window.location.reload();
  }

  async function doLogoutAll() {
    const ok = await run(async () => {
      await logoutAll();
      return true;
    });
    if (ok) goOut();
  }

  async function doDelete(ev: FormEvent) {
    ev.preventDefault();
    if (password.length < 1 || password.length > 128) return;
    const r = await run(async () => {
      await deleteAccount(password);
      return true;
    });
    setPassword('');
    if (r) goOut(t('settings.deleted'));
  }

  async function doChangePassword(ev: FormEvent) {
    ev.preventDefault();
    setPwError(null);
    if (pwCurrent.length < 1 || pwCurrent.length > 128) return setPwError(t('auth.invalid.password'));
    if (!isPasswordOk(pwNext)) return setPwError(t('auth.invalid.password'));
    if (pwNext !== pwConfirm) return setPwError(t('settings.passwordMismatch'));
    if (pwNext === pwCurrent) return setPwError(t('settings.passwordSame'));
    const ok = await run(async () => {
      await changePassword(pwCurrent, pwNext);
      return true;
    });
    setPwCurrent('');
    setPwNext('');
    setPwConfirm('');
    if (ok) goOut(t('settings.passwordChanged'));
  }

  async function doTotpSetup(ev: FormEvent) {
    ev.preventDefault();
    setTotpError(null);
    if (totpPassword.length < 1 || totpPassword.length > 128) return setTotpError(t('auth.invalid.password'));
    const r = await run(() => totpSetup(totpPassword));
    setTotpPassword('');
    if (r && typeof r.secret === 'string' && typeof r.otpauthUrl === 'string') setTotp(r);
  }

  async function doTotpEnable(ev: FormEvent) {
    ev.preventDefault();
    setTotpError(null);
    if (!OTP.test(totpCode)) return setTotpError(t('auth.invalid.code'));
    const r = await run(() => totpEnable(totpCode));
    setTotpCode('');
    if (r) {
      setTotp(null);
      // Codes de secours à noter avant la déconnexion forcée (toutes les sessions sont révoquées par l'activation) :
      // on affiche d'abord l'écran « note tes codes », qui ne se ferme vers la connexion que lorsqu'on le confirme.
      setBackupForcesLogout(true);
      setBackupCodes(r.backupCodes);
    }
  }

  function closeBackupCodes() {
    setBackupCodes(null);
    if (backupForcesLogout) goOut(t('settings.totpEnabled'));
  }

  async function doRegenerateBackupCodes(ev: FormEvent) {
    ev.preventDefault();
    setBackupError(null);
    if (backupPassword.length < 1 || backupPassword.length > 128) return setBackupError(t('auth.invalid.password'));
    const r = await run(() => regenerateBackupCodes(backupPassword));
    setBackupPassword('');
    if (r) {
      setBackupOpen(false);
      setBackupForcesLogout(false);
      setLeftNow(r.backupCodes.length);
      setBackupCodes(r.backupCodes);
    }
  }

  // Désactivation volontaire : toutes les sessions sont révoquées par le serveur, on déconnecte donc aussi ici.
  async function doTotpDisable(ev: FormEvent) {
    ev.preventDefault();
    setDisableError(null);
    if (disablePassword.length < 1 || disablePassword.length > 128) return setDisableError(t('auth.invalid.password'));
    const ok = await run(async () => {
      await totpDisable(disablePassword);
      return true;
    });
    setDisablePassword('');
    if (ok) goOut(t('settings.totpDisabled'));
  }

  // Invité : création du compte en gardant la partie
  const [up, setUp] = useState({ username: '', email: '', phone: '+228', password: '' });
  const [upError, setUpError] = useState<string | null>(null);
  async function doUpgrade(ev: FormEvent) {
    ev.preventDefault();
    setUpError(null);
    const username = up.username.trim().toLowerCase();
    if (!USERNAME.test(username)) return setUpError(t('auth.invalid.username'));
    const email = up.email.trim().toLowerCase();
    const phone = normalizePhone(up.phone);
    if (!EMAIL.test(email) || email.length > 254) return setUpError(t('auth.invalid.email'));
    if (!E164.test(phone)) return setUpError(t('auth.invalid.phone'));
    if (!isPasswordOk(up.password)) return setUpError(t('auth.invalid.password'));
    const ok = await run(async () => {
      await upgradeAccount(username, email, phone, up.password);
      return true;
    }, () => t('guest.upgraded'));
    if (ok) window.setTimeout(() => window.location.reload(), 1200);
  }

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('settings.copied'));
    } catch {
      /* presse-papiers indisponible : le texte reste sélectionnable */
    }
  }

  return (
    <section>
      {me?.guest && (
        <form className="panel guest-banner" onSubmit={doUpgrade} noValidate>
          <h3>💾 {t('guest.upgradeTitle')}</h3>
          <p className="small-line">{t('guest.banner')} {t('guest.upgradeText')}</p>
          <label className="field">
            <span>{t('auth.username')}</span>
            <input value={up.username} onChange={(e) => setUp({ ...up, username: e.target.value.toLowerCase().replace(/[^a-z0-9_.]/g, '') })} autoComplete="username" autoCapitalize="none" spellCheck={false} maxLength={20} />
            <small>{t('auth.usernameHint')}</small>
          </label>
          <label className="field">
            <span>{t('auth.email')}</span>
            <input type="email" value={up.email} onChange={(e) => setUp({ ...up, email: e.target.value })} autoComplete="email" maxLength={254} />
          </label>
          <label className="field">
            <span>{t('auth.phone')}</span>
            <input type="tel" value={up.phone} onChange={(e) => setUp({ ...up, phone: e.target.value })} autoComplete="tel" maxLength={16} />
          </label>
          <label className="field">
            <span>{t('auth.password')}</span>
            <PasswordInput value={up.password} onChange={(e) => setUp({ ...up, password: e.target.value })} autoComplete="new-password" maxLength={128} />
            <small>{t('auth.passwordHint')}</small>
          </label>
          {upError && <p className="error" role="alert">{upError}</p>}
          <button className="btn primary big" disabled={busy}>{t('guest.upgrade')}</button>
        </form>
      )}
      <button className="btn primary big" onClick={() => { openApp(null); openLook(); }}>🧍🏾 {t('look.edit')}</button>
      {me.role === 'ADMIN' && (
        <div className="panel">
          <h3>🛠️ {t('admin.title')}</h3>
          <p className="muted">{t('admin.entryText')}</p>
          <button className="btn primary big" onClick={() => goAdmin(true)}>{t('admin.open')}</button>
        </div>
      )}
      <h2>{t('settings.title')}</h2>
      <div className="panel">
        <h3>{t('settings.language')}</h3>
        <LangSwitch onChange={(l) => void onLang(l)} />
      </div>
      <div className="panel">
        <h3>{t('settings.currency')}</h3>
        <CurrencySwitch onChange={(c) => void run(() => setCurrencyPref(c))} />
        <small className="muted">{t('settings.currencyHint')}</small>
      </div>
      <div className="panel">
        <h3>{t('settings.people')}</h3>
        <div className="segmented" role="group">
          {([true, false] as const).map((on) => (
            <button key={String(on)} type="button" className={isRealisticPeople() === on ? 'seg active' : 'seg'} aria-pressed={isRealisticPeople() === on} onClick={() => { if (isRealisticPeople() !== on) { saveRealPeople(on); window.location.reload(); } }}>
              {t(on ? 'settings.peopleReal' : 'settings.peopleClassic')}
            </button>
          ))}
        </div>
        <small className="muted">{t('settings.peopleHint')}</small>
      </div>

      <div className="panel">
        <h3>{t('settings.quality')}</h3>
        <div className="segmented" role="group">
          {QUALITIES.map((q) => (
            <button key={q} type="button" className={shownQ === q ? 'seg active' : 'seg'} aria-pressed={shownQ === q} aria-busy={applyingQ} disabled={applyingQ} onClick={() => pickQuality(q)}>
              {t(`settings.qualities.${q}`)}
            </button>
          ))}
        </div>
        <small className="muted">{applyingQ ? t('settings.qualityApplying') : t('settings.qualityHint')}</small>
        <button className="btn" onClick={() => (closePhone(), replayTour())}>{t('tour.replay')}</button>
        <button
          className="btn"
          onClick={() => {
            // Présentation et guide du jeu, puis « Reprendre ma partie » pour revenir
            setBrowsingSite(true);
            window.location.assign(i18n.language === 'en' ? HOME.en : HOME.fr);
          }}
        >
          {t('settings.site')}
        </button>
        <a className="btn" href={TERMS[i18n.language === 'en' ? 'en' : 'fr']} target="_blank" rel="noopener noreferrer">{t('terms.link')}</a>
      </div>

      {!me.guest && <div className="panel">
        <h3>{t('settings.security')}</h3>
        {pwOpen ? (
          <form className="confirm" onSubmit={doChangePassword} noValidate>
            <label className="field">
              <span>{t('settings.currentPassword')}</span>
              <PasswordInput value={pwCurrent} onChange={(e) => setPwCurrent(e.target.value)} autoComplete="current-password" maxLength={128} required />
            </label>
            <label className="field">
              <span>{t('settings.newPassword')}</span>
              <PasswordInput value={pwNext} onChange={(e) => setPwNext(e.target.value)} autoComplete="new-password" maxLength={128} required />
              <small>{t('auth.passwordHint')}</small>
            </label>
            <label className="field">
              <span>{t('settings.confirmPassword')}</span>
              <PasswordInput value={pwConfirm} onChange={(e) => setPwConfirm(e.target.value)} autoComplete="new-password" maxLength={128} required />
            </label>
            {pwError && <p className="error" role="alert">{pwError}</p>}
            <button className="btn primary big" disabled={busy}>{t('settings.passwordSubmit')}</button>
            <button type="button" className="btn ghost" onClick={() => setPwOpen(false)}>{t('app.cancel')}</button>
          </form>
        ) : (
          <button className="btn big" onClick={() => setPwOpen(true)}>{t('settings.passwordTitle')}</button>
        )}

        {backupCodes ? (
          <div className="confirm danger-zone">
            <strong>{t('settings.backupTitle')}</strong>
            <p>{t('settings.backupIntro')}</p>
            <ul className="list stacked">
              {backupCodes.map((c) => (
                <li key={c}><code className="mono selectable">{c}</code></li>
              ))}
            </ul>
            <div className="copy-row">
              <button type="button" className="btn small" onClick={() => void copy(backupCodes.join('\n'))}>{t('settings.copy')}</button>
              <button type="button" className="btn small" onClick={() => downloadText('agbe-codes-secours.txt', backupCodes.join('\n') + '\n')}>{t('settings.download')}</button>
            </div>
            <button className="btn primary big" onClick={closeBackupCodes}>{t('settings.backupSaved')}</button>
          </div>
        ) : me.totpEnabled ? (
          <div className="confirm">
            <p className="ok">{t('settings.totpActive')}</p>
            {typeof (leftNow ?? me.backupCodesLeft) === 'number' && (
              <p className={(leftNow ?? me.backupCodesLeft!) <= 2 ? 'warning' : 'muted'} role={(leftNow ?? me.backupCodesLeft!) <= 2 ? 'alert' : undefined}>
                {t((leftNow ?? me.backupCodesLeft!) === 0 ? 'settings.backupNone' : (leftNow ?? me.backupCodesLeft!) <= 2 ? 'settings.backupLow' : 'settings.backupLeft', { count: leftNow ?? me.backupCodesLeft! })}
              </p>
            )}
            {backupOpen ? (
              <form onSubmit={doRegenerateBackupCodes} noValidate>
                <p className="muted">{t('settings.backupRegenHint')}</p>
                <label className="field">
                  <span>{t('auth.password')}</span>
                  <PasswordInput value={backupPassword} onChange={(e) => setBackupPassword(e.target.value)} autoComplete="current-password" maxLength={128} required />
                </label>
                {backupError && <p className="error" role="alert">{backupError}</p>}
                <button className="btn primary big" disabled={busy}>{t('settings.backupRegenGo')}</button>
                <button type="button" className="btn ghost" onClick={() => { setBackupOpen(false); setBackupPassword(''); setBackupError(null); }}>{t('app.cancel')}</button>
              </form>
            ) : (
              <button className="btn big" onClick={() => setBackupOpen(true)}>{t('settings.backupRegen')}</button>
            )}
            {disableOpen ? (
              <form onSubmit={doTotpDisable} noValidate>
                <p className="muted">{t('settings.totpDisableHint')}</p>
                <label className="field">
                  <span>{t('auth.password')}</span>
                  <PasswordInput value={disablePassword} onChange={(e) => setDisablePassword(e.target.value)} autoComplete="current-password" maxLength={128} required />
                </label>
                {disableError && <p className="error" role="alert">{disableError}</p>}
                <button className="btn primary big danger" disabled={busy}>{t('settings.totpDisableGo')}</button>
                <button type="button" className="btn ghost" onClick={() => { setDisableOpen(false); setDisablePassword(''); setDisableError(null); }}>{t('app.cancel')}</button>
              </form>
            ) : (
              <button className="btn ghost" onClick={() => setDisableOpen(true)}>{t('settings.totpDisable')}</button>
            )}
          </div>
        ) : totpOpen ? (
          <div className="confirm">
            {totp ? (
              <form className="totp-form" onSubmit={doTotpEnable} noValidate>
                <TotpSetup totp={totp} code={totpCode} onCode={setTotpCode} />
                {totpError && <p className="error" role="alert">{totpError}</p>}
                <button className="btn primary big" disabled={busy}>{t('settings.totpEnable')}</button>
              </form>
            ) : (
              <form onSubmit={doTotpSetup} noValidate>
                <p>{t('settings.totpIntro')}</p>
                <label className="field">
                  <span>{t('auth.password')}</span>
                  <PasswordInput value={totpPassword} onChange={(e) => setTotpPassword(e.target.value)} autoComplete="current-password" maxLength={128} required />
                </label>
                {totpError && <p className="error" role="alert">{totpError}</p>}
                <button className="btn primary big" disabled={busy}>{t('settings.totpStart')}</button>
              </form>
            )}
            <button
              type="button"
              className="btn ghost"
              onClick={() => {
                setTotpOpen(false);
                setTotp(null);
                setTotpCode('');
              }}
            >
              {t('app.cancel')}
            </button>
          </div>
        ) : (
          <button className="btn big" onClick={() => setTotpOpen(true)}>{t('settings.totpTitle')}</button>
        )}
      </div>}

      <div className="panel">
        <h3>{t('settings.restartTitle')}</h3>
        <p className="muted">{t('settings.restartText')}</p>
        {restarting ? (
          <div className="confirm danger-zone">
            <p>{t('settings.restartConfirmText')}</p>
            <button className="btn danger big" disabled={busy} onClick={() => void doRestart()}>{t('settings.restartConfirm')}</button>
            <button className="btn ghost" onClick={() => setRestarting(false)}>{t('app.cancel')}</button>
          </div>
        ) : (
          <button className="btn big" onClick={() => setRestarting(true)}>🔄 {t('settings.restart')}</button>
        )}
      </div>

      {me.guest ? (
        <div className="panel">
          <h3>{t('settings.haveAccountTitle')}</h3>
          <p className="muted">{t('settings.haveAccountText')}</p>
          {confirmAll ? (
            <div className="confirm danger-zone">
              <p>{t('settings.guestLoginWarn')}</p>
              <button className="btn primary big" disabled={busy} onClick={() => void doLogout()}>{t('settings.guestLoginGo')}</button>
              <button className="btn ghost" onClick={() => setConfirmAll(false)}>{t('app.cancel')}</button>
            </div>
          ) : (
            <button className="btn big" onClick={() => setConfirmAll(true)}>🔑 {t('settings.guestLogin')}</button>
          )}
        </div>
      ) : (
      <div className="panel">
        <h3>{t('settings.account')}</h3>
        <button className="btn big" disabled={busy} onClick={() => void doLogout()}>{t('settings.logout')}</button>
        {confirmAll ? (
          <div className="confirm">
            <p>{t('settings.logoutAllConfirm')}</p>
            <button className="btn danger" disabled={busy} onClick={() => void doLogoutAll()}>{t('app.confirm')}</button>
            <button className="btn ghost" onClick={() => setConfirmAll(false)}>{t('app.cancel')}</button>
          </div>
        ) : (
          <button className="btn big" disabled={busy} onClick={() => setConfirmAll(true)}>{t('settings.logoutAll')}</button>
        )}
        <button className="btn big" disabled={busy} onClick={() => void doExport()}>{t('settings.export')}</button>
        {deleting ? (
          <form className="confirm danger-zone" onSubmit={doDelete}>
            <p>{t('settings.deleteText')}</p>
            <label className="field">
              <span>{t('auth.password')}</span>
              <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" maxLength={128} required />
            </label>
            <button className="btn danger big" disabled={busy || password.length === 0}>{t('settings.deleteConfirm')}</button>
            <button type="button" className="btn ghost" onClick={() => setDeleting(false)}>{t('app.cancel')}</button>
          </form>
        ) : (
          <button className="btn danger big" onClick={() => setDeleting(true)}>{t('settings.delete')}</button>
        )}
      </div>
      )}
    </section>
  );
}
