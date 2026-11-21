import { describe, expect, it } from 'vitest';
import { jobLastWorked, markJobWorked } from './job-cooldown';

describe('délai par métier', () => {
  it('chaque métier garde sa propre date', () => {
    const a = markJobWorked({}, 'delivery_driver', Date.UTC(2026, 0, 1));
    const b = markJobWorked(a, 'car_washer', Date.UTC(2026, 0, 2));
    expect(jobLastWorked(b, 'delivery_driver')).toBe(Date.UTC(2026, 0, 1));
    expect(jobLastWorked(b, 'car_washer')).toBe(Date.UTC(2026, 0, 2));
    expect(jobLastWorked(b, 'zem_driver')).toBeNull();
  });
  it('ignore une carte invalide', () => {
    expect(jobLastWorked(null, 'x')).toBeNull();
    expect(jobLastWorked([] as never, 'x')).toBeNull();
    expect(jobLastWorked({ x: 'pas une date' }, 'x')).toBeNull();
  });
});
