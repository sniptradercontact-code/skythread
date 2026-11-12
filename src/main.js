// ============================================================================
//  SKYTHREAD — a web-swinging sandbox. Original hero, original city.
// ============================================================================
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { buildWorld, boxes, query, HALF, BORDER, makeWebTex, rnd } from './world.js';

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
const UP = new V3(0, 1, 0), DOWN = new V3(0, -1, 0);

// ---------------------------------------------------------------- renderer
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
const LOW = /low/.test(location.search);
const DPR = window.devicePixelRatio || 1;
// quality tiers: 0 = ultra (AO), 1 = high, 2 = medium, 3 = low
const QUALITY = [
  { name: 'ULTRA', pr: Math.min(DPR, 1.5), ao: true, bloom: true, sh: 2048 },
  { name: 'HIGH', pr: Math.min(DPR, 1.25), ao: false, bloom: true, sh: 2048 },
  { name: 'MEDIUM', pr: 1, ao: false, bloom: true, sh: 1536 },
  { name: 'LOW', pr: 0.66, ao: false, bloom: false, sh: 1024 },
];
let qIdx = LOW ? 3 : 2;
const PR = LOW ? 0.5 : QUALITY[qIdx].pr;
renderer.setPixelRatio(PR);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); setTimeout(() => location.reload(), 400); });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.1, 7000);

const world = buildWorld(scene, renderer);

// ---------------------------------------------------------------- sky + lights
const sky = new Sky(); sky.scale.setScalar(5000); scene.add(sky);
const envScene = new THREE.Scene(); const envSky = new Sky(); envSky.scale.setScalar(50); envScene.add(envSky);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true; sun.shadow.mapSize.set(LOW ? 1024 : 2048, LOW ? 1024 : 2048);
Object.assign(sun.shadow.camera, { left: -85, right: 85, top: 85, bottom: -85, near: 10, far: 1000 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05; sun.shadow.radius = 2;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xbfd3ff, 0x6b5640, 0.5); scene.add(hemi);
const lightDir = new V3();

const TOD = [
  { name: 'Golden Hour', elev: 16, azim: 235, turb: 4, ray: 1.3, mie: 0.003, sunColor: 0xffd2a0, sunI: 2.2, sky: 0xbfd3ff, gnd: 0x7a6650, hemiI: 0.75, fog: 0x8a95a3, fogD: 0.0009, exp: 0.46, win: 0.2, env: 0.3, clouds: 0.35 },
  { name: 'Midday', elev: 58, azim: 160, turb: 2.5, ray: 1.0, mie: 0.003, sunColor: 0xfff3e2, sunI: 2.3, sky: 0xcfe2ff, gnd: 0x6e6a60, hemiI: 0.75, fog: 0x93a7bc, fogD: 0.0008, exp: 0.42, win: 0.05, env: 0.3, clouds: 0.45 },
  { name: 'Night', elev: -4, azim: 250, turb: 2, ray: 0.6, mie: 0.003, sunColor: 0xa9bcff, sunI: 0.9, lightElev: 45, lightAzim: 120, sky: 0x5a6fa8, gnd: 0x1a1a24, hemiI: 0.55, fog: 0x141c34, fogD: 0.001, exp: 0.95, win: 2.4, env: 0.9, clouds: 0.2 },
];
let todIdx = 0;
function makeNightSky() {
  const W = 2048, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#02040b'); gr.addColorStop(0.32, '#07102a'); gr.addColorStop(0.47, '#1d2c55'); gr.addColorStop(0.5, '#35406a'); gr.addColorStop(0.53, '#141c34'); gr.addColorStop(1, '#05070d');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2200; i++) { const y = Math.pow(Math.random(), 1.6) * H * 0.46, a = Math.random(); g.fillStyle = `rgba(255,255,255,${0.25 + a * 0.75})`; const r = a > 0.97 ? 1.6 : 0.8; g.fillRect(Math.random() * W, y, r, r); }
  // moon
  const mx = W * 0.33, my = H * 0.2; const mg = g.createRadialGradient(mx, my, 0, mx, my, 60); mg.addColorStop(0, 'rgba(255,250,235,1)'); mg.addColorStop(0.25, 'rgba(240,240,255,0.95)'); mg.addColorStop(0.3, 'rgba(180,200,255,0.25)'); mg.addColorStop(1, 'rgba(120,150,255,0)');
  g.fillStyle = mg; g.fillRect(mx - 60, my - 60, 120, 120);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.mapping = THREE.EquirectangularReflectionMapping; return t;
}
const nightSky = makeNightSky();
function applyTOD(i) {
  const t = TOD[i]; todIdx = i;
  const sunDir = new V3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - t.elev), THREE.MathUtils.degToRad(t.azim));
  for (const s of [sky, envSky]) {
    const u = s.material.uniforms;
    u.turbidity.value = t.turb; u.rayleigh.value = t.ray; u.mieCoefficient.value = t.mie; u.mieDirectionalG.value = 0.86;
    u.sunPosition.value.copy(sunDir);
    if (u.cloudCoverage) { u.cloudCoverage.value = t.clouds; u.cloudDensity.value = 0.35; }
  }
  if (t.lightElev != null) lightDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - t.lightElev), THREE.MathUtils.degToRad(t.lightAzim));
  else lightDir.copy(sunDir);
  sun.color.set(t.sunColor); sun.intensity = t.sunI;
  hemi.color.set(t.sky); hemi.groundColor.set(t.gnd); hemi.intensity = t.hemiI;
  scene.fog = new THREE.FogExp2(t.fog, t.fogD);
  renderer.toneMappingExposure = t.exp;
  for (const m of world.facadeMats) m.emissiveIntensity = t.win;
  world.lampMat.emissiveIntensity = t.name === 'Night' ? 6 : 0.3;
  world.headMat.emissiveIntensity = t.name === 'Night' ? 7 : 0.5;
  world.tailMat.emissiveIntensity = t.name === 'Night' ? 4 : 1.0;
  scene.environmentIntensity = t.env;
  if (envRT) envRT.dispose();
  const night = t.name === 'Night';
  sky.visible = !night; scene.background = night ? nightSky : null;
  envRT = night ? pmrem.fromEquirectangular(nightSky) : pmrem.fromScene(envScene, 0, 0.1, 200);
  scene.environment = envRT.texture;
  flash(t.name.toUpperCase());
}

// ---------------------------------------------------------------- post
const rt = new THREE.WebGLRenderTarget(innerWidth * PR, innerHeight * PR, { type: THREE.HalfFloatType, samples: LOW ? 0 : 2 });
const composer = new EffectComposer(renderer, rt);
composer.setPixelRatio(PR); composer.setSize(innerWidth, innerHeight);
composer.addPass(new RenderPass(scene, camera));
// ground-truth ambient occlusion: only allocated while ULTRA is active (it is
// expensive in GPU memory, and allocating it on weak hardware can kill the context)
let gtao = null;
function ensureGtao(on) {
  if (on && !gtao && !LOW) {
    gtao = new GTAOPass(scene, camera, innerWidth, innerHeight);
    gtao.updateGtaoMaterial({ radius: 2.2, distanceExponent: 1.5, thickness: 2.5, scale: 1.25, samples: 12 });
    gtao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 16 });
    gtao.blendIntensity = 0.9;
    composer.insertPass(gtao, 1);
  } else if (!on && gtao) {
    composer.removePass(gtao); gtao.dispose(); gtao = null;
  }
}
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.12, 0.3, 1.6);
composer.addPass(bloom);
composer.addPass(new OutputPass());
function setQuality(i, announce = true) {
  qIdx = clamp(i, 0, QUALITY.length - 1); const q = QUALITY[qIdx];
  const pr = LOW ? 0.5 : q.pr;
  renderer.setPixelRatio(pr); composer.setPixelRatio(pr);
  ensureGtao(q.ao); bloom.enabled = q.bloom;
  if (sun.shadow.mapSize.x !== q.sh) {
    sun.shadow.mapSize.set(q.sh, q.sh);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
  }
  resize();
  if (announce) flash('GRAPHICS: ' + q.name);
}
// frame-time monitor: steps quality down automatically if the game runs slow
const perf = { t: 0, frames: 0, slow: 0, settled: false };
function autoQuality(dt) {
  if (perf.settled || !started || LOW) return;
  perf.t += dt; perf.frames++;
  if (perf.t >= 2) {
    const fps = perf.frames / perf.t; perf.t = 0; perf.frames = 0;
    if (fps < 26 && qIdx < QUALITY.length - 1) { setQuality(QUALITY.length - 1); }
    else if (fps < 48 && qIdx < QUALITY.length - 1) { setQuality(qIdx + 1); }
    else if (fps >= 48) { perf.slow++; if (perf.slow >= 3) perf.settled = true; }
  }
}

