// Habillement : catalogue par défaut des boutiques de vêtements (paramètre « clothes.items », modifiable dans le back-office).
// Prix INDICATIFS en FCFA (prêt-à-porter de Lomé), à vérifier avant lancement.
import type { Slot } from '../economy/clothes';

export interface Garment {
  id: string;
  slot: Slot;
  gender: 'm' | 'f' | 'u';
  /** Coupe dessinée par le jeu (voir STYLES). */
  style: string;
  fabric: 'plain' | 'wax' | 'kente' | 'batik';
  /** Couleur du tissu uni (0xRRGGBB) ; motif pour wax, kente et batik. */
  color: number;
  pattern: number;
  price: number;
  emoji: string;
  nameFr: string;
  nameEn: string;
}

const g = (id: string, slot: Slot, gender: Garment['gender'], style: string, fabric: Garment['fabric'], color: number, pattern: number, price: number, emoji: string, nameFr: string, nameEn: string): Garment => ({ id, slot, gender, style, fabric, color, pattern, price, emoji, nameFr, nameEn });

export const DEFAULT_GARMENTS: Garment[] = [
  // Hauts
  g('tshirt_blanc', 'top', 'u', 'tshirt', 'plain', 0xf4f4f2, 0, 2_500, '👕', 'T-shirt blanc', 'White T-shirt'),
  g('tshirt_noir', 'top', 'u', 'tshirt', 'plain', 0x1d1d1f, 0, 2_500, '👕', 'T-shirt noir', 'Black T-shirt'),
  g('tshirt_jaune', 'top', 'u', 'tshirt', 'plain', 0xffce00, 0, 3_000, '👕', 'T-shirt jaune', 'Yellow T-shirt'),
  g('tshirt_vert', 'top', 'u', 'tshirt', 'plain', 0x1e8a4c, 0, 3_000, '👕', 'T-shirt vert', 'Green T-shirt'),
  g('polo_beige', 'top', 'm', 'polo', 'plain', 0xf2c48d, 0, 6_000, '👔', 'Polo beige', 'Beige polo shirt'),
  g('polo_marine', 'top', 'm', 'polo', 'plain', 0x1b2a4a, 0, 6_000, '👔', 'Polo bleu marine', 'Navy polo shirt'),
  g('chemise_blanche', 'top', 'm', 'shirt', 'plain', 0xfafafa, 0, 9_000, '👔', 'Chemise blanche', 'White shirt'),
  g('chemise_ciel', 'top', 'm', 'shirt', 'plain', 0x9cc3e6, 0, 9_000, '👔', 'Chemise bleu ciel', 'Sky-blue shirt'),
  g('chemise_wax', 'top', 'm', 'shirt', 'wax', 0, 0, 12_000, '🧵', 'Chemise en wax', 'Wax print shirt'),
  g('boubou_bazin', 'top', 'm', 'tunic', 'plain', 0xf7f3e8, 0, 25_000, '🥻', 'Boubou en bazin blanc', 'White bazin boubou'),
  g('boubou_kente', 'top', 'm', 'tunic', 'kente', 0, 1, 35_000, '🥻', 'Boubou en kente', 'Kente boubou'),
  g('veste_noire', 'top', 'm', 'jacket', 'plain', 0x22252b, 0, 30_000, '🧥', 'Veste de costume noire', 'Black suit jacket'),
  g('veste_grise', 'top', 'm', 'jacket', 'plain', 0x6b7280, 0, 30_000, '🧥', 'Veste de costume grise', 'Grey suit jacket'),
  g('blouse_wax', 'top', 'f', 'blouse', 'wax', 0, 2, 9_000, '👚', 'Blouse en wax', 'Wax print blouse'),
  g('blouse_blanche', 'top', 'f', 'blouse', 'plain', 0xfbfbfb, 0, 7_000, '👚', 'Blouse blanche', 'White blouse'),
  g('blouse_rose', 'top', 'f', 'blouse', 'plain', 0xe98aa8, 0, 7_000, '👚', 'Blouse rose', 'Pink blouse'),
  g('veste_tailleur', 'top', 'f', 'jacket', 'plain', 0x2d3a5c, 0, 28_000, '🧥', 'Veste de tailleur', 'Tailored jacket'),
  // Bas
  g('jean_bleu', 'bottom', 'u', 'jeans', 'plain', 0x3b5b8c, 0, 8_000, '👖', 'Jean bleu', 'Blue jeans'),
  g('jean_noir', 'bottom', 'u', 'jeans', 'plain', 0x1c1f26, 0, 8_000, '👖', 'Jean noir', 'Black jeans'),
  g('pantalon_noir', 'bottom', 'u', 'trousers', 'plain', 0x1b2233, 0, 10_000, '👖', 'Pantalon de ville noir', 'Black dress trousers'),
  g('pantalon_beige', 'bottom', 'u', 'trousers', 'plain', 0xc9b48a, 0, 10_000, '👖', 'Pantalon beige', 'Beige trousers'),
  g('short_kaki', 'bottom', 'm', 'shorts', 'plain', 0x8a7d55, 0, 4_000, '🩳', 'Short kaki', 'Khaki shorts'),
  g('jupe_noire', 'bottom', 'f', 'skirt', 'plain', 0x16181d, 0, 7_000, '👗', 'Jupe noire', 'Black skirt'),
  g('jupe_wax', 'bottom', 'f', 'skirt', 'wax', 0, 3, 8_000, '👗', 'Jupe en wax', 'Wax print skirt'),
  g('pagne_wax', 'bottom', 'f', 'pagne', 'wax', 0, 0, 10_000, '🧵', 'Pagne wax noué', 'Wrapped wax pagne'),
  g('pagne_kente', 'bottom', 'f', 'pagne', 'kente', 0, 2, 18_000, '🧵', 'Pagne kente', 'Kente pagne'),
  // Robes
  g('robe_rouge', 'dress', 'f', 'dress', 'plain', 0xc8102e, 0, 12_000, '👗', 'Robe rouge', 'Red dress'),
  g('robe_wax', 'dress', 'f', 'dress', 'wax', 0, 5, 15_000, '👗', 'Robe en wax', 'Wax print dress'),
  g('robe_batik', 'dress', 'f', 'dress', 'batik', 0, 1, 15_000, '👗', 'Robe en batik', 'Batik dress'),
  g('kaba_kente', 'dress', 'f', 'gown', 'kente', 0, 3, 30_000, '👘', 'Robe longue en kente', 'Long kente gown'),
  g('robe_soiree', 'dress', 'f', 'gown', 'plain', 0x111111, 0, 40_000, '👗', 'Robe de soirée noire', 'Black evening gown'),
  // Chaussures
  g('baskets_blanches', 'shoes', 'u', 'sneakers', 'plain', 0xf0ece4, 0, 12_000, '👟', 'Baskets blanches', 'White sneakers'),
  g('baskets_noires', 'shoes', 'u', 'sneakers', 'plain', 0x1b1b1b, 0, 12_000, '👟', 'Baskets noires', 'Black sneakers'),
  g('sandales', 'shoes', 'u', 'sandals', 'plain', 0x6b4226, 0, 3_000, '🩴', 'Sandales en cuir', 'Leather sandals'),
  g('chaussures_noires', 'shoes', 'm', 'dress_shoes', 'plain', 0x141414, 0, 20_000, '👞', 'Chaussures de ville noires', 'Black dress shoes'),
  g('chaussures_marron', 'shoes', 'm', 'dress_shoes', 'plain', 0x6b3e1f, 0, 20_000, '👞', 'Chaussures de ville marron', 'Brown dress shoes'),
  g('escarpins_noirs', 'shoes', 'f', 'heels', 'plain', 0x151515, 0, 18_000, '👠', 'Escarpins noirs', 'Black heels'),
  g('escarpins_rouges', 'shoes', 'f', 'heels', 'plain', 0xb3122e, 0, 18_000, '👠', 'Escarpins rouges', 'Red heels'),
];
