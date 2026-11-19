// ============================================================================
//  SKYTHREAD — life: traffic, pedestrians, birds and steam
//  Every car and walker follows a closed formula of time, evaluated on the GPU,
//  so thousands of them cost almost nothing per frame.  Traffic obeys the
//  signal cycle: avenues roll two blocks on green, cross streets one, and
//  everybody queues outside the intersections on red.
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BX, BZ, NA, NS, HALFX, HALFZ, SH, CYC, AVE_T0, AVE_GO, ST_T0, ST_GO, cellOK, inPark, zoneOf, TSQ } from './world.js';

let seed = 77123;
function rnd() { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
const rr = (a, b) => a + (b - a) * rnd(), pick = (a) => a[(rnd() * a.length) | 0];

const A_PITCH = 7.0, A_SLOTS = 7, A_FRONT = BZ - 13.5 - 2.6;      // queue slots inside an avenue block
const S_PITCH = 7.2, S_SLOTS = 26, S_FRONT = BX - 19.5 - 2.6;     // and inside a cross-street block
const A_DELAY = 0.33, S_DELAY = 0.16;                             // start-up wave down the queue
const A_DUR = AVE_GO - A_DELAY * A_SLOTS, S_DUR = ST_GO - S_DELAY * S_SLOTS;
const A_STEP = 2 * BZ, S_STEP = BX;
const F = (v) => v.toFixed(4);

// ---------------------------------------------------------------- small mesh builder
class CB {
  constructor() { this.p = []; this.n = []; this.c = []; this.k = []; this.l = []; this.i = []; }
  poly(pts, col, k = 0, hint = null, limb = 0) {
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0; const m = pts.length;
    for (let a = 0; a < m; a++) { const p = pts[a], q = pts[(a + 1) % m]; nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]); cx += p[0]; cy += p[1]; cz += p[2]; }
    const len = Math.hypot(nx, ny, nz) || 1; nx /= len; ny /= len; nz /= len; cx /= m; cy /= m; cz /= m;
    if (hint && nx * (cx - hint[0]) + ny * (cy - hint[1]) + nz * (cz - hint[2]) < 0) { pts = pts.slice().reverse(); nx = -nx; ny = -ny; nz = -nz; }
    const b = this.p.length / 3;
    for (const p of pts) { this.p.push(p[0], p[1], p[2]); this.n.push(nx, ny, nz); this.c.push(col[0], col[1], col[2]); this.k.push(k); this.l.push(limb); }
    for (let a = 1; a < m - 1; a++) this.i.push(b, b + a, b + a + 1);
  }
  box(x0, x1, y0, y1, z0, z1, col, k = 0, limb = 0, bottom = false) {
    const h = [(x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2];
    this.poly([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], col, k, h, limb);
    this.poly([[x0, y0, z0], [x0, y1, z0], [x0, y1, z1], [x0, y0, z1]], col, k, h, limb);
    this.poly([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], col, k, h, limb);
    this.poly([[x0, y0, z0], [x1, y0, z0], [x1, y1, z0], [x0, y1, z0]], col, k, h, limb);
    this.poly([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], col, k, h, limb);
    if (bottom) this.poly([[x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1]], col, k, h, limb);
  }
  // tapered box: bottom rectangle (half-widths a) to top rectangle (half-widths b)
  taper(cx, cz, ax, az, y0, bx, bz, y1, col, k = 0, limb = 0, zs = 0) {
    const h = [cx, (y0 + y1) / 2, cz], B = [[cx - ax, y0, cz - az], [cx + ax, y0, cz - az], [cx + ax, y0, cz + az], [cx - ax, y0, cz + az]], T = [[cx - bx, y1, cz - bz + zs], [cx + bx, y1, cz - bz + zs], [cx + bx, y1, cz + bz + zs], [cx - bx, y1, cz + bz + zs]];
    for (let q = 0; q < 4; q++) { const r = (q + 1) % 4; this.poly([B[q], B[r], T[r], T[q]], col, k, h, limb); }
    this.poly(T, col, k, h, limb);
  }
  wheel(cx, cy, cz, r, w) {
    const s = Math.sign(cx), xo = cx + (s * w) / 2, xi = cx - (s * w) / 2, N = 10, ring = [], hub = [];
    for (let a = 0; a < N; a++) { const t = (a / N) * Math.PI * 2; ring.push([Math.cos(t) * r, Math.sin(t) * r]); hub.push([Math.cos(t) * r * 0.55, Math.sin(t) * r * 0.55]); }
    for (let a = 0; a < N; a++) { const p = ring[a], q = ring[(a + 1) % N]; this.poly([[xi, cy + p[1], cz + p[0]], [xo, cy + p[1], cz + p[0]], [xo, cy + q[1], cz + q[0]], [xi, cy + q[1], cz + q[0]]], TIRE, 0, [cx, cy, cz]); }
    this.poly(ring.map((p) => [xo, cy + p[1], cz + p[0]]), TIRE, 0, [cx, cy, cz]);
    this.poly(hub.map((p) => [xo + s * 0.012, cy + p[1], cz + p[0]]), HUB, 0, [cx, cy, cz]);
  }
  geo(limbs) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute('aK', new THREE.Float32BufferAttribute(this.k, 1));
    if (limbs) g.setAttribute('aL', new THREE.Float32BufferAttribute(this.l, 1));
    g.setIndex(this.i); return g;
  }
}
const PAINT = [1, 1, 1], GLASS = [0.09, 0.13, 0.17], TIRE = [0.05, 0.05, 0.055], HUB = [0.55, 0.56, 0.58], DARK = [0.1, 0.1, 0.11], HEAD = [1, 0.95, 0.8], TAIL = [1, 0.1, 0.06], SHADOW = [0.015, 0.015, 0.018];
const quadX = (b, x, y0, y1, z0, z1, col, k) => b.poly([[x, y0, z0], [x, y1, z0], [x, y1, z1], [x, y0, z1]], col, k, [0, (y0 + y1) / 2, (z0 + z1) / 2]);
const quadZ = (b, z, x0, x1, y0, y1, col, k) => b.poly([[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]], col, k, [(x0 + x1) / 2, (y0 + y1) / 2, 0]);
const shadowQuad = (b, hw, f) => b.poly([[-hw - 0.22, 0.03, -f - 0.3], [hw + 0.22, 0.03, -f - 0.3], [hw + 0.22, 0.03, f + 0.3], [-hw - 0.22, 0.03, f + 0.3]], SHADOW, 0, [0, -1, 0]);

