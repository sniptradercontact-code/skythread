// ============================================================================
//  SKYTHREAD — world: a compressed Manhattan-style island
//  Avenues run north-south (along z), cross streets run east-west (along x).
//  Uptown is +z, Downtown is -z.  East (the Brooklyn side) is -x, west is +x,
//  so facing uptown the east river is on your right, as in the real city.
//  Static geometry is split into chunks so the renderer can cull what is off screen.
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const AVE = 28, ST = 16, WALK = 5;       // avenue width, street width, sidewalk depth
export const BX = 168, BZ = 76;                 // block pitch incl. roads (blocks are 140 x 60)
export const NA = 9, NS = 32;                   // blocks across, blocks long
export const HALFX = (NA * BX) / 2, HALFZ = (NS * BZ) / 2;
export const EDGE = 14, SH = 0.25;
const SHOP_H = 5, TILE = 32;
const E0 = -(HALFX + EDGE + 330), E1 = E0 - 760;      // east borough (negative x)
const W0 = HALFX + EDGE + 430, W1 = W0 + 760;         // west shore (positive x)
// traffic signal cycle (seconds): avenues roll first, then the cross streets
export const CYC = 40, AVE_T0 = 0, AVE_GO = 16, ST_T0 = 18, ST_GO = 20;

export const clampN = (v, a, b) => (v < a ? a : v > b ? b : v);
let seed = 20261113;
export function rnd() { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
export const rr = (a, b) => a + (b - a) * rnd();
export const pick = (a) => a[(rnd() * a.length) | 0];
const gauss = (x) => Math.exp(-x * x);

// ---------------------------------------------------------------- island layout
function colRange(j) { if (j === 0) return [3, 5]; if (j === 1) return [2, 6]; if (j === 2) return [1, 7]; if (j === NS - 1) return [2, 6]; if (j === NS - 2) return [1, 7]; return [0, NA - 1]; }
export const cellOK = (i, j) => j >= 0 && j < NS && i >= colRange(j)[0] && i <= colRange(j)[1];
const PARK = { i0: 3, i1: 5, j0: 19, j1: 27 };
export const inPark = (i, j) => i >= PARK.i0 && i <= PARK.i1 && j >= PARK.j0 && j <= PARK.j1;
function zoneOf(i, j) {
  if (j === 0) return 'battery';
  if (inPark(i, j)) return 'park';
  if (j <= 6) return 'fidi';
  if (j <= 11) return 'village';
  if (j <= 18) return 'midtown';
  if (j <= 27) return i > 5 ? 'uws' : 'ues';
  return 'uptown';
}
const ZONE_NAMES = { battery: 'BATTERY PARK', park: 'CENTRAL PARK', fidi: 'FINANCIAL DISTRICT', village: 'THE VILLAGE', midtown: 'MIDTOWN', uws: 'UPPER WEST SIDE', ues: 'UPPER EAST SIDE', uptown: 'HARLEM' };
const AV_NAMES = ['1 AV', '3 AV', 'PARK AV', '5 AV', '6 AV', '7 AV', '8 AV', '9 AV', '10 AV', '11 AV'];
const ST_NAMES = ['BATTERY PL', 'WALL ST', 'FULTON ST', 'CHAMBERS ST', 'WORTH ST', 'CANAL ST', 'BROOME ST', 'HOUSTON ST', '4 ST', '8 ST', '14 ST', '18 ST', '23 ST', '28 ST', '34 ST', '42 ST', '47 ST', '50 ST', '57 ST', '59 ST', '65 ST', '72 ST', '79 ST', '86 ST', '91 ST', '96 ST', '103 ST', '110 ST', '116 ST', '125 ST', '135 ST', '145 ST', '155 ST'];
const LANDS = [];
export function groundAt(x, z) {
  for (const L of LANDS) if (x > L[0] && x < L[1] && z > L[2] && z < L[3]) return true;
  for (let dx = -EDGE; dx <= EDGE; dx += EDGE) for (let dz = -EDGE; dz <= EDGE; dz += EDGE) {
    if (cellOK(Math.floor((x + dx + HALFX) / BX), Math.floor((z + dz + HALFZ) / BZ))) return true;
  }
  return false;
}
export function zoneAt(x, z) {
  const i = Math.floor((x + HALFX) / BX), j = Math.floor((z + HALFZ) / BZ);
  if (cellOK(i, j)) return ZONE_NAMES[zoneOf(i, j)];
  if (x < E0 && x > E1) return 'BROOKLYN';
  if (x > W0 && x < W1) return 'NEW JERSEY';
  return '';
}
export function streetAt(x, z) {
  const a = Math.round((x + HALFX) / BX), r = Math.round((z + HALFZ) / BZ);
  if (a < 0 || a > NA || r < 0 || r > NS) return '';
  return ST_NAMES[r] + ' & ' + AV_NAMES[a];
}

// ---------------------------------------------------------------- textures
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function grain(ctx, w, h, amt) { const id = ctx.getImageData(0, 0, w, h), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; } ctx.putImageData(id, 0, 0); }
function shade(hex, v) { const c = new THREE.Color(hex); c.multiplyScalar(1 + v * 0.3); return '#' + c.getHexString(); }
let ANISO = 8;
function tex(cv, srgb = true) { const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANISO; return t; }