// ---------------------------------------------------------------- hero (original design)
const hero = new THREE.Group(); scene.add(hero);
const M = {
  suit: new THREE.MeshStandardMaterial({ color: 0x1c212b, roughness: 0.55, metalness: 0.3 }),
  plate: new THREE.MeshStandardMaterial({ color: 0x343c4a, roughness: 0.35, metalness: 0.65 }),
  glow: new THREE.MeshStandardMaterial({ color: 0x062a30, emissive: 0x2ef2ff, emissiveIntensity: 2.4, roughness: 0.4 }),
  ember: new THREE.MeshStandardMaterial({ color: 0x401500, emissive: 0xff7a1a, emissiveIntensity: 2.0 }),
  visor: new THREE.MeshStandardMaterial({ color: 0x05070a, roughness: 0.2, metalness: 0.9 }),
};
function limbGeo(len, r) { const g = new THREE.CapsuleGeometry(r, Math.max(0.01, len - 2 * r), 6, 12); g.translate(0, -len / 2, 0); return g; }
function part(parent, geo, mat, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1) { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.scale.set(sx, sy, sz); m.castShadow = true; parent.add(m); return m; }
const SPH = new THREE.SphereGeometry(1, 20, 14);
const BOX = new THREE.BoxGeometry(1, 1, 1);
const R = {};
R.hips = new THREE.Group(); hero.add(R.hips);
part(R.hips, SPH, M.suit, 0, 0.02, 0, 0.17, 0.12, 0.12);
part(R.hips, BOX, M.plate, 0, 0.06, 0, 0.3, 0.05, 0.22); // belt
R.spine = new THREE.Group(); R.spine.position.y = 0.06; R.hips.add(R.spine);
part(R.spine, limbGeo(0.3, 0.13), M.suit, 0, 0.3, 0, 1.0, 1, 0.78);
part(R.spine, SPH, M.suit, 0, 0.36, 0, 0.215, 0.19, 0.145);
part(R.spine, SPH, M.plate, 0, 0.4, 0.035, 0.19, 0.14, 0.12); // chest armour
const emb = part(R.spine, new THREE.OctahedronGeometry(1, 0), M.ember, 0, 0.4, 0.155, 0.055, 0.075, 0.02);
for (const s of [-1, 1]) {
  const stripe = part(R.spine, BOX, M.glow, s * 0.085, 0.33, 0.14, 0.018, 0.22, 0.012); stripe.rotation.z = s * 0.45;
  part(R.spine, BOX, M.glow, s * 0.2, 0.2, 0, 0.012, 0.22, 0.05);
}
part(R.spine, new THREE.CylinderGeometry(0.05, 0.06, 0.1, 10), M.suit, 0, 0.55, 0);
R.head = new THREE.Group(); R.head.position.y = 0.6; R.spine.add(R.head);
part(R.head, SPH, M.suit, 0, 0.1, 0, 0.112, 0.128, 0.12);
const visorGeo = new THREE.SphereGeometry(1, 24, 12, Math.PI / 2 - 1.0, 2.0, 1.15, 0.62);
part(R.head, visorGeo, M.visor, 0, 0.1, 0.004, 0.118, 0.132, 0.124);
const slit = new THREE.TorusGeometry(1, 0.06, 6, 28, 1.5); slit.rotateX(Math.PI / 2); slit.rotateY(0.75 - Math.PI / 2);
part(R.head, slit, M.glow, 0, 0.095, 0.006, 0.122, 0.12, 0.128);
part(R.head, BOX, M.glow, 0, 0.2, -0.02, 0.012, 0.03, 0.2); // crest line
function arm(side) {
  const sh = new THREE.Group(); sh.position.set(side * 0.215, 0.47, 0); R.spine.add(sh);
  part(sh, SPH, M.plate, 0, -0.01, 0, 0.08, 0.075, 0.08);
  part(sh, limbGeo(0.3, 0.056), M.suit);
  part(sh, BOX, M.glow, side * 0.052, -0.16, 0, 0.012, 0.2, 0.02);
  const el = new THREE.Group(); el.position.y = -0.29; sh.add(el);
  part(el, limbGeo(0.27, 0.05), M.suit);
  part(el, limbGeo(0.14, 0.054), M.plate, 0, -0.1, 0); // gauntlet
  part(el, BOX, M.glow, 0, -0.17, 0.05, 0.03, 0.05, 0.012); // shooter light
  const hand = new THREE.Group(); hand.position.y = -0.3; el.add(hand);
  part(hand, SPH, M.plate, 0, 0, 0, 0.045, 0.055, 0.035);
  return [sh, el, hand];
}
function leg(side) {
  const hp = new THREE.Group(); hp.position.set(side * 0.1, -0.04, 0); R.hips.add(hp);
  part(hp, limbGeo(0.44, 0.077), M.suit);
  part(hp, BOX, M.glow, side * 0.074, -0.2, 0, 0.012, 0.28, 0.025);
  const kn = new THREE.Group(); kn.position.y = -0.43; hp.add(kn);
  part(kn, SPH, M.plate, 0, 0, 0.04, 0.06, 0.06, 0.05);
  part(kn, limbGeo(0.42, 0.06), M.suit);
  part(kn, BOX, M.plate, 0, -0.42, 0.045, 0.1, 0.08, 0.24); // boot
  part(kn, BOX, M.glow, 0, -0.46, 0.0, 0.102, 0.012, 0.2);
  return [hp, kn];
}
[R.shL, R.elL, R.handL] = arm(1);
[R.shR, R.elR, R.handR] = arm(-1);
[R.hipL, R.knL] = leg(1);
[R.hipR, R.knR] = leg(-1);

const JOINTS = ['spine', 'head', 'shL', 'elL', 'shR', 'elR', 'hipL', 'knL', 'hipR', 'knR'];
function newPose() { const o = { hipsY: 0 }; for (const j of JOINTS) o[j] = [0, 0, 0]; return o; }
const cur = newPose(), tgt = newPose();
function S(j, x, y, z) { tgt[j][0] = x; tgt[j][1] = y; tgt[j][2] = z; }
function sym(base, x, y, z) { S(base + 'L', x, y, z); S(base + 'R', x, -y, -z); }

// ---------------------------------------------------------------- web line + splats
const ropeMat = new THREE.MeshBasicMaterial({ color: 0xeaf6ff });
const ropeGeo = new THREE.CylinderGeometry(0.03, 0.03, 1, 6, 1, true); ropeGeo.translate(0, 0.5, 0);
const rope = new THREE.Mesh(ropeGeo, ropeMat); rope.visible = false; rope.frustumCulled = false; scene.add(rope);
const webTex = makeWebTex();
const splats = [];
for (let i = 0; i < 14; i++) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6), new THREE.MeshBasicMaterial({ map: webTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 }));
  m.visible = false; m.userData.t = 0; scene.add(m); splats.push(m);
}
let splatI = 0;
function addSplat(p, n) {
  const m = splats[splatI++ % splats.length];
  m.position.copy(p).addScaledVector(n, 0.06); m.lookAt(p.x + n.x, p.y + n.y, p.z + n.z); m.rotateZ(rnd() * TAU);
  m.visible = true; m.userData.t = 5; m.material.opacity = 1;
}

// ---------------------------------------------------------------- player state
const HX = 0.35, HY = 0.9, HZ = 0.35;
const G = -32;
const P = {
  pos: new V3(), prev: new V3(), vel: new V3(), state: 'air', grounded: false,
  anchor: new V3(), pivot: new V3(), swingDir: new V3(), anchorN: new V3(), ropeLen: 0, ropeT: 0, hand: 'R',
  wallN: new V3(), wallMove: new V3(0, 1, 0), hitN: new V3(), wallHit: false, impact: 0,
  zip: null, facing: new V3(0, 0, 1), timeInAir: 0, swingArmed: false, swingCd: 0, wallCd: 0,
  landT: 0, rpos: new V3(), trick: null, combo: 0, style: 0, runPh: 0, aimW: 0, aimW2: 0, baseQ: new THREE.Quaternion(), offset: new V3(), inp: new V3(), best: 0,
};
const tv = new V3(), tv2 = new V3(), tv3 = new V3(), tq = new THREE.Quaternion(), tq2 = new THREE.Quaternion(), tm = new THREE.Matrix4();
const qbuf = [];

