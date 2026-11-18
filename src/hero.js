// ============================================================================
//  SKYTHREAD — the hero: an original runner in a dark suit with cyan light-seams.
//  A human figure: lofted torso and head, muscled limbs, hands with fingers,
//  shaped feet — on a 15-joint skeleton. Each joint draws one mesh per material.
// ============================================================================
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const JOINTS = ['spine', 'chest', 'head', 'shL', 'elL', 'haL', 'shR', 'elR', 'haR', 'hipL', 'knL', 'ftL', 'hipR', 'knR', 'ftR'];
const TAU = Math.PI * 2;

// a limb hanging down from its joint: radius r0 at the top, r1 at the bottom, with up to two muscle bulges
function limbGeo(len, r0, r1, bulge = 0.12, at = 0.3, seg = 14, b2 = 0, at2 = 0.8) {
  const pts = [new THREE.Vector2(0.001, -len - r1 * 0.55), new THREE.Vector2(r1 * 0.72, -len - r1 * 0.22)];
  for (let i = 10; i >= 0; i--) { const t = i / 10, r = (r0 + (r1 - r0) * t) * (1 + bulge * Math.exp(-(((t - at) / 0.24) ** 2)) + b2 * Math.exp(-(((t - at2) / 0.16) ** 2))); pts.push(new THREE.Vector2(r, -len * t)); }
  pts.push(new THREE.Vector2(r0 * 0.72, r0 * 0.22), new THREE.Vector2(0.001, r0 * 0.5));
  return new THREE.LatheGeometry(pts, seg);
}
// a body section lofted through elliptical rings [y, halfWidth, halfDepth, offsetX, offsetZ], closed at both ends
function loft(rings, seg = 18) {
  const pos = [], uv = [], idx = [], n = rings.length, w = seg + 1;
  for (let i = 0; i < n; i++) {
    const [y, rx, rz, ox = 0, oz = 0] = rings[i];
    for (let j = 0; j <= seg; j++) { const a = (j / seg) * TAU + Math.PI; pos.push(ox + Math.sin(a) * rx, y, oz + Math.cos(a) * rz); uv.push(j / seg, i / (n - 1)); }
  }
  for (let i = 0; i < n - 1; i++) for (let j = 0; j < seg; j++) { const a = i * w + j, b = a + 1, c = a + w, d = c + 1; idx.push(a, b, c, b, d, c); }
  const cap = (i, flip) => { const [y, , , ox = 0, oz = 0] = rings[i], c = pos.length / 3; pos.push(ox, y, oz); uv.push(0.5, i ? 1 : 0); for (let j = 0; j < seg; j++) { const a = i * w + j, b = a + 1; if (flip) idx.push(c, b, a); else idx.push(c, a, b); } };
  cap(0, true); cap(n - 1, false);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  return g;
}

