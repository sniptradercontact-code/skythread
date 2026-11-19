// ============================================================================
//  SKYTHREAD — a web-swinging sandbox. Original hero, original city.
// ============================================================================
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
// ---------------------------------------------------------------- haze: thinner with height, glowing toward the sun
// The sun's direction and the haze density travel in the fog's two spare numbers (near = azimuth.elevation, far = density.glow),
// so every material in the scene picks them up without being touched.
THREE.ShaderChunk.fog_pars_vertex = '#ifdef USE_FOG\n\tvarying vec3 vFogPos;\n#endif';
THREE.ShaderChunk.fog_vertex = '#ifdef USE_FOG\n\tvFogPos = mvPosition.xyz;\n#endif';
THREE.ShaderChunk.fog_pars_fragment = '#ifdef USE_FOG\n\tuniform vec3 fogColor;\n\tuniform float fogNear;\n\tuniform float fogFar;\n\tvarying vec3 vFogPos;\n#endif';
THREE.ShaderChunk.fog_fragment = `#ifdef USE_FOG
	float hzDist = length( vFogPos );
	vec3 hzDir = ( vFogPos / max( hzDist, 1e-4 ) ) * mat3( viewMatrix );
	float hzAz = floor( fogNear ) * 0.01745329, hzEl = fract( fogNear ) * 1.5707963;
	vec3 hzSun = vec3( cos( hzEl ) * sin( hzAz ), sin( hzEl ), cos( hzEl ) * cos( hzAz ) );
	float hzDen = floor( fogFar ) * 1e-6, hzGlow = fract( fogFar ) * 2.0;
	float hzY = cameraPosition.y * 0.002, hzDy = hzDir.y * hzDist * 0.002;
	float hzK = abs( hzDy ) > 0.01 ? ( exp( - hzY ) - exp( - hzY - hzDy ) ) / hzDy : exp( - hzY );
	float hzX = hzDen * hzDist * clamp( hzK * 1.16, 0.0, 1.5 );
	float fogFactor = 1.0 - exp( - hzX * hzX );
	float hzS = max( dot( hzDir, hzSun ), 0.0 ), hzS2 = hzS * hzS;
	vec3 hzCol = fogColor * mix( vec3( 0.84, 0.92, 1.07 ), vec3( 1.0 ), hzS ) + fogColor * vec3( 1.0, 0.7, 0.4 ) * ( hzGlow * ( 0.3 * hzS2 + 0.85 * hzS2 * hzS2 * hzS2 * hzS2 ) );
	gl_FragColor.rgb = mix( gl_FragColor.rgb, hzCol, fogFactor );
#endif`;
import { buildWorld, boxes, query, addBox, makeWebTex, rnd, CYC, AVE_GO, ST_T0, ST_GO, cellX, cellZ, HALFX, HALFZ, BX, BZ, EDGE, CROWN as CROWN_CELL, DOWNTOWN as DOWNTOWN_CELL } from './world.js';
import { buildLife, makeFigure } from './life.js';
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
  { name: 'ULTRA', pr: DPR, msaa: 4, bloom: true, dof: true, sh: 4096, shR: 210, shEvery: 1, near: 190, far: 1100, peds: 2500, pedR: 270, pedHi: 420, detail: true, trees: 1 },
  { name: 'HIGH', pr: Math.min(DPR, 1.25), msaa: 4, bloom: true, dof: true, sh: 3072, shR: 170, shEvery: 2, near: 160, far: 900, peds: 1900, pedR: 250, pedHi: 380, detail: true, trees: 1 },
  { name: 'MEDIUM', pr: 1, msaa: 0, bloom: true, dof: false, sh: 2048, shR: 150, shEvery: 2, near: 140, far: 700, peds: 1350, pedR: 220, pedHi: 260, detail: true, trees: 1 },
  { name: 'LOW', pr: 0.8, msaa: 0, direct: true, sh: 1024, shEvery: 3, near: 110, far: 500, peds: 850, pedR: 180, pedHi: 110, detail: false, trees: 0.7 },
  { name: 'BASIC', pr: 0.6, msaa: 0, direct: true, sh: 0, shEvery: 1, near: 90, far: 380, peds: 480, pedR: 140, pedHi: 0, detail: false, trees: 0.4 },
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

const _t0 = performance.now();
const world = buildWorld(scene, renderer);
const _t1 = performance.now();
const life = buildLife(scene, world);
window.__initT = { world: Math.round(_t1 - _t0), life: Math.round(performance.now() - _t1) };
// street surfaces pick up a sodium-lamp glow at night
for (const m of world.streetMats) { m.emissiveMap = m.map; m.emissive.set(0xffb469); m.emissiveIntensity = 0; }

// ---------------------------------------------------------------- sky + lights
const sky = new Sky(); sky.scale.setScalar(9000); scene.add(sky);
// cap the sky's brightness so the sun cannot flood the bloom pass
const capSky = (m) => { m.fragmentShader = m.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( min( texColor, vec3( 1.9 ) ), 1.0 );'); m.needsUpdate = true; };
capSky(sky.material);
const envScene = new THREE.Scene(); const envSky = new Sky(); envSky.scale.setScalar(50); envScene.add(envSky); envSky.material.fragmentShader = envSky.material.fragmentShader.replace('gl_FragColor = vec4( texColor, 1.0 );', 'gl_FragColor = vec4( min( texColor, vec3( 1.9 ) ), 1.0 );');
const pmrem = new THREE.PMREMGenerator(renderer);
let envRT = null, envDirty = 0;
const sun = new THREE.DirectionalLight(0xffffff, 3);
sun.castShadow = true; sun.shadow.mapSize.set(1536, 1536); sun.shadow.autoUpdate = false;
let SHR = 120;
Object.assign(sun.shadow.camera, { left: -SHR, right: SHR, top: SHR, bottom: -SHR, near: 10, far: 1100 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.08;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xbfd3ff, 0x6b5640, 0.5); scene.add(hemi);
const lightDir = new V3();

const TOD = [
  { name: 'Golden Hour', int: 0.27, elev: 13, azim: 62, turb: 4.6, ray: 2.9, mie: 0.006, sunColor: 0xffb878, sunI: 2.9, sky: 0xa9bfe8, gnd: 0x8c6b52, hemiI: 0.58, fog: 0xd9a983, fogD: 0.00022, exp: 0.43, win: 0.32, lit: 0.12, shop: 0.55, env: 0.7, clouds: 0.5, cloudD: 0.55, glow: 1.25, tintS: [0.93, 0.99, 1.08], tintH: [1.05, 1.0, 0.93], bloom: 0.09, bloomT: 2.7, light: 0.45, neon: 0.62, night: 0, cloudCol: 0xffc9a0, cloudE: 0.3, bb: 1.5 },
  { name: 'Midday', int: 0.5, elev: 56, azim: 150, turb: 2.5, ray: 1.0, mie: 0.003, sunColor: 0xfff3e2, sunI: 2.5, sky: 0xcfe2ff, gnd: 0x6e6a60, hemiI: 0.66, fog: 0xa9bcd0, fogD: 0.00016, exp: 0.42, win: 0.04, lit: 0.1, shop: 0.25, env: 0.55, clouds: 0.5, cloudD: 0.6, glow: 0.5, tintS: [0.96, 1.0, 1.05], tintH: [1.02, 1.0, 0.97], bloom: 0.05, bloomT: 3.2, light: 0, neon: 0.5, night: 0, cloudCol: 0xffffff, cloudE: 0.5, bb: 1.1 },
  { name: 'Night', int: 0.03, elev: -4, azim: 250, turb: 2, ray: 0.6, mie: 0.003, sunColor: 0x9fb4ff, sunI: 0.75, lightElev: 48, lightAzim: 300, sky: 0x4a5f9c, gnd: 0x3a2c1c, hemiI: 0.62, fog: 0x0d1630, fogD: 0.00026, exp: 0.82, win: 0.95, lit: 0.27, shop: 2.1, env: 1.0, clouds: 0.2, cloudD: 0.35, glow: 0, tintS: [0.9, 0.97, 1.1], tintH: [1.04, 1.0, 0.95], bloom: 0.17, bloomT: 1.3, light: 1, neon: 1.0, night: 1, cloudCol: 0x39415a, cloudE: 0.08, bb: 1.6 },
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
// pack the haze parameters into the fog (see the shader chunk at the top)
function setHaze(k) { const t = TOD[todIdx]; scene.fog.near = Math.round(t.azim) + clamp(t.elev / 90, 0, 0.999); scene.fog.far = Math.max(1, Math.round(t.fogD * 1e6 * k)) + clamp(t.glow * 0.5, 0, 0.99); }
function applyTOD(i) {
  const t = TOD[i]; todIdx = i;
  const sunDir = new V3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - t.elev), THREE.MathUtils.degToRad(t.azim));
  for (const s of [sky, envSky]) {
    const u = s.material.uniforms;
    u.turbidity.value = t.turb; u.rayleigh.value = t.ray; u.mieCoefficient.value = t.mie; u.mieDirectionalG.value = 0.86;
    u.sunPosition.value.copy(sunDir);
    if (u.cloudCoverage) { u.cloudCoverage.value = t.clouds; u.cloudDensity.value = t.cloudD; u.cloudScale.value = 0.00026; u.cloudElevation.value = 0.42; }
  }
  if (t.lightElev != null) lightDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - t.lightElev), THREE.MathUtils.degToRad(t.lightAzim));
  else lightDir.copy(sunDir);
  sun.color.set(t.sunColor); sun.intensity = t.sunI;
  hemi.color.set(t.sky); hemi.groundColor.set(t.gnd); hemi.intensity = t.hemiI;
  scene.fog = new THREE.Fog(t.fog, 0, 1); setHaze(1);
  renderer.toneMappingExposure = t.exp;
  const night = t.night > 0.5;
  world.setWindows(t.win, t.lit, t.shop, t.int);
  world.setStreetLight(t.light, t.neon);
  for (const m of world.streetMats) m.emissiveIntensity = night ? 0.55 : 0;
  world.lampMat.emissiveIntensity = night ? 3.0 : t.light > 0.1 ? 2.0 : 0.3;
  world.glowMat.color.setScalar(night ? 1.6 : 1.2);
  world.nightMat.color.setScalar(night ? 0.62 : 0.4);
  world.setNight(night || t.light > 0.1);
  world.setFarVis(1.9 / (t.fogD * 1.16));   // past this the haze has swallowed everything, so nothing is drawn
  world.waterMat.color.set(night ? 0x0b1a2e : t.light > 0.1 ? 0x3a6078 : 0x2c6787);
  for (const m of world.bbMats) m.emissiveIntensity = t.bb;
  life.setNight(t.night);
  scene.environmentIntensity = t.env;
  if (envRT) envRT.dispose();
  sky.visible = !night; scene.background = night ? nightSky : null;
  envRT = night ? pmrem.fromEquirectangular(nightSky) : pmrem.fromScene(envScene, 0, 0.1, 200);
  scene.environment = envRT.texture;
  envDirty = 5;   // a few frames from now, capture the city itself for reflections
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
// the last pass: tone mapping, a gentle grade (contrast, saturation, cool shadows / warm highlights), streaks at speed, dither
const FinalShader = {
  uniforms: { tDiffuse: { value: null }, toneMappingExposure: { value: 1 }, uBlur: { value: 0 }, uSat: { value: 1.08 }, uCon: { value: 0.1 }, uTintS: { value: new V3(1, 1, 1) }, uTintH: { value: new V3(1, 1, 1) }, uSeed: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
  fragmentShader: `
    #include <tonemapping_pars_fragment>
    uniform sampler2D tDiffuse; uniform float uBlur, uSat, uCon, uSeed; uniform vec3 uTintS, uTintH; varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5; float r2 = dot(d, d);
      vec3 col;
      if (uBlur > 0.0005) { // the edges of the frame smear back toward the centre; the middle, where you are, stays sharp
        float a = uBlur * smoothstep(0.02, 0.26, r2), j = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233)) + uSeed) * 43758.5453);
        col = vec3(0.0);
        for (int i = 0; i < 6; i++) col += texture2D(tDiffuse, vUv - d * a * (float(i) + j) / 6.0).rgb;
        col /= 6.0;
      } else col = texture2D(tDiffuse, vUv).rgb;
      col = ACESFilmicToneMapping(col);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSat);
      col = pow(col, vec3(0.9));                                // open up the shade a little
      col = mix(col, col * col * (3.0 - 2.0 * col), uCon);
      col *= mix(uTintS, uTintH, smoothstep(0.02, 0.6, l));
      col = clamp(col, 0.0, 1.0);
      col = mix(col * 12.92, 1.055 * pow(col, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, col));
      col += (fract(sin(dot(gl_FragCoord.xy + uSeed, vec2(4.898, 7.23))) * 23421.631) - 0.5) / 255.0;
      gl_FragColor = vec4(col, 1.0);
    }`,
};
class FinalPass extends ShaderPass {
  constructor() { super(FinalShader); this.material.toneMapped = false; }
  render(r, w, rb, dt, mask) { this.uniforms.toneMappingExposure.value = r.toneMappingExposure; this.uniforms.uSeed.value = (this.uniforms.uSeed.value + 0.37) % 10; super.render(r, w, rb, dt, mask); }
}
let composer = null, bloom = null, dof = null, finalPass = null, compSig = '';
function buildComposer(q) {
  const sig = q.direct ? 'direct' : `${q.msaa}|${q.dof}|${q.bloom}`;
  if (sig === compSig) return;
  compSig = sig;
  if (composer) { for (const p of composer.passes) if (p.dispose) p.dispose(); composer.renderTarget1.dispose(); composer.renderTarget2.dispose(); composer = null; bloom = null; dof = null; finalPass = null; }
  if (q.direct) return;
  const rt = new THREE.WebGLRenderTarget(8, 8, { type: THREE.HalfFloatType, samples: q.msaa, depthTexture: q.dof ? new THREE.DepthTexture(8, 8) : null });
  composer = new EffectComposer(renderer, rt);
  composer.addPass(new RenderPass(scene, camera));
  if (q.dof) { dof = new DofPass(DofShader); composer.addPass(dof); }
  if (q.bloom) { bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.1, 0.35, 2.5); composer.addPass(bloom); }
  finalPass = new FinalPass(); composer.addPass(finalPass); applyPost();
}
function applyPost() { const t = TOD[todIdx]; if (bloom) { bloom.strength = t.bloom; bloom.threshold = t.bloomT; } if (finalPass) { finalPass.uniforms.uTintS.value.fromArray(t.tintS); finalPass.uniforms.uTintH.value.fromArray(t.tintH); } }
function applyQuality(i, dyn = 1, announce = false) {
  qIdx = clamp(i, 0, QUALITY.length - 1); qDyn = dyn;
  const q = QUALITY[qIdx], pr = q.pr * dyn;
  renderer.setPixelRatio(pr); buildComposer(q);
  if (composer) composer.setPixelRatio(pr);
  world.setDensity(q.trees, qIdx < 3); world.setDetail(q.detail);
  life.setQuality({ near: q.near, far: q.far, peds: q.peds, pedR: q.pedR, pedHi: q.pedHi });
  sun.castShadow = q.sh > 0;
  if (q.sh > 0 && SHR !== (q.shR || 120)) { SHR = q.shR || 120; Object.assign(sun.shadow.camera, { left: -SHR, right: SHR, top: SHR, bottom: -SHR }); sun.shadow.camera.updateProjectionMatrix(); }   // better hardware throws shadows further down the avenue
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
  landT: 0, rollT: 0, skimT: 0, launchT: 0, relT: 0, squash: 0, idleT: 0, perch: 0, lean: 0, fy: 0,
  rpos: new V3(), reachT: 0, reachAt: new V3(), twin: null, twinArmed: false, yank: 0, flipQ: new THREE.Quaternion(), trick: null, combo: 0, style: 0, runPh: 0, aimW: 0, aimW2: 0, baseQ: new THREE.Quaternion(), offset: new V3(), inp: new V3(), best: 0,
};
const tv = new V3(), tv2 = new V3(), tv3 = new V3(), tv4 = new V3(), tq = new THREE.Quaternion(), tq2 = new THREE.Quaternion(), tm = new THREE.Matrix4();
const qbuf = [], qbuf2 = [];

