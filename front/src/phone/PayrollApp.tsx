import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { getPayroll } from '../api/endpoints';
import type { Payroll } from '../api/types';
import { fcfa } from '../lib/format';
import { parseAmount } from '../lib/validate';
import { useGame } from './ctx';

const EMPLOYEE: (keyof Payroll)[] = ['gross', 'cnssEmployee', 'amuEmployee', 'taxable', 'irpp', 'net'];
const EMPLOYER: (keyof Payroll)[] = ['cnssEmployer', 'amuEmployer', 'employerCost'];

export default function PayrollApp() {
  const { t } = useTranslation();
  const { run, busy } = useGame();
  const [gross, setGross] = useState('52500');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Payroll | null>(null);

  async function compute(ev: FormEvent) {
    ev.preventDefault();
    setError(null);
    const g = parseAmount(gross, 100_000_000);
    if (!g) return setError(t('payroll.invalid'));
    const r = await run(() => getPayroll(g));
    if (r) setResult(r);
  }

  const row = (k: keyof Payroll) => (
    <tr key={k} className={k === 'net' || k === 'employerCost' ? 'total' : ''}>
      <th scope="row">{t(`payroll.rows.${k}`)}</th>
      <td>{fcfa(String(result?.[k] ?? '0'))}</td>
    </tr>
  );

  const below = result && (result.belowSmig === true || result.belowSmig === 'true');

  return (
    <section>
      <h2>{t('payroll.title')}</h2>
      <p className="muted">{t('payroll.intro')}</p>
      <form className="panel" onSubmit={compute} noValidate>
        <label className="field">
          <span>{t('payroll.gross')}</span>
          <input inputMode="numeric" value={gross} onChange={(e) => setGross(e.target.value.replace(/[^\d]/g, '').slice(0, 9))} />
        </label>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="btn primary big" disabled={busy}>{t('payroll.compute')}</button>
      </form>
      {result && (
        <div className="panel">
          {below && <p className="warning">{t('payroll.belowSmig')}</p>}
          <table className="payroll">
            <caption>{t('payroll.employee')}</caption>
            <tbody>{EMPLOYEE.filter((k) => result[k] !== undefined).map(row)}</tbody>
          </table>
          <table className="payroll">
            <caption>{t('payroll.employer')}</caption>
            <tbody>{EMPLOYER.map(row)}</tbody>
          </table>
        </div>
      )}
    </section>
  );
}
