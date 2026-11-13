// ============================================================================
//  SKYTHREAD — world: a compressed, low-poly Manhattan-style island
//  Avenues run north-south (along z), cross streets run east-west (along x).
//  The southern tip (Downtown) is at -z, uptown is +z.
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const AVE = 28, ST = 16, WALK = 5;       // avenue width, street width, sidewalk depth
export const BX = 168, BZ = 76;                 // block pitch incl. roads (blocks are 140 x 60)
export const NA = 9, NS = 32;                   // blocks across, blocks long
export const HALFX = (NA * BX) / 2, HALFZ = (NS * BZ) / 2;
const EDGE = 14, SH = 0.25, SHOP_H = 5, TILE = 32;
const XE0 = HALFX + EDGE + 330, XE1 = XE0 + 760;       // east borough
const XW0 = -(HALFX + EDGE + 430), XW1 = XW0 - 760;    // west shore

const clampN = (v, a, b) => (v < a ? a : v > b ? b : v);
let seed = 20261112;
export function rnd() { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
export const rr = (a, b) => a + (b - a) * rnd();
export const pick = (a) => a[(rnd() * a.length) | 0];
const gauss = (x) => Math.exp(-x * x);

// ---------------------------------------------------------------- island layout
function colRange(j) { if (j === 0) return [3, 5]; if (j === 1) return [2, 6]; if (j === 2) return [1, 7]; if (j === NS - 1) return [2, 6]; if (j === NS - 2) return [1, 7]; return [0, NA - 1]; }
const cellOK = (i, j) => j >= 0 && j < NS && i >= colRange(j)[0] && i <= colRange(j)[1];
const PARK = { i0: 3, i1: 5, j0: 19, j1: 27 };
const inPark = (i, j) => i >= PARK.i0 && i <= PARK.i1 && j >= PARK.j0 && j <= PARK.j1;
function zoneOf(i, j) {
  if (j === 0) return 'battery';
  if (inPark(i, j)) return 'park';
  if (j <= 6) return 'fidi';
  if (j <= 11) return 'village';
  if (j <= 18) return 'midtown';
  if (j <= 27) return i < 3 ? 'uws' : 'ues';
  return 'uptown';
}
const ZONE_NAMES = { battery: 'BATTERY PARK', park: 'CENTRAL PARK', fidi: 'FINANCIAL DISTRICT', village: 'THE VILLAGE', midtown: 'MIDTOWN', uws: 'UPPER WEST SIDE', ues: 'UPPER EAST SIDE', uptown: 'HARLEM' };
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
  if (x > XE0 && x < XE1) return 'BROOKLYN';
  if (x < XW0 && x > XW1) return 'NEW JERSEY';
  return '';
}

// ---------------------------------------------------------------- textures
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function grain(ctx, w, h, amt) { const id = ctx.getImageData(0, 0, w, h), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; } ctx.putImageData(id, 0, 0); }
function shade(hex, v) { const c = new THREE.Color(hex); c.multiplyScalar(1 + v * 0.3); return '#' + c.getHexString(); }
let ANISO = 8;
function tex(cv, srgb = true) { const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANISO; return t; }