// ---------------------------------------------------------------- input
const keys = {};
const ev = { jump: false, swing: false, zip: false, trick: null , twin: false };
let mouse0 = false, locked = false, everLocked = false, started = false, lastMouse = 0, dragging = false;
// the camera eases toward yawT/pitchT; position never changes where it points
const C = { yaw: 0, pitch: -0.2, yawT: 0, pitchT: -0.2, dist: 4, occl: 4, hold: 0, side: 0.5, fov: 62, target: new V3(), shake: 0, kick: 0, roll: 0, mAvg: 4, mN: 0, cine: 1, fp: 0, bobPh: 0, bobK: 0, areaT: 0, area: 0, areaW: 0 };
// first person: V switches; the choice is remembered
let FP = false; try { FP = localStorage.getItem('skythread-view') === 'fp'; } catch (_) {}
const pitchLo = () => (FP ? -1.5 : -1.35), pitchHi = () => (FP ? 1.5 : 0.8);
function toggleView() {
  if (!started || mapOpen) return;
  FP = !FP; try { localStorage.setItem('skythread-view', FP ? 'fp' : 'tp'); } catch (_) {}
  C.pitchT = clamp(C.pitchT, pitchLo(), pitchHi()); flash(FP ? 'FIRST PERSON' : 'THIRD PERSON');
}
addEventListener('keydown', (e) => {
  keys[e.code] = true;
  if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
  if (e.repeat) return;
  if (dlg.on) { if (e.code === 'KeyE' || e.code === 'Space' || e.code === 'Enter') advanceDlg(); return; }
  if (e.code === 'Space') { ev.jump = true; ev.swing = true; }
  if (e.code === 'KeyF') ev.zip = true;
  if (e.code === 'KeyQ') ev.trick = 'q';
  if (e.code === 'KeyZ') ev.trick = 'z';
  if (e.code === 'KeyE') { if (!interact()) ev.trick = 'e'; }
  if (e.code === 'KeyK') toggleTrim();
  if (e.code === 'KeyV') toggleView();
  if (e.code === 'KeyC' && !e.repeat) { ev.twin = true; ev.swing = true; if (P.state === 'ground') ev.jump = true; }
  if (e.code === 'KeyR') ev.trick = 'r';
  if (e.code === 'KeyT') applyTOD((todIdx + 1) % TOD.length);
  if (e.code === 'KeyX' && started) { if (TR.phase === 'count' || TR.phase === 'run') startTrial(TR.k); else { endTrial(); respawn(false); P.style = 0; P.combo = 0; flash('RESTARTED'); } }
  if (e.code === 'KeyN') toggleMute();
  if (e.code === 'KeyM') { if (mapOpen) closeMap(); else openMap(); }
  if (e.code === 'Escape' && mapOpen) closeMap();
  if (mapOpen && /^Digit[1-4]$/.test(e.code)) selectTrial(+e.code[5] - 1, true);
  if (mapOpen && e.code === 'Enter' && MAPV.sel >= 0) startTrial(MAPV.sel);
  if (e.code === 'KeyG') { perf.manual = true; applyQuality((qIdx + QUALITY.length - 1) % QUALITY.length, 1, true); }
  if (e.code === 'KeyH') document.getElementById('help').classList.toggle('hide');
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
addEventListener('blur', () => { for (const k in keys) keys[k] = false; mouse0 = false; });
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('mousedown', (e) => {
  if (!started) return;
  if (dlg.on) { advanceDlg(); return; }
  if (!locked) tryLock();
  dragging = true;
  if (e.button === 0) { mouse0 = true; ev.swing = true; if (P.state === 'ground') ev.jump = true; }
  if (e.button === 2) ev.zip = true;
});
addEventListener('mouseup', (e) => { if (e.button === 0) mouse0 = false; dragging = false; });
addEventListener('mousemove', (e) => {
  C.mN++;
  if (!(locked || (dragging && !everLocked))) return;
  const dx = e.movementX || 0, dy = e.movementY || 0, mag = Math.abs(dx) + Math.abs(dy);
  // browsers occasionally report one huge bogus pointer-lock delta; a real hand ramps up to speed
  if (mag > 450 || (mag > 150 && mag > C.mAvg * 12 + 100)) { C.mAvg += (Math.min(mag, 120) - C.mAvg) * 0.15; return; }
  C.mAvg += (mag - C.mAvg) * 0.25;
  const s = 0.0022;
  C.yawT -= dx * s; C.pitchT = clamp(C.pitchT - dy * s, pitchLo(), pitchHi());
  lastMouse = performance.now();
});
function tryLock() {
  const plain = () => { try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) {} };
  if (QS.has('plainlock')) return plain();
  try { // raw input first: no OS acceleration, and it avoids the delta spikes that made the view jump
    const r = canvas.requestPointerLock({ unadjustedMovement: true });
    if (r && r.catch) r.catch(plain);
  } catch (_) { plain(); }
}
document.addEventListener('pointerlockchange', () => {
  locked = document.pointerLockElement === canvas;
  if (locked) everLocked = true;
  C.mAvg = 4;
  document.getElementById('pause').classList.toggle('show', started && everLocked && !locked && !mapOpen);
});
document.getElementById('start').addEventListener('click', () => {
  document.getElementById('help').classList.remove('hide');
  setTimeout(() => document.getElementById('help').classList.add('hide'), 30000);
  started = true; document.body.classList.add('playing'); document.getElementById('start').classList.add('gone'); if (!QS.has('noaudio')) initAudio(); if (!QS.has('nolock')) tryLock(); introLeap();
});
document.getElementById('pause').addEventListener('click', () => tryLock());
function camFwdH(out) { return out.set(Math.sin(C.yaw), 0, Math.cos(C.yaw)); }
function camRightH(out) { return out.set(-Math.cos(C.yaw), 0, Math.sin(C.yaw)); }
function moveInput(out) {
  const f = (keys.KeyW ? 1 : 0) - (keys.KeyS ? 1 : 0), r = (keys.KeyD ? 1 : 0) - (keys.KeyA ? 1 : 0);
  out.set(0, 0, 0);
  if (dlg.on || transit.on) return out;
  if (f) out.addScaledVector(camFwdH(tv3), f);
  if (r) out.addScaledVector(camRightH(tv3), r);
  if (out.lengthSq() > 1) out.normalize();
  return out;
}
const shiftDown = () => !!(keys.ShiftLeft || keys.ShiftRight);
const swingDown = () => !shopIn && !dlg.on && !!(keys.Space || mouse0 || keys.KeyC);

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
  if (P.state === 'zip' || shopIn) return;
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
  if (shopIn) return false;
  const a = findAnchor(); if (!a) return false;
  P.hand = P.hand === 'R' ? 'L' : 'R'; P.twin = null; P.yank = 1;
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
// C: a web to each side at once. Fires two only when there is a building on each side of the way you are heading, both high
// enough and in clear sight; otherwise a single web, the usual way.
const twinA = { p: new V3(), n: new V3() }, twinB = { p: new V3(), n: new V3() }, _tw = new V3();
function sideAnchor(s, fwd, perp, out) {
  const p = P.pos, ax = p.x + fwd.x * 24 + perp.x * s * 34, az = p.z + fwd.z * 24 + perp.z * s * 34;
  query(p.x - 90, p.x + 90, p.z - 90, p.z + 90, qbuf);
  let bs = 1e9;
  for (const b of qbuf) {
    if (b.slab || b.prop || b.maxY < p.y + 8) continue;
    let qx = clamp(ax, b.minX, b.maxX), qz = clamp(az, b.minZ, b.maxZ), nx = 0, nz = 0;
    if (qx > b.minX && qx < b.maxX && qz > b.minZ && qz < b.maxZ) { // the aim point is inside: take the face turned toward us
      const d = [p.x - b.minX < 0 ? 1e9 : Math.abs(qx - b.minX), Math.abs(b.maxX - qx), Math.abs(qz - b.minZ), Math.abs(b.maxZ - qz)];
      const m = Math.min(...d); if (m === d[0]) { qx = b.minX; nx = -1; } else if (m === d[1]) { qx = b.maxX; nx = 1; } else if (m === d[2]) { qz = b.minZ; nz = -1; } else { qz = b.maxZ; nz = 1; }
    } else { if (qx === b.minX) nx = -1; else if (qx === b.maxX) nx = 1; else if (qz === b.minZ) nz = -1; else nz = 1; }
    const lat = ((qx - p.x) * perp.x + (qz - p.z) * perp.z) * s, ahead = (qx - p.x) * fwd.x + (qz - p.z) * fwd.z;
    if (lat < 5 || lat > 80 || ahead < 3 || ahead > 65) continue;
    const y = Math.min(b.maxY - 0.6, p.y + 20 + ahead * 0.25);
    if (y < p.y + 6) continue;
    const sc = Math.abs(lat - 20) + Math.abs(ahead - 24) * 0.7 - Math.min(y - p.y, 40) * 0.2;
    if (sc >= bs) continue;
    const dx = qx + nx * 0.2 - p.x, dy = y - p.y, dz = qz + nz * 0.2 - p.z, dl = Math.hypot(dx, dy, dz);
    if (rayDist(p, dx / dl, dy / dl, dz / dl, dl) < dl - 1.2) continue;          // something in the way
    bs = sc; out.p.set(qx, y, qz); out.n.set(nx, 0, nz);
  }
  return bs < 1e9;
}
function tryTwin() {
  if (shopIn) return false;
  const v = P.vel, hs = Math.hypot(v.x, v.z), fwd = camFwdH(_tw);
  if (hs > 4) { fwd.multiplyScalar(0.6); fwd.x += (v.x / hs) * 0.4; fwd.z += (v.z / hs) * 0.4; fwd.normalize(); }
  const perp = tv2.set(-fwd.z, 0, fwd.x);
  if (!sideAnchor(1, fwd, perp, twinA) || !sideAnchor(-1, fwd, perp, twinB) || twinA.p.distanceTo(twinB.p) > 150) return tryAttach();
  // the two lines meet in a V: swing from the point between them, a little below the lower anchor
  P.state = 'swing'; P.twin = { l: (twinA.p.x - P.pos.x) * perp.x + (twinA.p.z - P.pos.z) * perp.z > 0 ? twinB.p.clone() : twinA.p.clone(), r: null };
  P.twin.r = P.twin.l.equals(twinA.p) ? twinB.p.clone() : twinA.p.clone();
  P.anchor.addVectors(twinA.p, twinB.p).multiplyScalar(0.5); P.anchorN.set(0, -1, 0);
  P.pivot.copy(P.anchor); P.pivot.y = Math.min(twinA.p.y, twinB.p.y) - 1.5;
  P.swingDir.copy(fwd);
  const d0 = P.pivot.distanceTo(P.pos);
  P.ropeLen = d0 + clamp(d0 * 0.08, 1, 3.5); P.ropeT = 0; P.yank = 1.3;
  if (hs < 40) { v.x += fwd.x * 5; v.z += fwd.z * 5; }                           // the shot itself throws you forward
  if (P.trick) endTrick(true);
  addSplat(twinA.p, twinA.n); addSplat(twinB.p, twinB.n); thwip(); setTimeout(thwip, 70);
  popTrick('TWIN WEB');
  return true;
}
function release(auto) {
  P.twin = null;
  P.state = 'air'; P.timeInAir = 0; P.swingArmed = false; P.swingCd = 0.22; P.relT = 0.8;
  const v = P.vel;
  if (v.y > -6 && v.y < 14) v.y += 3.5;
  const hs = Math.hypot(v.x, v.z);
  if (hs > 1 && hs < 62) { v.x += (v.x / hs) * 4; v.z += (v.z / hs) * 4; }
  P.combo++; addStyle(15, null);
  if (!P.trick && hs > 28 && v.y > 4 && rnd() < 0.2) startTrick(['q', 'e', 'r'][(rnd() * 3) | 0]);
}
// F: fire a line at the aimed point and haul yourself along it, letting go early so you fly on past
function startZip(z) {
  if (shopIn) return;
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
  if (shopIn) return;
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
  P.swingCd -= dt; P.wallCd -= dt; P.timeInAir += dt; P.landT -= dt; P.rollT -= dt; P.skimT -= dt; P.launchT -= dt; P.relT -= dt;
  const jumpEv = ev.jump, swingEv = ev.swing, zipEv = ev.zip, twinEv = ev.twin;
  ev.jump = ev.swing = ev.zip = ev.twin = false;
  if (swingEv && (P.state === 'air')) P.swingArmed = true;
  if (twinEv) { if (P.state === 'air' || P.state === 'swing') tryTwin(); else P.twinArmed = true; }   // from the ground: jump first, fire once airborne
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
      if (P.twinArmed && P.timeInAir > 0.12) { P.twinArmed = false; tryTwin(); break; }
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
      const low = clamp((P.pivot.y - p.y) / len, 0, 1), fwdV = v.dot(P.swingDir) > 0 ? 1 : 0;   // how far down the arc, and whether moving the way you steer
      if (dir.lengthSq() > 0.01) { dir.normalize(); const along = v.dot(dir); v.addScaledVector(dir, ((hasIn ? 9 : 5) + clamp((34 - along) * 0.9, 0, 16)) * dt * low * low * fwdV); }
      // pump at the bottom of the arc for speed (hold forward)
      if (hasIn && v.y < 4 && len > P.ropeLen * 0.96) { const hv = Math.hypot(v.x, v.z); if (hv > 2 && hv < 55) v.addScaledVector(tv3.set(v.x / hv, 0, v.z / hv), 5 * dt); }
      // bleed sideways drift (relative to the steering direction)
      const sx = -P.swingDir.z, sz = P.swingDir.x, lat = v.x * sx + v.z * sz;
      const k = damp(2.2, dt); v.x -= sx * lat * k; v.z -= sz * lat * k;
      // reel in gently; reel fast if the arc would hit the street
      const floor = P.pivot.y - P.ropeLen;
      P.ropeLen = Math.max(9, P.ropeLen - (floor < 6 ? 6 + (6 - floor) * 3 : v.lengthSq() > 9 ? 0.8 : 0) * dt);
      if (P.twin) v.addScaledVector(P.swingDir, 4 * dt * low);                       // two lines take the load: a deeper, stronger arc
      if (!swingHeld) release(false);                                              // the web holds until you let go
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
  if (p.y < -2.2 && !shopIn) respawn(true);
}

function collide() {
  const p = P.pos, v = P.vel, pr = P.prev;
  P.pv.copy(v);
  P.grounded = false; P.wallHit = false; P.impact = 0;
  const onIsland = world.groundAt(p.x, p.z);
  if (onIsland && p.y < HY && !shopIn) { p.y = HY; if (v.y < 0) { P.impact = -v.y; v.y = 0; } P.grounded = true; }
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
function chooseSpawn() { // the city is built with one clean rooftop ledge that looks straight up at Midtown
  const r = world.spawnRoof;
  spawnPos.set(r.x, r.y + HY + 0.05, r.z - 5);
  spawnYaw = 0;
  intro.edge = r.z;
}
function respawn(msg) {
  leaveShopNow();
  if (msg && TR.phase === 'run') { startTrial(TR.k); return; }   // fell in the river mid-trial: straight back to its start line
  P.pos.copy(spawnPos); P.prev.copy(spawnPos); P.rpos.copy(spawnPos); P.vel.set(0, 0, 0); P.state = 'air'; P.trick = null; P.combo = 0; P.zip = null;
  P.landT = P.rollT = P.skimT = P.launchT = 0; P.idleT = 2;
  C.yaw = spawnYaw; C.pitch = -0.12; resetCam();
  P.facing.set(Math.sin(spawnYaw), 0, Math.cos(spawnYaw)); P.fy = spawnYaw;
  world.prime(spawnPos.x, spawnPos.z);
  if (life) life.refresh();
  if (msg) flash('SPLASH! BACK TO THE ROOFTOPS');
}

// ---------------------------------------------------------------- animation
const XAX = new V3(1, 0, 0);
function Bl(j, x, y, z, w) { const t = tgt[j]; t[0] += (x - t[0]) * w; t[1] += (y - t[1]) * w; t[2] += (z - t[2]) * w; }
// the turn a flip or roll puts on the body, in world space, for the first-person view to share; it eases out if a trick is cut short
const _fq = new THREE.Quaternion(), _fqi = new THREE.Quaternion(), QID = new THREE.Quaternion();
function flipTo(local, dt) {
  if (local) { _fqi.copy(P.baseQ).invert(); P.flipQ.copy(P.baseQ).multiply(local).multiply(_fqi); }
  else if (dt > 0) P.flipQ.slerp(QID, damp(9, dt));
}
function updateAnim(dt, time) {
  const v = P.vel, hs = Math.hypot(v.x, v.z), sp = v.length(), st = P.state;
  for (const j of JOINTS) S(j, 0, 0, 0);
  tgt.hipsY = 0;
  let rate = 12, aimR = 0, aimL = 0, look = 0;
  const tr = P.trick, rolling = st === 'ground' && P.rollT > 0 && !tr;
  // facing eases toward the direction of travel; turning leans the body
  if (hs > 0.6 && dt > 0) { tv.set(v.x / hs, 0, v.z / hs); P.facing.lerp(tv, damp(st === 'ground' ? 13 : 9, dt)); P.facing.y = 0; if (P.facing.lengthSq() < 1e-4) P.facing.copy(tv); P.facing.normalize(); }
  if (FP && C.fp > 0.5 && st === 'ground' && hs <= 0.6 && dt > 0 && !tr) { // standing in first person: the head turns first, and the feet follow once it has gone far enough
    const by = Math.atan2(P.facing.x, P.facing.z), d = angDiff(C.yaw, by);
    if (Math.abs(d) > 0.95) P.turning = true; else if (Math.abs(d) < 0.12) P.turning = false;
    if (P.turning) { const a = by + d * (1 - Math.exp(-5.5 * dt)); P.facing.set(Math.sin(a), 0, Math.cos(a)); }
  } else P.turning = false;
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
      const sprint = clamp((hs - 12) / 14, 0, 1), walk = 1 - clamp((hs - 2.4) / 3.5, 0, 1);
      P.runPh += dt * lerp(4 + hs * 0.5, hs * 3.1, walk);
      const ph = P.runPh, s = Math.sin(ph), c = Math.cos(ph), A = clamp(hs / 9, 0.35, 1.15);
      const eb = lerp(-0.7 - 0.6 * A, -0.3, walk);
      S('spine', 0.1 - 0.07 * walk + 0.26 * sprint, 0.1 * s * A, 0); S('chest', 0.04 + 0.1 * sprint, -0.22 * s * A, 0); S('head', -0.1 - 0.3 * sprint, 0.1 * s * A, 0);
      S('shL', 0.95 * s * A, 0, 0.14 + 0.08 * sprint); S('shR', -0.95 * s * A, 0, -0.14 - 0.08 * sprint);
      S('elL', eb + 0.35 * s * A, 0, 0); S('elR', eb - 0.35 * s * A, 0, 0);
      S('hipL', -0.22 + 0.14 * walk - 1.0 * s * A - 0.12 * sprint, 0, 0.04); S('hipR', -0.22 + 0.14 * walk + 1.0 * s * A - 0.12 * sprint, 0, -0.04);
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
    // behind the anchor the legs trail; just past the bottom they whip all the way through, straight, and the body lies back
    const k1 = smooth(clamp((t - 0.42) / 0.3, 0, 1)), tuck = smooth(clamp((t - 0.86) / 0.14, 0, 1));
    const hipx = lerp(0.62, -1.55, k1), knx = lerp(1.0, 0.05, smooth(clamp((t - 0.3) / 0.3, 0, 1))) + tuck * 1.3;
    S('spine', lerp(0.22, -0.4, k1) + tuck * 0.5, 0, 0); S('chest', lerp(0.1, -0.22, k1), 0, 0); S('head', lerp(-0.32, 0.18, k1), 0, 0);
    S('hipL', hipx + 0.12 * (1 - k1), 0, 0.08); S('knL', knx + 0.22 * (1 - k1), 0, 0); S('hipR', hipx - 0.1, 0, -0.08); S('knR', knx, 0, 0); sym('ft', 0.6, 0, 0);
    const fa = lerp(1.05, -0.55, k1);
    if (P.twin) { aimR = 1; aimL = 1; }
    else if (P.hand === 'R') { aimR = 1; S('shL', fa, 0, 0.6); S('elL', -0.35, 0, 0); } else { aimL = 1; S('shR', fa, 0, -0.6); S('elR', -0.35, 0, 0); }
    rate = 11;
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
    } else if (P.relT > 0 && v.y > -5) { // just let go at the top of a swing: back arched, arms wide, one knee drawn up, hanging in the air
      S('spine', -0.34, 0, 0); S('chest', -0.2, 0, 0); S('head', -0.28, 0, 0);
      S('shL', 0.45, 0, 1.25); S('shR', 0.45, 0, -1.25); sym('el', -0.3, 0, 0);
      S('hipL', 0.42, 0, 0.1); S('knL', 0.65, 0, 0); S('hipR', -0.55, 0, -0.1); S('knR', 1.35, 0, 0); rate = 9;
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
  const fpw = smooth(C.fp);
  P.lookW = (P.lookW || 0) + (Math.max(look, tr ? 0 : fpw) - (P.lookW || 0)) * damp(6, dt);
  const gy = clamp(angDiff(C.yaw, fy), -1.3, 1.3) * P.lookW, gp = clamp(C.pitch, -1.0, 0.9) * P.lookW;
  // the head turns first and fastest; the chest follows more slowly and takes a share of the turn
  P.hy = (P.hy || 0) + (gy - (P.hy || 0)) * damp(16, dt); P.cyw = (P.cyw || 0) + (gy - (P.cyw || 0)) * damp(5, dt); P.hp = (P.hp || 0) + (gp - (P.hp || 0)) * damp(14, dt);
  const cSh = 0.22 + 0.08 * fpw, hSh = 0.62 + 0.1 * fpw, pSh = 0.45 + 0.3 * fpw;
  const sC = cur.spine, cC = cur.chest, hC = cur.head;
  R.spine.rotation.set(sC[0] * 0.6, sC[1] * 0.6, sC[2] * 0.6);
  R.chest.rotation.set(sC[0] * 0.4 + cC[0] - P.hp * 0.1 * fpw, sC[1] * 0.4 + cC[1] + P.cyw * cSh, sC[2] * 0.4 + cC[2]);
  R.head.rotation.set(hC[0] - P.hp * pSh, hC[1] + P.hy * (cSh + hSh) - P.cyw * cSh, hC[2] - P.hy * 0.06);
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
    const f = clamp(-v.y / 20, 0, 1) * clamp((P.timeInAir - 0.25) / 0.6, 0, 1) * (1 - 0.85 * smooth(C.fp));   // in first person the body stays under you as you drop, legs hanging where you can see them
    fw.copy(P.facing); up.addScaledVector(P.facing, clamp(hs / 60, 0, 0.45) * (1 - 0.6 * smooth(C.fp)) + f * 0.75); up.x += P.facing.z * P.lean; up.z -= P.facing.x * P.lean; up.normalize(); orate = 5.5;
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
    hero.quaternion.copy(P.baseQ).multiply(tq2); flipTo(tq2, 1);
    if (pp >= 1) endTrick(false);
  } else if (rolling) { tq2.setFromAxisAngle(XAX, TAU * smooth(clamp(1 - P.rollT / 0.46, 0, 1))); hero.quaternion.copy(P.baseQ).multiply(tq2); flipTo(tq2, 1); }
  else { hero.quaternion.copy(P.baseQ); flipTo(null, dt); }
  // body offset (wall: stand on the wall surface; roll: turn over close to the ground)
  const offT = tv3.set(0, 0, 0);
  if (st === 'wall') offT.copy(P.wallN).multiplyScalar(0.5); else if (rolling) offT.set(0, -0.48, 0);
  P.offset.lerp(offT, damp(rolling ? 22 : 12, dt));
  hero.position.copy(P.rpos).add(P.offset);
  hero.updateMatrixWorld(true);

  // ---- arm aiming at web anchor
  P.aimW += ((aimR ? 1 : 0) - P.aimW) * damp(18, dt);
  P.aimW2 += ((aimL ? 1 : 0) - P.aimW2) * damp(18, dt);
  const target = st === 'zip' && P.zip ? P.zip.hit : P.anchor, tw = st === 'swing' && P.twin;
  if (P.aimW > 0.01) aimArm(R.shR, R.elR, tw ? P.twin.r : target, P.aimW * (aimR || 1));
  if (P.aimW2 > 0.01) aimArm(R.shL, R.elL, tw ? P.twin.l : target, P.aimW2 * (aimL || 1));
  if (P.reachT > 0) aimArm(R.shR, R.elR, P.reachAt, Math.sin(clamp(1 - P.reachT / 0.8, 0, 1) * Math.PI) ** 0.6);   // reaching over a counter
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

// ---------------------------------------------------------------- the web: a bright core wrapped in two twisted filaments, laced with cross-threads
const webLineTex = (() => {
  const cv = document.createElement('canvas'); cv.width = 64; cv.height = 256; const g = cv.getContext('2d');
  const fx = (y, s) => 32 + s * 21 * Math.sin((y / 256) * TAU * 2);
  g.lineCap = 'round';
  for (let y = 0; y < 256; y += 10) { // the lacing between the filaments, a little uneven like the real thing
    const s = (y / 10) % 2 ? 1 : -1, y2 = y + 6 + ((y * 7) % 5);
    g.strokeStyle = 'rgba(235,245,255,0.7)'; g.lineWidth = 1.6; g.beginPath(); g.moveTo(fx(y, s), y); g.lineTo(32, (y + y2) / 2); g.lineTo(fx(y2, -s), y2); g.stroke();
  }
  for (const s of [-1, 1]) { g.strokeStyle = 'rgba(240,248,255,0.95)'; g.lineWidth = 2.8; g.beginPath(); for (let y = -2; y <= 258; y += 2) { if (y === -2) g.moveTo(fx(y, s), y); else g.lineTo(fx(y, s), y); } g.stroke(); }
  g.shadowColor = 'rgba(190,225,255,0.9)'; g.shadowBlur = 5; g.strokeStyle = '#ffffff'; g.lineWidth = 7; g.beginPath(); g.moveTo(32, -4); g.lineTo(32, 260); g.stroke(); g.shadowBlur = 0;
  for (let y = 0; y < 256; y += 32) { g.fillStyle = 'rgba(255,255,255,0.95)'; g.beginPath(); g.arc(32, y + 16, 5, 0, TAU); g.fill(); }   // beads of glue where the strands cross
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
})();
const webRibMat = new THREE.MeshBasicMaterial({ map: webLineTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, color: 0xeef7ff });
for (const ry of [0, Math.PI / 2]) { // two crossed ribbons read as a strand from any side; they ride on the core line and stretch with it
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 1).translate(0, 0.5, 0).rotateY(ry), webRibMat); m.frustumCulled = false; m.renderOrder = 3; rope.add(m);
}

