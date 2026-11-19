// Real-world car shapes common in Yerevan. u = fraction of body length measured from the REAR bumper (0) to the nose (1); y in metres above ground.
// top = centre-line silhouette [u, y, fillet radius m]; rwB/rwT = rear window base/top, wsT/wsB = windshield top/base (u).
const sedanTop = p => [[0, p.tailY], [p.deckU ?? 0.09, p.deckR, 0.1], [p.rwB, p.deckR + 0.012, p.rwBr ?? 0.35], [p.rwT, p.roof - 0.012, p.rwTr ?? 0.5], [p.wsT, p.roof, p.wsTr ?? 0.5], [p.wsB, p.hoodY, p.wsBr ?? 0.22], [p.hoodEnd ?? 0.965, p.noseY, p.noseR ?? 0.14], [1, p.noseY - (p.noseDrop ?? 0.12)]];
const hatchTop = p => [[0, p.tailY], [p.rwB, p.deckR, p.rwBr ?? 0.12], [p.rwT, p.roof - 0.012, p.rwTr ?? 0.5], [p.wsT, p.roof, p.wsTr ?? 0.5], [p.wsB, p.hoodY, p.wsBr ?? 0.22], [p.hoodEnd ?? 0.965, p.noseY, p.noseR ?? 0.14], [1, p.noseY - (p.noseDrop ?? 0.12)]];
const vanTop = p => [[0, p.tailY], [p.rwB, p.roof - 0.02, 0.1], [p.rwT, p.roof, 0.12], [p.wsT, p.roof, p.wsTr ?? 0.25], [p.wsB, p.hoodY, p.wsBr ?? 0.25], [p.hoodEnd ?? 0.975, p.noseY, p.noseR ?? 0.12], [1, p.noseY - (p.noseDrop ?? 0.14)]];
const sedan = p => ({ ...p, top: sedanTop(p), win: p.win ?? [[p.rwT - 0.035, p.wsB - 0.012]] });
const hatch = p => ({ ...p, top: hatchTop(p), win: p.win ?? [[p.rwB + 0.06, p.wsB - 0.012]] });