// a smooth-shaded surface swept across the car's width along its side profile: pts = [z, y, halfWidth]
CB.prototype.sweep = function (pts, cols) {
  const nrm = pts.map((p, i) => { const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)], dz = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dz, dy) || 1; return [dz / l, -dy / l]; });   // [ny, nz]
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1], na = nrm[i], nb = nrm[i + 1], [col, k] = cols[i], base = this.p.length / 3;
    this.p.push(-a[2], a[1], a[0], a[2], a[1], a[0], b[2], b[1], b[0], -b[2], b[1], b[0]);
    this.n.push(0, na[0], na[1], 0, na[0], na[1], 0, nb[0], nb[1], 0, nb[0], nb[1]);
    for (let q = 0; q < 4; q++) { this.c.push(col[0], col[1], col[2]); this.k.push(k); this.l.push(0); }
    this.i.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
};
const P1 = [PAINT, 1], G0 = [GLASS, 0], D0 = [DARK, 0], PLATE = [0.85, 0.86, 0.82];
// a car: swept body, glass house with pillars, bumpers, mirrors, wheel arches, shaped lamps
function bodyCar(o) {
  const b = new CB(), { L, hw, belt, roof, cb0, cb1, ct0, ct1, thw, hood, trunk, sideGlass = true, sign = false, rails = false } = o, y0 = 0.3, f = L / 2, hint = [0, 0.6, 0], bw = hw - 0.03;
  b.sweep([[-f + 0.02, y0, hw - 0.08], [-f - 0.02, 0.56, hw - 0.02], [-f + 0.03, trunk, hw - 0.03], [cb0 - 0.3, trunk + 0.035, hw - 0.03], [cb0, belt, bw], [ct0, roof - 0.025, thw], [(ct0 + ct1) / 2, roof, thw], [ct1, roof - 0.03, thw], [cb1, belt, bw], [f - 0.55, hood + 0.025, hw - 0.03], [f - 0.08, hood - 0.07, hw - 0.05], [f + 0.01, 0.54, hw - 0.03], [f - 0.03, y0, hw - 0.09]],
    [P1, P1, P1, P1, sideGlass ? G0 : P1, P1, P1, G0, P1, P1, P1, P1]);
  const body = [[-f + 0.02, y0], [-f - 0.02, 0.56], [-f + 0.03, trunk], [cb0 - 0.3, trunk + 0.035], [cb0, belt], [cb1, belt], [f - 0.55, hood + 0.025], [f - 0.08, hood - 0.07], [f + 0.01, 0.54], [f - 0.03, y0]];
  for (const s of [-1, 1]) {
    b.poly(body.map(([z, y]) => [s * hw, y, z]), PAINT, 1, hint);
    const B0 = [s * bw, belt, cb0], B1 = [s * bw, belt, cb1], T0 = [s * thw, roof - 0.025, ct0], T1 = [s * thw, roof - 0.03, ct1], ch = [0, (belt + roof) / 2, (cb0 + cb1) / 2];
    b.poly([B0, B1, T1, T0], sideGlass ? GLASS : PAINT, sideGlass ? 0 : 1, ch);
    const pil = (t, w) => { const zb = cb0 + (cb1 - cb0) * t, zt = ct0 + (ct1 - ct0) * t, e = s * 0.012; b.poly([[s * bw + e, belt, zb - w], [s * bw + e, belt, zb + w], [s * thw + e, roof - 0.027, zt + w * 0.8], [s * thw + e, roof - 0.027, zt - w * 0.8]], PAINT, 1, ch); };
    if (sideGlass) { pil(0.02, 0.07); pil(0.47, 0.06); pil(0.98, 0.07); } else pil(0.82, 0.3);
    b.box(s * (hw + 0.02), s * (hw + 0.02) + s * 0.17, belt + 0.01, belt + 0.14, cb1 - 0.32, cb1 - 0.14, PAINT, 1, 0, true);   // mirror
    quadX(b, s * (hw + 0.004), y0 + 0.02, belt - 0.03, (cb0 + cb1) / 2 - 0.12, (cb0 + cb1) / 2 - 0.1, DARK, 0);               // door seam
    quadX(b, s * (hw + 0.006), belt - 0.16, belt - 0.12, (cb0 + cb1) / 2 + 0.25, (cb0 + cb1) / 2 + 0.43, DARK, 0);            // handle
    for (const z of [-(f - 0.85), f - 0.85]) {
      const arch = []; for (let a = 0; a <= 8; a++) { const t = (a / 8) * Math.PI; arch.push([s * (hw + 0.006), 0.36 + Math.sin(t) * 0.45, z + Math.cos(t) * 0.45]); }
      b.poly(arch, TIRE, 0, hint); b.wheel(s * (hw - 0.1), 0.34, z, 0.34, 0.26);
    }
    quadZ(b, f + 0.02, s * (hw - 0.52), s * (hw - 0.07), hood - 0.25, hood - 0.1, HEAD, 2); quadZ(b, f + 0.02, s * (hw - 0.3), s * (hw - 0.08), 0.42, 0.48, [1, 0.75, 0.3], 2);
    quadZ(b, -f - 0.03, s * (hw - 0.5), s * (hw - 0.05), trunk - 0.2, trunk - 0.06, TAIL, 3);
  }
  b.box(-(hw - 0.02), hw - 0.02, 0.27, 0.5, f - 0.1, f + 0.09, DARK, 0, 0, true); b.box(-(hw - 0.02), hw - 0.02, 0.27, 0.52, -f - 0.1, -f + 0.1, DARK, 0, 0, true);   // bumpers
  quadZ(b, f + 0.025, -(hw - 0.58), hw - 0.58, 0.52, hood - 0.12, DARK, 0); quadZ(b, f + 0.095, -0.26, 0.26, 0.33, 0.45, PLATE, 0); quadZ(b, -f - 0.105, -0.26, 0.26, 0.56, 0.68, PLATE, 0);
  if (sign) b.box(-0.3, 0.3, roof, roof + 0.17, -0.3, 0.05, [1, 0.88, 0.42], 4);
  if (rails) for (const s of [-1, 1]) b.box(s * (thw - 0.12) - 0.03, s * (thw - 0.12) + 0.03, roof, roof + 0.07, ct0 + 0.15, ct1 - 0.15, DARK, 0);
  shadowQuad(b, hw, f);
  return b.geo();
}
function bodyTruck() {
  const b = new CB(), f = 3.7;
  b.box(-1.05, 1.05, 0.5, 0.9, -f, f, DARK, 0);
  b.sweep([[1.86, 0.9, 1.1], [1.86, 2.5, 1.1], [3.0, 2.55, 1.1], [3.55, 2.3, 1.08], [f, 1.45, 1.1], [f, 0.9, 1.1]], [P1, P1, P1, G0, P1]);
  for (const s of [-1, 1]) {
    b.poly([[s * 1.1, 0.9, 1.86], [s * 1.1, 2.5, 1.86], [s * 1.1, 2.55, 3.0], [s * 1.1, 2.3, 3.55], [s * 1.1, 1.45, f], [s * 1.1, 0.9, f]], PAINT, 1, [0, 1.6, 2.8]);
    quadX(b, s * 1.112, 1.5, 2.3, 2.45, 3.4, GLASS, 0); b.box(s * 1.14, s * 1.14 + s * 0.2, 1.7, 2.1, 3.3, 3.42, DARK, 0, 0, true);
    for (const z of [2.75, -1.6, -2.75]) b.wheel(s * 1.02, 0.46, z, 0.46, 0.3);
    quadZ(b, f + 0.014, s * 0.55, s * 1.0, 0.95, 1.15, HEAD, 2); quadZ(b, -f - 0.014, s * 0.6, s * 1.05, 0.95, 1.15, TAIL, 3);
    quadX(b, s * 1.232, 1.0, 3.25, -3.6, -3.56, DARK, 0); quadX(b, s * 1.232, 1.0, 3.25, 1.58, 1.62, DARK, 0);
  }
  b.box(-1.22, 1.22, 0.9, 3.35, -f, 1.72, [0.93, 0.93, 0.9], 0);
  quadZ(b, -f - 0.012, -1.05, 1.05, 1.05, 3.2, [0.8, 0.8, 0.78], 0); quadZ(b, -f - 0.02, -0.02, 0.02, 1.05, 3.2, DARK, 0);
  b.box(-1.12, 1.12, 0.45, 0.75, f - 0.06, f + 0.1, DARK, 0, 0, true); quadZ(b, f + 0.012, -0.7, 0.7, 0.95, 1.4, DARK, 0);
  shadowQuad(b, 1.22, f); return b.geo();
}
function bodyBus() {
  const b = new CB(), hw = 1.28, f = 6;
  b.sweep([[-f, 0.4, hw], [-f, 2.95, hw], [-f + 0.25, 3.12, hw - 0.06], [f - 0.3, 3.12, hw - 0.06], [f - 0.02, 2.9, hw], [f + 0.06, 1.3, hw], [f, 0.4, hw]], [P1, P1, P1, P1, G0, P1]);
  for (const s of [-1, 1]) {
    b.poly([[s * hw, 0.4, -f], [s * hw, 2.95, -f], [s * hw, 3.1, -f + 0.25], [s * hw, 3.1, f - 0.3], [s * hw, 2.9, f - 0.02], [s * hw, 1.3, f + 0.06], [s * hw, 0.4, f]], PAINT, 1, [0, 1.7, 0]);
    for (let z = -f + 0.6; z < f - 2.2; z += 1.52) quadX(b, s * (hw + 0.012), 1.5, 2.55, z, z + 1.36, GLASS, 0);          // a row of separate windows
    quadX(b, s * (hw + 0.012), 0.92, 1.18, -f + 0.2, f - 0.2, [0.12, 0.3, 0.62], 0);
    if (s < 0) for (const z of [f - 2.0, -0.6]) { quadX(b, s * (hw + 0.014), 0.5, 2.6, z, z + 0.62, [0.07, 0.09, 0.12], 0); quadX(b, s * (hw + 0.014), 0.5, 2.6, z + 0.68, z + 1.3, [0.07, 0.09, 0.12], 0); }   // doors on the kerb side
    else quadX(b, s * (hw + 0.012), 1.5, 2.55, f - 2.1, f - 0.75, GLASS, 0);
    for (const z of [-3.8, 3.9]) { const arch = []; for (let a = 0; a <= 8; a++) { const t = (a / 8) * Math.PI; arch.push([s * (hw + 0.006), 0.5 + Math.sin(t) * 0.62, z + Math.cos(t) * 0.62]); } b.poly(arch, TIRE, 0, [0, 1, 0]); b.wheel(s * (hw - 0.12), 0.5, z, 0.5, 0.3); }
    quadZ(b, f + 0.075, s * 0.6, s * 1.1, 0.7, 0.95, HEAD, 2); quadZ(b, -f - 0.014, s * 0.7, s * 1.15, 0.9, 1.2, TAIL, 3);
    b.box(s * (hw + 0.02), s * (hw + 0.02) + s * 0.3, 2.3, 2.75, f - 0.2, f - 0.08, [0.9, 0.75, 0.1], 0, 0, true);    // mirror
  }
  quadZ(b, f + 0.07, -0.9, 0.9, 2.62, 2.9, [1, 0.62, 0.18], 4);
  quadZ(b, -f - 0.012, -(hw - 0.2), hw - 0.2, 1.7, 2.6, GLASS, 0); quadZ(b, -f - 0.012, -0.9, 0.9, 0.6, 1.4, DARK, 0);
  b.box(-0.9, 0.9, 3.12, 3.42, -2.6, 1.2, [0.8, 0.8, 0.8], 0); b.box(-(hw - 0.03), hw - 0.03, 0.36, 0.62, f - 0.02, f + 0.14, DARK, 0, 0, true);
  shadowQuad(b, hw, f); return b.geo();
}
// a rounded walker for close range (the simple one is kept for the distance)
function tagGeo(g, col, k, limb) {
  g = g.index ? g.toNonIndexed() : g; g.deleteAttribute('uv');
  const n = g.attributes.position.count, c = new Float32Array(n * 3), kk = new Float32Array(n).fill(k), ll = new Float32Array(n).fill(limb);
  for (let i = 0; i < n; i++) c.set(col, i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(c, 3)); g.setAttribute('aK', new THREE.BufferAttribute(kk, 1)); g.setAttribute('aL', new THREE.BufferAttribute(ll, 1));
  return g;
}
function bodyPedHi(shadow = true) {
  const W = [1, 1, 1], parts = [], ico = (d) => new THREE.IcosahedronGeometry(1, d);
  for (const s of [-1, 1]) {
    const limb = s < 0 ? 1 : 2;
    parts.push(tagGeo(new THREE.CylinderGeometry(0.08, 0.05, 0.86, 7, 1).translate(s * 0.092, 0.5, 0), W, 2, limb));
    parts.push(tagGeo(ico(0).scale(0.062, 0.05, 0.135).translate(s * 0.092, 0.05, 0.045), [0.07, 0.07, 0.08], 0, limb));
    parts.push(tagGeo(new THREE.CylinderGeometry(0.053, 0.038, 0.6, 6, 1).translate(s * 0.262, 1.16, 0), W, 1, limb + 2));
    parts.push(tagGeo(ico(0).scale(0.046, 0.05, 0.046).translate(s * 0.262, 0.83, 0), W, 3, limb + 2));
  }
  parts.push(tagGeo(ico(1).scale(0.165, 0.12, 0.115).translate(0, 0.95, 0), W, 2, 0));
  parts.push(tagGeo(new THREE.CylinderGeometry(0.178, 0.148, 0.5, 10, 1).scale(1, 1, 0.64).translate(0, 1.2, 0), W, 1, 0));
  parts.push(tagGeo(ico(1).scale(0.218, 0.1, 0.125).translate(0, 1.43, 0), W, 1, 0));
  parts.push(tagGeo(new THREE.CylinderGeometry(0.045, 0.05, 0.1, 6, 1).translate(0, 1.53, 0), W, 3, 0));
  parts.push(tagGeo(ico(1).scale(0.1, 0.125, 0.11).translate(0, 1.68, 0.005), W, 3, 0));
  parts.push(tagGeo(new THREE.SphereGeometry(1, 9, 5, 0, Math.PI * 2, 0, Math.PI * 0.52).scale(0.107, 0.13, 0.117).translate(0, 1.685, -0.008), W, 4, 0));
  if (shadow) parts.push(tagGeo(new THREE.PlaneGeometry(0.62, 0.54).rotateX(-Math.PI / 2).translate(0, 0.02, 0), [0.03, 0.03, 0.035], 0, 0));
  return mergeGeometries(parts);
}
// a standing figure as an ordinary mesh (shopkeepers and other people you can talk to)
export function makeFigure(shirt, pants, skinT = 0.3, hairT = 0.1, lift = 0) {
  const g = bodyPedHi(false), c = g.attributes.color, k = g.attributes.aK;
  const skin = [0.94 + (0.4 - 0.94) * skinT, 0.75 + (0.26 - 0.75) * skinT, 0.6 + (0.17 - 0.6) * skinT], hair = [0.07 + 0.48 * hairT, 0.05 + 0.35 * hairT, 0.04 + 0.16 * hairT];
  for (let i = 0; i < c.count; i++) { const kk = k.getX(i), col = kk > 3.5 ? hair : kk > 2.5 ? skin : kk > 1.5 ? pants : kk > 0.5 ? shirt : null; if (col) c.setXYZ(i, col[0], col[1], col[2]); }
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  if (lift > 0) mat.onBeforeCompile = (sh) => { sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += diffuseColor.rgb * ' + lift.toFixed(2) + ';'); };   // indoor light
  const m = new THREE.Mesh(g, mat); m.castShadow = true; return m;
}
// far cars: a body and a cabin, sized per instance
function bodyFar() {
  const b = new CB();
  b.box(-0.5, 0.5, 0.15, 0.6, -0.5, 0.5, PAINT, 1);
  b.box(-0.5, 0.5, 0.6, 1, -0.5, 0.5, PAINT, 5);
  quadZ(b, 0.503, -0.46, 0.46, 0.3, 0.5, HEAD, 2); quadZ(b, -0.503, -0.46, 0.46, 0.34, 0.54, TAIL, 3);
  return b.geo();
}
// a walker: legs and arms are tagged so the vertex shader can swing them
function bodyPed() {
  const b = new CB(), W = [1, 1, 1];
  for (const s of [-1, 1]) {
    const limb = s < 0 ? 1 : 2;
    b.taper(s * 0.095, 0, 0.07, 0.085, 0.07, 0.085, 0.1, 0.94, W, 2, limb);            // leg
    b.box(s * 0.095 - 0.07, s * 0.095 + 0.07, 0, 0.08, -0.09, 0.17, [0.07, 0.07, 0.08], 0, limb); // shoe
    b.taper(s * 0.265, 0, 0.045, 0.05, 0.84, 0.06, 0.065, 1.46, W, 1, limb + 2);       // arm
    b.box(s * 0.265 - 0.04, s * 0.265 + 0.04, 0.76, 0.85, -0.045, 0.045, W, 3, limb + 2); // hand
  }
  b.taper(0, 0, 0.165, 0.1, 0.92, 0.205, 0.115, 1.48, W, 1);                            // torso
  b.box(-0.05, 0.05, 1.48, 1.56, -0.05, 0.05, W, 3);                                    // neck
  b.box(-0.1, 0.1, 1.55, 1.79, -0.105, 0.11, W, 3);                                     // head
  b.box(-0.108, 0.108, 1.71, 1.815, -0.118, 0.07, W, 4);                                // hair
  b.poly([[-0.3, 0.02, -0.26], [0.3, 0.02, -0.26], [0.3, 0.02, 0.26], [-0.3, 0.02, 0.26]], [0.03, 0.03, 0.035], 0, [0, -1, 0]);
  return b.geo(true);
}

function instanced(base, cap, extra) {
  const g = new THREE.InstancedBufferGeometry(); g.index = base.index;
  for (const k in base.attributes) g.setAttribute(k, base.attributes[k]);
  const mk = (name, n) => { const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * n), n); a.setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a.array; };
  const arr = { A: mk('iA', 4), B: mk('iB', 4), C: mk('iC', 3) };
  if (extra) arr.D = mk('iD', extra);
  g.instanceCount = 0; g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
  return { g, arr, cap, n: 0 };
}
function flush(I) { const g = I.g; g.instanceCount = I.n; for (const k of ['iA', 'iB', 'iC', 'iD']) { const a = g.attributes[k]; if (!a) continue; a.clearUpdateRanges(); a.addUpdateRange(0, I.n * a.itemSize); a.needsUpdate = true; } }

