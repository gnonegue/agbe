import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { useGame } from '../phone/ctx';

/** Actions réservées aux comptes (argent réel, pubs, terrain, envois) : un invité voit à la place l'invitation à créer son compte. */
export default function AccountGate({ children, big = true }: { children: ReactNode; big?: boolean }) {
  const { t } = useTranslation();
  const { me, openApp } = useGame();
  if (!me?.guest) return <>{children}</>;
  return (
    <button type="button" className={`btn primary gate${big ? ' big' : ''}`} onClick={() => openApp('settings')}>
      🔒 {t('guest.gate')}
    </button>
  );
}
