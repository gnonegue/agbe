import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { Needs } from '../api/types';
import { fcfa, hhmm } from '../lib/format';
import { useGame } from '../phone/ctx';
import { setVoiceOn, voiceOn, voiceSupported } from '../lib/voice';

const NEEDS: { k: keyof Needs; icon: string }[] = [
  { k: 'hunger', icon: '🍲' },
  { k: 'energy', icon: '⚡' },
  { k: 'hygiene', icon: '🚿' },
  { k: 'health', icon: '❤️' },
  { k: 'morale', icon: '😊' },
  { k: 'respect', icon: '⭐' },
];

/** Humeur affichée : moyenne des besoins vitaux. */
function mood(n: Needs): 'happy' | 'ok' | 'down' {
  const avg = (n.hunger + n.energy + n.hygiene + n.health + n.morale) / 5;
  return avg >= 60 ? 'happy' : avg >= 35 ? 'ok' : 'down';
}

/** Barre flottante du haut : heure, humeur, lieu, argent. */
export function TopBar({ place }: { place: string }) {
  const { t } = useTranslation();
  const { me, state, clock, openApp } = useGame();
  // @nom d'utilisateur ; à défaut (ancien compte sans nom d'utilisateur), le nom du personnage ; « Invité » seulement sans compte
  const userLabel = me.username ? `@${me.username}` : me.email && state.name ? state.name : t('hud.guest');
  const [now, setNow] = useState(() => clock.parts());
  useEffect(() => {
    const id = window.setInterval(() => setNow(clock.parts()), 1000);
    return () => window.clearInterval(id);
  }, [clock]);
  const night = now.hour < 6 || now.hour >= 19;
  const m = mood(state.needs);
  const [voice, setVoice] = useState(voiceOn);
  return (
    <header className="topbar">
      <span className="tb-user" title={userLabel}>
        <span aria-hidden="true">👤</span> {userLabel}
      </span>
      <span className="tb-time">
        <span aria-hidden="true">{night ? '🌙' : '☀️'}</span> {t('hud.time', { weekday: t(`weekdays.${now.day % 7}`), day: now.day, time: hhmm(now.hour, now.minute) })}
      </span>
      <span className={`tb-mood ${m}`}>
        <span aria-hidden="true">{m === 'happy' ? '🙂' : m === 'ok' ? '😐' : '😟'}</span> {t(`mood.${m}`)}
      </span>
      <span className="tb-place">📍 {place}</span>
      {voiceSupported() && (
        <button
          className="tb-voice"
          aria-pressed={voice}
          aria-label={voice ? t('voice.off') : t('voice.on')}
          title={voice ? t('voice.off') : t('voice.on')}
          onClick={() => {
            setVoiceOn(!voice);
            setVoice(!voice);
          }}
        >
          {voice ? '🔊' : '🔇'}
        </button>
      )}
      <button className="tb-money" onClick={() => openApp('wallet')} aria-label={t('phone.apps.wallet')}>
        {fcfa(state.wallet.balance)}
      </button>
    </header>
  );
}

// Un choix mémorisé par format d'écran : replié sur téléphone même si déplié sur ordinateur
const needsKey = () => (window.innerWidth >= 700 ? 'agbe.needsOpen' : 'agbe.needsOpen.phone');

/** Mini-jauges en haut à gauche ; touchées, elles s'ouvrent en détail. */
export function Stats() {
  const { t } = useTranslation();
  const { state } = useGame();
  // Jauges détaillées affichées par défaut ; le choix (replier / déplier) est mémorisé sur l'appareil
  const [open, setOpen] = useState(() => {
    try {
      const v = localStorage.getItem(needsKey());
      // Sur téléphone, jauges repliées par défaut pour laisser voir la ville
      return v === null ? window.innerWidth >= 700 : v !== '0';
    } catch {
      return window.innerWidth >= 700;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(needsKey(), open ? '1' : '0');
    } catch {
      /* stockage indisponible : on garde l'état en mémoire */
    }
  }, [open]);
  const lvl = (k: (typeof NEEDS)[number]['k']) => {
    const v = Math.max(0, Math.min(100, Math.round(state.needs[k])));
    return { v, level: v >= 60 ? 'good' : v >= 30 ? 'mid' : 'low' };
  };
  // Replié : seules les jauges à surveiller (moyennes ou basses) sont montrées ; si tout va bien, une seule pastille calme l'écran
  const shown = open ? NEEDS : NEEDS.filter(({ k }) => lvl(k).level !== 'good');
  if (!open && shown.length === 0) {
    return (
      <button className="needs calm" onClick={() => setOpen(true)} aria-expanded={false} aria-label={t('hud.needs')}>
        <span aria-hidden="true">😊</span> {t('hud.needsOk')}
      </button>
    );
  }
  return (
    <button className={open ? 'needs open' : 'needs'} onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t('hud.needs')}>
      {shown.map(({ k, icon }) => {
        const { v, level } = lvl(k);
        return (
          <span key={k} className={`need ${level}`} role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={v} aria-label={t(`needs.${k}`)}>
            <span aria-hidden="true">{icon}</span>
            {open && <span className="need-name">{t(`needs.${k}`)}</span>}
            <span className="bar">
              <span className={`fill w${Math.round(v / 5) * 5}`} />
            </span>
            {open && <b>{v}%</b>}
          </span>
        );
      })}
    </button>
  );
}
