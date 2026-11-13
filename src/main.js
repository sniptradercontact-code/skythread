// ============================================================================
//  SKYTHREAD — a web-swinging sandbox. Original hero, original city.
// ============================================================================
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { buildWorld, boxes, query, makeWebTex, rnd, CYC, AVE_GO, ST_T0, ST_GO } from './world.js';
import { buildLife } from './life.js';
import { buildHero, JOINTS } from './hero.js';

const V3 = THREE.Vector3;
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const damp = (rate, dt) => 1 - Math.exp(-rate * dt);
const smooth = (t) => t * t * (3 - 2 * t);
const angDiff = (a, b) => { let d = a - b; while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU; return d; };
const UP = new V3(0, 1, 0), DOWN = new V3(0, -1, 0);

// ---------------------------------------------------------------- renderer + quality tiers
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const QS = new URLSearchParams(location.search);
const FORCE_Q = QS.has('q') ? clamp(+QS.get('q') || 0, 0, 4) : QS.has('low') ? 4 : -1;
const DPR = Math.min(window.devicePixelRatio || 1, 2);
// near/far: how far detailed and simple cars are drawn; peds: how many people at once
const QUALITY = [
  { name: 'ULTRA', pr: DPR, msaa: 4, bloom: true, dof: true, sh: 2048, shEvery: 1, near: 190, far: 1100, peds: 1800, pedR: 260, detail: true, trees: 1 },
  { name: 'HIGH', pr: Math.min(DPR, 1.25), msaa: 4, bloom: true, dof: true, sh: 2048, shEvery: 2, near: 160, far: 900, peds: 1400, pedR: 240, detail: true, trees: 1 },
  { name: 'MEDIUM', pr: 1, msaa: 0, bloom: true, dof: false, sh: 1536, shEvery: 2, near: 140, far: 700, peds: 1000, pedR: 210, detail: true, trees: 1 },
  { name: 'LOW', pr: 0.8, msaa: 0, direct: true, sh: 1024, shEvery: 3, near: 110, far: 500, peds: 650, pedR: 170, detail: false, trees: 0.7 },
  { name: 'BASIC', pr: 0.6, msaa: 0, direct: true, sh: 0, shEvery: 1, near: 90, far: 380, peds: 380, pedR: 130, detail: false, trees: 0.4 },
];
// the automatic tuner walks this ladder of (tier, resolution scale) steps
const LADDER = [[0, 1], [1, 1], [2, 1], [2, 0.85], [3, 1], [3, 0.85], [4, 1]];
let qIdx = FORCE_Q >= 0 ? FORCE_Q : 2, qDyn = 1;
renderer.setPixelRatio(QUALITY[qIdx].pr);
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.9;

canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); setTimeout(() => location.reload(), 400); });
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.25, 9000);

const world = buildWorld(scene, renderer);
const life = buildLife(scene, world);
// street surfaces pick up a sodium-lamp glow at night
for (const m of world.streetMats) { m.emissiveMap = m.map; m.emissive.set(0xffb469); m.emissiveIntensity = 0; }

// ---------------------------------------------------------------- sky + lights
const sky = new Sky(); sky.scale.setScalar(9000); scene.add(sky);
const envScene = new THREE.Scene(); const envSky = new Sky(); envSky.scale.setScalar(50); envScene.add(envSky);
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null;
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true; sun.shadow.mapSize.set(1536, 1536); sun.shadow.autoUpdate = false;
const SHR = 120;
Object.assign(sun.shadow.camera, { left: -SHR, right: SHR, top: SHR, bottom: -SHR, near: 10, far: 1100 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.08;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xbfd3ff, 0x6b5640, 0.5); scene.add(hemi);
const lightDir = new V3();

const TOD = [
  { name: 'Golden Hour', elev: 13, azim: 62, turb: 4.6, ray: 2.9, mie: 0.006, sunColor: 0xffb878, sunI: 2.9, sky: 0xa9bfe8, gnd: 0x8c6b52, hemiI: 0.72, fog: 0xd9a983, fogD: 0.0004, exp: 0.43, win: 0.5, env: 0.42, clouds: 0.4, bloom: 0.22, bloomT: 2.3, night: 0, cloudCol: 0xffc9a0, cloudE: 0.3, bb: 1.5 },
  { name: 'Midday', elev: 56, azim: 150, turb: 2.5, ray: 1.0, mie: 0.003, sunColor: 0xfff3e2, sunI: 2.5, sky: 0xcfe2ff, gnd: 0x6e6a60, hemiI: 0.78, fog: 0xa9bcd0, fogD: 0.00028, exp: 0.42, win: 0.05, env: 0.32, clouds: 0.45, bloom: 0.1, bloomT: 2.8, night: 0, cloudCol: 0xffffff, cloudE: 0.5, bb: 1.1 },
  { name: 'Night', elev: -4, azim: 250, turb: 2, ray: 0.6, mie: 0.003, sunColor: 0x9fb4ff, sunI: 0.75, lightElev: 48, lightAzim: 300, sky: 0x4a5f9c, gnd: 0x3a2c1c, hemiI: 0.62, fog: 0x0d1630, fogD: 0.00042, exp: 0.82, win: 1.35, env: 0.9, clouds: 0.2, bloom: 0.3, bloomT: 1.15, night: 1, cloudCol: 0x39415a, cloudE: 0.08, bb: 1.6 },
];
let todIdx = 0;
function makeNightSky() {
  const W = 2048, H = 1024, c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, '#02040b'); gr.addColorStop(0.32, '#07102a'); gr.addColorStop(0.47, '#1d2c55'); gr.addColorStop(0.5, '#35406a'); gr.addColorStop(0.53, '#141c34'); gr.addColorStop(1, '#05070d');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  for (let i = 0; i < 2200; i++) { const y = Math.pow(Math.random(), 1.6) * H * 0.46, a = Math.random(); g.fillStyle = `rgba(255,255,255,${0.25 + a * 0.75})`; const r = a > 0.97 ? 1.6 : 0.8; g.fillRect(Math.random() * W, y, r, r); }
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
  const night = t.night > 0.5;
  for (const m of world.facadeMats) m.emissiveIntensity = t.win;
  for (const m of world.streetMats) m.emissiveIntensity = night ? 0.55 : 0;
  world.lampMat.emissiveIntensity = night ? 3.2 : t.win > 0.3 ? 1.6 : 0.3;
  world.glowMat.color.setScalar(night ? 1.6 : 1.2);
  world.nightMat.color.setScalar(night ? 0.62 : 0.4);
  world.setNight(night || t.win > 0.3);
  world.cloudMat.color.set(t.cloudCol); world.cloudMat.emissiveIntensity = t.cloudE;
  world.waterMat.color.set(night ? 0x0b1a2e : t.win > 0.3 ? 0x3a6078 : 0x2c6787);
  for (const m of world.bbMats) m.emissiveIntensity = t.bb;
  life.setNight(t.night);
  scene.environmentIntensity = t.env;
  if (envRT) envRT.dispose();
  sky.visible = !night; scene.background = night ? nightSky : null;
  envRT = night ? pmrem.fromEquirectangular(nightSky) : pmrem.fromScene(envScene, 0, 0.1, 200);
  scene.environment = envRT.texture;
  sun.shadow.needsUpdate = true;
  applyPost();
  const el = document.getElementById('tod'); if (el) el.textContent = t.name.toUpperCase();
  flash(t.name.toUpperCase());
}

// ---------------------------------------------------------------- post-processing
// distance haze: far-away buildings soften slightly, the way a long lens flattens a city
const DofShader = {
  uniforms: { tDiffuse: { value: null }, tDepth: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uNear: { value: 0.25 }, uFar: { value: 9000 }, uFocus: { value: 150 }, uMax: { value: 2.6 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: `uniform sampler2D tDiffuse; uniform sampler2D tDepth; uniform vec2 uRes; uniform float uNear; uniform float uFar; uniform float uFocus; uniform float uMax; varying vec2 vUv;
    float lin(float d) { float z = d * 2.0 - 1.0; return 2.0 * uNear * uFar / (uFar + uNear - z * (uFar - uNear)); }
    float coc(float dist) { return smoothstep(uFocus, uFocus * 5.0, dist); }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float r = coc(lin(texture2D(tDepth, vUv).x)) * uMax;
      if (r < 0.35) { gl_FragColor = c; return; }
      vec3 acc = c.rgb; float w = 1.0;
      for (int i = 0; i < 10; i++) {
        float a = float(i) * 2.39996, rad = sqrt((float(i) + 0.5) / 10.0) * r;
        vec2 uv = vUv + vec2(cos(a), sin(a)) * rad / uRes;
        float sw = 0.2 + 0.8 * coc(lin(texture2D(tDepth, uv).x));
        acc += texture2D(tDiffuse, uv).rgb * sw; w += sw;
      }
      gl_FragColor = vec4(acc / w, c.a);
    }`,
};
class DofPass extends ShaderPass {
  render(r, writeBuffer, readBuffer, dt, mask) { this.uniforms.tDepth.value = readBuffer.depthTexture; this.uniforms.uRes.value.set(readBuffer.width, readBuffer.height); super.render(r, writeBuffer, readBuffer, dt, mask); }
}
let composer = null, bloom = null, dof = null, compSig = '';
function buildComposer(q) {
  const sig = q.direct ? 'direct' : `${q.msaa}|${q.dof}|${q.bloom}`;
  if (sig === compSig) return;
  compSig = sig;
  if (composer) { for (const p of composer.passes) if (p.dispose) p.dispose(); composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); composer = null; bloom = null; dof = null; }
  if (q.direct) return;
  const rt = new THREE.WebGLRenderTarget(8, 8, { type: THREE.HalfFloatType, samples: q.msaa, depthTexture: q.dof ? new THREE.DepthTexture(8, 8) : null });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  if (q.dof) { dof = new DofPass(DofShader); composer.addPass(dof); }
  if (q.bloom) { bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.2, 0.55, 0.95); composer.addPass(bloom); }
  composer.addPass(new OutputPass());
}
function applyPost() { if (bloom) { bloom.strength = TOD[todIdx].bloom; bloom.threshold = TOD[todIdx].bloomT; } }
function applyQuality(i, dyn = 1, announce = false) {
  qIdx = clamp(i, 0, QUALITY.length - 1); qDyn = dyn;
  const q = QUALITY[qIdx], pr = q.pr * dyn;
  renderer.setPixelRatio(pr); buildComposer(q);
  if (composer) composer.setPixelRatio(pr);
  world.setDensity(q.trees, qIdx < 3); world.setDetail(q.detail);
  life.setQuality({ near: q.near, far: q.far, peds: q.peds, pedR: q.pedR });
  sun.castShadow = q.sh > 0;
  if (q.sh > 0 && sun.shadow.mapSize.x !== q.sh) { sun.shadow.mapSize.set(q.sh, q.sh); if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; } }
  sun.shadow.needsUpdate = true;
  applyPost(); resize();
  const el = document.getElementById('tier'); if (el) el.textContent = q.name + (dyn < 1 ? ' ' + Math.round(dyn * 100) + '%' : '');
  if (announce) flash('GRAPHICS: ' + q.name);
}
// automatic tuning: aim for 100 frames a second (or the display's limit) and keep the
// best-looking settings that hold it.  Any manual change (G) switches this off.
const perf = { t: 0, frames: 0, warm: 2.5, L: 2, cap: 0, probe: 0, done: FORCE_Q >= 0, climb: true, trial: false, ceil: 0, slow: 0, fps: 0 };
function setLevel(L) { perf.L = clamp(L, 0, LADDER.length - 1); applyQuality(LADDER[perf.L][0], LADDER[perf.L][1]); perf.warm = 1.2; perf.t = 0; perf.frames = 0; }
function autoQuality(dt) {
  perf.t += dt; perf.frames++;
  if (perf.warm > 0) { perf.warm -= dt; perf.t = 0; perf.frames = 0; return; }
  if (perf.t < 1.5) return;
  const fps = perf.frames / perf.t; perf.t = 0; perf.frames = 0; perf.fps = fps;
  if (FORCE_Q >= 0 || perf.manual || !started) return;
  const last = LADDER.length - 1, L = perf.L;
  if (fps < 50 && L < last) { perf.ceil = L + 1; perf.climb = false; perf.trial = false; setLevel(L + (fps < 28 ? 2 : 1)); return; }
  if (!perf.done) { // first seconds: step down until we hit the target, or until stepping down stops helping (display limit)
    if (fps >= 97) { perf.done = true; perf.cap = fps; }
    else if (!perf.probe) { perf.probe = fps; if (L < last - 1) setLevel(L + 1); else { perf.done = true; perf.cap = fps; } }
    else if (fps > perf.probe * 1.08) { perf.probe = fps; if (fps < 97 && L < last - 1) setLevel(L + 1); else { perf.done = true; perf.cap = fps; } }
    else { perf.done = true; perf.cap = Math.max(perf.probe, fps); setLevel(L - 1); }
    return;
  }
  const hold = Math.min(97, perf.cap * 0.93);
  if (perf.trial) { perf.trial = false; if (fps < hold) { perf.ceil = L + 1; perf.climb = false; setLevel(L + 1); } return; }
  if (perf.climb) { if (fps >= hold && L > perf.ceil) { perf.trial = true; setLevel(L - 1); } else perf.climb = false; return; }
  if (fps < perf.cap * 0.78 && L < last) { if (++perf.slow >= 2) { perf.slow = 0; perf.ceil = L + 1; setLevel(L + 1); } } else perf.slow = 0;
}

