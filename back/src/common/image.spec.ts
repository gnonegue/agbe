import { describe, expect, it } from 'vitest';
import { sniffImage } from './image';

const png = (w: number, h: number) => {
  const b = Buffer.alloc(40);
  b.writeUInt32BE(0x89504e47, 0);
  b.writeUInt32BE(0x0d0a1a0a, 4);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'ascii');
  b.writeUInt32BE(w, 16);
  b.writeUInt32BE(h, 20);
  return b;
};

describe('vérification d’image', () => {
  it('reconnaît un PNG et ses dimensions', () => {
    expect(sniffImage(png(800, 600))).toEqual({ mime: 'image/png', width: 800, height: 600 });
  });
  it('refuse un faux fichier (HTML, script) même nommé .png', () => {
    expect(sniffImage(Buffer.from('<html><script>alert(1)</script></html>'.padEnd(64, ' ')))).toBeNull();
    expect(sniffImage(Buffer.alloc(8))).toBeNull();
  });
  it('reconnaît un JPEG (SOF0)', () => {
    const b = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, 0xff, 0xc0, 0x00, 0x11, 0x08, 0x01, 0x2c, 0x02, 0x58, ...Array(24).fill(0)]);
    expect(sniffImage(b)).toEqual({ mime: 'image/jpeg', width: 600, height: 300 });
  });
});
