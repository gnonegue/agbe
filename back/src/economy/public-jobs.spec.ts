import { describe, expect, it } from 'vitest';
import { attendanceBp, payModeOf, publicGross } from './public-jobs';

const jobs = [
  { id: 'a', level: 'DEBROUILLE', payPerShift: 2100 },
  { id: 'b', level: 'DEBROUILLE', payPerShift: 2600 },
  { id: 'c', level: 'DEBROUILLE', payPerShift: 3050 },
  { id: 'd', level: 'QUALIFIE', payPerShift: 4000 },
];
const band = { min: 52_500, max: 80_000 };

describe('salaire des emplois publics', () => {
  it('reste dans la bande, du SMIG au plafond sans diplôme', () => {
    const g = jobs.filter((j) => j.level === 'DEBROUILLE').map((j) => publicGross(j, jobs, band));
    expect(g[0]).toBe(52_500);
    expect(g[2]).toBe(80_000);
    for (const x of g) expect(x % 500).toBe(0);
    expect(g[1]).toBeGreaterThan(g[0]!);
    expect(g[1]).toBeLessThan(g[2]!);
  });
  it('un niveau à un seul métier prend le bas de sa bande', () => {
    expect(publicGross(jobs[3]!, jobs, { min: 85_000, max: 150_000 })).toBe(85_000);
  });
  it('assiduité : proportionnelle, plafonnée à 100 %', () => {
    expect(attendanceBp(0, 12)).toBe(0);
    expect(attendanceBp(6, 12)).toBe(5000);
    expect(attendanceBp(30, 12)).toBe(10_000);
    expect(attendanceBp(3, 0)).toBe(10_000);
  });
});

describe('payModeOf', () => {
  const task = ['zem_driver', 'car_washer'];
  it('les métiers listés sont à la tâche, les autres salariés', () => {
    expect(payModeOf('zem_driver', true, task)).toBe('TASK');
    expect(payModeOf('car_washer', true, task)).toBe('TASK');
    expect(payModeOf('accountant', true, task)).toBe('MONTHLY');
  });
  it('sans employeur public, tout est à la tâche', () => {
    expect(payModeOf('accountant', false, task)).toBe('TASK');
  });
});