// ---------------------------------------------------------------- input
const keys = {};
const ev = { jump: false, swing: false, zip: false, trick: null };
let mouse0 = false, locked = false, everLocked = false, started = false, lastMouse = 0, dragging = false;
const C = { yaw: 0, pitch: -0.2, dist: 5, occl: 5, hist: [8, 8, 8, 8, 8, 8, 8], hi: 0, floor: 0.5, fov: 70, target: new V3(), shake: 0 };
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (e.repeat) return;
  if (e.code === 'Space') { ev.jump = true; ev.swing = true; }
  if (e.code === 'KeyF') ev.zip = true;
  if (e.code === 'KeyQ') ev.trick = 'q';
  if (e.code === 'KeyZ') ev.trick = 'z';
  if (e.code === 'KeyE') ev.trick = 'e';
  if (e.code === 'KeyR') ev.trick = 'r';
  if (e.code === 'KeyT') applyTOD((todIdx + 1) % TOD.length);
  if (e.code === 'KeyX') { respawn(false); P.style = 0; P.combo = 0; flash('RESTARTED'); }
  if (e.code === 'KeyM') toggleMute();
  if (e.code === 'KeyG') { perf.settled = true; setQuality((qIdx + QUALITY.length - 1) % QUALITY.length); }
  if (e.code === 'KeyH') document.getElementById('help').classList.toggle('hide');
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse0 = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  if (!started) return;
  if (!locked) tryLock();
  dragging = true;
  if (e.button === 0) { mouse0 = true; ev.swing = true; if (P.state === 'ground') ev.jump = true; }
  if (e.button === 2) ev.zip = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouse0 = false; dragging = false; });
addEventListener('mousemove', (e) => {
  if (!(locked || (dragging && !everLocked))) return;
  const s = 0.0022;
  C.yaw -= e.movementX * s; C.pitch = clamp(C.pitch - e.movementY * s, -1.35, 0.75);
  lastMouse = performance.now();
});
function tryLock() { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) {} }
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) everLocked = true;
  document.getElementById('pause').classList.toggle('show', started && everLocked && !locked);
});
document.getElementById('start').addEventListener('click', () => {
  document.getElementById('help').classList.remove('hide');
  setTimeout(() => document.getElementById('help').classList.add('hide'), 40000);
  started = true; document.getElementById('start').classList.add('gone'); initAudio(); tryLock();
});
document.getElementById('pause').addEventListener('click', () => tryLock());
// touch-free fallback for arrow keys looking
function camFwdH(out) { return out.set(Math.sin(C.yaw), 0, Math.cos(C.yaw)); }
function camRightH(out) { return out.set(-Math.cos(C.yaw), 0, Math.sin(C.yaw)); }
function moveInput(out) {
  const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), r = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  out.set(0, 0, 0);
  if (f) out.addScaledVector(camFwdH(tv3), f);
  if (r) out.addScaledVector(camRightH(tv3), r);
  if (out.lengthSq() > 1) out.normalize();
  return out;
}
const shiftDown = () => !!(keys.ShiftLeft || keys.ShiftRight);

// ---------------------------------------------------------------- geometry queries
function rayBox(o, d, b, maxT) {
  let tmin = 0, tmax = maxT, axis = -1;
  for (let a = 0; a < 3; a++) {
    const oo = a === 0 ? o.x : a === 1 ? o.y : o.z, dd = a === 0 ? d.x : a === 1 ? d.y : d.z;
    const mn = a === 0 ? b.minX : a === 1 ? b.minY : b.minZ, mx = a === 0 ? b.maxX : a === 1 ? b.maxY : b.maxZ;
    if (Math.abs(dd) < 1e-9) { if (oo < mn || oo > mx) return -1; continue; }
    let t1 = (mn - oo) / dd, t2 = (mx - oo) / dd; if (t1 > t2) { const s = t1; t1 = t2; t2 = s; }
    if (t1 > tmin) { tmin = t1; axis = a; }
    if (t2 < tmax) tmax = t2;
    if (tmin > tmax) return -1;
  }
  rayBox.axis = axis; return tmin;
}
function raycastWorld(o, d, maxT, solidOnly = true) {
  let best = maxT, hit = null, ax = -1;
  const ex = o.x + d.x * maxT, ez = o.z + d.z * maxT;
  query(Math.min(o.x, ex), Math.max(o.x, ex), Math.min(o.z, ez), Math.max(o.z, ez), qbuf);
  for (const b of qbuf) {
    if (solidOnly && b.slab) continue;
    const t = rayBox(o, d, b, best);
    if (t > 0 && t < best) { best = t; hit = b; ax = rayBox.axis; }
  }
  if (!hit) return null;
  const n = new V3(); if (ax === 0) n.x = -Math.sign(d.x); else if (ax === 1) n.y = -Math.sign(d.y); else n.z = -Math.sign(d.z);
  return { t: best, box: hit, n, p: o.clone().addScaledVector(d, best) };
}

// anchor search: closest point on nearby buildings to an "ideal" point ahead & above
function findAnchor() {
  const p = P.pos, v = P.vel;
  const fwd = camFwdH(tv);
  const hs = Math.hypot(v.x, v.z);
  if (hs > 4) { tv2.set(v.x / hs, 0, v.z / hs); fwd.multiplyScalar(0.7).addScaledVector(tv2, 0.3).normalize(); }
  const side = camRightH(tv2).multiplyScalar(P.hand === 'R' ? 1 : -1); // alternate hands -> zig-zag
  const reach = 16 + clamp(hs, 0, 60) * 0.3;
  let best = null, bestS = 1e9;
  const cands = [[reach, 30, 9], [reach * 0.8, 24, -9], [reach * 0.55, 18, 16]];
  for (const [fw, upd, sd] of cands) {
    const ideal = tv3.copy(p).addScaledVector(fwd, fw).addScaledVector(side, sd); ideal.y += upd;
    query(ideal.x - 45, ideal.x + 45, ideal.z - 45, ideal.z + 45, qbuf);
    for (const b of qbuf) {
      if (b.slab || b.maxY < p.y + 4) continue;
      const q = new V3(clamp(ideal.x, b.minX, b.maxX), clamp(ideal.y, b.minY, b.maxY), clamp(ideal.z, b.minZ, b.maxZ));
      const n = new V3();
      const inside = q.x > b.minX && q.x < b.maxX && q.z > b.minZ && q.z < b.maxZ;
      if (ideal.y >= b.maxY && inside) { // above roof: use roof edge nearest the player
        q.x = clamp(p.x, b.minX, b.maxX); q.z = clamp(p.z, b.minZ, b.maxZ); q.y = b.maxY;
        if (q.x === b.minX) n.x = -1; else if (q.x === b.maxX) n.x = 1; else if (q.z === b.minZ) n.z = -1; else if (q.z === b.maxZ) n.z = 1; else continue;
      } else if (inside) { // ideal inside the building -> nearest side face
        const dx0 = q.x - b.minX, dx1 = b.maxX - q.x, dz0 = q.z - b.minZ, dz1 = b.maxZ - q.z, m = Math.min(dx0, dx1, dz0, dz1);
        if (m === dx0) { q.x = b.minX; n.x = -1; } else if (m === dx1) { q.x = b.maxX; n.x = 1; } else if (m === dz0) { q.z = b.minZ; n.z = -1; } else { q.z = b.maxZ; n.z = 1; }
      } else {
        if (ideal.x < b.minX) n.x = -1; else if (ideal.x > b.maxX) n.x = 1; else if (ideal.z < b.minZ) n.z = -1; else n.z = 1;
      }
      if (q.y < p.y + 4) continue;
      const dist = q.distanceTo(p);
      if (dist < 8 || dist > 75) continue;
      const facing = n.x * fwd.x + n.z * fwd.z; // < 0: wall faces us (building dead ahead)
      const clear = q.y - dist; // lowest point of the arc
      const s = q.distanceTo(ideal) + (n.y > 0 ? 6 : 0) + (facing < -0.5 ? 26 : 0) + Math.max(0, 6 - clear) * 0.8 + Math.max(0, 14 - (q.y - p.y)) * 0.7;
      if (s < bestS) { bestS = s; best = { p: q, n }; }
    }
    if (best && bestS < 30) break;
  }
  if (best) best.dir = fwd.clone();
  return bestS < 42 ? best : null;
}

let zipInfo = null;
function computeZip() {
  zipInfo = null;
  if (P.state === 'zip') return;
  const o = camera.position, d = camera.getWorldDirection(tv);
  const h = raycastWorld(o, d, 260);
  if (!h || h.p.distanceTo(P.pos) > 170 || h.p.distanceTo(P.pos) < 3) return;
  const b = h.box;
  if (h.n.y > 0.5 || b.maxY - h.p.y < 7) {
    const T = h.p.clone(); T.y = b.maxY;
    let out = h.n.clone(); out.y = 0;
    if (out.lengthSq() < 0.5) { out.set(0, 0, 0); }
    const target = T.clone().addScaledVector(out, 0.8); target.y += 1.4;
    zipInfo = { hit: T, target, n: h.n.clone(), launch: true };
  } else if (Math.abs(h.n.y) < 0.5) {
    zipInfo = { hit: h.p.clone(), target: h.p.clone().addScaledVector(h.n, 0.45), n: h.n.clone(), launch: false };
  }
}