// ---------------------------------------------------------------- first-person arms
// The hero's own arms, copied and hung in front of the eyes. They are posed for the picture, not for anatomy: whatever the body
// is doing, you see your hands at work, and the web leaves the hand you can see. They are drawn in a sliver of the depth range
// of their own, so they can never cut into a wall, and the real body is left out of the picture (it still casts the shadow).
scene.add(camera);
const VM = { root: new THREE.Group(), arms: [], lastYaw: 0, lastPitch: 0, sway: new V3(), on: false };
VM.root.rotation.y = Math.PI; VM.root.visible = false; camera.add(VM.root);      // inside this group x is your left, y up, z ahead
const vmNear = (r) => r.getContext().depthRange(0, 0.05), vmFar = (r) => r.getContext().depthRange(0, 1);
for (const [key, side] of [['L', 1], ['R', -1]]) {
  const sh = R['sh' + key].clone(true), el = sh.children.find((c) => c.isGroup), ha = el.children.find((c) => c.isGroup);
  sh.traverse((o) => { if (o.isMesh) { o.castShadow = false; o.frustumCulled = false; o.renderOrder = 900; o.onBeforeRender = vmNear; o.onAfterRender = vmFar; } });
  sh.rotation.set(0, 0, 0); el.rotation.set(0, 0, 0); ha.rotation.set(0.3, 0, 0);
  VM.root.add(sh); VM.arms.push({ key, side, sh, el, ha, pos: new V3(side * 0.26, -0.55, 0.3), sho: new V3(side * 0.2, -0.3, 0.05) });
}
const vmT = new V3(), vmD = new V3(), vmE = new V3(), vmPole = new V3(), vmQ1 = new THREE.Quaternion(), vmQ2 = new THREE.Quaternion(), vmA = new V3(), vmA2 = new V3();
// where a world point lies from the eyes, as a direction the hands can reach along and still be in the picture
function vmAim(world, out) {
  out.subVectors(world, camera.position).applyQuaternion(vmQ1.copy(camera.quaternion).invert());
  out.set(-out.x, out.y, -out.z).normalize();
  return out.set(clamp(out.x, -0.72, 0.72), clamp(out.y, -0.2, 0.68), Math.max(out.z, 0.52)).normalize();
}
function updateViewArms(dt) {
  const on = C.fp > 0.5 && !mapOpen;
  if (on !== VM.on) { VM.on = on; VM.root.visible = on; }
  if (!on) return;
  const st = P.state, v = P.vel, sp = v.length(), swing = st === 'swing';
  if (dt > 0) { // the hands trail a quick look by a moment
    VM.sway.x += (clamp(angDiff(C.yaw, VM.lastYaw) / dt * 0.016, -0.07, 0.07) - VM.sway.x) * damp(8, dt); VM.sway.y += (clamp((C.pitch - VM.lastPitch) / dt * 0.014, -0.05, 0.05) - VM.sway.y) * damp(8, dt);
    VM.lastYaw = C.yaw; VM.lastPitch = C.pitch;
  }
  // how hard the line is pulling: the arms straighten, the grip shakes, the whole view takes the load
  const tens = swing ? clamp((sp * sp) / (Math.max(P.ropeLen, 8) * 40) + 0.35, 0, 1.4) : 0, yk = smooth(clamp(P.yank, 0, 1.3) / 1.3);
  const shk = (tens * 0.006 + yk * 0.02), nx = Math.sin(time * 61.3) * 0.6 + Math.sin(time * 37.1) * 0.4, ny = Math.sin(time * 54.7 + 1.1) * 0.6 + Math.sin(time * 29.3) * 0.4;
  const reach = P.reachT > 0 ? Math.sin(clamp(1 - P.reachT / 0.8, 0, 1) * Math.PI) : 0, dive = st === 'air' && shiftDown() && v.y < 6;
  const fall = st === 'air' ? clamp((-v.y - 6) / 30, 0, 1) : 0;
  if (swing && !P.twin) vmAim(P.anchor, vmA);
  for (const A of VM.arms) {
    const s = A.side, ph = C.bobPh + (s > 0 ? 0 : Math.PI), top = P.hand === A.key;
    let k = 9;
    if (swing && P.twin) { // a hand on each line
      vmAim(s > 0 ? P.twin.l : P.twin.r, vmD); vmT.set(s * 0.17, -0.2, 0.1).addScaledVector(vmD, 0.54 + tens * 0.04); k = 11;
    } else if (swing) { // both hands on the one line, one above the other
      vmT.set(0, -0.22, 0.1).addScaledVector(vmA, top ? 0.6 + tens * 0.04 : 0.4); vmT.x += s * 0.045; k = 11;
    } else if (st === 'zip' && P.zip) { vmAim(P.zip.hit, vmD); vmT.set(s * 0.08, -0.2, 0.1).addScaledVector(vmD, top ? 0.58 : 0.44); k = 14; }
    else if (dive) { vmT.set(s * 0.13, -0.18, 0.62); k = 6; }
    else if (st === 'air' || st === 'wall') vmT.set(s * (0.4 + fall * 0.06), -0.5 + fall * 0.16 + Math.sin(time * 2.1 + s) * 0.015, 0.36);   // low at the sides, drifting up into the corners as you drop
    else vmT.set(s * 0.26, -0.62 + C.bobK * 0.16 + Math.sin(ph) * 0.06 * C.bobK, 0.36 + Math.cos(ph) * 0.06 * C.bobK);                          // out of sight at rest, glimpsed at the bottom edge as you run
    if (swing) { vmT.y -= yk * 0.16; vmT.x += nx * shk * s; vmT.y += ny * shk; }                                                                  // the line takes your weight with a jolt
    if (reach > 0 && s < 0) vmT.lerp(vmD.set(-0.08, -0.12, 0.62), reach);
    vmT.x += VM.sway.x; vmT.y += VM.sway.y;
    if (dt > 0) A.pos.lerp(vmT, damp(k, dt));
    // two bones from shoulder to hand, the elbow hanging down and a little outward
    const L1 = 0.285, L2 = 0.262, S = A.sho;
    vmD.subVectors(A.pos, S); let len = vmD.length(); const mx = (L1 + L2) * 0.985; if (len > mx) { vmD.multiplyScalar(mx / len); len = mx; } if (len < 0.12) { vmD.set(0, -0.12, 0); len = 0.12; }
    const a = (L1 * L1 - L2 * L2 + len * len) / (2 * len), h = Math.sqrt(Math.max(0, L1 * L1 - a * a));
    vmE.copy(vmD).multiplyScalar(1 / len); vmPole.set(s * 0.75, -1, -0.3); vmPole.addScaledVector(vmE, -vmPole.dot(vmE)).normalize();
    vmE.multiplyScalar(a).addScaledVector(vmPole, h);
    A.sh.position.copy(S); vmQ1.setFromUnitVectors(DOWN, vmA2.copy(vmE).normalize()); A.sh.quaternion.copy(vmQ1);
    vmQ2.setFromUnitVectors(DOWN, vmA2.subVectors(vmD, vmE).normalize()); A.el.quaternion.copy(vmQ1).invert().multiply(vmQ2);
    A.ha.rotation.set(swing || st === 'zip' ? 0.9 : 0.3, 0, swing ? s * 0.4 : 0);                                                                 // wrists cocked round the line
  }
  camera.updateMatrixWorld(true);
}
// the real body: out of the picture in first person, still in the shadow map
let ghostOn = false, bodyMeshes = null;
function setBodyGhost(on) {
  if (on === ghostOn) return; ghostOn = on;
  if (!bodyMeshes) { bodyMeshes = []; const keep = new Set([R.hipL, R.knL, R.ftL, R.hipR, R.knR, R.ftR]); hero.traverse((o) => { if (o.isMesh && !keep.has(o.parent)) bodyMeshes.push(o); }); }   // the legs stay: look down and they are there
  for (const m of bodyMeshes) {
    if (!m.userData.solid) { m.userData.solid = m.material; const g = m.material.clone(); g.colorWrite = false; g.depthWrite = false; m.userData.ghost = g; }
    m.material = on ? m.userData.ghost : m.userData.solid;
  }
}