// ============================================================================
export function buildLife(scene, world) {
  // ------------------------------------------------------------ materials
  const CU = { uTc: { value: 0 }, uN: { value: 0 }, uHead: { value: 0.2 }, uTail: { value: 0.8 } };
  const carMat = (far) => {
    // close-up cars get glossy paint that picks up the sky; distant ones stay cheap
    const m = far ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.34, metalness: 0.55 });
    if (far) m.defines = { FARCAR: 1 };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, CU);
      sh.vertexShader = `attribute vec4 iA; attribute vec4 iB; attribute vec3 iC; attribute float aK;
#ifdef FARCAR
attribute vec4 iD;
#endif
uniform float uTc; uniform float uN; uniform float uHead; uniform float uTail; varying float vGlow;
` + sh.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
  if (aK > 0.5 && aK < 1.5) vColor.rgb *= iC;
#ifdef FARCAR
  if (aK > 4.5) vColor.rgb = mix(vec3(0.09, 0.13, 0.17), iC, iD.w);
#endif`).replace('#include <beginnormal_vertex>', `
  float cAx = iB.x;
  float cu = clamp((uTc - mix(${F(ST_T0)}, ${F(AVE_T0)}, cAx) - iB.z) / mix(${F(S_DUR)}, ${F(A_DUR)}, cAx), 0.0, 1.0);
  float cs = mod(iA.y + iB.w * mix(${F(S_STEP)}, ${F(A_STEP)}, cAx) * (uN + cu * cu * (3.0 - 2.0 * cu)), iA.w);
  float cal = iA.z + (iB.y > 0.0 ? cs : iA.w - cs);
  vec2 cf = cAx > 0.5 ? vec2(0.0, iB.y) : vec2(iB.y, 0.0);
  vec2 cr = vec2(cf.y, -cf.x);
  vec3 objectNormal = vec3(cr.x * normal.x + cf.x * normal.z, normal.y, cr.y * normal.x + cf.y * normal.z);`).replace('#include <begin_vertex>', `
  vec3 lp = position;