// ---------------------------------------------------------------- actions
function tryAttach() {
  const a = findAnchor(); if (!a) return false;
  P.hand = P.hand === 'R' ? 'L' : 'R';
  P.state = 'swing'; P.anchor.copy(a.p); P.anchorN.copy(a.n);
  // physics pivot: pull the anchor's sideways offset toward the travel line so the arc carries you down the street
  P.swingDir.copy(a.dir);
  const perp = tv.set(-a.dir.z, 0, a.dir.x);
  const lat = (a.p.x - P.pos.x) * perp.x + (a.p.z - P.pos.z) * perp.z;
  P.pivot.copy(a.p).addScaledVector(perp, -lat * 0.85);
  const d0 = P.pivot.distanceTo(P.pos);
  P.ropeLen = d0 + clamp(d0 * 0.12, 1.5, 5); P.ropeT = 0; // slack: free-fall into the arc instead of snapping onto the line
  if (P.trick) endTrick(true);
  addSplat(a.p, a.n); thwip();
  return true;
}
function release(auto) {
  P.state = 'air'; P.timeInAir = 0; P.swingArmed = false; P.swingCd = 0.22;
  const v = P.vel;
  if (v.y > -6 && v.y < 14) v.y += 3.5;
  const hs = Math.hypot(v.x, v.z);
  if (hs > 1 && hs < 62) { v.x += (v.x / hs) * 4; v.z += (v.z / hs) * 4; }
  P.combo++; addStyle(15, null);
  if (!P.trick && hs > 28 && v.y > 4 && rnd() < 0.2) startTrick(['q', 'e', 'r'][(rnd() * 3) | 0]);
}
function startZip(z) {
  if (P.trick) endTrick(true);
  P.state = 'zip'; P.zip = { ...z, from: P.pos.clone(), t: 0, speed: Math.max(28, P.vel.length()) };
  P.hand = 'R'; P.ropeT = 0; addSplat(z.hit, z.n); thwip(1.3);
}
function enterWall(n) {
  P.state = 'wall'; P.wallN.copy(n); P.vel.set(0, Math.max(0, P.vel.y) * 0.4, 0);
  if (P.trick) endTrick(true);
}
function land() {
  const imp = P.impact;
  if (P.trick) { endTrick(true); flash('BAIL!'); P.combo = 0; }
  if (P.combo >= 3) flash(`COMBO x${P.combo} BANKED`);
  P.combo = 0; P.state = 'ground';
  if (imp > 30) { P.landT = 0.55; P.vel.x *= 0.25; P.vel.z *= 0.25; C.shake = 0.45; thud(1); }
  else if (imp > 16) { P.landT = 0.18; C.shake = 0.12; thud(0.5); }
}

// ---------------------------------------------------------------- tricks
const TRICKS = {
  q: { name: 'FRONT FLIP', axis: new V3(1, 0, 0), ang: TAU, dur: 0.6, pose: 'tuck', pts: 100 },
  z: { name: 'BACKFLIP', axis: new V3(1, 0, 0), ang: -TAU, dur: 0.66, pose: 'tuck', pts: 120 },
  e: { name: 'CORKSCREW', axis: new V3(0, 0, 1), ang: TAU, dur: 0.7, pose: 'spread', pts: 150 },
  r: { name: '360 SPIN', axis: new V3(0, 1, 0), ang: TAU, dur: 0.55, pose: 'spread', pts: 90 },
  d: { name: 'DOUBLE FLIP', axis: new V3(1, 0, 0), ang: 2 * TAU, dur: 0.95, pose: 'tuck', pts: 250 },
};
function startTrick(k) {
  if (P.trick) return;
  if (P.state !== 'air') return;
  P.trick = { ...TRICKS[k], t: 0 };
}
function endTrick(cancel) {
  const t = P.trick; P.trick = null;
  if (!cancel && t) { P.combo++; addStyle(t.pts, t.name); }
}
function addStyle(pts, name) {
  const mult = Math.max(1, P.combo);
  P.style += pts * mult;
  if (name) popTrick(`${name}  +${pts * mult}`);
}

// ---------------------------------------------------------------- physics step
function step(dt) {
  const p = P.pos, v = P.vel;
  P.prev.copy(p);
  const inp = moveInput(P.inp);
  const shift = shiftDown();
  const swingHeld = !!(keys.Space || mouse0);
  P.swingCd -= dt; P.wallCd -= dt; P.timeInAir += dt; P.landT -= dt;
  const jumpEv = ev.jump, swingEv = ev.swing, zipEv = ev.zip;
  ev.jump = ev.swing = ev.zip = false;
  if (swingEv && (P.state === 'air')) P.swingArmed = true;
  if (zipEv && zipInfo && P.state !== 'zip') startZip(zipInfo);

  switch (P.state) {
    case 'ground': {
      const slow = P.landT > 0 ? 0.15 : 1;
      const sp = (shift ? 26 : 12) * slow;
      const tx = inp.x * sp, tz = inp.z * sp;
      const a = (inp.lengthSq() > 0.01 ? 70 : 50) * dt;
      const dx = tx - v.x, dz = tz - v.z, dl = Math.hypot(dx, dz);
      if (dl > a) { v.x += (dx / dl) * a; v.z += (dz / dl) * a; } else { v.x = tx; v.z = tz; }
      v.y += G * dt;
      if (jumpEv && P.landT <= 0.1) {
        v.y = shift ? 17 : 15; P.state = 'air'; P.timeInAir = 0; P.swingArmed = false; whoosh(0.5);
      }
      break;
    }
    case 'air': {
      const dive = shift && v.y < 6;
      v.y += G * (dive ? 2.1 : 1) * dt;
      const along = v.x * inp.x + v.z * inp.z;
      if (inp.lengthSq() > 0.01 && along < 32) { v.x += inp.x * 16 * dt; v.z += inp.z * 16 * dt; }
      if (v.y < (dive ? -95 : -68)) v.y = dive ? -95 : -68;
      if (swingHeld && P.swingCd <= 0 && (P.swingArmed || P.timeInAir > 0.28)) tryAttach();
      break;
    }
    case 'swing': {
      v.y += G * dt;
      const n = tv.subVectors(p, P.pivot); const len = n.length(); n.divideScalar(len);
      const hasIn = inp.lengthSq() > 0.01;
      // steer: blend travel direction toward input / camera
      const want = hasIn ? tv2.copy(inp) : camFwdH(tv2);
      P.swingDir.lerp(want, damp(hasIn ? 2.2 : 0.9, dt)).normalize();
      // move the pivot gently with the steering so turns feel responsive
      const dir = tv3.copy(P.swingDir);
      dir.addScaledVector(n, -dir.dot(n));
      if (dir.lengthSq() > 0.01) { dir.normalize(); v.addScaledVector(dir, (hasIn ? 9 : 5) * dt); }
      // pump at the bottom of the arc for speed (hold forward)
      if (hasIn && v.y < 4 && len > P.ropeLen * 0.96) { const hv = Math.hypot(v.x, v.z); if (hv > 2 && hv < 55) v.addScaledVector(tv3.set(v.x / hv, 0, v.z / hv), 5 * dt); }
      // bleed sideways drift (relative to the steering direction)
      const sx = -P.swingDir.z, sz = P.swingDir.x, lat = v.x * sx + v.z * sz;
      const k = damp(1.1, dt); v.x -= sx * lat * k; v.z -= sz * lat * k;
      // reel in gently; reel fast if the arc would hit the street
      const floor = P.pivot.y - P.ropeLen;
      P.ropeLen = Math.max(9, P.ropeLen - (floor < 6 ? 6 + (6 - floor) * 3 : 0.8) * dt);
      if (!swingHeld) release(false);
      else if (p.y > P.pivot.y - 1.5) release(true);
      else { // past ~55 degrees forward on the up-swing: let go automatically and carry momentum
        const fwdOff = (p.x - P.pivot.x) * P.swingDir.x + (p.z - P.pivot.z) * P.swingDir.z;
        if (v.y > 0 && v.y < 6 && fwdOff > len * 0.55) release(true);
      }
      break;
    }
    case 'zip': {
      const z = P.zip; z.t += dt; z.speed = Math.min(80, z.speed + 140 * dt);
      const d = tv.subVectors(z.target, p); const dist = d.length();
      if (dist < z.speed * dt * 1.3 || z.t > 3.5) {
        p.copy(z.target);
        if (z.launch) {
          const dh = tv2.set(z.target.x - z.from.x, 0, z.target.z - z.from.z); if (dh.lengthSq() < 0.01) camFwdH(dh); dh.normalize();
          v.set(dh.x * 13, 22, dh.z * 13);
          P.state = 'air'; P.timeInAir = 0.3; P.swingArmed = false;
          popTrick('POINT LAUNCH'); startTrick(rnd() < 0.5 ? 'd' : 'q'); whoosh(1);
        } else { enterWall(z.n); }
        P.zip = null;
      } else v.copy(d).multiplyScalar(z.speed / dist);
      break;
    }
    case 'wall': {
      const n = P.wallN;
      const L = tv.set(n.z, 0, -n.x); // lateral axis along wall
      const fk = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), rk = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
      const lat = rk * Math.sign(camRightH(tv2).dot(L) || 1);
      const sp = shift ? 21 : 9;
      v.set(0, fk * sp, 0).addScaledVector(L, lat * sp * 0.75).addScaledVector(n, -2);
      if (fk || lat) P.wallMove.set(0, fk, 0).addScaledVector(L, lat).normalize();
      if (jumpEv) {
        v.copy(n).multiplyScalar(15); v.y = 12; v.addScaledVector(inp, 5);
        P.state = 'air'; P.timeInAir = 0; P.wallCd = 0.4; P.swingArmed = false; startTrick('z'); whoosh(0.8);
      }
      break;
    }
  }
  const spd = v.length(); if (spd > 90) v.multiplyScalar(90 / spd);
  p.addScaledVector(v, dt);
  if (P.state === 'swing') {
    const d = tv.subVectors(p, P.pivot), len = d.length();
    if (len > P.ropeLen) { d.divideScalar(len); const over = len - P.ropeLen; p.addScaledVector(d, -Math.min(over, over * 0.28 + 0.02)); const vr = v.dot(d); if (vr > 0) v.addScaledVector(d, -vr * 0.88); }
  }
  collide();
  postCollide(inp, jumpEv);
  if (p.y < -2.2) respawn(true);
}