export const SPECS = {
  vaz2107: sedan({ L: 4.15, W: 1.62, yb: 0.20, wr: 0.29, tw: 0.175, wb: 2.42, fo: 0.80, belt: 0.93, beltR: 0.94, beltF: 0.90, roofW: 0.83, hoodW: 0.9, roofR: 0.06,
    tailY: 0.80, deckR: 0.945, rwB: 0.215, rwT: 0.34, roof: 1.43, wsT: 0.585, wsB: 0.705, hoodY: 0.905, noseY: 0.855, hoodEnd: 0.965, noseR: 0.08, noseDrop: 0.1,
    doors: [0.69, 0.49, 0.30], bp: [[0.485, 0.515]], bumper: 'chrome', head: { x: 0.64, y: 0.67, w: 0.12, h: 0.072 }, tail: { x: 0.68, y: 0.80, w: 0.17, h: 0.055 },
    grille: { y: 0.64, h: 0.07, w: 0.25, bars: 3 }, plateY: 0.52, plateYR: 0.68, rimStyle: 'steel', trunkLine: true, mirrorCol: [0.5, 0.5, 0.5] }),
  niva: ({ ...{ L: 3.74, W: 1.68, yb: 0.23, wr: 0.33, tw: 0.18, wb: 2.2, fo: 0.72, belt: 1.02, roofW: 0.86, hoodW: 0.93, roofR: 0.05, tailY: 1.05, deckR: 1.05, rwB: 0.02, rwT: 0.075, roof: 1.64, wsT: 0.62, wsB: 0.725, hoodY: 1.0, noseY: 0.97, hoodEnd: 0.97, noseR: 0.06, noseDrop: 0.1 },
    top: [[0, 0.9], [0.01, 1.05, 0.08], [0.02, 1.58, 0.1], [0.075, 1.64, 0.2], [0.62, 1.64, 0.35], [0.725, 1.0, 0.2], [0.97, 0.97, 0.08], [1, 0.88]],
    win: [[0.1, 0.71]], doors: [0.725, 0.44], bp: [], bumper: 'chrome', head: { x: 0.6, y: 0.78, w: 0.095, h: 0.095, round: true }, tail: { x: 0.68, y: 1.0, w: 0.09, h: 0.1 }, grille: { y: 0.76, h: 0.08, w: 0.3, bars: 3 },
    plateY: 0.55, plateYR: 0.8, rimStyle: 'steel', rack: true, noAntenna: true }),
  samara: hatch({ L: 4.0, W: 1.65, yb: 0.19, wr: 0.28, tw: 0.17, wb: 2.46, fo: 0.74, belt: 0.92, roofW: 0.8, roofR: 0.07, tailY: 0.8, deckR: 0.96, rwB: 0.04, rwT: 0.25, roof: 1.40, wsT: 0.6, wsB: 0.745, hoodY: 0.86, noseY: 0.8, noseDrop: 0.12,
    doors: [0.72, 0.5, 0.3], bp: [[0.495, 0.525]], bumper: 'plastic', bumperY: 0.55, head: { x: 0.6, y: 0.7, w: 0.16, h: 0.06 }, tail: { x: 0.68, y: 0.9, w: 0.1, h: 0.14 }, grille: { y: 0.64, h: 0.04, w: 0.22, bars: 2 }, plateY: 0.5, plateYR: 0.75, rimStyle: 'steel' }),
  astra: hatch({ L: 4.25, W: 1.75, yb: 0.17, wr: 0.31, tw: 0.195, wb: 2.61, fo: 0.82, belt: 0.93, roofW: 0.8, roofR: 0.09, tailY: 0.82, deckR: 0.98, rwB: 0.035, rwT: 0.22, roof: 1.46, wsT: 0.56, wsB: 0.72, hoodY: 0.88, noseY: 0.8, noseDrop: 0.13, hoodEnd: 0.96,
    doors: [0.72, 0.5, 0.29], bp: [[0.495, 0.525]], bumper: 'plastic', bumperY: 0.6, head: { x: 0.64, y: 0.72, w: 0.2, h: 0.06 }, tail: { x: 0.7, y: 0.93, w: 0.12, h: 0.1 }, grille: { y: 0.62, h: 0.04, w: 0.2, bars: 2, logo: true }, plateY: 0.5, plateYR: 0.8, rimStyle: 'alloy5' }),
  camry: sedan({ L: 4.8, W: 1.82, yb: 0.17, wr: 0.32, tw: 0.215, wb: 2.78, fo: 0.96, belt: 0.98, roofW: 0.79, roofR: 0.09, tailY: 0.86, deckR: 1.01, deckU: 0.1, rwB: 0.165, rwT: 0.3, roof: 1.47, wsT: 0.6, wsB: 0.74, hoodY: 0.94, noseY: 0.85, noseDrop: 0.12, hoodEnd: 0.955,
    doors: [0.73, 0.5, 0.31], bp: [[0.495, 0.525]], bumper: 'plastic', bumperY: 0.62, head: { x: 0.66, y: 0.74, w: 0.21, h: 0.06 }, tail: { x: 0.7, y: 0.95, w: 0.2, h: 0.07 }, grille: { y: 0.6, h: 0.06, w: 0.32, bars: 4, logo: true }, plateY: 0.5, plateYR: 0.82, rimStyle: 'alloy5' }),
  prius: hatch({ L: 4.46, W: 1.745, yb: 0.16, wr: 0.31, tw: 0.195, wb: 2.7, fo: 0.9, belt: 0.95, roofW: 0.78, roofR: 0.09, tailY: 0.86, deckR: 0.98, rwB: 0.045, rwT: 0.4, roof: 1.49, wsT: 0.595, wsB: 0.76, hoodY: 0.86, noseY: 0.76, noseDrop: 0.1, hoodEnd: 0.95, rwTr: 0.9, wsTr: 0.9,
    doors: [0.755, 0.52, 0.3], bp: [[0.515, 0.545]], bumper: 'plastic', bumperY: 0.62, head: { x: 0.66, y: 0.7, w: 0.22, h: 0.05 }, tail: { x: 0.7, y: 0.98, w: 0.12, h: 0.12 }, grille: { y: 0.55, h: 0.035, w: 0.3, bars: 2, logo: true }, plateY: 0.48, plateYR: 0.86, rimStyle: 'alloy6', win: [[0.12, 0.745]] }),
  rav4: hatch({ L: 4.40, W: 1.815, yb: 0.21, wr: 0.35, tw: 0.225, wb: 2.66, fo: 0.9, belt: 1.08, roofW: 0.84, roofR: 0.09, tailY: 1.0, deckR: 1.06, rwB: 0.03, rwT: 0.085, roof: 1.69, wsT: 0.585, wsB: 0.74, hoodY: 1.04, noseY: 0.99, noseDrop: 0.2, hoodEnd: 0.96, rwBr: 0.1, rwTr: 0.3,
    doors: [0.735, 0.49, 0.3], bp: [[0.485, 0.515]], bumper: 'plastic', bumperY: 0.7, bumperLen: 0.4, skirts: true, head: { x: 0.66, y: 0.88, w: 0.2, h: 0.065 }, tail: { x: 0.72, y: 1.06, w: 0.08, h: 0.17 }, grille: { y: 0.74, h: 0.07, w: 0.3, bars: 3, logo: true }, plateY: 0.58, plateYR: 0.95, rimStyle: 'alloy5', rack: true, win: [[0.1, 0.73]] }),
  w124: sedan({ L: 4.75, W: 1.74, yb: 0.19, wr: 0.30, tw: 0.195, wb: 2.8, fo: 0.88, belt: 0.95, roofW: 0.8, hoodW: 0.9, roofR: 0.07, tailY: 0.87, deckR: 1.0, deckU: 0.08, rwB: 0.185, rwT: 0.315, roof: 1.41, wsT: 0.585, wsB: 0.715, hoodY: 0.93, noseY: 0.83, noseDrop: 0.1, hoodEnd: 0.965,
    doors: [0.725, 0.5, 0.31], bp: [[0.495, 0.525]], bumper: 'plastic', bumperY: 0.55, skirts: true, head: { x: 0.65, y: 0.7, w: 0.18, h: 0.065 }, tail: { x: 0.7, y: 0.92, w: 0.19, h: 0.09 }, grille: { y: 0.66, h: 0.075, w: 0.2, bars: 6, logo: true }, plateY: 0.46, plateYR: 0.8, rimStyle: 'alloy10', trunkLine: true }),
  elantra: sedan({ L: 4.55, W: 1.78, yb: 0.16, wr: 0.32, tw: 0.205, wb: 2.7, fo: 0.9, belt: 0.96, roofW: 0.78, roofR: 0.09, tailY: 0.84, deckR: 0.99, deckU: 0.1, rwB: 0.17, rwT: 0.31, roof: 1.45, wsT: 0.585, wsB: 0.745, hoodY: 0.92, noseY: 0.83, noseDrop: 0.12, hoodEnd: 0.955,
    doors: [0.735, 0.5, 0.31], bp: [[0.495, 0.525]], bumper: 'plastic', bumperY: 0.6, head: { x: 0.66, y: 0.74, w: 0.21, h: 0.06 }, tail: { x: 0.7, y: 0.93, w: 0.2, h: 0.07 }, grille: { y: 0.6, h: 0.05, w: 0.26, bars: 3, logo: true }, plateY: 0.5, plateYR: 0.8, rimStyle: 'alloy6' }),
  e39: sedan({ L: 4.78, W: 1.80, yb: 0.16, wr: 0.32, tw: 0.215, wb: 2.83, fo: 0.88, belt: 0.95, roofW: 0.78, roofR: 0.09, tailY: 0.83, deckR: 0.99, deckU: 0.1, rwB: 0.17, rwT: 0.305, roof: 1.43, wsT: 0.56, wsB: 0.725, hoodY: 0.9, noseY: 0.8, noseDrop: 0.12, hoodEnd: 0.96,
    doors: [0.73, 0.5, 0.31], bp: [[0.495, 0.525]], bumper: 'plastic', bumperY: 0.55, head: { x: 0.66, y: 0.7, w: 0.2, h: 0.06 }, tail: { x: 0.7, y: 0.9, w: 0.2, h: 0.065 }, grille: { style: 'kidney', y: 0.63, h: 0.05, w: 0.22, bars: 3, logo: false }, plateY: 0.46, plateYR: 0.8, rimStyle: 'alloy10' }),
  mazda3: hatch({ L: 4.46, W: 1.755, yb: 0.16, wr: 0.32, tw: 0.2, wb: 2.64, fo: 0.9, belt: 0.95, roofW: 0.79, roofR: 0.09, tailY: 0.84, deckR: 1.0, rwB: 0.04, rwT: 0.24, roof: 1.465, wsT: 0.58, wsB: 0.74, hoodY: 0.9, noseY: 0.8, noseDrop: 0.13, hoodEnd: 0.955,
    doors: [0.73, 0.5, 0.3], bp: [[0.495, 0.525]], bumper: 'plastic', bumperY: 0.6, head: { x: 0.66, y: 0.74, w: 0.21, h: 0.055 }, tail: { x: 0.7, y: 0.96, w: 0.12, h: 0.1 }, grille: { y: 0.6, h: 0.045, w: 0.26, bars: 2, logo: true }, plateY: 0.5, plateYR: 0.84, rimStyle: 'alloy5' }),
  transit: ({ L: 5.2, W: 1.97, yb: 0.27, wr: 0.34, tw: 0.195, wb: 3.3, fo: 0.95, belt: 1.14, roofW: 0.9, hoodW: 0.93, roofR: 0.06, tailY: 1.25, rwB: 0.012, rwT: 0.03, roof: 2.0, wsT: 0.775, wsB: 0.875, hoodY: 1.1, noseY: 0.95, hoodEnd: 0.985, noseDrop: 0.2,
    top: [[0, 1.5], [0.008, 1.98, 0.08], [0.02, 2.0, 0.1], [0.775, 2.0, 0.3], [0.875, 1.1, 0.25], [0.985, 0.95, 0.12], [1, 0.8]], hw: [[0, 0.88], [0.02, 0.97], [0.06, 0.995], [0.8, 1], [0.93, 0.99], [1, 0.82]],
    win: [[0.79, 0.865]], doors: [0.705, 0.44, 0.9], bp: [], noRearGlass: true, bumper: 'plastic', bumperY: 0.7, bumperLen: 0.3, skirts: true, head: { x: 0.68, y: 0.9, w: 0.2, h: 0.075 }, tail: { x: 0.8, y: 1.0, w: 0.06, h: 0.25 },
    grille: { y: 0.75, h: 0.07, w: 0.3, bars: 2, logo: true }, plateY: 0.6, plateYR: 0.9, rimStyle: 'steel', noAntenna: true, trunkLine: false, hoodLine: false }),
  gazelle: ({ L: 5.5, W: 2.07, yb: 0.3, wr: 0.36, tw: 0.185, wb: 2.9, fo: 0.9, belt: 1.12, roofW: 0.92, hoodW: 0.94, roofR: 0.06, tailY: 1.2, rwB: 0.012, rwT: 0.03, roof: 2.2, wsT: 0.8, wsB: 0.875, hoodY: 1.08, noseY: 0.98, hoodEnd: 0.985, noseDrop: 0.16,
    top: [[0, 1.4], [0.008, 2.18, 0.08], [0.02, 2.2, 0.1], [0.62, 2.2, 0.06], [0.64, 1.95, 0.1], [0.8, 1.95, 0.25], [0.875, 1.08, 0.2], [0.985, 0.98, 0.1], [1, 0.84]], hw: [[0, 0.9], [0.02, 0.97], [0.06, 0.995], [0.8, 1], [0.93, 0.99], [1, 0.84]],
    win: [[0.7, 0.87]], doors: [0.64, 0.71, 0.905], bp: [], noRearGlass: true, bumper: 'chrome', head: { x: 0.68, y: 0.84, w: 0.12, h: 0.1, round: true }, tail: { x: 0.8, y: 0.9, w: 0.06, h: 0.15 }, grille: { y: 0.7, h: 0.1, w: 0.3, bars: 4 },
    plateY: 0.6, plateYR: 0.9, rimStyle: 'steel', noAntenna: true, hoodLine: false }),
};
SPECS.taxi = { ...SPECS.camry, taxi: true, rack: false };

/** model order used by props.json (cars[i*7+3]) */
export const MODELS = ['vaz2107', 'niva', 'samara', 'astra', 'camry', 'prius', 'rav4', 'w124', 'elantra', 'e39', 'mazda3', 'transit', 'gazelle', 'taxi'];
/** relative frequency in central Yerevan (the build tool picks with these weights) */
export const MODEL_WEIGHT = [0.12, 0.04, 0.05, 0.1, 0.12, 0.06, 0.05, 0.08, 0.09, 0.05, 0.05, 0.04, 0.03, 0.12];
