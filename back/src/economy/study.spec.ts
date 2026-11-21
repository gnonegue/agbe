import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { SETTING_DEFAULTS } from '../settings/settings.service';
import { enrollBlock, examPassed, highest, meetsReq } from './study';

describe('études : accès aux métiers', () => {
  const lic = [{ kind: 'LICENCE', domain: 'informatique' }];
  it('un diplôme au moins égal dans le bon domaine suffit', () => {
    expect(meetsReq({ min: 'LICENCE', domains: ['informatique'] }, lic)).toBe(true);
    expect(meetsReq({ min: 'BT', domains: ['informatique'] }, lic)).toBe(true); // licence > bac technique
    expect(meetsReq({ min: 'MASTER', domains: ['informatique'] }, lic)).toBe(false);
    expect(meetsReq({ min: 'LICENCE', domains: ['btp'] }, lic)).toBe(false);
  });
  it('le bac seul ouvre les métiers sans condition ; le doctorat accepte tout domaine', () => {
    expect(meetsReq(undefined, [])).toBe(true);
    expect(meetsReq({ min: 'BAC' }, [])).toBe(true);
    expect(meetsReq({ min: 'DOCTORAT' }, lic)).toBe(false);
    expect(meetsReq({ min: 'DOCTORAT' }, [{ kind: 'DOCTORAT', domain: 'btp' }])).toBe(true);
  });
  it('plusieurs options pour le même poste : un seul diplôme listé suffit', () => {
    const req = { min: 'LICENCE' as const, domains: ['informatique', 'securite'], or: [{ min: 'BTS' as const, domains: ['reseaux'] }] };
    expect(meetsReq(req, [{ kind: 'LICENCE', domain: 'securite' }])).toBe(true);
    expect(meetsReq(req, [{ kind: 'BTS', domain: 'reseaux' }])).toBe(true);
    expect(meetsReq(req, [{ kind: 'MASTER', domain: 'informatique' }])).toBe(true); // plus élevé dans un domaine listé
    expect(meetsReq(req, [{ kind: 'BTS', domain: 'informatique' }])).toBe(false); // BTS ne vaut que pour le réseau
    expect(meetsReq(req, [{ kind: 'LICENCE', domain: 'btp' }])).toBe(false);
  });
  it('le plus haut diplôme', () => {
    expect(highest([])).toBe('BAC');
    expect(highest([{ kind: 'BT', domain: 'btp' }, { kind: 'MASTER', domain: 'btp' }])).toBe('MASTER');
  });
});

describe('études : inscription et examen', () => {
  it('le master demande la licence du même domaine, le doctorat le master', () => {
    expect(enrollBlock('LICENCE', 'btp', [])).toBeNull();
    expect(enrollBlock('MASTER', 'btp', [])).toBe('need_licence');
    expect(enrollBlock('MASTER', 'btp', [{ kind: 'LICENCE', domain: 'compta' }])).toBe('need_licence');
    expect(enrollBlock('MASTER', 'btp', [{ kind: 'LICENCE', domain: 'btp' }])).toBeNull();
    expect(enrollBlock('DOCTORAT', 'btp', [{ kind: 'LICENCE', domain: 'btp' }])).toBe('need_master');
    expect(enrollBlock('LICENCE', 'btp', [{ kind: 'LICENCE', domain: 'btp' }])).toBe('already_have_diploma');
  });
  it('l’examen demande la part minimale de bonnes réponses', () => {
    expect(examPassed(2, 3, 6_000)).toBe(true);
    expect(examPassed(1, 3, 6_000)).toBe(false);
    expect(examPassed(3, 4, 6_000)).toBe(true);
    expect(examPassed(2, 4, 6_000)).toBe(false);
  });
});

describe('études : réglages par défaut', () => {
  const k = SETTING_DEFAULTS.study;
  const seed = readFileSync(new URL('../scripts/seed.ts', import.meta.url), 'utf8');
  const jobIds = new Set([...seed.matchAll(/\{ id: '([a-z_]+)', level: '/g)].map((m) => m[1]!));
  const domains = new Set(k.domains.map((d) => d.id));

  it('chaque métier à condition existe, et ses domaines aussi', () => {
    for (const [job, req] of Object.entries(k.jobReq)) {
      expect(jobIds.has(job), job).toBe(true);
      for (const d of req.domains ?? []) expect(domains.has(d), `${job}: ${d}`).toBe(true);
    }
  });
  it('chaque métier à condition a un lieu de travail et chaque série de bac mène à un domaine', () => {
    for (const job of Object.keys(k.jobReq)) expect(SETTING_DEFAULTS['work.places'][job], job).toBeTruthy();
    for (const b of k.bt) expect(domains.has(b.domain), b.series).toBe(true);
  });
  it('les leçons ont une bonne réponse valide', () => {
    for (const d of k.domains) for (const l of d.lessons) expect(l.answer).toBeLessThan(l.choicesFr.length);
  });
  it('les années et les prix montent avec le niveau', () => {
    expect(k.cycles.LICENCE.years).toBe(3);
    expect(k.cycles.MASTER.fee).toBeGreaterThan(k.cycles.LICENCE.fee);
    expect(k.cycles.DOCTORAT.fee).toBeGreaterThan(k.cycles.MASTER.fee);
  });
});