function collide() {
  const p = P.pos, v = P.vel, pr = P.prev;
  P.grounded = false; P.wallHit = false; P.impact = 0;
  const onIsland = Math.abs(p.x) < HALF + BORDER && Math.abs(p.z) < HALF + BORDER;
  if (onIsland && p.y < HY) { p.y = HY; if (v.y < 0) { P.impact = -v.y; v.y = 0; } P.grounded = true; }
  query(p.x - 2, p.x + 2, p.z - 2, p.z + 2, qbuf);
  for (const b of qbuf) {
    if (!(p.x + HX > b.minX && p.x - HX < b.maxX && p.y + HY > b.minY && p.y - HY < b.maxY && p.z + HZ > b.minZ && p.z - HZ < b.maxZ)) continue;
    const feet = p.y - HY;
    if (b.maxY - feet < 0.5 && v.y <= 1) { p.y = b.maxY + HY; if (v.y < 0) { P.impact = Math.max(P.impact, -v.y); v.y = 0; } P.grounded = true; continue; }
    const e = 1e-4;
    const opts = [];
    if (pr.x + HX <= b.minX + e) opts.push([(p.x + HX) - b.minX, 1]);
    if (pr.x - HX >= b.maxX - e) opts.push([b.maxX - (p.x - HX), 0]);
    if (pr.y - HY >= b.maxY - e) opts.push([b.maxY - (p.y - HY), 2]);
    if (pr.y + HY <= b.minY + e) opts.push([(p.y + HY) - b.minY, 3]);
    if (pr.z + HZ <= b.minZ + e) opts.push([(p.z + HZ) - b.minZ, 5]);
    if (pr.z - HZ >= b.maxZ - e) opts.push([b.maxZ - (p.z - HZ), 4]);
    if (!opts.length) opts.push([b.maxX - (p.x - HX), 0], [(p.x + HX) - b.minX, 1], [b.maxY - (p.y - HY), 2], [(p.z + HZ) - b.minZ, 5], [b.maxZ - (p.z - HZ), 4]);
    let bi = 0; for (let i = 1; i < opts.length; i++) if (opts[i][0] < opts[bi][0]) bi = i;
    const [pen, ax] = opts[bi];
    switch (ax) {
      case 0: p.x += pen; if (v.x < 0) v.x = 0; P.wallHit = true; P.hitN.set(1, 0, 0); break;
      case 1: p.x -= pen; if (v.x > 0) v.x = 0; P.wallHit = true; P.hitN.set(-1, 0, 0); break;
      case 2: p.y += pen; if (v.y < 0) { P.impact = Math.max(P.impact, -v.y); v.y = 0; } P.grounded = true; break;
      case 3: p.y -= pen; if (v.y > 0) v.y = 0; break;
      case 4: p.z += pen; if (v.z < 0) v.z = 0; P.wallHit = true; P.hitN.set(0, 0, 1); break;
      case 5: p.z -= pen; if (v.z > 0) v.z = 0; P.wallHit = true; P.hitN.set(0, 0, -1); break;
    }
  }
}

function postCollide(inp, jumpEv) {
  const v = P.vel;
  if (P.state === 'wall') {
    const fk = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    if (P.grounded && fk < 0) { P.state = 'ground'; return; }
    if (!P.wallHit || P.hitN.dot(P.wallN) < 0.9) {
      if (fk > 0) { // crested the top -> vault onto the roof
        v.copy(P.wallN).multiplyScalar(-7); v.y = 10; P.state = 'air'; P.timeInAir = 0.3; P.wallCd = 0.5; P.swingArmed = false; whoosh(0.6);
      } else { P.state = 'air'; P.timeInAir = 0.3; P.wallCd = 0.3; }
    }
    return;
  }
  if (P.grounded) {
    if (P.state === 'air' || P.state === 'swing') land();
    else if (P.state === 'zip' && !P.zip.launch) { P.state = 'ground'; P.zip = null; }
  } else if (P.state === 'ground') { P.state = 'air'; P.timeInAir = 0; P.swingArmed = false; }
  if (P.wallHit) {
    const iv = inp;
    const into = -(iv.x * P.hitN.x + iv.z * P.hitN.z);
    if (P.state === 'zip') { if (!P.zip.launch && P.hitN.dot(P.zip.n) > 0.9) { enterWall(P.hitN); P.zip = null; } else if (P.zip.t > 0.15) { P.state = 'air'; P.zip = null; } }
    else if ((P.state === 'air' || P.state === 'swing') && P.wallCd <= 0 && into > 0.55) enterWall(P.hitN);
    else if (P.state === 'ground' && into > 0.55) enterWall(P.hitN);
  }
}

let spawnPos = new V3(), spawnYaw = 0;
function chooseSpawn() {
  let best = null, bs = 1e9;
  for (const b of boxes) {
    if (b.slab || b.maxY < 90 || b.maxY > 170) continue;
    const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2, d = Math.hypot(cx, cz);
    if (d < 70) continue;
    const s = Math.abs(d - 140) + Math.abs(b.maxY - 125) * 0.5;
    if (s < bs && b.maxX - b.minX > 10) { bs = s; best = b; }
  }
  const b = best || boxes.find((q) => !q.slab);
  spawnPos.set((b.minX + b.maxX) / 2, b.maxY + HY + 0.05, (b.minZ + b.maxZ) / 2);
  spawnYaw = Math.atan2(-spawnPos.x, -spawnPos.z);
}
function respawn(msg) {
  P.pos.copy(spawnPos); P.prev.copy(spawnPos); P.rpos.copy(spawnPos); P.vel.set(0, 0, 0); P.state = 'air'; P.trick = null; P.combo = 0; P.zip = null;
  C.yaw = spawnYaw; C.pitch = -0.15; C.target.copy(P.pos);
  P.facing.set(Math.sin(spawnYaw), 0, Math.cos(spawnYaw));
  if (msg) flash('SPLASH! BACK TO THE ROOFTOPS');
}

