// Meubles posables dans le logement : chaque modèle est un assemblage de pavés (repère local : empreinte w × d, centre au sol,
// l'avant du meuble vers +z). Aucune texture ni modèle externe : léger pour les téléphones.

export interface Part {
  x: number;
  y: number;
  z: number;
  /** Largeur (pour un disque ou un anneau : le diamètre). */
  w: number;
  h: number;
  /** Profondeur (pour un disque : l'épaisseur). */
  d: number;
  c: number;
  /** Forme : pavé (par défaut), disque dont l'axe est celui de la profondeur, ou anneau (tore) dans le plan avant. */
  kind?: 'box' | 'disc' | 'ring';
  /** Rotation dans le plan avant (radians) : pales d'un ventilateur. */
  rz?: number;
}

const WOOD = 0x8a5a33;
const DARK = 0x23262d;
const part = (x: number, y: number, z: number, w: number, h: number, d: number, c: number): Part => ({ x, y, z, w, h, d, c });
const disc = (x: number, y: number, z: number, diameter: number, thick: number, c: number): Part => ({ x, y, z, w: diameter, h: diameter, d: thick, c, kind: 'disc' });
const ring = (x: number, y: number, z: number, diameter: number, tube: number, c: number): Part => ({ x, y, z, w: diameter, h: diameter, d: tube, c, kind: 'ring' });
const blade = (x: number, y: number, z: number, len: number, rz: number, c: number): Part => ({ x, y, z, w: len, h: 0.09, d: 0.012, c, rz });

