import { useTranslation } from 'react-i18next';
import { useGame } from '../phone/ctx';

/** Barre d'actions sous un message touché : répondre, copier, supprimer pour moi, signaler (messages des autres). */
export default function MsgActions({ text, onReply, onHide, onReport, onDone }: { text: string; onReply: () => void; onHide: () => void; onReport?: () => void; onDone: () => void }) {
  const { t } = useTranslation();
  const { toast } = useGame();
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast(t('chat.copied'), 'ok');
    } catch {
      toast(t('chat.copyFailed'), 'error');
    }
    onDone();
  };
  return (
    <div className="msg-actions" role="group" aria-label={t('chat.actions')}>
      <button type="button" className="msg-act reply" onClick={() => (onReply(), onDone())}>↩ {t('chat.reply')}</button>
      <button type="button" className="msg-act" onClick={() => void copy()}>⧉ {t('chat.copy')}</button>
      <button type="button" className="msg-act" onClick={() => (onHide(), onDone())}>🗑 {t('chat.hideForMe')}</button>
      {onReport && <button type="button" className="msg-act danger" onClick={() => (onReport(), onDone())}>⚑ {t('chat.report')}</button>}
    </div>
  );
}