// ---------------------------------------------------------------- hero (original design)
const { hero, R, M } = buildHero(scene);
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
  pos: new V3(), prev: new V3(), vel: new V3(), pv: new V3(), state: 'air', grounded: false,
  anchor: new V3(), pivot: new V3(), swingDir: new V3(), anchorN: new V3(), ropeLen: 0, ropeT: 0, hand: 'R',
  wallN: new V3(), wallMove: new V3(0, 1, 0), hitN: new V3(), wallHit: false, impact: 0,
  zip: null, facing: new V3(0, 0, 1), timeInAir: 0, swingArmed: false, swingCd: 0, wallCd: 0,
  landT: 0, rollT: 0, skimT: 0, launchT: 0, squash: 0, idleT: 0, perch: 0, lean: 0, fy: 0,
  rpos: new V3(), trick: null, combo: 0, style: 0, runPh: 0, aimW: 0, aimW2: 0, baseQ: new THREE.Quaternion(), offset: new V3(), inp: new V3(), best: 0,
};
const tv = new V3(), tv2 = new V3(), tv3 = new V3(), tv4 = new V3(), tq = new THREE.Quaternion(), tq2 = new THREE.Quaternion(), tm = new THREE.Matrix4();
const qbuf = [], qbuf2 = [];

// ---------------------------------------------------------------- input
const keys = {};
const ev = { jump: false, swing: false, zip: false, trick: null };
let mouse0 = false, locked = false, everLocked = false, started = false, lastMouse = 0, dragging = false;
// the camera eases toward yawT/pitchT; position never changes where it points
const C = { yaw: 0, pitch: -0.2, yawT: 0, pitchT: -0.2, dist: 4, occl: 4, hold: 0, side: 0.5, fov: 62, target: new V3(), shake: 0, kick: 0, roll: 0, mAvg: 4 };
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
  if (e.code === 'KeyG') { perf.manual = true; applyQuality((qIdx + QUALITY.length - 1) % QUALITY.length, 1, true); }
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
  const dx = e.movementX || 0, dy = e.movementY || 0, mag = Math.abs(dx) + Math.abs(dy);
  // browsers occasionally report one huge bogus pointer-lock delta; a real hand ramps up to speed
  if (mag > 450 || (mag > 150 && mag > C.mAvg * 12 + 100)) { C.mAvg += (Math.min(mag, 120) - C.mAvg) * 0.15; return; }
  C.mAvg += (mag - C.mAvg) * 0.25;
  const s = 0.0022;
  C.yawT -= dx * s; C.pitchT = clamp(C.pitchT - dy * s, -1.35, 0.8);
  lastMouse = performance.now();
});
function tryLock() {
  const plain = () => { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) {} };
  try { // raw input first: no OS acceleration, and it avoids the delta spikes that made the view jump
    const r = canvas.requestPointerLock({ unadjustedMovement: true });
    if (r && r.catch) r.catch(plain);
  } catch (_) { plain(); }
}
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) everLocked = true;
  C.mAvg = 4;
  document.getElementById('pause').classList.toggle('show', started && everLocked && !locked);
});
document.getElementById('start').addEventListener('click', () => {
  document.getElementById('help').classList.remove('hide');
  setTimeout(() => document.getElementById('help').classList.add('hide'), 30000);
  started = true; document.body.classList.add('playing'); document.getElementById('start').classList.add('gone'); initAudio(); tryLock();
});
document.getElementById('pause').addEventListener('click', () => tryLock());
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
const swingDown = () => !!(keys.Space || mouse0);

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
  const reach = 27 + clamp(hs, 0, 60) * 0.3;
  let best = null, bestS = 1e9;
  const cands = [[reach, 36, 11], [reach * 0.8, 28, -11], [reach * 0.55, 21, 19]];
  for (const [fw, upd, sd] of cands) {
    const ideal = tv3.copy(p).addScaledVector(fwd, fw).addScaledVector(side, sd); ideal.y += upd;
    query(ideal.x - 55, ideal.x + 55, ideal.z - 55, ideal.z + 55, qbuf);
    for (const b of qbuf) {
      if (b.slab || b.prop || b.maxY < p.y + 4) continue;
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
      if (dist < 8 || dist > 92) continue;
      const facing = n.x * fwd.x + n.z * fwd.z; // < 0: wall faces us (building dead ahead)
      const clear = q.y - dist; // lowest point of the arc
      const s = q.distanceTo(ideal) + (n.y > 0 ? 6 : 0) + (facing < -0.5 ? 26 : 0) + Math.max(0, 6 - clear) * 0.8 + Math.max(0, 14 - (q.y - p.y)) * 0.7;
      if (s < bestS) { bestS = s; best = { p: q, n }; }
    }
    if (best && bestS < 34) break;
  }
  if (best) best.dir = fwd.clone();
  return bestS < 52 ? best : null;
}