#ifdef FARCAR
  if (aK > 4.5) { lp.x *= mix(0.84, 1.0, iD.w); lp.z = mix(lp.z * 0.5 - 0.06, lp.z, iD.w); }
  lp *= iD.xyz;
#endif
  lp *= iB.w > 0.5 ? smoothstep(0.0, 7.0, cs) * smoothstep(0.0, 7.0, iA.w - cs) : 1.0;
  vec2 cw = cAx > 0.5 ? vec2(iA.x, cal) : vec2(cal, iA.x);
  vec3 transformed = vec3(cw.x + cr.x * lp.x + cf.x * lp.z, lp.y, cw.y + cr.y * lp.x + cf.y * lp.z);
  float brake = (cu < 0.002 || cu > 0.9) ? 1.0 : 0.3;
  vGlow = aK > 4.5 ? 0.0 : aK > 3.5 ? 0.25 + uHead * 0.5 : aK > 2.5 ? uTail * brake * iB.w : aK > 1.5 ? uHead * iB.w : 0.0;`);
      sh.fragmentShader = 'varying float vGlow;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n  totalEmissiveRadiance += vColor.rgb * vGlow;');
    };
    m.customProgramCacheKey = () => (far ? 'skyCarFar' : 'skyCarNear');
    return m;
  };
  const PU = { uT: { value: 0 } };
  const pedMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  pedMat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, PU);
    sh.vertexShader = `attribute vec4 iA; attribute vec4 iB; attribute vec3 iC; attribute vec3 iD; attribute float aK; attribute float aL; uniform float uT;
