// Headless benchmark + screenshot harness (dev only, no npm deps: raw Chrome DevTools Protocol over Node's global WebSocket).
//   node tools/bench.mjs [--url http://127.0.0.1:5173/] [--q ultra] [--views orbeli,komitas,square] [--out .scratch/bench] [--tod 0|0.5|1] [--w 1600 --h 900] [--secs 6]
// Needs the dev server running (npm run dev) and a Chromium binary: $CHROME, or Playwright's headless shell in %LOCALAPPDATA%\ms-playwright.
// Runs on the real GPU through ANGLE/D3D11 on Windows. Prints window.__yerevan.bench() per view (avg fps, 1% low, draw calls, triangles) and saves PNGs.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const URL0 = arg('url', 'http://127.0.0.1:5173/'), Q = arg('q', 'ultra'), OUT = arg('out', '.scratch/bench'), W = +arg('w', 1600), H = +arg('h', 900), SECS = +arg('secs', 6), TOD = arg('tod', null), EXTRA = arg('params', '');
const VIEWS = {
  // name: [camera x, y, z, target x, y, z]   (local metres: x east, z south, y up; 0,0 = Republic Square)
  square:  [70, 38, 150, 0, 4, 0],
  street:  [40, 3.2, 95, -20, 4, 20],                                  // Republic Square, eye level
  orbeli:  [-1525, 77.2, -1832, -1600, 81, -1800],                     // Orbeli Brothers St at BISA, eye level (ground ~75 m)
  orbeli_hi: [-1490, 112, -1880, -1590, 80, -1810],
  komitas: [-395, 160.5, -3222, -520, 164, -3150],                     // Komitas Ave, eye level (ground ~158 m)
  komitas_hi: [-320, 205, -3300, -480, 160, -3180],
  baghramyan: [-760, 99.5, -1990, -700, 92, -1950],
};
const views = arg('views', 'square,orbeli,komitas').split(',');

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = path.join(process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'), 'ms-playwright');
  for (const d of fs.existsSync(base) ? fs.readdirSync(base).sort().reverse() : []) {
    for (const exe of ['chrome-headless-shell-win64/chrome-headless-shell.exe', 'chrome-win/chrome.exe', 'chrome-linux/chrome']) { const p = path.join(base, d, exe); if (fs.existsSync(p)) return p; }
  }
  throw new Error('no Chromium found: set CHROME=/path/to/chrome');
}

const sleep = ms => new Promise(r => setTimeout(r, ms));
const PORT = 9300 + Math.floor(Math.random() * 500);
const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'ydbench-'));
const chrome = spawn(findChrome(), [`--remote-debugging-port=${PORT}`, `--user-data-dir=${prof}`, '--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl', '--disable-gpu-vsync', '--disable-frame-rate-limit',
  `--window-size=${W},${H}`, '--no-first-run', '--autoplay-policy=no-user-gesture-required', 'about:blank'], { stdio: 'ignore' });
let ws, seq = 0; const waiters = new Map();
function send(method, params = {}) { const id = ++seq; ws.send(JSON.stringify({ id, method, params })); return new Promise((res, rej) => waiters.set(id, { res, rej })); }
async function evaluate(expr, awaitPromise = true) {
  const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}
