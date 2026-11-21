import { describe, expect, it } from 'vitest';
import { randomMultiTender, TENDER_MULTI } from './tenderContent';

describe('marchés multi-domaines', () => {
  const all = ['btp', 'architecture', 'electricite', 'sante', 'pharmacie', 'maquis', 'pagnes', 'couture', 'pret_a_porter', 'coiffure', 'transport', 'logistique', 'mecanique', 'cyber', 'informatique', 'cybersecurite', 'data', 'telecoms', 'agronomie', 'environnement', 'education', 'rh', 'journalisme', 'compta', 'droit', 'banque', 'hotellerie'];
  it('chaque modèle couvre au moins deux domaines connus du jeu', () => {
    for (const m of TENDER_MULTI) {
      expect(m.sectors.length).toBeGreaterThanOrEqual(2);
      for (const sec of m.sectors) expect(all).toContain(sec);
    }
  });
  it('le tirage ne renvoie que des domaines connus, au moins deux', () => {
    for (let i = 0; i < 30; i++) {
      const m = randomMultiTender(all)!;
      expect(m.sectors.length).toBeGreaterThanOrEqual(2);
      expect(m.sectors.every((x) => all.includes(x))).toBe(true);
    }
    expect(randomMultiTender(['btp'])).toBeNull(); // un seul domaine connu : pas de marché multi-domaines
  });
});