// ---------------------------------------------------------------- animation
function updateAnim(dt, time) {
  const v = P.vel, hs = Math.hypot(v.x, v.z), st = P.state;
  for (const j of JOINTS) S(j, 0, 0, 0);
  tgt.hipsY = 0;
  let rate = 12;
  let aimR = 0, aimL = 0;
  const tr = P.trick;
  if (tr) {
    rate = 20;
    if (tr.pose === 'tuck') { S('spine', 0.5, 0, 0); S('head', 0.3, 0, 0); sym('hip', -1.9, 0, 0.15); sym('kn', 2.3, 0, 0); sym('sh', -1.0, 0, 0.25); sym('el', -1.6, 0, 0); }
    else { sym('sh', 0, 0, 1.45); sym('el', -0.1, 0, 0); sym('hip', -0.15, 0, 0.32); sym('kn', 0.25, 0, 0); S('spine', -0.1, 0, 0); }
  } else if (st === 'ground') {
    if (P.landT > 0) { // three-point hero landing
      tgt.hipsY = -0.42; S('spine', 0.75, 0, 0); S('head', -0.55, 0, 0);
      S('hipL', -1.75, 0, 0.25); S('knL', 2.35, 0, 0); S('hipR', -0.35, 0, -0.25); S('knR', 2.2, 0, 0);
      S('shL', -0.1, 0, 1.25); S('elL', -0.2, 0, 0); S('shR', -1.15, 0, -0.2); S('elR', -0.15, 0, 0); rate = 22;
    } else if (hs > 0.8) {
      const sprint = clamp((hs - 12) / 14, 0, 1);
      P.runPh += dt * (4 + hs * 0.5);
      const ph = P.runPh, s = Math.sin(ph), c = Math.cos(ph), A = clamp(hs / 10, 0.3, 1.1);
      S('spine', 0.12 + 0.35 * sprint, 0.12 * s * A, 0); S('head', -0.1 - 0.25 * sprint, -0.1 * s, 0);
      S('shL', 0.9 * s * A, 0, 0.12 + 0.1 * sprint); S('shR', -0.9 * s * A, 0, -0.12 - 0.1 * sprint);
      S('elL', -0.5 - 0.8 * A, 0, 0); S('elR', -0.5 - 0.8 * A, 0, 0);
      S('hipL', -1.0 * s * A - 0.15 * sprint, 0, 0.04); S('hipR', 1.0 * s * A - 0.15 * sprint, 0, -0.04);
      S('knL', 0.2 + 1.5 * A * Math.max(0, c), 0, 0); S('knR', 0.2 + 1.5 * A * Math.max(0, -c), 0, 0);
      tgt.hipsY = -0.05 - 0.06 * Math.abs(c) * A; rate = 16;
    } else {
      const b = Math.sin(time * 2.2);
      S('spine', 0.04 + 0.02 * b, 0, 0); sym('sh', 0.05, 0, 0.13); sym('el', -0.25, 0, 0); sym('hip', -0.05, 0, 0.06); sym('kn', 0.1, 0, 0); S('head', -0.05, 0.1 * Math.sin(time * 0.4), 0);
    }
  } else if (st === 'swing') {
    const desc = clamp(-v.y / 18, -1, 1);
    const tuck = clamp(0.5 + desc * 0.6, 0, 1);
    S('spine', lerp(-0.15, 0.35, tuck), 0, 0); S('head', -0.25, 0, 0);
    S('hipL', lerp(-0.3, -1.45, tuck), 0, 0.12); S('knL', lerp(0.25, 2.1, tuck), 0, 0);
    S('hipR', lerp(-0.05, -1.1, tuck), 0, -0.12); S('knR', lerp(0.5, 1.7, tuck), 0, 0);
    if (P.hand === 'R') { aimR = 1; S('shL', 0.5, 0, 1.1); S('elL', -0.5, 0, 0); } else { aimL = 1; S('shR', 0.5, 0, -1.1); S('elR', -0.5, 0, 0); }
    rate = 9;
  } else if (st === 'zip') {
    aimR = 1; aimL = 0.85; sym('hip', 0.35, 0, 0.1); sym('kn', 0.7, 0, 0); S('spine', -0.15, 0, 0); rate = 14;
  } else if (st === 'wall') {
    const moving = Math.abs(v.y) + Math.hypot(v.x, v.z) > 3;
    if (moving && shiftDown()) {
      P.runPh += dt * 14; const s = Math.sin(P.runPh), c = Math.cos(P.runPh);
      S('spine', 0.35, 0.12 * s, 0); S('shL', 1.0 * s, 0, 0.2); S('shR', -1.0 * s, 0, -0.2); sym('el', -1.4, 0, 0);
      S('hipL', -1.1 * s - 0.1, 0, 0.05); S('hipR', 1.1 * s - 0.1, 0, -0.05); S('knL', 0.3 + 1.5 * Math.max(0, c), 0, 0); S('knR', 0.3 + 1.5 * Math.max(0, -c), 0, 0);
      tgt.hipsY = -0.05;
    } else { // crawl / cling
      if (moving) P.runPh += dt * 7; const s = moving ? Math.sin(P.runPh) : 0;
      tgt.hipsY = -0.32; S('spine', 0.25, 0, 0); S('head', -0.6, 0, 0);
      S('hipL', -1.2 + 0.45 * s, 0, 0.55); S('knL', 2.0, 0, 0); S('hipR', -1.2 - 0.45 * s, 0, -0.55); S('knR', 2.0, 0, 0);
      S('shL', -1.25 - 0.45 * s, 0, 0.55); S('elL', -0.9, 0, 0); S('shR', -1.25 + 0.45 * s, 0, -0.55); S('elR', -0.9, 0, 0);
    }
  } else { // air
    if (shiftDown() && v.y < 6) { // dive
      sym('sh', 0.3, 0, 0.32); sym('el', -0.05, 0, 0); sym('hip', 0.05, 0, 0.06); sym('kn', 0.15, 0, 0); S('spine', -0.05, 0, 0); S('head', -0.5, 0, 0); rate = 10;
    } else if (v.y > 3 && P.timeInAir < 0.6) {
      S('hipL', -1.3, 0, 0.1); S('knL', 1.9, 0, 0); S('hipR', 0.15, 0, -0.1); S('knR', 0.7, 0, 0);
      S('shL', -0.5, 0, 0.6); S('shR', 0.4, 0, -0.5); sym('el', -0.8, 0, 0); S('spine', 0.15, 0, 0);
    } else {
      const w = time;
      // blend from a loose drift pose into a spread-eagle skydive arch as the fall builds
      const f = clamp(-v.y / 20, 0, 1) * clamp((P.timeInAir - 0.25) / 0.6, 0, 1);
      const fl = (a, b) => lerp(a, b, f);
      const j1 = Math.sin(w * 7) * 0.1 * f, j2 = Math.sin(w * 6.1 + 1.7) * 0.1 * f, j3 = Math.sin(w * 5.3 + 3.1) * 0.08 * f;
      S('shL', fl(-0.5 + 0.2 * Math.sin(w * 6), -0.55 + j1), 0, fl(1.5, 2.05 + j2 * 0.5));
      S('shR', fl(-0.5 + 0.2 * Math.sin(w * 6 + 1.3), -0.55 - j1), 0, fl(-1.5, -2.05 + j2 * 0.5));
      sym('el', fl(-0.55, -0.35 + j3), 0, 0);
      S('hipL', fl(-0.55 + 0.15 * Math.sin(w * 5), -0.3 + j2), 0, fl(0.18, 0.42));
      S('knL', fl(0.95, 0.55 + j1), 0, 0);
      S('hipR', fl(-0.15 + 0.15 * Math.sin(w * 5 + 2), -0.3 - j2), 0, fl(-0.18, -0.42));
      S('knR', fl(0.55, 0.55 - j1), 0, 0);
      S('spine', fl(0.1, -0.32), 0, j3 * 0.5); S('head', fl(-0.2, -0.5), 0, 0);
      rate = lerp(10, 6, f);
    }
  }
  const k = damp(rate, dt);
  for (const j of JOINTS) { const c = cur[j], t = tgt[j]; c[0] += (t[0] - c[0]) * k; c[1] += (t[1] - c[1]) * k; c[2] += (t[2] - c[2]) * k; R[j].rotation.set(c[0], c[1], c[2]); }
  cur.hipsY += (tgt.hipsY - cur.hipsY) * k; R.hips.position.y = cur.hipsY + 0.04;

  // ---- body orientation
  const up = tv.set(0, 1, 0), fw = tv2;
  const hsv = hs > 0.6;
  if (hsv) P.facing.set(v.x / hs, 0, v.z / hs);
  let orate = 10;
  if (st === 'swing') { up.subVectors(P.pivot, P.rpos).normalize(); fw.copy(v); if (fw.lengthSq() < 1) fw.copy(P.facing); orate = 9; }
  else if (st === 'wall') { up.copy(P.wallN); fw.copy(P.wallMove); if (Math.abs(fw.dot(up)) > 0.9) fw.set(0, 1, 0); orate = 12; }
  else if (st === 'zip') { fw.subVectors(P.zip ? P.zip.target : P.pos, P.pos); fw.y *= 0.3; if (fw.lengthSq() < 0.01) fw.copy(P.facing); orate = 12; }
  else if (st === 'air' && shiftDown() && v.y < 6 && !tr) { up.copy(v).normalize(); fw.set(0, -1, 0); if (Math.abs(fw.dot(up)) > 0.95) fw.copy(P.facing); orate = 6; }
  else if (st === 'air') {
    const f = clamp(-v.y / 20, 0, 1) * clamp((P.timeInAir - 0.25) / 0.6, 0, 1);
    fw.copy(P.facing); up.addScaledVector(P.facing, clamp(hs / 60, 0, 0.45) + f * 0.75).normalize(); orate = 5.5;
  }
  else { fw.copy(P.facing); orate = 14; }
  fw.addScaledVector(up, -fw.dot(up));
  if (fw.lengthSq() < 1e-4) fw.copy(P.facing).addScaledVector(up, -P.facing.dot(up));
  fw.normalize();
  const xa = tv3.crossVectors(up, fw).normalize();
  tm.makeBasis(xa, up, fw); tq.setFromRotationMatrix(tm);
  P.baseQ.slerp(tq, damp(orate, dt));
  // trick spin
  if (tr) {
    tr.t += dt; const pp = clamp(tr.t / tr.dur, 0, 1);
    const e = pp < 0.5 ? 2 * pp * pp : 1 - (-2 * pp + 2) ** 2 / 2;
    tq2.setFromAxisAngle(tr.axis, tr.ang * e);
    hero.quaternion.copy(P.baseQ).multiply(tq2);
    if (pp >= 1) endTrick(false);
  } else hero.quaternion.copy(P.baseQ);
  // body offset (wall: stand on the wall surface)
  const offT = tv3.set(0, 0, 0);
  if (st === 'wall') offT.copy(P.wallN).multiplyScalar(0.5); else if (st === 'ground') offT.set(0, -0.0, 0);
  P.offset.lerp(offT, damp(12, dt));
  hero.position.copy(P.rpos).add(P.offset);
  hero.updateMatrixWorld(true);

  // ---- arm aiming at web anchor
  P.aimW += ((aimR ? 1 : 0) - P.aimW) * damp(18, dt);
  P.aimW2 += ((aimL ? 1 : 0) - P.aimW2) * damp(18, dt);
  const target = st === 'zip' && P.zip ? P.zip.hit : P.anchor;
  if (P.aimW > 0.01) aimArm(R.shR, R.elR, target, P.aimW * (aimR || 1));
  if (P.aimW2 > 0.01) aimArm(R.shL, R.elL, target, P.aimW2 * (aimL || 1));
  if (st === 'swing' && P.hand === 'L') { /* left hand holds the line */ }
}
const _aimA = new V3(), _aimB = new V3(), _hp = new V3();
function aimArm(sh, el, targetW, w) {
  sh.parent.getWorldQuaternion(tq2).invert();
  const sp = sh.getWorldPosition(_aimA);
  const dir = _aimB.subVectors(targetW, sp).normalize().applyQuaternion(tq2);
  tq.setFromUnitVectors(DOWN, dir);
  sh.quaternion.slerp(tq, clamp(w, 0, 1));
  el.rotation.x *= 1 - clamp(w, 0, 1) * 0.9;
  sh.updateMatrixWorld(true);
}