// what the reticle is pointing at: the place a slingshot (F) will throw you past
let zipInfo = null;
function computeZip() {
  zipInfo = null;
  if (P.state === 'zip') return;
  const o = camera.position, d = camera.getWorldDirection(tv);
  const h = raycastWorld(o, d, 360);
  if (!h) return;
  const dist = h.p.distanceTo(P.pos);
  if (dist > 250 || dist < 7) return;
  const b = h.box;
  if (h.n.y > 0.5 || b.maxY - h.p.y < 7) { // a roof or its lip: aim just over the edge
    const T = h.p.clone(); T.y = b.maxY;
    const target = T.clone(); target.y += 2.4;
    zipInfo = { hit: T, target, n: h.n.clone(), launch: true };
  } else zipInfo = { hit: h.p.clone(), target: h.p.clone().addScaledVector(h.n, 1.2), n: h.n.clone(), launch: false };
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
  P.pivot.copy(a.p).addScaledVector(perp, -lat * 0.94);
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
// F: fire a line at the aimed point and haul yourself along it, letting go early so you fly on past
function startZip(z) {
  if (P.trick) endTrick(true);
  const D = z.target.distanceTo(P.pos);
  P.state = 'zip'; P.zip = { ...z, from: P.pos.clone(), t: 0, speed: Math.max(30, P.vel.length() * 0.8 + 12), rel: clamp(D * 0.3, 6, 30) };
  P.hand = 'R'; P.ropeT = 0; addSplat(z.hit, z.n); thwip(1.3);
}
function slingRelease(dir) {
  const z = P.zip, v = P.vel, sp = Math.max(z.speed, 36);
  v.copy(dir).multiplyScalar(sp);
  if (!z.launch) { // aimed at a wall: skim up its face instead of ploughing into it
    const into = -(v.x * z.n.x + v.z * z.n.z);
    if (into > 0) { v.x += z.n.x * into * 0.9; v.z += z.n.z * into * 0.9; v.y += into * 0.55; }
  }
  v.y += (9 + sp * 0.1) * clamp(1 + dir.y, 0.25, 1);
  P.state = 'air'; P.timeInAir = 0.3; P.swingArmed = false; P.swingCd = 0.3; P.zip = null; P.launchT = 0.8;
  C.shake = Math.max(C.shake, 0.3); C.kick = 1;
  P.combo++; addStyle(40, 'SLINGSHOT'); whoosh(1.1);
  if (rnd() < 0.3) startTrick(rnd() < 0.5 ? 'q' : 'e');
}
function enterWall(n) {
  P.state = 'wall'; P.wallT = 0; P.wallN.copy(n); P.vel.set(0, Math.max(0, P.vel.y) * 0.4, 0);
  if (P.trick) endTrick(true);
}
function land() {
  const imp = P.impact, v = P.vel, hs = Math.hypot(v.x, v.z);
  let bail = false;
  if (P.trick) { endTrick(true); flash('BAIL!'); P.combo = 0; bail = true; }
  if (!bail && swingDown() && hs > 8) { // touch-and-go: skim the surface and stay in the air, speed intact
    v.y = 6.5 + Math.min(imp * 0.1, 4); P.state = 'air'; P.timeInAir = 0.2; P.swingArmed = true; P.swingCd = 0.08; P.skimT = 0.3; P.squash = 0.5;
    C.shake = Math.max(C.shake, 0.1); thud(0.3); return;
  }
  if (P.combo >= 3) flash(`COMBO x${P.combo} BANKED`);
  P.combo = 0; P.state = 'ground'; P.idleT = 0; P.groundT = 0;
  if (imp > 40) { P.landT = 0.5; v.x *= 0.45; v.z *= 0.45; C.shake = 0.55; P.squash = 1; thud(1); }
  else if (imp > 15) { if (hs > 8) P.rollT = 0.46; else P.landT = 0.16; C.shake = Math.max(C.shake, 0.18); P.squash = 0.7; thud(0.5); }
  else { P.squash = Math.max(P.squash, clamp(imp / 20, 0.15, 0.5)); if (imp > 5) thud(0.2); }
}
// Hitting a facade never stops you.  A glancing hit keeps its speed along the wall; a head-on hit
// turns into a run along the wall toward the nearer corner (or up and over, if the roof is close).
function deflect() {
  const p = P.pos, v = P.vel, pv = P.pv, n = P.hitN, b = P.hitBox, pre = pv.length(), held = swingDown();
  const into = -(pv.x * n.x + pv.z * n.z);
  if (into < 3 || (pre < 10 && !held)) return false;
  const hs = Math.hypot(v.x, v.z);
  if (hs > pre * 0.45) { const k = Math.min((pre * 0.94) / Math.max(v.length(), 1e-3), 1.6); v.x *= k; v.z *= k; v.y = v.y * k + into * 0.2; }
  else {
    const ax = Math.abs(n.x) > 0.5, inT = ax ? P.inp.z : P.inp.x, vT = ax ? pv.z : pv.x;
    let d = 1;
    if (Math.abs(inT) > 0.4) d = Math.sign(inT);
    else if (Math.abs(vT) > 0.3 * pre) d = Math.sign(vT);
    else if (b) { const q = ax ? p.z : p.x, lo = ax ? b.minZ : b.minX, hi = ax ? b.maxZ : b.maxX; d = q - lo < hi - q ? -1 : 1; }
    const speed = Math.max(pre * 0.9, held ? 16 : 0), top = b ? b.maxY - (p.y - HY) : 99;
    let up, side;
    if (top < 14) { up = Math.sqrt(64 * (top + 2.5)); side = Math.max(4, speed * 0.3); }   // the roof is within reach: straight up and over
    else { up = Math.max(v.y, speed * 0.35); side = speed * 0.9; }
    if (ax) { v.z = d * side; v.x = 0; } else { v.x = d * side; v.z = 0; }
    v.y = Math.max(v.y, up);
  }
  v.addScaledVector(n, 1.2);
  if (into > 14) { C.shake = Math.max(C.shake, 0.14); thud(0.25); }
  return true;
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
  const swingHeld = swingDown();
  P.swingCd -= dt; P.wallCd -= dt; P.timeInAir += dt; P.landT -= dt; P.rollT -= dt; P.skimT -= dt; P.launchT -= dt;
  const jumpEv = ev.jump, swingEv = ev.swing, zipEv = ev.zip;
  ev.jump = ev.swing = ev.zip = false;
  if (swingEv && (P.state === 'air')) P.swingArmed = true;
  if (zipEv && zipInfo && P.state !== 'zip') startZip(zipInfo);

  switch (P.state) {
    case 'ground': {
      const top = (shift ? 26 : 12) * (P.landT > 0 ? 0.2 : 1);
      const hs = Math.hypot(v.x, v.z), has = inp.lengthSq() > 0.01;
      let tx = inp.x * top, tz = inp.z * top, a;
      if (has && hs > top + 1 && v.x * inp.x + v.z * inp.z > 0.5 * hs) { // arriving faster than a run: carry the momentum and bleed it off gently
        const keep = Math.max(top, hs - 9 * dt); tx = inp.x * keep; tz = inp.z * keep; a = 60 * dt;
      } else a = (has ? (hs < 4 ? 44 : 70) : hs > 14 ? 24 : 48) * dt;
      const dx = tx - v.x, dz = tz - v.z, dl = Math.hypot(dx, dz);
      if (dl > a) { v.x += (dx / dl) * a; v.z += (dz / dl) * a; } else { v.x = tx; v.z = tz; }
      v.y += G * dt;
      P.groundT = (P.groundT || 0) + dt;
      const hop = swingHeld && P.groundT > 0.16;   // still holding swing after touching down: leap straight back into it
      if ((jumpEv || hop) && P.landT <= 0.1) {
        v.y = shift ? 17 : 15; P.state = 'air'; P.timeInAir = 0; P.swingArmed = hop; P.swingCd = hop ? 0.14 : P.swingCd; P.rollT = 0; whoosh(0.5);
      }
      break;
    }
    case 'air': {
      const dive = shift && v.y < 6;
      v.y += G * (dive ? 2.1 : 1) * dt;
      const along = v.x * inp.x + v.z * inp.z;
      if (inp.lengthSq() > 0.01 && along < 32) { v.x += inp.x * 16 * dt; v.z += inp.z * 16 * dt; }
      if (v.y < (dive ? -95 : -68)) v.y = dive ? -95 : -68;
      if (swingHeld && P.swingCd <= 0 && (P.swingArmed || (P.timeInAir > 0.28 && (v.y < -3 || P.timeInAir > 1.1)))) {
        const hs = Math.hypot(v.x, v.z), f = camFwdH(tv);
        if (hs > 4) f.multiplyScalar(0.5).addScaledVector(tv2.set(v.x / hs, 0, v.z / hs), 0.5).normalize();
        const look = 9 + hs * 0.3;
        if (rayDist(p, f.x, 0, f.z, look) >= look) tryAttach(); else P.swingCd = 0.1;   // a wall dead ahead: a line would only drag us into it
      }
      break;
    }
    case 'swing': {
      v.y += G * dt;
      const n = tv.subVectors(p, P.pivot); const len = n.length(); n.divideScalar(len);
      const hasIn = inp.lengthSq() > 0.01;
      // steer: blend travel direction toward input / camera
      const want = hasIn ? tv2.copy(inp) : camFwdH(tv2);
      P.swingDir.lerp(want, damp(hasIn ? 2.2 : 0.9, dt)).normalize();
      const dir = tv3.copy(P.swingDir);
      dir.addScaledVector(n, -dir.dot(n));
      if (dir.lengthSq() > 0.01) { dir.normalize(); const along = v.dot(dir); v.addScaledVector(dir, ((hasIn ? 9 : 5) + clamp((34 - along) * 0.9, 0, 16)) * dt); }
      // pump at the bottom of the arc for speed (hold forward)
      if (hasIn && v.y < 4 && len > P.ropeLen * 0.96) { const hv = Math.hypot(v.x, v.z); if (hv > 2 && hv < 55) v.addScaledVector(tv3.set(v.x / hv, 0, v.z / hv), 5 * dt); }
      // bleed sideways drift (relative to the steering direction)
      const sx = -P.swingDir.z, sz = P.swingDir.x, lat = v.x * sx + v.z * sz;
      const k = damp(2.2, dt); v.x -= sx * lat * k; v.z -= sz * lat * k;
      // reel in gently; reel fast if the arc would hit the street
      const floor = P.pivot.y - P.ropeLen;
      P.ropeLen = Math.max(9, P.ropeLen - (floor < 6 ? 6 + (6 - floor) * 3 : 0.8) * dt);
      if (!swingHeld) release(false);
      else if (p.y > P.pivot.y - 1.5) release(true);
      else { // past ~55 degrees forward on the up-swing: let go automatically and carry momentum
        const fwdOff = (p.x - P.pivot.x) * P.swingDir.x + (p.z - P.pivot.z) * P.swingDir.z;
        if (v.y > 0 && fwdOff > len * 0.6) release(true);
      }
      break;
    }
    case 'zip': { // hauled along the line, faster and faster, then thrown past the anchor
      const z = P.zip; z.t += dt; z.speed = Math.min(80, z.speed + 150 * dt);
      const d = tv.subVectors(z.target, p); const dist = d.length() || 1e-3;
      d.divideScalar(dist);
      if (dist < z.rel || z.t > 3) slingRelease(d);
      else { v.lerp(tv2.copy(d).multiplyScalar(z.speed), damp(16, dt)); v.y += 4 * dt; }
      break;
    }
    case 'wall': {
      const n = P.wallN;
      const L = tv.set(n.z, 0, -n.x); // lateral axis along wall
      // holding swing on a wall means "keep going": sprint straight up it and vault the top
      const fk = swingHeld ? 1 : (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), rk = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
      const lat = rk * Math.sign(camRightH(tv2).dot(L) || 1);
      const sp = swingHeld ? 30 : shift ? 21 : 9;
      v.set(0, fk * sp, 0).addScaledVector(L, lat * sp * 0.75).addScaledVector(n, -2);
      if (fk || lat) P.wallMove.set(0, fk, 0).addScaledVector(L, lat).normalize();
      if (jumpEv) {
        v.copy(n).multiplyScalar(15); v.y = 12; v.addScaledVector(inp, 5);
        P.state = 'air'; P.timeInAir = 0; P.wallCd = 0.4; P.swingArmed = false; startTrick('z'); whoosh(0.8);
      }
      break;
    }
  }
  const spd = v.length(); if (spd > 92) v.multiplyScalar(92 / spd);
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
  P.pv.copy(v);
  P.grounded = false; P.wallHit = false; P.impact = 0;
  const onIsland = world.groundAt(p.x, p.z);
  if (onIsland && p.y < HY) { p.y = HY; if (v.y < 0) { P.impact = -v.y; v.y = 0; } P.grounded = true; }
  query(p.x - 2, p.x + 2, p.z - 2, p.z + 2, qbuf);
  for (const b of qbuf) {
    if (!(p.x + HX > b.minX && p.x - HX < b.maxX && p.y + HY > b.minY && p.y - HY < b.maxY && p.z + HZ > b.minZ && p.z - HZ < b.maxZ)) continue;
    const feet = p.y - HY;
    // step up onto anything knee-high; when flying fast, clear a waist-high lip instead of stopping against it
    const lip = P.state === 'ground' ? 0.5 : 0.5 + clamp((Math.hypot(v.x, v.z) - 10) / 30, 0, 1) * 0.7;
    if (b.maxY - feet < lip && v.y <= 1) { p.y = b.maxY + HY; if (v.y < 0) { P.impact = Math.max(P.impact, -v.y); v.y = 0; } P.grounded = true; continue; }
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
      case 0: p.x += pen; if (v.x < 0) v.x = 0; P.wallHit = true; P.hitBox = b; P.hitN.set(1, 0, 0); break;
      case 1: p.x -= pen; if (v.x > 0) v.x = 0; P.wallHit = true; P.hitBox = b; P.hitN.set(-1, 0, 0); break;
      case 2: p.y += pen; if (v.y < 0) { P.impact = Math.max(P.impact, -v.y); v.y = 0; } P.grounded = true; break;
      case 3: p.y -= pen; if (v.y > 0) v.y = 0; break;
      case 4: p.z += pen; if (v.z < 0) v.z = 0; P.wallHit = true; P.hitBox = b; P.hitN.set(0, 0, 1); break;
      case 5: p.z -= pen; if (v.z > 0) v.z = 0; P.wallHit = true; P.hitBox = b; P.hitN.set(0, 0, -1); break;
    }
  }
}

function postCollide(inp, jumpEv) {
  const v = P.vel;
  if (P.state === 'wall') {
    const held = swingDown(), fk = held ? 1 : (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0);
    if (P.grounded && fk < 0) { P.state = 'ground'; return; }
    if (!P.wallHit || P.hitN.dot(P.wallN) < 0.9) {
      if (fk > 0) { // crested the top -> vault onto the roof, carrying the run forward
        v.copy(P.wallN).multiplyScalar(held ? -14 : -7); v.y = 10; P.state = 'air'; P.timeInAir = 0.3; P.wallCd = 0.5; P.swingArmed = held; P.swingCd = 0.25; whoosh(0.6);
      } else { P.state = 'air'; P.timeInAir = 0.3; P.wallCd = 0.3; }
    }
    return;
  }
  if (P.grounded) {
    if (P.state === 'air' || P.state === 'swing') land();
    else if (P.state === 'zip' && P.zip.t > 0.25) { P.state = 'ground'; P.zip = null; }
  } else if (P.state === 'ground') { P.state = 'air'; P.timeInAir = 0; P.swingArmed = false; }
  if (P.wallHit) {
    const into = -(inp.x * P.hitN.x + inp.z * P.hitN.z);
    if (P.state === 'zip') { if (P.zip.t > 0.12) { P.state = 'air'; P.zip = null; P.timeInAir = 0.3; P.swingCd = 0.2; deflect(); } }
    else if ((P.state === 'air' || P.state === 'swing') && P.wallCd <= 0 && into > 0.55 && (!swingDown() || P.pv.length() < 12)) enterWall(P.hitN);   // cling (or, holding swing, run up it)
    else if (P.state === 'air') deflect();
    else if (P.state === 'swing') { // the line would drag us along the facade: let go, keep the speed, re-fire as soon as there is a clear anchor
      if (deflect()) { P.state = 'air'; P.timeInAir = 0.2; P.swingArmed = true; P.swingCd = 0.2; }
    }
    else if (P.state === 'ground' && into > 0.55) enterWall(P.hitN);
  }
}