export function buildHero(scene) {
  const hero = new THREE.Group(); scene.add(hero);
  const M = {
    suit: new THREE.MeshStandardMaterial({ color: 0x1c212b, roughness: 0.62, metalness: 0.18 }),
    plate: new THREE.MeshStandardMaterial({ color: 0x343d4a, roughness: 0.36, metalness: 0.62 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x062a30, emissive: 0x2ef2ff, emissiveIntensity: 2.2, roughness: 0.4 }),
    ember: new THREE.MeshStandardMaterial({ color: 0x401500, emissive: 0xff7a1a, emissiveIntensity: 2.0 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.16, metalness: 0.9 }),
  };
  const SPH = new THREE.SphereGeometry(1, 20, 14), BOX = new THREE.BoxGeometry(1, 1, 1);
  const bins = new Map(), mx = new THREE.Matrix4(), q = new THREE.Quaternion(), eu = new THREE.Euler(), v1 = new THREE.Vector3(), v2 = new THREE.Vector3();
  // every piece is baked into its joint's frame and merged per material
  const part = (parent, geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
    let g = geo.clone().applyMatrix4(mx.compose(v1.set(x, y, z), q.setFromEuler(eu.set(rx, ry, rz)), v2.set(sx, sy, sz)));
    if (g.index) g = g.toNonIndexed();
    let m = bins.get(parent); if (!m) bins.set(parent, (m = new Map()));
    let a = m.get(mat); if (!a) m.set(mat, (a = []));
    a.push(g);
  };
  const joint = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
  const R = {};

  // pelvis
  R.hips = joint(hero, 0, 0, 0);
  part(R.hips, loft([[-0.14, 0.045, 0.055], [-0.105, 0.118, 0.096], [-0.05, 0.16, 0.117, 0, -0.004], [0.0, 0.168, 0.12, 0, -0.005], [0.06, 0.155, 0.11], [0.115, 0.146, 0.103]]), M.suit);
  for (const s of [-1, 1]) part(R.hips, SPH, M.suit, s * 0.072, -0.045, -0.062, 0.086, 0.09, 0.07);
  part(R.hips, loft([[0.058, 0.156, 0.111], [0.066, 0.162, 0.116], [0.092, 0.159, 0.113], [0.1, 0.151, 0.107]]), M.plate);   // belt
  part(R.hips, BOX, M.glow, 0, 0.079, 0.116, 0.044, 0.022, 0.008);

  // abdomen and chest
  R.spine = joint(R.hips, 0, 0.08, 0);
  part(R.spine, loft([[-0.02, 0.15, 0.106], [0.05, 0.138, 0.098], [0.11, 0.141, 0.1, 0, 0.002], [0.17, 0.156, 0.108, 0, 0.004], [0.235, 0.168, 0.116, 0, 0.006]]), M.suit);
  for (const s of [-1, 1]) for (let k = 0; k < 3; k++) part(R.spine, SPH, M.suit, s * 0.037, 0.035 + k * 0.057, 0.088 + k * 0.003, 0.036, 0.027, 0.016);   // the core muscles under the suit
  R.chest = joint(R.spine, 0, 0.2, 0);
  part(R.chest, loft([[-0.03, 0.158, 0.11], [0.04, 0.176, 0.122, 0, 0.004], [0.11, 0.196, 0.13, 0, 0.008], [0.17, 0.204, 0.124, 0, 0.004], [0.215, 0.19, 0.108], [0.25, 0.13, 0.088, 0, -0.004], [0.28, 0.072, 0.068, 0, -0.004], [0.31, 0.053, 0.057], [0.372, 0.05, 0.054]]), M.suit);
  for (const s of [-1, 1]) {
    part(R.chest, SPH, M.suit, s * 0.086, 0.152, 0.074, 0.1, 0.076, 0.056);                             // chest
    part(R.chest, SPH, M.suit, s * 0.092, 0.258, -0.022, 0.092, 0.04, 0.062, 0, 0, s * -0.45);        // the slope up to the neck
    part(R.chest, SPH, M.suit, s * 0.128, 0.085, -0.045, 0.072, 0.135, 0.07);                           // back
    part(R.chest, BOX, M.glow, s * 0.084, 0.13, 0.133, 0.011, 0.19, 0.008, -0.1, 0, s * 0.5);
    part(R.chest, BOX, M.glow, s * 0.18, 0.03, 0, 0.008, 0.2, 0.036);
    part(R.chest, SPH, M.plate, s * 0.066, 0.238, 0.07, 0.062, 0.016, 0.028, 0.3, 0, s * -0.16);       // collar bones, as a trim line
  }
  part(R.chest, new THREE.OctahedronGeometry(1, 0), M.ember, 0, 0.168, 0.139, 0.04, 0.056, 0.014);
  part(R.chest, BOX, M.glow, 0, 0.1, -0.128, 0.011, 0.3, 0.008);                                        // spine light

  // head: skull, jaw and chin under a wrap-around visor
  R.head = joint(R.chest, 0, 0.355, 0);
  part(R.head, loft([[-0.012, 0.05, 0.055], [0.018, 0.052, 0.066, 0, 0.014], [0.045, 0.074, 0.088, 0, 0.014], [0.08, 0.09, 0.104, 0, 0.006], [0.115, 0.097, 0.112, 0, 0.002], [0.15, 0.098, 0.114, 0, -0.002], [0.185, 0.087, 0.103, 0, -0.006], [0.212, 0.06, 0.074, 0, -0.008], [0.228, 0.02, 0.028, 0, -0.008]], 20), M.suit);
  part(R.head, new THREE.SphereGeometry(1, 24, 12, Math.PI / 2 - 1.0, 2.0, 1.15, 0.62), M.visor, 0, 0.1, 0.004, 0.11, 0.126, 0.121);
  const slit = new THREE.TorusGeometry(1, 0.045, 6, 28, 1.5); slit.rotateX(Math.PI / 2); slit.rotateY(0.75 - Math.PI / 2);
  part(R.head, slit, M.glow, 0, 0.095, 0.006, 0.114, 0.114, 0.125);
  part(R.head, BOX, M.glow, 0, 0.208, -0.03, 0.009, 0.02, 0.15);                                        // crest line
  for (const s of [-1, 1]) part(R.head, SPH, M.plate, s * 0.097, 0.092, -0.008, 0.014, 0.036, 0.034);   // ear pods

  const FING = new THREE.CapsuleGeometry(1, 1, 3, 7);
  const finger = (parent, r, len, x, y, z, rx, rz = 0) => part(parent, FING, M.suit, x, y, z, r, len / 3, r, rx, 0, rz);   // the capsule is 3 units long
  function arm(side) {
    const sh = joint(R.chest, side * 0.218, 0.232, 0);
    part(sh, SPH, M.suit, side * 0.004, -0.006, 0, 0.079, 0.084, 0.08);                                // shoulder
    part(sh, SPH, M.plate, side * 0.03, 0.03, 0, 0.056, 0.04, 0.066, 0, 0, side * -0.5);              // a light cap over it
    part(sh, limbGeo(0.285, 0.057, 0.043, 0.2, 0.36), M.suit, 0, 0, 0, 1, 1, 1.06);
    part(sh, BOX, M.glow, side * 0.058, -0.15, 0, 0.008, 0.18, 0.016);
    const el = joint(sh, 0, -0.285, 0);
    part(el, SPH, M.suit, 0, 0, -0.004, 0.044, 0.045, 0.047);
    part(el, limbGeo(0.255, 0.046, 0.03, 0.27, 0.22), M.suit);
    part(el, limbGeo(0.075, 0.039, 0.034, 0, 0.5), M.plate, 0, -0.165, 0);                             // wrist bracer: the shooter
    part(el, BOX, M.glow, 0, -0.2, 0.037, 0.024, 0.04, 0.008);
    const ha = joint(el, 0, -0.262, 0);
    part(ha, SPH, M.suit, 0, -0.046, 0, 0.041, 0.052, 0.019);                                           // palm
    part(ha, SPH, M.plate, 0, -0.04, -0.012, 0.03, 0.036, 0.012);                                       // back of the hand
    for (let i = 0; i < 4; i++) { const x = -0.0285 + i * 0.019, l = i === 0 || i === 3 ? 0.9 : 1; finger(ha, 0.0088, 0.05 * l, x, -0.108, 0.006, -0.22); finger(ha, 0.0079, 0.044 * l, x, -0.108 - 0.044 * l, 0.024, -0.62); }
    finger(ha, 0.0105, 0.05, side * -0.044, -0.052, 0.014, -0.3, side * 0.55);
    return [sh, el, ha];
  }
  function leg(side) {
    const hp = joint(R.hips, side * 0.095, -0.05, 0);
    part(hp, limbGeo(0.415, 0.093, 0.06, 0.16, 0.28, 16), M.suit, 0, 0, 0, 1, 1, 1.08);
    part(hp, BOX, M.glow, side * 0.084, -0.2, 0, 0.008, 0.26, 0.02);
    const kn = joint(hp, 0, -0.42, 0);
    part(kn, SPH, M.suit, 0, 0, 0.004, 0.058, 0.06, 0.061);
    part(kn, SPH, M.plate, 0, 0.004, 0.042, 0.043, 0.054, 0.026);                                       // knee guard
    part(kn, limbGeo(0.38, 0.06, 0.039, 0.3, 0.24, 16), M.suit, 0, 0, -0.008, 0.95, 1, 1.13);          // the calf sits behind the shin
    const ft = joint(kn, 0, -0.385, 0);
    part(ft, SPH, M.suit, 0, 0, 0, 0.042, 0.042, 0.047);
    const foot = loft([[-0.078, 0.028, 0.028, 0, 0.06], [-0.056, 0.042, 0.045, 0, 0.043], [-0.01, 0.046, 0.05, 0, 0.038], [0.05, 0.047, 0.04, 0, 0.048], [0.11, 0.05, 0.03, 0, 0.058], [0.165, 0.046, 0.024, 0, 0.064], [0.196, 0.028, 0.015, 0, 0.073]], 14).rotateX(Math.PI / 2);
    part(ft, foot, M.suit);
    part(ft, BOX, M.plate, 0, -0.083, 0.058, 0.086, 0.012, 0.255);                                      // sole
    part(ft, BOX, M.glow, 0, -0.078, 0.06, 0.094, 0.006, 0.2);
    return [hp, kn, ft];
  }
  [R.shL, R.elL, R.haL] = arm(1);
  [R.shR, R.elR, R.haR] = arm(-1);
  [R.hipL, R.knL, R.ftL] = leg(1);
  [R.hipR, R.knR, R.ftR] = leg(-1);
  R.handL = R.haL; R.handR = R.haR;
  for (const [parent, mats] of bins) for (const [mat, geos] of mats) { const m = new THREE.Mesh(mergeGeometries(geos), mat); m.castShadow = true; parent.add(m); }
  return { hero, R, M };
}