` + sh.vertexShader.replace('#include <color_vertex>', `#include <color_vertex>
  if (aK > 3.5) vColor.rgb = mix(vec3(0.07, 0.05, 0.04), vec3(0.55, 0.4, 0.2), pow(fract(iB.w * 13.7), 3.0));
  else if (aK > 2.5) vColor.rgb = mix(vec3(0.94, 0.75, 0.6), vec3(0.4, 0.26, 0.17), fract(iB.w * 7.31));
  else if (aK > 1.5) vColor.rgb = iD;
  else if (aK > 0.5) vColor.rgb = iC;`).replace('#include <beginnormal_vertex>', `
  vec2 pp; vec2 pd; float pmv; float pdist;
  if (iB.y > 50.0) { // crossing a road in step with the signals: over on one cycle, back on the next
    float xd = iB.y - 50.0, xt = uT - iB.x, xc = floor(xt / ${F(CYC)}), xu = clamp((xt - xc * ${F(CYC)}) / xd, 0.0, 1.0), xo = mod(xc, 2.0);
    float xf = xo < 0.5 ? xu : 1.0 - xu, xl = length(iA.zw);
    pp = iA.zw * xf; pd = iA.zw / xl * (xo < 0.5 ? 1.0 : -1.0); pmv = step(0.001, xu) * step(xu, 0.999); pdist = xf * xl;
  } else { // walking the loop of sidewalk round a block
    float pper = max(4.0 * (iA.z + iA.w), 0.001);
    pdist = iB.x + iB.y * uT;
    float ps = mod(pdist, pper);
    float e1 = 2.0 * iA.z, e2 = e1 + 2.0 * iA.w, e3 = e2 + 2.0 * iA.z;
    if (ps < e1) { pp = vec2(-iA.z + ps, -iA.w); pd = vec2(1.0, 0.0); }
    else if (ps < e2) { pp = vec2(iA.z, -iA.w + ps - e1); pd = vec2(0.0, 1.0); }
    else if (ps < e3) { pp = vec2(iA.z - (ps - e2), iA.w); pd = vec2(-1.0, 0.0); }
    else { pp = vec2(-iA.z, iA.w - (ps - e3)); pd = vec2(0.0, -1.0); }
    pmv = step(0.01, abs(iB.y));
    if (iB.y < 0.0) pd = -pd;
    if (pmv < 0.5) pd = vec2(sin(iB.w * 40.0), cos(iB.w * 40.0));
  }
  vec2 pr = vec2(pd.y, -pd.x);
  float pph = pdist * 4.4 * pmv, psw = sin(pph);
  float pang = 0.0, ppiv = 0.0;
  if (aL > 3.5) { pang = psw * 0.5; ppiv = 1.44; } else if (aL > 2.5) { pang = -psw * 0.5; ppiv = 1.44; } else if (aL > 1.5) { pang = -psw * 0.6; ppiv = 0.93; } else if (aL > 0.5) { pang = psw * 0.6; ppiv = 0.93; }
  float pca = cos(pang), psa = sin(pang);
  vec3 pn = vec3(normal.x, normal.y * pca - normal.z * psa, normal.y * psa + normal.z * pca);
  vec3 objectNormal = vec3(pr.x * pn.x + pd.x * pn.z, pn.y, pr.y * pn.x + pd.y * pn.z);`).replace('#include <begin_vertex>', `
  vec3 lp = position; lp.y -= ppiv;
  lp.yz = vec2(lp.y * pca - lp.z * psa, lp.y * psa + lp.z * pca); lp.y += ppiv;
  lp.y += abs(cos(pph)) * 0.035 * pmv;
  lp *= iB.z;
  vec3 transformed = vec3(iA.x + pp.x + pr.x * lp.x + pd.x * lp.z, lp.y + ${F(SH)}, iA.y + pp.y + pr.y * lp.x + pd.y * lp.z);`);
  };
  pedMat.customProgramCacheKey = () => 'skyPed';

  // ------------------------------------------------------------ car fleet
  const SEDAN = { L: 4.6, hw: 0.92, belt: 0.9, roof: 1.42, cb0: -1.4, cb1: 1.0, ct0: -0.85, ct1: 0.42, thw: 0.76, hood: 0.78, trunk: 0.86 };
  const TYPES = [
    { geo: bodyCar(SEDAN), cap: 520, dim: [1.85, 1.42, 4.6, 0] },
    { geo: bodyCar({ ...SEDAN, sign: true }), cap: 260, dim: [1.85, 1.42, 4.6, 0] },
    { geo: bodyCar({ L: 4.85, hw: 0.98, belt: 1.02, roof: 1.74, cb0: -2.32, cb1: 1.05, ct0: -2.12, ct1: 0.55, thw: 0.84, hood: 0.96, trunk: 1.0, rails: true }), cap: 340, dim: [1.96, 1.74, 4.85, 0.7] },
    { geo: bodyCar({ L: 5.4, hw: 1.02, belt: 1.1, roof: 2.1, cb0: -2.66, cb1: 1.75, ct0: -2.6, ct1: 1.35, thw: 0.95, hood: 1.0, trunk: 1.08, sideGlass: false }), cap: 200, dim: [2.04, 2.1, 5.4, 1] },
    { geo: bodyTruck(), cap: 110, dim: [2.44, 3.35, 7.4, 1] },
    { geo: bodyBus(), cap: 90, dim: [2.56, 3.1, 12, 1] },
  ];
  const nearMat = carMat(false), farMat = carMat(true);
  for (const t of TYPES) { t.I = instanced(t.geo, t.cap); const m = new THREE.Mesh(t.I.g, nearMat); m.frustumCulled = false; m.receiveShadow = true; m.matrixAutoUpdate = false; scene.add(m); }
  const FARCAP = 9000, farI = instanced(bodyFar(), FARCAP, 4);
  { const m = new THREE.Mesh(farI.g, farMat); m.frustumCulled = false; m.matrixAutoUpdate = false; scene.add(m); }

  const COLS = [[0.9, 0.9, 0.9], [0.74, 0.75, 0.77], [0.07, 0.07, 0.08], [0.3, 0.31, 0.33], [0.11, 0.17, 0.33], [0.52, 0.07, 0.06], [0.1, 0.24, 0.16], [0.7, 0.66, 0.54], [0.44, 0.46, 0.5], [0.18, 0.18, 0.2], [0.82, 0.83, 0.85], [0.25, 0.3, 0.4]];
  const TAXI = [0.96, 0.72, 0.06], VANW = [0.92, 0.92, 0.9];
  const cars = [];   // cross, s0, a0, L, axis, dir, delay, move, type, r, g, b
  const addCar = (sp, cross, s0, delay, move, type) => {
    const c = type === 1 ? TAXI : type === 5 ? pick([[0.9, 0.92, 0.95], [0.2, 0.4, 0.7], [0.85, 0.85, 0.8]]) : type === 3 && rnd() < 0.7 ? VANW : pick(COLS);
    cars.push(cross, s0, sp.a0, sp.a1 - sp.a0, sp.axis, sp.dir, delay, move, type, c[0], c[1], c[2]);
  };
  const moverType = (axis) => { const r = rnd(); if (!axis) return r < 0.5 ? 0 : r < 0.72 ? 1 : r < 0.9 ? 2 : 3;   // cross streets carry no long vehicles, so people can slip between queued cars
    return r < 0.36 ? 0 : r < 0.56 ? 1 : r < 0.72 ? 2 : r < 0.81 ? 3 : r < 0.89 ? 4 : 5; };
  const jay = [];
  for (const sp of world.spans) {
    sp.c0 = cars.length / 12;
    const blk = sp.axis ? BZ : BX, nb = Math.round((sp.a1 - sp.a0) / blk);
    const slots = sp.axis ? A_SLOTS : S_SLOTS, pitch = sp.axis ? A_PITCH : S_PITCH, front = sp.axis ? A_FRONT : S_FRONT, dly = sp.axis ? A_DELAY : S_DELAY;
    for (let b = 0; b < nb; b++) {
      const mid = sp.a0 + (sp.dir > 0 ? b + 0.5 : nb - b - 0.5) * blk;
      const busy = (sp.axis ? mid : sp.line) < -HALFZ + 87 * BZ ? 1.15 : 0.8;
      for (const lo of sp.lanes) for (let q = 0; q < slots; q++) {
        if (rnd() > (sp.axis ? 0.6 : 0.46) * busy) continue;
        let type = moverType(sp.axis), off = q;
        if (type >= 4) { if (q + 1 >= slots) type = 2; else { off = q + 0.5; q++; } }
        addCar(sp, sp.line + lo, b * blk + front - off * pitch, off * dly, 1, type);
      }
      // parked along the curbs
      const sides = sp.lanes.length > (sp.axis ? 2 : 1) ? [-1, 1] : [Math.sign(sp.lanes[0])];
      const parked = [];
      for (const s of sides) for (let k = 0; k < (sp.axis ? 8 : 33); k++) {
        if (rnd() > (sp.axis ? 0.6 : 0.72)) continue;
        { const sp0 = b * blk + (sp.axis ? 16 : 22) + k * 6.1; parked.push(sp.a0 + (sp.dir > 0 ? sp0 : sp.a1 - sp.a0 - sp0)); }
        const r = rnd(); addCar(sp, sp.line + s * (sp.axis ? 12.9 : 6.75), b * blk + (sp.axis ? 16 : 22) + k * 6.1, 0, 0, r < 0.55 ? 0 : r < 0.85 ? 2 : 3);
      }
      if (!sp.axis && sp.lanes.length === 2) { // mid-block gaps a jaywalker can thread: between two queue slots and clear of every parked car
        let nj = 0;
        for (let q = 2; q < S_SLOTS - 2 && nj < 2; q++) {
          const sg = b * blk + S_FRONT - (q + 0.5) * S_PITCH, gx = sp.a0 + (sp.dir > 0 ? sg : sp.a1 - sp.a0 - sg);
          if (rnd() < 0.45 && parked.every((px) => Math.abs(px - gx) > 3.1)) { jay.push([gx, sp.line]); nj++; q += 3; }
        }
      }
    }
    sp.c1 = cars.length / 12;
  }
  const CD = new Float32Array(cars), NC = cars.length / 12; cars.length = 0;

  // ------------------------------------------------------------ pedestrians
  const SHIRT = [[0.82, 0.2, 0.18], [0.16, 0.34, 0.66], [0.9, 0.88, 0.82], [0.12, 0.12, 0.14], [0.86, 0.66, 0.16], [0.2, 0.5, 0.32], [0.5, 0.28, 0.6], [0.88, 0.48, 0.2], [0.45, 0.47, 0.5], [0.72, 0.82, 0.9], [0.6, 0.15, 0.3], [0.3, 0.3, 0.34]];
  const PANTS = [[0.12, 0.14, 0.2], [0.16, 0.22, 0.4], [0.08, 0.08, 0.09], [0.4, 0.36, 0.28], [0.3, 0.3, 0.32], [0.55, 0.5, 0.42]];
  const peds = [], blocks = [];   // cx, cz, hx, hz, s0, speed, scale, seed, shirt rgb, pants rgb
  const addPed = (cx, cz, hx, hz, speed) => { const a = pick(SHIRT), b = pick(PANTS); peds.push(cx, cz, hx, hz, rr(0, 4 * (hx + hz) + 1), speed, rr(0.9, 1.08), rnd(), a[0], a[1], a[2], b[0], b[1], b[2]); };
  const walkSpeed = () => (rnd() < 0.1 ? 0 : rr(1.1, 1.75) * (rnd() < 0.5 ? -1 : 1));
  for (let j = 0; j < NS; j++) for (let i = 0; i < NA; i++) {
    if (!cellOK(i, j) || inPark(i, j)) continue;
    const cx = -HALFX + (i + 0.5) * BX, cz = -HALFZ + (j + 0.5) * BZ, start = peds.length / 14;
    const zn = zoneOf(i, j), n = zn === 'battery' ? 26 : zn === 'fidi' ? 78 : zn === 'village' ? 54 : zn === 'midtown' ? ((i === TSQ[0] || i === TSQ[0] + 1) && j >= TSQ[1] && j <= TSQ[2] ? 170 : 84) : zn === 'uptown' ? 34 : 44;
    const HXB = (BX - 28) / 2 - 2.5, HZB = (BZ - 16) / 2 - 2.5;
    for (let k = 0; k < n; k++) { const off = rr(-1.8, 0.2); addPed(cx, cz, HXB + off, HZB + off, walkSpeed()); }
    blocks.push({ cx, cz, ex: HXB + 2.5, ez: HZB + 2.5, start, count: n });
  }
  { // the park: walkers and joggers on every path, people standing about on the grass and round the fountain
    const R = world.parkRect, xa = R.x0 + 24, xb = R.x1 - 24, zs = [R.z0 + 22, ...R.hz, R.z1 - 22];
    const rings = [[xa, xb, zs[0], zs[zs.length - 1], 620]];
    for (let k = 0; k + 1 < zs.length; k++) rings.push([xa, xb, zs[k], zs[k + 1], 120]);
    for (const [x0, x1, z0, z1, n] of rings) {
      const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2, hz = (z1 - z0) / 2, start = peds.length / 14;
      for (let k = 0; k < n; k++) { const off = rr(-1.3, 1.3); addPed(cx, cz, hx + off, hz + off, rnd() < 0.22 ? rr(2.8, 3.7) * (rnd() < 0.5 ? -1 : 1) : walkSpeed()); }
      blocks.push({ cx, cz, ex: hx + 3, ez: hz + 3, start, count: n });
    }
    const wet = (x, z) => R.water.some(([ox, oz, rx, rz]) => ((x - ox) / rx) ** 2 + ((z - oz) / rz) ** 2 < 1);
    for (let q = 0; q < 16; q++) { // loose groups, in bands so they stream with the view
      const z0 = R.z0 + ((R.z1 - R.z0) * q) / 16, z1 = R.z0 + ((R.z1 - R.z0) * (q + 1)) / 16, start = peds.length / 14;
      for (let g = 0; g < 44; g++) {
        const gx = rr(R.x0 + 6, R.x1 - 6), gz = rr(z0 + 4, z1 - 4), m = 1 + ((rnd() * 4) | 0);
        for (let k = 0; k < m; k++) { const x = gx + rr(-1.6, 1.6), z = gz + rr(-1.6, 1.6); if (!wet(x, z)) addPed(x, z, 0, 0, 0); }
      }
      if (R.fountain[1] >= z0 && R.fountain[1] < z1) for (let k = 0; k < 26; k++) { const a = rnd() * 6.283, d = rr(6.6, 12); addPed(R.fountain[0] + Math.cos(a) * d, R.fountain[1] + Math.sin(a) * d, 0, 0, 0); }
      blocks.push({ cx: (R.x0 + R.x1) / 2, cz: (z0 + z1) / 2, ex: (R.x1 - R.x0) / 2, ez: (z1 - z0) / 2, start, count: peds.length / 14 - start });
    }
  }
  { // people crossing: at every crosswalk when the cross traffic is held, and a few jaywalkers threading the queues mid-block
    const addX = (ax, az, vx, vz, ts, dur) => { const a = pick(SHIRT), b = pick(PANTS); peds.push(ax, az, vx, vz, ts, 50 + dur, rr(0.9, 1.08), rnd(), a[0], a[1], a[2], b[0], b[1], b[2]); };
    for (let a = 1; a < NA; a++) for (let r = 1; r < NS; r++) {
      if (!(cellOK(a - 1, r - 1) && cellOK(a, r - 1) && cellOK(a - 1, r) && cellOK(a, r)) || (inPark(a - 1, r - 1) && inPark(a, r))) continue;
      const xa = -HALFX + a * BX, zr = -HALFZ + r * BZ, start = peds.length / 14, n = r <= 87 ? 4 : 2;
      for (const oz of [-10.2, 10.2]) for (let k = 0; k < n; k++) { const d = rnd() < 0.5 ? 1 : -1; addX(xa - d * 14.6, zr + oz + rr(-1.2, 1.2), d * 29.2, 0, AVE_T0 + AVE_GO + 0.6 + rr(0, 2.2), 29.2 / rr(1.5, 1.75)); }
      for (const ox of [-16.2, 16.2]) for (let k = 0; k < n; k++) { const d = rnd() < 0.5 ? 1 : -1; addX(xa + ox + rr(-1.2, 1.2), zr - d * 8.6, 0, d * 17.2, ST_T0 + ST_GO + 0.6 + rr(0, 4.5), 17.2 / rr(1.45, 1.7)); }
      blocks.push({ cx: xa, cz: zr, ex: 18, ez: 12, start, count: peds.length / 14 - start });
    }
    for (const [gx, line] of jay) { const d = rnd() < 0.5 ? 1 : -1, start = peds.length / 14; addX(gx, line - d * 8.6, 0, d * 17.2, ST_T0 + ST_GO + 0.8 + rr(0, 4), 17.2 / rr(1.5, 1.8)); blocks.push({ cx: gx, cz: line, ex: 2, ez: 9, start, count: 1 }); }
  }
  const PD = new Float32Array(peds), NPED = peds.length / 14; peds.length = 0;
  const PEDCAP = 2800, pedI = instanced(bodyPed(), PEDCAP, 3), pedHiI = instanced(bodyPedHi(), 420, 3);
  for (const I of [pedI, pedHiI]) { const m = new THREE.Mesh(I.g, pedMat); m.frustumCulled = false; m.receiveShadow = true; m.matrixAutoUpdate = false; scene.add(m); }

  // ------------------------------------------------------------ birds
  const NBIRD = 45, birdG = new THREE.BufferGeometry();
  birdG.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.28, -0.95, 0, -0.12, 0, 0, -0.2, 0, 0, 0.28, 0, 0, -0.2, 0.95, 0, -0.12], 3));
  const birdMat = new THREE.MeshBasicMaterial({ color: 0x15161a, side: THREE.DoubleSide });
  birdMat.onBeforeCompile = (sh) => { sh.uniforms.uT = PU.uT; sh.vertexShader = 'uniform float uT;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed.y += abs(position.x) * sin(uT * 9.0 + float(gl_InstanceID) * 1.7) * 0.5;'); };
  const birds = new THREE.InstancedMesh(birdG, birdMat, NBIRD); birds.frustumCulled = false; scene.add(birds);
  const flocks = [0, 1, 2].map((k) => ({ x: 0, z: 0, y: 90, r: 60, w: 0.12, ph: k * 2, far: true }));
  const bm = new THREE.Object3D();

  // ------------------------------------------------------------ steam rising from the street
  let steam = null;
  if (world.vents.length) {
    const cv = document.createElement('canvas'); cv.width = cv.height = 64; const g = cv.getContext('2d'), gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)'); g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
    const pos = [], ph = [];
    for (const [x, z, vy] of world.vents) for (let k = 0; k < 4; k++) { pos.push(x, (vy || 0) + 0.3, z); ph.push(k / 4 + rnd() * 0.2); }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); sg.setAttribute('aPh', new THREE.Float32BufferAttribute(ph, 1));
    const sm = new THREE.PointsMaterial({ map: new THREE.CanvasTexture(cv), size: 7, transparent: true, depthWrite: false, opacity: 0.3, color: 0xdfe4ea });
    sm.onBeforeCompile = (sh) => {
      sh.uniforms.uT = PU.uT;
      sh.vertexShader = 'attribute float aPh; uniform float uT; varying float vT;\n' + sh.vertexShader.replace('#include <begin_vertex>', `
  float st = fract(uT * 0.11 + aPh); vT = st;
  vec3 transformed = vec3(position);
  transformed.y += st * st * 11.0 + st * 2.0; transformed.x += sin(uT * 0.6 + aPh * 31.0) * st * 1.6; transformed.z += cos(uT * 0.5 + aPh * 17.0) * st * 1.2;`).replace('gl_PointSize = size;', 'gl_PointSize = size * (0.35 + st * 1.5);').replace('#include <fog_vertex>', 'gl_PointSize = min(gl_PointSize, 260.0);\n#include <fog_vertex>');
      sh.fragmentShader = 'varying float vT;\n' + sh.fragmentShader.replace('#include <map_particle_fragment>', '#include <map_particle_fragment>\n  diffuseColor.a *= sin(vT * 3.14159);');
    };
    steam = new THREE.Points(sg, sm); steam.frustumCulled = false; scene.add(steam);
  }

  // ------------------------------------------------------------ drifting motes: dust in the light by day, fireflies in the park at night
  const MN = 820, mpos = new Float32Array(MN * 3), mseed = new Float32Array(MN);
  for (let k = 0; k < MN; k++) { mpos[k * 3] = rnd(); mpos[k * 3 + 1] = rnd(); mpos[k * 3 + 2] = rnd(); mseed[k] = rnd(); }
  const mg = new THREE.BufferGeometry(); mg.setAttribute('position', new THREE.BufferAttribute(mpos, 3)); mg.setAttribute('aS', new THREE.BufferAttribute(mseed, 1));
  const MU = { uCam: { value: new THREE.Vector3() }, uT: PU.uT, uBox: { value: new THREE.Vector3(56, 30, 56) }, uCol: { value: new THREE.Color(1, 0.85, 0.6) }, uA: { value: 0.2 }, uPx: { value: 60 }, uBlink: { value: 0 }, uFall: { value: 0 } };
  const motes = new THREE.Points(mg, new THREE.ShaderMaterial({
    uniforms: MU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    vertexShader: `uniform vec3 uCam; uniform vec3 uBox; uniform float uT; uniform float uPx; uniform float uBlink; uniform float uFall; attribute float aS; varying float vA;
      void main() {
        vec3 w = position * uBox + vec3(sin(uT * 0.21 + aS * 40.0) * 1.5 + uT * 0.35, sin(uT * 0.33 + aS * 71.0) * 0.8 - uT * uFall * (0.6 + aS), cos(uT * 0.17 + aS * 23.0) * 1.5);
        vec3 rel = mod(w - uCam + uBox * 0.5, uBox) - uBox * 0.5;
        vec4 mv = viewMatrix * vec4(uCam + rel, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = clamp(uPx * (0.6 + aS) / -mv.z, 1.0, 7.0);
        float edge = 1.0 - smoothstep(0.36, 0.5, max(abs(rel.x) / uBox.x, abs(rel.z) / uBox.z));
        float bl = mix(1.0, pow(0.5 + 0.5 * sin(uT * (1.5 + aS * 2.0) + aS * 90.0), 6.0), uBlink);
        vA = edge * bl * smoothstep(1.0, 4.0, -mv.z);
      }`,
    fragmentShader: `uniform vec3 uCol; uniform float uA; varying float vA; void main() { float d = length(gl_PointCoord - 0.5); gl_FragColor = vec4(uCol, uA * vA * smoothstep(0.5, 0.1, d)); }`,
  }));
  motes.frustumCulled = false; motes.renderOrder = 3; scene.add(motes);
  let nightK = 0;

  // ------------------------------------------------------------ streaming: choose which instances to draw
  const Q = { near: 150, far: 800, peds: 1200, pedR: 230 };
  const info = { cars: 0, farCars: 0, peds: 0, crowd: 0, nearIdx: [-1, -1, -1, -1], nearD: [1e9, 1e9, 1e9, 1e9] };
  const COSW = Math.cos(1.26);
  function rebuildCars(time, cx, cy, cz, yaw) {
    const tc = time % CYC, n = Math.floor(time / CYC), fx = Math.sin(yaw), fz = Math.cos(yaw);
    const near2 = Q.near * Q.near, far2 = Q.far * Q.far, farR = Q.far, always = Math.max(70, cy * 1.3), al2 = always * always;
    for (const t of TYPES) t.I.n = 0; farI.n = 0;
    const nI = info.nearIdx, nD = info.nearD; nI.fill(-1); nD.fill(1e9);
    for (const sp of world.spans) { // whole streets too far off to one side are skipped in one test
     const sd = sp.line - (sp.axis ? cx : cz); if (sd > farR + 14 || sd < -farR - 14) continue;
     for (let i = sp.c0, o = i * 12; i < sp.c1; i++, o += 12) {
      const axis = CD[o + 4], dc = CD[o] - (axis ? cx : cz);
      if (dc > farR || dc < -farR) continue;
      const L = CD[o + 3], move = CD[o + 7]; let s = CD[o + 1];
      if (move) { let u = (tc - (axis ? AVE_T0 : ST_T0) - CD[o + 6]) / (axis ? A_DUR : S_DUR); u = u < 0 ? 0 : u > 1 ? 1 : u; s = (s + (axis ? A_STEP : S_STEP) * (n + u * u * (3 - 2 * u))) % L; }
      const da = CD[o + 2] + (CD[o + 5] > 0 ? s : L - s) - (axis ? cz : cx), d2 = dc * dc + da * da;
      if (d2 > far2) continue;
      if (move && d2 < nD[3]) { let k = 3; while (k > 0 && nD[k - 1] > d2) { nD[k] = nD[k - 1]; nI[k] = nI[k - 1]; k--; } nD[k] = d2; nI[k] = i; }
      if (d2 > al2) { const dx = axis ? dc : da, dz = axis ? da : dc; if (dx * fx + dz * fz < COSW * Math.sqrt(d2)) continue; }
      const type = CD[o + 8], T = TYPES[type];
      let I = T.I, k;
      if (d2 < near2 && I.n < I.cap) k = I.n++;
      else { I = farI; if (I.n >= I.cap) continue; k = I.n++; const D = I.arr.D, dm = T.dim; D[k * 4] = dm[0]; D[k * 4 + 1] = dm[1]; D[k * 4 + 2] = dm[2]; D[k * 4 + 3] = dm[3]; }
      const A = I.arr.A, B = I.arr.B, C = I.arr.C, k4 = k * 4, k3 = k * 3;
      A[k4] = CD[o]; A[k4 + 1] = CD[o + 1]; A[k4 + 2] = CD[o + 2]; A[k4 + 3] = L;
      B[k4] = axis; B[k4 + 1] = CD[o + 5]; B[k4 + 2] = CD[o + 6]; B[k4 + 3] = move;
      C[k3] = CD[o + 9]; C[k3 + 1] = CD[o + 10]; C[k3 + 2] = CD[o + 11];
    }
    }
    let nn = 0; for (const t of TYPES) { flush(t.I); nn += t.I.n; } flush(farI);
    info.cars = nn; info.farCars = farI.n;
  }
  const order = [];
  function rebuildPeds(time, cx, cy, cz, yaw) {
    const R = Q.pedR, R2 = R * R, fx = Math.sin(yaw), fz = Math.cos(yaw), always = Math.max(45, cy * 1.3), al2 = always * always, cap = Math.min(Q.peds, PEDCAP);
    order.length = 0;
    for (const b of blocks) { const dx = Math.max(0, Math.abs(b.cx - cx) - b.ex), dz = Math.max(0, Math.abs(b.cz - cz) - b.ez), d2 = dx * dx + dz * dz; if (d2 < R2) { b.d2 = d2; order.push(b); } }
    order.sort((a, b) => a.d2 - b.d2);
    let n = 0, crowd = 0; pedI.n = 0; pedHiI.n = 0;
    for (const b of order) {
      for (let i = b.start, e = b.start + b.count; i < e && n < cap; i++) {
        const o = i * 14, hx = PD[o + 2], hz = PD[o + 3], sp = PD[o + 5]; let x, z;
        if (sp > 50) { // a crosser: the same sum the shader does
          const tt = time - PD[o + 4], c = Math.floor(tt / CYC); let u = (tt - c * CYC) / (sp - 50); u = u < 0 ? 0 : u > 1 ? 1 : u; const f = c % 2 === 0 ? u : 1 - u; x = hx * f; z = hz * f;
        } else {
          const per = Math.max(4 * (hx + hz), 0.001); let s = (PD[o + 4] + sp * time) % per; if (s < 0) s += per;
          const e1 = 2 * hx, e2 = e1 + 2 * hz, e3 = e2 + 2 * hx;
          if (s < e1) { x = -hx + s; z = -hz; } else if (s < e2) { x = hx; z = -hz + s - e1; } else if (s < e3) { x = hx - (s - e2); z = hz; } else { x = -hx; z = hz - (s - e3); }
        }
        const dx = PD[o] + x - cx, dz = PD[o + 1] + z - cz, d2 = dx * dx + dz * dz;
        if (d2 > R2) continue;
        if (d2 < 1600) crowd++;
        if (d2 > 4900) { const d = Math.sqrt(d2); if (PD[o + 7] > 1 - (0.75 * (d - 70)) / (R - 70)) continue; if (d2 > al2 && dx * fx + dz * fz < COSW * d) continue; }
        else if (d2 > al2 && dx * fx + dz * fz < COSW * Math.sqrt(d2)) continue;
        const I = d2 < 1850 && pedHiI.n < Math.min(pedHiI.cap, Q.pedHi == null ? 420 : Q.pedHi) ? pedHiI : pedI, A = I.arr.A, B = I.arr.B, C = I.arr.C, D = I.arr.D, k = I.n++, k4 = k * 4, k3 = k * 3; n++;
        A[k4] = PD[o]; A[k4 + 1] = PD[o + 1]; A[k4 + 2] = hx; A[k4 + 3] = hz;
        B[k4] = PD[o + 4]; B[k4 + 1] = sp; B[k4 + 2] = PD[o + 6]; B[k4 + 3] = PD[o + 7];
        C[k3] = PD[o + 8]; C[k3 + 1] = PD[o + 9]; C[k3 + 2] = PD[o + 10]; D[k3] = PD[o + 11]; D[k3 + 1] = PD[o + 12]; D[k3 + 2] = PD[o + 13];
      }
    }
    flush(pedI); flush(pedHiI); info.peds = n; info.crowd = crowd;

  }
  // where one of the nearest moving cars is right now (for the sound engine)
  function carAt(i, time, out) {
    if (i < 0 || i >= NC) return false;
    const o = i * 12, axis = CD[o + 4], L = CD[o + 3], dir = CD[o + 5], tc = time % CYC, dur = axis ? A_DUR : S_DUR, step = axis ? A_STEP : S_STEP;
    let u = (tc - (axis ? AVE_T0 : ST_T0) - CD[o + 6]) / dur; u = u < 0 ? 0 : u > 1 ? 1 : u;
    const mv = CD[o + 7], s = (CD[o + 1] + mv * step * (Math.floor(time / CYC) + u * u * (3 - 2 * u))) % L, al = CD[o + 2] + (dir > 0 ? s : L - s), v = ((mv * step * 6 * u * (1 - u)) / dur) * dir;
    out.x = axis ? CD[o] : al; out.z = axis ? al : CD[o]; out.vx = axis ? 0 : v; out.vz = axis ? v : 0; out.id = i; out.type = CD[o + 8];
    return true;
  }

  let timer = 0, lastYaw = 0, lastX = 0, lastZ = 0, flip = 0;
  function update(dt, time, cx, cy, cz, yaw, park) {
    MU.uCam.value.set(cx, cy, cz);
    if (nightK > 0.5) { motes.visible = !!park && cy < 60; MU.uCol.value.setRGB(0.8, 1.0, 0.3); MU.uA.value = 0.95; MU.uBlink.value = 1; MU.uPx.value = 90; }
    else if (park) { motes.visible = true; MU.uCol.value.setRGB(0.95, 0.7, 0.22); MU.uA.value = 0.55; MU.uBlink.value = 0; MU.uPx.value = 120; MU.uFall.value = 0.8; }   // leaves coming down
    else { motes.visible = true; MU.uCol.value.setRGB(1, 0.86, 0.62); MU.uA.value = 0.22; MU.uBlink.value = 0; MU.uPx.value = 55; MU.uFall.value = 0; }
    CU.uTc.value = time % CYC; CU.uN.value = Math.floor(time / CYC); PU.uT.value = time;
    timer -= dt;
    let dy = yaw - lastYaw; dy = Math.abs(Math.atan2(Math.sin(dy), Math.cos(dy)));
    if (timer <= 0 || dy > 0.3 || Math.abs(cx - lastX) + Math.abs(cz - lastZ) > 22) {
      // alternate the two rebuilds so no single frame pays for both, unless the view jumped
      const jump = dy > 0.3 || timer < -0.2;
      if (jump || flip === 0) rebuildCars(time, cx, cy, cz, yaw);
      if (jump || flip === 1) rebuildPeds(time, cx, cy, cz, yaw);
      flip ^= 1; timer = 0.13; lastYaw = yaw; lastX = cx; lastZ = cz;
    }
    // birds: three loose flocks circling over the streets near the player
    for (let f = 0; f < 3; f++) {
      const fl = flocks[f];
      if (fl.far || Math.hypot(fl.x - cx, fl.z - cz) > 650) { const a = rnd() * 6.283, d = rr(120, 380); fl.x = cx + Math.cos(a) * d; fl.z = cz + Math.sin(a) * d; fl.y = clampY(cy + rr(-30, 70)); fl.r = rr(40, 90); fl.w = rr(0.1, 0.18) * (rnd() < 0.5 ? -1 : 1); fl.far = false; }
      for (let k = 0; k < 15; k++) {
        const a = time * fl.w + fl.ph + k * 0.11 * Math.sign(fl.w) * -1, r = fl.r + ((k * 7) % 5) * 2.4 - 5;
        bm.position.set(fl.x + Math.cos(a) * r, fl.y + Math.sin(time * 0.7 + k) * 1.5 + ((k * 3) % 4) * 1.2, fl.z + Math.sin(a) * r);
        bm.rotation.set(0, -a + (fl.w > 0 ? 0 : Math.PI), 0, 'YXZ'); bm.rotation.z = fl.w > 0 ? -0.35 : 0.35; bm.updateMatrix(); birds.setMatrixAt(f * 15 + k, bm.matrix);
      }
    }
    birds.instanceMatrix.needsUpdate = true;
  }
  const clampY = (y) => (y < 45 ? 45 : y > 320 ? 320 : y);
  function setQuality(q) { Object.assign(Q, q); timer = -1; }
  function setNight(k) { nightK = k; CU.uHead.value = 0.18 + k * 1.5; CU.uTail.value = 0.8 + k * 0.9; birds.visible = k < 0.5; if (steam) steam.material.opacity = 0.3 - k * 0.12; }
  function refresh() { timer = -1; }
  return { update, setQuality, setNight, refresh, carAt, info, stats: { cars: NC, peds: NPED } };
}