try {
  let list = null; for (let i = 0; i < 60 && !list; i++) { try { list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json(); } catch { await sleep(250); } }
  const page = list.find(t => t.type === 'page');
  ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  const logs = [];
  ws.onmessage = ev => { const m = JSON.parse(ev.data); if (m.id && waiters.has(m.id)) { const w = waiters.get(m.id); waiters.delete(m.id); m.error ? w.rej(new Error(m.error.message)) : w.res(m.result); } else if (m.method === 'Runtime.consoleAPICalled') { const t = m.params.args.map(a => a.value ?? a.description ?? '').join(' '); logs.push(`[${m.params.type}] ${t}`); } else if (m.method === 'Runtime.exceptionThrown') logs.push('[exception] ' + (m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)); };
  await send('Runtime.enable'); await send('Page.enable');
  await send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: 1, mobile: false });
  const url = `${URL0}?q=${Q}&gov=0&mp=0&menu=0${EXTRA ? '&' + EXTRA : ''}`;
  const t0 = Date.now();
  await send('Page.navigate', { url });
  for (;;) { await sleep(500); const ok = await evaluate('!!(window.__yerevan && document.getElementById("loading")?.classList.contains("done"))').catch(() => false); if (ok) break; if (Date.now() - t0 > 180000) throw new Error('load timeout\n' + logs.slice(-30).join('\n')); }
  console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s  (${url})`);
  fs.mkdirSync(OUT, { recursive: true });
  if (TOD !== null) await evaluate(`window.__yerevan.setTod(${+TOD})`);
  if (arg('prejs', null)) await evaluate(`(()=>{ const y = window.__yerevan; ${arg('prejs')} })()`);       // --prejs "<statements>": run before the views
  const results = {};
  for (const v of views) {
    const c = VIEWS[v]; if (!c && v !== 'drive') { console.warn('unknown view', v); continue; }
    if (v === 'drive') await evaluate(`(()=>{ const y = window.__yerevan; y.setMode('drive'); window.__car?.respawn?.(); })()`);       // player car, chase camera
    else await evaluate(`(()=>{ const y = window.__yerevan; y.setCam(${c.join(',')}); })()`);
    await evaluate(`new Promise(r => { const y = window.__yerevan; const s = y.streamer; let n = 0; const t = setInterval(() => { n++; if ((s.pending?.length ?? 0) === 0 && (s.queue?.length ?? 0) === 0 && s.active === 0 || n > 120) { clearInterval(t); r(); } }, 250); })`);
    await sleep(1500);
    await evaluate('window.__yerevan.benchReset?.()');
    await sleep(SECS * 1000);
    const b = await evaluate('window.__yerevan.bench()');
    results[v] = b; console.log(v.padEnd(11), JSON.stringify(b));
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(OUT, `${Q}_${v}${TOD !== null ? '_t' + TOD : ''}.png`), Buffer.from(shot.data, 'base64'));
  }
  // --js "<expression>": evaluate in the page (window.__yerevan as y) and print the JSON result
  if (arg('js', null)) console.log(JSON.stringify(await evaluate(`(()=>{ const y = window.__yerevan; return (${arg('js')}); })()`), null, 1));
  // --stats: what the draw calls are made of (visible meshes in the camera frustum, grouped by top-level owner and by material)
  if (process.argv.includes('--stats')) {
    const s = await evaluate(`(()=>{ const y = window.__yerevan, T = y.THREE, cam = y.camera, fr = new T.Frustum().setFromProjectionMatrix(new T.Matrix4().multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse));
      const own = {}, mat = {}; let objs = 0, vis = 0;
      const top = o => { let p = o; while (p.parent && p.parent !== y.scene) p = p.parent; return p.name || p.type; };
      y.scene.traverse(o => { objs++; });
      y.scene.traverseVisible(o => { if (!(o.isMesh || o.isLine || o.isPoints)) return; vis++; if (o.frustumCulled && o.geometry) { if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere(); if (!fr.intersectsObject(o)) return; }
        const t = top(o).replace(/tile_(\\d)_.*/, 'tile L$1'); own[t] = (own[t] || 0) + 1; const mn = (Array.isArray(o.material) ? 'multi' : o.material.name || o.material.type) + (o.isInstancedMesh ? ' [inst ' + o.count + ']' : ''); mat[mn] = (mat[mn] || 0) + 1; });
      const srt = m => Object.fromEntries(Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 30));
      return { sceneObjects: objs, visibleDrawables: vis, inFrustumByOwner: srt(own), inFrustumByMaterial: srt(mat) }; })()`);
    console.log(JSON.stringify(s, null, 1));
  }
  // --profile: 4 s JS CPU profile on the last view, self time aggregated per function (where the main thread actually goes)
  if (process.argv.includes('--profile')) {
    await send('Profiler.enable'); await send('Profiler.setSamplingInterval', { interval: 200 }); await send('Profiler.start'); await sleep(4000);
    const { profile } = await send('Profiler.stop'); const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n]));
    const dt = profile.timeDeltas, total = (profile.endTime - profile.startTime) / 1000;
    for (let i = 0; i < profile.samples.length; i++) { const n = byId.get(profile.samples[i]), cf = n.callFrame; const k = `${cf.functionName || '(anon)'}  ${cf.url.split('/').slice(-2).join('/').replace(/\?.*/, '')}:${cf.lineNumber + 1}`; self.set(k, (self.get(k) ?? 0) + (dt[i] ?? 0) / 1000); }
    const rows = [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    console.log(`--- CPU profile (${total.toFixed(0)} ms wall) ---`); for (const [k, v] of rows) console.log(`${(v / total * 100).toFixed(1).padStart(5)}%  ${v.toFixed(0).padStart(5)} ms  ${k}`);
  }
  // --exp: A/B cost of individual features on the last view (each snippet runs, is measured, then the page is restored with `undo`)
  if (process.argv.includes('--exp')) {
    const L = 'const y = window.__yerevan, sc = y.scene, r = y.renderer; let lights = []; sc.traverse(o => { if (o.isLight) lights.push(o); });';
    const EXP = [
      ['baseline', '', ''],
      ['pr1.0', 'r.setPixelRatio(1); y.fitForce?.()', `r.setPixelRatio(${'y.quality.targetPR'}); y.fitForce?.()`],
      ['noShadowMap', 'r.shadowMap.autoUpdate = false', 'r.shadowMap.autoUpdate = true'],
      ['msaa2', 'for (const t of [y.passes[0] && y.renderer && window.__yerevan.composer?.renderTarget1, window.__yerevan.composer?.renderTarget2]) if (t) { t._s = t.samples; t.samples = 2; t.dispose(); }', 'for (const t of [window.__yerevan.composer?.renderTarget1, window.__yerevan.composer?.renderTarget2]) if (t) { t.samples = t._s; t.dispose(); }'],
      ['msaa0', 'for (const t of [window.__yerevan.composer?.renderTarget1, window.__yerevan.composer?.renderTarget2]) if (t) { t._s = t.samples; t.samples = 0; t.dispose(); }', 'for (const t of [window.__yerevan.composer?.renderTarget1, window.__yerevan.composer?.renderTarget2]) if (t) { t.samples = t._s; t.dispose(); }'],
      ['noBloom', 'y.bloom.enabled = false', 'y.bloom.enabled = true'],
      ['noRT', 'y.fx && (y.fx.degrade = 1)', 'y.fx && (y.fx.degrade = 0)'],
      ['noRT+AO', 'y.fx && (y.fx.degrade = 2)', 'y.fx && (y.fx.degrade = 0)'],
      ['noProbe', 'y.probe && (y.probe.enabled = false)', 'y.probe && (y.probe.enabled = true)'],
      ['noPost', 'y.passes?.forEach(p => { if (p.isFxPass) { p.userData = p.enabled; p.enabled = false; } })', 'y.passes?.forEach(p => { if (p.isFxPass) p.enabled = p.userData; })'],
    ];
    for (const [name, doIt, undo] of EXP) {
      await evaluate(`(()=>{ ${L} ${doIt} })()`); await sleep(2500); await evaluate('window.__yerevan.benchReset?.()'); await sleep(SECS * 1000);
      const b = await evaluate('window.__yerevan.bench()'); console.log('exp', name.padEnd(13), `fps ${b.fps}  1%low ${b.low1}  calls ${b.drawCalls}  tris ${b.triM}M`);
      await evaluate(`(()=>{ ${L} ${undo} })()`); await sleep(1500);
    }
  }
  fs.writeFileSync(path.join(OUT, `${Q}_results.json`), JSON.stringify(results, null, 1));
  const errs = logs.filter(l => /error|exception|failed|warn/i.test(l)); if (errs.length) console.log('--- console warnings/errors ---\n' + [...new Set(errs)].slice(0, 40).join('\n'));
} catch (e) { console.error(e.message ?? e); process.exitCode = 1; }
finally { try { ws?.close(); } catch { /* ignore */ } chrome.kill(); await sleep(300); try { fs.rmSync(prof, { recursive: true, force: true }); } catch { /* ignore */ } }