const rope2 = rope.clone(true); rope2.visible = false; scene.add(rope2);
const _hp2 = new V3();
function updateRope(dt) {
  let show = false, show2 = false;
  const hp = _hp, fp = VM.on;
  const hand = (key, out, low) => { // in first person the line runs from the lower of the two gripping hands
    if (fp) { const A = VM.arms[key === 'L' ? 0 : 1], B = VM.arms[key === 'L' ? 1 : 0]; (low && P.state === 'swing' && !P.twin ? B : A).ha.getWorldPosition(out); return out; }
    return (key === 'R' ? R.handR : R.handL).getWorldPosition(out);
  };
  if (P.state === 'swing') {
    P.ropeT = Math.min(1, P.ropeT + dt / 0.08); show = true;
    if (P.twin) { setRope(rope, hand('R', hp), P.twin.r, P.ropeT); setRope(rope2, hand('L', _hp2), P.twin.l, P.ropeT); show2 = true; }
    else setRope(rope, hand(P.hand === 'R' ? 'R' : 'L', hp, true), P.anchor, P.ropeT);
  } else if (P.state === 'zip' && P.zip) {
    hand('R', hp); show = true; P.ropeT = Math.min(1, P.ropeT + dt / 0.08);
    setRope(rope, hp, P.zip.hit, P.ropeT);
  }
  rope.visible = show; rope2.visible = show2;
  if (dt > 0) P.yank = Math.max(0, P.yank - dt * 2.6);
  for (const s of splats) if (s.visible) { s.userData.t -= dt; s.material.opacity = clamp(s.userData.t, 0, 1); if (s.userData.t <= 0) s.visible = false; }
}
function setRope(rope, a, b, t) {
  const d = tv.subVectors(b, a); const len = d.length(); d.divideScalar(len);
  rope.position.copy(a); rope.quaternion.setFromUnitVectors(UP, d); rope.scale.set(0.5, len * t, 0.5);
  webLineTex.repeat.y = Math.max(1, (len * t) / 1.3);
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
const fpEye = new V3(), fpSteady = new V3(), fpUp = new V3(), fpFq = new THREE.Quaternion();
function updateCamera(dt, now, time) {
  const v = P.vel, sp = v.length(), hs = Math.hypot(v.x, v.z), st = P.state;
  if (now - lastMouse > 2200 && (st === 'swing' || st === 'air' || st === 'zip') && hs > 10) {
    C.yawT += angDiff(Math.atan2(v.x, v.z), C.yawT) * damp(0.8, dt) * clamp((now - lastMouse - 2200) / 1500, 0, 1);
  }
  if (keys.ArrowLeft) C.yawT += 2.2 * dt; if (keys.ArrowRight) C.yawT -= 2.2 * dt;
  if (keys.ArrowUp) C.pitchT = clamp(C.pitchT + 1.5 * dt, pitchLo(), pitchHi()); if (keys.ArrowDown) C.pitchT = clamp(C.pitchT - 1.5 * dt, pitchLo(), pitchHi());
  if (started) C.cine = Math.max(0, C.cine - dt * 0.8);   // the opening shot relaxes into the play camera
  const ks = dt > 0 ? damp(lerp(60, 2.6, smooth(C.cine)), dt) : 1;
  C.yaw += (C.yawT - C.yaw) * ks; C.pitch += (C.pitchT - C.pitch) * ks;

  tv.copy(P.rpos); tv.y += 0.55 - P.perch * 0.4;
  C.target.lerp(tv, dt > 0 ? damp(st === 'zip' ? 30 : 20, dt) : 1);
  const want = 3.3 + smooth(C.cine) * 1.1 + clamp(sp / 70, 0, 1) * 2.6 + (st === 'swing' ? 0.5 : 0) + (st === 'wall' ? 0.9 : 0) - P.perch * 0.4;
  C.dist += (want - C.dist) * damp(2.5, dt);
  const cp = Math.cos(C.pitch), dx = Math.sin(C.yaw) * cp, dy = Math.sin(C.pitch), dz = Math.cos(C.yaw) * cp;
  camDir.set(dx, dy, dz);
  // over-the-shoulder pivot; the shoulder offset shrinks at speed and next to walls
  const rx = -Math.cos(C.yaw), rz = Math.sin(C.yaw);
  let side = 0.5 + smooth(C.cine) * 0.7 - clamp(sp / 40, 0, 1) * 0.28;
  const sClear = rayDist(C.target, rx, 0, rz, side + 0.35) - 0.35; if (sClear < side) side = Math.max(0, sClear);
  C.side += (side - C.side) * damp(side < C.side ? 18 : 4, dt);
  camPivot.copy(C.target); camPivot.x += rx * C.side; camPivot.z += rz * C.side; camPivot.y += 0.38 - smooth(C.cine) * 0.7;
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
  // first person: the view sits at the hero's eyes and rides the head, so every stride, lean, landing and swing moves it,
  // while the gaze itself stays under the mouse. The head is left out of the picture but still casts its shadow.
  const fpT = FP && started && C.cine <= 0 ? 1 : 0;
  C.fp += (fpT - C.fp) * (dt > 0 ? damp(9, dt) : 1); if (Math.abs(fpT - C.fp) < 0.002) C.fp = fpT;
  let fpBank = 0;
  if (C.fp > 0) {
    hero.visible = true;
    fpEye.set(0, 0.115, 0.1).applyMatrix4(R.head.matrixWorld);
    fpSteady.set(0, 0.67 - P.perch * 0.45, 0).addScaledVector(P.facing, 0.07).applyQuaternion(P.flipQ).add(P.rpos).add(P.offset);   // the steady eye turns with a flip too
    fpEye.lerp(fpSteady, 0.5);            // most of the body's motion, not all of it: a flip should not turn the stomach
    if (st === 'ground' && dt > 0) C.bobPh += dt * (5.5 + hs * 0.95);
    C.bobK += ((st === 'ground' ? clamp(hs / 7, 0, 1) : 0) - C.bobK) * damp(6, dt);
    const bx = Math.sin(C.bobPh) * 0.012 * C.bobK;                          // the sway and dip of each stride, and the give in the knees on landing
    fpEye.y += Math.sin(C.bobPh * 2) * 0.017 * C.bobK - smooth(C.kick) * 0.08 - smooth(clamp(P.yank, 0, 1)) * 0.13;   // the drop as the line takes your weight fpEye.x += rx * bx; fpEye.z += rz * bx;
    camPos.lerp(fpEye, smooth(C.fp));
    fpUp.set(0, 1, 0).applyQuaternion(P.baseQ); fpBank = clamp((fpUp.x * rx + fpUp.z * rz) * 0.2, -0.14, 0.14) * smooth(C.fp);   // the horizon tips as the body banks through a swing
  }
  setBodyGhost(C.fp > 0.5);

  // gentle life in the lens: bank with sideways motion, a rumble at speed, a jolt on impact, a slow breath when still
  const latV = v.x * rx + v.z * rz;
  C.roll += (clamp(latV * 0.0035, -0.075, 0.075) + (st === 'swing' ? Math.sin(time * 1.3) * 0.006 : 0) - C.roll) * damp(3.2, dt);
  C.shake = Math.max(0, C.shake - dt * 1.9); C.kick = Math.max(0, C.kick - dt * 1.6);
  const rum = clamp((sp - 38) / 45, 0, 1), sh = C.shake * C.shake * 1.6 + rum * 0.035, still = st === 'ground' && hs < 1 ? 1 : 0;
  const nx = Math.sin(time * 53.1) * 0.6 + Math.sin(time * 31.7 + 1.3) * 0.4, ny = Math.sin(time * 47.3 + 2.1) * 0.6 + Math.sin(time * 27.9) * 0.4;
  camera.position.set(camPos.x + rx * nx * sh * 0.22, camPos.y + ny * sh * 0.22 + still * Math.sin(time * 1.1) * 0.012, camPos.z + rz * nx * sh * 0.22);
  camera.lookAt(camera.position.x + dx, camera.position.y + dy, camera.position.z + dz);
  camera.rotateZ(-C.roll * (1 + 0.25 * C.fp) - fpBank + nx * sh * 0.012 + still * Math.sin(time * 0.63) * 0.003);
  if (C.fp > 0) { // on the line the view is hauled toward the anchor and shivers with the load; a flip or roll turns the whole view with the body
    const load = st === 'swing' ? clamp((sp * sp) / (Math.max(P.ropeLen, 8) * 40), 0, 1.2) : 0, yk = smooth(clamp(P.yank, 0, 1));
    camera.rotateX((-yk * 0.06 + Math.sin(time * 58.3) * load * 0.0025) * smooth(C.fp)); camera.rotateZ(Math.sin(time * 49.1 + 0.7) * load * 0.002 * smooth(C.fp));
    if (P.flipQ.w < 0.99999) { fpFq.slerpQuaternions(QID, P.flipQ, smooth(C.fp)); camera.quaternion.premultiply(fpFq); }
  }
  if (sh > 0.001) camera.rotateX(ny * sh * 0.014);
  // a little wider where the moment calls for it: a long drop, the bottom of a fast swing, high over the city, out over open water or park
  if ((C.areaT -= dt) <= 0) { C.areaT = 0.3; const z = world.zoneAt(P.pos.x, P.pos.z); C.areaW = /RIVER|HARBOR|CENTRAL PARK|BATTERY/.test(z) ? 1 : 0; }
  C.area = (C.area || 0) + ((C.areaW || 0) - (C.area || 0)) * damp(1.2, dt);
  const extra = clamp((-v.y - 16) / 34, 0, 1) * 6 + (st === 'swing' ? clamp((sp - 24) / 30, 0, 1) * clamp((P.pivot.y - P.pos.y) / Math.max(P.ropeLen, 1), 0, 1) * 5 : 0) + clamp((P.pos.y - 110) / 220, 0, 1) * 3 + C.area * 3 + smooth(clamp(P.yank, 0, 1)) * 3;
  const fov = lerp(62 - smooth(C.cine) * 17 + clamp((sp - 14) / 56, 0, 1) * 21 + smooth(C.kick) * 7 - P.perch * 3, 80 + clamp((sp - 14) / 56, 0, 1) * 15 + smooth(C.kick) * 5, smooth(C.fp)) + extra * (1 - smooth(C.cine));
  C.fov += (fov - C.fov) * damp(3, dt);
  const nearW = 0.25 - 0.15 * C.fp;                                         // close enough to see your own hands
  if (Math.abs(camera.fov - C.fov) > 0.01 || (MAPV.k === 0 && Math.abs(camera.near - nearW) > 1e-3)) { camera.fov = C.fov; if (MAPV.k === 0) camera.near = nearW; camera.updateProjectionMatrix(); }
  updateViewArms(dt);
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

// ---------------------------------------------------------------- reflections: the skyline itself is captured into the environment map
const cubeRT = new THREE.WebGLCubeRenderTarget(256, { type: THREE.HalfFloatType });
const cubeCam = new THREE.CubeCamera(2, 9000, cubeRT);
let cityEnv = null;
function captureEnv() { // used only by the building facades; everything else keeps the clean sky
  const hv = hero.visible, vv = VM.root.visible; hero.visible = false; VM.root.visible = false; setHaze(2.5);
  cubeCam.position.set(P.rpos.x, 240, P.rpos.z);
  cubeCam.update(renderer, scene);
  hero.visible = hv; VM.root.visible = vv; setHaze(1);
  const rt = pmrem.fromCubemap(cubeRT.texture);
  if (cityEnv) cityEnv.dispose();
  cityEnv = rt; world.facadeMat.envMap = rt.texture; world.facadeMat.envMapIntensity = TOD[todIdx].env * 1.5; world.facadeMat.needsUpdate = true;
}

// ---------------------------------------------------------------- city map (M) and time trials
function topAt(x, z) { let y = world.groundAt(x, z) ? 0 : -3; query(x - 0.5, x + 0.5, z - 0.5, z + 0.5, qbuf); for (const b of qbuf) if (x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ && b.maxY > y) y = b.maxY; return y; }
const FOUNT = world.parkRect.fountain;
const AVX = (a) => -HALFX + a * BX, STZ = (r) => -HALFZ + r * BZ;
const TRIALS = [
  { name: 'UPTOWN EXPRESS', blurb: 'Forty-eight blocks north, from the roof where you start to the fountain in the park', start: null, goal: [FOUNT[0] + 12, 1.2, FOUNT[1]], r: 10, medals: [120, 150, 210] },
  { name: 'THE CLIMB', blurb: 'From the avenue to the crown of the great Midtown tower', start: [AVX(CROWN_CELL[0] + 1), STZ(CROWN_CELL[1] + 1.5)], goal: [cellX(CROWN_CELL[0]), 374, cellZ(CROWN_CELL[1])], r: 12, medals: [30, 42, 62] },
  { name: 'DOWNTOWN DIVE', blurb: 'Leap off the downtown giant and touch down in Battery Park', start: [cellX(DOWNTOWN_CELL[0]) + 7, cellZ(DOWNTOWN_CELL[1])], goal: [cellX(6), 1.2, cellZ(1)], r: 18, medals: [30, 40, 60] },
  { name: 'RIVER TO RIVER', blurb: 'Three and a half kilometres across town at 20th Street, east shore to a west side pier', start: [-HALFX + 8, STZ(48)], goal: [HALFX + EDGE + 110, 1.2, STZ(48)], r: 11, medals: [105, 135, 190] },
];
const TR = { k: -1, phase: 'idle', count: 0, t: 0, doneT: 0, goal: new V3(), best: {} };
try { TR.best = JSON.parse(localStorage.getItem('skythread-best-2') || '{}') || {}; } catch (_) { TR.best = {}; }
const beacon = new THREE.Group();
{
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(2.4, 2.4, 520, 18, 1, true), new THREE.MeshBasicMaterial({ color: 0xffb14a, transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  beam.position.y = 255;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.035, 8, 48).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffd38a, fog: false }));
  ring.name = 'ring'; beacon.add(beam, ring); beacon.visible = false; scene.add(beacon);
}
const hudTrial = document.getElementById('trialhud');
let mapOpen = false;
function startTrial(k) {
  const T = TRIALS[k], sx = T.start ? T.start[0] : spawnPos.x, sz = T.start ? T.start[1] : spawnPos.z;
  if (mapOpen) closeMap();
  leaveShopNow();
  world.prime(sx, sz);
  P.pos.set(sx, topAt(sx, sz) + HY + 0.05, sz); P.prev.copy(P.pos); P.rpos.copy(P.pos); P.vel.set(0, 0, 0);
  P.state = 'ground'; P.trick = null; P.zip = null; P.combo = 0; P.landT = P.rollT = P.skimT = P.launchT = 0; P.idleT = 0;
  const yaw = Math.atan2(T.goal[0] - sx, T.goal[2] - sz);
  C.yaw = C.yawT = yaw; C.pitch = C.pitchT = -0.08; C.cine = 0; resetCam(); P.facing.set(Math.sin(yaw), 0, Math.cos(yaw)); P.fy = yaw;
  life.refresh();
  TR.k = k; TR.phase = 'count'; TR.count = 3.4; TR.t = 0; TR.goal.set(T.goal[0], T.goal[1], T.goal[2]);
  beacon.position.copy(TR.goal); beacon.getObjectByName('ring').scale.setScalar(T.r); beacon.visible = true;
  hudTrial.classList.add('on'); document.getElementById('tname').textContent = T.name; document.getElementById('ttime').textContent = '0.00';
  flash(T.name);
}
function endTrial() { TR.phase = 'idle'; TR.k = -1; beacon.visible = false; hudTrial.classList.remove('on'); }
function finishTrial() {
  const T = TRIALS[TR.k], t = TR.t, m = T.medals, medal = t <= m[0] ? 'GOLD' : t <= m[1] ? 'SILVER' : t <= m[2] ? 'BRONZE' : 'FINISHED';
  const old = TR.best[T.name], rec = !old || t < old;
  if (rec) { TR.best[T.name] = +t.toFixed(2); try { localStorage.setItem('skythread-best-2', JSON.stringify(TR.best)); } catch (_) {} }
  TR.phase = 'done'; TR.doneT = 6;
  popTrick(medal + (rec && old ? ' · NEW BEST' : '')); flash(T.name + ' · ' + t.toFixed(2) + ' S');
  P.style += medal === 'GOLD' ? 3000 : medal === 'SILVER' ? 1500 : medal === 'BRONZE' ? 700 : 200;
  for (let q = 0; q < 4; q++) tone('sine', [660, 830, 990, 1320][q], [660, 830, 990, 1320][q], 0.16, 0.16, { delay: q * 0.09, send: 0.4 });
}
function updateTrial(dt) {
  if (TR.phase === 'idle') return;
  const T = TRIALS[TR.k], d = P.pos.distanceTo(TR.goal);
  if (TR.phase === 'count') {
    const a = Math.ceil(TR.count); TR.count -= dt; const b = Math.ceil(TR.count);
    if (b !== a && a <= 3) { if (b > 0) { popTrick(String(b)); tone('sine', 660, 660, 0.1, 0.2, { send: 0.2 }); } else { popTrick('GO!'); tone('sine', 1320, 1320, 0.28, 0.25, { send: 0.3 }); TR.phase = 'run'; TR.t = 0; } }
    else if (b !== a && a === 4) { popTrick('3'); tone('sine', 660, 660, 0.1, 0.2, { send: 0.2 }); }
  } else if (TR.phase === 'run') {
    TR.t += dt; document.getElementById('ttime').textContent = TR.t.toFixed(2);
    if (d < T.r) finishTrial();
  } else if ((TR.doneT -= dt) <= 0) { endTrial(); return; }
  document.getElementById('tinfo').textContent = TR.phase === 'done' ? 'COMPLETE' : Math.round(d) + ' M TO GO  ·  GOLD ' + T.medals[0] + ' S';
  beacon.getObjectByName('ring').position.y = 0.4 + Math.sin(time * 3) * 0.25;
  beacon.children[0].material.opacity = 0.22 * clamp((d - 12) / 60, 0.15, 1);   // the beam thins out as you close in, so it never fills the view
}
function miniGoal(c, k, u, G = TR.goal, col = '#ffb14a') { // a goal on the minimap, pinned to the rim when it is out of range
  const lx = -(G.x - P.pos.x) * k, ly = -(G.z - P.pos.z) * k, cs = Math.cos(C.yaw), sn = Math.sin(C.yaw);
  let rx = lx * cs - ly * sn, ry = lx * sn + ly * cs; const len = Math.hypot(rx, ry), max = c - 9 * u;
  if (len > max) { rx *= max / len; ry *= max / len; }
  mctx.fillStyle = col; mctx.strokeStyle = '#0b1220'; mctx.lineWidth = 2 * u;
  mctx.save(); mctx.translate(c + rx, c + ry); mctx.rotate(Math.PI / 4); mctx.beginPath(); mctx.rect(-5 * u, -5 * u, 10 * u, 10 * u); mctx.stroke(); mctx.fill(); mctx.restore();
}
// ---------------------------------------------------------------- opening shot: the hero walks to the roof's edge and settles into a crouch
const intro = { t: 0, on: true, edge: 0 };
function introStep(dt) {
  intro.t += dt;
  const stop = intro.edge - 0.8; let sp = 0;
  if (intro.t > 1.0 && P.pos.z < stop) { sp = Math.min(2.2, (stop - P.pos.z) * 2.2 + 0.3); P.pos.z = Math.min(stop, P.pos.z + sp * dt); }
  P.vel.set(0, 0, sp); P.pos.y = spawnPos.y; P.prev.copy(P.pos); P.rpos.copy(P.pos); P.state = 'ground'; P.grounded = true;
  const u = smooth(clamp(intro.t / 15, 0, 1));
  C.yawT = C.yaw = 1.0 - 0.55 * u + Math.sin(intro.t * 0.13) * 0.04; C.pitchT = C.pitch = 0.13 - 0.1 * u; C.cine = 1;
}
function introLeap() { // the click: straight from the crouch into a running dive off the edge
  intro.on = false;
  P.pos.z = Math.max(P.pos.z, intro.edge - 2.5); P.state = 'air'; P.vel.set(0, 10.5, 15); P.timeInAir = 0; P.swingArmed = false; P.idleT = 0;
  C.yawT = 0; C.pitchT = -0.2; whoosh(0.7);
}

