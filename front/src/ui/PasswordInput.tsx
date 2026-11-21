import { useState, type InputHTMLAttributes } from 'react';
import { useTranslation } from 'react-i18next';

/** Champ mot de passe avec un œil dans le champ : un toucher affiche le texte, un autre le masque à nouveau. */
export default function PasswordInput(props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const { t } = useTranslation();
  const [show, setShow] = useState(false);
  return (
    <span className="pw-field">
      <input {...props} type={show ? 'text' : 'password'} />
      <button type="button" className="pw-eye" aria-label={t(show ? 'auth.hidePassword' : 'auth.showPassword')} aria-pressed={show} title={t(show ? 'auth.hidePassword' : 'auth.showPassword')} onClick={() => setShow((v) => !v)}>
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {show && <path d="M3 3l18 18" />}
        </svg>
      </button>
    </span>
  );
}
