// ============================================================================
//  SKYTHREAD — the hero: an original armoured runner with cyan light-lines.
//  Built from tapered, muscle-shaped limbs on a 15-joint skeleton.
// ============================================================================
import * as THREE from 'three';

export const JOINTS = ['spine', 'chest', 'head', 'shL', 'elL', 'haL', 'shR', 'elR', 'haR', 'hipL', 'knL', 'ftL', 'hipR', 'knR', 'ftR'];

// a limb hanging down from its joint: radius r0 at the top, r1 at the bottom, with a muscle bulge
function limbGeo(len, r0, r1, bulge = 0.12, at = 0.3, seg = 12) {
  const pts = [new THREE.Vector2(0.001, -len - r1 * 0.55), new THREE.Vector2(r1 * 0.72, -len - r1 * 0.22)];
  for (let i = 8; i >= 0; i--) { const t = i / 8, r = (r0 + (r1 - r0) * t) * (1 + bulge * Math.exp(-(((t - at) / 0.24) ** 2))); pts.push(new THREE.Vector2(r, -len * t)); }
  pts.push(new THREE.Vector2(r0 * 0.72, r0 * 0.22), new THREE.Vector2(0.001, r0 * 0.5));
  return new THREE.LatheGeometry(pts, seg);
}

export function buildHero(scene) {
  const hero = new THREE.Group(); scene.add(hero);
  const M = {
    suit: new THREE.MeshStandardMaterial({ color: 0x1b2029, roughness: 0.58, metalness: 0.25 }),
    plate: new THREE.MeshStandardMaterial({ color: 0x39424f, roughness: 0.32, metalness: 0.7 }),
    glow: new THREE.MeshStandardMaterial({ color: 0x062a30, emissive: 0x2ef2ff, emissiveIntensity: 2.4, roughness: 0.4 }),
    ember: new THREE.MeshStandardMaterial({ color: 0x401500, emissive: 0xff7a1a, emissiveIntensity: 2.0 }),
    visor: new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.18, metalness: 0.9 }),
  };
  const SPH = new THREE.SphereGeometry(1, 20, 14), BOX = new THREE.BoxGeometry(1, 1, 1);
  const part = (parent, geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; parent.add(m); return m; };
  const joint = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };
  const R = {};

  // pelvis
  R.hips = joint(hero, 0, 0, 0);
  part(R.hips, SPH, M.suit, 0, 0, 0, 0.168, 0.118, 0.128);
  part(R.hips, BOX, M.plate, 0, 0.078, 0, 0.31, 0.046, 0.235);
  part(R.hips, BOX, M.glow, 0, 0.078, 0.119, 0.05, 0.03, 0.01);
  for (const s of [-1, 1]) part(R.hips, SPH, M.plate, s * 0.15, 0.0, 0, 0.045, 0.075, 0.085);   // hip guards

  // abdomen and chest
  R.spine = joint(R.hips, 0, 0.08, 0);
  part(R.spine, limbGeo(0.2, 0.132, 0.12, 0.05, 0.5, 14), M.suit, 0, 0.21, 0, 1, 1, 0.78);
  for (let k = 0; k < 3; k++) part(R.spine, BOX, M.plate, 0, 0.05 + k * 0.05, 0.088, 0.13 - k * 0.006, 0.036, 0.02);   // segmented core armour
  R.chest = joint(R.spine, 0, 0.2, 0);
  part(R.chest, SPH, M.suit, 0, 0.12, 0, 0.205, 0.172, 0.136);
  part(R.chest, SPH, M.suit, 0, 0.235, -0.012, 0.2, 0.062, 0.1);                                 // shoulder yoke
  for (const s of [-1, 1]) {
    part(R.chest, SPH, M.plate, s * 0.085, 0.16, 0.055, 0.105, 0.085, 0.085);                    // chest plates
    part(R.chest, SPH, M.suit, s * 0.1, 0.1, -0.06, 0.1, 0.13, 0.07);                            // shoulder blades
    const st = part(R.chest, BOX, M.glow, s * 0.082, 0.125, 0.139, 0.016, 0.2, 0.012); st.rotation.z = s * 0.5; st.rotation.x = -0.1;
    part(R.chest, BOX, M.glow, s * 0.198, 0.03, 0, 0.012, 0.2, 0.05);
  }
  part(R.chest, new THREE.OctahedronGeometry(1, 0), M.ember, 0, 0.165, 0.147, 0.05, 0.07, 0.02);
  part(R.chest, BOX, M.glow, 0, 0.1, -0.128, 0.014, 0.3, 0.012);                                  // spine light
  part(R.chest, new THREE.CylinderGeometry(0.047, 0.058, 0.1, 10), M.suit, 0, 0.31, 0);

  // head
  R.head = joint(R.chest, 0, 0.355, 0);
  part(R.head, SPH, M.suit, 0, 0.1, 0, 0.104, 0.122, 0.116);
  part(R.head, SPH, M.suit, 0, 0.045, 0.02, 0.086, 0.078, 0.092);                                // jaw
  part(R.head, new THREE.SphereGeometry(1, 24, 12, Math.PI / 2 - 1.0, 2.0, 1.15, 0.62), M.visor, 0, 0.1, 0.004, 0.11, 0.126, 0.12);
  const slit = new THREE.TorusGeometry(1, 0.06, 6, 28, 1.5); slit.rotateX(Math.PI / 2); slit.rotateY(0.75 - Math.PI / 2);
  part(R.head, slit, M.glow, 0, 0.095, 0.006, 0.114, 0.114, 0.124);
  part(R.head, BOX, M.glow, 0, 0.195, -0.02, 0.012, 0.03, 0.19);                                 // crest line
  for (const s of [-1, 1]) part(R.head, SPH, M.plate, s * 0.1, 0.09, -0.005, 0.02, 0.04, 0.04);  // ear pods

  function arm(side) {
    const sh = joint(R.chest, side * 0.218, 0.232, 0);
    part(sh, SPH, M.plate, side * 0.008, 0.0, 0, 0.082, 0.078, 0.084);                           // shoulder cap
    part(sh, limbGeo(0.285, 0.058, 0.045, 0.16, 0.32), M.suit);
    part(sh, BOX, M.glow, side * 0.056, -0.15, 0, 0.012, 0.19, 0.02);
    const el = joint(sh, 0, -0.285, 0);
    part(el, SPH, M.plate, 0, 0, -0.012, 0.046, 0.046, 0.05);                                    // elbow guard
    part(el, limbGeo(0.255, 0.047, 0.034, 0.2, 0.26), M.suit);
    part(el, limbGeo(0.12, 0.052, 0.044, 0.02, 0.5), M.plate, 0, -0.1, 0);                       // gauntlet
    part(el, BOX, M.glow, 0, -0.165, 0.046, 0.03, 0.05, 0.012);                                  // shooter light
    const ha = joint(el, 0, -0.262, 0);
    part(ha, BOX, M.plate, 0, -0.04, 0, 0.074, 0.08, 0.034);                                     // palm
    const fi = part(ha, BOX, M.suit, 0, -0.105, 0.008, 0.07, 0.07, 0.03); fi.rotation.x = -0.25; // fingers
    const th = part(ha, BOX, M.suit, side * -0.046, -0.05, 0.016, 0.024, 0.06, 0.026); th.rotation.z = side * 0.5;
    return [sh, el, ha];
  }
  function leg(side) {
    const hp = joint(R.hips, side * 0.095, -0.05, 0);
    part(hp, limbGeo(0.415, 0.087, 0.06, 0.14, 0.3, 14), M.suit);
    part(hp, BOX, M.glow, side * 0.08, -0.2, 0, 0.012, 0.27, 0.025);
    part(hp, SPH, M.plate, 0, -0.16, 0.058, 0.06, 0.11, 0.035);                                  // thigh plate
    const kn = joint(hp, 0, -0.42, 0);
    part(kn, SPH, M.plate, 0, 0, 0.036, 0.058, 0.062, 0.05);                                     // knee guard
    part(kn, limbGeo(0.38, 0.061, 0.04, 0.22, 0.27, 14), M.suit);
    part(kn, SPH, M.plate, 0, -0.2, 0.034, 0.045, 0.14, 0.03);                                   // shin plate
    const ft = joint(kn, 0, -0.385, 0);
    part(ft, SPH, M.suit, 0, 0, 0, 0.046, 0.046, 0.05);
    part(ft, BOX, M.plate, 0, -0.045, -0.012, 0.092, 0.085, 0.115);                              // heel
    const toe = part(ft, BOX, M.plate, 0, -0.058, 0.118, 0.096, 0.06, 0.17); toe.rotation.x = 0.08;
    part(ft, BOX, M.glow, 0, -0.086, 0.05, 0.098, 0.012, 0.26);                                  // sole light
    return [hp, kn, ft];
  }
  [R.shL, R.elL, R.haL] = arm(1);
  [R.shR, R.elR, R.haR] = arm(-1);
  [R.hipL, R.knL, R.ftL] = leg(1);
  [R.hipR, R.knR, R.ftR] = leg(-1);
  R.handL = R.haL; R.handR = R.haR;
  return { hero, R, M };
}