// ---------------------------------------------------------------- the city map (M): the camera lifts to a tilted bird's-eye view of the real city
camera.far = 14000; camera.updateProjectionMatrix(); sky.renderOrder = -10;
const MAPV = { k: 0, zoom: 0.3, sel: -1, drag: false, tx: 0, tz: 0, vis: 0 };
const mfx = document.getElementById('mapfx'), mg = mfx.getContext('2d');
const _mq = new THREE.Quaternion(), _mq2 = new THREE.Quaternion(), _mp = new V3(), _mv = new V3();
function trialCards() {
  document.getElementById('trials').innerHTML = TRIALS.map((T, k) => {
    const b = TR.best[T.name], m = T.medals, medal = !b ? '' : b <= m[0] ? 'GOLD' : b <= m[1] ? 'SILVER' : b <= m[2] ? 'BRONZE' : '', on = MAPV.sel === k;
    return `<div class="tcard${on ? ' sel' : ''}" data-k="${k}"><div class="tn"><b>${k + 1}</b>${T.name}</div><div class="tb">${T.blurb}</div>` +
      (on ? `<div class="tm"><span>GOLD ${m[0]}s</span><span>SILVER ${m[1]}s</span><span>BRONZE ${m[2]}s</span></div>` : '') +
      `<div class="tbest">${b ? 'BEST ' + b.toFixed(2) + ' S' + (medal ? ' · ' + medal : '') : 'NOT RUN YET'}</div>${on ? '<div class="go">START  ▸</div>' : ''}</div>`;
  }).join('') + (TR.phase !== 'idle' ? '<div class="tcard quit" data-k="-1"><div class="tn">LEAVE TRIAL</div><div class="tb">Back to free roaming</div></div>' : '') +
    `<div class="tcard story" data-k="-2"><div class="tn">LAST ORDERS</div><div class="tb">${QUEST.step >= 7 ? 'Story complete · click to play it again' : QTEXT[QUEST.step]}</div><div class="tbest">STORY · ${Math.min(QUEST.step, 7)} / 7</div></div>`;
}
function selectTrial(k, again) { if (MAPV.sel === k && again) { startTrial(k); return; } MAPV.sel = k; trialCards(); }
function openMap() {
  if (!started || mapOpen) return;
  if (shopIn || dlg.on || transit.on) { flash('STEP OUTSIDE FIRST'); return; }
  mapOpen = true; MAPV.sel = TR.phase !== 'idle' ? TR.k : -1; MAPV.zoom = 0.16; MAPV.tx = P.pos.x; MAPV.tz = clamp(P.pos.z + 500, -HALFZ, HALFZ); trialCards();   // opens on your part of town; scroll out for the whole island
  world.setFarVis(1e9);
  document.getElementById('mapview').classList.add('show'); document.body.classList.add('mapping'); document.getElementById('pause').classList.remove('show');
  if (document.pointerLockElement) document.exitPointerLock();
}
function closeMap() {
  if (!mapOpen) return;
  mapOpen = false; document.getElementById('mapview').classList.remove('show'); document.body.classList.remove('mapping');
  world.setFarVis(1.9 / (TOD[todIdx].fogD * 1.16));
  if (!QS.has('nolock')) tryLock();
}
document.getElementById('trials').addEventListener('click', (e) => {
  const el = e.target.closest('.tcard'); if (!el) return;
  const k = +el.dataset.k;
  if (k === -1) { endTrial(); closeMap(); }
  else if (k === -2) { if (QUEST.step >= 7) { QUEST.step = 0; saveStory(); trialCards(); } }
  else if (MAPV.sel === k) startTrial(k); else selectTrial(k);
});
document.getElementById('mapclose').addEventListener('click', () => closeMap());
mfx.addEventListener('mousedown', () => { MAPV.drag = true; });
addEventListener('mouseup', () => { MAPV.drag = false; });
addEventListener('mousemove', (e) => { // drag to slide the map under the camera
  if (!mapOpen || !MAPV.drag) return;
  const mpp = (2 * Math.tan(0.3316) * 31300 * MAPV.zoom) / innerHeight;
  MAPV.tx = clamp(MAPV.tx + (e.movementX || 0) * mpp, -HALFX - 3000, HALFX + 3000); MAPV.tz = clamp(MAPV.tz + (e.movementY || 0) * mpp * 1.2, -HALFZ - 1500, HALFZ + 1500);
});
mfx.addEventListener('wheel', (e) => { MAPV.zoom = clamp(MAPV.zoom * (e.deltaY > 0 ? 1.1 : 0.91), 0.045, 1.4); e.preventDefault(); }, { passive: false });
function mproj(x, y, z) { _mv.set(x, y, z).project(camera); return [(_mv.x * 0.5 + 0.5) * innerWidth, (-_mv.y * 0.5 + 0.5) * innerHeight]; }
// neighbourhood names, taken from the city itself at a spread of points; the boroughs and rivers round it are placed by hand
const MAPLBL = (() => {
  const out = [], seen = new Set();
  for (const [i, j] of [[6.5, 0.6], [6.5, 7], [10, 16], [4, 16], [9.5, 21.5], [4, 21.5], [9, 26], [3, 26], [11, 35], [7, 35], [2.5, 35], [11, 46], [7, 46], [2.5, 46], [11, 56], [7, 56], [2, 56], [12, 74], [5.5, 81], [1.5, 74], [8, 72.5], [7.5, 112], [11.5, 112], [2.5, 105], [1.5, 131], [11.5, 145], [5, 146], [11, 168], [5, 168], [9.5, 208], [10, 246]]) {
    const x = -HALFX + i * BX, z = -HALFZ + j * BZ, n = world.zoneAt(x, z); if (n && !seen.has(n)) { seen.add(n); out.push([x, z, n, /^(FINANCIAL|MIDTOWN|CENTRAL|HARLEM|WASHINGTON|GREENWICH|UPPER)/.test(n) ? 1 : 0]); }
  }
  return out.concat([[-3500, STZ(30), 'BROOKLYN', 2], [-3500, STZ(105), 'QUEENS', 2], [-3200, STZ(215), 'THE BRONX', 2], [4000, STZ(110), 'NEW JERSEY', 2], [600, -HALFZ - 1900, 'THE HARBOR', 2], [HALFX + 640, STZ(150), 'HUDSON RIVER', 2], [-HALFX - 320, STZ(60), 'EAST RIVER', 2]]);
})();
function drawMapFx(a) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2), W = innerWidth, H = innerHeight;
  if (mfx.width !== Math.round(W * dpr) || mfx.height !== Math.round(H * dpr)) { mfx.width = Math.round(W * dpr); mfx.height = Math.round(H * dpr); }
  mg.setTransform(dpr, 0, 0, dpr, 0, 0); mg.clearRect(0, 0, W, H);
  if (a <= 0) return;
  camera.updateMatrixWorld();
  mg.globalAlpha = a; mg.textAlign = 'center'; mg.textBaseline = 'middle'; mg.lineJoin = 'round';
  const text = (t, x, y, px, col, sp = 3) => { mg.font = `700 ${px}px "Barlow Condensed", "Arial Narrow", sans-serif`; try { mg.letterSpacing = sp + 'px'; } catch (_) {} mg.lineWidth = 4; mg.strokeStyle = 'rgba(5,9,16,0.85)'; mg.strokeText(t, x, y); mg.fillStyle = col; mg.fillText(t, x, y); };
  const Z = MAPV.zoom;
  for (const [x, z, name, rank] of MAPLBL) { if (rank === 0 ? Z > 0.17 : rank === 1 && Z > 0.7) continue; const p = mproj(x, 0, z); if (p[0] < -80 || p[0] > W + 80 || p[1] < -20 || p[1] > H + 20) continue; text(name, p[0], p[1], rank === 2 ? 15 : 12, rank === 2 ? 'rgba(190,225,255,0.75)' : 'rgba(255,255,255,0.72)', 3); }
  if (Z < 0.5) for (const s of SHOPS) { // the shops you can walk into
    const p = mproj(s.x, 30, s.z);
    mg.beginPath(); mg.arc(p[0], p[1], 9, 0, TAU); mg.fillStyle = '#0b1220'; mg.fill(); mg.lineWidth = 2; mg.strokeStyle = s.css; mg.stroke();
    mg.font = '700 11px "Barlow Condensed", sans-serif'; try { mg.letterSpacing = '0px'; } catch (_) {} mg.fillStyle = s.css; mg.fillText(s.name[0], p[0], p[1] + 1);
    text(s.name, p[0], p[1] + 19, 11, '#fff', 1.5);
  }
  if (QUEST.mark && QUEST.step < 7) { // the story objective
    const p = mproj(QUEST.at.x, QUEST.at.y + 20, QUEST.at.z), r = 8 + Math.sin(performance.now() * 0.005) * 2;
    mg.save(); mg.translate(p[0], p[1] - 26); mg.rotate(Math.PI / 4); mg.fillStyle = '#2ef2ff'; mg.strokeStyle = '#0b1220'; mg.lineWidth = 2.5; mg.beginPath(); mg.rect(-r, -r, 2 * r, 2 * r); mg.stroke(); mg.fill(); mg.restore();
    text('STORY', p[0], p[1] - 46, 12, '#2ef2ff', 3);
  }
  if (MAPV.sel >= 0) { // only the trial that was picked shows its route
    const T = TRIALS[MAPV.sel], sx = T.start ? T.start[0] : spawnPos.x, sz = T.start ? T.start[1] : spawnPos.z, sy = topAt(sx, sz), len = Math.hypot(T.goal[0] - sx, T.goal[2] - sz);
    mg.setLineDash([9, 7]); mg.lineWidth = 3; mg.strokeStyle = '#ffb14a'; mg.beginPath();
    for (let i = 0; i <= 32; i++) { const t = i / 32, p = mproj(sx + (T.goal[0] - sx) * t, sy + (T.goal[1] - sy) * t + Math.sin(t * Math.PI) * len * 0.22, sz + (T.goal[2] - sz) * t); if (i) mg.lineTo(p[0], p[1]); else mg.moveTo(p[0], p[1]); }
    mg.stroke(); mg.setLineDash([]);
    const g = mproj(T.goal[0], T.goal[1], T.goal[2]), s0 = mproj(sx, sy, sz);
    mg.save(); mg.translate(g[0], g[1]); mg.rotate(Math.PI / 4); mg.fillStyle = '#ffb14a'; mg.strokeStyle = '#0b1220'; mg.lineWidth = 2.5; mg.beginPath(); mg.rect(-7, -7, 14, 14); mg.stroke(); mg.fill(); mg.restore();
    mg.beginPath(); mg.arc(s0[0], s0[1], 11, 0, TAU); mg.fillStyle = '#2ef2ff'; mg.fill(); mg.font = '700 14px "Barlow Condensed", sans-serif'; mg.fillStyle = '#06121a'; mg.fillText(String(MAPV.sel + 1), s0[0], s0[1] + 1);
    text(T.name + '  ·  ' + Math.round(len) + ' M', g[0], g[1] - 22, 13, '#ffb14a', 2);
  }
  { // you
    const p = mproj(P.pos.x, P.pos.y, P.pos.z), f = mproj(P.pos.x + P.facing.x * 80, P.pos.y, P.pos.z + P.facing.z * 80);
    mg.save(); mg.translate(p[0], p[1]); mg.rotate(Math.atan2(f[0] - p[0], -(f[1] - p[1])));
    mg.beginPath(); mg.moveTo(0, -12); mg.lineTo(8.5, 9); mg.lineTo(0, 4); mg.lineTo(-8.5, 9); mg.closePath(); mg.fillStyle = '#fff'; mg.strokeStyle = '#0b1220'; mg.lineWidth = 3; mg.stroke(); mg.fill(); mg.restore();
    text('YOU', p[0], p[1] + 22, 11, '#fff', 3);
  }
  mg.globalAlpha = 1;
}
function mapCamera(dt) {
  const to = mapOpen ? 1 : 0;
  if (MAPV.k === 0 && !to) return;
  MAPV.k += (to - MAPV.k) * (1 - Math.exp(-dt * 4.2)); if (Math.abs(to - MAPV.k) < 0.003) MAPV.k = to;
  const e = smooth(MAPV.k), D = 17500 * MAPV.zoom, H = 26000 * MAPV.zoom;
  _mq.copy(camera.quaternion); _mp.copy(camera.position);
  const ox = MAPV.tx - (innerWidth / innerHeight > 1.3 ? 3400 * MAPV.zoom : 0), oz = MAPV.tz;   // what you are looking at sits left of the trial cards
  camera.position.set(ox, H, oz - D); camera.lookAt(ox, 0, oz); _mq2.copy(camera.quaternion);
  camera.position.lerpVectors(_mp, camera.position, e); camera.quaternion.slerpQuaternions(_mq, _mq2, e);
  camera.fov += (38 - camera.fov) * e;
  camera.near = 0.25 + (4 + 40 * MAPV.zoom) * e; camera.far = 14000 + 130000 * e; camera.updateProjectionMatrix();   // from this far up the depth range has to move out with the camera
  setHaze(1 - 0.972 * e);
  renderer.toneMappingExposure = TOD[todIdx].exp * (1 + (todIdx === 2 ? 0.9 : 1.5) * e);   // rooftops seen from above need more light than the street view
  drawMapFx(clamp((MAPV.k - 0.6) / 0.35, 0, 1));
}

