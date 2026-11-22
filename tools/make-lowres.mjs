// Half-resolution variants of the big photo layers, used by the Low / Medium presets (and as the smaller download on weak devices):
//   public/map/aerial.2k.webp, aerial_mid.2k.webp, aerial_hi.2k.webp  (4096^2 -> 2048^2: 89 MB -> 22 MB of VRAM each, 4x fewer bytes to decode)
//   public/tex/roadfield.2k.png                                          (4096^2 RGBA -> 2048^2, channels resized independently: A is a width, not opacity)
// Usage: node tools/make-lowres.mjs      (re-run after tools/fetch-imagery.mjs / tools/build-textures.mjs)
import sharp from 'sharp';
import fs from 'node:fs';

const webp = async (src, dst, size = 2048) => {
  if (!fs.existsSync(src)) { console.warn('skip (missing)', src); return; }
  await sharp(src).resize(size, size, { kernel: 'lanczos3' }).webp({ quality: 82, effort: 5 }).toFile(dst);
  console.log(dst, (fs.statSync(dst).size / 1e6).toFixed(2) + ' MB');
};
await webp('public/map/aerial.webp', 'public/map/aerial.2k.webp');
await webp('public/map/aerial_mid.webp', 'public/map/aerial_mid.2k.webp');
await webp('public/map/aerial_hi.webp', 'public/map/aerial_hi.2k.webp');

// road field: R,G = road direction (cos2a, sin2a), B = lateral position, A = half width. Resize every channel on its own (no premultiplied alpha).
if (fs.existsSync('public/tex/roadfield.png')) {
  const raw = await sharp('public/tex/roadfield.png').ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const { width, height, channels } = raw.info;
  const chans = [];
  for (let c = 0; c < 4; c++) {
    const plane = Buffer.alloc(width * height); for (let i = 0; i < width * height; i++) plane[i] = raw.data[i * channels + c];
    chans.push(await sharp(plane, { raw: { width, height, channels: 1 } }).resize(width / 2, height / 2, { kernel: 'mitchell' }).raw().toBuffer());
  }
  const n = (width / 2) * (height / 2), out = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) for (let c = 0; c < 4; c++) out[i * 4 + c] = chans[c][i];
  await sharp(out, { raw: { width: width / 2, height: height / 2, channels: 4 } }).png({ compressionLevel: 9 }).toFile('public/tex/roadfield.2k.png');
  console.log('public/tex/roadfield.2k.png', (fs.statSync('public/tex/roadfield.2k.png').size / 1e6).toFixed(2) + ' MB');
}