function resetCam() { C.yawT = C.yaw; C.pitchT = C.pitch; C.target.copy(P.pos); C.target.y += 0.55; C.occl = C.dist; C.hold = 0; C.roll = 0; }
let spawnPos = new V3(), spawnYaw = 0;
function chooseSpawn() {
  let best = null, bs = 1e9;
  for (const b of boxes) {
    if (b.slab || b.minY > 1 || b.maxY < 84 || b.maxY > 135 || b.maxX - b.minX < 15 || b.maxZ - b.minZ < 15) continue;
    const cx = (b.minX + b.maxX) / 2, cz = b.maxZ - 5;
    const s = Math.hypot(cx - world.spawn.x, cz - world.spawn.z);
    if (s >= bs) continue;
    let clear = true; // nothing may be standing on this roof where we land
    for (const c of boxes) if (c !== b && c.minY >= b.maxY - 0.5 && c.minY < b.maxY + 30 && c.minX < cx + 2 && c.maxX > cx - 2 && c.minZ < cz + 2 && c.maxZ > cz - 2) { clear = false; break; }
    if (clear) { bs = s; best = b; }
  }
  const b = best || boxes.find((q) => !q.slab);
  spawnPos.set((b.minX + b.maxX) / 2, b.maxY + HY + 0.05, b.maxZ - 5);   // near the uptown edge of the roof
  spawnYaw = 0; // face uptown, toward the tallest towers
}
function respawn(msg) {
  P.pos.copy(spawnPos); P.prev.copy(spawnPos); P.rpos.copy(spawnPos); P.vel.set(0, 0, 0); P.state = 'air'; P.trick = null; P.combo = 0; P.zip = null;
  P.landT = P.rollT = P.skimT = P.launchT = 0; P.idleT = 2;
  C.yaw = spawnYaw; C.pitch = -0.12; resetCam();
  P.facing.set(Math.sin(spawnYaw), 0, Math.cos(spawnYaw)); P.fy = spawnYaw;
  if (life) life.refresh();
  if (msg) flash('SPLASH! BACK TO THE ROOFTOPS');
}

