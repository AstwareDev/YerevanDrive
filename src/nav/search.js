// Offline geocoder over the OSM data baked into nav.json: streets, named places (POIs), and "street + house number" addresses.
// Matches Armenian / English / Russian names, tolerant of transliteration variants (Baghramyan = Bagramyan) and small typos.
// Optional online fallback (OpenStreetMap Nominatim) for things outside the baked area: only on an explicit Enter press.
import { CENTER } from './geo.js';

// folded key: lower-case, no diacritics, and the usual Armenian->Latin spelling variants collapsed (gh=g, kh=k, ts=c, ch=c, sh=s, zh=j, ...)
export function fold(s) {
  return (s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .replace(/ё/g, 'е')
    .replace(/gh/g, 'g').replace(/kh/g, 'k').replace(/zh/g, 'j').replace(/dz/g, 'z').replace(/ts/g, 'c').replace(/tch|ch/g, 'c').replace(/sh/g, 's').replace(/ph/g, 'f')
    .replace(/ou|oo/g, 'u').replace(/ee|ie|ye/g, 'i').replace(/y/g, 'i').replace(/w/g, 'v').replace(/q/g, 'k').replace(/x/g, 'k').replace(/h(?=[^a-z]|$)/g, '')
    .replace(/(.)\1+/g, '$1')
    .replace(/[^\p{L}\p{N}/ ]+/gu, ' ').replace(/\s+/g, ' ').trim();
}
const STOP = new Set(['st', 'street', 'str', 'ave', 'avenue', 'av', 'blvd', 'road', 'rd', 'the', 'of', 'in', 'near', 'yerevan', 'erevan', 'armenia', 'ul', 'ulica', 'проспект', 'улица', 'ул']);

function lev(a, b, max) {                           // bounded Levenshtein
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) { const cur = [i]; let rowMin = i; for (let j = 1; j <= b.length; j++) { const v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); cur.push(v); if (v < rowMin) rowMin = v; } if (rowMin > max) return max + 1; prev = cur; }
  return prev[b.length];
}
/** does query token q match word w (prefix or near-prefix)?  returns 0 (no) .. 3 (exact) */
function tokenScore(q, w) {
  if (w === q) return 3;
  if (w.startsWith(q)) return 2.2;
  if (q.length >= 4) { if (w.includes(q)) return 1.2; const max = q.length >= 7 ? 2 : 1; if (lev(q, w.slice(0, q.length + 1), max) <= max) return 1.5; }
  return 0;
}

export const CAT_LABEL = {
  metro: 'Metro station', station: 'Station', cafe: 'Cafe', restaurant: 'Restaurant', fast_food: 'Fast food', bar: 'Bar', pub: 'Pub', hotel: 'Hotel', museum: 'Museum', theatre: 'Theatre', cinema: 'Cinema', bank: 'Bank',
  pharmacy: 'Pharmacy', hospital: 'Hospital', clinic: 'Clinic', school: 'School', university: 'University', college: 'College', kindergarten: 'Kindergarten', library: 'Library', fuel: 'Fuel station', parking: 'Parking',
  place_of_worship: 'Place of worship', townhall: 'Town hall', police: 'Police', post_office: 'Post office', mall: 'Shopping mall', supermarket: 'Supermarket', park: 'Park', garden: 'Garden', stadium: 'Stadium', playground: 'Playground',
  government: 'Government', diplomatic: 'Embassy', monument: 'Monument', memorial: 'Memorial', attraction: 'Attraction', gallery: 'Gallery', bakery: 'Bakery', commercial: 'Commercial building', office: 'Office', church: 'Church',
};
export const catLabel = c => { if (!c) return 'Place'; const v = c.includes(':') ? c.split(':')[1] : c; return CAT_LABEL[v] ?? (v.charAt(0).toUpperCase() + v.slice(1).replace(/_/g, ' ')); };
const CHIPS = [['Metro', c => c === 'metro' || c === 'station'], ['Food & drink', c => /:(cafe|restaurant|fast_food|bar|pub|bakery)$/.test(c)], ['Parks', c => /:(park|garden|playground)$/.test(c)], ['Hotels', c => /:(hotel|hostel|guest_house)$/.test(c)], ['Shopping', c => /^shop:/.test(c)], ['Culture', c => /:(museum|theatre|cinema|gallery|library|attraction|monument|memorial)$/.test(c)]];
export const CHIP_NAMES = CHIPS.map(c => c[0]);