// swing hand override: when swinging with left, aim left arm instead
function updateRope(dt) {
  let show = false;
  const hp = _hp;
  if (P.state === 'swing') {
    (P.hand === 'R' ? R.handR : R.handL).getWorldPosition(hp); show = true;
    P.ropeT = Math.min(1, P.ropeT + dt / 0.08);
    setRope(hp, P.anchor, P.ropeT);
  } else if (P.state === 'zip' && P.zip) {
    R.handR.getWorldPosition(hp); show = true; P.ropeT = Math.min(1, P.ropeT + dt / 0.08);
    setRope(hp, P.zip.hit, P.ropeT);
  }
  rope.visible = show;
  for (const s of splats) if (s.visible) { s.userData.t -= dt; s.material.opacity = clamp(s.userData.t, 0, 1); if (s.userData.t <= 0) s.visible = false; }
}
function setRope(a, b, t) {
  const d = tv.subVectors(b, a); const len = d.length(); d.divideScalar(len);
  rope.position.copy(a); rope.quaternion.setFromUnitVectors(UP, d); rope.scale.set(1, len * t, 1);
}

// ---------------------------------------------------------------- camera
const camPos = new V3();
function updateCamera(dt, now) {
  const v = P.vel, sp = v.length(), hs = Math.hypot(v.x, v.z);
  if (now - lastMouse > 2200 && (P.state === 'swing' || P.state === 'air' || P.state === 'zip') && hs > 10) {
    C.yaw += angDiff(Math.atan2(v.x, v.z), C.yaw) * damp(0.8, dt) * clamp((now - lastMouse - 2200) / 1500, 0, 1);
  }
  if (keys.ArrowLeft) C.yaw += 2.2 * dt; if (keys.ArrowRight) C.yaw -= 2.2 * dt;
  if (keys.ArrowUp) C.pitch = clamp(C.pitch + 1.5 * dt, -1.35, 0.75); if (keys.ArrowDown) C.pitch = clamp(C.pitch - 1.5 * dt, -1.35, 0.75);
  tv.copy(P.rpos); tv.y += 0.85;
  C.target.lerp(tv, damp(P.state === 'zip' ? 26 : 16, dt));
  const want = 4.4 + clamp(sp / 70, 0, 1) * 3.6 + (P.state === 'swing' ? 0.8 : 0) + (P.state === 'wall' ? 1.0 : 0);
  C.dist = lerp(C.dist, want, damp(2.5, dt));
  const cp = Math.cos(C.pitch);
  const dir = tv2.set(Math.sin(C.yaw) * cp, Math.sin(C.pitch), Math.cos(C.yaw) * cp);
  const back = tv3.copy(dir).negate();
  const h = raycastWorld(C.target, back, C.dist + 0.6);
  let roof = -1, free = C.dist + 0.6;
  if (h && h.n.y > 0.5) roof = h.p.y + 0.6; // looking up from a rooftop: hover above it instead of zooming in
  else if (h) free = Math.max(0.8, h.t - 0.45);
  // keep a short history of clearances and use the minimum: a ray that misses the
  // wall for one frame can no longer make the camera pop out and back (flicker)
  C.hist[C.hi = (C.hi + 1) % 7] = free;
  let fmin = Infinity; for (let q = 0; q < 7; q++) if (C.hist[q] < fmin) fmin = C.hist[q];
  C.occl = fmin < C.occl ? fmin : lerp(C.occl, fmin, damp(2.2, dt));
  const dist = Math.min(C.dist, C.occl);
  camPos.copy(C.target).addScaledVector(back, dist); camPos.y += 0.35;
  C.floor = roof > C.floor ? roof : lerp(C.floor, Math.max(roof, 0.5), damp(2.5, dt));
  if (camPos.y < C.floor) camPos.y = C.floor;
  if (C.shake > 0) { C.shake = Math.max(0, C.shake - dt); const s = C.shake * 0.5; camPos.x += (Math.random() - 0.5) * s; camPos.y += (Math.random() - 0.5) * s; camPos.z += (Math.random() - 0.5) * s; }
  camera.position.copy(camPos);
  camera.lookAt(C.target.x, C.target.y + 0.35, C.target.z);
  const fov = 68 + clamp((sp - 15) / 55, 0, 1) * 22;
  C.fov = lerp(C.fov, fov, damp(3, dt));
  if (Math.abs(camera.fov - C.fov) > 0.01) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
  // keep sun shadow centred on the hero
  // snap the shadow frustum to a world-space grid so shadow edges don't shimmer as you move
  const snap = 0.5;
  sun.target.position.set(Math.round(P.pos.x / snap) * snap, Math.round(P.pos.y / snap) * snap, Math.round(P.pos.z / snap) * snap);
  sun.position.copy(sun.target.position).addScaledVector(lightDir, 450);
}