function brickPattern(c, S) {
  for (let y = 0; y < S; y += 8) {
    c.fillStyle = 'rgba(40,20,15,0.3)'; c.fillRect(0, y, S, 1);
    const off = ((y / 8) % 2) * 8;
    for (let x = off; x < S; x += 16) { c.fillStyle = `rgba(${rnd() < 0.5 ? '255,220,200' : '30,10,5'},${rr(0.02, 0.1)})`; c.fillRect(x + 1, y + 1, 15, 7); }
  }
}
function piers(c, S, cs) { for (let x = 0; x < S; x += cs) { c.fillStyle = 'rgba(80,60,30,0.2)'; c.fillRect(x - 6, 0, 12, S); c.fillStyle = 'rgba(255,245,220,0.16)'; c.fillRect(x - 6, 0, 3, S); } }
const WARM = ['#ffd9a0', '#fff1d6', '#ffcf85'], COOL = ['#d8ecff', '#fff6e0', '#cfe3ff'];
const STYLES = [
  { name: 'glassBlue', wall: '#33404e', frame: '#3d4854', win: { l: 2, r: 2, t: 3, b: 9 }, gTop: '#a9cdea', gBot: '#44698c', gVar: 0.3, gRough: '#141414', wRough: '#8a8a8a', lit: 0.1, litCols: COOL, mullion: true, metal: 0.75 },
  { name: 'glassTeal', wall: '#2b4444', frame: '#35504f', win: { l: 2, r: 2, t: 3, b: 8 }, gTop: '#a4e3d8', gBot: '#377878', gVar: 0.3, gRough: '#151515', wRough: '#8a8a8a', lit: 0.1, litCols: COOL, mullion: true, metal: 0.75 },
  { name: 'glassDark', wall: '#15181c', frame: '#22272d', win: { l: 2, r: 2, t: 2, b: 6 }, gTop: '#4f6f80', gBot: '#17222a', gVar: 0.25, gRough: '#101010', wRough: '#666666', lit: 0.09, litCols: COOL, mullion: true, metal: 0.85 },
  { name: 'bronze', wall: '#35271c', frame: '#4a3524', win: { l: 3, r: 3, t: 3, b: 8 }, gTop: '#dcb078', gBot: '#6d4a28', gVar: 0.25, gRough: '#161616', wRough: '#777777', lit: 0.1, litCols: WARM, mullion: true, metal: 0.8 },
  { name: 'brickRed', wall: '#8f4a35', frame: '#e3dccb', win: { l: 17, r: 17, t: 12, b: 20 }, gTop: '#42566a', gBot: '#1b242c', gVar: 0.3, gRough: '#333333', wRough: '#f0f0f0', lit: 0.2, litCols: WARM, sill: '#d8d0bd', pattern: brickPattern, metal: 0 },
  { name: 'brickBrown', wall: '#74553c', frame: '#2c2a28', win: { l: 16, r: 16, t: 11, b: 19 }, gTop: '#4a5e70', gBot: '#1c252d', gVar: 0.3, gRough: '#333333', wRough: '#f0f0f0', lit: 0.2, litCols: WARM, sill: '#5d4630', pattern: brickPattern, metal: 0 },
  { name: 'limestone', wall: '#cfc1a0', win: { l: 20, r: 20, t: 8, b: 14 }, gTop: '#4c6074', gBot: '#1e2832', gVar: 0.3, gRough: '#2c2c2c', wRough: '#e6e6e6', lit: 0.15, litCols: WARM, sill: '#b9a57f', pattern: piers, metal: 0.02 },
  { name: 'concrete', wall: '#c8c6bf', win: { l: 3, r: 3, t: 14, b: 18 }, gTop: '#667b8e', gBot: '#2a3743', gVar: 0.2, gRough: '#262626', wRough: '#dddddd', lit: 0.13, litCols: WARM, bands: '#a9a69c', bandH: 6, metal: 0.05 },
];
function makeFacade(o) {
  const S = 512, C = 8, cs = S / C;
  const [cc, c] = mk(S, S), [rc, r] = mk(S / 2, S / 2), [ec, e] = mk(S / 2, S / 2);
  r.scale(0.5, 0.5); e.scale(0.5, 0.5);
  c.fillStyle = o.wall; c.fillRect(0, 0, S, S);
  r.fillStyle = o.wRough; r.fillRect(0, 0, S, S);
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  if (o.pattern) o.pattern(c, S, cs);
  for (let fy = 0; fy < C; fy++) for (let fx = 0; fx < C; fx++) {
    const x = fx * cs, y = fy * cs, w = o.win;
    const wx = x + w.l, wy = y + w.t, ww = cs - w.l - w.r, wh = cs - w.t - w.b;
    if (o.frame) { c.fillStyle = o.frame; c.fillRect(wx - 2, wy - 2, ww + 4, wh + 4); r.fillStyle = '#777'; r.fillRect(wx - 2, wy - 2, ww + 4, wh + 4); }
    const v = rr(-1, 1) * o.gVar;
    const g = c.createLinearGradient(wx, wy, wx + ww * 0.3, wy + wh);
    g.addColorStop(0, shade(o.gTop, v)); g.addColorStop(1, shade(o.gBot, v));
    c.fillStyle = g; c.fillRect(wx, wy, ww, wh);
    if (rnd() < 0.5) { c.save(); c.globalAlpha = rr(0.06, 0.16); c.fillStyle = '#eef4ff'; c.beginPath(); const sx = wx + ww * rr(-0.2, 0.5); c.moveTo(sx, wy + wh); c.lineTo(sx + ww * 0.45, wy); c.lineTo(sx + ww * 0.8, wy); c.lineTo(sx + ww * 0.35, wy + wh); c.fill(); c.restore(); }
    r.fillStyle = o.gRough; r.fillRect(wx, wy, ww, wh);
    if (o.mullion) { c.fillStyle = o.frame || o.wall; c.fillRect(wx + ww / 2 - 1, wy, 2, wh); }
    if (rnd() < o.lit) {
      e.globalAlpha = rr(0.45, 1); e.fillStyle = pick(o.litCols); e.fillRect(wx + 1, wy + 1, ww - 2, wh - 2); e.globalAlpha = 1;
      if (rnd() < 0.4) { e.fillStyle = '#000'; e.fillRect(wx, wy, ww, wh * rr(0.2, 0.6)); }
    }
    if (o.sill) { c.fillStyle = o.sill; c.fillRect(wx - 4, wy + wh + 2, ww + 8, 4); }
  }
  if (o.bands) { c.fillStyle = o.bands; for (let fy = 0; fy < C; fy++) c.fillRect(0, fy * cs + cs - o.bandH, S, o.bandH); }
  grain(c, S, S, 7);
  return { map: tex(cc), rough: tex(rc, false), emi: tex(ec) };
}
// ground-floor storefronts: 4 shop units across (8 m each), 5 m tall
function makeShops() {
  const W = 512, H = 128, [cc, c] = mk(W, H), [ec, e] = mk(W, H);
  c.fillStyle = '#2b2a2a'; c.fillRect(0, 0, W, H); e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
  const signs = ['#c8372f', '#2f6fb0', '#e0a422', '#2f8a57', '#7a3fa0', '#d86a1f', '#1f8f93', '#b0b0b0'];
  for (let u = 0; u < 4; u++) {
    const x = u * 128, sc = pick(signs);
    c.fillStyle = '#3a3836'; c.fillRect(x, 0, 128, H);
    c.fillStyle = sc; c.fillRect(x + 6, 6, 116, 24);                                  // sign band
    c.fillStyle = 'rgba(255,255,255,0.75)'; const n = 2 + ((rnd() * 4) | 0);          // abstract lettering blocks
    for (let k = 0; k < n; k++) c.fillRect(x + 16 + k * (92 / n), 13, (92 / n) * 0.7, 10);
    e.fillStyle = sc; e.globalAlpha = 0.5; e.fillRect(x + 6, 6, 116, 24); e.globalAlpha = 1;
    c.fillStyle = shade(sc, -1.2); c.fillRect(x + 4, 32, 120, 8);                     // awning
    const g = c.createLinearGradient(0, 42, 0, 118); g.addColorStop(0, '#8fb0c8'); g.addColorStop(1, '#31485a');
    c.fillStyle = g; c.fillRect(x + 8, 44, 70, 68);                                   // display window
    e.fillStyle = pick(WARM); e.globalAlpha = rr(0.5, 0.95); e.fillRect(x + 8, 44, 70, 68); e.globalAlpha = 1;
    c.fillStyle = '#1b1a19'; c.fillRect(x + 42, 44, 2, 68);
    c.fillStyle = '#24211e'; c.fillRect(x + 86, 54, 32, 74);                          // door
    c.fillStyle = g; c.fillRect(x + 90, 58, 24, 40);
    e.fillStyle = '#ffe2b0'; e.globalAlpha = 0.45; e.fillRect(x + 90, 58, 24, 40); e.globalAlpha = 1;
    c.fillStyle = '#c9b458'; c.fillRect(x + 110, 100, 3, 8);
    c.fillStyle = '#1e1d1c'; c.fillRect(x, 118, 128, 10);                             // kick plate
    c.fillStyle = '#222'; c.fillRect(x, 0, 2, H);
  }
  grain(c, W, H, 8);
  return { map: tex(cc), emi: tex(ec) };
}
function makeWalkTex() {
  const S = 128, [cv, c] = mk(S, S);
  c.fillStyle = '#a7a39c'; c.fillRect(0, 0, S, S);
  c.fillStyle = 'rgba(60,58,55,0.5)'; c.fillRect(0, 0, S, 2); c.fillRect(0, 0, 2, S); c.fillRect(0, S / 2, S, 1); c.fillRect(S / 2, 0, 1, S);
  grain(c, S, S, 12); return tex(cv);
}
// one road tile per block: half an avenue on the left/right edges, half a street top/bottom
function makeGroundTex() {
  const W = 1024, H = 512, [cv, c] = mk(W, H), sx = W / BX, sz = H / BZ;
  const R = (x0, z0, x1, z1) => c.fillRect(x0 * sx, z0 * sz, (x1 - x0) * sx, (z1 - z0) * sz);
  c.fillStyle = '#3a3b3e'; c.fillRect(0, 0, W, H);
  for (let i = 0; i < 260; i++) { c.fillStyle = `rgba(0,0,0,${rr(0.04, 0.1)})`; c.beginPath(); c.ellipse(rnd() * W, rnd() * H, rr(4, 26), rr(2, 9), rnd() * 3, 0, 7); c.fill(); }
  const hA = AVE / 2, hS = ST / 2;
  c.fillStyle = 'rgba(168,62,48,0.55)'; R(7, hS, 11.5, BZ - hS);                      // bus lane
  c.fillStyle = 'rgba(64,140,84,0.6)'; R(BX - 13.4, hS, BX - 11.8, BZ - hS);          // bike lane
  c.fillStyle = 'rgba(236,236,230,0.85)';
  for (let z = hS + 6; z < BZ - hS - 8; z += 7) { R(-0.1, z, 0.1, z + 3); R(5.9, z, 6.1, z + 3); R(BX - 6.1, z, BX - 5.9, z + 3); R(BX - 0.1, z, BX + 0.1, z + 3); }
  R(11.9, hS + 4, 12.05, BZ - hS - 4); R(BX - 12.05, hS + 4, BX - 11.9, BZ - hS - 4);
  for (let x = hA + 6; x < BX - hA - 8; x += 8) { R(x, -0.08, x + 3.2, 0.08); R(x, BZ - 0.08, x + 3.2, BZ + 0.08); }
  c.fillStyle = 'rgba(240,240,235,0.9)';                                              // crosswalks
  for (let x = 0.6; x < hA - 0.6; x += 1.3) { R(x, hS + 0.6, x + 0.65, hS + 3.8); R(BX - x - 0.65, hS + 0.6, BX - x, hS + 3.8); R(x, BZ - hS - 3.8, x + 0.65, BZ - hS - 0.6); R(BX - x - 0.65, BZ - hS - 3.8, BX - x, BZ - hS - 0.6); }
  for (let z = 0.5; z < hS - 0.4; z += 1.3) { R(hA + 0.6, z, hA + 3.8, z + 0.65); R(BX - hA - 3.8, z, BX - hA - 0.6, z + 0.65); R(hA + 0.6, BZ - z - 0.65, hA + 3.8, BZ - z); R(BX - hA - 3.8, BZ - z - 0.65, BX - hA - 0.6, BZ - z); }
  c.fillStyle = 'rgba(20,20,20,0.6)'; for (let i = 0; i < 6; i++) { c.beginPath(); c.arc((i < 3 ? rr(1, 12) : rr(BX - 12, BX - 1)) * sx, rr(hS + 4, BZ - hS - 4) * sz, 3, 0, 7); c.fill(); }
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
const C3 = (hex) => { const c = new THREE.Color(hex); return [c.r, c.g, c.b]; };
class GB {
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
  box(x0, x1, y0, y1, z0, z1, col) { this.walls(x0, x1, z0, z1, y0, y1, 8, col); this.top(x0, x1, z0, z1, y1, 8, col); }
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
function paint(g, col) {
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
  const facadeMats = STYLES.map((s) => {
    const t = makeFacade(s);
    return new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.rough, roughness: 1, metalness: s.metal, emissiveMap: t.emi, emissive: 0xffffff, emissiveIntensity: 0.5, vertexColors: true });
  });
  const shopT = makeShops();
  const shopMat = new THREE.MeshStandardMaterial({ map: shopT.map, emissiveMap: shopT.emi, emissive: 0xffffff, emissiveIntensity: 0.5, roughness: 0.8, vertexColors: true });
  const flatMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.88, metalness: 0.02 });
  const walkMat = new THREE.MeshStandardMaterial({ map: makeWalkTex(), roughness: 0.92, vertexColors: true });
  const glowMat = new THREE.MeshBasicMaterial({ vertexColors: true });

  const fb = STYLES.map(() => new GB());
  const shopB = new GB(), flatB = new GB(), walkB = new GB(), groundB = new GB(), glowB = new GB();
  const flatGeos = [], trees = [], lamps = [], bbSpots = [];
  const K = {
    trim: C3(0xc9c2b4), stone: C3(0xb9a98a), metal: C3(0x8d9296), dark: C3(0x24272b), steel: C3(0x6f8296), grass: C3(0x4f7a36), lawn: C3(0x6a9744),
    path: C3(0xc9b68c), water: C3(0x2a5a78), quay: C3(0x8f8c86), land: C3(0x4c5148), wood: C3(0x6b4a2f), signal: C3(0xd9a516), pier: C3(0x7b6a55),
  };
  const ROOFS = [C3(0x5d5c5a), C3(0x6b6862), C3(0x4c4b4a), C3(0x75695a), C3(0x8a8880), C3(0x57604f)];
  const tintOf = (st) => { const b = st < 4 ? rr(0.8, 1.15) : rr(0.78, 1.12), j = st < 4 ? 0.1 : 0.06; return [b * (1 + rr(-j, j)), b * (1 + rr(-j, j)), b * (1 + rr(-j, j))]; };
  const box3 = (w, h, d, x, y, z, col) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(x, y, z); flatGeos.push(paint(g, col)); };
  const cone = (x, z, y, r0, r1, h, seg, col) => { const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1); g.translate(x, y + h / 2, z); flatGeos.push(paint(g, col)); };

  // one building tier: windowed walls, optional ground-floor shops, capped flat roof
  function tier(st, x0, x1, z0, z1, y0, y1, tint, shop, cap, roofCol) {
    const yw = shop ? SHOP_H : y0;
    if (y1 > yw) fb[st].walls(x0, x1, z0, z1, yw, y1, TILE, tint);
    if (shop) shopB.walls(x0, x1, z0, z1, 0, SHOP_H, 32, WHITE, true);
    if (cap) {
      const e = 0.45;
      flatB.walls(x0 - e, x1 + e, z0 - e, z1 + e, y1 - 1.3, y1, 8, K.trim);
      flatB.top(x0 - e, x1 + e, z0 - e, z1 + e, y1, 8, roofCol); flatB.bottom(x0 - e, x1 + e, z0 - e, z1 + e, y1 - 1.3, K.trim);
    } else flatB.top(x0, x1, z0, z1, y1, 8, roofCol);
    addBox(x0, x1, y0, y1, z0, z1);
  }
  function roofStuff(x0, x1, z0, z1, y, h) {
    const w = x1 - x0, d = z1 - z0; if (w < 9 || d < 9) return;
    const n = (rnd() * 3) | 0;
    for (let i = 0; i < n; i++) { const bw = rr(2, 4.5), bd = rr(2, 4.5), bh = rr(1.2, 2.6); box3(bw, bh, bd, rr(x0 + 3, x1 - 3), y + bh / 2, rr(z0 + 3, z1 - 3), K.metal); }
    if (h < 80 && rnd() < 0.42) { // rooftop water tank
      const cx = rr(x0 + 4, x1 - 4), cz = rr(z0 + 4, z1 - 4);
      box3(2.6, 3, 2.6, cx, y + 1.5, cz, K.dark); cone(cx, cz, y + 3, 2.1, 2.1, 4, 7, K.wood); cone(cx, cz, y + 7, 2.3, 0.1, 1.6, 7, K.wood);
      addBox(cx - 2.1, cx + 2.1, y, y + 7, cz - 2.1, cz + 2.1);
    }
    if (h > 170 && rnd() < 0.45) { const ah = rr(12, 30); box3(0.5, ah, 0.5, (x0 + x1) / 2, y + ah / 2, (z0 + z1) / 2, K.metal); }
  }
  const R4 = (v) => Math.max(12, Math.round(v / 4) * 4);
  function tower(kind, st, x0, x1, z0, z1, h, tint) {
    const roofCol = pick(ROOFS); h = R4(h);
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    if (kind === 'box' || h < 50) { tier(st, x0, x1, z0, z1, 0, h, tint, true, true, roofCol); roofStuff(x0, x1, z0, z1, h, h); return; }
    if (kind === 'setback' || kind === 'deco') {
      const n = h > 200 ? 4 : h > 110 ? 3 : 2;
      let a0 = x0, a1 = x1, b0 = z0, b1 = z1, y = 0;
      for (let k = 0; k < n; k++) {
        let y1 = k === n - 1 ? h : R4(h * (k === 0 ? rr(0.35, 0.55) : 0.55 + (0.42 * k) / (n - 1) + rr(-0.03, 0.03)));
        y1 = Math.max(y1, y + 8);
        if (k > 0) { const s = rr(2.5, 5.5); if (a1 - a0 - 2 * s > 12) { a0 += s; a1 -= s; } if (b1 - b0 - 2 * s > 12) { b0 += s; b1 -= s; } }
        tier(st, a0, a1, b0, b1, y, y1, tint, k === 0, true, roofCol); y = y1;
      }
      if (kind === 'deco') {
        const s = Math.min(a1 - a0, b1 - b0) * 0.32;
        flatB.box(cx - s, cx + s, y, y + 10, cz - s, cz + s, K.stone); addBox(cx - s, cx + s, y, y + 10, cz - s, cz + s);
        flatB.pyr(cx - s, cx + s, cz - s, cz + s, y + 10, s * 2.2, K.metal); cone(cx, cz, y + 10 + s * 2, 0.7, 0.1, h * 0.09, 4, K.metal);
      } else roofStuff(a0, a1, b0, b1, y, h);
      return;
    }
    if (kind === 'pencil') { // podium + super-slender shaft
      const ph = R4(rr(18, 34)), s = rr(10, 12.5);
      tier(st, x0, x1, z0, z1, 0, ph, tint, true, true, roofCol);
      const y2 = R4(h * rr(0.8, 0.9));
      tier(st, cx - s, cx + s, cz - s, cz + s, ph, y2, tint, false, true, roofCol);
      tier(st, cx - s + 2, cx + s - 2, cz - s + 2, cz + s - 2, y2, h, tint, false, true, roofCol);
      return;
    }
    // taper: podium, stepped glass shaft, pyramid crown and spire
    const ph = R4(rr(16, 28)); tier(st, x0, x1, z0, z1, 0, ph, tint, true, true, roofCol);
    const s = Math.min(x1 - x0, z1 - z0) * 0.5 - 2, n = 6, s1 = s * 0.6; let y = ph;
    for (let k = 0; k < n; k++) { const y1 = k === n - 1 ? h : R4(ph + ((h - ph) * (k + 1)) / n); const sk = s + ((s1 - s) * k) / (n - 1); tier(st, cx - sk, cx + sk, cz - sk, cz + sk, y, Math.max(y1, y + 4), tint, false, true, roofCol); y = Math.max(y1, y + 4); }
    flatB.pyr(cx - s1, cx + s1, cz - s1, cz + s1, y, s1 * 1.3, K.steel); cone(cx, cz, y + s1, 0.9, 0.1, h * 0.13, 4, K.metal);
  }

  // ---------------------------------------------------------------- landmarks (period archetypes, not replicas)
  function landmark(i, j, ax0, ax1, az0, az1) {
    const cx = (ax0 + ax1) / 2, cz = (az0 + az1) / 2, rc = ROOFS[0];
    if (i === 4 && j === 13) { // art-deco setback giant with a mast
      const t = [0.98, 0.95, 0.88];
      tier(6, cx - 45, cx + 45, az0, az1, 0, 28, t, true, true, rc); tier(6, cx - 31, cx + 31, az0 + 4, az1 - 4, 28, 96, t, false, true, rc);
      tier(6, cx - 24, cx + 24, az0 + 7, az1 - 7, 96, 264, t, false, true, rc); tier(6, cx - 19, cx + 19, az0 + 11, az1 - 11, 264, 304, t, false, true, rc);
      tier(6, cx - 13, cx + 13, az0 + 15, az1 - 15, 304, 336, t, false, true, rc); tier(6, cx - 8, cx + 8, cz - 8, cz + 8, 336, 372, t, false, true, rc);
      cone(cx, cz, 372, 4.2, 2.2, 42, 8, K.metal); cone(cx, cz, 414, 1.5, 0.15, 30, 5, K.metal); addBox(cx - 3, cx + 3, 372, 414, cz - 3, cz + 3);
      fill(ax0, cx - 47, az0, az1, 'midtown', i, j, 60, 110); fill(cx + 47, ax1, az0, az1, 'midtown', i, j, 60, 110); return true;
    }
    if (i === 6 && j === 15) { // stepped stainless crown and needle
      const t = [0.86, 0.86, 0.9];
      tier(7, cx - 34, cx + 34, az0, az1, 0, 40, t, true, true, rc); tier(7, cx - 18, cx + 18, cz - 18, cz + 18, 40, 216, t, false, true, rc);
      tier(7, cx - 15, cx + 15, cz - 15, cz + 15, 216, 244, t, false, true, rc);
      let s = 12.5, y = 244;
      for (let k = 0; k < 7; k++) { flatB.box(cx - s, cx + s, y, y + 6.5, cz - s, cz + s, K.metal); addBox(cx - s, cx + s, y, y + 6.5, cz - s, cz + s); y += 6.5; s -= 1.6; }
      cone(cx, cz, y, 1.2, 0.1, 30, 4, K.metal);
      fill(ax0, cx - 36, az0, az1, 'midtown', i, j, 70, 150); fill(cx + 36, ax1, az0, az1, 'midtown', i, j, 70, 150); return true;
    }
    if (i === 4 && j === 4) { // tapering glass giant downtown
      const t = [0.95, 1.02, 1.1];
      tier(0, cx - 40, cx + 40, az0, az1, 0, 24, t, true, true, rc);
      let y = 24; const n = 8;
      for (let k = 0; k < n; k++) { const s = 24 - (9 * k) / (n - 1), y1 = k === n - 1 ? 420 : R4(24 + (396 * (k + 1)) / n); tier(0, cx - s, cx + s, cz - s, cz + s, y, y1, t, false, true, rc); y = y1; }
      flatB.box(cx - 12, cx + 12, 420, 428, cz - 12, cz + 12, K.steel); addBox(cx - 12, cx + 12, 420, 428, cz - 12, cz + 12);
      cone(cx, cz, 428, 2.4, 0.2, 113, 6, K.metal); addBox(cx - 1.5, cx + 1.5, 428, 470, cz - 1.5, cz + 1.5);
      fill(ax0, cx - 42, az0, az1, 'fidi', i, j, 80, 170); fill(cx + 42, ax1, az0, az1, 'fidi', i, j, 80, 170); return true;
    }
    if (i === 5 && j === 13) { tower('taper', 0, cx - 25, cx + 25, az0, az1, 396, [1.05, 1.05, 1.0]); fill(ax0, cx - 27, az0, az1, 'midtown', i, j, 90, 190); fill(cx + 27, ax1, az0, az1, 'midtown', i, j, 90, 190); return true; }
    if (i === 6 && j === 13) { tier(7, cx - 46, cx + 46, az0 + 6, az1 - 6, 0, 246, [0.9, 0.9, 0.88], true, true, rc); roofStuff(cx - 46, cx + 46, az0 + 6, az1 - 6, 246, 246); fill(ax0, cx - 48, az0, az1, 'midtown', i, j, 60, 120); fill(cx + 48, ax1, az0, az1, 'midtown', i, j, 60, 120); return true; }
    return false;
  }

  // fill a strip of a block with lots and buildings
  function heightFor(zn, i, j) {
    if (zn === 'fidi') { const w = gauss((i - 4) / 2.6) * gauss((j - 3.6) / 2.6); if (w > 0.3 && rnd() < 0.15) return rr(270, 390); return 46 + 190 * w * rr(0.5, 1.2) + rr(0, 44); }
    if (zn === 'midtown') {
      if (i <= 1 && j >= 13 && j <= 15) return rnd() < 0.5 ? rr(240, 380) : rr(90, 200); // glass cluster on the far west side
      const w = gauss((i - 4.2) / 3.0) * gauss((j - 15.2) / 3.0); if (w > 0.28 && rnd() < 0.2) return rr(280, 430); return 44 + 200 * w * rr(0.5, 1.2) + rr(0, 50);
    }
    if (zn === 'village') return rnd() < 0.07 ? rr(48, 92) : rr(14, 34);
    if (zn === 'uws' || zn === 'ues') return i === 2 || i === 6 ? rr(60, 132) : rr(26, 84);
    return rnd() < 0.1 ? rr(56, 100) : rr(18, 50);
  }
  function styleFor(h, zn) {
    if (h > 150) return pick([0, 0, 1, 2, 2, 3, 6]);
    if (h > 60) return pick([0, 2, 3, 6, 6, 7, 7, 4, 5, 1]);
    if (zn === 'village' || zn === 'uptown') return pick([4, 4, 5, 5, 6, 7]);
    return pick([4, 5, 6, 6, 7, 7]);
  }
  function fill(xa, xb, za, zb, zn, i, j, hMin = 0, hMax = 0, pencil = false) {
    const low = zn === 'village' || zn === 'uptown', big = zn === 'midtown' || zn === 'fidi';
    const wmin = low ? 12 : big ? 26 : 18, wmax = low ? 24 : big ? 58 : 36;
    let x = xa; const out = []; let pen = pencil ? 1 + ((rnd() * 2) | 0) : 0;
    while (x < xb - 9) {
      let w = rr(wmin, wmax); if (xb - (x + w) < wmin * 0.8) w = xb - x;
      const x1 = Math.min(xb, x + w);
      const rows = (low || rnd() < 0.3) && zb - za > 40 ? [[za, (za + zb) / 2 - 1.5], [(za + zb) / 2 + 1.5, zb]] : [[za, zb]];
      for (const [z0, z1] of rows) {
        let h = hMax ? rr(hMin, hMax) : heightFor(zn, i, j), kind;
        if (pen > 0 && rows.length === 1 && x1 - x > 22) { pen--; h = rr(380, 472); kind = 'pencil'; }
        else if (h > 262) kind = pick(['taper', 'setback', 'deco', 'pencil', 'setback']);
        else if (h > 110) kind = pick(['box', 'setback', 'setback', 'deco']);
        else kind = h > 56 && rnd() < 0.35 ? 'setback' : 'box';
        const st = kind === 'pencil' ? pick([0, 1, 2, 3]) : kind === 'deco' ? pick([6, 6, 4, 7]) : kind === 'taper' ? pick([0, 1, 2]) : styleFor(h, zn);
        tower(kind, st, x, x1, z0, z1, h, tintOf(st));
        out.push({ x0: x, x1, z0, z1, h: R4(h) });
      }
      x = x1 + 0.8;
    }
    return out;
  }

  // ---------------------------------------------------------------- lay out every block
  const quay = [];
  for (let j = 0; j < NS; j++) for (let i = 0; i < NA; i++) {
    if (!cellOK(i, j)) continue;
    const bx = -HALFX + i * BX, bz = -HALFZ + j * BZ;
    groundB.quad([bx, 0, bz], [bx, 0, bz + BZ], [bx + BX, 0, bz + BZ], [bx + BX, 0, bz], [0, 1, 0], [0, 0], [0, 1], [1, 1], [1, 0]);
    quay.push([bx + BX / 2, bz + BZ / 2]);
    const zn = zoneOf(i, j);
    if (zn === 'park') continue;
    const x0 = bx + AVE / 2, x1 = bx + BX - AVE / 2, z0 = bz + ST / 2, z1 = bz + BZ - ST / 2;
    walkB.walls(x0, x1, z0, z1, 0, SH, 4, WHITE); addBox(x0, x1, -1, SH, z0, z1, true);
    if (zn === 'battery') {
      flatB.top(x0, x1, z0, z1, SH, 8, K.grass); flatB.top(x0 + 30, x1 - 30, (z0 + z1) / 2 - 2, (z0 + z1) / 2 + 2, SH + 0.04, 8, K.path);
      for (let t = 0; t < 26; t++) { const tx = rr(x0 + 3, x1 - 3), tz = rr(z0 + 3, z1 - 3); if (Math.abs(tz - (z0 + z1) / 2) > 4) trees.push([tx, SH, tz, rr(0.9, 1.5), 0]); }
      continue;
    }
    walkB.top(x0, x1, z0, z1, SH, 4, WHITE);
    for (const t of [0.25, 0.75]) { lamps.push([x0 + (x1 - x0) * t, z0 + 0.9, 0], [x0 + (x1 - x0) * t, z1 - 0.9, Math.PI]); }
    if (rnd() < 0.45) for (let s = x0 + 8; s < x1 - 12; s += 22) { trees.push([s, SH, z0 + 1.9, rr(0.75, 1.05), 0]); trees.push([s + 9, SH, z1 - 1.9, rr(0.75, 1.05), 0]); }
    const ax0 = x0 + WALK, ax1 = x1 - WALK, az0 = z0 + WALK, az1 = z1 - WALK;
    if (landmark(i, j, ax0, ax1, az0, az1)) continue;
    const tsq = (i === 3 || i === 4) && j >= 14 && j <= 15;
    const lots = tsq ? fill(ax0, ax1, az0, az1, zn, i, j, 56, 120) : fill(ax0, ax1, az0, az1, zn, i, j, 0, 0, zn === 'midtown' && j === 18 && i >= 2 && i <= 6);
    if (tsq) { // bright-lights crossroads: big screens facing the avenue between the two columns
      const L = i === 3 ? lots.filter((l) => l.x1 > ax1 - 1) : lots.filter((l) => l.x0 < ax0 + 1);
      for (const l of L) {
        const bw = Math.min(40, l.z1 - l.z0 - 4), zc = (l.z0 + l.z1) / 2, xf = i === 3 ? l.x1 : l.x0, f = i === 3 ? 0 : 1;
        bbSpots.push({ x: xf, y: 8 + bw * 0.25, z: zc, w: bw, h: bw * 0.5, face: f });
        if (l.h > 56) bbSpots.push({ x: xf, y: 10 + bw * 0.5 + bw * 0.22, z: zc, w: bw * 0.85, h: bw * 0.42, face: f });
      }
      for (const l of lots) if (l.x1 - l.x0 > 24 && rnd() < 0.7) { const s = rnd() < 0.5; bbSpots.push({ x: (l.x0 + l.x1) / 2, y: 16, z: s ? l.z1 : l.z0, w: Math.min(26, l.x1 - l.x0 - 4), h: 11, face: s ? 2 : 3 }); }
    } else if ((zn === 'midtown' || zn === 'fidi') && rnd() < 0.3) {
      const l = pick(lots); if (l && l.h > 70 && l.z1 - l.z0 > 20) { const s = rnd() < 0.5, bw = Math.min(22, l.x1 - l.x0 - 4); if (bw > 12) bbSpots.push({ x: (l.x0 + l.x1) / 2, y: clampN(l.h * 0.5, 22, 70), z: s ? l.z1 : l.z0, w: bw, h: bw * 0.5, face: s ? 2 : 3 }); }
    }
  }
  for (const [qx, qz] of quay) box3(BX + 2 * EDGE, 8, BZ + 2 * EDGE, qx, -4.03, qz, K.quay);

  // ---------------------------------------------------------------- the park
  {
    const x0 = -HALFX + PARK.i0 * BX + AVE / 2, x1 = -HALFX + (PARK.i1 + 1) * BX - AVE / 2, z0 = -HALFZ + PARK.j0 * BZ + ST / 2, z1 = -HALFZ + (PARK.j1 + 1) * BZ - ST / 2;
    flatB.top(x0, x1, z0, z1, SH, 8, K.grass); flatB.walls(x0, x1, z0, z1, 0, SH + 0.55, 8, K.stone); addBox(x0, x1, -1, SH, z0, z1, true);
    const cx = (x0 + x1) / 2, feat = [];
    const oval = (ox, oz, rx, rz, col, y) => { flatB.disc(ox, oz, rx, rz, SH + y, 14, col); feat.push([ox, oz, rx + 4, rz + 4]); };
    oval(cx + 20, z0 + (z1 - z0) * 0.68, 150, 78, K.water, 0.04);       // reservoir
    oval(cx - 90, z0 + (z1 - z0) * 0.3, 62, 34, K.water, 0.04);         // the lake
    oval(cx + 60, z0 + (z1 - z0) * 0.45, 86, 44, K.lawn, 0.03);         // great lawn
    oval(cx + 40, z0 + (z1 - z0) * 0.1, 70, 30, K.lawn, 0.03);          // meadow
    const P = (a, b, c, d) => flatB.top(a, b, c, d, SH + 0.06, 8, K.path);
    P(x0 + 22, x1 - 22, z0 + 20, z0 + 24); P(x0 + 22, x1 - 22, z1 - 24, z1 - 20); P(x0 + 22, x0 + 26, z0 + 20, z1 - 20); P(x1 - 26, x1 - 22, z0 + 20, z1 - 20);
    for (const f of [0.2, 0.56, 0.87]) P(x0 + 22, x1 - 22, z0 + (z1 - z0) * f - 1.6, z0 + (z1 - z0) * f + 1.6);
    for (let t = 0, n = 0; n < 1150 && t < 6000; t++) {
      const tx = rr(x0 + 4, x1 - 4), tz = rr(z0 + 4, z1 - 4);
      if (feat.some(([ox, oz, rx, rz]) => ((tx - ox) / rx) ** 2 + ((tz - oz) / rz) ** 2 < 1)) continue;
      trees.push([tx, SH, tz, rr(0.9, 1.7), rnd() < 0.12 ? 1 : 0]); n++;
    }
    for (let s = z0 + 30; s < z1 - 20; s += 55) { lamps.push([x0 + 24, s, Math.PI / 2], [x1 - 24, s, -Math.PI / 2]); }
  }

  // ---------------------------------------------------------------- outer boroughs, piers, bridges
  function farLand(xa, xb, shoreSign) {
    const x0 = Math.min(xa, xb), x1 = Math.max(xa, xb), z0 = -HALFZ - 160, z1 = HALFZ + 160;
    box3(x1 - x0, 6, z1 - z0, (x0 + x1) / 2, -3.02, (z0 + z1) / 2, K.land); LANDS.push([x0, x1, z0, z1]);
    const shore = shoreSign > 0 ? x0 : x1, hubZ = shoreSign > 0 ? -HALFZ * 0.55 : -HALFZ * 0.2;
    for (let gx = x0 + 10; gx < x1 - 60; gx += 72) for (let gz = z0 + 10; gz < z1 - 60; gz += 72) {
      if (rnd() < 0.24) continue;
      const w = rr(28, 52), d = rr(28, 52), ox = gx + rr(0, 60 - w), oz = gz + rr(0, 60 - d);
      const dd = Math.hypot((ox - shore) / 1.4, oz - hubZ);
      let h = rr(8, 34); if (dd < 300) h = Math.max(h, rr(50, 230) * (1 - dd / 380));
      h = R4(h); const st = h > 90 ? pick([0, 1, 2, 3]) : pick([4, 5, 6, 7]);
      tier(st, ox, ox + w, oz, oz + d, 0, h, tintOf(st), false, true, pick(ROOFS));
    }
  }
  farLand(XE0, XE1, 1); farLand(XW0, XW1, -1);
  for (let k = 0; k < 9; k++) { // west-side piers
    const pz = -HALFZ + BZ * (7.5 + k * 2.6), px0 = -HALFX - EDGE - 150, px1 = -HALFX - EDGE + 1;
    box3(px1 - px0, 3.5, 22, (px0 + px1) / 2, -1.5, pz, K.pier); addBox(px0, px1, -3, SH, pz - 11, pz + 11, true);
    if (k % 3 === 1) { flatB.box(px0 + 12, px1 - 30, SH, 9, pz - 8, pz + 8, K.metal); addBox(px0 + 12, px1 - 30, SH, 9, pz - 8, pz + 8); }
  }
  const segM = new THREE.Matrix4(), segQ = new THREE.Quaternion(), ZAX = new THREE.Vector3(0, 0, 1), ONE = new THREE.Vector3(1, 1, 1);
  function strut(a, b, t, col) {
    const d = new THREE.Vector3().subVectors(b, a), len = d.length(); const g = new THREE.BoxGeometry(t, t, len);
    segQ.setFromUnitVectors(ZAX, d.normalize()); segM.compose(new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5), segQ, ONE);
    g.applyMatrix4(segM); flatGeos.push(paint(g, col));
  }
  function bridge(zc, col, cableCol) {
    const xA = HALFX + EDGE - 2, xB = XE0 + 8, dy = 17, hw = 11, TH = 84;
    box3(xB - xA, 2.6, hw * 2, (xA + xB) / 2, dy - 1.3, zc, K.dark); addBox(xA, xB, dy - 2.6, dy, zc - hw, zc + hw);
    for (const s of [-1, 1]) box3(xB - xA, 1.3, 0.5, (xA + xB) / 2, dy + 0.65, zc + s * (hw - 0.3), col);
    const tx = [xA + (xB - xA) * 0.27, xA + (xB - xA) * 0.73];
    for (const x of tx) {
      for (const s of [-1, 1]) { box3(8, TH + 8, 6, x, (TH - 8) / 2, zc + s * (hw + 1), col); addBox(x - 4, x + 4, -8, TH, zc + s * (hw + 1) - 3, zc + s * (hw + 1) + 3); }
      box3(8, 9, hw * 2 + 8, x, TH - 4.5, zc, col); box3(8, 6, hw * 2 + 8, x, dy + 30, zc, col); addBox(x - 4, x + 4, TH - 9, TH, zc - hw - 4, zc + hw + 4);
    }
    for (const x of [xA + 10, xB - 10]) { box3(22, dy + 6, hw * 2 + 6, x, (dy - 6) / 2, zc, col); addBox(x - 11, x + 11, -6, dy, zc - hw - 3, zc + hw + 3); }
    const V = (x, y, z) => new THREE.Vector3(x, y, z);
    for (const s of [-1, 1]) {
      const z = zc + s * (hw - 0.6), top = TH - 1;
      const cab = (xa, ya, xb2, yb, sag, n) => { let prev = V(xa, ya, z); for (let k = 1; k <= n; k++) { const t = k / n, x = xa + (xb2 - xa) * t, y = ya + (yb - ya) * t - sag * 4 * t * (1 - t); const p = V(x, y, z); strut(prev, p, 0.7, cableCol); if (k < n && k % 2 === 0) strut(V(x, dy, z), p, 0.22, cableCol); prev = p; } };
      cab(xA + 10, dy + 3, tx[0], top, 8, 6); cab(tx[0], top, tx[1], top, top - dy - 7, 16); cab(tx[1], top, xB - 10, dy + 3, 8, 6);
    }
  }
  bridge(-HALFZ + 4 * BZ, K.stone, K.metal); bridge(-HALFZ + 8 * BZ, K.steel, K.steel);

  // traffic signals at every crossing (static, merged)
  for (let a = 0; a <= NA; a++) for (let r = 0; r <= NS; r++) {
    if (!cellOK(a, r) || inPark(a, r) && inPark(a - 1, r - 1)) continue;
    const x = -HALFX + a * BX + AVE / 2 + 0.7, z = -HALFZ + r * BZ + ST / 2 + 0.7;
    box3(0.28, 7, 0.28, x, 3.5 + SH, z, K.dark); box3(6.5, 0.2, 0.2, x - 3.2, 6.9, z, K.dark); box3(0.55, 1.5, 0.55, x - 6.2, 6.2, z, K.signal);
    const g = (a + r) % 2 === 0, lc = g ? [0.2, 1.6, 0.4] : [1.8, 0.15, 0.1], ly = g ? 5.6 : 6.4;
    glowB.box(x - 6.38, x - 6.02, ly, ly + 0.3, z - 0.31, z - 0.28, lc); glowB.box(x - 6.38, x - 6.02, ly, ly + 0.3, z + 0.28, z + 0.31, lc);
  }

  // ---------------------------------------------------------------- build static meshes
  const addMesh = (geo, mat, cast = true, recv = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = recv; scene.add(m); return m; };
  fb.forEach((b, i) => { if (b.p.length) addMesh(b.geo(), facadeMats[i]); });
  addMesh(shopB.geo(), shopMat, false, true);
  addMesh(mergeGeometries([flatB.geo(), ...flatGeos]), flatMat);
  addMesh(walkB.geo(), walkMat, false, true);
  addMesh(groundB.geo(), new THREE.MeshStandardMaterial({ map: makeGroundTex(), roughness: 0.93 }), false, true);
  addMesh(glowB.geo(), glowMat, false, false);

  // water with slow ripples
  const wS = 256, [wc, wg] = mk(wS, wS);
  wg.fillStyle = '#8080ff'; wg.fillRect(0, 0, wS, wS);
  for (let i = 0; i < 700; i++) {
    const gx = rnd() * wS, gy = rnd() * wS, rad = rr(4, 16), gr = wg.createRadialGradient(gx, gy, 0, gx, gy, rad);
    gr.addColorStop(0, `rgba(${(128 + (rnd() - 0.5) * 40) | 0},${(128 + (rnd() - 0.5) * 40) | 0},255,0.35)`); gr.addColorStop(1, 'rgba(128,128,255,0)');
    wg.fillStyle = gr; wg.fillRect(gx - rad, gy - rad, rad * 2, rad * 2);
  }
  const waterN = tex(wc, false); waterN.repeat.set(260, 260); waterN.anisotropy = 4;
  const water = new THREE.Mesh(new THREE.PlaneGeometry(16000, 16000), new THREE.MeshStandardMaterial({ color: 0x2c6787, roughness: 0.28, metalness: 0.35, normalMap: waterN, normalScale: new THREE.Vector2(0.35, 0.35) }));
  water.rotation.x = -Math.PI / 2; water.position.y = -2.5; scene.add(water);

  const dm = new THREE.Object3D(), col = new THREE.Color();
  // ---------------------------------------------------------------- low-poly trees (instanced, wind-swayed)
  for (let i = trees.length - 1; i > 0; i--) { const k = (rnd() * (i + 1)) | 0; const t = trees[i]; trees[i] = trees[k]; trees[k] = t; }
  const trunkG = new THREE.CylinderGeometry(0.16, 0.3, 3, 5, 1, true); trunkG.translate(0, 1.5, 0);
  const lobe = (r, sy, x, y, z) => { const g = new THREE.IcosahedronGeometry(r, 0); const pa = g.attributes.position; for (let v = 0; v < pa.count; v++) { const m = 1 + Math.sin(pa.getX(v) * 12.9 + pa.getY(v) * 78.2 + pa.getZ(v) * 37.7) * 0.14; pa.setXYZ(v, pa.getX(v) * m, pa.getY(v) * m * sy, pa.getZ(v) * m); } g.translate(x, y, z); return g; };
  const crownG = mergeGeometries([lobe(2.3, 0.95, 0, 4.6, 0), lobe(1.5, 0.9, 0.7, 6.2, 0.4)]); crownG.computeVertexNormals();
  const swayU = { value: 0 };
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  crownMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = swayU;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
      float swf = smoothstep(2.6, 6.5, position.y); float ph = float(gl_InstanceID) * 1.73;
      transformed.x += (sin(uTime * 1.25 + ph) * 0.16 + sin(uTime * 3.1 + ph * 2.0) * 0.045) * swf;
      transformed.z += (cos(uTime * 1.07 + ph * 1.4) * 0.13 + cos(uTime * 2.7 + ph) * 0.04) * swf;`);
  };
  const NT = trees.length;
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x4b3726, roughness: 1, flatShading: true }), NT);
  const crowns = new THREE.InstancedMesh(crownG, crownMat, NT);
  trees.forEach(([x, y, z, s, autumn], i) => {
    dm.position.set(x, y, z); dm.scale.set(s, s * rr(0.85, 1.25), s); dm.rotation.set(0, rnd() * 6, 0); dm.updateMatrix();
    trunks.setMatrixAt(i, dm.matrix); crowns.setMatrixAt(i, dm.matrix);
    if (autumn) col.setHSL(rr(0.04, 0.14), rr(0.6, 0.8), rr(0.36, 0.5)); else col.setHSL(rr(0.22, 0.36), rr(0.42, 0.62), rr(0.22, 0.36));
    crowns.setColorAt(i, col);
  });
  for (const m of [trunks, crowns]) { m.castShadow = true; m.receiveShadow = true; m.frustumCulled = false; scene.add(m); }

  // street lamps
  const poleG = mergeGeometries([new THREE.CylinderGeometry(0.09, 0.14, 7.6, 4, 1, true).translate(0, 3.8, 0), new THREE.BoxGeometry(0.12, 0.12, 2.2).translate(0, 7.6, -1.0)]);
  const headG = new THREE.BoxGeometry(0.4, 0.16, 0.8).translate(0, 7.5, -2.0);
  const poles = new THREE.InstancedMesh(poleG, new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.6, metalness: 0.5, flatShading: true }), lamps.length);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x332a1a, emissive: 0xffd9a0, emissiveIntensity: 0.3 });
  const heads = new THREE.InstancedMesh(headG, lampMat, lamps.length);
  lamps.forEach(([x, z, ry], k) => { dm.position.set(x, SH, z); dm.rotation.set(0, ry, 0); dm.scale.set(1, 1, 1); dm.updateMatrix(); poles.setMatrixAt(k, dm.matrix); heads.setMatrixAt(k, dm.matrix); });
  poles.frustumCulled = heads.frustumCulled = false; scene.add(poles, heads);

  // low-poly clouds
  const NCL = 230, cloudMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, flatShading: true, fog: false, emissive: 0x5a6470, emissiveIntensity: 0.5 });
  const clouds = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), cloudMat, NCL);
  for (let k = 0; k < NCL;) {
    const cx = rr(-4200, 4200), cz = rr(-4200, 4200), cy = rr(640, 1050), n = 3 + ((rnd() * 4) | 0), sc = rr(0.7, 1.6);
    for (let q = 0; q < n && k < NCL; q++, k++) { dm.position.set(cx + rr(-110, 110) * sc, cy + rr(-14, 14), cz + rr(-60, 60) * sc); dm.scale.set(rr(70, 150) * sc, rr(26, 46) * sc, rr(55, 110) * sc); dm.rotation.set(0, rnd() * 6, 0); dm.updateMatrix(); clouds.setMatrixAt(k, dm.matrix); }
  }
  clouds.frustumCulled = false; scene.add(clouds);

  // ---------------------------------------------------------------- traffic: one-way avenues and streets
  const spans = [];
  const runs = (count, ok) => { const out = []; let s = -1, key = ''; for (let k = 0; k <= count; k++) { const o = k < count ? ok(k) : ''; if (o !== key) { if (key) out.push([s, k, key]); s = k; key = o; } } return out; };
  for (let a = 0; a <= NA; a++) {
    for (const [j0, j1, key] of runs(NS, (j) => { const w = cellOK(a - 1, j), e = cellOK(a, j); if ((!w && !e) || (inPark(a - 1, j) && inPark(a, j))) return ''; return w && e ? 'b' : w ? 'w' : 'e'; }))
      spans.push({ axis: 1, line: -HALFX + a * BX, a0: -HALFZ + j0 * BZ, a1: -HALFZ + j1 * BZ, dir: a % 2 ? 1 : -1, lanes: key === 'b' ? [-9, -3, 3, 9] : key === 'w' ? [-9, -3] : [3, 9] });
  }
  for (let r = 0; r <= NS; r++) {
    for (const [i0, i1, key] of runs(NA, (i) => { const s = cellOK(i, r - 1), n = cellOK(i, r); if ((!s && !n) || (inPark(i, r - 1) && inPark(i, r))) return ''; return s && n ? 'b' : s ? 's' : 'n'; }))
      spans.push({ axis: 0, line: -HALFZ + r * BZ, a0: -HALFX + i0 * BX, a1: -HALFX + i1 * BX, dir: r % 2 ? 1 : -1, lanes: key === 'b' ? [-3.6, 3.6] : key === 's' ? [-3.6] : [3.6] });
  }
  let spanW = 0; for (const s of spans) { s.w = (s.a1 - s.a0) * s.lanes.length; spanW += s.w; }
  const pickSpan = () => { let t = rnd() * spanW; for (const s of spans) { t -= s.w; if (t <= 0) return s; } return spans[0]; };
  const cb = (w, h, d, x, y, z, v) => paint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), [v, v, v]);
  const carG = mergeGeometries([cb(1.9, 0.72, 4.4, 0, 0.7, 0, 1), cb(1.66, 0.6, 2.3, 0, 1.34, -0.25, 0.22), cb(2.0, 0.62, 0.7, 0, 0.31, 1.4, 0.06), cb(2.0, 0.62, 0.7, 0, 0.31, -1.4, 0.06)]);
  const NC = 820;
  const carMesh = new THREE.InstancedMesh(carG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.3, metalness: 0.5, vertexColors: true, flatShading: true }), NC);
  carMesh.castShadow = true; carMesh.receiveShadow = true; carMesh.frustumCulled = false;
  const lg = (x, z, c) => { const g = new THREE.PlaneGeometry(0.38, 0.17); if (z < 0) g.rotateY(Math.PI); return paint(g.translate(x, 0.74, z), c); };
  const lightMesh = new THREE.InstancedMesh(mergeGeometries([lg(-0.6, 2.21, [1, 0.95, 0.8]), lg(0.6, 2.21, [1, 0.95, 0.8]), lg(-0.62, -2.21, [1, 0.08, 0.04]), lg(0.62, -2.21, [1, 0.08, 0.04])]), glowMat, NC);
  lightMesh.frustumCulled = false;
  const carPal = [0xd8d8d8, 0x1a1a1a, 0x8a1c1c, 0x1d3f7a, 0x5b6066, 0xffffff, 0x2f5d3a, 0x24353f, 0x7a3c10];
  const cars = [];
  for (let k = 0; k < NC; k++) {
    const sp = pickSpan();
    cars.push({ sp, lane: pick(sp.lanes), s: rr(sp.a0, sp.a1), v: sp.axis ? rr(9, 18) : rr(6, 13), ph: rnd() * 7, x: 0, z: 0, vx: 0, vz: 0 });
    col.set(rnd() < 0.42 ? 0xf2c230 : pick(carPal)); carMesh.setColorAt(k, col);   // plenty of yellow cabs
  }
  scene.add(carMesh, lightMesh);
  let simT = 0, carFr = 0;
  function updateCars(dt, px, pz) {
    simT += dt; carFr = (carFr + 1) & 3;
    for (let k = 0; k < NC; k++) {
      const c = cars[k];
      const far = Math.abs(c.x - px) + Math.abs(c.z - pz) > 520;
      if (far && (k & 3) !== carFr) continue;                                       // distant traffic updates at quarter rate
      const sp = c.sp, d = far ? dt * 4 : dt;
      c.s += sp.dir * c.v * d;
      if (c.s > sp.a1) c.s = sp.a0 + (c.s - sp.a1); else if (c.s < sp.a0) c.s = sp.a1 - (sp.a0 - c.s);
      const e = Math.min(c.s - sp.a0, sp.a1 - c.s), sc = clampN(e / 7, 0.001, 1);   // ease in/out where a road ends
      if (sp.axis) { c.x = sp.line + c.lane; c.z = c.s; c.vx = 0; c.vz = sp.dir * c.v; dm.rotation.set(0, sp.dir > 0 ? 0 : Math.PI, 0); }
      else { c.x = c.s; c.z = sp.line + c.lane; c.vx = sp.dir * c.v; c.vz = 0; dm.rotation.set(0, sp.dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0); }
      dm.position.set(c.x, 0.02 * Math.sin(simT * 6.5 + c.ph), c.z); dm.scale.set(sc, sc, sc); dm.updateMatrix();
      carMesh.setMatrixAt(k, dm.matrix); lightMesh.setMatrixAt(k, dm.matrix);
    }
    carMesh.instanceMatrix.needsUpdate = true; lightMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- pedestrians: blocky walkers streamed around the player
  const pb = (w, h, d, rot, x, y, z) => { const g = new THREE.BoxGeometry(w, h, d); g.translate(0, -h / 2, 0); g.rotateX(rot); g.translate(x, y, z); return g; };
  const pedBodyG = mergeGeometries([new THREE.BoxGeometry(0.44, 0.62, 0.25).translate(0, 1.13, 0), pb(0.16, 0.82, 0.18, 0.38, -0.11, 0.84, 0), pb(0.16, 0.82, 0.18, -0.38, 0.11, 0.84, 0), pb(0.12, 0.62, 0.14, -0.42, -0.29, 1.42, 0), pb(0.12, 0.62, 0.14, 0.42, 0.29, 1.42, 0)]);
  const pedHeadG = new THREE.BoxGeometry(0.25, 0.27, 0.25).translate(0, 1.6, 0);
  const NP = 1000, CRX = 1, CRZ = 2;
  const pedBody = new THREE.InstancedMesh(pedBodyG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, flatShading: true }), NP);
  const pedHead = new THREE.InstancedMesh(pedHeadG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, flatShading: true }), NP);
  pedBody.frustumCulled = pedHead.frustumCulled = false;
  const clothes = [0x37474f, 0x6d4c41, 0x90a4ae, 0xad3a3a, 0x3c6e47, 0x2c3e70, 0xc9b458, 0x8e6fa8, 0x263238, 0xbfb49a, 0xe8e4da, 0x1b1b1b];
  const skins = [0xf1c9a5, 0xd9a066, 0x9c6b43, 0x6e4a2f, 0xffdbb5];
  const peds = [];
  const walkable = (i, j) => cellOK(i, j) && !inPark(i, j);
  function ringXZ(p, s, out) {
    let u = s % p.per; if (u < 0) u += p.per;
    if (u < p.w) { out.x = p.x0 + u; out.z = p.z0; out.a = Math.PI / 2; }
    else if (u < p.w + p.d) { out.x = p.x0 + p.w; out.z = p.z0 + (u - p.w); out.a = 0; }
    else if (u < 2 * p.w + p.d) { out.x = p.x0 + p.w - (u - p.w - p.d); out.z = p.z0 + p.d; out.a = -Math.PI / 2; }
    else { out.x = p.x0; out.z = p.z0 + p.d - (u - 2 * p.w - p.d); out.a = Math.PI; }
    return out;
  }
  const rp = { x: 0, z: 0, a: 0 };
  function placePed(p, pi, pj, initial, px, pz) {
    for (let t = 0; t < 14; t++) {
      const ix = pi + ((Math.random() * (2 * CRX + 1)) | 0) - CRX, iz = pj + ((Math.random() * (2 * CRZ + 1)) | 0) - CRZ;
      if (!walkable(ix, iz)) continue;
      const bx = -HALFX + ix * BX, bz = -HALFZ + iz * BZ;
      const x0 = bx + AVE / 2 + 0.9 + Math.random() * 3.0, z0 = bz + ST / 2 + 0.9 + Math.random() * 3.0;
      const w = bx + BX - AVE / 2 - 0.9 - Math.random() * 3.0 - x0, d = bz + BZ - ST / 2 - 0.9 - Math.random() * 3.0 - z0;
      const cand = { x0, z0, w, d, per: 2 * (w + d) }, s0 = Math.random() * cand.per;
      ringXZ(cand, s0, rp);
      if (!initial && (rp.x - px) ** 2 + (rp.z - pz) ** 2 < 80 * 80) continue;      // never pop in near the player
      p.ix = ix; p.iz = iz; p.x0 = x0; p.z0 = z0; p.w = w; p.d = d; p.per = cand.per; p.s = s0;
      const prev = peds[p.k - 1];
      if (prev && prev.ix === ix && prev.iz === iz && Math.random() < 0.28) { // join the previous person: a small standing group
        p.stand = true; p.v = 0; p.s = prev.s + (Math.random() - 0.5) * 2.2; p.x0 = prev.x0 + (Math.random() - 0.5) * 1.2; p.z0 = prev.z0 + (Math.random() - 0.5) * 1.2; p.w = prev.w; p.d = prev.d; p.per = prev.per;
        if (!prev.stand) { prev.stand = true; prev.v = 0; }
      } else { p.stand = Math.random() < 0.06; p.v = p.stand ? 0 : 0.8 + Math.random() * 1.5; }
      p.dir = Math.random() < 0.5 ? 1 : -1;
      return true;
    }
    return false;
  }
  for (let k = 0; k < NP; k++) {
    const p = { k, ph: rnd() * 7, x: 0, z: 0 }; peds.push(p); placePed(p, 4, 12, true, 0, 0);
    col.set(pick(clothes)); pedBody.setColorAt(k, col); col.set(pick(skins)); pedHead.setColorAt(k, col);
  }
  scene.add(pedBody, pedHead);
  let pedFr = 0, lastPi = 4, lastPj = 12, teleFr = 0;
  function updatePeds(dt, px, pz) {
    pedFr ^= 1; const dt2 = dt * 2;
    const pi = Math.floor((px + HALFX) / BX), pj = Math.floor((pz + HALFZ) / BZ);
    if (Math.max(Math.abs(pi - lastPi), Math.abs(pj - lastPj)) > 1) teleFr = 2;   // teleport/respawn: refill right around the player
    lastPi = pi; lastPj = pj;
    const fillNow = teleFr > 0; if (fillNow) teleFr--;
    for (let k = 0; k < NP; k++) {
      if ((k & 1) !== pedFr) continue;
      const p = peds[k];
      if (Math.abs(p.ix - pi) > CRX || Math.abs(p.iz - pj) > CRZ) placePed(p, pi, pj, fillNow, px, pz);
      p.s += p.dir * p.v * dt2; p.ph += (p.stand ? 1.1 : p.v * 4.6) * dt2;
      ringXZ(p, p.s, rp);
      const ang = p.dir < 0 ? rp.a + Math.PI : rp.a;
      p.x = rp.x; p.z = rp.z;
      dm.position.set(rp.x, SH + Math.abs(Math.sin(p.ph)) * (p.stand ? 0.008 : 0.04), rp.z);
      dm.rotation.set(0.03 * Math.sin(p.ph * 2) * (p.stand ? 0.4 : 1), ang + (p.stand ? 0.12 : 0.06) * Math.sin(p.ph * (p.stand ? 0.5 : 1)), 0.04 * Math.sin(p.ph));
      dm.scale.set(1, 1, 1); dm.updateMatrix();
      pedBody.setMatrixAt(k, dm.matrix); pedHead.setMatrixAt(k, dm.matrix);
    }
    pedBody.instanceMatrix.needsUpdate = true; pedHead.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- animated billboards (invented brands)
  const BRANDS = [
    ['KUMO', 'SPARKLING SODA', '#ff3b6b', '#2a0a14'], ['NOVA TEK', 'THINK FASTER', '#2ef2ff', '#02141a'], ['SKYLINE AIR', 'FLY THE GRID', '#ffd21f', '#1a1402'],
    ['GLOW NOODLE', 'OPEN ALL NIGHT', '#7dff6b', '#06180a'], ['THREAD', 'ENERGY DRINK', '#ff8a1a', '#190d02'], ['PIXEL OPTICS', 'SEE SHARP', '#c08aff', '#120a1c'],
    ['HARBOR FM', '101.5 ALL DAY', '#ffffff', '#0b1a33'], ['BOROUGH BAGEL', 'HOT AT 5 AM', '#ffcf7a', '#2a1707'],
  ];
  const TICKER = 'SKY CITY NEWS  •  WEB-RUNNER SPOTTED IN MIDTOWN  •  CLEAR SKIES ALL WEEK  •  TRAFFIC SLOW ON 7TH AVE  •  ';
  function drawBB(g, bi, t) {
    const W = 512, H = 256, B = BRANDS[bi % BRANDS.length];
    g.fillStyle = B[3]; g.fillRect(0, 0, W, H);
    const off = ((t * 50) % (W * 2)) - W, gr = g.createLinearGradient(off, 0, off + W * 0.6, H);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
    g.textAlign = 'center'; g.fillStyle = B[2]; g.font = '900 72px Arial';
    const pulse = 1 + 0.05 * Math.sin(t * 2.2 + bi * 2);
    g.save(); g.translate(W / 2, H * 0.46); g.scale(pulse, pulse); g.fillText(B[0], 0, 0, W - 30); g.restore();
    g.fillStyle = '#e8e8e8'; g.font = '600 30px Arial'; g.fillText(B[1], W / 2, H * 0.7);
    g.fillStyle = B[2]; g.fillRect(0, H - 40, W, 2);
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
  if (frameG.length) scene.add(new THREE.Mesh(mergeGeometries(frameG), new THREE.MeshStandardMaterial({ color: 0x15171a, metalness: 0.5, roughness: 0.6 })));

  // ---------------------------------------------------------------- per-frame + quality hooks
  const spawn = { x: -HALFX + 4.5 * BX, z: -HALFZ + 11.5 * BZ };
  updateCars(0, 0, 0); updatePeds(0, spawn.x, spawn.z); updatePeds(0, spawn.x, spawn.z);
  function setDensity(f, treeShadows) {
    pedBody.count = pedHead.count = Math.max(1, Math.round(NP * f));
    const tf = f >= 1 ? 1 : f > 0.6 ? 0.8 : 0.55;
    crowns.count = trunks.count = Math.max(1, Math.round(NT * tf));
    crowns.castShadow = trunks.castShadow = treeShadows;
  }
  function update(dt, time, px, pz) {
    updateCars(dt, px, pz); updatePeds(dt, px, pz);
    swayU.value = time;
    waterN.offset.set(time * 0.006, time * 0.0045);
    clouds.position.x = time * 2.2;
    for (let i = 0; i < NB; i++) {
      const b = bbSets[i], fr = Math.floor(time * 7 + i * 1.7);
      if (fr !== b.frame) { b.frame = fr; drawBB(b.g, b.brand + Math.floor(time / 7 + i * 0.25), time); b.tex.needsUpdate = true; }
    }
  }
  return { facadeMats: [...facadeMats, shopMat], update, setDensity, groundAt, zoneAt, lampMat, glowMat, cloudMat, bbMats, cars, NC, peds, NP, spawn, stats: { boxes: boxes.length, trees: NT, lamps: lamps.length, boards: bbSpots.length, spans: spans.length } };
}