export class Search {
  constructor(nav) {
    const j = this.j = nav.j; this.nav = nav;
    const nameKeys = this.nameKeys = j.names.map(n => ({ en: n[1] || n[0], hy: n[0], keys: [...new Set([fold(n[1] || ''), fold(n[0]), n[2] ? n[2].toLowerCase() : ''].filter(Boolean))] }));
    // entries: street parts, POIs; addresses are searched through their street
    this.streets = j.streets.map(s => ({ kind: 'street', ni: s[0], x: s[1], z: s[2], len: s[3], cls: s[4], title: nameKeys[s[0]].en, sub: nameKeys[s[0]].hy !== nameKeys[s[0]].en ? nameKeys[s[0]].hy : '', keys: nameKeys[s[0]].keys }));
    this.pois = j.pois.map(p => {
      const nk = nameKeys[p[0]], cat = j.cats[p[1]];
      const addr = p[4] >= 0 ? `${nameKeys[p[4]].en} ${p[5]}`.trim() : '';
      return { kind: 'poi', ni: p[0], x: p[2], z: p[3], cat, title: nk.en, sub: [catLabel(cat), addr].filter(Boolean).join(' · '), keys: nk.keys };
    });
    // addresses grouped per street-name index: [{num, x, z, name?}]
    this.addr = new Map(j.addr.map(a => [a[0], a[1].map(r => ({ num: r[0], x: r[1], z: r[2], name: r[3] }))]));
    // token index for fast filtering: word -> entries
    this.all = [...this.streets, ...this.pois];
  }
  /** parse "<street words> <number>" */
  static parse(q) {
    q = q.trim(); const m = q.match(/^(.*?)[\s,]+(\d+(?:[/-]\d+)?[a-zA-Zա-ֆ]?)$/) ?? q.match(/^(\d+(?:[/-]\d+)?[a-zA-Zա-ֆ]?)[\s,]+(.*)$/);
    if (!m) return { text: q, num: '' };
    return /^\d/.test(m[1]) ? { text: m[2], num: m[1] } : { text: m[1], num: m[2] };
  }
  /** score an entry against query tokens; returns 0 if any token fails */
  score(e, toks) {
    let total = 0;
    for (const t of toks) {
      let best = 0;
      for (const k of e.keys) for (const w of k.split(' ')) { const s = tokenScore(t, w); if (s > best) best = s; }
      if (!best) return 0; total += best;
    }
    // shorter names win ties ("Komitas avenue" over "Komitas avenue 1st lane")
    const k0 = e.keys[0] ?? ''; return total / toks.length + (toks.length >= 1 ? 1 / (1 + k0.length * 0.05) : 0);
  }
  /** returns up to `limit` results sorted by relevance, then by distance from (ox,oz) */
  query(q, ox = 0, oz = 0, limit = 8) {
    const { text, num } = Search.parse(q);
    const toks = fold(text).split(' ').filter(t => t && !STOP.has(t)); if (num === '' && !toks.length) return [];
    const res = [];
    if (toks.length) {
      for (const e of this.all) { const s = this.score(e, toks); if (s > 0) res.push({ ...e, score: s * (e.kind === 'poi' ? 1.1 : 1) }); }
      // collapse street parts with the same name: keep the one closest to the origin, mention the others
      const seen = new Map();
      for (const r of res.slice()) if (r.kind === 'street') { const prev = seen.get(r.ni); if (!prev) seen.set(r.ni, r); else { const d = Math.hypot(r.x - ox, r.z - oz), dp = Math.hypot(prev.x - ox, prev.z - oz); if (d < dp) { res.splice(res.indexOf(prev), 1); seen.set(r.ni, r); } else res.splice(res.indexOf(r), 1); } }
    }
    // addresses: street match + house number
    if (num !== '' || (toks.length && /\d/.test(q))) {
      const streetNis = new Set(res.filter(r => r.kind === 'street').map(r => r.ni));
      for (const ni of streetNis) {
        const list = this.addr.get(ni); if (!list) continue;
        const exact = list.filter(a => a.num.toLowerCase() === num.toLowerCase());
        const nearest = exact.length ? exact : list.filter(a => a.num.toLowerCase().startsWith(num.toLowerCase()) || (parseInt(a.num) === parseInt(num))).slice(0, 4);
        for (const a of nearest) {
          const nk = this.nameKeys[ni];
          res.push({ kind: 'address', ni, x: a.x, z: a.z, num: a.num, title: `${nk.en} ${a.num}`, sub: (a.name >= 0 ? this.nameKeys[a.name].en + ' · ' : '') + 'Address', keys: nk.keys, score: 10 + (exact.length ? 2 : 0) });
        }
        if (!exact.length && num) { const nums = list.map(a => parseInt(a.num)).filter(Number.isFinite); const n = parseInt(num); if (nums.length && Number.isFinite(n)) { const nn = [...new Set(nums)].sort((a, b) => Math.abs(a - n) - Math.abs(b - n)).slice(0, 3); const r = res.find(r => r.kind === 'street' && r.ni === ni); if (r) r.sub = `No “${num}” in the data · nearest numbers: ${nn.join(', ')}`; } }
      }
    }
    res.sort((a, b) => b.score - a.score || Math.hypot(a.x - ox, a.z - oz) - Math.hypot(b.x - ox, b.z - oz));
    return res.slice(0, limit);
  }
  /** category chip -> nearest matching places */
  chip(i, ox, oz, limit = 8) {
    const f = CHIPS[i][1]; return this.pois.filter(p => f(p.cat)).map(p => ({ ...p, d: Math.hypot(p.x - ox, p.z - oz) })).sort((a, b) => a.d - b.d).slice(0, limit);
  }
  /** nearest address / street label for an arbitrary point (reverse geocode) */
  reverse(x, z) {
    let best = null, bd = 40 * 40;
    for (const [ni, list] of this.addr) for (const a of list) { const d = (a.x - x) ** 2 + (a.z - z) ** 2; if (d < bd) { bd = d; best = { title: `${this.nameKeys[ni].en} ${a.num}`, sub: 'Nearest address' }; } }
    if (best) return best;
    const st = this.nav.streetAt(x, z, 90); if (st) return { title: st, sub: 'Near this street' };
    return { title: 'Dropped pin', sub: `${x.toFixed(0)}, ${z.toFixed(0)} m from Republic Square` };
  }
  /** nearest named place (for picking by clicking the map) */
  poiAt(x, z, maxD) {
    let best = null, bd = maxD * maxD; for (const p of this.pois) { const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < bd) { bd = d; best = p; } } return best;
  }
}

/** OpenStreetMap Nominatim, only when asked (Enter) and when the local index is not enough. */
export async function onlineSearch(q, signal) {
  const dLat = 0.09, dLon = 0.12;
  const url = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=en&addressdetails=0&viewbox=' + [CENTER.lon - dLon, CENTER.lat + dLat, CENTER.lon + dLon, CENTER.lat - dLat].join(',') + '&bounded=1&q=' + encodeURIComponent(q.includes('Yerevan') ? q : q + ', Yerevan');
  const r = await fetch(url, { signal, headers: { Accept: 'application/json' } }); if (!r.ok) throw new Error('geocoder ' + r.status);
  return (await r.json()).map(o => ({ kind: 'online', title: o.name || o.display_name.split(',')[0], sub: o.display_name.split(',').slice(0, 3).join(',').trim(), lat: +o.lat, lon: +o.lon, score: 0.1 }));
}
