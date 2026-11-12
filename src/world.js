// ============================================================================
//  SKYTHREAD — world generation: city, textures, sky, lights, traffic
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const BLOCK = 64, ROAD = 18, WALK = 4;
export const N = 13;
export const HALF = (N * BLOCK) / 2;
export const BORDER = 30;

let seed = 20261102;
export function rnd() { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
export const rr = (a, b) => a + (b - a) * rnd();
export const pick = (a) => a[(rnd() * a.length) | 0];

// ---------------------------------------------------------------- textures
function mk(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function grain(ctx, w, h, amt) { const id = ctx.getImageData(0, 0, w, h), d = id.data; for (let i = 0; i < d.length; i += 4) { const n = (rnd() - 0.5) * amt; d[i] += n; d[i + 1] += n; d[i + 2] += n; } ctx.putImageData(id, 0, 0); }
function shade(hex, v) { const c = new THREE.Color(hex); c.multiplyScalar(1 + v * 0.3); return '#' + c.getHexString(); }
let ANISO = 8;
function tex(cv, srgb = true) { const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANISO; return t; }

function brickPattern(c, S) {
  for (let y = 0; y < S; y += 12) {
    c.fillStyle = 'rgba(40,20,15,0.35)'; c.fillRect(0, y, S, 2);
    const off = ((y / 12) % 2) * 14;
    for (let x = off; x < S; x += 28) { c.fillRect(x, y, 2, 12); }
    for (let x = off; x < S; x += 28) { c.fillStyle = `rgba(${rnd() < 0.5 ? '255,220,200' : '30,10,5'},${rr(0.02, 0.12)})`; c.fillRect(x + 2, y + 2, 26, 10); }
  }
}
function piers(c, S, cs) { for (let x = 0; x < S; x += cs) { c.fillStyle = 'rgba(80,60,30,0.18)'; c.fillRect(x - 12, 0, 24, S); c.fillStyle = 'rgba(255,245,220,0.15)'; c.fillRect(x - 12, 0, 6, S); } }

export const STYLES = [
  { name: 'glass', wall: '#2b3138', wallRough: '#8a8a8a', frame: '#3a424c', win: { l: 3, r: 3, t: 4, b: 10 }, glassTop: '#9cc0e0', glassBot: '#3a5878', glassVar: 0.35, glassRough: '#161616', lit: 0.1, litCols: ['#ffd9a0', '#fff1d6', '#cfe3ff'], mullion: true, metal: 0.8, grain: 6 },
  { name: 'brick', wall: '#8a4631', wallRough: '#f2f2f2', frame: '#e3dccb', win: { l: 16, r: 16, t: 12, b: 20 }, glassTop: '#3e5060', glassBot: '#1b232b', glassVar: 0.3, glassRough: '#333333', lit: 0.18, litCols: ['#ffcf85', '#ffe2b0'], sill: '#d8d0bd', pattern: brickPattern, metal: 0.0, grain: 22 },
  { name: 'concrete', wall: '#c2b9a8', wallRough: '#e0e0e0', win: { l: 2, r: 2, t: 14, b: 18 }, glassTop: '#62778a', glassBot: '#2a3743', glassVar: 0.2, glassRough: '#262626', lit: 0.12, litCols: ['#fff3d8', '#ffe0a8'], bands: '#a39a8a', bandH: 6, metal: 0.08, grain: 16 },
  { name: 'dark', wall: '#16191d', wallRough: '#666666', win: { l: 2, r: 2, t: 2, b: 6 }, glassTop: '#466373', glassBot: '#141d24', glassVar: 0.25, glassRough: '#121212', lit: 0.09, litCols: ['#d8ecff', '#fff6e0'], mullion: true, frame: '#24292f', metal: 0.85, grain: 4 },
  { name: 'deco', wall: '#cdb995', wallRough: '#e8e8e8', win: { l: 20, r: 20, t: 8, b: 14 }, glassTop: '#4c6074', glassBot: '#1e2832', glassVar: 0.3, glassRough: '#2c2c2c', lit: 0.15, litCols: ['#ffd18c'], pattern: piers, sill: '#b9a57f', metal: 0.03, grain: 14 },
];

function makeFacade(o) {
  const S = 1024, C = 8, cs = S / C, K = 2; // 2x the old pixel density
  const [cc, c] = mk(S, S), [rc, r] = mk(S, S), [ec, e] = mk(S, S);
  c.fillStyle = o.wall; c.fillRect(0, 0, S, S);
  r.fillStyle = o.wallRough; r.fillRect(0, 0, S, S);
  e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
  if (o.pattern) o.pattern(c, S, cs);
  for (let fy = 0; fy < C; fy++) for (let fx = 0; fx < C; fx++) {
    const x = fx * cs, y = fy * cs, w = o.win;
    const wx = x + w.l * K, wy = y + w.t * K, ww = cs - (w.l + w.r) * K, wh = cs - (w.t + w.b) * K;
    if (o.frame) { c.fillStyle = o.frame; c.fillRect(wx - 4, wy - 4, ww + 8, wh + 8); r.fillStyle = '#777'; r.fillRect(wx - 4, wy - 4, ww + 8, wh + 8); }
    const v = rr(-1, 1) * o.glassVar;
    const g = c.createLinearGradient(wx, wy, wx + ww * 0.3, wy + wh);
    g.addColorStop(0, shade(o.glassTop, v)); g.addColorStop(1, shade(o.glassBot, v));
    c.fillStyle = g; c.fillRect(wx, wy, ww, wh);
    // glass sheen: a diagonal pale streak, like sky reflecting off the pane
    if (rnd() < 0.55) { c.save(); c.globalAlpha = rr(0.05, 0.16); c.fillStyle = '#eaf2ff'; c.beginPath(); const sx = wx + ww * rr(-0.2, 0.5); c.moveTo(sx, wy + wh); c.lineTo(sx + ww * 0.45, wy); c.lineTo(sx + ww * 0.8, wy); c.lineTo(sx + ww * 0.35, wy + wh); c.fill(); c.restore(); }
    r.fillStyle = o.glassRough; r.fillRect(wx, wy, ww, wh);
    if (o.mullion) { c.fillStyle = o.frame || o.wall; c.fillRect(wx + ww / 2 - 2, wy, 4, wh); c.fillRect(wx, wy + wh / 2 - 1, ww, 2); }
    if (rnd() < o.lit) {
      e.globalAlpha = rr(0.45, 1); e.fillStyle = pick(o.litCols); e.fillRect(wx + 1, wy + 1, ww - 2, wh - 2); e.globalAlpha = 1;
      if (rnd() < 0.45) { e.fillStyle = '#000'; e.fillRect(wx, wy, ww, wh * rr(0.2, 0.6)); }
    }
    if (o.sill) { c.fillStyle = o.sill; c.fillRect(wx - 8, wy + wh + 4, ww + 16, 8); c.fillStyle = 'rgba(0,0,0,0.25)'; c.fillRect(wx - 8, wy + wh + 12, ww + 16, 3); }
  }
  if (o.bands) { c.fillStyle = o.bands; for (let fy = 0; fy < C; fy++) c.fillRect(0, fy * cs + cs - o.bandH * K, S, o.bandH * K); }
  grain(c, S, S, o.grain || 10);
  return { map: tex(cc), rough: tex(rc, false), emi: tex(ec) };
}

function makeRoofTex() {
  const S = 256, [cv, c] = mk(S, S);
  c.fillStyle = '#5d5c5a'; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 3000; i++) { c.fillStyle = `rgba(${rnd() < 0.5 ? '255,255,255' : '0,0,0'},${rr(0.03, 0.12)})`; c.fillRect(rnd() * S, rnd() * S, rr(1, 3), rr(1, 3)); }
  c.strokeStyle = 'rgba(20,20,20,0.5)'; c.lineWidth = 2; c.strokeRect(1, 1, S - 2, S - 2);
  grain(c, S, S, 16); return tex(cv);
}
function makeWalkTex() {
  const S = 256, [cv, c] = mk(S, S);
  c.fillStyle = '#a19e97'; c.fillRect(0, 0, S, S);
  c.fillStyle = 'rgba(60,58,55,0.55)'; c.fillRect(0, 0, S, 2); c.fillRect(0, 0, 2, S); c.fillRect(0, S / 2, S, 1); c.fillRect(S / 2, 0, 1, S);
  grain(c, S, S, 20); return tex(cv);
}
function makeGrassTex() {
  const S = 256, [cv, c] = mk(S, S);
  c.fillStyle = '#4a6a30'; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 6000; i++) { c.fillStyle = `rgba(${rnd() < 0.5 ? '120,160,60' : '30,50,20'},${rr(0.1, 0.4)})`; c.fillRect(rnd() * S, rnd() * S, 1, rr(1, 4)); }
  grain(c, S, S, 14); return tex(cv);
}
function makeGroundTex() {
  const S = 1024, [cv, c] = mk(S, S), px = S / BLOCK, r = (ROAD / 2) * px;
  c.fillStyle = '#38393c'; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(0,0,0,${rr(0.04, 0.12)})`; c.beginPath(); c.ellipse(rnd() * S, rnd() * S, rr(4, 30), rr(2, 10), rnd() * 3, 0, 7); c.fill(); }
  // double yellow centre lines on tile edges (road centre = block boundary)
  c.fillStyle = '#d6b03a';
  const a = 0.15 * px, b = 0.3 * px;
  for (const [x0, w] of [[a, b - a], [S - b, b - a]]) { c.fillRect(x0, r, w, S - 2 * r); c.fillRect(r, x0, S - 2 * r, w); }
  // white lane dashes
  c.fillStyle = 'rgba(235,235,230,0.85)';
  const lane = 4.2 * px;
  for (let t = r + 10; t < S - r - 30; t += 9 * px) {
    for (const o of [lane, S - lane]) { c.fillRect(o - 2, t, 4, 3.5 * px); c.fillRect(t, o - 2, 3.5 * px, 4); }
  }
  // crosswalks
  c.fillStyle = 'rgba(240,240,235,0.9)';
  const cw0 = r + 0.6 * px, cwl = 3 * px;
  for (let s = 0.5 * px; s < r; s += 1.4 * px) {
    for (const yy of [cw0, S - cw0 - cwl]) { c.fillRect(s, yy, 0.7 * px, cwl); c.fillRect(S - s - 0.7 * px, yy, 0.7 * px, cwl); }
    for (const xx of [cw0, S - cw0 - cwl]) { c.fillRect(xx, s, cwl, 0.7 * px); c.fillRect(xx, S - s - 0.7 * px, cwl, 0.7 * px); }
  }
  grain(c, S, S, 22);
  const t = tex(cv); t.repeat.set(N, N); return t;
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

// ---------------------------------------------------------------- geometry builder
class GB {
  constructor() { this.p = []; this.n = []; this.u = []; this.i = []; }
  quad(a, b, c, d, n, ua, ub, uc, ud) {
    const k = this.p.length / 3;
    this.p.push(...a, ...b, ...c, ...d);
    for (let j = 0; j < 4; j++) this.n.push(...n);
    this.u.push(...ua, ...ub, ...uc, ...ud);
    this.i.push(k, k + 1, k + 2, k, k + 2, k + 3);
  }
  wall(ax, az, bx, bz, y0, y1, tile, uoff) {
    const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz);
    const n = [-dz / len, 0, dx / len];
    const u0 = uoff / tile, u1 = (uoff + len) / tile, v0 = y0 / tile, v1 = y1 / tile;
    this.quad([ax, y0, az], [bx, y0, bz], [bx, y1, bz], [ax, y1, az], n, [u0, v0], [u1, v0], [u1, v1], [u0, v1]);
  }
  walls(x0, x1, z0, z1, y0, y1, tile) {
    this.wall(x1, z1, x1, z0, y0, y1, tile, z1);
    this.wall(x0, z0, x0, z1, y0, y1, tile, z0);
    this.wall(x0, z1, x1, z1, y0, y1, tile, x0);
    this.wall(x1, z0, x0, z0, y0, y1, tile, x1);
  }
  top(x0, x1, z0, z1, y, tile) { this.quad([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [0, 1, 0], [x0 / tile, z0 / tile], [x0 / tile, z1 / tile], [x1 / tile, z1 / tile], [x1 / tile, z0 / tile]); }
  bottom(x0, x1, z0, z1, y) { this.quad([x0, y, z0], [x1, y, z0], [x1, y, z1], [x0, y, z1], [0, -1, 0], [0, 0], [1, 0], [1, 1], [0, 1]); }
  geo() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.u, 2));
    g.setIndex(this.i); g.computeBoundingSphere(); return g;
  }
}

// ---------------------------------------------------------------- collision grid
export const boxes = [];
const CELL = 32, GOFF = HALF + 200;
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

// ---------------------------------------------------------------- city
export function buildWorld(scene, renderer) {
  ANISO = renderer.capabilities.getMaxAnisotropy();
  const facadeMats = STYLES.map((s) => {
    const t = makeFacade(s);
    return new THREE.MeshStandardMaterial({ map: t.map, roughnessMap: t.rough, roughness: 1, metalness: s.metal, emissiveMap: t.emi, emissive: 0xffffff, emissiveIntensity: 0.5 });
  });
  const roofMat = new THREE.MeshStandardMaterial({ map: makeRoofTex(), roughness: 0.95 });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0xc9c2b4, roughness: 0.8 });
  const walkMat = new THREE.MeshStandardMaterial({ map: makeWalkTex(), roughness: 0.9 });
  const grassMat = new THREE.MeshStandardMaterial({ map: makeGrassTex(), roughness: 1 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0x8a8d90, roughness: 0.5, metalness: 0.7 });
  const woodMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f, roughness: 0.9 });

  const fb = STYLES.map(() => new GB());
  const roofB = new GB(), trimB = new GB(), walkB = new GB(), grassB = new GB(), farB = new GB();
  const metalGeos = [], woodGeos = [];
  const trees = [];
  const TILE = 32;

  function building(style, x0, x1, z0, z1, y0, y1, isTop) {
    fb[style].walls(x0, x1, z0, z1, y0, y1, TILE);
    roofB.top(x0, x1, z0, z1, y1, 8);
    addBox(x0, x1, y0, y1, z0, z1);
    // cornice ledge
    const e = 0.5, cy0 = y1 - 1.5, cy1 = y1 - 0.5;
    trimB.walls(x0 - e, x1 + e, z0 - e, z1 + e, cy0, cy1, 4);
    trimB.top(x0 - e, x1 + e, z0 - e, z1 + e, cy1, 4);
    trimB.bottom(x0 - e, x1 + e, z0 - e, z1 + e, cy0);
    // parapet lip
    if (isTop) {
      const p = 0.35, h = 1.1;
      trimB.walls(x0, x1, z0, z1, y1, y1 + h, 4); trimB.top(x0, x1, z0, z0 + p, y1 + h, 4); trimB.top(x0, x1, z1 - p, z1, y1 + h, 4); trimB.top(x0, x0 + p, z0, z1, y1 + h, 4); trimB.top(x1 - p, x1, z0, z1, y1 + h, 4);
      const a0 = x0 + p, a1 = x1 - p, b0 = z0 + p, b1 = z1 - p; // inner faces, facing the roof
      trimB.wall(a1, b0, a1, b1, y1, y1 + h, 4, 0); trimB.wall(a0, b1, a0, b0, y1, y1 + h, 4, 0);
      trimB.wall(a1, b1, a0, b1, y1, y1 + h, 4, 0); trimB.wall(a0, b0, a1, b0, y1, y1 + h, 4, 0);
    }
  }
  function roofDetails(x0, x1, z0, z1, y, h, style) {
    const w = x1 - x0, d = z1 - z0;
    if (w < 10 || d < 10) return;
    const n = 1 + ((rnd() * 4) | 0);
    for (let i = 0; i < n; i++) {
      const bw = rr(2, 4.5), bd = rr(2, 4.5), bh = rr(1.2, 2.6);
      const g = new THREE.BoxGeometry(bw, bh, bd); g.translate(rr(x0 + 3, x1 - 3), y + bh / 2, rr(z0 + 3, z1 - 3)); metalGeos.push(g);
    }
    if (h < 120 && style !== 0 && style !== 3 && rnd() < 0.45) {
      const cx = rr(x0 + 4, x1 - 4), cz = rr(z0 + 4, z1 - 4), legH = 3;
      for (const [ox, oz] of [[-1.3, -1.3], [1.3, -1.3], [-1.3, 1.3], [1.3, 1.3]]) { const g = new THREE.CylinderGeometry(0.12, 0.12, legH, 5); g.translate(cx + ox, y + legH / 2, cz + oz); metalGeos.push(g); }
      const tank = new THREE.CylinderGeometry(2.1, 2.1, 4.2, 14); tank.translate(cx, y + legH + 2.1, cz); woodGeos.push(tank);
      const cone = new THREE.ConeGeometry(2.3, 1.6, 14); cone.translate(cx, y + legH + 4.2 + 0.8, cz); woodGeos.push(cone);
      addBox(cx - 2.1, cx + 2.1, y, y + legH + 4.2, cz - 2.1, cz + 2.1);
    }
    if (h > 150 && rnd() < 0.6) { const ah = rr(10, 28); const g = new THREE.CylinderGeometry(0.25, 0.5, ah, 6); g.translate((x0 + x1) / 2, y + ah / 2, (z0 + z1) / 2); metalGeos.push(g); }
  }
  function tower(style, x0, x1, z0, z1, h) {
    let tiers = [[0, h]];
    if (h > 70 && rnd() < 0.6) { const h1 = Math.round((h * rr(0.5, 0.75)) / 4) * 4; tiers = [[0, h1], [h1, h]]; if (h > 150 && rnd() < 0.6) { const h2 = Math.round((h * rr(0.82, 0.9)) / 4) * 4; tiers = [[0, h1], [h1, h2], [h2, h]]; } }
    let ax0 = x0, ax1 = x1, az0 = z0, az1 = z1;
    tiers.forEach(([y0, y1], i) => {
      if (i > 0) { const s = rr(2.5, 6); if (ax1 - ax0 - 2 * s > 9 && az1 - az0 - 2 * s > 9) { ax0 += s; ax1 -= s; az0 += s; az1 -= s; } }
      building(style, ax0, ax1, az0, az1, y0, y1, i === tiers.length - 1);
    });
    roofDetails(ax0, ax1, az0, az1, h, h, style);
  }

  const parks = new Set(['8,3', '8,4', '9,3', '9,4']);
  const C0 = (N - 1) / 2;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const bx = -HALF + i * BLOCK, bz = -HALF + j * BLOCK;
    const x0 = bx + ROAD / 2, x1 = bx + BLOCK - ROAD / 2, z0 = bz + ROAD / 2, z1 = bz + BLOCK - ROAD / 2;
    const park = parks.has(i + ',' + j);
    const SH = 0.25;
    (park ? grassB : walkB).top(x0, x1, z0, z1, SH, park ? 8 : 4);
    walkB.walls(x0, x1, z0, z1, 0, SH, 4);
    addBox(x0, x1, -1, SH, z0, z1, true);
    if (park) {
      for (let t = 0; t < 34; t++) trees.push([rr(x0 + 2, x1 - 2), SH, rr(z0 + 2, z1 - 2), rr(0.9, 1.5)]);
      continue;
    }
    // sidewalk trees
    if (rnd() < 0.45) for (let s = x0 + 5; s < x1 - 3; s += 11) { trees.push([s, SH, z0 + 1.8, rr(0.7, 1)]); trees.push([s, SH, z1 - 1.8, rr(0.7, 1)]); }
    const cx = bx + BLOCK / 2, cz = bz + BLOCK / 2;
    const ax0 = x0 + WALK, ax1 = x1 - WALK, az0 = z0 + WALK, az1 = z1 - WALK;
    if (i === C0 && j === C0) { // hero tower
      const s = 'dark'; const st = STYLES.findIndex((q) => q.name === s);
      building(st, ax0, ax1, az0, az1, 0, 196, false);
      building(st, ax0 + 4, ax1 - 4, az0 + 4, az1 - 4, 196, 272, false);
      building(st, ax0 + 8, ax1 - 8, az0 + 8, az1 - 8, 272, 324, false);
      building(st, ax0 + 12, ax1 - 12, az0 + 12, az1 - 12, 324, 348, true);
      const sp = new THREE.CylinderGeometry(0.25, 1.4, 60, 8); sp.translate(cx, 348 + 30, cz); metalGeos.push(sp);
      continue;
    }
    const d = Math.hypot(cx, cz);
    const base = 26 + 150 * Math.exp(-((d / 290) ** 2));
    const lots = [];
    const r = rnd(), gap = 2;
    if (r < 0.3) lots.push([ax0, ax1, az0, az1]);
    else if (r < 0.62) {
      const t = rr(0.38, 0.62);
      if (rnd() < 0.5) { const m = ax0 + (ax1 - ax0) * t; lots.push([ax0, m - gap / 2, az0, az1], [m + gap / 2, ax1, az0, az1]); }
      else { const m = az0 + (az1 - az0) * t; lots.push([ax0, ax1, az0, m - gap / 2], [ax0, ax1, m + gap / 2, az1]); }
    } else {
      const mx = ax0 + (ax1 - ax0) * rr(0.4, 0.6), mz = az0 + (az1 - az0) * rr(0.4, 0.6);
      lots.push([ax0, mx - gap / 2, az0, mz - gap / 2], [mx + gap / 2, ax1, az0, mz - gap / 2], [ax0, mx - gap / 2, mz + gap / 2, az1], [mx + gap / 2, ax1, mz + gap / 2, az1]);
    }
    for (const L of lots) {
      let h = base * rr(0.45, 1.35); if (rnd() < 0.14) h *= 0.4;
      h = Math.max(12, Math.round(h / 4) * 4);
      const tall = h > 110;
      const st = tall ? pick([0, 0, 3, 4, 3]) : pick([1, 1, 2, 4, 2, 0, 1]);
      tower(st, L[0], L[1], L[2], L[3], h);
    }
  }

  // far skyline across the river
  for (let k = 0; k < 260; k++) {
    const a = rnd() * Math.PI * 2, dist = rr(1050, 1900);
    const cx = Math.cos(a) * dist, cz = Math.sin(a) * dist, w = rr(20, 60), dd = rr(20, 60), h = rr(12, 120) * (dist < 1300 ? 1 : 0.7);
    farB.walls(cx - w / 2, cx + w / 2, cz - dd / 2, cz + dd / 2, -3, h, 32); farB.top(cx - w / 2, cx + w / 2, cz - dd / 2, cz + dd / 2, h, 8);
  }

  const meshes = [];
  const addMesh = (geo, mat, cast = true, recv = true) => { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = recv; scene.add(m); meshes.push(m); return m; };
  fb.forEach((b, i) => { if (b.p.length) addMesh(b.geo(), facadeMats[i]); });
  addMesh(roofB.geo(), roofMat);
  addMesh(trimB.geo(), trimMat);
  addMesh(walkB.geo(), walkMat, false, true);
  addMesh(grassB.geo(), grassMat, false, true);
  addMesh(mergeGeometries(metalGeos), metalMat);
  addMesh(mergeGeometries(woodGeos), woodMat);
  addMesh(farB.geo(), facadeMats[2], false, false);

  // ground / roads
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF, 2 * HALF), new THREE.MeshStandardMaterial({ map: makeGroundTex(), roughness: 0.92 }));
  ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
  const promenadeMat = new THREE.MeshStandardMaterial({ map: makeWalkTex(), roughness: 0.9 });
  promenadeMat.map.repeat.set(60, 60);
  const quay = new THREE.Mesh(new THREE.BoxGeometry(2 * (HALF + BORDER), 10, 2 * (HALF + BORDER)), promenadeMat);
  quay.position.y = -5.02; quay.receiveShadow = true; scene.add(quay);
  const wS = 256, [wc, wg] = mk(wS, wS);
  wg.fillStyle = '#8080ff'; wg.fillRect(0, 0, wS, wS);
  for (let i = 0; i < 900; i++) {
    const gx = rnd() * wS, gy = rnd() * wS, rad = rr(4, 16);
    const gr = wg.createRadialGradient(gx, gy, 0, gx, gy, rad);
    const dx = (rnd() - 0.5) * 40, dy = (rnd() - 0.5) * 40;
    gr.addColorStop(0, `rgba(${128 + dx | 0},${128 + dy | 0},255,0.35)`); gr.addColorStop(1, 'rgba(128,128,255,0)');
    wg.fillStyle = gr; wg.fillRect(gx - rad, gy - rad, rad * 2, rad * 2);
  }
  const waterN = tex(wc, false); waterN.repeat.set(220, 220);
  const waterMat = new THREE.MeshStandardMaterial({ color: 0x18303f, roughness: 0.14, metalness: 0.9, normalMap: waterN, normalScale: new THREE.Vector2(0.35, 0.35) });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), waterMat);
  water.rotation.x = -Math.PI / 2; water.position.y = -2.5; scene.add(water);

  // trees (instanced): branching trunk + clustered, wind-swayed canopy
  const tParts = [new THREE.CylinderGeometry(0.15, 0.3, 2.9, 7).translate(0, 1.45, 0)];
  for (const [bx, by, bz, rz, rx] of [[0.45, 2.7, 0.1, 0.65, 0.1], [-0.4, 3.0, -0.15, -0.55, -0.15], [0.05, 3.1, 0.4, 0.1, 0.55]]) {
    const b = new THREE.CylinderGeometry(0.06, 0.13, 1.6, 5); b.translate(0, 0.8, 0); b.rotateZ(rz); b.rotateX(rx); b.translate(bx, by - 0.8, bz); tParts.push(b);
  }
  const trunkG = mergeGeometries(tParts);
  const lobes = [];
  for (const [ox, oy, oz, r] of [[0, 4.7, 0, 1.75], [1.15, 4.1, 0.35, 1.2], [-1.05, 4.25, -0.25, 1.15], [0.35, 5.6, 0.65, 1.05], [-0.45, 5.45, -0.8, 0.95], [0.1, 4.2, 1.15, 1.0]]) {
    const g = new THREE.IcosahedronGeometry(r, 2);
    const pa = g.attributes.position;
    for (let v = 0; v < pa.count; v++) { const m = 1 + (rnd() - 0.5) * 0.3; pa.setXYZ(v, pa.getX(v) * m, pa.getY(v) * m, pa.getZ(v) * m); }
    g.translate(ox, oy, oz); lobes.push(g);
  }
  const crownG = mergeGeometries(lobes); crownG.computeVertexNormals();
  const swayU = { value: 0 };
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 });
  crownMat.onBeforeCompile = (sh) => {
    sh.uniforms.uTime = swayU;
    sh.vertexShader = 'uniform float uTime;\n' + sh.vertexShader.replace('#include <begin_vertex>',
      `#include <begin_vertex>
      float swf = smoothstep(2.6, 6.5, position.y);
      float ph = float(gl_InstanceID) * 1.73;
      transformed.x += (sin(uTime * 1.25 + ph) * 0.16 + sin(uTime * 3.1 + ph * 2.0) * 0.045) * swf;
      transformed.z += (cos(uTime * 1.07 + ph * 1.4) * 0.13 + cos(uTime * 2.7 + ph) * 0.04) * swf;`);
  };
  const trunks = new THREE.InstancedMesh(trunkG, new THREE.MeshStandardMaterial({ color: 0x4b3726, roughness: 1 }), trees.length);
  const crowns = new THREE.InstancedMesh(crownG, crownMat, trees.length);
  const dm = new THREE.Object3D(), col = new THREE.Color();
  trees.forEach(([x, y, z, s], i) => {
    dm.position.set(x, y, z); dm.scale.set(s, s * rr(0.85, 1.2), s); dm.rotation.y = rnd() * 6; dm.updateMatrix();
    trunks.setMatrixAt(i, dm.matrix); crowns.setMatrixAt(i, dm.matrix);
    col.setHSL(rr(0.2, 0.34), rr(0.4, 0.6), rr(0.22, 0.34)); crowns.setColorAt(i, col);
  });
  for (const m of [trunks, crowns]) { m.castShadow = true; m.receiveShadow = true; scene.add(m); }

  // street lamps (instanced poles + glowing heads)
  const lamps = [];
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const bx = -HALF + i * BLOCK, bz = -HALF + j * BLOCK;
    const x0 = bx + ROAD / 2 + 0.8, x1 = bx + BLOCK - ROAD / 2 - 0.8, z0 = bz + ROAD / 2 + 0.8, z1 = bz + BLOCK - ROAD / 2 - 0.8;
    for (const t of [0.15, 0.5, 0.85]) {
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      lamps.push([x, z0, 0], [x, z1, Math.PI], [x0, z, Math.PI / 2], [x1, z, -Math.PI / 2]);
    }
  }
  const poleG = new THREE.CylinderGeometry(0.09, 0.13, 7, 6); poleG.translate(0, 3.75, 0);
  const armG = new THREE.BoxGeometry(0.1, 0.1, 1.6); armG.translate(0, 7.2, -0.75);
  const headG = new THREE.BoxGeometry(0.35, 0.14, 0.7); headG.translate(0, 7.12, -1.45);
  const poles = new THREE.InstancedMesh(mergeGeometries([poleG, armG]), new THREE.MeshStandardMaterial({ color: 0x2b2f33, roughness: 0.5, metalness: 0.7 }), lamps.length);
  const lampMat = new THREE.MeshStandardMaterial({ color: 0x332a1a, emissive: 0xffd9a0, emissiveIntensity: 0.3 });
  const heads = new THREE.InstancedMesh(headG, lampMat, lamps.length);
  lamps.forEach(([x, z, ry], k) => { dm.position.set(x, 0.25, z); dm.rotation.set(0, ry, 0); dm.scale.set(1, 1, 1); dm.updateMatrix(); poles.setMatrixAt(k, dm.matrix); heads.setMatrixAt(k, dm.matrix); });
  poles.castShadow = true; scene.add(poles, heads);

  // traffic
  const carBody = new THREE.BoxGeometry(1.9, 0.75, 4.4); carBody.translate(0, 0.65, 0);
  const carCab = new THREE.BoxGeometry(1.65, 0.6, 2.3); carCab.translate(0, 1.3, -0.25);
  const wheelG0 = new THREE.CylinderGeometry(0.33, 0.33, 0.25, 10); wheelG0.rotateZ(Math.PI / 2);
  const wheels = [];
  for (const [wx, wz] of [[-0.92, 1.45], [0.92, 1.45], [-0.92, -1.45], [0.92, -1.45]]) { const w = wheelG0.clone(); w.translate(wx, 0.33, wz); wheels.push(w); }
  const carG = mergeGeometries([carBody, carCab, ...wheels]);
  const NC = 430;
  const carMesh = new THREE.InstancedMesh(carG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.25, metalness: 0.65 }), NC);
  carMesh.castShadow = true; carMesh.receiveShadow = true;
  const headG2 = mergeGeometries([new THREE.BoxGeometry(0.34, 0.16, 0.08).translate(-0.6, 0.66, 2.22), new THREE.BoxGeometry(0.34, 0.16, 0.08).translate(0.6, 0.66, 2.22)]);
  const tailG2 = mergeGeometries([new THREE.BoxGeometry(0.4, 0.14, 0.08).translate(-0.62, 0.7, -2.22), new THREE.BoxGeometry(0.4, 0.14, 0.08).translate(0.62, 0.7, -2.22)]);
  const headMat = new THREE.MeshStandardMaterial({ color: 0x555544, emissive: 0xfff4cf, emissiveIntensity: 0.4 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x441111, emissive: 0xff2a1a, emissiveIntensity: 0.8 });
  const headMesh = new THREE.InstancedMesh(headG2, headMat, NC);
  const tailMesh = new THREE.InstancedMesh(tailG2, tailMat, NC);
  const carPal = [0xd8d8d8, 0x1a1a1a, 0x8a1c1c, 0x1d3f7a, 0xf2c230, 0x5b6066, 0xffffff, 0x2f5d3a, 0x7a3c10, 0x24353f];
  const cars = [];
  for (let k = 0; k < NC; k++) {
    const dir = rnd() < 0.5 ? 1 : -1;
    cars.push({ axis: rnd() < 0.5 ? 0 : 1, line: -HALF + ((rnd() * (N + 1)) | 0) * BLOCK, lane: 2.3 + (rnd() < 0.5 ? 0 : 3.4), dir, s: rr(-HALF, HALF), v: rr(7, 17), ph: rnd() * 7, x: 0, z: 0 });
    col.set(pick(carPal)); carMesh.setColorAt(k, col);
  }
  scene.add(carMesh, headMesh, tailMesh);
  let simT = 0;
  function updateCars(dt) {
    simT += dt;
    for (let k = 0; k < NC; k++) {
      const c = cars[k]; c.s += c.dir * c.v * dt;
      if (c.s > HALF) c.s -= 2 * HALF; else if (c.s < -HALF) c.s += 2 * HALF;
      const bob = 0.025 * Math.sin(simT * 6.5 + c.ph) + 0.012 * Math.sin(simT * 11 + c.ph * 2);
      if (c.axis === 0) { c.x = c.s; c.z = c.line + c.dir * c.lane; dm.rotation.set(0.008 * Math.sin(simT * 5 + c.ph), c.dir > 0 ? Math.PI / 2 : -Math.PI / 2, 0); }
      else { c.x = c.line - c.dir * c.lane; c.z = c.s; dm.rotation.set(0.008 * Math.sin(simT * 5 + c.ph), c.dir > 0 ? 0 : Math.PI, 0); }
      dm.position.set(c.x, bob, c.z);
      dm.scale.set(1, 1, 1); dm.updateMatrix(); carMesh.setMatrixAt(k, dm.matrix); headMesh.setMatrixAt(k, dm.matrix); tailMesh.setMatrixAt(k, dm.matrix);
    }
    carMesh.instanceMatrix.needsUpdate = true; headMesh.instanceMatrix.needsUpdate = true; tailMesh.instanceMatrix.needsUpdate = true;
  }

  // pedestrians: instanced walkers looping the sidewalks
  const pedBodyG = (() => {
    const torso = new THREE.CapsuleGeometry(0.17, 0.42, 4, 8); torso.translate(0, 1.12, 0);
    const legL = new THREE.CapsuleGeometry(0.07, 0.6, 3, 6); legL.rotateX(0.35); legL.translate(-0.09, 0.42, 0.04);
    const legR = legL.clone(); legR.rotateX(-0.62); legR.translate(0.18, 0.01, -0.1);
    const armL = new THREE.CapsuleGeometry(0.05, 0.52, 3, 6); armL.rotateX(-0.5); armL.translate(-0.26, 1.16, -0.05);
    const armR = armL.clone(); armR.rotateX(0.9); armR.translate(0.52, 0.02, 0.14);
    return mergeGeometries([torso, legL, legR, armL, armR]);
  })();
  const pedHeadG = new THREE.SphereGeometry(0.13, 10, 8); pedHeadG.scale(1, 1.18, 1); pedHeadG.translate(0, 1.62, 0);
  const NP = 340;
  const pedBody = new THREE.InstancedMesh(pedBodyG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9 }), NP);
  const pedHead = new THREE.InstancedMesh(pedHeadG, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8 }), NP);
  pedBody.castShadow = true;
  const clothes = [0x37474f, 0x6d4c41, 0x90a4ae, 0xad3a3a, 0x3c6e47, 0x2c3e70, 0xc9b458, 0x8e6fa8, 0x263238, 0xbfb49a];
  const skins = [0xf1c9a5, 0xd9a066, 0x9c6b43, 0x6e4a2f, 0xffdbb5];
  const peds = [];
  for (let k = 0; k < NP; k++) {
    const bi = (rnd() * N * N) | 0, ix = bi % N, iz = (bi / N) | 0;
    const bx = -HALF + ix * BLOCK, bz = -HALF + iz * BLOCK;
    const x0 = bx + ROAD / 2 + 1.7, x1 = bx + BLOCK - ROAD / 2 - 1.7, z0 = bz + ROAD / 2 + 1.7, z1 = bz + BLOCK - ROAD / 2 - 1.7;
    const w = x1 - x0, d = z1 - z0, per = 2 * (w + d);
    peds.push({ x0, z0, w, d, per, s: rnd() * per, dir: rnd() < 0.5 ? 1 : -1, v: rr(0.9, 2.1), ph: rnd() * 7, x: 0, z: 0 });
    col.set(pick(clothes)); pedBody.setColorAt(k, col);
    col.set(pick(skins)); pedHead.setColorAt(k, col);
  }
  scene.add(pedBody, pedHead);
  function updatePeds(dt) {
    for (let k = 0; k < NP; k++) {
      const p = peds[k]; p.s += p.dir * p.v * dt; p.ph += p.v * dt * 4.6;
      let u = p.s % p.per; if (u < 0) u += p.per;
      let x, z, ang;
      if (u < p.w) { x = p.x0 + u; z = p.z0; ang = Math.PI / 2; }
      else if (u < p.w + p.d) { x = p.x0 + p.w; z = p.z0 + (u - p.w); ang = 0; }
      else if (u < 2 * p.w + p.d) { x = p.x0 + p.w - (u - p.w - p.d); z = p.z0 + p.d; ang = -Math.PI / 2; }
      else { x = p.x0; z = p.z0 + p.d - (u - 2 * p.w - p.d); ang = Math.PI; }
      if (p.dir < 0) ang += Math.PI;
      p.x = x; p.z = z;
      dm.position.set(x, 0.25 + Math.abs(Math.sin(p.ph)) * 0.035, z);
      dm.rotation.set(0.03 * Math.sin(p.ph * 2), ang + 0.06 * Math.sin(p.ph), 0.04 * Math.sin(p.ph));
      dm.scale.set(1, 1, 1); dm.updateMatrix();
      pedBody.setMatrixAt(k, dm.matrix); pedHead.setMatrixAt(k, dm.matrix);
    }
    pedBody.instanceMatrix.needsUpdate = true; pedHead.instanceMatrix.needsUpdate = true;
  }
  updateCars(0); updatePeds(0);
  function update(dt, time) {
    updateCars(dt); updatePeds(dt);
    swayU.value = time;
    waterN.offset.set(time * 0.006, time * 0.0045);
  }

  return { facadeMats, update, updateCars, water, lampMat, headMat, tailMat, cars, NC, peds, NP };
}