function brickPattern(c, S) {
  for (let y = 0; y < S; y += 12) {
    c.fillStyle = 'rgba(40,20,15,0.32)'; c.fillRect(0, y, S, 2);
    const off = ((y / 12) % 2) * 14;
    for (let x = off; x < S; x += 28) { c.fillStyle = 'rgba(40,20,15,0.25)'; c.fillRect(x, y, 2, 12); c.fillStyle = `rgba(${rnd() < 0.5 ? '255,220,200' : '30,10,5'},${rr(0.02, 0.11)})`; c.fillRect(x + 2, y + 2, 26, 10); }
  }
}
function piers(c, S, cs) { for (let x = 0; x < S; x += cs) { c.fillStyle = 'rgba(80,60,30,0.2)'; c.fillRect(x - 12, 0, 24, S); c.fillStyle = 'rgba(255,245,220,0.16)'; c.fillRect(x - 12, 0, 6, S); } }
const WARM = ['#ffd9a0', '#fff1d6', '#ffcf85', '#ffe7c2'], COOL = ['#d8ecff', '#fff6e0', '#cfe3ff', '#ffe9c8'];
const STYLES = [
  { name: 'glassBlue', glass: 1, wall: '#33404e', frame: '#3d4854', win: { l: 2, r: 2, t: 3, b: 9 }, gTop: '#a9cdea', gBot: '#44698c', gVar: 0.3, gRough: '#141414', wRough: '#8a8a8a', lit: 0.26, litCols: COOL, mullion: true, metal: 0.75 },
  { name: 'glassTeal', glass: 1, wall: '#2b4444', frame: '#35504f', win: { l: 2, r: 2, t: 3, b: 8 }, gTop: '#a4e3d8', gBot: '#377878', gVar: 0.3, gRough: '#151515', wRough: '#8a8a8a', lit: 0.26, litCols: COOL, mullion: true, metal: 0.75 },
  { name: 'glassDark', glass: 1, wall: '#15181c', frame: '#22272d', win: { l: 2, r: 2, t: 2, b: 6 }, gTop: '#4f6f80', gBot: '#17222a', gVar: 0.25, gRough: '#101010', wRough: '#666666', lit: 0.24, litCols: COOL, mullion: true, metal: 0.85 },
  { name: 'bronze', glass: 1, wall: '#35271c', frame: '#4a3524', win: { l: 3, r: 3, t: 3, b: 8 }, gTop: '#dcb078', gBot: '#6d4a28', gVar: 0.25, gRough: '#161616', wRough: '#777777', lit: 0.26, litCols: WARM, mullion: true, metal: 0.8 },
  { name: 'brickRed', wall: '#8f4a35', frame: '#e3dccb', win: { l: 17, r: 17, t: 12, b: 20 }, gTop: '#42566a', gBot: '#1b242c', gVar: 0.3, gRough: '#333333', wRough: '#f0f0f0', lit: 0.34, litCols: WARM, sill: '#d8d0bd', pattern: brickPattern, escapes: true, metal: 0 },
  { name: 'brickBrown', wall: '#74553c', frame: '#2c2a28', win: { l: 16, r: 16, t: 11, b: 19 }, gTop: '#4a5e70', gBot: '#1c252d', gVar: 0.3, gRough: '#333333', wRough: '#f0f0f0', lit: 0.34, litCols: WARM, sill: '#5d4630', pattern: brickPattern, escapes: true, metal: 0 },
  { name: 'limestone', wall: '#cfc1a0', win: { l: 20, r: 20, t: 8, b: 14 }, gTop: '#4c6074', gBot: '#1e2832', gVar: 0.3, gRough: '#2c2c2c', wRough: '#e6e6e6', lit: 0.3, litCols: WARM, sill: '#b9a57f', pattern: piers, metal: 0.02 },
  { name: 'concrete', wall: '#c8c6bf', win: { l: 3, r: 3, t: 14, b: 18 }, gTop: '#667b8e', gBot: '#2a3743', gVar: 0.2, gRough: '#262626', wRough: '#dddddd', lit: 0.28, litCols: WARM, bands: '#a9a69c', bandH: 6, metal: 0.05 },
];
function makeFacade(o) {
  const S = 1024, C = 8, cs = S / C, K = 2;
  const [cc, c] = mk(S, S), [rc, r] = mk(S / 2, S / 2), [ec, e] = mk(S / 2, S / 2), [nc, n] = mk(S / 2, S / 2);
  r.scale(0.5, 0.5); e.scale(0.5, 0.5); n.scale(0.5, 0.5);
  c.fillStyle = o.wall; c.fillRect(0, 0, S, S);
  r.fillStyle = o.wRough; r.fillRect(0, 0, S, S);
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  n.fillStyle = '#8080ff'; n.fillRect(0, 0, S, S);
  if (o.pattern) o.pattern(c, S, cs);
  for (let fy = 0; fy < C; fy++) for (let fx = 0; fx < C; fx++) {
    const x = fx * cs, y = fy * cs, w = o.win;
    const wx = x + w.l * K, wy = y + w.t * K, ww = cs - (w.l + w.r) * K, wh = cs - (w.t + w.b) * K;
    if (o.frame) { c.fillStyle = o.frame; c.fillRect(wx - 4, wy - 4, ww + 8, wh + 8); r.fillStyle = '#777'; r.fillRect(wx - 4, wy - 4, ww + 8, wh + 8); }
    const v = rr(-1, 1) * o.gVar;
    const g = c.createLinearGradient(wx, wy, wx + ww * 0.3, wy + wh);
    g.addColorStop(0, shade(o.gTop, v)); g.addColorStop(1, shade(o.gBot, v));
    c.fillStyle = g; c.fillRect(wx, wy, ww, wh);
    if (rnd() < 0.5) { c.save(); c.globalAlpha = rr(0.06, 0.16); c.fillStyle = '#eef4ff'; c.beginPath(); const sx = wx + ww * rr(-0.2, 0.5); c.moveTo(sx, wy + wh); c.lineTo(sx + ww * 0.45, wy); c.lineTo(sx + ww * 0.8, wy); c.lineTo(sx + ww * 0.35, wy + wh); c.fill(); c.restore(); }
    if (!o.glass && rnd() < 0.34) { c.fillStyle = `rgba(${pick(['232,224,205', '205,212,220', '190,170,150'])},${rr(0.45, 0.8)})`; c.fillRect(wx, wy, ww, wh * rr(0.25, 0.7)); }   // blinds
    r.fillStyle = o.gRough; r.fillRect(wx, wy, ww, wh);
    if (o.mullion) { c.fillStyle = o.frame || o.wall; c.fillRect(wx + ww / 2 - 2, wy, 4, wh); }
    else { c.fillStyle = o.frame || '#d9d2c2'; c.fillRect(wx, wy + wh * 0.48, ww, 3); }                                                       // sash bar
    // window reveal in the normal map: the pane sits back from the wall
    const d = 6; n.fillStyle = '#d880ff'; n.fillRect(wx - 1, wy, d, wh); n.fillStyle = '#2880ff'; n.fillRect(wx + ww - d + 1, wy, d, wh);
    n.fillStyle = '#8028ff'; n.fillRect(wx, wy - 1, ww, d); n.fillStyle = '#80d8ff'; n.fillRect(wx, wy + wh - d + 1, ww, d);
    if (rnd() < o.lit) {
      e.globalAlpha = rr(0.4, 1); e.fillStyle = pick(o.litCols); e.fillRect(wx + 1, wy + 1, ww - 2, wh - 2); e.globalAlpha = 1;
      if (rnd() < 0.4) { e.fillStyle = '#000'; e.fillRect(wx, wy, ww, wh * rr(0.2, 0.6)); }
    }
    if (o.sill) { c.fillStyle = o.sill; c.fillRect(wx - 8, wy + wh + 4, ww + 16, 8); c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(wx - 8, wy + wh + 12, ww + 16, 3); n.fillStyle = '#80d8ff'; n.fillRect(wx - 8, wy + wh + 4, ww + 16, 4); }
    if (!o.glass && rnd() < 0.13) { const aw = ww * 0.5, ax = wx + ww * 0.25, ay = wy + wh - 20; c.fillStyle = '#a3a39e'; c.fillRect(ax, ay, aw, 22); c.fillStyle = '#6f6f6b'; for (let q = 3; q < 20; q += 5) c.fillRect(ax + 3, ay + q, aw - 6, 2); e.fillStyle = '#000'; e.fillRect(ax, ay, aw, 22); }   // window air conditioner
  }
  if (o.bands) { c.fillStyle = o.bands; for (let fy = 0; fy < C; fy++) c.fillRect(0, fy * cs + cs - o.bandH * K, S, o.bandH * K); }
  if (o.escapes) for (const fx of [2, 6]) { // iron fire escapes zig-zagging down one bay
    const x = fx * cs;
    for (let fy = 0; fy < C; fy++) {
      const y = fy * cs + cs - 30;
      c.fillStyle = '#17181a'; c.fillRect(x + 6, y, cs - 12, 6); e.fillStyle = '#000'; e.fillRect(x + 6, y - 26, cs - 12, 32);
      c.fillRect(x + 6, y - 26, cs - 12, 3); for (let q = 8; q < cs - 8; q += 12) c.fillRect(x + q, y - 26, 2, 26);
      c.strokeStyle = '#17181a'; c.lineWidth = 4; c.beginPath(); c.moveTo(x + (fy % 2 ? 14 : cs - 14), y + 6); c.lineTo(x + (fy % 2 ? cs - 30 : 30), y + cs); c.stroke();
      n.fillStyle = '#80d8ff'; n.fillRect(x + 6, y - 2, cs - 12, 4);
    }
  }
  grain(c, S, S, 8);
  return { map: tex(cc), rough: tex(rc, false), emi: tex(ec), nrm: tex(nc, false) };
}
// ground-floor storefronts: 4 shop units across (8 m each), 5 m tall
function makeShops() {
  const W = 1024, H = 256, [cc, c] = mk(W, H), [ec, e] = mk(W / 2, H / 2);
  e.scale(0.5, 0.5);
  c.fillStyle = '#2b2a2a'; c.fillRect(0, 0, W, H); e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  const signs = ['#c8372f', '#2f6fb0', '#e0a422', '#2f8a57', '#7a3fa0', '#d86a1f', '#1f8f93', '#b0b0b0'];
  for (let u = 0; u < 4; u++) {
    const x = u * 256, sc = pick(signs);
    c.fillStyle = pick(['#3a3836', '#4a4038', '#33373b', '#5a5248']); c.fillRect(x, 0, 256, H);
    c.fillStyle = sc; c.fillRect(x + 12, 12, 232, 48);                                // sign band
    c.fillStyle = 'rgba(255,255,255,0.8)'; const n = 2 + ((rnd() * 4) | 0);           // abstract lettering blocks
    for (let k = 0; k < n; k++) c.fillRect(x + 32 + k * (184 / n), 26, (184 / n) * 0.7, 20);
    e.fillStyle = sc; e.globalAlpha = 0.55; e.fillRect(x + 12, 12, 232, 48); e.globalAlpha = 1;
    c.fillStyle = shade(sc, -1.2); c.fillRect(x + 8, 64, 240, 16);                    // awning
    c.fillStyle = 'rgba(255,255,255,0.18)'; for (let q = 8; q < 248; q += 24) c.fillRect(x + q, 64, 12, 16);
    const g = c.createLinearGradient(0, 84, 0, 236); g.addColorStop(0, '#8fb0c8'); g.addColorStop(1, '#31485a');
    c.fillStyle = g; c.fillRect(x + 16, 88, 140, 136);                                // display window
    c.fillStyle = 'rgba(30,25,20,0.55)'; for (let q = 0; q < 4; q++) c.fillRect(x + 26 + q * 32, 150 + rr(0, 30), 22, 74);   // goods on display
    e.fillStyle = pick(WARM); e.globalAlpha = rr(0.5, 0.95); e.fillRect(x + 16, 88, 140, 136); e.globalAlpha = 1;
    c.fillStyle = '#1b1a19'; c.fillRect(x + 84, 88, 4, 136);
    c.fillStyle = '#24211e'; c.fillRect(x + 172, 108, 64, 148);                       // door
    c.fillStyle = g; c.fillRect(x + 180, 116, 48, 80);
    e.fillStyle = '#ffe2b0'; e.globalAlpha = 0.45; e.fillRect(x + 180, 116, 48, 80); e.globalAlpha = 1;
    c.fillStyle = '#c9b458'; c.fillRect(x + 220, 200, 6, 16);
    c.fillStyle = '#1e1d1c'; c.fillRect(x, 236, 256, 20);                             // kick plate
    c.fillStyle = '#222'; c.fillRect(x, 0, 4, H);
  }
  grain(c, W, H, 8);
  return { map: tex(cc), emi: tex(ec) };
}
function makeWalkTex() {
  const S = 256, [cv, c] = mk(S, S);
  c.fillStyle = '#a7a39c'; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(0,0,0,${rr(0.03, 0.1)})`; c.beginPath(); c.ellipse(rnd() * S, rnd() * S, rr(3, 16), rr(2, 8), rnd() * 3, 0, 7); c.fill(); }
  c.fillStyle = 'rgba(60,58,55,0.5)'; c.fillRect(0, 0, S, 3); c.fillRect(0, 0, 3, S); c.fillRect(0, S / 2, S, 2); c.fillRect(S / 2, 0, 2, S);
  grain(c, S, S, 12); return tex(cv);
}
// one road tile per block: half an avenue on the left/right edges, half a street top/bottom
function makeGroundTex() {
  const W = 2048, H = 1024, [cv, c] = mk(W, H), sx = W / BX, sz = H / BZ;
  const R = (x0, z0, x1, z1) => c.fillRect(x0 * sx, z0 * sz, (x1 - x0) * sx, (z1 - z0) * sz);
  c.fillStyle = '#38393c'; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 700; i++) { c.fillStyle = `rgba(0,0,0,${rr(0.04, 0.11)})`; c.beginPath(); c.ellipse(rnd() * W, rnd() * H, rr(4, 40), rr(2, 12), rnd() * 3, 0, 7); c.fill(); }
  for (let i = 0; i < 90; i++) { c.strokeStyle = `rgba(15,15,15,${rr(0.2, 0.5)})`; c.lineWidth = rr(1, 2.5); c.beginPath(); let px = rnd() * W, py = rnd() * H; c.moveTo(px, py); for (let k = 0; k < 4; k++) { px += rr(-40, 40); py += rr(-30, 30); c.lineTo(px, py); } c.stroke(); }   // cracks and tar seams
  for (let i = 0; i < 26; i++) { c.fillStyle = `rgba(${rnd() < 0.5 ? '70,70,74' : '30,30,32'},0.5)`; const px = rr(0, BX - 8), pz = rr(0, BZ - 5); R(px, pz, px + rr(2, 8), pz + rr(1.5, 5)); }   // asphalt patches
  const hA = AVE / 2, hS = ST / 2;
  c.fillStyle = 'rgba(160,58,46,0.5)'; R(7, hS, 11.5, BZ - hS);                       // bus lane
  c.fillStyle = 'rgba(236,236,230,0.85)';
  for (let z = hS + 6; z < BZ - hS - 8; z += 7) { R(-0.1, z, 0.1, z + 3); R(5.9, z, 6.1, z + 3); R(BX - 6.1, z, BX - 5.9, z + 3); R(BX - 0.1, z, BX + 0.1, z + 3); }
  R(11.9, hS + 4, 12.05, BZ - hS - 4); R(BX - 12.05, hS + 4, BX - 11.9, BZ - hS - 4);
  for (let x = hA + 6; x < BX - hA - 8; x += 8) { R(x, -0.08, x + 3.2, 0.08); R(x, BZ - 0.08, x + 3.2, BZ + 0.08); }
  R(hA + 3, 5.7, BX - hA - 3, 5.82); R(hA + 3, BZ - 5.82, BX - hA - 3, BZ - 5.7);     // parking lane lines
  c.fillStyle = 'rgba(240,240,235,0.9)';                                              // crosswalks + stop bars
  for (let x = 0.6; x < hA - 0.6; x += 1.3) { R(x, hS + 0.6, x + 0.65, hS + 3.8); R(BX - x - 0.65, hS + 0.6, BX - x, hS + 3.8); R(x, BZ - hS - 3.8, x + 0.65, BZ - hS - 0.6); R(BX - x - 0.65, BZ - hS - 3.8, BX - x, BZ - hS - 0.6); }
  for (let z = 0.5; z < hS - 0.4; z += 1.3) { R(hA + 0.6, z, hA + 3.8, z + 0.65); R(BX - hA - 3.8, z, BX - hA - 0.6, z + 0.65); R(hA + 0.6, BZ - z - 0.65, hA + 3.8, BZ - z); R(BX - hA - 3.8, BZ - z - 0.65, BX - hA - 0.6, BZ - z); }
  R(0, hS + 4.6, hA, hS + 5.0); R(BX - hA, hS + 4.6, BX, hS + 5.0); R(0, BZ - hS - 5.0, hA, BZ - hS - 4.6); R(BX - hA, BZ - hS - 5.0, BX, BZ - hS - 4.6);
  R(hA + 4.6, 0, hA + 5.0, hS); R(BX - hA - 5.0, 0, BX - hA - 4.6, hS); R(hA + 4.6, BZ - hS, hA + 5.0, BZ); R(BX - hA - 5.0, BZ - hS, BX - hA - 4.6, BZ);
  for (let i = 0; i < 14; i++) { const mx = (i < 7 ? rr(1, 12) : rr(BX - 12, BX - 1)) * sx, mz = rr(hS + 4, BZ - hS - 4) * sz; c.fillStyle = 'rgba(22,22,22,0.75)'; c.beginPath(); c.arc(mx, mz, 5, 0, 7); c.fill(); c.strokeStyle = 'rgba(90,90,90,0.6)'; c.lineWidth = 1; c.stroke(); }   // manholes
  grain(c, W, H, 14);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ANISO; return t;
}
export function makeWebTex() {
  const S = 128, [cv, c] = mk(S, S), m = S / 2;
  c.strokeStyle = 'rgba(240,248,255,0.95)'; c.lineWidth = 2;
  const spokes = 9;
  for (let i = 0; i < spokes; i++) { const a = (i / spokes) * Math.PI * 2 + rnd() * 0.2; c.beginPath(); c.moveTo(m, m); c.lineTo(m + Math.cos(a) * m * 0.95, m + Math.sin(a) * m * 0.95); c.stroke(); }
  c.lineWidth = 1.3;
  for (const rad of [0.25, 0.45, 0.68]) { c.beginPath(); for (let i = 0; i <= spokes; i++) { const a = (i / spokes) * Math.PI * 2; const x = m + Math.cos(a) * m * rad, y = m + Math.sin(a) * m * rad; i ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ---------------------------------------------------------------- geometry builder (with vertex colours)
const WHITE = [1, 1, 1];
export const C3 = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
export class GB {
  constructor() { this.p = []; this.n = []; this.u = []; this.c = []; this.i = []; }
  quad(a, b, c, d, n, ua, ub, uc, ud, col = WHITE) {
    const k = this.p.length / 3;
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2], d[0], d[1], d[2]);
    for (let j = 0; j < 4; j++) { this.n.push(n[0], n[1], n[2]); this.c.push(col[0], col[1], col[2]); }
    this.u.push(ua[0], ua[1], ub[0], ub[1], uc[0], uc[1], ud[0], ud[1]);
    this.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  tri(a, b, c, col = WHITE) {
    const k = this.p.length / 3;
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.p.push(a[0], a[1], a[2], b[0], b[1], b[2], c[0], c[1], c[2]);
    for (let j = 0; j < 3; j++) { this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); this.u.push(0, 0); }
    this.i.push(k, k + 1, k + 2);
  }
  wall(ax, az, bx, bz, y0, y1, tile, uoff, col, vfix) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    const n = [-dz / len, 0, dx / len];
    const u0 = uoff / tile, u1 = (uoff + len) / tile, v0 = vfix ? 0 : y0 / tile, v1 = vfix ? 1 : y1 / tile;
    this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], n, [u0, v0], [u1, v0], [u1, v1], [u0, v1], col);
  }
  walls(x0, x1, z0, z1, y0, y1, tile, col, vfix) {
    this.wall(x1, z1, x1, z0, y0, y1, tile, z1, col, vfix);
    this.wall(x0, z0, x0, z1, y0, y1, tile, z0, col, vfix);
    this.wall(x0, z1, x1, z1, y0, y1, tile, x0, col, vfix);
    this.wall(x1, z0, x0, z0, y0, y1, tile, x1, col, vfix);
  }
  top(x0, x1, z0, z1, y, tile, col) { this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [0, 1, 0], [x0 / tile, z0 / tile], [x0 / tile, z1 / tile], [x1 / tile, z1 / tile], [x1 / tile, z0 / tile], col); }
  bottom(x0, x1, z0, z1, y, col) { this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0], [0, 0], [1, 0], [1, 1], [0, 1], col); }
  box(x0, x1, y0, y1, z0, z1, col, under) { this.walls(x0, x1, z0, z1, y0, y1, 8, col); this.top(x0, x1, z0, z1, y1, 8, col); if (under) this.bottom(x0, x1, z0, z1, y0, col); }
  pyr(x0, x1, z0, z1, y, h, col) {
    const A = [(x0 + x1) / 2, y + h, (z0 + z1) / 2];
    this.tri([x1, y, z1], [x1, y, z0], A, col); this.tri([x0, y, z0], [x0, y, z1], A, col);
    this.tri([x0, y, z1], [x1, y, z1], A, col); this.tri([x1, y, z0], [x0, y, z0], A, col);
  }
  disc(cx, cz, rx, rz, y, seg, col) {
    for (let k = 0; k < seg; k++) {
      const a0 = (k / seg) * Math.PI * 2, a1 = ((k + 1) / seg) * Math.PI * 2;
      this.tri([cx, y, cz], [cx + Math.cos(a1) * rx, y, cz + Math.sin(a1) * rz], [cx + Math.cos(a0) * rx, y, cz + Math.sin(a0) * rz], col);
    }
  }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i); g.computeBoundingSphere(); return g;
  }
}
export function paint(g, col) {
  const n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col[0]; a[i * 3 + 1] = col[1]; a[i * 3 + 2] = col[2]; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
}

// ---------------------------------------------------------------- collision grid
export const boxes = [];
const CELL = 32, GOFF = 4096;
const grid = new Map();
let qStamp = 0;
function addBox(minX, maxX, minY, maxY, minZ, maxZ, slab = false) {
  const b = { minX, maxX, minY, maxY, minZ, maxZ, slab, idx: boxes.length, stamp: 0 };
  boxes.push(b);
  const x0 = Math.floor((minX + GOFF) / CELL), x1 = Math.floor((maxX + GOFF) / CELL);
  const z0 = Math.floor((minZ + GOFF) / CELL), z1 = Math.floor((maxZ + GOFF) / CELL);
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const k = x * 4096 + z; let a = grid.get(k); if (!a) grid.set(k, (a = [])); a.push(b); }
  return b;
}
export function query(minX, maxX, minZ, maxZ, out) {
  out.length = 0; qStamp++;
  const x0 = Math.floor((minX + GOFF) / CELL), x1 = Math.floor((maxX + GOFF) / CELL);
  const z0 = Math.floor((minZ + GOFF) / CELL), z1 = Math.floor((maxZ + GOFF) / CELL);
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
    const a = grid.get(x * 4096 + z); if (!a) continue;
    for (const b of a) if (b.stamp !== qStamp) { b.stamp = qStamp; out.push(b); }
  }
  return out;
}

// ============================================================================
export function buildWorld(scene, renderer) {
  ANISO = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const facadeTex = STYLES.map(makeFacade);
  const facadeMats = STYLES.map((s, i) => { const t = facadeTex[i]; return new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.rough, roughness: 1, metalness: s.metal, emissiveMap: t.emi, emissive: 0xffffff, emissiveIntensity: 0.5, normalMap: t.nrm, normalScale: new THREE.Vector2(0.9, 0.9), vertexColors: true }); });
  const shopT = makeShops();
  const shopMat = new THREE.MeshStandardMaterial({ map: shopT.map, emissiveMap: shopT.emi, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.75, vertexColors: true });
  const flatMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const walkMat = new THREE.MeshLambertMaterial({ map: makeWalkTex(), vertexColors: true });
  const groundMat = new THREE.MeshLambertMaterial({ map: makeGroundTex() });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const nightMat = new THREE.MeshBasicMaterial({ vertexColors: true });

  // chunk buckets: everything static is grouped by district-sized chunks for frustum culling
  const buckets = {};
  let B = null;
  const useB = (key) => (B = buckets[key] || (buckets[key] = { fb: STYLES.map(() => new GB()), shop: new GB(), flat: new GB(), walk: new GB(), ground: new GB(), night: new GB(), neon: new GB(), spill: new GB(), geos: [], trees: [], lamps: [] }));
  const cellB = (i, j) => useB('c' + Math.floor(clampN(i, 0, NA - 1) / 3) + '_' + Math.floor(clampN(j, 0, NS - 1) / 4));
  const bbSpots = [], map = { b: [], slabs: [], feats: [], lands: [], lines: [] };
  const vents = [];
  const sigB = { ag: new GB(), ar: new GB(), sg: new GB(), sr: new GB() };
  const K = {
    trim: C3(0xc9c2b4), stone: C3(0xb9a98a), metal: C3(0x8d9296), dark: C3(0x24272b), steel: C3(0x6f8296), grass: C3(0x4f7a36), lawn: C3(0x6a9744),
    path: C3(0xc9b68c), water: C3(0x2a5a78), quay: C3(0x8f8c86), land: C3(0x4c5148), wood: C3(0x6b4a2f), signal: C3(0xd9a516), pier: C3(0x7b6a55),
    red: C3(0xb3261e), green: C3(0x1f4d33), blue: C3(0x1f3f7a), scaf: C3(0x245a3c), glass: C3(0x8fb3c7), door: C3(0x3a2c22),
  };
  const SPILL = [[1, 0.8, 0.52], [1, 0.9, 0.7], [0.85, 0.93, 1], [1, 0.68, 0.45], [1, 0.86, 0.6]];
  const NEON = [[2.2, 0.25, 0.5], [0.2, 1.8, 2.2], [2.2, 1.5, 0.2], [0.4, 2.1, 0.6], [2.0, 0.5, 2.2], [2.2, 0.7, 0.15], [2.2, 2.0, 1.6], [0.35, 0.7, 2.3]];
  const ROOFS = [C3(0x5d5c5a), C3(0x6b6862), C3(0x4c4b4a), C3(0x75695a), C3(0x8a8880), C3(0x57604f), C3(0x3f3e3d)];
  const CROWN = [[2.2, 1.9, 1.3], [0.5, 1.8, 2.2], [2.2, 0.5, 1.6], [0.5, 2.0, 0.8], [2.2, 1.3, 0.3], [1.9, 1.9, 2.2]];
  const tintOf = (st) => { const b = st < 4 ? rr(0.8, 1.15) : rr(0.78, 1.12), j = st < 4 ? 0.1 : 0.06; return [b * (1 + rr(-j, j)), b * (1 + rr(-j, j)), b * (1 + rr(-j, j))]; };
  const box3 = (w, h, d, x, y, z, col) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); B.geos.push(paint(g, col)); };
  const cone = (x, z, y, r0, r1, h, seg, col) => { const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1); g.translate(x, y + h / 2, z); B.geos.push(paint(g, col)); };
  const beacon = (x, y, z) => B.night.box(x - 0.6, x + 0.6, y, y + 1.1, z - 0.6, z + 0.6, [2.6, 0.12, 0.08]);
  const band = (x0, x1, z0, z1, y0, y1, col) => B.night.walls(x0 - 0.6, x1 + 0.6, z0 - 0.6, z1 + 0.6, y0, y1, 8, col);

  // one building tier: windowed walls, optional ground-floor shops, capped flat roof
  function tier(st, x0, x1, z0, z1, y0, y1, tint, shop, cap, roofCol) {
    const yw = shop ? SHOP_H : y0;
    if (y1 > yw) B.fb[st].walls(x0, x1, z0, z1, yw, y1, TILE, tint);
    if (shop) B.shop.walls(x0, x1, z0, z1, 0, SHOP_H, 32, WHITE, true);
    if (cap) { const e = 0.45; B.flat.walls(x0 - e, x1 + e, z0 - e, z1 + e, y1 - 1.3, y1, 8, K.trim); B.flat.top(x0 - e, x1 + e, z0 - e, z1 + e, y1, 8, roofCol); }
    else B.flat.top(x0, x1, z0, z1, y1, 8, roofCol);
    addBox(x0, x1, y0, y1, z0, z1);
    if (y0 === 0) map.b.push([x0, x1, z0, z1, y1]);
  }
  function roofStuff(x0, x1, z0, z1, y, h) {
    const w = x1 - x0, d = z1 - z0; if (w < 8 || d < 8) return;
    const n = 1 + ((rnd() * 4) | 0);
    for (let i = 0; i < n; i++) { const bw = rr(1.6, 4.5), bd = rr(1.6, 4.5), bh = rr(1.0, 2.6); const ux = rr(x0 + 3, x1 - 3), uz = rr(z0 + 3, z1 - 3); box3(bw, bh, bd, ux, y + bh / 2, uz, rnd() < 0.5 ? K.metal : K.dark); addBox(ux - bw / 2, ux + bw / 2, y, y + bh, uz - bd / 2, uz + bd / 2).prop = true; }
    if (rnd() < 0.7) { const sx = rr(x0 + 3, x1 - 3), sz = rr(z0 + 3, z1 - 3); B.flat.box(sx - 1.6, sx + 1.6, y, y + 2.9, sz - 1.4, sz + 1.4, K.trim); B.flat.box(sx - 0.5, sx + 0.5, y, y + 2.1, sz + 1.4, sz + 1.46, K.door); B.night.box(sx - 0.16, sx + 0.16, y + 2.25, y + 2.42, sz + 1.46, sz + 1.58, [2.4, 1.8, 1.0]); addBox(sx - 1.6, sx + 1.6, y, y + 2.9, sz - 1.4, sz + 1.4).prop = true; }   // stair bulkhead with a door
    if (h < 95 && rnd() < 0.5) { // rooftop water tank
      const cx = rr(x0 + 4, x1 - 4), cz = rr(z0 + 4, z1 - 4);
      box3(2.6, 3, 2.6, cx, y + 1.5, cz, K.dark); cone(cx, cz, y + 3, 2.1, 2.1, 4, 8, K.wood); cone(cx, cz, y + 7, 2.3, 0.1, 1.6, 8, K.wood);
      addBox(cx - 2.1, cx + 2.1, y, y + 7, cz - 2.1, cz + 2.1).prop = true;
    }
    if (h > 120 && w > 18 && d > 18) { const mw = w * 0.45, md = d * 0.45, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2; B.flat.box(cx - mw / 2, cx + mw / 2, y, y + 5, cz - md / 2, cz + md / 2, K.metal); addBox(cx - mw / 2, cx + mw / 2, y, y + 5, cz - md / 2, cz + md / 2); if (h > 150) beacon(cx, y + 5, cz); }
    else if (h > 150) beacon((x0 + x1) / 2, y, (z0 + z1) / 2);
    if (h > 170 && rnd() < 0.45) { const ah = rr(12, 30); box3(0.5, ah, 0.5, (x0 + x1) / 2 + 3, y + ah / 2, (z0 + z1) / 2 + 3, K.metal); beacon((x0 + x1) / 2 + 3, y + ah, (z0 + z1) / 2 + 3); }
  }
  const R4 = (v) => Math.max(12, Math.round(v / 4) * 4);
  function tower(kind, st, x0, x1, z0, z1, h, tint) {
    const roofCol = pick(ROOFS); h = R4(h);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const crown = h > 150 && rnd() < 0.32 ? pick(CROWN) : null;
    if (kind === 'box' || h < 50) { tier(st, x0, x1, z0, z1, 0, h, tint, true, true, roofCol); roofStuff(x0, x1, z0, z1, h, h); if (crown) band(x0, x1, z0, z1, h - 4, h - 1.4, crown); return; }
    if (kind === 'setback' || kind === 'deco') {
      const n = h > 200 ? 4 : h > 110 ? 3 : 2;
      let a0 = x0, a1 = x1, b0 = z0, b1 = z1, y = 0;
      for (let k = 0; k < n; k++) {
        let y1 = k === n - 1 ? h : R4(h * (k === 0 ? rr(0.35, 0.55) : 0.55 + (0.42 * k) / (n - 1) + rr(-0.03, 0.03)));
        y1 = Math.max(y1, y + 8);
        if (k > 0) { const s = rr(2.5, 5.5); if (a1 - a0 - 2 * s > 12) { a0 += s; a1 -= s; } if (b1 - b0 - 2 * s > 12) { b0 += s; b1 -= s; } }
        tier(st, a0, a1, b0, b1, y, y1, tint, k === 0, true, roofCol); y = y1;
        if (crown && k >= n - 2) band(a0, a1, b0, b1, y - 3.2, y - 1.4, crown);
      }
      if (kind === 'deco') {
        const s = Math.min(a1 - a0, b1 - b0) * 0.32;
        B.flat.box(cx - s, cx + s, y, y + 10, cz - s, cz + s, K.stone); addBox(cx - s, cx + s, y, y + 10, cz - s, cz + s);
        B.flat.pyr(cx - s, cx + s, cz - s, cz + s, y + 10, s * 2.2, K.metal); cone(cx, cz, y + 10 + s * 2, 0.7, 0.1, h * 0.09, 4, K.metal);
        band(cx - s, cx + s, cz - s, cz + s, y + 1, y + 9, crown || CROWN[0]); beacon(cx, y + 10 + s * 2 + h * 0.09, cz);
      } else roofStuff(a0, a1, b0, b1, y, h);
      return;
    }
    if (kind === 'pencil') { // podium + super-slender shaft
      const ph = R4(rr(18, 34)), s = rr(10, 12.5);
      tier(st, x0, x1, z0, z1, 0, ph, tint, true, true, roofCol);
      const y2 = R4(h * rr(0.8, 0.9));
      tier(st, cx - s, cx + s, cz - s, cz + s, ph, y2, tint, false, true, roofCol);
      tier(st, cx - s + 2, cx + s - 2, cz - s + 2, cz + s - 2, y2, h, tint, false, true, roofCol);
      band(cx - s + 2, cx + s - 2, cz - s + 2, cz + s - 2, h - 5, h - 1.4, crown || CROWN[5]); beacon(cx, h, cz);
      return;
    }
    // taper: podium, stepped glass shaft, pyramid crown and spire
    const ph = R4(rr(16, 28)); tier(st, x0, x1, z0, z1, 0, ph, tint, true, true, roofCol);
    const s = Math.min(x1 - x0, z1 - z0) * 0.5 - 2, n = 6, s1 = s * 0.6; let y = ph;
    for (let k = 0; k < n; k++) { const y1 = Math.max(k === n - 1 ? h : R4(ph + ((h - ph) * (k + 1)) / n), y + 4); const sk = s + ((s1 - s) * k) / (n - 1); tier(st, cx - sk, cx + sk, cz - sk, cz + sk, y, y1, tint, false, true, roofCol); y = y1; }
    B.flat.pyr(cx - s1, cx + s1, cz - s1, cz + s1, y, s1 * 1.3, K.steel); cone(cx, cz, y + s1, 0.9, 0.1, h * 0.13, 4, K.metal);
    band(cx - s1, cx + s1, cz - s1, cz + s1, y - 4, y - 1.4, crown || CROWN[1]); beacon(cx, y + s1 + h * 0.13, cz);
  }

  // ---------------------------------------------------------------- landmarks (period archetypes, not replicas)
  function landmark(i, j, ax0, ax1, az0, az1) {
    const cx = (ax0 + ax1) / 2, cz = (az0 + az1) / 2, rc = ROOFS[0], GOLD = [2.4, 1.8, 0.9];
    if (i === 4 && j === 13) { // art-deco setback giant with a mast
      const t = [0.98, 0.95, 0.88];
      const T = [[45, 0, 0, 28], [31, 4, 28, 96], [24, 7, 96, 264], [19, 11, 264, 304], [13, 15, 304, 336]];
      T.forEach(([hx, iz, y0, y1], k) => { tier(6, cx - hx, cx + hx, az0 + iz, az1 - iz, y0, y1, t, k === 0, true, rc); if (k > 1) band(cx - hx, cx + hx, az0 + iz, az1 - iz, y1 - 9, y1 - 1.4, GOLD); });
      tier(6, cx - 8, cx + 8, cz - 8, cz + 8, 336, 372, t, false, true, rc); band(cx - 8, cx + 8, cz - 8, cz + 8, 340, 370, GOLD);
      cone(cx, cz, 372, 4.2, 2.2, 42, 8, K.metal); cone(cx, cz, 414, 1.5, 0.15, 30, 5, K.metal); addBox(cx - 3, cx + 3, 372, 414, cz - 3, cz + 3);
      B.night.box(cx - 2.6, cx + 2.6, 374, 412, cz - 2.6, cz + 2.6, GOLD); beacon(cx, 444, cz);
      fill(ax0, cx - 47, az0, az1, 'midtown', i, j, 60, 110); fill(cx + 47, ax1, az0, az1, 'midtown', i, j, 60, 110); return true;
    }
    if (i === 6 && j === 15) { // stepped stainless crown and needle
      const t = [0.86, 0.86, 0.9];
      tier(7, cx - 34, cx + 34, az0, az1, 0, 40, t, true, true, rc); tier(7, cx - 18, cx + 18, cz - 18, cz + 18, 40, 216, t, false, true, rc);
      tier(7, cx - 15, cx + 15, cz - 15, cz + 15, 216, 244, t, false, true, rc);
      let s = 12.5, y = 244;
      for (let k = 0; k < 7; k++) { B.flat.box(cx - s, cx + s, y, y + 6.5, cz - s, cz + s, K.metal); addBox(cx - s, cx + s, y, y + 6.5, cz - s, cz + s); band(cx - s, cx + s, cz - s, cz + s, y + 5.4, y + 6.4, [2.2, 2.2, 2.4]); y += 6.5; s -= 1.6; }
      cone(cx, cz, y, 1.2, 0.1, 30, 4, K.metal); beacon(cx, y + 30, cz);
      fill(ax0, cx - 36, az0, az1, 'midtown', i, j, 70, 150); fill(cx + 36, ax1, az0, az1, 'midtown', i, j, 70, 150); return true;
    }
    if (i === 4 && j === 4) { // tapering glass giant downtown
      const t = [0.95, 1.02, 1.1];
      tier(0, cx - 40, cx + 40, az0, az1, 0, 24, t, true, true, rc);
      let y = 24; const n = 8;
      for (let k = 0; k < n; k++) { const s = 24 - (9 * k) / (n - 1), y1 = k === n - 1 ? 420 : R4(24 + (396 * (k + 1)) / n); tier(0, cx - s, cx + s, cz - s, cz + s, y, y1, t, false, true, rc); y = y1; }
      B.flat.box(cx - 12, cx + 12, 420, 428, cz - 12, cz + 12, K.steel); addBox(cx - 12, cx + 12, 420, 428, cz - 12, cz + 12); band(cx - 12, cx + 12, cz - 12, cz + 12, 421, 427, [1.4, 2.0, 2.6]);
      cone(cx, cz, 428, 2.4, 0.2, 113, 6, K.metal); addBox(cx - 1.5, cx + 1.5, 428, 470, cz - 1.5, cz + 1.5); beacon(cx, 541, cz); B.night.box(cx - 1.2, cx + 1.2, 430, 500, cz - 1.2, cz + 1.2, [1.6, 1.9, 2.4]);
      fill(ax0, cx - 42, az0, az1, 'fidi', i, j, 80, 170); fill(cx + 42, ax1, az0, az1, 'fidi', i, j, 80, 170); return true;
    }
    if (i === 5 && j === 13) { tower('taper', 0, cx - 25, cx + 25, az0, az1, 396, [1.05, 1.05, 1.0]); fill(ax0, cx - 27, az0, az1, 'midtown', i, j, 90, 190); fill(cx + 27, ax1, az0, az1, 'midtown', i, j, 90, 190); return true; }
    if (i === 6 && j === 13) { tier(7, cx - 46, cx + 46, az0 + 6, az1 - 6, 0, 246, [0.9, 0.9, 0.88], true, true, rc); roofStuff(cx - 46, cx + 46, az0 + 6, az1 - 6, 246, 246); fill(ax0, cx - 48, az0, az1, 'midtown', i, j, 60, 120); fill(cx + 48, ax1, az0, az1, 'midtown', i, j, 60, 120); return true; }
    return false;
  }

  // heights and styles by district: a dense mid-rise fabric with clusters of giants
  function heightFor(zn, i, j) {
    if (zn === 'fidi') { const w = gauss((i - 4) / 2.6) * gauss((j - 3.6) / 2.6); if (w > 0.3 && rnd() < 0.15) return rr(270, 390); return 60 + 200 * w * rr(0.5, 1.2) + rr(0, 52); }
    if (zn === 'midtown') {
      if (i >= 7 && j >= 13 && j <= 15) return rnd() < 0.5 ? rr(240, 380) : rr(90, 200); // glass cluster on the far west side
      const w = gauss((i - 4.2) / 3.0) * gauss((j - 15.2) / 3.0); if (w > 0.28 && rnd() < 0.2) return rr(280, 430); return 62 + 210 * w * rr(0.5, 1.2) + rr(0, 58);
    }
    if (zn === 'village') return rnd() < 0.15 ? rr(56, 124) : rr(18, 46);
    if (zn === 'uws' || zn === 'ues') return i === 2 || i === 6 ? rr(70, 144) : rr(34, 98);
    return rnd() < 0.15 ? rr(60, 112) : rr(22, 58);
  }
  function styleFor(h, zn) {
    if (h > 150) return pick([0, 0, 1, 2, 2, 3, 6]);
    if (h > 60) return pick([0, 2, 3, 6, 6, 7, 7, 4, 5, 1]);
    if (zn === 'village' || zn === 'uptown') return pick([4, 4, 5, 5, 6, 7]);
    return pick([4, 5, 6, 6, 7, 7]);
  }
  function fill(xa, xb, za, zb, zn, i, j, hMin = 0, hMax = 0, pencil = false) {
    const low = zn === 'village' || zn === 'uptown', big = zn === 'midtown' || zn === 'fidi';
    const wmin = low ? 11 : big ? 22 : 16, wmax = low ? 20 : big ? 46 : 30;
    let x = xa; const out = []; let pen = pencil ? 1 + ((rnd() * 2) | 0) : 0;
    while (x < xb - 9) {
      let w = rr(wmin, wmax); if (xb - (x + w) < wmin * 0.8) w = xb - x;
      const x1 = Math.min(xb, x + w);
      const rows = (low || rnd() < 0.42) && zb - za > 40 ? [[za, (za + zb) / 2 - 1.2], [(za + zb) / 2 + 1.2, zb]] : [[za, zb]];
      for (const [z0, z1] of rows) {
        let h = hMax ? rr(hMin, hMax) : heightFor(zn, i, j), kind;
        if (pen > 0 && rows.length === 1 && x1 - x > 22) { pen--; h = rr(380, 472); kind = 'pencil'; }
        else if (h > 262) kind = pick(['taper', 'setback', 'deco', 'pencil', 'setback']);
        else if (h > 110) kind = pick(['box', 'setback', 'setback', 'deco']);
        else kind = h > 50 && rnd() < 0.4 ? 'setback' : 'box';
        const st = kind === 'pencil' ? pick([0, 1, 2, 3]) : kind === 'deco' ? pick([6, 6, 4, 7]) : kind === 'taper' ? pick([0, 1, 2]) : styleFor(h, zn);
        tower(kind, st, x, x1, z0, z1, h, tintOf(st));
        out.push({ x0: x, x1, z0, z1, h: R4(h) });
      }
      x = x1 + 0.6;
    }
    return out;
  }
  // street furniture: the small things that make a sidewalk read as a real one
  function props(x0, x1, z0, z1) {
    const F = B.flat, cols = [K.green, C3(0x6b1f24), K.blue, K.dark];
    for (let k = 0; k < 3; k++) { const x = rr(x0 + 6, x1 - 6), z = rnd() < 0.5 ? z0 + 0.7 : z1 - 0.7; F.box(x - 0.15, x + 0.15, SH, SH + 0.62, z - 0.15, z + 0.15, K.red); F.box(x - 0.24, x + 0.24, SH + 0.36, SH + 0.5, z - 0.08, z + 0.08, K.red); }      // fire hydrants
    for (let k = 0; k < 4; k++) { const x = rr(x0 + 3, x1 - 3), z = rnd() < 0.5 ? z0 + 0.8 : z1 - 0.8; F.box(x - 0.28, x + 0.28, SH, SH + 0.95, z - 0.28, z + 0.28, K.green); }                                                                               // litter bins
    { const x = rr(x0 + 8, x1 - 8), z = rnd() < 0.5 ? z0 + 0.9 : z1 - 0.9; F.box(x - 0.32, x + 0.32, SH, SH + 1.15, z - 0.28, z + 0.28, K.blue); }                                                                                                          // mailbox
    for (const zs of [z0, z1]) if (rnd() < 0.55) { // entrance canopy reaching to the curb
      const x = rr(x0 + 12, x1 - 12), c = pick(cols), za = zs === z0 ? z0 + 0.5 : z1 - WALK + 0.2, zb = zs === z0 ? z0 + WALK - 0.2 : z1 - 0.5;
      F.box(x - 1.3, x + 1.3, SH + 2.8, SH + 3.15, za, zb, c, true); const zp = zs === z0 ? za + 0.2 : zb - 0.2; F.box(x - 1.25, x - 1.15, SH, SH + 2.8, zp - 0.05, zp + 0.05, K.metal); F.box(x + 1.15, x + 1.25, SH, SH + 2.8, zp - 0.05, zp + 0.05, K.metal);
    }
    if (rnd() < 0.26) { // sidewalk shed (scaffolding) along part of one frontage
      const s = rnd() < 0.5, len = rr(18, 46), xa = rr(x0 + 8, x1 - 8 - len), za = s ? z0 + 0.4 : z1 - WALK + 0.3, zb = s ? z0 + WALK - 0.3 : z1 - 0.4;
      F.box(xa, xa + len, SH + 3.0, SH + 3.35, za, zb, K.scaf, true); F.box(xa, xa + len, SH + 3.35, SH + 4.4, (s ? za : zb) - 0.06, (s ? za : zb) + 0.06, K.scaf);
      for (let x = xa + 0.2; x < xa + len; x += 3.6) F.box(x - 0.07, x + 0.07, SH, SH + 3.0, (s ? za : zb) - 0.07, (s ? za : zb) + 0.07, K.metal);
    }
    if (rnd() < 0.3) { const z = rr(z0 + 12, z1 - 12), s = rnd() < 0.5, x = s ? x0 + 1.2 : x1 - 1.2; F.box(x - 0.75, x + 0.75, SH + 2.45, SH + 2.6, z - 2.1, z + 2.1, K.dark, true); F.box(x + (s ? 0.62 : -0.7), x + (s ? 0.7 : -0.62), SH + 0.3, SH + 2.45, z - 2.0, z + 2.0, K.glass); F.box(x - 0.05, x + 0.05, SH, SH + 2.45, z - 2.05, z - 1.95, K.metal); F.box(x - 0.05, x + 0.05, SH, SH + 2.45, z + 1.95, z + 2.05, K.metal); }   // bus shelter
    if (rnd() < 0.22) { const x = rr(x0 + 10, x1 - 10), z = rnd() < 0.5 ? z0 + 1.3 : z1 - 1.3; F.box(x - 1.3, x + 1.3, SH, SH + 2.5, z - 0.8, z + 0.8, K.green); F.box(x - 1.5, x + 1.5, SH + 2.5, SH + 2.65, z - 1.1, z + 1.1, K.dark, true); }                     // newsstand
    if (rnd() < 0.42) { const sx = rnd() < 0.5, x = sx ? x0 + rr(4, 9) : x1 - rr(4, 9), z = rnd() < 0.5 ? z0 + 1.4 : z1 - 1.4; F.box(x - 0.8, x + 0.8, SH + 0.25, SH + 1.1, z - 0.5, z + 0.5, K.metal, true); F.box(x - 0.03, x + 0.03, SH + 1.1, SH + 2.2, z - 0.03, z + 0.03, K.dark); cone(x, z, SH + 2.1, 1.35, 0.05, 0.55, 8, pick([C3(0xc8372f), C3(0xe0a422), C3(0x2f6fb0), C3(0x2f8a57)])); }   // vendor cart under an umbrella
    if (rnd() < 0.35) vents.push([rnd() < 0.5 ? x0 - rr(3, 10) : x1 + rr(3, 10), rr(z0 + 6, z1 - 6)]);                                                                                                                                                       // steam vent in the avenue
  }

  // ---------------------------------------------------------------- lay out every block
  for (let j = 0; j < NS; j++) for (let i = 0; i < NA; i++) {
    if (!cellOK(i, j)) continue;
    cellB(i, j);
    const bx = -HALFX + i * BX, bz = -HALFZ + j * BZ;
    B.ground.quad([bx, 0, bz], [bx, 0, bz + BZ], [bx + BX, 0, bz + BZ], [bx + BX, 0, bz], [0, 1, 0], [0, 0], [0, 1], [1, 1], [1, 0]);
    box3(BX + 2 * EDGE, 8, BZ + 2 * EDGE, bx + BX / 2, -4.03, bz + BZ / 2, K.quay);
    map.slabs.push([bx - EDGE, bx + BX + EDGE, bz - EDGE, bz + BZ + EDGE, 0]);
    const zn = zoneOf(i, j);
    if (zn === 'park') continue;
    const x0 = bx + AVE / 2, x1 = bx + BX - AVE / 2, z0 = bz + ST / 2, z1 = bz + BZ - ST / 2;
    B.walk.walls(x0, x1, z0, z1, 0, SH, 4, WHITE); addBox(x0, x1, -1, SH, z0, z1, true);
    map.slabs.push([x0, x1, z0, z1, zn === 'battery' ? 2 : 1]);
    if (zn === 'battery') {
      B.flat.top(x0, x1, z0, z1, SH, 8, K.grass); B.flat.top(x0 + 30, x1 - 30, (z0 + z1) / 2 - 2, (z0 + z1) / 2 + 2, SH + 0.04, 8, K.path);
      for (let t = 0; t < 30; t++) { const tx = rr(x0 + 3, x1 - 3), tz = rr(z0 + 3, z1 - 3); if (Math.abs(tz - (z0 + z1) / 2) > 4) B.trees.push([tx, SH, tz, rr(0.9, 1.5), 0]); }
      continue;
    }
    B.walk.top(x0, x1, z0, z1, SH, 4, WHITE);
    for (const t of [0.125, 0.375, 0.625, 0.875]) { B.lamps.push([x0 + (x1 - x0) * t, z0 + 0.9, 0], [x0 + (x1 - x0) * t, z1 - 0.9, Math.PI]); }
    for (const t of [0.27, 0.73]) B.lamps.push([x0 + 0.9, z0 + (z1 - z0) * t, Math.PI / 2], [x1 - 0.9, z0 + (z1 - z0) * t, -Math.PI / 2]);
    if (rnd() < 0.6) for (let s = x0 + 8; s < x1 - 12; s += 20) { B.trees.push([s, SH, z0 + 1.9, rr(0.75, 1.05), 0]); B.trees.push([s + 9, SH, z1 - 1.9, rr(0.75, 1.05), 0]); }
    props(x0, x1, z0, z1);
    const ax0 = x0 + WALK, ax1 = x1 - WALK, az0 = z0 + WALK, az1 = z1 - WALK;
    if (landmark(i, j, ax0, ax1, az0, az1)) continue;
    { // light spilling out of the shopfronts across the sidewalk
      const y = SH + 0.12, c = () => { const q = pick(SPILL), k = rr(0.7, 1); return [q[0] * k, q[1] * k, q[2] * k]; }, F = [0.5, 0.5], E = [0.97, 0.5];
      let q = c(); B.spill.quad([ax0, y, az0], [ax1, y, az0], [ax1, y, z0], [ax0, y, z0], [0, 1, 0], F, F, E, E, q);
      q = c(); B.spill.quad([ax0, y, az1], [ax1, y, az1], [ax1, y, z1], [ax0, y, z1], [0, 1, 0], F, F, E, E, q);
      q = c(); B.spill.quad([ax0, y, az0], [ax0, y, az1], [x0, y, az1], [x0, y, az0], [0, 1, 0], F, F, E, E, q);
      q = c(); B.spill.quad([ax1, y, az0], [ax1, y, az1], [x1, y, az1], [x1, y, az0], [0, 1, 0], F, F, E, E, q);
    }
    const tsq = (i === 4 || i === 5) && j >= 14 && j <= 15;
    const lots = tsq ? fill(ax0, ax1, az0, az1, zn, i, j, 56, 120) : fill(ax0, ax1, az0, az1, zn, i, j, 0, 0, zn === 'midtown' && j === 18 && i >= 2 && i <= 6);
    { // blade signs hung off the shopfronts
      const np = zn === 'midtown' || zn === 'fidi' ? 0.62 : zn === 'village' ? 0.48 : 0.3;
      const sign = (x, z, nx, nz, lh) => {
        const h = Math.min(rr(2.2, 5.2), lh - 7.5); if (h < 1.4) return;
        const c = pick(NEON), y = rr(5.6, 7), t = 0.13, o = 1.25;
        if (nx) B.neon.box(Math.min(x, x + nx * o), Math.max(x, x + nx * o), y, y + h, z - t, z + t, c, true);
        else B.neon.box(x - t, x + t, y, y + h, Math.min(z, z + nz * o), Math.max(z, z + nz * o), c, true);
      };
      for (const l of lots) {
        if (l.x1 - l.x0 > 5 && Math.abs(l.z0 - az0) < 0.1 && rnd() < np) sign(rr(l.x0 + 2, l.x1 - 2), l.z0, 0, -1, l.h);
        if (l.x1 - l.x0 > 5 && Math.abs(l.z1 - az1) < 0.1 && rnd() < np) sign(rr(l.x0 + 2, l.x1 - 2), l.z1, 0, 1, l.h);
        if (Math.abs(l.x0 - ax0) < 0.1 && rnd() < np) sign(l.x0, rr(l.z0 + 2, l.z1 - 2), -1, 0, l.h);
        if (Math.abs(l.x1 - ax1) < 0.1 && rnd() < np) sign(l.x1, rr(l.z0 + 2, l.z1 - 2), 1, 0, l.h);
      }
    }
    if (tsq) { // bright-lights crossroads: big screens facing the avenue between the two columns
      const L = i === 4 ? lots.filter((l) => l.x1 > ax1 - 1) : lots.filter((l) => l.x0 < ax0 + 1);
      for (const l of L) {
        const bw = Math.min(40, l.z1 - l.z0 - 4), zc = (l.z0 + l.z1) / 2, xf = i === 4 ? l.x1 : l.x0, f = i === 4 ? 0 : 1;
        bbSpots.push({ x: xf, y: 8 + bw * 0.25, z: zc, w: bw, h: bw * 0.5, face: f });
        if (l.h > 56) bbSpots.push({ x: xf, y: 10 + bw * 0.5 + bw * 0.22, z: zc, w: bw * 0.85, h: bw * 0.42, face: f });
      }
      for (const l of lots) if (l.x1 - l.x0 > 20 && rnd() < 0.8) { const s = rnd() < 0.5; bbSpots.push({ x: (l.x0 + l.x1) / 2, y: 16, z: s ? l.z1 : l.z0, w: Math.min(26, l.x1 - l.x0 - 3), h: 11, face: s ? 2 : 3 }); }
    } else if ((zn === 'midtown' || zn === 'fidi') && rnd() < 0.4) {
      const l = pick(lots); if (l && l.h > 60 && l.z1 - l.z0 > 20) { const s = rnd() < 0.5, bw = Math.min(22, l.x1 - l.x0 - 3); if (bw > 11) bbSpots.push({ x: (l.x0 + l.x1) / 2, y: clampN(l.h * 0.5, 20, 60), z: s ? l.z1 : l.z0, w: bw, h: bw * 0.5, face: s ? 2 : 3 }); }
    }
  }

  // ---------------------------------------------------------------- the park
  const parkRect = {};
  {
    useB('park');
    const x0 = -HALFX + PARK.i0 * BX + AVE / 2, x1 = -HALFX + (PARK.i1 + 1) * BX - AVE / 2, z0 = -HALFZ + PARK.j0 * BZ + ST / 2, z1 = -HALFZ + (PARK.j1 + 1) * BZ - ST / 2;
    Object.assign(parkRect, { x0, x1, z0, z1 });
    B.flat.top(x0, x1, z0, z1, SH, 8, K.grass); B.flat.walls(x0, x1, z0, z1, 0, SH + 0.55, 8, K.stone); addBox(x0, x1, -1, SH, z0, z1, true);
    map.slabs.push([x0, x1, z0, z1, 2]);
    const cx = (x0 + x1) / 2, feat = [];
    const oval = (ox, oz, rx, rz, col, y, mc) => { B.flat.disc(ox, oz, rx, rz, SH + y, 16, col); feat.push([ox, oz, rx + 4, rz + 4]); map.feats.push([ox, oz, rx, rz, mc]); };
    oval(cx + 20, z0 + (z1 - z0) * 0.68, 150, 78, K.water, 0.04, 0);       // reservoir
    oval(cx - 90, z0 + (z1 - z0) * 0.3, 62, 34, K.water, 0.04, 0);         // the lake
    oval(cx + 60, z0 + (z1 - z0) * 0.45, 86, 44, K.lawn, 0.03, 1);         // great lawn
    oval(cx + 40, z0 + (z1 - z0) * 0.1, 70, 30, K.lawn, 0.03, 1);          // meadow
    const paths = [];
    const P = (a, b, c, d) => { B.flat.top(a, b, c, d, SH + 0.06, 8, K.path); map.lines.push([a, b, c, d, 0]); paths.push([a, b, c, d]); };
    P(x0 + 22, x1 - 22, z0 + 20, z0 + 24); P(x0 + 22, x1 - 22, z1 - 24, z1 - 20); P(x0 + 22, x0 + 26, z0 + 20, z1 - 20); P(x1 - 26, x1 - 22, z0 + 20, z1 - 20);
    const hz = [0.2, 0.56, 0.87].map((f) => z0 + (z1 - z0) * f);
    for (const zc of hz) P(x0 + 22, x1 - 22, zc - 1.6, zc + 1.6);
    // a fountain plaza on the middle path
    const fx = cx - 150, fz = hz[1];
    B.flat.disc(fx, fz, 13, 13, SH + 0.07, 18, K.path); feat.push([fx, fz, 15, 15]);
    cone(fx, fz, SH, 5.6, 5.6, 0.7, 14, K.stone); B.flat.disc(fx, fz, 5.1, 5.1, SH + 0.72, 14, K.water); cone(fx, fz, SH, 0.7, 0.5, 2.3, 8, K.stone); cone(fx, fz, SH + 2.2, 0.4, 1.7, 0.5, 10, K.stone); cone(fx, fz, SH + 2.6, 0.22, 0.03, 1.7, 6, C3(0xdfeef5));
    addBox(fx - 5, fx + 5, 0, SH + 0.7, fz - 5, fz + 5).prop = true;
    // lamps and benches along every path; trees everywhere else, split into quarters so they cull with the view
    const pq = [0, 1, 2, 3].map((q) => buckets['park' + q] || useB('park' + q)); useB('park');
    const quarter = (z) => pq[clampN(Math.floor(((z - z0) / (z1 - z0)) * 4), 0, 3)];
    const bench = (x, z, alongX) => { const a = alongX ? 0.9 : 0.25, b2 = alongX ? 0.25 : 0.9; B.flat.box(x - a, x + a, SH + 0.38, SH + 0.46, z - b2, z + b2, K.wood, true); B.flat.box(x - (alongX ? 0.9 : 0.04), x + (alongX ? 0.9 : 0.04), SH + 0.46, SH + 0.95, z - (alongX ? 0.04 : 0.9), z + (alongX ? 0.04 : 0.9), K.green); };
    for (const zc of [z0 + 22, ...hz, z1 - 22]) for (let x = x0 + 34, k = 0; x < x1 - 30; x += 15, k++) {
      if (Math.abs(x - fx) < 15 && zc === fz) continue;
      if (k % 2 === 0) quarter(zc).lamps.push(k % 4 ? [x, zc + 2.5, 0] : [x, zc - 2.5, Math.PI]); else bench(x, zc + (k % 4 === 1 ? 2.6 : -2.6), true);
    }
    for (const xc of [x0 + 24, x1 - 24]) for (let z = z0 + 36, k = 0; z < z1 - 32; z += 15, k++) {
      if (k % 2 === 0) quarter(z).lamps.push(k % 4 ? [xc + 2.5, z, Math.PI / 2] : [xc - 2.5, z, -Math.PI / 2]); else bench(xc + (k % 4 === 1 ? 2.6 : -2.6), z, false);
    }
    for (let t = 0, n = 0; n < 2900 && t < 20000; t++) {
      const tx = rr(x0 + 3, x1 - 3), tz = rr(z0 + 3, z1 - 3);
      if (feat.some(([ox, oz, rx, rz]) => ((tx - ox) / rx) ** 2 + ((tz - oz) / rz) ** 2 < 1)) continue;
      if (paths.some(([a, b, c, d]) => tx > a - 1.6 && tx < b + 1.6 && tz > c - 1.6 && tz < d + 1.6)) continue;
      quarter(tz).trees.push([tx, SH, tz, rr(0.9, 1.85), rnd() < 0.12 ? 1 : 0]); n++;
    }
    Object.assign(parkRect, { hz, water: [[cx + 20, z0 + (z1 - z0) * 0.68, 154, 82], [cx - 90, z0 + (z1 - z0) * 0.3, 66, 38], [fx, fz, 7, 7]], fountain: [fx, fz] });
  }

  // ---------------------------------------------------------------- outer boroughs, piers, bridges
  function farLand(key, xa, xb, shore) {
    useB(key);
    const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), z0 = -HALFZ - 160, z1 = HALFZ + 160;
    box3(x1 - x0, 6, z1 - z0, (x0 + x1) / 2, -3.02, (z0 + z1) / 2, K.land); LANDS.push([x0, x1, z0, z1]); map.lands.push([x0, x1, z0, z1]);
    const hubZ = key === 'east' ? -HALFZ * 0.55 : -HALFZ * 0.2;
    for (let gx = x0 + 10; gx < x1 - 60; gx += 66) for (let gz = z0 + 10; gz < z1 - 60; gz += 66) {
      if (rnd() < 0.16) continue;
      const w = rr(28, 52), d = rr(28, 52), ox = gx + rr(0, 60 - w), oz = gz + rr(0, 60 - d);
      const dd = Math.hypot((ox - shore) / 1.4, oz - hubZ);
      let h = rr(10, 38); if (dd < 320) h = Math.max(h, rr(50, 240) * (1 - dd / 400));
      h = R4(h); const st = h > 90 ? pick([0, 1, 2, 3]) : pick([4, 5, 6, 7]);
      tier(st, ox, ox + w, oz, oz + d, 0, h, tintOf(st), false, true, pick(ROOFS)); if (h > 150) beacon(ox + w / 2, h, oz + d / 2);
    }
  }
  farLand('east', E1, E0, E0); farLand('west', W0, W1, W0);
  useB('misc');
  for (let k = 0; k < 9; k++) { // west-side piers
    const pz = -HALFZ + BZ * (7.5 + k * 2.6), px0 = HALFX + EDGE - 1, px1 = HALFX + EDGE + 150;
    box3(px1 - px0, 3.5, 22, (px0 + px1) / 2, -1.5, pz, K.pier); addBox(px0, px1, -3, SH, pz - 11, pz + 11, true); map.lands.push([px0, px1, pz - 11, pz + 11]);
    if (k % 3 === 1) { B.flat.box(px0 + 30, px1 - 12, SH, 9, pz - 8, pz + 8, K.metal); addBox(px0 + 30, px1 - 12, SH, 9, pz - 8, pz + 8); }
  }
  const segM = new THREE.Matrix4(), segQ = new THREE.Quaternion(), ZAX = new THREE.Vector3(0, 0, 1), ONE = new THREE.Vector3(1, 1, 1);
  function strut(a, b, t, col) {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length(); const g = new THREE.BoxGeometry(t, t, len);
    segQ.setFromUnitVectors(ZAX, d.normalize()); segM.compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), segQ, ONE);
    g.applyMatrix4(segM); B.geos.push(paint(g, col));
  }
  function bridge(zc, col, cableCol) {
    const xA = E0 - 8, xB = -(HALFX + EDGE - 2), dy = 17, hw = 11, TH = 84;   // from the east borough to the island
    box3(xB - xA, 2.6, hw * 2, (xA + xB) / 2, dy - 1.3, zc, K.dark); addBox(xA, xB, dy - 2.6, dy, zc - hw, zc + hw); map.lines.push([xA, xB, zc - hw, zc + hw, 1]);
    for (const s of [-1, 1]) box3(xB - xA, 1.3, 0.5, (xA + xB) / 2, dy + 0.65, zc + s * (hw - 0.3), col);
    const tx = [xA + (xB - xA) * 0.27, xA + (xB - xA) * 0.73];
    for (const x of tx) {
      for (const s of [-1, 1]) { box3(8, TH + 8, 6, x, (TH - 8) / 2, zc + s * (hw + 1), col); addBox(x - 4, x + 4, -8, TH, zc + s * (hw + 1) - 3, zc + s * (hw + 1) + 3); }
      box3(8, 9, hw * 2 + 8, x, TH - 4.5, zc, col); box3(8, 6, hw * 2 + 8, x, dy + 30, zc, col); addBox(x - 4, x + 4, TH - 9, TH, zc - hw - 4, zc + hw + 4);
      beacon(x, TH, zc - hw); beacon(x, TH, zc + hw);
    }
    for (const x of [xA + 10, xB - 10]) { box3(22, dy + 6, hw * 2 + 6, x, (dy - 6) / 2, zc, col); addBox(x - 11, x + 11, -6, dy, zc - hw - 3, zc + hw + 3); }
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    for (const s of [-1, 1]) {
      const z = zc + s * (hw - 0.6), top = TH - 1;
      const cab = (xa, ya, xb2, yb, sag, n) => { let prev = V(xa, ya, z); for (let k = 1; k <= n; k++) { const t = k / n, x = xa + (xb2 - xa) * t, y = ya + (yb - ya) * t - sag * 4 * t * (1 - t); const p = V(x, y, z); strut(prev, p, 0.7, cableCol); if (k < n && k % 2 === 0) strut(V(x, dy, z), p, 0.22, cableCol); if (k < n) B.night.box(x - 0.3, x + 0.3, y, y + 0.6, z - 0.3, z + 0.3, [2.2, 2.0, 1.5]); prev = p; } };
      cab(xA + 10, dy + 3, tx[0], top, 8, 6); cab(tx[0], top, tx[1], top, top - dy - 7, 16); cab(tx[1], top, xB - 10, dy + 3, 8, 6);
    }
  }
  bridge(-HALFZ + 4 * BZ, K.stone, K.metal); bridge(-HALFZ + 8 * BZ, K.steel, K.steel);

  // traffic signals at every crossing: lamps facing the avenue and the cross street switch with the cycle
  for (let a = 0; a <= NA; a++) for (let r = 0; r <= NS; r++) {
    if (!cellOK(a, r) || (inPark(a, r) && inPark(a - 1, r - 1))) continue;
    cellB(a, r);
    const x = -HALFX + a * BX + AVE / 2 + 0.7, z = -HALFZ + r * BZ + ST / 2 + 0.7, hx = x - 6.2;
    box3(0.28, 7, 0.28, x, 3.5 + SH, z, K.dark); box3(6.5, 0.2, 0.2, x - 3.2, 6.9, z, K.dark); box3(0.55, 1.5, 0.55, hx, 6.2, z, K.signal);
    const L = (gb, y, dx0, dx1, dz0, dz1, c) => gb.box(hx + dx0, hx + dx1, y, y + 0.32, z + dz0, z + dz1, c);
    const G = [0.2, 1.8, 0.45], Rd = [2.0, 0.15, 0.1];
    for (const s of [-1, 1]) { // +/-z faces are read by avenue traffic, +/-x faces by the cross street
      L(sigB.ag, 5.62, -0.17, 0.17, s * 0.28 - 0.02, s * 0.28 + 0.02, G); L(sigB.ar, 6.42, -0.17, 0.17, s * 0.28 - 0.02, s * 0.28 + 0.02, Rd);
      L(sigB.sg, 5.62, s * 0.28 - 0.02, s * 0.28 + 0.02, -0.17, 0.17, G); L(sigB.sr, 6.42, s * 0.28 - 0.02, s * 0.28 + 0.02, -0.17, 0.17, Rd);
    }
  }

  // ---------------------------------------------------------------- build chunk meshes
  const treeMeshes = [], nightMeshes = [], lightMeshes = [];
  const [gcv, gg] = mk(128, 128), ggr = gg.createRadialGradient(64, 64, 0, 64, 64, 64);
  ggr.addColorStop(0, '#ffffff'); ggr.addColorStop(0.25, '#9a9a9a'); ggr.addColorStop(0.6, '#2c2c2c'); ggr.addColorStop(1, '#000000'); gg.fillStyle = ggr; gg.fillRect(0, 0, 128, 128);
  const glowTex = new THREE.CanvasTexture(gcv); glowTex.colorSpace = THREE.SRGBColorSpace;
  const addOpt = { map: glowTex, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false };
  const poolMat = new THREE.MeshBasicMaterial({ ...addOpt, color: 0xffb060, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const spillMat = new THREE.MeshBasicMaterial({ ...addOpt, vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4 });
  const haloMat = new THREE.PointsMaterial({ ...addOpt, color: 0xffc890, size: 3.6, sizeAttenuation: true });
  haloMat.onBeforeCompile = (sh) => { sh.vertexShader = sh.vertexShader.replace('#include <fog_vertex>', 'gl_PointSize = min(gl_PointSize, 70.0);\n#include <fog_vertex>'); };   // never let a halo fill the screen when you brush past a lamp
  const neonMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  const poolG = new THREE.PlaneGeometry(20, 20).rotateX(-Math.PI / 2).translate(0, 0.2, -2.0);
  const dm = new THREE.Object3D(), col = new THREE.Color();
  const addMesh = (geo, mat, cast = true, recv = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = recv; m.matrixAutoUpdate = false; scene.add(m); return m; };
  // low-poly trees: forked trunk + three faceted lobes, swayed by wind in the vertex shader
  const trunkG = mergeGeometries([new THREE.CylinderGeometry(0.15, 0.3, 3, 5, 1, true).translate(0, 1.5, 0), new THREE.CylinderGeometry(0.07, 0.13, 1.7, 4, 1, true).translate(0, 0.85, 0).rotateZ(0.6).translate(0.05, 2.5, 0), new THREE.CylinderGeometry(0.06, 0.12, 1.5, 4, 1, true).translate(0, 0.75, 0).rotateZ(-0.55).rotateY(1.2).translate(-0.05, 2.8, 0)]);
  const lobe = (r, sy, x, y, z) => { const g = new THREE.IcosahedronGeometry(r, 0); const pa = g.attributes.position; for (let v = 0; v < pa.count; v++) { const m = 1 + Math.sin(pa.getX(v) * 12.9 + pa.getY(v) * 78.2 + pa.getZ(v) * 37.7) * 0.16; pa.setXYZ(v, pa.getX(v) * m, pa.getY(v) * m * sy, pa.getZ(v) * m); } g.translate(x, y, z); return g; };
  const crownG = mergeGeometries([lobe(2.2, 0.9, 0, 4.7, 0), lobe(1.5, 0.9, 1.0, 5.9, 0.4), lobe(1.4, 0.85, -0.9, 5.5, -0.5)]); crownG.computeVertexNormals();
  const farCrownG = lobe(2.55, 0.95, 0, 5.1, 0); farCrownG.computeVertexNormals();
  const treeSets = [];
  const swayU = { value: 0 };
  const crownMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });
  crownMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = swayU;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
      float swf = smoothstep(2.6, 6.5, position.y); float ph = float(gl_InstanceID) * 1.73;
      transformed.x += (sin(uTime * 1.25 + ph) * 0.16 + sin(uTime * 3.1 + ph * 2.0) * 0.045) * swf;
      transformed.z += (cos(uTime * 1.07 + ph * 1.4) * 0.13 + cos(uTime * 2.7 + ph) * 0.04) * swf;`);
  };
  const trunkMat = new THREE.MeshLambertMaterial({ color: 0x4b3726, flatShading: true });
  const poleG = mergeGeometries([new THREE.CylinderGeometry(0.09, 0.14, 7.6, 4, 1, true).translate(0, 3.8, 0), new THREE.BoxGeometry(0.12, 0.12, 2.2).translate(0, 7.6, -1.0)]);
  const headG = new THREE.BoxGeometry(0.4, 0.16, 0.8).translate(0, 7.5, -2.0);
  const poleMat = new THREE.MeshLambertMaterial({ color: 0x2b2f33, flatShading: true });
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x332a1a, emissive: 0xffd9a0, emissiveIntensity: 0.3 });
  let NT = 0, NL = 0, chunkMeshes = 0;
  for (const key in buckets) {
    const b = buckets[key];
    b.fb.forEach((g, i) => { if (g.p.length) { addMesh(g.geo(), facadeMats[i]); chunkMeshes++; } });
    if (b.shop.p.length) addMesh(b.shop.geo(), shopMat, false, true);
    const fl = b.geos.slice(); if (b.flat.p.length) fl.unshift(b.flat.geo());
    if (fl.length) addMesh(mergeGeometries(fl), flatMat);
    if (b.walk.p.length) addMesh(b.walk.geo(), walkMat, false, true);
    if (b.ground.p.length) addMesh(b.ground.geo(), groundMat, false, true);
    if (b.night.p.length) { const m = addMesh(b.night.geo(), nightMat, false, false); m.visible = false; nightMeshes.push(m); }
    if (b.neon.p.length) addMesh(b.neon.geo(), neonMat, false, false);
    if (b.spill.p.length) { const m = addMesh(b.spill.geo(), spillMat, false, false); m.renderOrder = 2; m.visible = false; lightMeshes.push(m); }
    const T = b.trees;
    if (T.length) {
      for (let i = T.length - 1; i > 0; i--) { const k = (rnd() * (i + 1)) | 0; const t = T[i]; T[i] = T[k]; T[k] = t; }
      const tr = new THREE.InstancedMesh(trunkG, trunkMat, T.length), cr = new THREE.InstancedMesh(crownG, crownMat, T.length);
      T.forEach(([x, y, z, s, autumn], i) => {
        dm.position.set(x, y, z); dm.scale.set(s, s * rr(0.85, 1.25), s); dm.rotation.set(0, rnd() * 6, 0); dm.updateMatrix();
        tr.setMatrixAt(i, dm.matrix); cr.setMatrixAt(i, dm.matrix);
        if (autumn) col.setHSL(rr(0.04, 0.14), rr(0.6, 0.8), rr(0.36, 0.5)); else col.setHSL(rr(0.22, 0.36), rr(0.42, 0.62), rr(0.22, 0.36));
        cr.setColorAt(i, col);
      });
      for (const m of [tr, cr]) { m.castShadow = true; m.receiveShadow = true; m.userData.full = T.length; scene.add(m); treeMeshes.push(m); }
      // far away the same trees are drawn as one faceted blob each, with no trunk
      const fr = new THREE.InstancedMesh(farCrownG, crownMat, T.length); fr.instanceMatrix = cr.instanceMatrix; fr.instanceColor = cr.instanceColor;
      fr.userData.full = T.length; fr.userData.far = true; fr.visible = false; scene.add(fr); treeMeshes.push(fr);
      let sx = 0, sz = 0; for (const t of T) { sx += t[0]; sz += t[2]; } sx /= T.length; sz /= T.length;
      let rad = 0; for (const t of T) rad = Math.max(rad, Math.hypot(t[0] - sx, t[2] - sz));
      treeSets.push({ near: [tr, cr], far: fr, cx: sx, cz: sz, r: rad, isFar: false });
      NT += T.length;
    }
    if (b.lamps.length) {
      const po = new THREE.InstancedMesh(poleG, poleMat, b.lamps.length), he = new THREE.InstancedMesh(headG, lampMat, b.lamps.length);
      b.lamps.forEach(([x, z, ry], k) => { dm.position.set(x, SH, z); dm.rotation.set(0, ry, 0); dm.scale.set(1, 1, 1); dm.updateMatrix(); po.setMatrixAt(k, dm.matrix); he.setMatrixAt(k, dm.matrix); });
      scene.add(po, he); NL += b.lamps.length;
      // each lamp throws a warm pool on the street and carries a soft halo
      const pool = new THREE.InstancedMesh(poolG, poolMat, b.lamps.length), hp = [];
      b.lamps.forEach(([x, z, ry], k) => { dm.position.set(x, SH, z); dm.rotation.set(0, ry, 0); dm.updateMatrix(); pool.setMatrixAt(k, dm.matrix); hp.push(x - 2 * Math.sin(ry), SH + 7.4, z - 2 * Math.cos(ry)); });
      const hg = new THREE.BufferGeometry(); hg.setAttribute('position', new THREE.Float32BufferAttribute(hp, 3));
      const halo = new THREE.Points(hg, haloMat);
      for (const m of [pool, halo]) { m.renderOrder = 2; m.visible = false; m.matrixAutoUpdate = false; scene.add(m); lightMeshes.push(m); }
    }
  }
  const sig = {}; for (const k in sigB) { sig[k] = addMesh(sigB[k].geo(), glowMat, false, false); sig[k].frustumCulled = false; }

  // water with slow ripples
  const wS = 256, [wc, wg] = mk(wS, wS);
  wg.fillStyle = '#8080ff'; wg.fillRect(0, 0, wS, wS);
  for (let i = 0; i < 700; i++) {
    const gx = rnd() * wS, gy = rnd() * wS, rad = rr(4, 16), gr = wg.createRadialGradient(gx, gy, 0, gx, gy, rad);
    gr.addColorStop(0, `rgba(${(128 + (rnd() - 0.5) * 40) | 0},${(128 + (rnd() - 0.5) * 40) | 0},255,0.35)`); gr.addColorStop(1, 'rgba(128,128,255,0)');
    wg.fillStyle = gr; wg.fillRect(gx - rad, gy - rad, rad * 2, rad * 2);
  }
  const waterN = tex(wc, false); waterN.repeat.set(260, 260); waterN.anisotropy = 4;
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x2c6787, roughness: 0.25, metalness: 0.4, normalMap: waterN, normalScale: new THREE.Vector2(0.4, 0.4) });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), waterMat);
  water.rotation.x = -Math.PI / 2; water.position.y = -2.5; scene.add(water);

  // low-poly clouds
  const NCL = 230, cloudMat = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true, fog: false, emissive: 0x5a6470, emissiveIntensity: 0.5 });
  const clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), cloudMat, NCL);
  for (let k = 0; k < NCL;) {
    const cx = rr(-4200, 4200), cz = rr(-4200, 4200), cy = rr(640, 1050), n = 3 + ((rnd() * 4) | 0), sc = rr(0.7, 1.6);
    for (let q = 0; q < n && k < NCL; q++, k++) { dm.position.set(cx + rr(-110, 110) * sc, cy + rr(-14, 14), cz + rr(-60, 60) * sc); dm.scale.set(rr(70, 150) * sc, rr(26, 46) * sc, rr(55, 110) * sc); dm.rotation.set(0, rnd() * 6, 0); dm.updateMatrix(); clouds.setMatrixAt(k, dm.matrix); }
  }
  clouds.frustumCulled = false; scene.add(clouds);

  // ---------------------------------------------------------------- road network description (used by the traffic system)
  const spans = [];
  const runs = (count, ok) => { const out = []; let s = -1, key = ''; for (let k = 0; k <= count; k++) { const o = k < count ? ok(k) : ''; if (o !== key) { if (key) out.push([s, k, key]); s = k; key = o; } } return out; };
  for (let a = 0; a <= NA; a++) {
    for (const [j0, j1, key] of runs(NS, (j) => { const w = cellOK(a - 1, j), e = cellOK(a, j); if ((!w && !e) || (inPark(a - 1, j) && inPark(a, j))) return ''; return w && e ? 'b' : w ? 'w' : 'e'; }))
      spans.push({ axis: 1, line: -HALFX + a * BX, a0: -HALFZ + j0 * BZ, a1: -HALFZ + j1 * BZ, dir: a % 2 ? 1 : -1, lanes: key === 'b' ? [-9, -3, 3, 9] : key === 'w' ? [-9, -3] : [3, 9] });
  }
  for (let r = 0; r <= NS; r++) {
    for (const [i0, i1, key] of runs(NA, (i) => { const s = cellOK(i, r - 1), n = cellOK(i, r); if ((!s && !n) || (inPark(i, r - 1) && inPark(i, r))) return ''; return s && n ? 'b' : s ? 's' : 'n'; }))
      spans.push({ axis: 0, line: -HALFZ + r * BZ, a0: -HALFX + i0 * BX, a1: -HALFX + i1 * BX, dir: r % 2 ? 1 : -1, lanes: key === 'b' ? [-2.9, 2.9] : key === 's' ? [-2.9] : [2.9] });
  }

  // ---------------------------------------------------------------- animated billboards (invented brands)
  const BRANDS = [
    ['KUMO', 'SPARKLING SODA', '#ff3b6b', '#2a0a14'], ['NOVA TEK', 'THINK FASTER', '#2ef2ff', '#02141a'], ['SKYLINE AIR', 'FLY THE GRID', '#ffd21f', '#1a1402'],
    ['GLOW NOODLE', 'OPEN ALL NIGHT', '#7dff6b', '#06180a'], ['THREAD', 'ENERGY DRINK', '#ff8a1a', '#190d02'], ['PIXEL OPTICS', 'SEE SHARP', '#c08aff', '#120a1c'],
    ['HARBOR FM', '101.5 ALL DAY', '#ffffff', '#0b1a33'], ['BOROUGH BAGEL', 'HOT AT 5 AM', '#ffcf7a', '#2a1707'],
  ];
  const TICKER = 'SKY CITY NEWS  •  WEB-RUNNER SPOTTED IN MIDTOWN  •  CLEAR SKIES ALL WEEK  •  TRAFFIC SLOW ON 7 AV  •  ';
  function drawBB(g, bi, t) {
    const W = 512, H = 256, Bq = BRANDS[bi % BRANDS.length];
    g.fillStyle = Bq[3]; g.fillRect(0, 0, W, H);
    const off = ((t * 50) % (W * 2)) - W, gr = g.createLinearGradient(off, 0, off + W * 0.6, H);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.textAlign = 'center'; g.fillStyle = Bq[2]; g.font = '900 72px Arial';
    const pulse = 1 + 0.05 * Math.sin(t * 2.2 + bi * 2);
    g.save(); g.translate(W / 2, H * 0.46); g.scale(pulse, pulse); g.fillText(Bq[0], 0, 0, W - 30); g.restore();
    g.fillStyle = '#e8e8e8'; g.font = '600 30px Arial'; g.fillText(Bq[1], W / 2, H * 0.7);
    g.fillStyle = Bq[2]; g.fillRect(0, H - 40, W, 2);
    g.font = '700 26px Arial'; g.textAlign = 'left';
    const tw = g.measureText(TICKER).width;
    for (let x = -((t * 70) % tw); x < W; x += tw) g.fillText(TICKER, x, H - 10);
  }
  const NB = 4, bbSets = [], bbGeos = [[], [], [], []], frameG = [];
  for (let i = 0; i < NB; i++) { const [cv, g] = mk(512, 256); const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; bbSets.push({ g, tex: t, brand: i * 2, frame: -1 }); }
  const bbMats = bbSets.map((b) => new THREE.MeshStandardMaterial({ map: b.tex, emissiveMap: b.tex, emissive: 0xffffff, emissiveIntensity: 1.2, color: 0x050505, roughness: 0.6 }));
  bbSpots.forEach((s, i) => {
    const g = new THREE.PlaneGeometry(s.w, s.h), o = 0.4;
    if (s.face === 0) { g.rotateY(Math.PI / 2); g.translate(s.x + o, s.y, s.z); } else if (s.face === 1) { g.rotateY(-Math.PI / 2); g.translate(s.x - o, s.y, s.z); }
    else if (s.face === 2) g.translate(s.x, s.y, s.z + o); else { g.rotateY(Math.PI); g.translate(s.x, s.y, s.z - o); }
    bbGeos[i % NB].push(g);
    const fx = s.face < 2, f = new THREE.BoxGeometry(fx ? 0.3 : s.w + 1, s.h + 1, fx ? s.w + 1 : 0.3);
    f.translate(s.x + (s.face === 0 ? 0.16 : s.face === 1 ? -0.16 : 0), s.y, s.z + (s.face === 2 ? 0.16 : s.face === 3 ? -0.16 : 0)); frameG.push(f);
  });
  bbGeos.forEach((gs, i) => { if (gs.length) scene.add(new THREE.Mesh(mergeGeometries(gs), bbMats[i])); });
  if (frameG.length) scene.add(new THREE.Mesh(mergeGeometries(frameG), new THREE.MeshLambertMaterial({ color: 0x15171a })));

  // ---------------------------------------------------------------- minimap painter (north up, west on the left)
  const MAP = { x0: E1 - 40, x1: W1 + 40, z0: -HALFZ - 200, z1: HALFZ + 200 };
  function drawMap(ctx, sc) {
    const X = (x) => (MAP.x1 - x) * sc, Z = (z) => (MAP.z1 - z) * sc;
    const R = (x0, x1, z0, z1) => ctx.fillRect(X(x1), Z(z1), (x1 - x0) * sc, (z1 - z0) * sc);
    ctx.fillStyle = '#12303f'; ctx.fillRect(0, 0, (MAP.x1 - MAP.x0) * sc, (MAP.z1 - MAP.z0) * sc);
    ctx.fillStyle = '#262b30'; for (const l of map.lands) R(l[0], l[1], l[2], l[3]);
    for (let ty = 0; ty < 3; ty++) { ctx.fillStyle = ty === 0 ? '#2e3238' : ty === 1 ? '#474c54' : '#2f6a3b'; for (const s of map.slabs) if (s[4] === ty) R(s[0], s[1], s[2], s[3]); }
    for (const f of map.feats) { ctx.fillStyle = f[4] === 0 ? '#2a6f93' : '#3f8a4a'; ctx.beginPath(); ctx.ellipse(X(f[0]), Z(f[1]), f[2] * sc, f[3] * sc, 0, 0, 7); ctx.fill(); }
    for (const l of map.lines) { ctx.fillStyle = l[4] ? '#c8b891' : '#a89a72'; R(l[0], l[1], l[2], l[3]); }
    for (const b of map.b) { const t = clampN(b[4] / 260, 0, 1); const v = (88 + t * 96) | 0; ctx.fillStyle = `rgb(${v},${v + 4},${v + 12})`; R(b[0], b[1], b[2], b[3]); }
  }

  // ---------------------------------------------------------------- per-frame + quality hooks
  const spawn = { x: -HALFX + 4.5 * BX, z: -HALFZ + 9.6 * BZ };
  function setDensity(f, treeShadows) {
    const tf = f >= 1 ? 1 : f > 0.6 ? 0.8 : 0.55;
    for (const m of treeMeshes) { m.count = Math.max(1, Math.round(m.userData.full * tf)); m.castShadow = treeShadows && !m.userData.far; }
  }
  function setDetail(hi) { // drop the per-pixel extras on the lowest tiers
    for (let i = 0; i < facadeMats.length; i++) { const want = hi ? facadeTex[i].nrm : null; if (facadeMats[i].normalMap !== want) { facadeMats[i].normalMap = want; facadeMats[i].needsUpdate = true; } }
  }
  function setNight(on) { for (const m of nightMeshes) m.visible = on; }
  function setStreetLight(k, neon) { // k: 0 day .. 1 night
    for (const m of lightMeshes) m.visible = k > 0.01;
    poolMat.opacity = 0.5 * k; spillMat.opacity = 0.6 * k; haloMat.opacity = Math.min(1, k * 1.2); neonMat.color.setScalar(neon);
  }
  let lastPh = -1;
  let lodTick = 0;
  function update(dt, time, cx = 0, cz = 0) {
    swayU.value = time;
    if (++lodTick % 15 === 0) for (const t of treeSets) {
      const d = Math.hypot(t.cx - cx, t.cz - cz) - t.r, far = t.isFar ? d > 380 : d > 440;
      if (far !== t.isFar) { t.isFar = far; t.near[0].visible = t.near[1].visible = !far; t.far.visible = far; }
    }
    waterN.offset.set(time * 0.006, time * 0.0045);
    clouds.position.x = time * 2.2;
    const tc = ((time % CYC) + CYC) % CYC, ph = (tc < AVE_GO - 1.5 ? 1 : 0) | (tc >= ST_T0 && tc < ST_T0 + ST_GO - 1.5 ? 2 : 0);
    if (ph !== lastPh) { lastPh = ph; sig.ag.visible = !!(ph & 1); sig.ar.visible = !(ph & 1); sig.sg.visible = !!(ph & 2); sig.sr.visible = !(ph & 2); }
    for (let i = 0; i < NB; i++) {
      const b = bbSets[i], fr = Math.floor(time * 7 + i * 1.7);
      if (fr !== b.frame) { b.frame = fr; drawBB(b.g, b.brand + Math.floor(time / 7 + i * 0.25), time); b.tex.needsUpdate = true; }
    }
  }
  return { facadeMats, shopMat, update, setDensity, setDetail, setNight, setStreetLight, groundAt, zoneAt, streetAt, lampMat, glowMat, nightMat, cloudMat, waterMat, bbMats, streetMats: [groundMat, walkMat], spans, spawn, MAP, drawMap, vents, parkRect,
    stats: { boxes: boxes.length, trees: NT, lamps: NL, boards: bbSpots.length, spans: spans.length, chunks: Object.keys(buckets).length, facadeMeshes: chunkMeshes } };
}