// ---------------------------------------------------------------- shops you can walk into
const LC = (h) => { const c = new THREE.Color(h); return [c.r, c.g, c.b]; };
const F0 = -300, RW = 6.5, RD = 11, RH = 3.9;   // interiors sit in their own sealed rooms far below the street
let srs = 12345; const sr = () => ((srs = (srs * 1664525 + 1013904223) >>> 0) / 4294967296), srr = (a, b) => a + (b - a) * sr();
function pb(B, x0, x1, y0, y1, z0, z1, col, k = 1) { // a box with its lighting baked in
  const v = (i) => [i & 1 ? x1 : x0, i & 2 ? y1 : y0, i & 4 ? z1 : z0];
  const f = (a, b, c, d, s) => { for (const i of [a, b, c, a, c, d]) { const p = v(i); B.p.push(p[0], p[1], p[2]); B.c.push(col[0] * s * k, col[1] * s * k, col[2] * s * k); } };
  f(2, 6, 7, 3, 1); f(0, 1, 5, 4, 0.72); f(0, 4, 6, 2, 0.8); f(1, 3, 7, 5, 0.8); f(0, 2, 3, 1, 0.9); f(4, 5, 7, 6, 0.9);
}
const SHOPDEF = {
  bodega: { keeper: 'MARA', col: 0xffb14a, shirt: [0.55, 0.12, 0.14], pants: [0.1, 0.11, 0.16], skin: 0.55, hair: 0.05, chat: ['Swing safe out there. And wipe your feet next time.', 'Coffee is a dollar. Advice is free.', 'The cat runs this place. I just work the till.'] },
  pizza: { keeper: 'NICO', col: 0xff4b3a, shirt: [0.9, 0.9, 0.88], pants: [0.12, 0.12, 0.13], skin: 0.3, hair: 0.2, chat: ['Best slice below Midtown. Ask anybody.', 'You want speed? Eat carbs.', 'Oven has been burning since my grandfather lit it.'] },
  coffee: { keeper: 'AKI', col: 0x7fe3c4, shirt: [0.16, 0.3, 0.26], pants: [0.2, 0.17, 0.14], skin: 0.2, hair: 0.02, chat: ['Kumo means cloud. Fitting, for you.', 'One flat white, fast as you like.', 'You track rain in here and you mop it.'] },
  optics: { keeper: 'JUNO', col: 0xb58cff, shirt: [0.2, 0.16, 0.36], pants: [0.08, 0.08, 0.1], skin: 0.7, hair: 0.0, chat: ['Lenses, prints, repairs. No selfie sticks.', 'The light at golden hour does half my job.', 'Bring me a shot from up high some time.'] },
};
const roomMat = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: false });
const doorGlass = new THREE.MeshStandardMaterial({ color: 0x9fd0e6, roughness: 0.08, metalness: 0.5, transparent: true, opacity: 0.38 });
const doorFrame = new THREE.MeshStandardMaterial({ color: 0x14171c, roughness: 0.5, metalness: 0.6 });
function signTex(name, css) {
  const cv = document.createElement('canvas'); cv.width = 1024; cv.height = 192; const g = cv.getContext('2d'), t = new THREE.CanvasTexture(cv);
  const draw = () => {
    g.fillStyle = '#0d1016'; g.fillRect(0, 0, 1024, 192); g.strokeStyle = css; g.lineWidth = 8; g.strokeRect(10, 10, 1004, 172);
    g.font = 'italic 800 118px "Barlow Condensed", "Arial Narrow", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = css; g.shadowColor = css; g.shadowBlur = 22; g.fillText(name, 512, 102, 960); g.shadowBlur = 0; t.needsUpdate = true;
  };
  draw(); if (document.fonts && document.fonts.ready) document.fonts.ready.then(draw);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
function buildRoom(s) {
  const B = { p: [], c: [] }, d = s.d, X = (u) => s.x - d * u, Z = (w) => s.z + d * w, T = s.type;
  const rb = (u0, u1, y0, y1, w0, w1, col, k = 1, solid = false) => {
    const x0 = Math.min(X(u0), X(u1)), x1 = Math.max(X(u0), X(u1)), z0 = Math.min(Z(w0), Z(w1)), z1 = Math.max(Z(w0), Z(w1));
    pb(B, x0, x1, F0 + y0, F0 + y1, z0, z1, col, k); if (solid) addBox(x0, x1, F0 + y0, F0 + y1, z0, z1).prop = true;
  };
  const PAL = {
    bodega: { wall: LC(0xe9dfb4), low: LC(0x3f7a52), fa: LC(0xb9b9b4), fb: LC(0x8d8f90), ceil: LC(0xe8e6de), top: LC(0x7a5a3c), front: LC(0x9a3a2e) },
    pizza: { wall: LC(0xf1e4c6), low: LC(0xb3261e), fa: LC(0xd9d2c4), fb: LC(0x9c2a22), ceil: LC(0xeee6d2), top: LC(0xd8d2c6), front: LC(0x2c5a3a) },
    coffee: { wall: LC(0xe6e2d6), low: LC(0x8aa58f), fa: LC(0x9a6a40), fb: LC(0x86592f), ceil: LC(0xf0ece2), top: LC(0xc9a070), front: LC(0x2a2f33) },
    optics: { wall: LC(0x1c2236), low: LC(0x12162a), fa: LC(0x24272e), fb: LC(0x1c1f25), ceil: LC(0x151a28), top: LC(0xe8e8ee), front: LC(0x2b2f45) },
  }[T];
  // shell
  rb(-RW - 1, RW + 1, -1, 0, -1, RD + 1, PAL.fa, 1, true); rb(-RW - 1, RW + 1, RH, RH + 1, -1, RD + 1, PAL.ceil, 1.25, true);
  rb(-RW - 1, -RW, 0, RH, -1, RD + 1, PAL.wall, 1, true); rb(RW, RW + 1, 0, RH, -1, RD + 1, PAL.wall, 1, true);
  rb(-RW, RW, 0, RH, RD, RD + 1, PAL.wall, 1, true); rb(-RW, RW, 0, RH, -1, 0, PAL.wall, 1, true);
  for (let i = 0; i < 13; i++) for (let j = 0; j < 11; j++) { // floor: tiles or boards
    const wood = T === 'coffee', c = wood ? (j % 2 ? PAL.fa : PAL.fb) : (i + j) % 2 ? PAL.fa : PAL.fb, kk = wood ? srr(0.85, 1.08) : 1;
    const x0 = Math.min(X(-RW + i), X(-RW + i + 1)), z0 = Math.min(Z(j), Z(j + 1)), y = F0 + 0.004;
    for (const [px, pz] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) { B.p.push(x0 + px, y, z0 + pz); B.c.push(c[0] * kk, c[1] * kk, c[2] * kk); }
  }
  rb(-RW, -RW + 0.03, 0, 1.05, 0, RD, PAL.low); rb(RW - 0.03, RW, 0, 1.05, 0, RD, PAL.low); rb(-RW, RW, 0, 1.05, RD - 0.03, RD, PAL.low); rb(-RW, RW, 0, 1.05, 0, 0.03, PAL.low);
  rb(-RW, RW, 1.05, 1.11, RD - 0.05, RD, LC(0xffffff), 0.8); rb(-RW, -RW + 0.05, 1.05, 1.11, 0, RD, LC(0xffffff), 0.8); rb(RW - 0.05, RW, 1.05, 1.11, 0, RD, LC(0xffffff), 0.8);
  // the way out: a bright glass door to the street, with a sign over it
  rb(-1.55, 1.55, 0, 2.85, 0, 0.07, LC(0x15181d)); rb(-1.35, -0.03, 0.06, 2.7, 0.07, 0.09, LC(0xcfe6ff), 2.3); rb(0.03, 1.35, 0.06, 2.7, 0.07, 0.09, LC(0xcfe6ff), 2.3);
  rb(-0.5, 0.5, 2.95, 3.2, 0, 0.06, LC(0x35ff7a), 2.6);
  for (const [u, w] of [[-3.2, 3], [3.2, 3], [-3.2, 8], [3.2, 8], [0, 5.5]]) rb(u - 0.7, u + 0.7, RH - 0.05, RH, w - 0.22, w + 0.22, T === 'optics' ? LC(0xc9b8ff) : LC(0xfff0cf), T === 'optics' ? 3 : 3.4);
  // counter, with whoever runs the place behind it
  rb(-4.3, 1.6, 0, 1.02, 6.2, 7.0, PAL.front, 1, true); rb(-4.4, 1.7, 1.02, 1.09, 6.1, 7.1, PAL.top, 1.15);
  rb(0.5, 1.2, 1.09, 1.42, 6.35, 6.85, LC(0x23262b)); rb(0.56, 1.14, 1.3, 1.4, 6.34, 6.36, LC(0x7dffb0), 2.2);   // the till
  rb(-4.6, 2.2, 2.25, 3.35, RD - 0.07, RD, LC(0x14161b));                                                          // menu board
  for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) rb(-4.3 + i * 1.65, -4.3 + i * 1.65 + srr(0.7, 1.35), 3.12 - j * 0.24, 3.2 - j * 0.24, RD - 0.09, RD - 0.07, j === 0 ? LC(s.def.col) : LC(0xf2ead8), j === 0 ? 2.2 : 1.3);
  const stool = (u, w) => { rb(u - 0.05, u + 0.05, 0, 0.62, w - 0.05, w + 0.05, LC(0x2a2c30)); rb(u - 0.2, u + 0.2, 0.62, 0.7, w - 0.2, w + 0.2, PAL.low, 1.1); };
  const table = (u, w, r = 0.55) => { rb(u - 0.07, u + 0.07, 0, 0.74, w - 0.07, w + 0.07, LC(0x2a2c30), 1, true); rb(u - r, u + r, 0.74, 0.8, w - r, w + r, PAL.top, 1.1); };
  const goods = (u0, u1, y, w0, w1, n, h = 0.26) => { for (let i = 0; i < n; i++) { const t = i / n, c = [srr(0.15, 1), srr(0.15, 1), srr(0.15, 1)]; rb(u0 + (u1 - u0) * (t + 0.08 / n), u0 + (u1 - u0) * (t + 0.9 / n), y, y + h * srr(0.6, 1), w0 + (w1 - w0) * (t + 0.08 / n), w0 + (w1 - w0) * (t + 0.9 / n), c, 0.95); } };
  if (T === 'bodega') {
    for (const u of [3.0]) { rb(u - 0.4, u + 0.4, 0, 1.9, 1.6, 5.4, LC(0x8a8d92), 1, true); for (let l = 0; l < 4; l++) for (const sd of [-1, 1]) for (let i = 0; i < 12; i++) { const w = 1.7 + i * 0.3, c = [srr(0.15, 1), srr(0.15, 1), srr(0.15, 1)]; rb(u + sd * 0.4, u + sd * 0.56, 0.18 + l * 0.45, 0.18 + l * 0.45 + srr(0.18, 0.32), w, w + 0.24, c); } }
    for (let l = 0; l < 5; l++) { rb(-RW + 0.03, -RW + 0.45, 0.5 + l * 0.52, 0.54 + l * 0.52, 0.8, 5.6, LC(0x9a7b55)); for (let i = 0; i < 16; i++) { const w = 0.9 + i * 0.29, c = [srr(0.15, 1), srr(0.15, 1), srr(0.15, 1)]; rb(-RW + 0.08, -RW + 0.36, 0.54 + l * 0.52, 0.54 + l * 0.52 + srr(0.16, 0.34), w, w + 0.23, c); } }
    rb(RW - 0.75, RW - 0.03, 0, 2.45, 1.2, 9.6, LC(0x2d3238), 1, true);                                             // the drinks fridge
    for (let i = 0; i < 5; i++) { rb(RW - 0.79, RW - 0.75, 0.25, 2.3, 1.35 + i * 1.66, 2.85 + i * 1.66, LC(0xbfeaff), 1.7); for (let l = 0; l < 4; l++) for (let j = 0; j < 5; j++) rb(RW - 0.81, RW - 0.79, 0.4 + l * 0.47, 0.66 + l * 0.47, 1.45 + i * 1.66 + j * 0.27, 1.63 + i * 1.66 + j * 0.27, [srr(0.2, 1), srr(0.2, 1), srr(0.2, 1)], 1.3); }
    goods(-4.1, -2.3, 1.09, 6.25, 6.5, 7, 0.22);
    // the cat that owns the counter
    const cat = LC(0xd98a3a); rb(-0.5, 0.05, 1.09, 1.27, 6.4, 6.62, cat); rb(0.0, 0.2, 1.2, 1.4, 6.42, 6.6, cat); rb(0.02, 0.07, 1.4, 1.46, 6.44, 6.48, cat); rb(0.13, 0.18, 1.4, 1.46, 6.44, 6.48, cat); rb(-0.72, -0.5, 1.09, 1.13, 6.56, 6.6, cat);
    rb(-RW + 0.05, -RW + 0.09, 1.6, 3.1, 6.2, 9.6, LC(0xffd35a), 1.4);                                              // a faded poster wall behind the till
  } else if (T === 'pizza') {
    rb(2.6, 5.9, 0, 2.5, 9.3, RD, LC(0x8a4a32), 1, true); rb(3.4, 5.1, 0.95, 1.55, 9.24, 9.3, LC(0xff8a2a), 3.4); rb(3.2, 5.3, 1.55, 1.75, 9.2, 9.3, LC(0x5a2f20)); rb(4.0, 4.5, 2.5, RH, 9.9, 10.4, LC(0x33363a));
    rb(-3.9, -1.9, 1.09, 1.5, 6.3, 6.9, LC(0xbfe6ff), 1.5); for (let i = 0; i < 3; i++) { rb(-3.8 + i * 0.64, -3.3 + i * 0.64, 1.12, 1.15, 6.35, 6.85, LC(0xe8b04a), 1.2); rb(-3.74 + i * 0.64, -3.36 + i * 0.64, 1.15, 1.16, 6.4, 6.8, LC(0xc92a1e), 1.2); }
    for (let i = 0; i < 4; i++) rb(-1.3, -0.7, 1.09 + i * 0.06, 1.14 + i * 0.06, 6.3, 6.9, LC(0xe9dcc0), 1 - i * 0.03);     // boxed pies, ready to go
    for (const [u, w] of [[3.9, 2.4], [3.9, 5.0], [-4.4, 2.6]]) { table(u, w, 0.62); stool(u - 1.05, w); stool(u + 1.05, w); }
    rb(-RW + 0.04, -RW + 0.08, 1.5, 2.9, 1.2, 4.4, LC(0x1a1c20)); for (let i = 0; i < 3; i++) rb(-RW + 0.08, -RW + 0.1, 1.65 + (i % 2) * 0.55, 2.15 + (i % 2) * 0.55, 1.4 + i * 1.0, 2.2 + i * 1.0, [srr(0.4, 1), srr(0.3, 0.8), srr(0.2, 0.6)], 1.1);
    rb(-RW + 0.2, RW - 0.2, 3.5, 3.56, RD - 0.12, RD - 0.07, LC(0xff3b2a), 3);
  } else if (T === 'coffee') {
    rb(-4.6, 2.2, 0, 0.95, 10.2, RD, LC(0x7a5632), 1, true); rb(-4.7, 2.3, 0.95, 1.0, 10.1, RD, PAL.top, 1.1);
    rb(-2.6, -1.2, 1.0, 1.52, 10.3, 10.85, LC(0xc8ccd2), 1.1); rb(-2.5, -1.3, 1.52, 1.6, 10.35, 10.8, LC(0x2a2c30)); for (let i = 0; i < 5; i++) rb(-0.6 + i * 0.3, -0.42 + i * 0.3, 1.0, 1.16, 10.4, 10.58, LC(0xf5f2ea), 1.1);
    rb(-3.9, -2.1, 1.09, 1.48, 6.3, 6.9, LC(0xcdeeff), 1.5); goods(-3.8, -2.2, 1.12, 6.4, 6.8, 6, 0.14);
    for (const [u, w] of [[3.8, 2.2], [3.8, 4.6], [3.8, 8.6], [-4.6, 2.4]]) { table(u, w, 0.45); stool(u - 0.85, w); stool(u + 0.85, w); rb(u - 0.02, u + 0.02, 2.7, RH, w - 0.02, w + 0.02, LC(0x222428)); rb(u - 0.2, u + 0.2, 2.5, 2.72, w - 0.2, w + 0.2, LC(0xffd9a0), 3.2); }
    for (const [u, w] of [[-5.8, 0.7], [5.8, 0.7], [5.8, 10.3]]) { rb(u - 0.28, u + 0.28, 0, 0.55, w - 0.28, w + 0.28, LC(0xb9a58a)); for (let i = 0; i < 5; i++) rb(u - srr(0.1, 0.42), u + srr(0.1, 0.42), 0.55 + i * 0.28, 0.9 + i * 0.28, w - srr(0.1, 0.42), w + srr(0.1, 0.42), LC(0x3f8a4a), srr(0.8, 1.15)); }
    for (const [du, dy, r] of [[0, 0, 0.5], [-0.55, -0.12, 0.36], [0.6, -0.1, 0.4], [0.2, 0.26, 0.34]]) rb(3.9 + du - r, 3.9 + du + r, 2.3 + dy - r * 0.6, 2.3 + dy + r * 0.6, RD - 0.1, RD - 0.03, LC(0xffffff), 1.5);   // the cloud on the wall
  } else {
    for (const sd of [-1, 1]) { rb(sd * (RW - 0.85), sd * (RW - 0.05), 0, 0.95, 1.4, 5.6, LC(0x2b2f45), 1, true); rb(sd * (RW - 0.9), sd * RW, 0.95, 1.3, 1.35, 5.65, LC(0xbfd8ff), 1.5); for (let i = 0; i < 6; i++) { const w = 1.6 + i * 0.68; rb(sd * (RW - 0.62), sd * (RW - 0.3), 1.0, 1.2, w, w + 0.36, LC(0x16181c)); rb(sd * (RW - 0.74), sd * (RW - 0.62), 1.03, 1.17, w + 0.1, w + 0.26, LC(0x3a4252), 1.4); } }
    for (let i = 0; i < 5; i++) for (let j = 0; j < 2; j++) { const w = 6.4 + i * 0.9, y = 1.45 + j * 0.95; rb(RW - 0.07, RW - 0.03, y, y + 0.75, w, w + 0.7, LC(0xf2f2f2), 1.2); rb(RW - 0.09, RW - 0.07, y + 0.06, y + 0.69, w + 0.06, w + 0.64, [srr(0.15, 1), srr(0.15, 0.9), srr(0.25, 1)], 1.25); }
    rb(-4.6, 2.2, 0, 0.95, 10.2, RD, LC(0x2b2f45), 1, true); rb(-3.6, -1.6, 0.95, 1.55, 10.25, 10.9, LC(0xeceef2), 1.1); rb(-3.4, -1.8, 1.2, 1.24, 9.7, 10.25, LC(0xffffff), 1.6); rb(-3.3, -1.9, 1.24, 1.25, 9.75, 10.2, LC(0xff9a4a), 1.3);
    rb(-5.4, -5.34, 0, 1.5, 8.9, 8.96, LC(0x1a1c20)); rb(-5.0, -4.94, 0, 1.5, 9.5, 9.56, LC(0x1a1c20)); rb(-5.75, -5.69, 0, 1.5, 9.5, 9.56, LC(0x1a1c20)); rb(-5.55, -5.15, 1.5, 1.78, 9.1, 9.5, LC(0x16181c)); rb(-5.45, -5.25, 1.55, 1.73, 8.9, 9.1, LC(0x3a4252), 1.5);
    rb(-RW + 0.2, RW - 0.2, 3.5, 3.56, RD - 0.12, RD - 0.07, LC(0xb58cff), 3); rb(-RW + 0.04, -RW + 0.07, 3.5, 3.56, 0.2, RD - 0.2, LC(0xb58cff), 3);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(B.c, 3));
  const room = new THREE.Group(), mesh = new THREE.Mesh(g, roomMat); room.add(mesh); room.visible = false; scene.add(room);
  // people
  const fig = (shirt, pants, skin, hair, u, w, face) => { const m = makeFigure(shirt, pants, skin, hair, 0.5); m.position.set(X(u), F0, Z(w)); m.rotation.y = face; m.userData.y0 = face; room.add(m); return m; };
  const out = d > 0 ? Math.PI : 0;                                    // facing the street door
  s.keeper = fig(s.def.shirt, s.def.pants, s.def.skin, s.def.hair, -1.2, 8.0, out);
  s.folk = [];
  if (T === 'pizza') s.folk.push(fig([0.2, 0.35, 0.7], [0.16, 0.16, 0.2], 0.6, 0.1, 3.9, 3.6, out + 2.2), fig([0.75, 0.6, 0.2], [0.2, 0.22, 0.3], 0.15, 0.5, -4.4, 3.7, out + 1.2));
  if (T === 'coffee') s.folk.push(fig([0.8, 0.8, 0.82], [0.14, 0.2, 0.3], 0.4, 0.3, 3.8, 3.4, out - 1.4), fig([0.6, 0.2, 0.3], [0.1, 0.1, 0.12], 0.8, 0.0, 0.6, 9.3, out + 0.6));
  if (T === 'bodega') s.folk.push(fig([0.3, 0.5, 0.35], [0.3, 0.28, 0.24], 0.25, 0.7, 2.0, 3.4, out - 1.57));
  if (T === 'optics') s.folk.push(fig([0.85, 0.5, 0.2], [0.12, 0.14, 0.2], 0.5, 0.15, 4.6, 7.2, out - 1.57));
  s.room = room;
}
function buildDoor(s) {
  const g = new THREE.Group(); g.position.set(s.x, 0.25, s.z); g.rotation.y = s.nz > 0 ? 0 : Math.PI; scene.add(g);
  const add = (geo, mat, x, y, z) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); g.add(m); return m; };
  add(new THREE.BoxGeometry(3.7, 3.35, 0.36), doorFrame, 0, 1.675, 0.1);
  add(new THREE.PlaneGeometry(2.7, 2.75), new THREE.MeshBasicMaterial({ color: new THREE.Color(s.def.col).lerp(new THREE.Color(0xfff2d8), 0.72) }), 0, 1.42, 0.285);
  s.leaf = [add(new THREE.BoxGeometry(1.34, 2.72, 0.05), doorGlass, -0.68, 1.42, 0.33), add(new THREE.BoxGeometry(1.34, 2.72, 0.05), doorGlass, 0.68, 1.42, 0.33)];
  const aw = add(new THREE.BoxGeometry(4.6, 0.1, 1.7), new THREE.MeshLambertMaterial({ color: s.def.col }), 0, 3.55, 1.0); aw.rotation.x = 0.24; aw.castShadow = true;
  add(new THREE.BoxGeometry(4.6, 0.34, 0.05), new THREE.MeshLambertMaterial({ color: new THREE.Color(s.def.col).multiplyScalar(0.7) }), 0, 3.2, 1.83);
  add(new THREE.PlaneGeometry(4.5, 0.84), new THREE.MeshBasicMaterial({ map: signTex(s.name, s.css) }), 0, 4.42, 0.3);
  s.ring = add(new THREE.RingGeometry(0.95, 1.12, 40).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: s.def.col, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }), 0, 0.03, 1.9);
  s.gem = add(new THREE.OctahedronGeometry(1, 0), new THREE.MeshBasicMaterial({ color: s.def.col }), 0, 6.3, 0.9); s.gem.scale.set(0.42, 0.7, 0.42);
}
const SHOPS = world.shops.map((w) => { const def = SHOPDEF[w.type], s = { name: w.name, type: w.type, x: w.x, z: w.z, nz: w.nz, d: -w.nz, def, css: '#' + new THREE.Color(def.col).getHexString(), open: 0, chat: 0, tipped: false }; buildDoor(s); buildRoom(s); return s; });
const shopOf = (type) => SHOPS.find((s) => s.type === type);
let shopIn = null;
const wipeEl = document.getElementById('wipe'), transit = { on: false, t: 0, half: false, fn: null };
function startTransit(fn) { transit.on = true; transit.t = 0; transit.half = false; transit.fn = fn; wipeEl.classList.add('on'); }
function placeHero(x, y, z, yaw) {
  P.pos.set(x, y, z); P.prev.copy(P.pos); P.rpos.copy(P.pos); P.vel.set(0, 0, 0); P.state = 'ground'; P.trick = null; P.zip = null; P.landT = P.rollT = P.skimT = P.launchT = 0;
  C.yaw = C.yawT = yaw; C.pitch = C.pitchT = -0.06; C.cine = 0; resetCam(); P.facing.set(Math.sin(yaw), 0, Math.cos(yaw)); P.fy = yaw;
}
function enterShop(s) {
  P.facing.set(0, 0, -s.nz); P.fy = Math.atan2(0, -s.nz);
  tone('sine', 1320, 1320, 0.5, 0.12, { send: 0.4 }); tone('sine', 1760, 1760, 0.7, 0.1, { delay: 0.16, send: 0.4 });
  startTransit(() => { shopIn = s; s.room.visible = true; s.tipped = false; placeHero(s.x, F0 + HY + 0.02, s.z + s.d * 3.1, s.d > 0 ? 0 : Math.PI); flash(s.name); });
}
function exitShop() {
  const s = shopIn; if (!s) return;
  startTransit(() => { shopIn = null; s.room.visible = false; placeHero(s.x, 0.25 + HY + 0.05, s.z + s.nz * 2.3, s.nz > 0 ? 0 : Math.PI); life.refresh(); storyOnExit(s); });
}
function leaveShopNow() { if (shopIn) { shopIn.room.visible = false; shopIn = null; } transit.on = false; wipeEl.classList.remove('on'); closeDlg(); }

