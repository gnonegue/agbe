import { describe, expect, it } from 'vitest';
import { conferenceIndex, nextConferences } from './conference';

describe('conférences : calendrier', () => {
  const s = { startHour: 18, hours: 2, everyDays: 3, offsetDay: 1 };
  it('une conférence tous les 3 jours à partir du jour 1', () => {
    expect([0, 1, 2, 3, 4, 7].map((d) => conferenceIndex(d, s))).toEqual([null, 0, null, null, 1, 2]);
  });
  it('celle du jour reste annoncée jusqu’à sa fin, puis on passe à la suivante', () => {
    expect(nextConferences(4, 19 * 60, s, 2)).toEqual([{ day: 4, index: 1 }, { day: 7, index: 2 }]);
    expect(nextConferences(4, 20 * 60, s, 1)).toEqual([{ day: 7, index: 2 }]);
    expect(nextConferences(5, 0, s, 1)).toEqual([{ day: 7, index: 2 }]);
    expect(nextConferences(0, 0, s, 1)).toEqual([{ day: 1, index: 0 }]);
  });
});