export function furnitureParts(model: string, w: number, d: number): Part[] {
  const hw = w / 2;
  const hd = d / 2;
  switch (model) {
    case 'sofa':
    case 'armchair': {
      const arm = model === 'sofa' ? 0.2 : 0.16;
      const n = model === 'sofa' ? 3 : 1;
      const cw = (w - arm * 2) / n;
      const out = [part(0, 0.22, 0, w, 0.44, d, 0x4a4f63), part(0, 0.72, -hd + 0.11, w, 0.56, 0.22, 0x3d4256), part(-hw + arm / 2, 0.55, 0, arm, 0.4, d, 0x3d4256), part(hw - arm / 2, 0.55, 0, arm, 0.4, d, 0x3d4256)];
      for (let i = 0; i < n; i++) out.push(part(-hw + arm + cw * (i + 0.5), 0.52, 0.05, cw - 0.04, 0.16, d - 0.3, 0x6b7390));
      return out;
    }
    case 'bed':
      return [part(0, 0.18, 0, w, 0.36, d, WOOD), part(0, 0.46, 0.05, w - 0.1, 0.24, d - 0.14, 0xf3efe6), part(0, 0.62, 0.35, w - 0.1, 0.06, d * 0.55, 0x2f6f9f), part(-w * 0.22, 0.62, -hd + 0.4, w * 0.36, 0.14, 0.38, 0xffffff), part(w * 0.22, 0.62, -hd + 0.4, w * 0.36, 0.14, 0.38, 0xffffff), part(0, 0.6, -hd + 0.05, w, 1.0, 0.1, 0x6a4326)];
    case 'tv':
      return [part(0, 0.25, 0, w, 0.5, d, 0x2d2f36), part(0, 0.62, 0, 0.5, 0.24, 0.3, DARK), part(0, 1.12, -0.02, w * 0.92, 0.95, 0.06, 0x101114), part(0, 1.12, 0.012, w * 0.86, 0.86, 0.01, 0x1f4f7a)];
    case 'bookcase': {
      const out = [part(0, 0.95, 0, w, 1.9, d, 0x5b3a1e)];
      const cols = [0xc0392b, 0x2980b9, 0xf1c40f, 0x27ae60, 0x8e44ad, 0xe67e22];
      for (let r = 0; r < 4; r++) for (let i = 0; i < 6; i++) out.push(part(-hw + 0.15 + i * ((w - 0.3) / 6) + 0.08, 0.35 + r * 0.45, hd - 0.02, 0.12, 0.34, 0.04, cols[(i + r) % cols.length]!));
      return out;
    }
    case 'wardrobe':
      return [part(0, 1.0, 0, w, 2.0, d, 0xd9cbb3), part(-w / 4, 1.0, hd + 0.005, w / 2 - 0.04, 1.9, 0.02, 0xc7b89d), part(w / 4, 1.0, hd + 0.005, w / 2 - 0.04, 1.9, 0.02, 0xc7b89d), part(-0.06, 1.0, hd + 0.03, 0.03, 0.3, 0.03, 0x5a5a5a), part(0.06, 1.0, hd + 0.03, 0.03, 0.3, 0.03, 0x5a5a5a)];
    case 'dining':
      return [part(0, 0.76, 0, w, 0.08, d, 0xb98a55), part(-hw + 0.1, 0.36, -hd + 0.1, 0.08, 0.72, 0.08, WOOD), part(hw - 0.1, 0.36, -hd + 0.1, 0.08, 0.72, 0.08, WOOD), part(-hw + 0.1, 0.36, hd - 0.1, 0.08, 0.72, 0.08, WOOD), part(hw - 0.1, 0.36, hd - 0.1, 0.08, 0.72, 0.08, WOOD), part(-w * 0.25, 0.82, 0, 0.3, 0.03, 0.3, 0xffffff), part(w * 0.25, 0.82, 0, 0.3, 0.03, 0.3, 0xffffff), part(0, 0.86, 0, 0.12, 0.12, 0.12, 0xe5383b)];
    case 'desk':
      return [part(0, 0.74, 0, w, 0.06, d, 0xc9a36b), part(-hw + 0.3, 0.36, 0, 0.5, 0.72, d - 0.06, 0x8a6a40), part(hw - 0.05, 0.36, 0, 0.06, 0.72, d - 0.06, 0x8a6a40), part(0.1, 0.8, 0.05, 0.4, 0.02, 0.28, 0x30343c), part(0.1, 0.95, -0.1, 0.4, 0.28, 0.02, 0x1d2a3a)];
    case 'plant':
      return [part(0, 0.22, 0, 0.36, 0.44, 0.36, 0xc96a3b), part(0, 0.7, 0, 0.1, 0.5, 0.1, 0x6b4a2a), part(0, 1.1, 0, 0.5, 0.36, 0.5, 0x2e9e5b), part(0, 1.4, 0, 0.36, 0.3, 0.36, 0x3fb26b)];
    case 'lamp':
      return [part(0, 0.03, 0, 0.32, 0.06, 0.32, DARK), part(0, 0.85, 0, 0.04, 1.6, 0.04, 0x9aa0aa), part(0, 1.68, 0, 0.36, 0.3, 0.36, 0xfff1b8)];
    case 'rug':
      return [part(0, 0.012, 0, w, 0.024, d, 0x8e2f3a), part(0, 0.03, 0, w - 0.3, 0.012, d - 0.3, 0xe8c07a), part(0, 0.045, 0, w - 0.7, 0.01, d - 0.7, 0x8e2f3a)];
    case 'fridge':
      return [part(0, 0.9, 0, w, 1.8, d, 0xc9ced6), part(0, 1.2, hd + 0.005, w - 0.04, 0.012, 0.02, 0x7b8088), part(-w / 2 + 0.08, 1.4, hd + 0.03, 0.03, 0.4, 0.03, 0x4a4d55), part(-w / 2 + 0.08, 0.7, hd + 0.03, 0.03, 0.6, 0.03, 0x4a4d55)];
    case 'aquarium':
      return [part(0, 0.4, 0, w, 0.8, d, 0x2b2f38), part(0, 1.08, 0, w - 0.08, 0.56, d - 0.08, 0x7fd0ff), part(-w * 0.2, 1.1, 0, 0.1, 0.05, 0.05, 0xff8a1f), part(w * 0.15, 1.2, 0.04, 0.1, 0.05, 0.05, 0xffd23f), part(0, 0.84, 0, w - 0.04, 0.04, d - 0.04, DARK)];
    case 'piano':
      return [part(0, 0.6, 0, w, 1.2, d, 0x111216), part(0, 1.24, 0.04, w + 0.02, 0.05, d - 0.06, 0x1c1d22), part(0, 0.76, hd - 0.04, w * 0.9, 0.04, 0.22, 0xf5f5f0), part(0, 0.7, hd - 0.02, w * 0.9, 0.06, 0.16, 0x111216)];
    case 'billiard':
      return [part(0, 0.8, 0, w, 0.16, d, 0x5b3a1e), part(0, 0.9, 0, w - 0.3, 0.04, d - 0.3, 0x1d7a3a), part(-hw + 0.2, 0.36, -hd + 0.2, 0.14, 0.72, 0.14, 0x3d2812), part(hw - 0.2, 0.36, -hd + 0.2, 0.14, 0.72, 0.14, 0x3d2812), part(-hw + 0.2, 0.36, hd - 0.2, 0.14, 0.72, 0.14, 0x3d2812), part(hw - 0.2, 0.36, hd - 0.2, 0.14, 0.72, 0.14, 0x3d2812), part(0.3, 0.94, 0.05, 0.1, 0.1, 0.1, 0xfafafa), part(-0.3, 0.94, -0.05, 0.1, 0.1, 0.1, 0xd62828)];
    case 'mattress':
      return [part(0, 0.07, 0, w, 0.14, d, 0x8b6b43), part(0, 0.23, 0, w - 0.05, 0.3, d - 0.05, 0xf3efe6), part(0, 0.42, 0.3, w - 0.15, 0.08, d * 0.7, 0x2f6f9f), part(0, 0.48, -hd + 0.5, 0.9, 0.18, 0.55, 0xfffcf5)];
    case 'chair':
      return [part(0, 0.46, 0, 0.46, 0.06, 0.46, 0xe5383b), part(0, 0.9, -hd + 0.03, 0.46, 0.8, 0.06, 0xe5383b), part(-0.2, 0.22, -0.2, 0.05, 0.44, 0.05, 0x5a2a22), part(0.2, 0.22, -0.2, 0.05, 0.44, 0.05, 0x5a2a22), part(-0.2, 0.22, 0.2, 0.05, 0.44, 0.05, 0x5a2a22), part(0.2, 0.22, 0.2, 0.05, 0.44, 0.05, 0x5a2a22)];
    case 'stove':
      return [part(0, 0.25, 0, w, 0.5, d, 0x7a5a3a), part(0, 0.6, 0, 0.5, 0.2, 0.5, 0x555b66), part(0, 0.72, 0, 0.36, 0.04, 0.36, 0x2b2f36)];
    case 'kitchen':
      return [part(0, 0.45, 0, w, 0.9, d, 0x3b3f4a), part(0, 0.92, 0, w + 0.04, 0.06, d + 0.04, 0xd9dde3), part(-w * 0.25, 1.26 - 0.03, 0, 0.5, 0.02, 0.5, 0x15161a), part(w * 0.25, 1.26 - 0.03, 0, 0.5, 0.02, 0.5, 0x15161a), part(0, 1.1, -hd + 0.03, w, 0.35, 0.06, 0xc9ced6), part(0, 0.6, hd + 0.005, w - 0.08, 0.02, 0.02, 0x23262d)];
    case 'trunk':
      return [part(0, 0.22, 0, w, 0.44, d, 0x5b3a1e), part(0, 0.46, 0, w + 0.02, 0.04, d + 0.02, 0x3d2812), part(0, 0.3, hd + 0.01, 0.2, 0.08, 0.03, 0xd4af37)];
    case 'jerrycans':
      return [part(-0.22, 0.32, 0, 0.3, 0.64, d, 0xffce00), part(0.22, 0.32, 0, 0.3, 0.64, d, 0x22a861), part(-0.22, 0.68, 0, 0.12, 0.08, 0.12, 0x23262d), part(0.22, 0.68, 0, 0.12, 0.08, 0.12, 0x23262d)];
    case 'bucket':
      return [part(0, 0.4, 0, 0.6, 0.8, 0.6, 0x1f6feb), part(0, 0.82, 0, 0.62, 0.04, 0.62, 0x6aa8ff)];
    case 'fan': {
      // Ventilateur sur pied : pied en croix, tige, moteur, tête ronde (cage en anneaux, trois pales, moyeu)
      const head = 1.12;
      return [
        part(0, 0.03, 0, 0.42, 0.05, 0.08, DARK),
        part(0, 0.03, 0, 0.08, 0.05, 0.42, DARK),
        part(0, 0.55, 0, 0.05, 1.05, 0.05, 0xb8bcc4),
        disc(0, head, -0.1, 0.17, 0.16, 0x3a3f4a),
        disc(0, head, -0.02, 0.5, 0.025, 0x2b2f36),
        ring(0, head, 0.04, 0.5, 0.018, 0xd7dbe1),
        ring(0, head, 0.04, 0.34, 0.012, 0xd7dbe1),
        ring(0, head, 0.04, 0.18, 0.012, 0xd7dbe1),
        blade(0, head, 0.02, 0.4, 0, 0x7fc4e8),
        blade(0, head, 0.022, 0.4, Math.PI / 3, 0x7fc4e8),
        blade(0, head, 0.024, 0.4, (2 * Math.PI) / 3, 0x7fc4e8),
        disc(0, head, 0.05, 0.1, 0.04, 0xe8ebef),
      ];
    }
    case 'bedside':
      return [part(0, 0.34, 0, w, 0.68, d, 0x8b5a2b), part(0, 0.45, hd + 0.005, w - 0.12, 0.2, 0.02, 0x6d4024), part(0, 1.02, 0, 0.08, 0.7, 0.08, 0xc8b58f), part(0, 1.48, 0, 0.36, 0.3, 0.36, 0xf0d49b)];
    default:
      return [part(0, 0.3, 0, w, 0.6, d, 0x9aa0aa)];
  }
}