// ---------------------------------------------------------------- animation
const XAX = new V3(1, 0, 0);
function Bl(j, x, y, z, w) { const t = tgt[j]; t[0] += (x - t[0]) * w; t[1] += (y - t[1]) * w; t[2] += (z - t[2]) * w; }
function updateAnim(dt, time) {
  const v = P.vel, hs = Math.hypot(v.x, v.z), sp = v.length(), st = P.state;
  for (const j of JOINTS) S(j, 0, 0, 0);
  tgt.hipsY = 0;
  let rate = 12, aimR = 0, aimL = 0, look = 0;
  const tr = P.trick, rolling = st === 'ground' && P.rollT > 0 && !tr;
  // facing eases toward the direction of travel; turning leans the body
  if (hs > 0.6 && dt > 0) { tv.set(v.x / hs, 0, v.z / hs); P.facing.lerp(tv, damp(st === 'ground' ? 13 : 9, dt)); P.facing.y = 0; if (P.facing.lengthSq() < 1e-4) P.facing.copy(tv); P.facing.normalize(); }
  const fy = Math.atan2(P.facing.x, P.facing.z);
  if (dt > 0) { const turn = angDiff(fy, P.fy) / dt; P.fy = fy; P.lean += (clamp(turn * hs * 0.01, -0.3, 0.3) * (st === 'ground' ? 1 : 0.4) - P.lean) * damp(5, dt); }
  if (st === 'ground' && hs < 0.6 && P.landT <= 0) P.idleT += dt; else P.idleT = 0;
  const wantPerch = st === 'ground' && P.idleT > 0.45 && P.pos.y > 9 ? 1 : 0;   // settle into a crouch on rooftops and ledges
  P.perch = clamp(P.perch + (wantPerch ? dt * 2.6 : -dt * 6), 0, 1);
  P.squash = Math.max(0, P.squash - dt * 3.2);

  if (tr || rolling) {
    rate = 20;
    if (rolling || tr.pose === 'tuck') { S('spine', 0.55, 0, 0); S('chest', 0.2, 0, 0); S('head', 0.3, 0, 0); sym('hip', -1.95, 0, 0.15); sym('kn', 2.35, 0, 0); sym('sh', -1.0, 0, 0.25); sym('el', -1.6, 0, 0); sym('ft', 0.4, 0, 0); }
    else { sym('sh', 0, 0, 1.45); sym('el', -0.1, 0, 0); sym('hip', -0.15, 0, 0.32); sym('kn', 0.25, 0, 0); S('spine', -0.1, 0, 0); sym('ft', 0.6, 0, 0); }
  } else if (st === 'ground') {
    if (P.landT > 0) { // heavy landing: drop to one knee, one hand down
      tgt.hipsY = -0.42; S('spine', 0.7, 0, 0); S('chest', 0.1, 0, 0); S('head', -0.6, 0, 0);
      S('hipL', -1.75, 0, 0.25); S('knL', 2.35, 0, 0); S('hipR', -0.35, 0, -0.25); S('knR', 2.2, 0, 0); S('ftR', 0.9, 0, 0);
      S('shL', -0.1, 0, 1.25); S('elL', -0.2, 0, 0); S('shR', -1.15, 0, -0.2); S('elR', -0.15, 0, 0); rate = 22;
    } else if (hs > 0.8) {
      const sprint = clamp((hs - 12) / 14, 0, 1);
      P.runPh += dt * (4 + hs * 0.5);
      const ph = P.runPh, s = Math.sin(ph), c = Math.cos(ph), A = clamp(hs / 9, 0.35, 1.15);
      S('spine', 0.1 + 0.26 * sprint, 0.1 * s * A, 0); S('chest', 0.04 + 0.1 * sprint, -0.22 * s * A, 0); S('head', -0.1 - 0.3 * sprint, 0.1 * s * A, 0);
      S('shL', 0.95 * s * A, 0, 0.14 + 0.08 * sprint); S('shR', -0.95 * s * A, 0, -0.14 - 0.08 * sprint);
      S('elL', -0.7 - 0.6 * A + 0.35 * s * A, 0, 0); S('elR', -0.7 - 0.6 * A - 0.35 * s * A, 0, 0);
      S('hipL', -0.22 - 1.0 * s * A - 0.12 * sprint, 0, 0.04); S('hipR', -0.22 + 1.0 * s * A - 0.12 * sprint, 0, -0.04);
      S('knL', 0.25 + 1.5 * A * Math.max(0, c), 0, 0); S('knR', 0.25 + 1.5 * A * Math.max(0, -c), 0, 0);
      S('ftL', 0.5 * Math.max(0, -s) * A, 0, 0); S('ftR', 0.5 * Math.max(0, s) * A, 0, 0);   // push off the toes
      tgt.hipsY = -0.05 - 0.07 * Math.abs(c) * A; rate = 18; look = 0.35;
    } else {
      const b = Math.sin(time * 1.9), b2 = Math.sin(time * 0.7);
      S('spine', 0.03 + 0.012 * b, 0, 0.015 * b2); S('chest', -0.03 * b, 0, 0);
      S('shL', 0.04, 0, 0.11 + 0.01 * b); S('shR', 0.04, 0, -0.11 - 0.01 * b); sym('el', -0.22, 0, 0);
      S('hipL', -0.04, 0, 0.07); S('hipR', -0.08, 0, -0.05); sym('kn', 0.1, 0, 0); S('head', -0.03, 0, 0);
      look = 1;
      const w = smooth(P.perch);
      if (w > 0.001) { // rooftop perch: deep crouch, knees wide, one hand planted, head up watching the city
        tgt.hipsY = lerp(tgt.hipsY, -0.7 + 0.01 * b, w);
        Bl('spine', 0.5 + 0.015 * b, 0, 0, w); Bl('chest', 0.3, 0, 0, w); Bl('head', -0.72, 0, 0, w);
        Bl('hipL', -2.05, 0, 0.6, w); Bl('knL', 2.5, 0, 0, w); Bl('hipR', -2.05, 0, -0.6, w); Bl('knR', 2.5, 0, 0, w);
        Bl('shL', -0.74, 0, 0.1, w); Bl('elL', -0.1, 0, 0, w); Bl('haL', -0.5, 0, 0, w);
        Bl('shR', -0.85, 0, -0.32, w); Bl('elR', -1.55, 0, 0, w);
        rate = 10;
      }
    }
    const q = P.squash; // knees soak up a landing
    if (q > 0.01 && P.landT <= 0) { tgt.hipsY -= 0.3 * q; tgt.hipL[0] -= 0.75 * q; tgt.hipR[0] -= 0.75 * q; tgt.knL[0] += 1.3 * q; tgt.knR[0] += 1.3 * q; tgt.spine[0] += 0.3 * q; rate = 22; }
  } else if (st === 'swing') { // legs trail on the way down, sweep through the bottom, tuck on the way up
    const len = P.rpos.distanceTo(P.pivot) || 1;
    const fo = clamp(((P.rpos.x - P.pivot.x) * P.swingDir.x + (P.rpos.z - P.pivot.z) * P.swingDir.z) / len, -1, 1), t = (fo + 1) / 2;
    const hipx = lerp(0.4, -1.45, smooth(t)), knx = t < 0.5 ? lerp(0.75, 0.2, t * 2) : lerp(0.2, 1.9, (t - 0.5) * 2);
    S('spine', lerp(-0.28, 0.3, t), 0, 0); S('chest', lerp(-0.15, 0.12, t), 0, 0); S('head', lerp(0.1, -0.35, t), 0, 0);
    S('hipL', hipx - 0.18, 0, 0.1); S('knL', knx + 0.25, 0, 0); S('hipR', hipx + 0.2, 0, -0.1); S('knR', knx, 0, 0); sym('ft', 0.5, 0, 0);
    if (P.hand === 'R') { aimR = 1; S('shL', 0.9 - t * 1.1, 0, 0.75); S('elL', -0.45, 0, 0); } else { aimL = 1; S('shR', 0.9 - t * 1.1, 0, -0.75); S('elR', -0.45, 0, 0); }
    rate = 8;
  } else if (st === 'zip') {
    aimR = 1; aimL = 0.9; S('spine', -0.2, 0, 0); S('chest', -0.1, 0, 0); S('head', -0.35, 0, 0);
    S('hipL', 0.25, 0, 0.08); S('knL', 0.9, 0, 0); S('hipR', 0.45, 0, -0.08); S('knR', 0.35, 0, 0); sym('ft', 0.6, 0, 0); rate = 14;
  } else if (st === 'wall') {
    const moving = Math.abs(v.y) + Math.hypot(v.x, v.z) > 3;
    if (moving && (shiftDown() || swingDown())) {
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
    sym('ft', -0.3, 0, 0);
  } else { // air
    sym('ft', 0.55, 0, 0);
    if (shiftDown() && v.y < 6) { // dive
      sym('sh', 0.3, 0, 0.32); sym('el', -0.05, 0, 0); sym('hip', 0.05, 0, 0.06); sym('kn', 0.15, 0, 0); S('spine', -0.05, 0, 0); S('head', -0.5, 0, 0); rate = 10;
    } else if (P.skimT > 0) { // touch-and-go off a surface: knees up, arms out for balance
      sym('hip', -1.25, 0, 0.14); sym('kn', 1.85, 0, 0); S('spine', 0.28, 0, 0); sym('sh', -0.2, 0, 0.95); sym('el', -0.4, 0, 0); rate = 20;
    } else if (P.launchT > 0 && v.y > -6) { // thrown by the slingshot: streamlined, arms swept back
      sym('sh', 0.8, 0, 0.3); sym('el', -0.1, 0, 0); S('hipL', 0.1, 0, 0.05); S('knL', 0.12, 0, 0); S('hipR', -0.25, 0, -0.05); S('knR', 0.6, 0, 0);
      S('spine', -0.18, 0, 0); S('chest', -0.1, 0, 0); S('head', -0.45, 0, 0); sym('ft', 0.75, 0, 0); rate = 12;
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
  for (const j of JOINTS) { const c = cur[j], t = tgt[j]; c[0] += (t[0] - c[0]) * k; c[1] += (t[1] - c[1]) * k; c[2] += (t[2] - c[2]) * k; }
  cur.hipsY += (tgt.hipsY - cur.hipsY) * k; R.hips.position.y = cur.hipsY + 0.04;
  // the head (and a little of the chest) follows where the camera is looking
  P.lookW = (P.lookW || 0) + (look - (P.lookW || 0)) * damp(6, dt);
  const ly = clamp(angDiff(C.yaw, fy), -1.15, 1.15) * P.lookW, lp = clamp(C.pitch, -0.7, 0.6) * 0.45 * P.lookW;
  const sC = cur.spine, cC = cur.chest, hC = cur.head;
  R.spine.rotation.set(sC[0] * 0.6, sC[1] * 0.6, sC[2] * 0.6);
  R.chest.rotation.set(sC[0] * 0.4 + cC[0], sC[1] * 0.4 + cC[1] + ly * 0.22, sC[2] * 0.4 + cC[2]);
  R.head.rotation.set(hC[0] - lp, hC[1] + ly * 0.62, hC[2]);
  for (const j of ['shL', 'elL', 'haL', 'shR', 'elR', 'haR', 'hipL', 'knL', 'hipR', 'knR']) { const c = cur[j]; R[j].rotation.set(c[0], c[1], c[2]); }
  // feet: planted flat when standing on something, posed (toes pointed) in the air
  P.flat = (P.flat || 0) + ((st === 'ground' && !rolling && !tr ? 1 : 0) - (P.flat || 0)) * damp(14, dt);
  for (const sd of ['L', 'R']) {
    const f = R['ft' + sd], c = cur['ft' + sd]; f.rotation.set(c[0], c[1], c[2]);
    if (P.flat > 0.01) { tq.copy(R['hip' + sd].quaternion).multiply(R['kn' + sd].quaternion).invert(); tq2.setFromAxisAngle(XAX, c[0]); tq.multiply(tq2); f.quaternion.slerp(tq, P.flat); }
  }

  // ---- body orientation
  const up = tv.set(0, 1, 0), fw = tv2;
  let orate = 10;
  if (st === 'swing') { up.subVectors(P.pivot, P.rpos).normalize(); fw.copy(v); if (fw.lengthSq() < 1) fw.copy(P.facing); orate = 9; }
  else if (st === 'wall') { up.copy(P.wallN); fw.copy(P.wallMove); if (Math.abs(fw.dot(up)) > 0.9) fw.set(0, 1, 0); orate = 12; }
  else if (st === 'zip') { fw.subVectors(P.zip ? P.zip.target : P.pos, P.pos); if (fw.lengthSq() < 0.01) fw.copy(P.facing); fw.normalize(); up.addScaledVector(fw, 0.9).normalize(); orate = 12; }
  else if (st === 'air' && shiftDown() && v.y < 6 && !tr) { up.copy(v).normalize(); fw.set(0, -1, 0); if (Math.abs(fw.dot(up)) > 0.95) fw.copy(P.facing); orate = 6; }
  else if (st === 'air' && P.launchT > 0 && !tr && v.y > -6 && sp > 12) { up.copy(v).normalize(); up.y += 0.35; up.normalize(); fw.copy(P.facing).multiplyScalar(0.5); fw.y -= 0.85; orate = 9; }
  else if (st === 'air') {
    const f = clamp(-v.y / 20, 0, 1) * clamp((P.timeInAir - 0.25) / 0.6, 0, 1);
    fw.copy(P.facing); up.addScaledVector(P.facing, clamp(hs / 60, 0, 0.45) + f * 0.75); up.x += P.facing.z * P.lean; up.z -= P.facing.x * P.lean; up.normalize(); orate = 5.5;
  } else { // on foot: lean into turns, tip forward with speed
    fw.copy(P.facing); up.x += P.facing.z * P.lean; up.z -= P.facing.x * P.lean; up.addScaledVector(P.facing, clamp(hs / 26, 0, 1) * 0.1); up.normalize(); orate = 14;
  }
  fw.addScaledVector(up, -fw.dot(up));
  if (fw.lengthSq() < 1e-4) fw.copy(P.facing).addScaledVector(up, -P.facing.dot(up));
  fw.normalize();
  const xa = tv3.crossVectors(up, fw).normalize();
  tm.makeBasis(xa, up, fw); tq.setFromRotationMatrix(tm);
  P.baseQ.slerp(tq, damp(orate, dt));
  if (tr) { // trick spin
    tr.t += dt; const pp = clamp(tr.t / tr.dur, 0, 1);
    const e = pp < 0.5 ? 2 * pp * pp : 1 - (-2 * pp + 2) ** 2 / 2;
    tq2.setFromAxisAngle(tr.axis, tr.ang * e);
    hero.quaternion.copy(P.baseQ).multiply(tq2);
    if (pp >= 1) endTrick(false);
  } else if (rolling) { tq2.setFromAxisAngle(XAX, TAU * smooth(clamp(1 - P.rollT / 0.46, 0, 1))); hero.quaternion.copy(P.baseQ).multiply(tq2); }
  else hero.quaternion.copy(P.baseQ);
  // body offset (wall: stand on the wall surface; roll: turn over close to the ground)
  const offT = tv3.set(0, 0, 0);
  if (st === 'wall') offT.copy(P.wallN).multiplyScalar(0.5); else if (rolling) offT.set(0, -0.48, 0);
  P.offset.lerp(offT, damp(rolling ? 22 : 12, dt));
  hero.position.copy(P.rpos).add(P.offset);
  hero.updateMatrixWorld(true);

  // ---- arm aiming at web anchor
  P.aimW += ((aimR ? 1 : 0) - P.aimW) * damp(18, dt);
  P.aimW2 += ((aimL ? 1 : 0) - P.aimW2) * damp(18, dt);
  const target = st === 'zip' && P.zip ? P.zip.hit : P.anchor;
  if (P.aimW > 0.01) aimArm(R.shR, R.elR, target, P.aimW * (aimR || 1));
  if (P.aimW2 > 0.01) aimArm(R.shL, R.elL, target, P.aimW2 * (aimL || 1));
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
// The view direction comes only from the (smoothed) mouse angles, never from the
// camera's position, so obstacle avoidance can move the camera in and out without
// ever swinging the picture.  Whisker rays pull the camera in ahead of a collision.
const camPos = new V3(), camDir = new V3(), camPivot = new V3(), camO = new V3();
function rayDist(o, dx, dy, dz, maxT) { // nearest solid surface along a ray (no allocations)
  let best = maxT;
  const ex = o.x + dx * maxT, ez = o.z + dz * maxT;
  query(Math.min(o.x, ex) - 0.2, Math.max(o.x, ex) + 0.2, Math.min(o.z, ez) - 0.2, Math.max(o.z, ez) + 0.2, qbuf2);
  tv4.set(dx, dy, dz);
  for (const b of qbuf2) { if (b.slab) continue; const t = rayBox(o, tv4, b, best); if (t > 0 && t < best) best = t; }
  if (dy < -1e-4 && o.y > 0.5) { const tg = (o.y - 0.5) / -dy; if (tg < best && world.groundAt(o.x + dx * tg, o.z + dz * tg)) best = tg; }
  return best;
}
function updateCamera(dt, now, time) {
  const v = P.vel, sp = v.length(), hs = Math.hypot(v.x, v.z), st = P.state;
  if (now - lastMouse > 2200 && (st === 'swing' || st === 'air' || st === 'zip') && hs > 10) {
    C.yawT += angDiff(Math.atan2(v.x, v.z), C.yawT) * damp(0.8, dt) * clamp((now - lastMouse - 2200) / 1500, 0, 1);
  }
  if (keys.ArrowLeft) C.yawT += 2.2 * dt; if (keys.ArrowRight) C.yawT -= 2.2 * dt;
  if (keys.ArrowUp) C.pitchT = clamp(C.pitchT + 1.5 * dt, -1.35, 0.8); if (keys.ArrowDown) C.pitchT = clamp(C.pitchT - 1.5 * dt, -1.35, 0.8);
  const ks = dt > 0 ? damp(60, dt) : 1;
  C.yaw += (C.yawT - C.yaw) * ks; C.pitch += (C.pitchT - C.pitch) * ks;

  tv.copy(P.rpos); tv.y += 0.55 - P.perch * 0.4;
  C.target.lerp(tv, dt > 0 ? damp(st === 'zip' ? 30 : 20, dt) : 1);
  const want = 3.3 + clamp(sp / 70, 0, 1) * 2.6 + (st === 'swing' ? 0.5 : 0) + (st === 'wall' ? 0.9 : 0) - P.perch * 0.4;
  C.dist += (want - C.dist) * damp(2.5, dt);
  const cp = Math.cos(C.pitch), dx = Math.sin(C.yaw) * cp, dy = Math.sin(C.pitch), dz = Math.cos(C.yaw) * cp;
  camDir.set(dx, dy, dz);
  // over-the-shoulder pivot; the shoulder offset shrinks at speed and next to walls
  const rx = -Math.cos(C.yaw), rz = Math.sin(C.yaw);
  let side = 0.5 - clamp(sp / 40, 0, 1) * 0.28;
  const sClear = rayDist(C.target, rx, 0, rz, side + 0.35) - 0.35; if (sClear < side) side = Math.max(0, sClear);
  C.side += (side - C.side) * damp(side < C.side ? 18 : 4, dt);
  camPivot.copy(C.target); camPivot.x += rx * C.side; camPivot.z += rz * C.side; camPivot.y += 0.38;
  // hard clearance: centre ray plus four around it (the corners of the lens)
  const reach = C.dist + 0.5;
  let free = rayDist(camPivot, -dx, -dy, -dz, reach);
  for (let q = 0; q < 4; q++) {
    const ox = (q < 2 ? (q ? 0.32 : -0.32) : 0), oy = (q >= 2 ? (q === 2 ? 0.24 : -0.24) : 0);
    camO.copy(camPivot); camO.x += rx * ox; camO.z += rz * ox; camO.y += oy;
    const f = rayDist(camO, -dx, -dy, -dz, reach); if (f < free) free = f;
  }
  free = Math.max(0.55, free - 0.4);
  // soft clearance: whiskers fanned out to both sides see walls the camera is about to swing into
  let soft = free;
  for (const a of [-0.55, -0.28, 0.28, 0.55]) {
    const ya = C.yaw + a, wx = Math.sin(ya) * cp, wz = Math.cos(ya) * cp;
    const f = Math.max(0.55, rayDist(camPivot, -wx, -dy, -wz, reach) - 0.4), blend = f + (C.dist - f) * Math.min(1, Math.abs(a) / 0.7);
    if (blend < soft) soft = blend;
  }
  if (free < C.occl) { C.occl = free; C.hold = 0.22; }                           // something is in the way now: come in at once
  else if (soft < C.occl) { C.occl += (soft - C.occl) * damp(9, dt); C.hold = 0.22; }  // something is about to be: ease in
  else if ((C.hold -= dt) <= 0) C.occl += (Math.min(soft, C.dist + 0.5) - C.occl) * damp(2.6, dt);   // clear again: ease back out
  const dist = Math.min(C.dist, C.occl);
  camPos.copy(camPivot).addScaledVector(camDir, -dist);
  if (dist > 1.05) hero.visible = true; else if (dist < 0.85) hero.visible = false;

  // gentle life in the lens: bank with sideways motion, a rumble at speed, a jolt on impact, a slow breath when still
  const latV = v.x * rx + v.z * rz;
  C.roll += (clamp(latV * 0.0035, -0.075, 0.075) + (st === 'swing' ? Math.sin(time * 1.3) * 0.006 : 0) - C.roll) * damp(3.2, dt);
  C.shake = Math.max(0, C.shake - dt * 1.9); C.kick = Math.max(0, C.kick - dt * 1.6);
  const rum = clamp((sp - 38) / 45, 0, 1), sh = C.shake * C.shake * 1.6 + rum * 0.035, still = st === 'ground' && hs < 1 ? 1 : 0;
  const nx = Math.sin(time * 53.1) * 0.6 + Math.sin(time * 31.7 + 1.3) * 0.4, ny = Math.sin(time * 47.3 + 2.1) * 0.6 + Math.sin(time * 27.9) * 0.4;
  camera.position.set(camPos.x + rx * nx * sh * 0.22, camPos.y + ny * sh * 0.22 + still * Math.sin(time * 1.1) * 0.012, camPos.z + rz * nx * sh * 0.22);
  camera.lookAt(camera.position.x + dx, camera.position.y + dy, camera.position.z + dz);
  camera.rotateZ(-C.roll + nx * sh * 0.012 + still * Math.sin(time * 0.63) * 0.003);
  if (sh > 0.001) camera.rotateX(ny * sh * 0.014);
  const fov = 62 + clamp((sp - 14) / 56, 0, 1) * 21 + smooth(C.kick) * 7 - P.perch * 3;
  C.fov += (fov - C.fov) * damp(3, dt);
  if (Math.abs(camera.fov - C.fov) > 0.01) { camera.fov = C.fov; camera.updateProjectionMatrix(); }
}
// keep the sun's shadow box around the action, moving it in whole texels so shadow edges never crawl
const _sr = new V3(), _su = new V3(), _sc = new V3();
function placeSun() {
  _sc.copy(P.rpos); _sc.x += Math.sin(C.yaw) * 45; _sc.z += Math.cos(C.yaw) * 45;
  _sr.crossVectors(UP, lightDir).normalize(); _su.crossVectors(lightDir, _sr).normalize();
  const tex = (2 * SHR) / sun.shadow.mapSize.x, a = _sc.dot(_sr), b = _sc.dot(_su);
  _sc.addScaledVector(_sr, Math.round(a / tex) * tex - a).addScaledVector(_su, Math.round(b / tex) * tex - b);
  sun.target.position.copy(_sc); sun.position.copy(_sc).addScaledVector(lightDir, 500);
  sun.target.updateMatrixWorld(); sun.updateMatrixWorld();
  sun.shadow.needsUpdate = true;
}

// ---------------------------------------------------------------- audio (all synthesised, no samples)
let actx = null, master = null, muted = false, noiseBuf = null, AU = null;
let hornT = 3, sirenT = 22, stepN = 0, crowdN = 0, crowdTick = 0;
function initAudio() {
  if (actx) return;
  try {
    actx = new (window.AudioContext || window.webkitAudioContext)();
    const sr = actx.sampleRate;
    const comp = actx.createDynamicsCompressor(); comp.threshold.value = -16; comp.knee.value = 12; comp.ratio.value = 4; comp.connect(actx.destination);
    master = actx.createGain(); master.gain.value = 0.9; master.connect(comp);
    noiseBuf = actx.createBuffer(1, sr * 2, sr);
    const nd = noiseBuf.getChannelData(0); for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // street-canyon reverb: a synthetic impulse response with a few hard slap-back echoes
    const len = (sr * 1.9) | 0, ir = actx.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch); let lp = 0;
      for (let i = 0; i < len; i++) { const t = i / len; lp += ((Math.random() * 2 - 1) * Math.pow(1 - t, 2.8) - lp) * (0.85 - 0.7 * t); d[i] = lp * 0.9; }
      for (const [ms, g] of [[41, 0.55], [79, 0.38], [127, 0.26], [203, 0.16]]) d[(((ms + ch * 7) / 1000) * sr) | 0] += g;
    }
    const conv = actx.createConvolver(); conv.buffer = ir;
    const wet = actx.createGain(); wet.gain.value = 0.34; conv.connect(wet).connect(master);
    const loop = (rate) => { const s = actx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; s.playbackRate.value = rate; s.start(0, Math.random() * 1.5); return s; };
    const bed = (rate, type, f, q) => { const fl = actx.createBiquadFilter(); fl.type = type; fl.frequency.value = f; fl.Q.value = q; const g = actx.createGain(); g.gain.value = 0; loop(rate).connect(fl).connect(g).connect(master); return { f: fl.frequency, g: g.gain }; };
    AU = {
      rev: conv, pan: !!actx.createStereoPanner, cars: [],
      windLo: bed(0.5, 'lowpass', 160, 0.5), windMid: bed(1, 'bandpass', 700, 0.6), windHi: bed(1.3, 'bandpass', 2600, 4),   // rumble, rush, whistle
      city: bed(0.45, 'lowpass', 150, 0.4), hum: bed(0.8, 'bandpass', 420, 0.5),                                          // distant traffic bed
      crowdA: bed(0.9, 'bandpass', 520, 1.1), crowdB: bed(1.15, 'bandpass', 1150, 1.6),                                    // crowd murmur
      rope: bed(0.7, 'bandpass', 260, 9),                                                                                  // web line under tension
    };
    for (let i = 0; i < 4; i++) { // four car voices: engine + tyre noise, panned and doppler-shifted
      const o1 = actx.createOscillator(); o1.type = 'sawtooth'; const o2 = actx.createOscillator(); o2.type = 'square';
      const o2g = actx.createGain(); o2g.gain.value = 0.45;
      const lp = actx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 300; lp.Q.value = 0.9;
      const tf = actx.createBiquadFilter(); tf.type = 'bandpass'; tf.frequency.value = 950; tf.Q.value = 0.6; const tg = actx.createGain(); tg.gain.value = 0.3;
      const g = actx.createGain(); g.gain.value = 0;
      o1.connect(lp); o2.connect(o2g).connect(lp); lp.connect(g); loop(1).connect(tf).connect(tg).connect(g);
      let pan = null; if (AU.pan) { pan = actx.createStereoPanner(); g.connect(pan).connect(master); } else g.connect(master);
      o1.start(); o2.start();
      AU.cars.push({ f1: o1.frequency, f2: o2.frequency, lp: lp.frequency, tg: tg.gain, g: g.gain, pan: pan ? pan.pan : null, id: -1 });
    }
  } catch (e) { reportOnce(e); actx = null; AU = null; }
}
function toggleMute() { muted = !muted; if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, actx.currentTime, 0.03); flash(muted ? 'SOUND OFF' : 'SOUND ON'); }
function route(node, pan, send) {
  let n = node;
  if (pan && AU.pan) { const p = actx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); n.connect(p); n = p; }
  n.connect(master);
  if (send > 0) { const s = actx.createGain(); s.gain.value = send; n.connect(s); s.connect(AU.rev); }
}
function shape(g, t, attack, peak, dur) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + attack); g.gain.setTargetAtTime(0, t + attack, dur / 3.5); }
function nz(type, f0, f1, dur, vol, o = {}) { // filtered noise burst
  if (!actx || !AU || muted || vol <= 0.002) return;
  const t = actx.currentTime + (o.delay || 0), a = o.attack || 0.004, s = actx.createBufferSource(); s.buffer = noiseBuf;
  const f = actx.createBiquadFilter(); f.type = type; f.Q.value = o.q || 1; f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + dur);
  const g = actx.createGain(); shape(g, t, a, vol, dur);
  s.connect(f).connect(g); route(g, o.pan || 0, o.send == null ? 0.2 : o.send);
  s.start(t, Math.random() * 1.5); s.stop(t + a + dur * 1.7 + 0.05);
}
function tone(type, f0, f1, dur, vol, o = {}) { // pitched sweep
  if (!actx || !AU || muted || vol <= 0.002) return;
  const t = actx.currentTime + (o.delay || 0), a = o.attack || 0.004, s = actx.createOscillator(); s.type = type;
  s.frequency.setValueAtTime(f0, t); s.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + a + dur);
  const g = actx.createGain(); shape(g, t, a, vol, dur);
  s.connect(g); route(g, o.pan || 0, o.send == null ? 0.2 : o.send);
  s.start(t); s.stop(t + a + dur * 1.7 + 0.05);
}
function thwip(m = 1) {
  const p = 0.92 + Math.random() * 0.16;
  nz('highpass', 3600 * p, 2600 * p, 0.03, 0.5, { q: 0.7, attack: 0.001, send: 0.12 });                 // the spit of the shooter
  tone('sine', 3100 * p, 620 * p, 0.085 * m, 0.15, { attack: 0.002, send: 0.25 });                       // "zwip" sweep
  nz('bandpass', 5200 * p, 1700 * p, 0.2 * m, 0.3, { q: 2.2, delay: 0.01, send: 0.3 });                  // line hissing out
  nz('bandpass', 950, 480, 0.06, 0.2, { q: 3, attack: 0.002, delay: 0.11 * m, send: 0.6 });              // splat on the wall, a beat later
}
function whoosh(m = 1) { nz('bandpass', 350, 1500, 0.22 * m, 0.7 * m, { q: 0.7, attack: 0.07, send: 0.15 }); nz('bandpass', 1500, 380, 0.3 * m, 0.5 * m, { q: 0.7, delay: 0.2 * m, send: 0.15 }); }
function thud(m = 1) {
  tone('sine', 125, 40, 0.24, 0.85 * m, { attack: 0.003, send: 0.25 });                                   // body of the impact
  nz('lowpass', 900, 200, 0.09, 0.5 * m, { q: 0.7, attack: 0.002, send: 0.3 });                          // slap of feet and hands
  if (m > 0.8) nz('lowpass', 320, 60, 0.5, 0.35, { q: 0.7, attack: 0.01, delay: 0.03, send: 0.45 });     // rumble on a heavy landing
}
function footstep(vol, left) {
  const p = 0.9 + Math.random() * 0.2, pan = left ? -0.15 : 0.15;
  nz('lowpass', 420 * p, 140, 0.07, vol * 4, { q: 0.8, attack: 0.002, pan, send: 0.12 });
  tone('sine', 150 * p, 70, 0.05, vol * 1.2, { attack: 0.002, pan, send: 0.1 });
  nz('highpass', 2200 * p, 1800, 0.02, vol * 0.8, { q: 0.7, attack: 0.001, delay: 0.012, pan, send: 0.1 });
}
function horn(vol, pan, lpf) { // two-note car horn, muffled and echoing with distance
  if (!actx || !AU || muted || vol < 0.004) return;
  const t = actx.currentTime, pair = Math.random() < 0.6 ? [349, 440] : [392, 494], taps = Math.random() < 0.3 ? 2 : 1;
  const g = actx.createGain(); g.gain.value = 0;
  const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lpf; f.Q.value = 0.7;
  const os = pair.map((hz) => { const o = actx.createOscillator(); o.type = 'sawtooth'; o.frequency.value = hz * (0.985 + Math.random() * 0.03); o.connect(f); return o; });
  f.connect(g); route(g, pan, 0.45);
  let tt = t;
  for (let k = 0; k < taps; k++) { const d = taps === 2 ? 0.16 + Math.random() * 0.12 : 0.35 + Math.random() * 0.7; g.gain.setValueAtTime(0.0001, tt); g.gain.linearRampToValueAtTime(vol, tt + 0.025); g.gain.setValueAtTime(vol, tt + d); g.gain.linearRampToValueAtTime(0.0001, tt + d + 0.06); tt += d + 0.16; }
  for (const o of os) { o.start(t); o.stop(tt + 0.1); }
}
function siren(vol, pan) { // a far-off emergency wail drifting across the city
  if (!actx || !AU || muted) return;
  const t = actx.currentTime, dur = 9 + Math.random() * 5, o = actx.createOscillator(); o.type = 'sawtooth';
  o.frequency.setValueAtTime(640, t);
  for (let tt = t; tt < t + dur; tt += 3.6) { o.frequency.linearRampToValueAtTime(1320, tt + 1.9); o.frequency.linearRampToValueAtTime(640, tt + 3.6); }
  const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 1300;
  const g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + 2.5); g.gain.setValueAtTime(vol, t + dur - 3); g.gain.linearRampToValueAtTime(0.0001, t + dur);
  o.connect(f).connect(g); route(g, pan, 0.7); o.start(t); o.stop(t + dur + 0.1);
}
function heli(vol) { // a helicopter crossing somewhere overhead
  if (!actx || !AU || muted) return;
  const t = actx.currentTime, dur = 13, s = actx.createBufferSource(); s.buffer = noiseBuf; s.loop = true;
  const f = actx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 190;
  const chop = actx.createGain(); chop.gain.value = 0.5;
  const lfo = actx.createOscillator(); lfo.frequency.value = 12.5; const lg = actx.createGain(); lg.gain.value = 0.5; lfo.connect(lg).connect(chop.gain);
  const g = actx.createGain(); g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(vol, t + dur * 0.45); g.gain.linearRampToValueAtTime(0.0001, t + dur);
  s.connect(f).connect(chop).connect(g); route(g, Math.random() * 1.6 - 0.8, 0.3);
  s.start(t); lfo.start(t); s.stop(t + dur + 0.1); lfo.stop(t + dur + 0.1);
}
const _ci = { x: 0, z: 0, vx: 0, vz: 0, id: -1, type: 0 }, _used = [false, false, false, false];
let ambT = 2, subT = 20, heliT = 45, lastPhase = -1, zoneNow = '';
function updateAudio(dt) {
  if (!actx || !AU) return;
  const now = actx.currentTime, v = P.vel, sp = v.length(), alt = Math.max(0, P.pos.y - HY), px = P.pos.x, pz = P.pos.z;
  const set = (p, val, tc = 0.12) => p.setTargetAtTime(val, now, tc);
  const nI = life.info.nearIdx, nD = life.info.nearD, night = TOD[todIdx].night > 0.5;
  const traffic = clamp(1 - Math.sqrt(nD[0]) / 280, 0.22, 1);
  // wind: low rumble + mid rush + a whistle that only appears at real speed
  const x = clamp(sp / 80, 0, 1), gust = 0.85 + 0.12 * Math.sin(time * 0.7) + 0.07 * Math.sin(time * 2.3 + 1);
  set(AU.windLo.g, (Math.pow(x, 1.5) * 0.85 + clamp(alt / 500, 0, 1) * 0.1) * gust); set(AU.windLo.f, 120 + sp * 4);
  set(AU.windMid.g, x * x * 0.5 * gust); set(AU.windMid.f, 420 + sp * 14);
  set(AU.windHi.g, Math.pow(clamp((sp - 26) / 50, 0, 1), 2) * 0.1 * gust); set(AU.windHi.f, 1700 + sp * 24 + 200 * Math.sin(time * 1.3));
  // the city itself: loud and full at street level, a faint wash from the rooftops
  const street = clamp(1 - alt / 170, 0, 1), near = clamp(1 - alt / 30, 0, 1);
  set(AU.city.g, (0.14 + 0.5 * street) * traffic, 0.4); set(AU.city.f, 110 + 130 * street, 0.4); set(AU.hum.g, (0.03 + 0.09 * street) * traffic, 0.4);
  // crowd murmur from the people actually near you
  const cr = clamp(life.info.crowd / 16, 0, 1) * clamp(1 - alt / 45, 0, 1), wob = 0.7 + 0.3 * Math.sin(time * 3.1) * Math.sin(time * 1.7 + 2);
  set(AU.crowdA.g, 0.13 * cr * wob, 0.25); set(AU.crowdB.g, 0.05 * cr * (1.4 - wob), 0.25); set(AU.crowdA.f, 480 + 90 * Math.sin(time * 0.9), 0.3);
  // the web line creaks as it loads up through the bottom of a swing
  const tens = P.state === 'swing' ? clamp((sp * sp) / (Math.max(P.ropeLen, 8) * 55), 0, 1) : P.state === 'zip' ? 0.8 : 0;
  set(AU.rope.g, 0.12 * tens, 0.08); set(AU.rope.f, 190 + 170 * tens);
  // traffic voices (distance falloff, air absorption, stereo position, doppler)
  camRightH(tv); _used.fill(false);
  for (const vc of AU.cars) { const i = vc.id >= 0 ? nI.indexOf(vc.id) : -1; if (i >= 0) _used[i] = true; else vc.id = -1; }
  for (const vc of AU.cars) if (vc.id < 0) { const i = _used.indexOf(false); if (i >= 0 && nI[i] >= 0) { vc.id = nI[i]; _used[i] = true; } }
  for (const vc of AU.cars) {
    if (vc.id < 0 || !life.carAt(vc.id, time, _ci)) { set(vc.g, 0, 0.1); continue; }
    const c = _ci, cv = Math.hypot(c.vx, c.vz), dx = c.x - px, dz = c.z - pz, dh = Math.hypot(dx, dz) || 1, d = Math.hypot(dh, alt);
    const vr = ((c.vx - v.x) * dx + (c.vz - v.z) * dz) / dh;                       // closing speed: + means moving apart
    const dop = clamp(1 - (vr / 343) * 1.6, 0.72, 1.35);
    const f0 = (c.type >= 4 ? 26 : 34) * (1 + ((vc.id * 0.618) % 1) * 0.25) * (1 + cv * 0.075) * dop;   // idle note rising with road speed; trucks and buses sit lower
    set(vc.f1, f0, 0.08); set(vc.f2, f0 * 0.5, 0.08);
    set(vc.lp, 170 + 2600 / (1 + d / 11), 0.1); set(vc.tg, 0.08 + 0.65 * clamp(cv / 18, 0, 1));
    set(vc.g, (cv < 0.5 ? 0.24 : 0.5) / (1 + (d / 10) * (d / 10)), 0.12);
    if (vc.pan) set(vc.pan, clamp(((dx * tv.x + dz * tv.z) / dh) * clamp(dh / 6, 0, 1), -1, 1), 0.08);
  }
  // the signals change: brakes sigh as a queue forms, engines swell as it pulls away
  const tc = time % CYC, phase = tc < AVE_GO ? 0 : tc < ST_T0 ? 1 : tc < ST_T0 + ST_GO ? 2 : 3;
  if (phase !== lastPhase) {
    if (lastPhase >= 0 && near > 0.05) {
      if (phase & 1) { nz('highpass', 4200, 2400, 0.5, 0.05 * near * traffic, { attack: 0.06, send: 0.4, pan: Math.random() - 0.5 }); tone('sine', 1900, 1500, 0.35, 0.012 * near * traffic, { attack: 0.05, send: 0.5 }); }
      else nz('lowpass', 170, 420, 1.1, 0.16 * near * traffic, { attack: 0.35, send: 0.3 });
    }
    lastPhase = phase;
  }
  // horns from real cars nearby (more when everyone is stuck at a light); a distant siren now and then
  hornT -= dt;
  if (hornT <= 0) {
    hornT = (phase & 1 ? 1.6 : 2.6) + Math.random() * 5;
    const k = nI[(Math.random() * 4) | 0];
    if (k >= 0 && life.carAt(k, time, _ci)) { const dx = _ci.x - px, dz = _ci.z - pz, dh = Math.hypot(dx, dz) || 1, bd = Math.hypot(dh, alt); if (bd < 420) horn(0.15 / (1 + Math.pow(bd / 60, 1.5)), (dx * tv.x + dz * tv.z) / dh, 500 + 5200 / (1 + bd / 45)); }
  }
  sirenT -= dt; if (sirenT <= 0) { sirenT = 40 + Math.random() * 50; siren(0.05 + Math.random() * 0.04, Math.random() * 1.6 - 0.8); }
  // small sounds that belong to where you are
  ambT -= dt;
  if (ambT <= 0) {
    const park = zoneNow === 'CENTRAL PARK' || zoneNow === 'BATTERY PARK', pan = Math.random() * 1.6 - 0.8;
    if (park && alt < 70) {
      ambT = night ? 0.5 + Math.random() * 0.8 : 0.35 + Math.random() * 1.6;
      const q = clamp(1 - alt / 70, 0, 1);
      if (night) for (let k = 0; k < 3; k++) tone('sine', 4300, 4250, 0.028, 0.012 * q, { delay: k * 0.075, pan, send: 0.2 });              // crickets
      else { const f = 2300 + Math.random() * 2400, n = 1 + ((Math.random() * 4) | 0); for (let k = 0; k < n; k++) tone('sine', f * (1 + k * 0.06), f * (1.25 + Math.random() * 0.3), 0.05, 0.03 * q, { delay: k * 0.11, pan, send: 0.35 }); }   // birdsong
    } else if (!night && near > 0.2 && (zoneNow === 'MIDTOWN' || zoneNow === 'FINANCIAL DISTRICT') && Math.random() < 0.25) {
      ambT = 6 + Math.random() * 14;
      for (let k = 0; k < 14; k++) nz('bandpass', 950, 700, 0.03, 0.035 * near, { delay: k * 0.068, q: 2.5, send: 0.6, pan });                // a jackhammer down the block
    } else ambT = 2 + Math.random() * 4;
  }
  subT -= dt; if (subT <= 0) { subT = 35 + Math.random() * 45; if (alt < 14) nz('lowpass', 70, 48, 5, 0.3, { attack: 2.2, q: 0.8, send: 0.15 }); }   // a train passing under the street
  heliT -= dt; if (heliT <= 0) { heliT = 70 + Math.random() * 90; if (!night || Math.random() < 0.4) heli(0.05 + 0.05 * clamp(alt / 200, 0, 1)); }
  // footsteps, in time with the run cycle, alternating feet
  const moving = (P.state === 'ground' && Math.hypot(v.x, v.z) > 3) || (P.state === 'wall' && sp > 3);
  if (moving) { const n = Math.floor(P.runPh / Math.PI); if (n !== stepN) { stepN = n; footstep(P.state === 'wall' ? 0.14 : clamp(sp / 26, 0.2, 0.7) * 0.5, n & 1); } }
}

