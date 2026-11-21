import { useTranslation } from 'react-i18next';

/**
 * Écran de chargement unique : même contenu que celui d'index.html et du pré-rendu (logo et « Chargement »),
 * pour que les étapes du démarrage s'enchaînent sans que le texte saute ni clignote.
 */
export function Splash() {
  const { t } = useTranslation();
  return (
    <div className="splash">
      <div className="logo">{t('app.name')}</div>
      <p className="muted">{t('app.loading')}</p>
    </div>
  );
}