// ---------------------------------------------------------------- talking: a line at a time, typed out
const dlg = { on: false, lines: [], i: 0, shown: 0, after: null }, dlgEl = document.getElementById('dlg');
function say(lines, after) { dlg.on = true; dlg.lines = lines; dlg.i = 0; dlg.shown = 0; dlg.after = after || null; dlgEl.classList.add('show'); document.getElementById('dname').textContent = lines[0][0]; document.getElementById('dtext').textContent = ''; }
function closeDlg() { dlg.on = false; dlgEl.classList.remove('show'); }
function advanceDlg() {
  if (!dlg.on) return;
  const L = dlg.lines[dlg.i];
  if (dlg.shown < L[1].length) { dlg.shown = L[1].length; document.getElementById('dtext').textContent = L[1]; return; }
  if (++dlg.i >= dlg.lines.length) { const f = dlg.after; closeDlg(); if (f) f(); return; }
  dlg.shown = 0; document.getElementById('dname').textContent = dlg.lines[dlg.i][0]; document.getElementById('dtext').textContent = '';
}

// ---------------------------------------------------------------- LAST ORDERS: a short story told across the shops
const QTEXT = ['Meet Mara at the CORNER BODEGA', 'Pick up the pizzas at BOROUGH SLICE', 'Get the pizzas to Dex in Madison Square while they are hot', 'Take a skyline photo from the crown of the great Midtown tower', 'Print the photo at PIXEL OPTICS', 'Pick up the coffees at KUMO COFFEE', 'Bring it all back to Mara at the bodega', 'Story complete'];
const QUEST = { step: 0, timer: 0, timing: false, at: new V3(), mark: false, gold: false, trim: false, doneT: 0 };
try { const o = JSON.parse(localStorage.getItem('skythread-story') || '{}') || {}; QUEST.step = clamp(o.step | 0, 0, 7); QUEST.gold = !!o.gold; QUEST.trim = !!o.trim && QUEST.gold; if (QUEST.step === 2) QUEST.step = 1; } catch (_) {}
function saveStory() { try { localStorage.setItem('skythread-story', JSON.stringify({ step: QUEST.step, gold: QUEST.gold, trim: QUEST.trim })); } catch (_) {} }
function setTrim() { M.glow.emissive.set(QUEST.trim ? 0xffc23d : 0x2ef2ff); M.glow.color.set(QUEST.trim ? 0x30220a : 0x062a30); }
function toggleTrim() { if (!QUEST.gold || !started) return; QUEST.trim = !QUEST.trim; setTrim(); saveStory(); flash(QUEST.trim ? 'GOLD THREAD' : 'CYAN THREAD'); }
setTrim();
const CROWN = [cellX(CROWN_CELL[0]), cellZ(CROWN_CELL[1])], DEXP = [world.msq.x + 8, world.msq.z + 6];
const dex = makeFigure([0.95, 0.55, 0.12], [0.14, 0.16, 0.24], 0.45, 0.1); dex.position.set(DEXP[0], topAt(DEXP[0], DEXP[1]), DEXP[1]); scene.add(dex);
{ const tb = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.06, 0.8), new THREE.MeshLambertMaterial({ color: 0xd8d2c6 })); tb.position.set(DEXP[0] + 1.6, dex.position.y + 0.78, DEXP[1] + 0.4); tb.castShadow = true; scene.add(tb);
  const lg = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.75, 0.06), new THREE.MeshLambertMaterial({ color: 0x3a3d42 })); lg.position.set(DEXP[0] + 1.6, dex.position.y + 0.375, DEXP[1] + 0.4); scene.add(lg); }