// ---------------------------------------------------------------- audio
let actx = null, windGain = null, windFilt = null, master = null, muted = false, noiseBuf = null;
let engGain = null, engFilt = null, engOsc = null, engOsc2 = null, trafGain = null, hornT = 4, stepN = 0;
function initAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    master = actx.createGain(); master.gain.value = 0.8; master.connect(actx.destination);
    noiseBuf = actx.createBuffer(1, actx.sampleRate * 2, actx.sampleRate);
    const d = noiseBuf.getChannelData(0); let last = 0;
    for (let i = 0; i < d.length; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; d[i] = w * 0.5 + last * 3; }
    const src = actx.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    windFilt = actx.createBiquadFilter(); windFilt.type = 'lowpass'; windFilt.frequency.value = 400;
    windGain = actx.createGain(); windGain.gain.value = 0;
    src.connect(windFilt).connect(windGain).connect(master); src.start();
    // car engine: two detuned saws through a lowpass; volume follows the nearest car
    engOsc = actx.createOscillator(); engOsc.type = 'sawtooth'; engOsc.frequency.value = 70;
    engOsc2 = actx.createOscillator(); engOsc2.type = 'sawtooth'; engOsc2.frequency.value = 105; engOsc2.detune.value = 9;
    engFilt = actx.createBiquadFilter(); engFilt.type = 'lowpass'; engFilt.frequency.value = 400; engFilt.Q.value = 1.2;
    engGain = actx.createGain(); engGain.gain.value = 0;
    engOsc.connect(engFilt); engOsc2.connect(engFilt); engFilt.connect(engGain).connect(master);
    engOsc.start(); engOsc2.start();
    // distant traffic bed: low rumble that fades with altitude
    const t2 = actx.createBufferSource(); t2.buffer = noiseBuf; t2.loop = true; t2.playbackRate.value = 0.6;
    const tf = actx.createBiquadFilter(); tf.type = 'lowpass'; tf.frequency.value = 160;
    trafGain = actx.createGain(); trafGain.gain.value = 0;
    t2.connect(tf).connect(trafGain).connect(master); t2.start(0, 1);
  } catch (_) { actx = null; }
}
function toggleMute() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.8; flash(muted ? 'SOUND OFF' : 'SOUND ON'); }
function burst(f0, f1, dur, vol, q = 2) {
  if (!actx || muted) return;
  const t = actx.currentTime, s = actx.createBufferSource(); s.buffer = noiseBuf;
  const f = actx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = q; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = actx.createGain(); g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  s.connect(f).connect(g).connect(master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
}
function thwip(m = 1) { burst(5200, 1400, 0.14 * m, 0.55, 3); }
function whoosh(m = 1) { burst(600, 1800, 0.35 * m, 0.25 * m, 0.8); }
function thud(m = 1) { burst(300, 60, 0.4, 0.8 * m, 1); }
function horn(vol) {
  if (!actx || muted || vol <= 0.01) return;
  const t = actx.currentTime, dur = rr(0.25, 0.7);
  for (const f of [rnd() < 0.5 ? 370 : 330, rnd() < 0.5 ? 466 : 415]) {
    const o = actx.createOscillator(); o.type = 'square'; o.frequency.value = f;
    const fl = actx.createBiquadFilter(); fl.type = 'lowpass'; fl.frequency.value = 1100;
    const g = actx.createGain(); g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol * 0.5, t + 0.03); g.gain.setValueAtTime(vol * 0.5, t + dur - 0.05); g.gain.linearRampToValueAtTime(0.001, t + dur);
    o.connect(fl).connect(g).connect(master); o.start(t); o.stop(t + dur + 0.05);
  }
}
function footstep(vol) { burst(rr(700, 1000), 220, 0.07, vol, 1.6); }
function updateAudio(dt) {
  if (!actx || !windGain) return;
  const now = actx.currentTime, sp = P.vel.length();
  const g = muted ? 0 : clamp((sp / 75) ** 2 * 0.5, 0, 0.45);
  windGain.gain.setTargetAtTime(g, now, 0.1);
  windFilt.frequency.setTargetAtTime(250 + sp * 28, now, 0.1);
  // nearest car -> engine volume, pitch and brightness (simple proximity audio)
  let d2 = 1e9, nv = 10;
  const px = P.pos.x, py = P.pos.y, pz = P.pos.z, cars = world.cars;
  for (let k = 0; k < world.NC; k++) { const c = cars[k]; const dx = c.x - px, dz = c.z - pz; const q = dx * dx + dz * dz; if (q < d2) { d2 = q; nv = c.v; } }
  const d = Math.sqrt(d2 + py * py);
  const prox = clamp(1 - d / 65, 0, 1);
  if (engGain) {
    engGain.gain.setTargetAtTime(muted ? 0 : prox * prox * 0.33, now, 0.15);
    engOsc.frequency.setTargetAtTime(55 + nv * 2.5 + Math.sin(time * 9) * 3, now, 0.1);
    engOsc2.frequency.setTargetAtTime(82 + nv * 3.8, now, 0.1);
    engFilt.frequency.setTargetAtTime(220 + prox * 1400, now, 0.15);
  }
  if (trafGain) trafGain.gain.setTargetAtTime(muted ? 0 : 0.028 + 0.1 * clamp(1 - py / 110, 0, 1), now, 0.3);
  // occasional horns from the streets, volume by distance to a random car
  hornT -= dt;
  if (hornT <= 0) {
    hornT = rr(3, 9);
    const c = cars[(Math.random() * world.NC) | 0];
    const hd = Math.hypot(c.x - px, c.z - pz, py);
    horn(clamp(1 - hd / 320, 0, 1) * 0.3);
  }
  // footsteps in sync with the run cycle
  if (P.state === 'ground' && Math.hypot(P.vel.x, P.vel.z) > 3) {
    const n = Math.floor(P.runPh / Math.PI);
    if (n !== stepN) { stepN = n; footstep(clamp(sp / 26, 0.15, 0.6) * 0.45); }
  }
}

// ---------------------------------------------------------------- HUD
const $ = (id) => document.getElementById(id);
const hud = { style: $('style'), combo: $('combo'), speed: $('speed'), alt: $('alt'), state: $('state'), reticle: $('reticle'), trick: $('trick'), flash: $('flash') };
const lines = $('lines'), lctx = lines.getContext('2d');
function popTrick(t) { hud.trick.textContent = t; hud.trick.classList.remove('pop'); void hud.trick.offsetWidth; hud.trick.classList.add('pop'); }
function flash(t) { if (!hud.flash) return; hud.flash.textContent = t; hud.flash.classList.remove('pop'); void hud.flash.offsetWidth; hud.flash.classList.add('pop'); }
let hudT = 0, linesDirty = true;
const STATE_NAMES = { ground: 'ON FOOT', air: 'AIRBORNE', swing: 'SWINGING', zip: 'WEB-ZIP', wall: 'WALL CRAWL' };
function updateHUD(dt) {
  hudT -= dt;
  if (hudT <= 0) {
    hudT = 0.08;
    const sp = P.vel.length();
    hud.speed.textContent = Math.round(sp * 3.6);
    hud.alt.textContent = Math.max(0, Math.round(P.pos.y - HY));
    hud.style.textContent = P.style.toLocaleString();
    hud.combo.textContent = P.combo > 1 ? `x${P.combo}` : '';
    hud.state.textContent = STATE_NAMES[P.state] || '';
  }
  hud.reticle.className = zipInfo ? (zipInfo.launch ? 'launch' : 'wall') : '';
  // speed lines
  const W = lines.width, H = lines.height; if (linesDirty) { lctx.clearRect(0, 0, W, H); linesDirty = false; }
  const sp = P.vel.length(), a = clamp((sp - 32) / 40, 0, 1);
  if (a > 0) {
    linesDirty = true;
    lctx.strokeStyle = `rgba(255,255,255,${0.22 * a})`; lctx.lineWidth = 1.5;
    const cx = W / 2, cy = H / 2, R0 = Math.hypot(cx, cy);
    for (let i = 0; i < 40 * a; i++) {
      const ang = Math.random() * TAU, r1 = R0 * (0.55 + Math.random() * 0.25), r2 = r1 + R0 * (0.15 + Math.random() * 0.3);
      lctx.beginPath(); lctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1); lctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2); lctx.stroke();
    }
  }
}
function resize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight); bloom.setSize(innerWidth, innerHeight); if (gtao) gtao.setSize(innerWidth, innerHeight);
  lines.width = innerWidth; lines.height = innerHeight;
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- loop
applyTOD(0);
setQuality(qIdx, false);
chooseSpawn(); respawn(false);
resize();
let last = performance.now(), acc = 0, time = 0, zipTick = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(0.05, (now - last) / 1000); last = now;
  const paused = !started || (everLocked && !locked);
  if (!paused) {
    time += dt; acc += dt;
    const h = 1 / 120; let n = 0;
    while (acc >= h && n < 10) { step(h); acc -= h; n++; }
    if (n >= 10) acc = 0;
    P.rpos.copy(P.prev).lerp(P.pos, clamp(acc / h, 0, 1));
    if (ev.trick) { startTrick(ev.trick); ev.trick = null; }
    world.update(dt, time);
  } else { ev.trick = null; if (!started) { C.yaw += dt * 0.05; } }
  updateAnim(paused ? 0 : dt, time);
  updateCamera(dt, now);
  if ((zipTick = (zipTick + 1) % 3) === 0) computeZip();
  updateRope(paused ? 0 : dt);
  updateHUD(dt);
  updateAudio(paused ? 0 : dt);
  autoQuality(dt);
  sky.material.uniforms.time && (sky.material.uniforms.time.value = time);
  composer.render();
}
requestAnimationFrame(frame);

// debug hooks for automated testing
window.__boxes = boxes;
window.__G = { P, C, keys, ev, applyTOD, info: () => renderer.info.render, zip: () => zipInfo, step, bloom, renderer, scene, setStarted: () => { started = true; $('start').classList.add('gone'); }, camera };
