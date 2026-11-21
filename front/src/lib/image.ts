/**
 * Prépare une image d'annonce sur l'appareil : redimensionnée (1024 px max), réencodée en WebP (ou JPEG),
 * ce qui retire les métadonnées (position GPS, appareil) et réduit le poids sous 400 Ko.
 */
export async function prepareAdImage(file: File, maxSide = 1024, maxBytes = 400 * 1024): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('invalid_image');
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
  const w = Math.max(64, Math.round(bmp.width * k));
  const h = Math.max(64, Math.round(bmp.height * k));
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const g = cv.getContext('2d');
  if (!g) throw new Error('invalid_image');
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close();
  for (const q of [0.85, 0.7, 0.55, 0.4]) {
    const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, 'image/webp', q));
    const out = blob && blob.type === 'image/webp' ? blob : await new Promise<Blob | null>((ok) => cv.toBlob(ok, 'image/jpeg', q));
    if (out && out.size <= maxBytes) return out;
  }
  throw new Error('image_too_large');
}

/**
 * Prépare un logo : redimensionné (512 px au plus), transparence conservée (PNG, ou WebP si plus léger), sans métadonnées,
 * 300 Ko au plus. Les petites images ne sont pas agrandies.
 */
export async function prepareLogo(file: File, maxSide = 512, maxBytes = 300 * 1024): Promise<Blob> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('invalid_image');
  const bmp = await createImageBitmap(file);
  let side = maxSide;
  for (let attempt = 0; attempt < 4; attempt++) {
    const k = Math.min(1, side / Math.max(bmp.width, bmp.height));
    const w = Math.max(32, Math.round(bmp.width * k));
    const h = Math.max(32, Math.round(bmp.height * k));
    const cv = document.createElement('canvas');
    cv.width = w;
    cv.height = h;
    const g = cv.getContext('2d');
    if (!g) throw new Error('invalid_image');
    g.drawImage(bmp, 0, 0, w, h);
    const png = await new Promise<Blob | null>((ok) => cv.toBlob(ok, 'image/png'));
    if (png && png.size <= maxBytes) {
      bmp.close();
      return png;
    }
    const webp = await new Promise<Blob | null>((ok) => cv.toBlob(ok, 'image/webp', 0.9));
    if (webp && webp.type === 'image/webp' && webp.size <= maxBytes) {
      bmp.close();
      return webp;
    }
    side = Math.round(side * 0.7);
  }
  bmp.close();
  throw new Error('image_too_large');
}