const bag = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.36, 0.17), new THREE.MeshStandardMaterial({ color: 0xd9622a, roughness: 0.7 })); bag.position.set(0, 0.1, -0.2); bag.castShadow = true; bag.visible = false; R.chest.add(bag);
const qbeacon = new THREE.Group();
{
  const beam = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 420, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x2ef2ff, transparent: true, opacity: 0.22, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  beam.position.y = 210;
  const ring = new THREE.Mesh(new THREE.TorusGeometry(2.2, 0.06, 8, 40).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x9ff8ff, fog: false }));
  qbeacon.add(beam, ring); qbeacon.visible = false; scene.add(qbeacon);
}
const qEl = document.getElementById('quest'), PROMPT = { label: '', fn: null }, promptEl = document.getElementById('prompt');
function questShop() { return [shopOf('bodega'), shopOf('pizza'), null, null, shopOf('optics'), shopOf('coffee'), shopOf('bodega')][QUEST.step] || null; }
function setStep(k) { QUEST.step = k; QUEST.timing = false; saveStory(); if (k < 7) { flash('NEW OBJECTIVE'); tone('sine', 880, 880, 0.14, 0.14, { send: 0.3 }); tone('sine', 1175, 1175, 0.2, 0.14, { delay: 0.11, send: 0.3 }); } }
function reach(x, y, z) { P.reachT = 0.8; P.reachAt.set(x, y, z); }
function counterTalk(s) {
  const k = s.keeper.position, nm = s.def.keeper, qs = questShop() === s, st = QUEST.step;
  P.facing.set(k.x - P.pos.x, 0, k.z - P.pos.z).normalize(); P.fy = Math.atan2(P.facing.x, P.facing.z);
  const take = () => { reach(k.x, F0 + 1.2, (k.z + P.pos.z) / 2); tone('triangle', 520, 780, 0.12, 0.12, { send: 0.2 }); };
  if (qs && st === 0) say([[nm, 'You are the one who keeps swinging past my window. Good. I need fast.'], [nm, 'The block party is tonight and my runner called in sick. Three jobs, all over town.'], [nm, 'First: Borough Slice, six blocks down the avenue. They are holding pizzas for a man named Dex.']], () => setStep(1));
  else if (qs && st === 1) say([[nm, 'Mara’s order? Three pies, still bubbling.'], [nm, 'Dex is setting up in Madison Square, nine blocks up the avenue. Go before they go cold.']], () => { take(); setStep(2); QUEST.timer = 120; QUEST.timing = true; popTrick('PIZZAS ON BOARD'); });
  else if (qs && st === 4) say([[nm, 'Shot from the crown? Nobody gets that angle. Printing it banner-size…'], [nm, 'Done. Tell Mara the frame is on the house.']], () => { take(); setStep(5); popTrick('BANNER PRINTED'); });
  else if (qs && st === 5) say([[nm, 'Two for Mara, extra hot. The lids are on tight — I have seen how you travel.']], () => { take(); setStep(6); popTrick('COFFEE TO GO'); });
  else if (qs && st === 6) say([[nm, 'Pizzas delivered, banner printed, coffee still hot. A whole day’s work in ten minutes.'], [nm, 'The party is on. Look up tonight — that one is for you.']], () => { take(); finale(); });
  else say([[nm, s.def.chat[s.chat++ % s.def.chat.length]]], () => { if (!s.tipped) { s.tipped = true; take(); addStyle(150, 'LOCAL REGULAR'); } });
}
function dexTalk() {
  P.facing.set(dex.position.x - P.pos.x, 0, dex.position.z - P.pos.z).normalize(); P.fy = Math.atan2(P.facing.x, P.facing.z);
  if (QUEST.step === 2) say([['DEX', 'Whoa — did you just drop out of the sky? …And they are still hot. Legend.'], ['DEX', 'Mara wants a skyline shot for the party banner. Best view in town is the crown of the big Midtown tower.']], () => { reach(dex.position.x, dex.position.y + 1.2, dex.position.z); addStyle(1500, 'HOT DELIVERY'); setStep(3); });
  else say([['DEX', QUEST.step < 2 ? 'Tables are up, speakers are up. All I need now is food.' : 'Go on, I have got this corner covered.']]);
}
const shutterEl = document.getElementById('shutter');
function takePhoto() {
  shutterEl.classList.remove('snap'); void shutterEl.offsetWidth; shutterEl.classList.add('snap');
  nz('highpass', 3000, 5000, 0.05, 0.5, {}); nz('highpass', 2500, 4000, 0.06, 0.4, { delay: 0.09 });
  addStyle(1000, 'SKYLINE SHOT'); setStep(4);
}
function storyOnExit(s) { if (QUEST.step === 2 && s.type === 'pizza') flash('GET TO MADISON SQUARE'); }
// fireworks for the finale
const FWN = 1400, fwPos = new Float32Array(FWN * 3), fwVel = new Float32Array(FWN * 3), fwCol = new Float32Array(FWN * 3), fwBase = new Float32Array(FWN * 3), fwLife = new Float32Array(FWN);
const fwGeo = new THREE.BufferGeometry(); fwGeo.setAttribute('position', new THREE.BufferAttribute(fwPos, 3)); fwGeo.setAttribute('color', new THREE.BufferAttribute(fwCol, 3));
const fwPts = new THREE.Points(fwGeo, new THREE.PointsMaterial({ size: 3.2, vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })); fwPts.frustumCulled = false; fwPts.visible = false; scene.add(fwPts);
const FW = { t: 0, next: 0, head: 0 };
function burst() {
  const a = Math.random() * TAU, r = 60 + Math.random() * 150, cx = P.pos.x + Math.sin(a) * r, cy = Math.max(P.pos.y, 40) + 70 + Math.random() * 90, cz = P.pos.z + Math.cos(a) * r, c = new THREE.Color().setHSL(Math.random(), 1, 0.6), sp = 16 + Math.random() * 14;
  for (let i = 0; i < 110; i++) {
    const k = FW.head = (FW.head + 1) % FWN, u = Math.random() * 2 - 1, ph = Math.random() * TAU, s = Math.sqrt(1 - u * u), v = sp * (0.75 + Math.random() * 0.3);
    fwPos[k * 3] = cx; fwPos[k * 3 + 1] = cy; fwPos[k * 3 + 2] = cz; fwVel[k * 3] = s * Math.cos(ph) * v; fwVel[k * 3 + 1] = u * v; fwVel[k * 3 + 2] = s * Math.sin(ph) * v;
    fwBase[k * 3] = c.r * 3; fwBase[k * 3 + 1] = c.g * 3; fwBase[k * 3 + 2] = c.b * 3; fwLife[k] = 1.5 + Math.random() * 0.9;
  }
  thud(0.5); nz('bandpass', 1800, 500, 0.5, 0.25, { q: 0.5, delay: 0.05, send: 0.5 });
}
function finale() {
  QUEST.step = 7; QUEST.gold = true; QUEST.trim = true; QUEST.doneT = 24; saveStory(); setTrim();
  if (todIdx !== 2) applyTOD(2);
  addStyle(10000, 'LAST ORDERS'); flash('STORY COMPLETE · GOLD THREAD UNLOCKED');
  FW.t = 22; FW.next = 2.2; fwPts.visible = true;
  for (let i = 0; i < 5; i++) tone('sine', [523, 659, 784, 1047, 1319][i], [523, 659, 784, 1047, 1319][i], 0.3, 0.16, { delay: i * 0.1, send: 0.5 });
}
function updateFireworks(dt) {
  if (FW.t <= 0) return;
  FW.t -= dt; if (FW.t > 3 && !shopIn && (FW.next -= dt) <= 0) { FW.next = 0.35 + Math.random() * 0.7; burst(); }
  for (let k = 0; k < FWN; k++) {
    if (fwLife[k] <= 0) { fwCol[k * 3] = fwCol[k * 3 + 1] = fwCol[k * 3 + 2] = 0; continue; }
    fwLife[k] -= dt; const o = k * 3, dr = Math.exp(-1.6 * dt), f = clamp(fwLife[k] / 1.1, 0, 1);
    fwVel[o] *= dr; fwVel[o + 1] = fwVel[o + 1] * dr - 7 * dt; fwVel[o + 2] *= dr;
    fwPos[o] += fwVel[o] * dt; fwPos[o + 1] += fwVel[o + 1] * dt; fwPos[o + 2] += fwVel[o + 2] * dt;
    fwCol[o] = fwBase[o] * f; fwCol[o + 1] = fwBase[o + 1] * f; fwCol[o + 2] = fwBase[o + 2] * f;
  }
  fwGeo.attributes.position.needsUpdate = true; fwGeo.attributes.color.needsUpdate = true;
  if (FW.t <= 0) fwPts.visible = false;
}
function findInteract() {
  if (dlg.on || transit.on || TR.phase === 'count' || P.state !== 'ground') return null;
  const p = P.pos;
  if (shopIn) {
    const s = shopIn, u = -(p.x - s.x) * s.d, w = (p.z - s.z) * s.d;
    if (w < 2.2 && Math.abs(u) < 2.0) return ['EXIT TO THE STREET', exitShop];
    if (w > 3.4 && w < 6.2 && Math.abs(u + 1.2) < 2.8) { const q = questShop() === s, st = QUEST.step; return [q && st === 1 ? 'PICK UP THE PIZZAS' : q && st === 4 ? 'PRINT THE PHOTO' : q && st === 5 ? 'PICK UP THE COFFEES' : 'TALK TO ' + s.def.keeper, () => counterTalk(s)]; }
    return null;
  }
  if (p.y < 4) for (const s of SHOPS) if (Math.hypot(p.x - s.x, p.z - (s.z + s.nz * 1.9)) < 2.9) return ['ENTER ' + s.name, () => enterShop(s)];
  if (Math.hypot(p.x - dex.position.x, p.z - dex.position.z) < 4 && Math.abs(p.y - HY - dex.position.y) < 2) return [QUEST.step === 2 ? 'HAND OVER THE PIZZAS' : 'TALK TO DEX', dexTalk];
  if (QUEST.step === 3 && p.y > 362 && Math.hypot(p.x - CROWN[0], p.z - CROWN[1]) < 24) return ['TAKE THE PHOTO', takePhoto];
  return null;
}
function interact() { if (!started || mapOpen || !PROMPT.fn) return false; const f = PROMPT.fn; PROMPT.fn = null; PROMPT.label = ''; promptEl.classList.remove('show'); f(); return true; }
let storyT = 0;
function updateStory(dt) {
  // moving between street and shop
  if (transit.on) { transit.t += dt; if (!transit.half && transit.t > 0.38) { transit.half = true; transit.fn(); wipeEl.classList.remove('on'); } if (transit.t > 0.8) transit.on = false; }
  if (dlg.on) { const L = dlg.lines[dlg.i]; if (dlg.shown < L[1].length) { const a = Math.floor(dlg.shown); dlg.shown = Math.min(L[1].length, dlg.shown + dt * 48); if (Math.floor(dlg.shown) !== a) document.getElementById('dtext').textContent = L[1].slice(0, Math.floor(dlg.shown)); } }
  if (P.reachT > 0) P.reachT -= dt;
  updateFireworks(dt);
  // doors slide open as you come up to them; the people inside turn to look
  for (const s of SHOPS) {
    const dd = Math.hypot(P.pos.x - s.x, P.pos.z - s.z);
    if (dd > 420 || shopIn) { s.gem.visible = false; if (!shopIn) continue; } else { s.gem.visible = true; s.gem.rotation.y = time * 1.4; s.gem.position.y = 6.3 + Math.sin(time * 2 + s.x) * 0.25; }
    if (dd < 60 && !shopIn) { s.open += ((dd < 7.5 && P.pos.y < 6 ? 1 : 0) - s.open) * damp(7, dt); s.leaf[0].position.x = -0.68 - s.open * 1.2; s.leaf[1].position.x = 0.68 + s.open * 1.2; s.ring.material.opacity = 0.5 + Math.sin(time * 4) * 0.3; }
  }
  if (shopIn) {
    const s = shopIn; roomMat.color.setScalar(0.82 / renderer.toneMappingExposure);
    for (const m of [s.keeper, ...s.folk]) {
      const dx = P.pos.x - m.position.x, dz = P.pos.z - m.position.z, near = m === s.keeper || dx * dx + dz * dz < 12;
      m.rotation.y += angDiff(near ? Math.atan2(dx, dz) : m.userData.y0, m.rotation.y) * damp(4, dt);
      m.position.y = F0 + Math.sin(time * 1.7 + m.position.x) * 0.012;
    }
  }
  dex.rotation.y += angDiff(Math.atan2(P.pos.x - dex.position.x, P.pos.z - dex.position.z), dex.rotation.y) * damp(3, dt);
  // the hot-pizza clock
  if (QUEST.timing && QUEST.step === 2 && !dlg.on) { QUEST.timer -= dt; if (QUEST.timer <= 0) { QUEST.timing = false; QUEST.step = 1; saveStory(); popTrick('THE PIZZAS WENT COLD'); flash('PICK UP A FRESH ORDER'); } }
  if (QUEST.doneT > 0) QUEST.doneT -= dt;
  if ((storyT -= dt) > 0) return;
  storyT = 0.08;
  // where the story wants you next
  const st = QUEST.step, qs = questShop(), trial = TR.phase !== 'idle';
  if (st >= 7) QUEST.mark = false;
  else if (qs) { QUEST.at.set(qs.x, 0.3, qs.z + qs.nz * 1.9); QUEST.mark = shopIn !== qs; }
  else if (st === 2) { QUEST.at.set(dex.position.x, dex.position.y + 0.1, dex.position.z); QUEST.mark = true; }
  else { QUEST.at.set(CROWN[0], 372, CROWN[1]); QUEST.mark = true; }
  qbeacon.visible = QUEST.mark && !trial && !shopIn; if (qbeacon.visible) { qbeacon.position.copy(QUEST.at); qbeacon.children[0].material.opacity = 0.2 * clamp((P.pos.distanceTo(QUEST.at) - 10) / 50, 0.12, 1); qbeacon.children[1].position.y = 0.5 + Math.sin(time * 3) * 0.2; }
  bag.visible = st === 2 || st === 6;
  const showQ = !trial && (st < 7 || QUEST.doneT > 0);
  qEl.classList.toggle('on', showQ);
  if (showQ) {
    document.getElementById('qtitle').textContent = st >= 7 ? 'LAST ORDERS · COMPLETE' : 'LAST ORDERS · ' + (st + 1) + ' / 7';
    document.getElementById('qtext').textContent = st >= 7 ? 'Gold thread unlocked — press K to switch your suit trim' : shopIn && shopIn === qs ? 'Talk to ' + qs.def.keeper + ' at the counter' : QTEXT[st];
    const dist = Math.round(Math.hypot(P.pos.x - QUEST.at.x, P.pos.z - QUEST.at.z));
    document.getElementById('qsub').textContent = st >= 7 ? '' : (QUEST.timing ? 'HOT FOR ' + Math.ceil(QUEST.timer) + ' S  ·  ' : '') + (QUEST.mark ? dist + ' M' : '');
    document.getElementById('qsub').classList.toggle('warn', QUEST.timing && QUEST.timer < 25);
  }
  const it = findInteract();
  if (it) { PROMPT.fn = it[1]; if (PROMPT.label !== it[0]) { PROMPT.label = it[0]; document.getElementById('ptext').textContent = it[0]; } promptEl.classList.add('show'); }
  else if (PROMPT.fn || PROMPT.label) { PROMPT.fn = null; PROMPT.label = ''; promptEl.classList.remove('show'); }
}

// ---------------------------------------------------------------- HUD
const $ = (id) => document.getElementById(id);
const hud = { style: $('style'), combo: $('combo'), speed: $('speed'), alt: $('alt'), state: $('state'), reticle: $('reticle'), trick: $('trick'), flash: $('flash'), zone: $('zone'), street: $('street'), fps: $('fps'), gauge: $('gauge') };
const lines = $('lines'), lctx = lines.getContext('2d');
function popTrick(t) { hud.trick.textContent = t; hud.trick.classList.remove('pop'); void hud.trick.offsetWidth; hud.trick.classList.add('pop'); }
function flash(t) { if (!hud.flash) return; hud.flash.textContent = t; hud.flash.classList.remove('pop'); void hud.flash.offsetWidth; hud.flash.classList.add('pop'); }
// minimap: the city round the player is painted into a window that is repainted when they near its edge; each update draws a rotated view of it
const MSC = 0.4, MWIN = 1100, mapCv = document.createElement('canvas');
mapCv.width = mapCv.height = Math.ceil(2 * MWIN * MSC);
let mapCx = 1e9, mapCz = 1e9;
const mini = $('map'), mctx = mini.getContext('2d'), MPX = mini.width;
function drawMini() {
  const c = MPX / 2, range = 220 + clamp((P.pos.y - 40) * 0.6, 0, 280), k = c / range, u = MPX / 180;
  if (Math.hypot(P.pos.x - mapCx, P.pos.z - mapCz) > 380) { mapCx = P.pos.x; mapCz = P.pos.z; world.drawMap(mapCv.getContext('2d'), MSC, mapCx, mapCz, MWIN); }
  mctx.setTransform(1, 0, 0, 1, 0, 0); mctx.clearRect(0, 0, MPX, MPX);
  mctx.save(); mctx.beginPath(); mctx.arc(c, c, c - 1, 0, TAU); mctx.clip();
  mctx.fillStyle = '#12303f'; mctx.fillRect(0, 0, MPX, MPX);
  mctx.translate(c, c); mctx.rotate(C.yaw); mctx.scale(k / MSC, k / MSC);   // camera-forward is up
  mctx.drawImage(mapCv, -(mapCx + MWIN - P.pos.x) * MSC, -(mapCz + MWIN - P.pos.z) * MSC);
  mctx.restore();
  // view cone, then the hero's arrow
  mctx.save(); mctx.translate(c, c);
  const g = mctx.createRadialGradient(0, 0, 0, 0, 0, c * 0.8); g.addColorStop(0, 'rgba(46,242,255,0.28)'); g.addColorStop(1, 'rgba(46,242,255,0)');
  mctx.fillStyle = g; mctx.beginPath(); mctx.moveTo(0, 0); mctx.arc(0, 0, c * 0.8, -Math.PI / 2 - 0.5, -Math.PI / 2 + 0.5); mctx.closePath(); mctx.fill();
  mctx.rotate(-angDiff(Math.atan2(P.facing.x, P.facing.z), C.yaw));
  mctx.beginPath(); mctx.moveTo(0, -9 * u); mctx.lineTo(6.5 * u, 7 * u); mctx.lineTo(0, 3.5 * u); mctx.lineTo(-6.5 * u, 7 * u); mctx.closePath();
  mctx.fillStyle = '#fff'; mctx.strokeStyle = '#0b1220'; mctx.lineWidth = 2 * u; mctx.stroke(); mctx.fill();
  mctx.restore();
  if (TR.phase !== 'idle') miniGoal(c, k, u); else if (QUEST.mark) miniGoal(c, k, u, QUEST.at, '#2ef2ff');
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
P.pos.z = intro.edge - 11.5; P.pos.y = spawnPos.y; P.prev.copy(P.pos); P.rpos.copy(P.pos); P.state = 'ground'; C.yaw = C.yawT = 1.0; resetCam();
document.addEventListener('visibilitychange', () => { skipHitch = true; });
function frame(now) {
  requestAnimationFrame(frame);
$('cta').textContent = 'CLICK TO START';
$('fade').classList.add('out');
  if (dbgFreeze) { last = now; return; }
  const rawDt = (now - last) / 1000;
  const dt = Math.min(0.05, rawDt); last = now; frameNo++;
  if (skipHitch) skipHitch = false; // returning from another tab is not a hitch
  else if (started && rawDt > 1.0 && qIdx < QUALITY.length - 1 && FORCE_Q < 0) {
    if (++hitches >= 2) { hitches = -999; perf.done = true; perf.climb = false; perf.ceil = LADDER.length - 1; setLevel(LADDER.length - 1); }
  }
  const paused = !started || mapOpen || (everLocked && !locked);
  if (!paused) {
    time += dt; acc += dt;
    const h = 1 / 120; let n = 0;
    if (TR.phase === 'count') { acc = 0; ev.jump = ev.swing = ev.zip = false; }   // held on the start line during the countdown
    while (acc >= h && n < 10) { step(h); acc -= h; n++; }
    if (n >= 10) acc = 0;
    P.rpos.copy(P.prev).lerp(P.pos, clamp(acc / h, 0, 1));
    if (ev.trick) { startTrick(ev.trick); ev.trick = null; }
    updateTrial(dt);
    try { updateStory(dt); } catch (e) { reportOnce(e); }
  } else { ev.trick = null; if (!started) { time += dt; introStep(dt); } }
  if (!paused || !started) world.update(dt, time, camera.position.x, camera.position.z, P.pos.x, P.pos.z);
  updateAnim(paused && started ? 0 : dt, time);
  updateCamera(dt, now, time);
  mapCamera(Math.min(rawDt, 0.1));
  const lc = MAPV.k > 0.01 ? P.rpos : camera.position;
  try { life.update(dt, time, lc.x, shopIn ? 2 : lc.y, lc.z, C.yaw, zoneNow === 'CENTRAL PARK' || zoneNow === 'BATTERY PARK'); } catch (e) { reportOnce(e); }
  if ((zipTick = (zipTick + 1) % 3) === 0) computeZip();
  updateRope(paused ? 0 : dt);
  life.setFP(C.fp > 0.5);
  try { updateHUD(dt, rawDt); } catch (e) { reportOnce(e); }
  try { updateAudio(paused ? 0 : dt); } catch (e) { reportOnce(e); }
  autoQuality(Math.min(rawDt, 1));   // real time, so slow frames are measured as slow
  const q = QUALITY[qIdx];
  if (frameNo === 90) world.freeTextureData();
  if (envDirty > 0 && --envDirty === 0 && qIdx <= 2) { try { captureEnv(); } catch (e) { reportOnce(e); } }
  if (dbgCam) { if (dbgCam.f) { camera.position.copy(P.rpos).add(dbgCam.p); camera.lookAt(P.rpos.x, P.rpos.y + dbgCam.t.y, P.rpos.z); } else { camera.position.copy(dbgCam.p); camera.lookAt(dbgCam.t); } }
  if (q.sh > 0 && frameNo % q.shEvery === 0) placeSun();
  if (dof) { dof.uniforms.uMax.value = (2.2 + P.perch * 1.6) * q.pr * qDyn * (1 - MAPV.k) * (shopIn ? 0 : 1); dof.uniforms.uFocus.value = 130 + P.perch * 30; dof.uniforms.uNear.value = camera.near; dof.uniforms.uFar.value = camera.far; }
  sky.position.copy(camera.position); sky.material.uniforms.time.value = time;
  if (finalPass) { // streaks at the edge of the frame once you are really moving
    const want = started && !paused && !shopIn ? clamp((P.vel.length() - 30) / 45, 0, 1) * 0.075 : 0;
    blurK += (want - blurK) * (1 - Math.exp(-Math.min(rawDt, 0.1) * 5)); finalPass.uniforms.uBlur.value = blurK * (1 - MAPV.k);
  }
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
let blurK = 0;
window.__G = { setFP: (v) => { FP = v; }, startTrick,  sky, setHaze, TOD, getFinal: () => finalPass, storyTick: updateStory, mapCamera, MAPV, QUEST, SHOPS, dlg, transit, interact, advanceDlg, selectTrial, enterShop, exitShop, story: () => ({ step: QUEST.step, shop: shopIn && shopIn.name, prompt: PROMPT.label, dlg: dlg.on && dlg.lines[dlg.i] }), setStep: (k) => { QUEST.step = k; QUEST.timing = false; }, introStep, updateTrial, TR, TRIALS, startTrial, openMap, closeMap, intro, captureEnv, P, C, keys, ev, applyTOD, world, life, hero, R, perf, resetCam, audioDbg, audioPeak, freeze: (v) => { dbgFreeze = v; }, sfx: { thwip, whoosh, thud, footstep, horn, siren, heli }, setCam: (px, py, pz, tx, ty, tz) => { dbgCam = px == null ? null : { p: new V3(px, py, pz), t: new V3(tx, ty, tz) }; }, follow: (x, y, z, ty = 0) => { dbgCam = { f: true, p: new V3(x, y, z), t: new V3(0, ty, 0) }; }, setQuality: (i) => { perf.manual = true; applyQuality(i, 1); }, q: () => qIdx, info: () => renderer.info.render, zip: () => zipInfo, step, anim: updateAnim, renderer, scene, setStarted: () => { started = true; document.body.classList.add('playing'); $('start').classList.add('gone'); }, camera, time: () => time, addTime: (t) => { time += t; }, mouse: (dx, dy) => { C.yawT -= dx * 0.0022; C.pitchT = clamp(C.pitchT - dy * 0.0022, -1.35, 0.8); }, report: () => reported };
