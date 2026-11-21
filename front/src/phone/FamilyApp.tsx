import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { answerFamily, attendCeremony, cancelCeremony, getCeremonies, getFamily, organizeCeremony } from '../api/endpoints';
import type { CeremonyKind, CeremonyList, FamilyRequest } from '../api/types';
import { fcfa, localName } from '../lib/format';
import { useGame } from './ctx';

const KINDS: CeremonyKind[] = ['DOT', 'BAPTEME', 'FUNERAILLES', 'ANNIVERSAIRE'];
const ICON: Record<CeremonyKind, string> = { DOT: '💍', BAPTEME: '👶', FUNERAILLES: '🕊️', ANNIVERSAIRE: '🎂' };

/** Famille et cérémonies : les proches qui demandent de l'aide, les fêtes qu'on organise ou auxquelles on se rend. */
export default function FamilyApp() {
  const { t, i18n } = useTranslation();
  const { state, catalog, run, busy, goTo } = useGame();
  const [requests, setRequests] = useState<FamilyRequest[] | null>(null);
  const [cer, setCer] = useState<CeremonyList | null>(null);
  const [kind, setKind] = useState<CeremonyKind>('BAPTEME');
  const [venue, setVenue] = useState('');
  const [inDays, setInDays] = useState(2);
  const [gift, setGift] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    const [r, c] = await Promise.all([run(getFamily), run(getCeremonies)]);
    if (r) setRequests(r);
    if (c) setCer(c);
  }, [run]);
  useEffect(() => {
    void load();
  }, [load, state.location]);

  if (!catalog || !requests || !cer) return <p className="muted">{t('app.loading')}</p>;
  const rules = catalog.ceremony;
  const balance = BigInt(state.wallet.balance);
  const after = <T,>(p: Promise<T | null>) => void p.then(load);
  const venueName = (id: string) => {
    const v = catalog.venues.find((x) => x.id === id);
    return v ? localName(v, i18n.language) : id;
  };
  const pending = requests.filter((r) => r.status === 'PENDING');
  const past = requests.filter((r) => r.status !== 'PENDING').slice(0, 6);
  // Lieux de fête prévus par le serveur (salle de l'hôtel, plage, maquis…), dans la ville où l'on se trouve d'abord
  const allowed = rules?.venues ?? [];
  const venues = catalog.venues
    .filter((v) => allowed.includes(v.id))
    .sort((a, b) => Number((b.city ?? 'lome') === (state.city ?? 'lome')) - Number((a.city ?? 'lome') === (state.city ?? 'lome')));
  const chosen = venue || venues[0]?.id || '';

  return (
    <section>
      <div className="panel">
        <h3>👨‍👩‍👧 {t('family.title')}</h3>
        <p className="muted">{t('family.intro')}</p>
        {pending.length === 0 && <p className="muted">{t('family.none')}</p>}
        {pending.map((r) => (
          <div key={r.id} className="family-req">
            <p>
              <strong>{t(`family.kinds.${r.kind}.who`)}</strong> · {t(`family.kinds.${r.kind}.text`, { amount: fcfa(r.amount) })}
            </p>
            <small className="muted">{t('family.answerBefore', { day: r.expiresDay })}</small>
            <div className="row-actions">
              <button className="btn primary" disabled={busy || balance < BigInt(r.amount)} onClick={() => after(run(() => answerFamily(r.id, true), () => t('family.sent', { amount: fcfa(r.amount) })))}>
                {t('family.send', { amount: fcfa(r.amount) })}
              </button>
              <button className="btn ghost" disabled={busy} onClick={() => after(run(() => answerFamily(r.id, false), () => t('family.refused')))}>
                {t('family.refuse')}
              </button>
            </div>
          </div>
        ))}
        {past.length > 0 && (
          <ul className="list">
            {past.map((r) => (
              <li key={r.id} className="item">
                <div className="item-main">
                  <small>
                    {t(`family.kinds.${r.kind}.who`)} · {fcfa(r.amount)} · {t(`family.status.${r.status}`)}
                  </small>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel">
        <h3>🎉 {t('ceremony.title')}</h3>
        <p className="muted">{t('ceremony.intro')}</p>
        {cer.list.length === 0 && <p className="muted">{t('ceremony.none')}</p>}
        <ul className="list">
          {cer.list.map((c) => {
            const g = gift[c.id] ?? String(rules?.minGift ?? 0);
            return (
              <li key={c.id} className="item">
                <div className="item-main">
                  <strong>
                    {ICON[c.kind]} {t(`ceremony.kinds.${c.kind}`)} · {c.mine ? t('ceremony.yours') : c.host}
                  </strong>
                  <small>
                    {venueName(c.venueId)} · {c.day === cer.today ? t('ceremony.today') : t('ceremony.onDay', { day: c.day })} · {t('ceremony.guests', { n: c.guests })}
                    {c.gifts !== null && ` · ${t('ceremony.gifts', { amount: fcfa(c.gifts) })}`}
                  </small>
                  {c.canAttend && !c.attended && rules && (
                    <span className="inline-edit">
                      <input inputMode="numeric" aria-label={t('ceremony.gift')} value={g} onChange={(e) => setGift({ ...gift, [c.id]: e.target.value.replace(/\D/g, '') })} />
                      <button className="btn small primary" disabled={busy || Number(g) < rules.minGift || Number(g) > rules.maxGift || balance < BigInt(Number(g) || 0)} onClick={() => after(run(() => attendCeremony(c.id, Number(g)), () => t('ceremony.attended')))}>
                        {t('ceremony.attend')}
                      </button>
                      <small className="muted">{t('ceremony.giftRange', { min: fcfa(rules.minGift), max: fcfa(rules.maxGift) })}</small>
                    </span>
                  )}
                  {c.attended && <small className="ok">✓ {t('ceremony.wasThere')}</small>}
                </div>
                {!c.mine && !c.canAttend && c.day >= cer.today && (
                  <button className="btn small" onClick={() => goTo(c.venueId)}>🗺️</button>
                )}
                {c.mine && c.guests === 0 && (
                  <button className="btn small ghost" disabled={busy} onClick={() => after(run(() => cancelCeremony(c.id), () => t('ceremony.cancelled')))}>
                    {t('app.cancel')}
                  </button>
                )}
              </li>
            );
          })}
        </ul>

        {rules && (
          <>
            <h4>{t('ceremony.organize')}</h4>
            <label className="field">
              <span>{t('ceremony.inDays', { n: inDays, day: cer.today + inDays })}</span>
              <input type="range" min={rules.minDaysAhead} max={rules.maxDaysAhead} value={inDays} onChange={(e) => setInDays(Number(e.target.value))} />
            </label>
            <fieldset className="choices">
              {KINDS.map((k) => (
                <button type="button" key={k} className={kind === k ? 'choice active' : 'choice'} aria-pressed={kind === k} onClick={() => setKind(k)}>
                  <strong>{ICON[k]} {t(`ceremony.kinds.${k}`)}</strong>
                  <small>{t('ceremony.costRespect', { cost: fcfa(rules.kinds[k].cost), respect: rules.kinds[k].respect })}</small>
                </button>
              ))}
            </fieldset>
            <fieldset className="choices" aria-label={t('ceremony.where')}>
              <legend>{t('ceremony.where')}</legend>
              <div className="venue-cards">
                {venues.map((v) => {
                  const extra = v.id === catalog.hotel?.venueId ? catalog.hotel.halls.find((x) => x.id === catalog.hotel!.partyHall)?.daily ?? 0 : 0;
                  return (
                    <button type="button" key={v.id} className={chosen === v.id ? 'venue-card active' : 'venue-card'} aria-pressed={chosen === v.id} onClick={() => setVenue(v.id)}>
                      <span className="venue-emoji" aria-hidden="true">{v.emoji}</span>
                      <strong>{localName(v, i18n.language)}</strong>
                      <small>{i18n.language === 'en' ? v.districtEn : v.districtFr}</small>
                      {extra > 0 && <small>{t('ceremony.hallExtra', { price: fcfa(extra) })}</small>}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            {(() => {
              const hall = chosen === catalog.hotel?.venueId ? catalog.hotel.halls.find((x) => x.id === catalog.hotel!.partyHall)?.daily ?? 0 : 0;
              const total = rules.kinds[kind].cost + hall;
              return (
                <button className="btn primary big" disabled={busy || !chosen || balance < BigInt(total)} onClick={() => after(run(() => organizeCeremony(kind, chosen, inDays), (r) => t('ceremony.organized', { day: r.result.day })))}>
                  {t('ceremony.organizeFor', { cost: fcfa(total) })}
                </button>
              );
            })()}
          </>
        )}
      </div>
    </section>
  );
}