// ---------------------------------------------------------------- HUD
const $ = (id) => document.getElementById(id);
const hud = { style: $('style'), combo: $('combo'), speed: $('speed'), alt: $('alt'), state: $('state'), reticle: $('reticle'), trick: $('trick'), flash: $('flash'), zone: $('zone'), street: $('street'), fps: $('fps'), gauge: $('gauge') };
const lines = $('lines'), lctx = lines.getContext('2d');
function popTrick(t) { hud.trick.textContent = t; hud.trick.classList.remove('pop'); void hud.trick.offsetWidth; hud.trick.classList.add('pop'); }
function flash(t) { if (!hud.flash) return; hud.flash.textContent = t; hud.flash.classList.remove('pop'); void hud.flash.offsetWidth; hud.flash.classList.add('pop'); }
// minimap: the whole city is painted once; each update draws a rotated window of it around the player
const MSC = 0.4, mapCv = document.createElement('canvas');
mapCv.width = Math.ceil((world.MAP.x1 - world.MAP.x0) * MSC); mapCv.height = Math.ceil((world.MAP.z1 - world.MAP.z0) * MSC);
world.drawMap(mapCv.getContext('2d'), MSC);
const mini = $('map'), mctx = mini.getContext('2d'), MPX = mini.width;
function drawMini() {
  const c = MPX / 2, range = 220 + clamp((P.pos.y - 40) * 0.6, 0, 280), k = c / range, u = MPX / 180;
  mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.clearRect(0, 0, MPX, MPX);
  mctx.save(); mctx.beginPath(); mctx.arc(c, c, c - 1, 0, TAU); mctx.clip();
  mctx.fillStyle = '#12303f'; mctx.fillRect(0, 0, MPX, MPX);
  mctx.translate(c, c); mctx.rotate(C.yaw); mctx.scale(k / MSC, k / MSC);   // camera-forward is up
  mctx.drawImage(mapCv, -(world.MAP.x1 - P.pos.x) * MSC, -(world.MAP.z1 - P.pos.z) * MSC);
  mctx.restore();
  // view cone, then the hero's arrow
  mctx.save(); mctx.translate(c, c);
  const g = mctx.createRadialGradient(0, 0, 0, 0, 0, c * 0.8); g.addColorStop(0, 'rgba(46,242,255,0.28)'); g.addColorStop(1, 'rgba(46,242,255,0)');
  mctx.fillStyle = g; mctx.beginPath(); mctx.moveTo(0, 0); mctx.arc(0, 0, c * 0.8, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); mctx.closePath(); mctx.fill();
  mctx.rotate(-angDiff(Math.atan2(P.facing.x, P.facing.z), C.yaw));
  mctx.beginPath(); mctx.moveTo(0, -9 * u); mctx.lineTo(6.5 * u, 7 * u); mctx.lineTo(0, 3.5 * u); mctx.lineTo(-6.5 * u, 7 * u); mctx.closePath();
  mctx.fillStyle = '#fff'; mctx.strokeStyle = '#0b1220'; mctx.lineWidth = 2 * u; mctx.stroke(); mctx.fill();
  mctx.restore();
  // north marker rides the rim
  const nx = c + Math.sin(C.yaw) * (c - 11 * u), ny = c - Math.cos(C.yaw) * (c - 11 * u);
  mctx.fillStyle = '#ffb14a'; mctx.font = `700 ${12 * u}px "Barlow Condensed", sans-serif`; mctx.textAlign = 'center'; mctx.textBaseline = 'middle'; mctx.fillText('N', nx, ny);
}
let hudT = 0, mapT = 0, linesDirty = true, lastZone = '', fpsE = 60;
const STATE_NAMES = { ground: 'ON FOOT', air: 'AIRBORNE', swing: 'SWINGING', zip: 'SLINGSHOT', wall: 'WALL CRAWL' };
function updateHUD(dt, rawDt) {
  hudT -= dt; mapT -= dt;
  if (rawDt > 0) fpsE += (Math.min(240, 1 / rawDt) - fpsE) * 0.06;
  if (hudT <= 0) {
    hudT = 0.1;
    const kmh = P.vel.length() * 3.6;
    hud.speed.textContent = Math.round(kmh);
    hud.gauge.style.strokeDashoffset = (245 * (1 - clamp(kmh / 320, 0, 1))).toFixed(1);
    hud.alt.textContent = Math.max(0, Math.round(P.pos.y - HY));
    hud.style.textContent = P.style.toLocaleString();
    hud.combo.textContent = P.combo > 1 ? `x${P.combo}` : '';
    hud.state.textContent = P.perch > 0.6 ? 'PERCHED' : STATE_NAMES[P.state] || '';
    hud.fps.textContent = Math.round(fpsE);
    const zn = world.zoneAt(P.pos.x, P.pos.z);
    if (zn !== lastZone) { if (zn && lastZone && started) flash(zn); lastZone = zn; zoneNow = zn; hud.zone.textContent = zn || 'THE RIVER'; }
    hud.street.textContent = world.streetAt(P.pos.x, P.pos.z);
  }
  if (mapT <= 0) { mapT = 0.045; drawMini(); }
  hud.reticle.className = zipInfo ? (zipInfo.launch ? 'launch' : 'wall') : '';
  // speed lines
  const W = lines.width, H = lines.height; if (linesDirty) { lctx.clearRect(0, 0, W, H); linesDirty = false; }
  const sp = P.vel.length(), a = clamp((sp - 32) / 40, 0, 1);
  if (a > 0) {
    linesDirty = true;
    lctx.strokeStyle = `rgba(255,255,255,${0.2 * a})`; lctx.lineWidth = 1.5;
    const cx = W / 2, cy = H / 2, R0 = Math.hypot(cx, cy);
    for (let i = 0; i < 40 * a; i++) {
      const ang = Math.random() * TAU, r1 = R0 * (0.55 + Math.random() * 0.25), r2 = r1 + R0 * (0.15 + Math.random() * 0.3);
      lctx.beginPath(); lctx.moveTo(cx + Math.cos(ang) * r1, cy + Math.sin(ang) * r1); lctx.lineTo(cx + Math.cos(ang) * r2, cy + Math.sin(ang) * r2); lctx.stroke();
    }
  }
}
function resize() {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); if (composer) composer.setSize(innerWidth, innerHeight);
  lines.width = innerWidth; lines.height = innerHeight;
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- loop
let last = performance.now(), acc = 0, time = 0, zipTick = 0, frameNo = 0;
let hitches = 0, skipHitch = false, reported = false;
let dbgCam = null, dbgFreeze = false;
function reportOnce(e) { if (!reported) { reported = true; console.error('[skythread] subsystem error (rendering continues):', e); } }
applyQuality(qIdx, 1);
applyTOD(0);
chooseSpawn(); respawn(false);
document.addEventListener('visibilitychange', () => { skipHitch = true; });
function frame(now) {
  requestAnimationFrame(frame);
$('cta').textContent = 'CLICK TO START';
  if (dbgFreeze) { last = now; return; }
  const rawDt = (now - last) / 1000;
  const dt = Math.min(0.05, rawDt); last = now; frameNo++;
  if (skipHitch) skipHitch = false; // returning from another tab is not a hitch
  else if (started && rawDt > 1.0 && qIdx < QUALITY.length - 1 && FORCE_Q < 0) {
    if (++hitches >= 2) { hitches = -999; perf.done = true; perf.climb = false; perf.ceil = LADDER.length - 1; setLevel(LADDER.length - 1); }
  }
  const paused = !started || (everLocked && !locked);
  if (!paused) {
    time += dt; acc += dt;
    const h = 1 / 120; let n = 0;
    while (acc >= h && n < 10) { step(h); acc -= h; n++; }
    if (n >= 10) acc = 0;
    P.rpos.copy(P.prev).lerp(P.pos, clamp(acc / h, 0, 1));
    if (ev.trick) { startTrick(ev.trick); ev.trick = null; }
  } else { ev.trick = null; if (!started) { time += dt; C.yawT += dt * 0.04; } }
  if (!paused || !started) world.update(dt, time);
  updateAnim(paused ? 0 : dt, time);
  updateCamera(dt, now, time);
  try { life.update(dt, time, camera.position.x, camera.position.y, camera.position.z, C.yaw); } catch (e) { reportOnce(e); }
  if ((zipTick = (zipTick + 1) % 3) === 0) computeZip();
  updateRope(paused ? 0 : dt);
  try { updateHUD(dt, rawDt); } catch (e) { reportOnce(e); }
  try { updateAudio(paused ? 0 : dt); } catch (e) { reportOnce(e); }
  autoQuality(dt);
  const q = QUALITY[qIdx];
  if (dbgCam) { if (dbgCam.f) { camera.position.copy(P.rpos).add(dbgCam.p); camera.lookAt(P.rpos.x, P.rpos.y + dbgCam.t.y, P.rpos.z); } else { camera.position.copy(dbgCam.p); camera.lookAt(dbgCam.t); } }
  if (q.sh > 0 && frameNo % q.shEvery === 0) placeSun();
  if (dof) { dof.uniforms.uMax.value = (2.2 + P.perch * 1.6) * q.pr * qDyn; dof.uniforms.uFocus.value = 130 + P.perch * 30; }
  sky.position.copy(camera.position);
  if (composer) composer.render(); else renderer.render(scene, camera);
}
requestAnimationFrame(frame);

