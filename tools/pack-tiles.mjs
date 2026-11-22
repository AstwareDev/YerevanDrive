// Packs every coarse tile (level >= 3: horizon terrain / far buildings, ~128 files, 4 MB) into ONE file: public/tiles/pack34.bin + pack34.json.
// A cold start needs all of them (the horizon must never be empty); fetching 128 tiny files costs more in request overhead than in bytes.
// Usage: node tools/pack-tiles.mjs      (re-run after tools/build-tiles.mjs)
import fs from 'node:fs';
import path from 'node:path';

const MIN_LEVEL = 3, dir = 'public/tiles';
const man = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
const index = {}; const parts = []; let off = 0;
for (const [Ls, list] of Object.entries(man.levels)) {
  const L = +Ls; if (L < MIN_LEVEL) continue;
  for (const [i, j] of list) {
    const f = path.join(dir, String(L), `${i}_${j}.glb`); if (!fs.existsSync(f)) continue;
    const b = fs.readFileSync(f); index[`${L}_${i}_${j}`] = [off, b.length]; parts.push(b); off += b.length;
    off = (off + 3) & ~3; if (off !== parts.reduce((s, p) => s + p.length, 0)) { const pad = off - parts.reduce((s, p) => s + p.length, 0); parts.push(Buffer.alloc(pad)); }
  }
}
fs.writeFileSync(path.join(dir, 'pack34.bin'), Buffer.concat(parts));
fs.writeFileSync(path.join(dir, 'pack34.json'), JSON.stringify({ minLevel: MIN_LEVEL, index }));
console.log(`packed ${Object.keys(index).length} tiles, ${(off / 1e6).toFixed(2)} MB`);
