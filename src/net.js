// Shared, memoised fetches. Several plug-ins used to download + parse the same JSON on their own (colliders.json x2, props.json x3,
// height.bin after the tiles...), one after the other. Everything here is started once, as early as possible, and shared.
const cache = new Map();
const once = (key, make) => { let p = cache.get(key); if (!p) { p = make(); cache.set(key, p); p.catch(() => cache.delete(key)); } return p; };

export const fetchJSON = url => once('j:' + url, async () => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.json(); });
export const fetchBuffer = url => once('b:' + url, async () => { const r = await fetch(url); if (!r.ok) throw new Error(`${url}: ${r.status}`); return r.arrayBuffer(); });

/** Start the downloads every start-up needs, all at once, before any code asks for them (the old chain was strictly sequential). */
export function warmStartup() {
  const lowMem = (navigator.deviceMemory ?? 8) <= 4;
  const json = ['/map/meta.json', '/tiles/manifest.json', '/map/height.json', '/map/colliders.json', '/map/props.json', '/map/surface.json', '/map/circuits.json', '/tex/manifest.json'];
  for (const u of json) fetchJSON(u).catch(() => { });
  fetchBuffer('/map/height.bin').catch(() => { });
  void lowMem;
}