// debug hooks for automated testing
window.__boxes = boxes;
let _an = null;
function audioDbg() {
  if (!actx || !AU) return { state: actx ? actx.state : 'none' };
  if (!_an) { _an = actx.createAnalyser(); _an.fftSize = 2048; master.connect(_an); }
  const d = new Float32Array(_an.fftSize); _an.getFloatTimeDomainData(d);
  let s2 = 0, pk = 0; for (let i = 0; i < d.length; i++) { s2 += d[i] * d[i]; pk = Math.max(pk, Math.abs(d[i])); }
  return { state: actx.state, rms: +Math.sqrt(s2 / d.length).toFixed(4), peak: +pk.toFixed(3), carVoices: AU.cars.map((v) => v.id), crowd: life.info.crowd };
}
function audioPeak(ms) { return new Promise((res) => { audioDbg(); let pk = 0, s2 = 0, n = 0; const d = new Float32Array(_an.fftSize); const t0 = performance.now(); const iv = setInterval(() => { _an.getFloatTimeDomainData(d); for (let i = 0; i < d.length; i++) { pk = Math.max(pk, Math.abs(d[i])); s2 += d[i] * d[i]; n++; } if (performance.now() - t0 > ms) { clearInterval(iv); res({ peak: +pk.toFixed(3), rms: +Math.sqrt(s2 / n).toFixed(4) }); } }, 20); }); }
window.__G = { P, C, keys, ev, applyTOD, world, life, hero, R, perf, resetCam, audioDbg, audioPeak, freeze: (v) => { dbgFreeze = v; }, sfx: { thwip, whoosh, thud, footstep, horn, siren, heli }, setCam: (px, py, pz, tx, ty, tz) => { dbgCam = px == null ? null : { p: new V3(px, py, pz), t: new V3(tx, ty, tz) }; }, follow: (x, y, z, ty = 0) => { dbgCam = { f: true, p: new V3(x, y, z), t: new V3(0, ty, 0) }; }, setQuality: (i) => { perf.manual = true; applyQuality(i, 1); }, q: () => qIdx, info: () => renderer.info.render, zip: () => zipInfo, step, anim: updateAnim, renderer, scene, setStarted: () => { started = true; document.body.classList.add('playing'); $('start').classList.add('gone'); }, camera, time: () => time, addTime: (t) => { time += t; }, mouse: (dx, dy) => { C.yawT -= dx * 0.0022; C.pitchT = clamp(C.pitchT - dy * 0.0022, -1.35, 0.8); }, report: () => reported };
