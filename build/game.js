// Fling the State - three.js game. Requires THREE, STATES (data.js), SS logic (logic.js).
(function () {
'use strict';
if (typeof THREE === 'undefined' || typeof STATES === 'undefined') {
  document.getElementById('hint').textContent = 'Failed to load game assets.';
  return;
}

// ---------- constants ----------
const POUCH = { x: 0, y: SS.LAUNCH_Y, z: 10.3 };   // pouch rest (piece launch height)
const TABLE = { hx: 32, hz: 23 };                   // table half extents
const LOOK = new THREE.Vector3(0, 0, 2);
const OFF = new THREE.Vector3(0, 30, 36);
const PALETTE = [0xef6f6c, 0xf2a65a, 0xf7d154, 0x8fd14f, 0x4fc3a1, 0x5aa9e6, 0x9b7ede, 0xe67ecb, 0xf49ac1, 0x7fd4c1];

// ---------- audio ----------
const AudioSys = {
  ctx: null, muted: false,
  ensure() {
    if (!this.ctx) { try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  tone(f0, f1, dur, type, vol, delay) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type || 'sine'; o.frequency.setValueAtTime(f0, t);
    if (f1 && f1 !== f0) o.frequency.exponentialRampToValueAtTime(Math.max(f1, 1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.2, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(this.ctx.destination);
    o.start(t); o.stop(t + dur + 0.05);
  },
  noise(dur, vol, fFrom, fTo) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime, n = Math.floor(this.ctx.sampleRate * dur);
    const buf = this.ctx.createBuffer(1, n, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const flt = this.ctx.createBiquadFilter(); flt.type = 'bandpass'; flt.Q.value = 1.2;
    flt.frequency.setValueAtTime(fFrom || 800, t);
    flt.frequency.exponentialRampToValueAtTime(fTo || 2400, t + dur);
    const g = this.ctx.createGain(); g.gain.setValueAtTime(vol || 0.25, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt); flt.connect(g); g.connect(this.ctx.destination);
    src.start(t);
  },
  pop()   { this.tone(420, 900, 0.12, 'square', 0.10); },
  launch(){ this.noise(0.28, 0.22, 700, 2600); this.tone(180, 520, 0.22, 'triangle', 0.10); },
  thud()  { this.tone(95, 38, 0.20, 'sine', 0.45); this.noise(0.10, 0.12, 300, 120); },
  stick() { this.tone(659, 659, 0.12, 'triangle', 0.22); this.tone(880, 880, 0.12, 'triangle', 0.22, 0.09); this.tone(1318, 1318, 0.22, 'triangle', 0.20, 0.18); },
  miss()  { this.tone(300, 130, 0.32, 'sine', 0.20); },
  win()   { const n = [523, 659, 784, 1046, 784, 1046, 1318]; n.forEach((f, i) => this.tone(f, f, 0.22, 'triangle', 0.22, i * 0.13)); },
};

// ---------- renderer / scene ----------
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
const FAST = /[?&]fast=1/.test(location.search); // test hook: cheaper rendering for headless QA
renderer.setPixelRatio(FAST ? 1 : Math.min(window.devicePixelRatio || 1, 2));
renderer.shadowMap.enabled = !FAST;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputEncoding = THREE.sRGBEncoding;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xdfeef7);
scene.fog = new THREE.Fog(0xdfeef7, 80, 160);

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
// pannable view: camera looks at viewTarget; drags move it around
const VIEW_HOME = new THREE.Vector3(0, 3, 1);
const viewTarget = VIEW_HOME.clone();
const VIEW_B = { x0: -24, x1: 24, z0: -14, z1: 16 };
const OFF_NORM = OFF.clone().normalize();
let camDist = OFF.length();
function applyView() {
  viewTarget.x = Math.max(VIEW_B.x0, Math.min(VIEW_B.x1, viewTarget.x));
  viewTarget.z = Math.max(VIEW_B.z0, Math.min(VIEW_B.z1, viewTarget.z));
  camera.position.copy(viewTarget).addScaledVector(OFF_NORM, camDist);
  camera.lookAt(viewTarget);
}
function fitCamera() {
  const aspect = window.innerWidth / window.innerHeight;
  camera.aspect = aspect;
  renderer.setSize(window.innerWidth, window.innerHeight);
  const dist0 = OFF.length();
  camDist = Math.max(dist0, 24 / (Math.tan(THREE.MathUtils.degToRad(35)) * aspect));
  const vfov = 2 * Math.atan(17 / camDist) * 180 / Math.PI;
  camera.fov = Math.min(70, Math.max(38, vfov));
  camera.updateProjectionMatrix();
  applyView();
}
window.addEventListener('resize', fitCamera);
fitCamera();

scene.add(new THREE.HemisphereLight(0xffffff, 0x9a7a55, 0.75));
const sun = new THREE.DirectionalLight(0xfff1da, 1.15);
sun.position.set(20, 32, 14);
sun.castShadow = !FAST;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -38; sun.shadow.camera.right = 38;
sun.shadow.camera.top = 38; sun.shadow.camera.bottom = -38;
sun.shadow.camera.far = 90;
sun.shadow.bias = -0.0005;
scene.add(sun);

// ---------- table ----------
{
  const wood = new THREE.MeshStandardMaterial({ color: 0x9c6b3f, roughness: 0.8 });
  const top = new THREE.Mesh(new THREE.BoxGeometry(TABLE.hx * 2, 2.5, TABLE.hz * 2), wood);
  top.position.y = -1.25; top.receiveShadow = true; scene.add(top);
  const rim = new THREE.Mesh(new THREE.BoxGeometry(TABLE.hx * 2 + 1.6, 0.7, TABLE.hz * 2 + 1.6),
    new THREE.MeshStandardMaterial({ color: 0x7c5228, roughness: 0.85 }));
  rim.position.y = -0.55; scene.add(rim);
}

// ---------- tilted map board: rigid map on a stand, 30° ----------
const MAP_TILT = Math.PI / 6; // 30 degrees
const mapGroup = new THREE.Group();
mapGroup.rotation.x = MAP_TILT;
scene.add(mapGroup);
// slab (the stand): box with top surface at local y=0
const SLAB = { w: 40, h: 1.5, d: 24, cz: -1.5 };
{
  const slab = new THREE.Mesh(
    new THREE.BoxGeometry(SLAB.w, SLAB.h, SLAB.d),
    new THREE.MeshStandardMaterial({ color: 0xe8d9b8, roughness: 0.85 })
  );
  slab.position.set(0, -SLAB.h / 2, SLAB.cz);
  slab.receiveShadow = true; slab.castShadow = true;
  mapGroup.add(slab);
  // rest the slab's south-bottom edge on the table
  const edgeY = (-SLAB.h) * Math.cos(MAP_TILT) - (SLAB.cz + SLAB.d / 2) * Math.sin(MAP_TILT);
  mapGroup.position.set(0, -edgeY, 0);
  mapGroup.updateMatrixWorld(true);
}
// surface plane (world): point + normal, for landing physics
const SURF_PT = mapGroup.localToWorld(new THREE.Vector3(0, 0, SLAB.cz));
const SURF_N = new THREE.Vector3(0, Math.cos(MAP_TILT), Math.sin(MAP_TILT));
// stand legs under the north edge
{
  const legMat = new THREE.MeshStandardMaterial({ color: 0x7c5228, roughness: 0.85 });
  const northUnder = mapGroup.localToWorld(new THREE.Vector3(0, -SLAB.h, SLAB.cz - SLAB.d / 2));
  for (const lx of [-8, 8]) {
    const leg = new THREE.Mesh(new THREE.BoxGeometry(2, northUnder.y, 2), legMat);
    leg.position.set(lx, northUnder.y / 2, northUnder.z);
    leg.castShadow = true; leg.receiveShadow = true;
    scene.add(leg);
  }
}
// (no parchment skin — state outlines sit directly on the white slab stand)

// ---------- state slots (outlines + faint fills) ----------
const SLOT_BASE = 0xe9dcc0, SLOT_GLOW = 0x2e6fd8; // selected slot glows darker blue
const slotFillMats = [];
{
  const lineMat = new THREE.LineBasicMaterial({ color: 0x8a6d4b, transparent: true, opacity: 0.9 });
  for (const st of STATES) {
    const fillMat = new THREE.MeshBasicMaterial({ color: SLOT_BASE });
    slotFillMats.push(fillMat);
    for (const poly of st.polys) {
      const ring = poly[0];
      const lg = new THREE.BufferGeometry().setFromPoints(ring.map(p => new THREE.Vector3(p[0], 0.06, p[1])));
      mapGroup.add(new THREE.LineLoop(lg, lineMat));
      const shape = new THREE.Shape(ring.map(p => new THREE.Vector2(p[0], -p[1])));
      for (let i = 1; i < poly.length; i++) shape.holes.push(new THREE.Path(poly[i].map(p => new THREE.Vector2(p[0], -p[1]))));
      const fg = new THREE.ShapeGeometry(shape); fg.rotateX(-Math.PI / 2);
      const fill = new THREE.Mesh(fg, fillMat); fill.position.y = 0.035; mapGroup.add(fill);
    }
  }
}
// world <-> map-local helpers (slots live in map-local coords)
const _mapLocal = new THREE.Vector3();
function worldToMap(x, y, z) {
  return _mapLocal.set(x, y, z).applyMatrix4(mapGroup.matrixWorld.clone().invert());
}
function mapToWorld(x, y, z) {
  return mapGroup.localToWorld(new THREE.Vector3(x, y, z));
}
let hoverSlot = -1;
function setHoverSlot(si) {
  if (si === hoverSlot) return;
  if (hoverSlot >= 0) slotFillMats[hoverSlot].color.setHex(SLOT_BASE);
  hoverSlot = si;
  if (hoverSlot >= 0) slotFillMats[hoverSlot].color.setHex(SLOT_GLOW);
}
function slotAt(x, z) {
  for (let i = 0; i < STATES.length; i++) {
    const polys = STATES[i].polys;
    for (let p = 0; p < polys.length; p++) if (pointInRing(x, z, polys[p][0])) return i;
  }
  return -1;
}

// ---------- slingshot ----------
const sling = new THREE.Group(); scene.add(sling);
const PRONG_TIP_L = new THREE.Vector3(-1.35, 4.1, 11.0);
const PRONG_TIP_R = new THREE.Vector3(1.35, 4.1, 11.0);
{
  const wood = new THREE.MeshStandardMaterial({ color: 0x7a4a22, roughness: 0.7 });
  const base = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.7, 1.8), wood);
  base.position.set(0, 0.35, 11.0); base.castShadow = true; sling.add(base);
  const mkProng = (x0, x1) => {
    const a = new THREE.Vector3(x0, 0.7, 11.0), b = new THREE.Vector3(x1, 4.1, 11.0);
    const len = a.distanceTo(b);
    const m = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.34, len, 10), wood);
    m.position.copy(a).lerp(b, 0.5);
    m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
    m.castShadow = true; sling.add(m);
  };
  mkProng(-0.45, -1.35); mkProng(0.45, 1.35);
}
const bandMat = new THREE.MeshStandardMaterial({ color: 0x3a2a1a, roughness: 0.9 });
function stretchCyl(mesh, a, b, r) {
  const len = a.distanceTo(b);
  mesh.scale.set(r, len, r);
  mesh.position.copy(a).lerp(b, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
}
const bandGeo = new THREE.CylinderGeometry(1, 1, 1, 6);
const bandL = new THREE.Mesh(bandGeo, bandMat); const bandR = new THREE.Mesh(bandGeo, bandMat);
sling.add(bandL); sling.add(bandR);
const pouchMesh = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.35, 1.2),
  new THREE.MeshStandardMaterial({ color: 0x9a5f2e, roughness: 0.85 }));
pouchMesh.castShadow = true; sling.add(pouchMesh);
const pouchPos = new THREE.Vector3(POUCH.x, POUCH.y, POUCH.z);
function updateSling() {
  pouchMesh.position.copy(pouchPos);
  stretchCyl(bandL, PRONG_TIP_L, new THREE.Vector3(pouchPos.x - 0.6, pouchPos.y, pouchPos.z), 0.07);
  stretchCyl(bandR, PRONG_TIP_R, new THREE.Vector3(pouchPos.x + 0.6, pouchPos.y, pouchPos.z), 0.07);
}
updateSling();
// invisible grab sphere
const grabSphere = new THREE.Mesh(new THREE.SphereGeometry(3.4, 8, 8),
  new THREE.MeshBasicMaterial({ visible: false }));
grabSphere.position.copy(pouchPos); scene.add(grabSphere);

// ---------- state pieces ----------
const geoCache = {};
function pieceGeos(si) {
  if (geoCache[si]) return geoCache[si];
  const st = STATES[si], geos = [];
  for (const poly of st.polys) {
    const shape = new THREE.Shape(poly[0].map(p => new THREE.Vector2(p[0], -p[1])));
    for (let i = 1; i < poly.length; i++) shape.holes.push(new THREE.Path(poly[i].map(p => new THREE.Vector2(p[0], -p[1]))));
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.5, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.07, bevelSegments: 1, steps: 1 });
    g.translate(0, 0, -0.25); g.rotateX(-Math.PI / 2);
    g.translate(-st.cx, 0, -st.cz); // center on the slot centroid so the group origin = piece center
    geos.push(g);
  }
  geoCache[si] = geos; return geos;
}
function makeTagTexture(name) {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 112;
  const ctx = cv.getContext('2d');
  ctx.font = '900 56px ui-rounded, "SF Pro Rounded", system-ui, sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 10; ctx.strokeStyle = 'rgba(74,47,20,0.92)';
  ctx.strokeText(name, 256, 58); ctx.fillStyle = '#fff8e8'; ctx.fillText(name, 256, 58);
  const tx = new THREE.CanvasTexture(cv); tx.encoding = THREE.sRGBEncoding;
  return tx;
}
const tagCache = {};
const tokenGeo = new THREE.CylinderGeometry(0.95, 0.95, 0.5, 24);
const tokenMat = new THREE.MeshStandardMaterial({ color: 0xd9a441, metalness: 0.65, roughness: 0.3 });
function buildPiece(si) {
  const st = STATES[si];
  const grp = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: PALETTE[(si * 3) % PALETTE.length], roughness: 0.5, metalness: 0.05 });
  for (const g of pieceGeos(si)) {
    const m = new THREE.Mesh(g, mat); m.castShadow = true;
    m.userData.isStateMesh = true; grp.add(m);
  }
  const token = new THREE.Mesh(tokenGeo, tokenMat);
  token.position.y = 0.6; // sit clear of the pouch during the idle bob
  token.castShadow = true; token.userData.isToken = true; grp.add(token);
  const label = displayName(si);
  if (!tagCache[label]) tagCache[label] = makeTagTexture(label);
  const tag = new THREE.Sprite(new THREE.SpriteMaterial({ map: tagCache[label], transparent: true, depthWrite: false }));
  const tw = 2.4 + label.length * 0.34;
  tag.scale.set(tw, tw * 112 / 512, 1);
  tag.position.y = 2.6;
  grp.add(tag); grp.userData.tag = tag;
  applyPieceLook(grp);
  return grp;
}
// what the slingshot shows per level: L1-2 full shape, L3 state name on token,
// L4 capital name on token
function applyPieceLook(grp) {
  const lvl = G.level;
  grp.traverse(o => {
    if (o.userData.isStateMesh) o.visible = lvl <= 2;
    if (o.userData.isToken) o.visible = lvl === 3 || lvl === 4;
  });
}
// reveal the real state shape when it sticks (names never show on placed pieces)
function revealPieceShape(grp) {
  grp.traverse(o => {
    if (o.userData.isStateMesh) o.visible = true;
    if (o.userData.isToken) o.visible = false;
  });
  if (grp.userData.tag) grp.userData.tag.visible = false;
}

// ---------- trajectory preview + landing ring ----------
const TRAIL_N = 42;
const trailGeo = new THREE.BufferGeometry();
trailGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 3), 3));
const trailMat = new THREE.PointsMaterial({ color: 0x111111, size: 0.5, sizeAttenuation: true, transparent: true, opacity: 0.95, depthWrite: false });
const trail = new THREE.Points(trailGeo, trailMat);
trail.visible = false; trail.frustumCulled = false; scene.add(trail);
const ringGeo = new THREE.RingGeometry(0.55, 0.85, 40); ringGeo.rotateX(-Math.PI / 2);
const ringMat = new THREE.MeshBasicMaterial({ color: 0x111111, transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false });
const landRing = new THREE.Mesh(ringGeo, ringMat);
landRing.position.y = 0.12; landRing.visible = false; scene.add(landRing);
const hintRing = new THREE.Mesh(ringGeo.clone(), new THREE.MeshBasicMaterial({ color: 0xf5a623, transparent: true, opacity: 0.0, side: THREE.DoubleSide, depthWrite: false }));
hintRing.position.y = 0.12; scene.add(hintRing);

// ---------- particles (dust / confetti) ----------
const puffTex = (() => {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 30);
  g.addColorStop(0, 'rgba(255,255,255,0.95)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
})();
const puffs = [];
function spawnPuff(x, y, z, color, n, spread, up) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.SpriteMaterial({ map: puffTex, color, transparent: true, opacity: 0.9, depthWrite: false });
    const s = new THREE.Sprite(m);
    const sc = 0.7 + Math.random() * 0.9; s.scale.set(sc, sc, 1);
    s.position.set(x, y, z);
    const a = Math.random() * Math.PI * 2, sp = spread * (0.4 + Math.random() * 0.6);
    puffs.push({ s, vx: Math.cos(a) * sp, vy: up * (0.5 + Math.random()), vz: Math.sin(a) * sp, life: 0.55 + Math.random() * 0.25, age: 0 });
    scene.add(s);
  }
}
function updatePuffs(dt) {
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i]; p.age += dt;
    if (p.age >= p.life) { scene.remove(p.s); p.s.material.dispose(); puffs.splice(i, 1); continue; }
    p.s.position.x += p.vx * dt; p.s.position.y += p.vy * dt; p.s.position.z += p.vz * dt;
    p.vy -= 3 * dt;
    p.s.material.opacity = 0.9 * (1 - p.age / p.life);
  }
}

// ---------- HUD ----------
const el = id => document.getElementById(id);
const hudName = el('curName'), hudSub = el('curSub'), hudPlaced = el('placed'),
      hudTimer = el('timer'), hudShots = el('shots'), toastEl = el('toast'), hintEl = el('hint');
let toastTimer = 0;
function toast(txt, color) {
  toastEl.textContent = txt; toastEl.style.color = color || '#2f7a3d'; toastEl.style.opacity = 1;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.style.opacity = 0; }, 1100);
}
function fmtTime(s) { return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }

// ---------- game state ----------
const G = {
  phase: 'start', queue: [], qi: 0, piece: null, si: -1,
  placed: 0, shots: 0, misses: 0, hintShown: false,
  time: 0, timeRunning: false, runId: 0, level: 1,
  pull: { x: 0, z: 0 }, slingId: null,
  fly: null, anim: null,
};
const LEVELS = [null,
  { badge: 'LEVEL 1', winSub: 'All 50 states are home.' },
  { badge: 'LEVEL 2', winSub: 'All 50 states are home.' },
  { badge: 'LEVEL 3', winSub: 'All 50 states are home.' },
  { badge: 'LEVEL 4', winSub: 'All 50 capitals are home.' },
];
function displayName(si) { return G.level === 4 ? STATES[si].capital : STATES[si].name; }
const placedMeshes = [];

function spawnPiece() {
  const si = G.queue[G.qi];
  const isNew = si !== G.si; // same state retrying after a miss keeps its miss count + hint
  G.si = si;
  G.piece = buildPiece(G.si);
  G.piece.position.set(POUCH.x, POUCH.y, POUCH.z);
  G.piece.scale.setScalar(0.01);
  scene.add(G.piece);
  G.anim = { kind: 'pop', t: 0, dur: 0.38 };
  if (isNew) { G.misses = 0; G.hintShown = false; hintRing.material.opacity = 0; }
  setHoverSlot(-1);
  hudName.textContent = displayName(G.si).toUpperCase();
  hudSub.textContent = G.level === 4 ? 'FLING THE CAPITAL HOME' : 'DRAG THE SLINGSHOT BACK';
  hudShots.textContent = G.shots;
  G.phase = 'aim';
  AudioSys.pop();
}
function clearPiece() {
  if (G.piece) {
    G.piece.traverse(o => { if (o.isMesh || o.isSprite) o.material.dispose(); });
    scene.remove(G.piece); G.piece = null;
  }
  trail.visible = false; landRing.visible = false;
}
function startGame(level) {
  if (level) G.level = level;
  G.runId++;
  for (const m of placedMeshes) { m.traverse(o => { if (o.isMesh || o.isSprite) o.material.dispose(); }); scene.remove(m); }
  placedMeshes.length = 0;
  clearPiece();
  G.fly = null; G.anim = null; G.slingId = null; panId = null;
  setHoverSlot(-1);
  G.pull.x = 0; G.pull.z = 0;
  pouchPos.set(POUCH.x, POUCH.y, POUCH.z);
  grabSphere.position.copy(pouchPos);
  updateSling();
  G.queue = ssShuffle(STATES.map((_, i) => i));
  G.qi = 0; G.si = -1; G.placed = 0; G.shots = 0; G.time = 0; G.timeRunning = true;
  hudPlaced.textContent = '0'; hudTimer.textContent = '0:00'; hudShots.textContent = '0';
  el('startOverlay').classList.add('hidden');
  el('winOverlay').classList.add('hidden');
  el('lvlBadge').textContent = LEVELS[G.level].badge;
  viewTarget.copy(VIEW_HOME); applyView();
  hintEl.textContent = 'Drag the slingshot back to aim — drag anywhere else to pan the map.';
  spawnPiece();
}
function win() {
  G.phase = 'win'; G.timeRunning = false;
  clearPiece();
  setHoverSlot(-1);
  const acc = G.shots > 0 ? Math.min(100, Math.round(50 / G.shots * 100)) : 100;
  el('winSub').textContent = LEVELS[G.level].winSub;
  el('winstats').innerHTML =
    '⏱ ' + fmtTime(G.time) + '<br>🎯 ' + G.shots + ' shots &nbsp;·&nbsp; ' + acc + '% first-try';
  el('nextLvlBtn').classList.toggle('hidden', G.level >= 4);
  el('winOverlay').classList.remove('hidden');
  AudioSys.win();
  for (let i = 0; i < 5; i++)
    setTimeout(() => spawnPuff((Math.random() - 0.5) * 30, 4 + Math.random() * 4, -2 + (Math.random() - 0.5) * 14,
      [0xef6f6c, 0xf7d154, 0x8fd14f, 0x5aa9e6, 0xe67ecb][i % 5], 14, 5, 5), i * 160);
}

// ---------- input ----------
const raycaster = new THREE.Raycaster();
const pointerNDC = new THREE.Vector2();
const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -SS.LAUNCH_Y);
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
const hitPoint = new THREE.Vector3();
const groundHit = new THREE.Vector3();
function setNDC(e) {
  pointerNDC.x = (e.clientX / window.innerWidth) * 2 - 1;
  pointerNDC.y = -(e.clientY / window.innerHeight) * 2 + 1;
}
function fingerWorld(e) {
  setNDC(e); raycaster.setFromCamera(pointerNDC, camera);
  return raycaster.ray.intersectPlane(dragPlane, hitPoint) ? hitPoint : null;
}
function groundPoint(e) {
  setNDC(e); raycaster.setFromCamera(pointerNDC, camera);
  return raycaster.ray.intersectPlane(groundPlane, groundHit) ? groundHit : null;
}
function hitPouch(e) {
  if (!G.piece) return false;
  setNDC(e); raycaster.setFromCamera(pointerNDC, camera);
  return raycaster.intersectObjects([grabSphere, G.piece], true).length > 0;
}
// pan state: a drag that didn't start on the pouch moves the camera target
let panId = null, panStartGround = null;
const panStartView = new THREE.Vector3(), panTmp = new THREE.Vector3();
function updatePan(e) {
  const cur = groundPoint(e);
  if (!cur || !panStartGround) return;
  viewTarget.copy(panStartView).sub(panTmp.copy(cur).sub(panStartGround));
  applyView();
}
canvas.addEventListener('pointerdown', e => {
  AudioSys.ensure();
  if (e.pointerId === G.slingId || e.pointerId === panId) return;
  if (G.phase === 'aim' && G.slingId === null && hitPouch(e)) {
    G.slingId = e.pointerId;
    try { canvas.setPointerCapture(e.pointerId); } catch (_) {}
    G.phase = 'drag';
    updateDrag(e);
  } else if (panId === null) {
    panId = e.pointerId;
    const g = groundPoint(e);
    panStartGround = g ? g.clone() : null;
    panStartView.copy(viewTarget);
  }
});
canvas.addEventListener('pointermove', e => {
  if (e.pointerId === G.slingId) updateDrag(e);
  else if (e.pointerId === panId) updatePan(e);
});
function endSlingDrag() {
  const len = Math.hypot(G.pull.x, G.pull.z);
  if (G.phase === 'drag' && len >= SS.MIN_PULL) launch();
  else if (G.phase === 'drag') {
    G.phase = 'aim';
    // snap the pouch back
    pouchPos.set(POUCH.x, POUCH.y, POUCH.z);
    grabSphere.position.copy(pouchPos);
    if (G.piece) G.piece.position.set(pouchPos.x, POUCH.y, pouchPos.z);
    updateSling();
  }
  trail.visible = false; landRing.visible = false;
  setHoverSlot(-1);
}
function endPointer(e) {
  if (e.pointerId === G.slingId) { G.slingId = null; endSlingDrag(); }
  else if (e.pointerId === panId) { panId = null; }
}
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener('contextmenu', e => e.preventDefault());

function updateDrag(e) {
  const fw = fingerWorld(e); if (!fw) return;
  const c = ssClampPull(POUCH.x - fw.x, POUCH.z - fw.z);
  G.pull.x = c.x; G.pull.z = c.z;
  // pouch follows the finger partway (elastic feel); piece rides with it
  pouchPos.set(POUCH.x - c.x * 0.45, POUCH.y, POUCH.z - c.z * 0.45);
  grabSphere.position.copy(pouchPos);
  if (G.piece) G.piece.position.set(pouchPos.x, POUCH.y, pouchPos.z);
  updateSling();
  updatePreview();
}
function pieceLaunchPos() {
  return { x: pouchPos.x, y: POUCH.y, z: pouchPos.z };
}
// landing plane: the tilted map surface (piece center rests REST_Y above it along normal)
const LAND_PLANE = { s: SURF_PT, n: SURF_N, offset: SS.REST_Y };
function landOnMap(p0, v) {
  return ssLandingOnPlane(p0, v, LAND_PLANE.s, LAND_PLANE.n, LAND_PLANE.offset);
}
function onMapBoard(lx, lz) { // lx, lz in map-local
  return Math.abs(lx) <= SLAB.w / 2 && Math.abs(lz - SLAB.cz) <= SLAB.d / 2;
}
function updatePreview() {
  const len = Math.hypot(G.pull.x, G.pull.z);
  if (len < SS.MIN_PULL * 0.6) { trail.visible = false; landRing.visible = false; setHoverSlot(-1); return; }
  const v = ssVelocityForPull(G.pull.x, G.pull.z);
  const p0 = pieceLaunchPos();
  const pts = ssTrajectory(p0, v, TRAIL_N);
  const attr = trailGeo.getAttribute('position');
  for (let i = 0; i < TRAIL_N; i++) attr.setXYZ(i, pts[i].x, pts[i].y, pts[i].z);
  attr.needsUpdate = true;
  const land = landOnMap(p0, v);
  if (!land) { trail.visible = true; landRing.visible = false; setHoverSlot(-1); return; }
  const local = worldToMap(land.x, land.y, land.z);
  const onBoard = onMapBoard(local.x, local.z);
  trail.visible = true;
  trailMat.color.setHex(onBoard ? 0x111111 : 0xff9040);
  if (onBoard) {
    landRing.visible = true;
    landRing.position.set(land.x, land.y, land.z).addScaledVector(SURF_N, 0.07);
    landRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), SURF_N);
    // L1: ring turns green when the aim would stick (way too much hinting).
    // L2+: ring stays white; the slot under the landing point glows instead.
    // Stick rule: the hovered (highlighted) polygon must be the target.
    const ok = slotAt(local.x, local.z) === G.si;
    ringMat.color.setHex(G.level === 1 && ok ? 0x35c759 : 0x111111);
    setHoverSlot(slotAt(local.x, local.z));
  } else { landRing.visible = false; setHoverSlot(-1); }
}

// ---------- launch / flight / landing ----------
function launch() {
  const v = ssVelocityForPull(G.pull.x, G.pull.z);
  const p0 = pieceLaunchPos();
  const land = landOnMap(p0, v);
  G.fly = { p0, v, t: 0, tLand: land ? land.t : 3 };
  G.phase = 'fly';
  G.shots++; hudShots.textContent = G.shots;
  hudSub.textContent = displayName(G.si).toUpperCase() + ' AWAY!';
  setHoverSlot(-1);
  // snap pouch back
  pouchPos.set(POUCH.x, POUCH.y, POUCH.z);
  grabSphere.position.copy(pouchPos);
  updateSling();
  trail.visible = false; landRing.visible = false;
  AudioSys.launch();
}
function updateFly(dt) {
  const f = G.fly; f.t += dt;
  const pos = ssPosAt(f.p0, f.v, Math.min(f.t, f.tLand + 3));
  if (G.piece) {
    G.piece.position.set(pos.x, pos.y, pos.z);
    G.piece.rotation.y += dt * 1.4;
  }
  if (f.t >= f.tLand) land();
}
function land() {
  const f = G.fly;
  const landPt = landOnMap(f.p0, f.v);
  if (!landPt) { G.fly = null; G.phase = 'aim'; spawnPiece(); return; }
  const local = worldToMap(landPt.x, landPt.y, landPt.z);
  const onBoard = onMapBoard(local.x, local.z);
  AudioSys.thud();
  if (onBoard) spawnPuff(landPt.x, landPt.y, landPt.z, 0xd8c9a8, 10, 3.5, 2.5);
  if (!onBoard) {
    // missed the board entirely: tumble away ballistically
    G.phase = 'resolve';
    G.anim = { kind: 'falloff', t: 0, x: landPt.x, z: landPt.z, y: landPt.y,
               vx: f.v.x, vy: f.v.y - SS.G * landPt.t, vz: f.v.z };
    toast('Off the map!', '#c25e4e');
    registerMiss();
  } else if (slotAt(local.x, local.z) === G.si) {
    // Strict: the highlighted polygon at release must be the target.
    G.phase = 'resolve';
    const st = STATES[G.si];
    const target = mapToWorld(st.cx, SS.REST_Y, st.cz);
    G.anim = { kind: 'stick', t: 0, dur: 0.34,
               from: { x: landPt.x, y: landPt.y, z: landPt.z },
               to: { x: target.x, y: target.y, z: target.z } };
    AudioSys.stick();
    const puffAt = mapToWorld(st.cx, 0.8, st.cz);
    spawnPuff(puffAt.x, puffAt.y, puffAt.z, 0xffd94d, 16, 4.5, 4);
  } else {
    G.phase = 'resolve';
    G.anim = { kind: 'bounce', t: 0, dur: 0.62, x: landPt.x, y: landPt.y, z: landPt.z };
    AudioSys.miss();
    toast('Try again!', '#c25e4e');
    registerMiss();
  }
  G.fly = null;
}
function registerMiss() {
  G.misses++;
  if (G.misses >= 2 && !G.hintShown) {
    G.hintShown = true;
    const st = STATES[G.si];
    const hp = mapToWorld(st.cx, 0.12, st.cz);
    hintRing.position.copy(hp);
    hintRing.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), SURF_N);
    hudSub.textContent = 'LOOK FOR THE GOLD RING HINT';
    toast('Hint: gold ring!', '#b8860b');
  }
}
function updateResolve(dt) {
  const a = G.anim; if (!a) return;
  a.t += dt;
  const p = G.piece;
  if (a.kind === 'pop') {
    const k = Math.min(a.t / a.dur, 1);
    const back = 1 + 1.8 * Math.pow(k - 1, 3) + 0.8 * Math.pow(k - 1, 2); // easeOutBack-ish
    if (p) p.scale.setScalar(Math.max(0.01, back));
    if (k >= 1) { if (p) p.scale.setScalar(1); G.anim = null; }
  } else if (a.kind === 'stick') {
    const k = Math.min(a.t / a.dur, 1);
    const e = 1 - Math.pow(1 - k, 3);
    const x = a.from.x + (a.to.x - a.from.x) * e;
    const y = a.from.y + (a.to.y - a.from.y) * e + Math.sin(k * Math.PI) * 1.4;
    const z = a.from.z + (a.to.z - a.from.z) * e;
    if (p) {
      p.position.set(x, y, z);
      p.rotation.y *= (1 - Math.min(dt * 10, 1));
      p.rotation.x += (MAP_TILT - p.rotation.x) * Math.min(dt * 8, 1);
      const s = 1 + Math.sin(k * Math.PI) * 0.12; p.scale.setScalar(s);
    }
    if (k >= 1) {
      if (p) { p.position.set(a.to.x, a.to.y, a.to.z); p.rotation.set(MAP_TILT, 0, 0); p.scale.setScalar(1); revealPieceShape(p); }
      placedMeshes.push(p); G.piece = null;
      G.placed++; hudPlaced.textContent = G.placed;
      toast('Stuck! +' + (50 - G.placed) + ' to go', '#2f7a3d');
      G.anim = null;
      const runId = G.runId;
      setTimeout(() => {
        if (runId !== G.runId) return; // a restart happened meanwhile
        if (G.placed >= 50) win();
        else { G.qi++; spawnPiece(); }
      }, 320);
    }
  } else if (a.kind === 'bounce') {
    const k = Math.min(a.t / a.dur, 1);
    // two decaying hops along the surface normal
    const hop = k < 0.45
      ? Math.sin((k / 0.45) * Math.PI) * 1.1
      : Math.sin(((k - 0.45) / 0.55) * Math.PI) * 0.45;
    if (p) { p.position.set(a.x, a.y, a.z).addScaledVector(SURF_N, Math.max(hop, 0)); }
    if (k >= 1) {
      G.anim = { kind: 'shrink', t: 0, dur: 0.22 };
    }
  } else if (a.kind === 'shrink') {
    const k = Math.min(a.t / a.dur, 1);
    if (p) p.scale.setScalar(Math.max(0.01, 1 - k));
    // spawnPiece installs the pop-in anim; don't null it (that left retries invisible)
    if (k >= 1) { clearPiece(); spawnPiece(); }
  } else if (a.kind === 'falloff') {
    // ballistic tumble past the table edge until out of sight
    a.vy -= SS.G * dt;
    a.x += a.vx * dt; a.y += a.vy * dt; a.z += a.vz * dt;
    if (p) {
      p.position.set(a.x, a.y, a.z);
      p.rotation.x += dt * 5; p.rotation.z += dt * 3;
      // spawnPiece installs the pop-in anim; don't null it (that left retries invisible)
      if (a.y < -6) { clearPiece(); spawnPiece(); }
    } else G.anim = null;
  }
}

// ---------- main loop ----------
const clock = new THREE.Clock();
let elapsed = 0;
function loop() {
  requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  elapsed += dt;
  if (G.timeRunning) { G.time += dt; hudTimer.textContent = fmtTime(G.time); }
  if ((G.phase === 'aim') && G.piece && !G.anim) {
    G.piece.position.y = POUCH.y + Math.sin(elapsed * 2.6) * 0.1;
    G.piece.rotation.y = Math.sin(elapsed * 0.9) * 0.12;
  }
  if (G.phase === 'fly') updateFly(dt);
  if (G.phase === 'resolve') updateResolve(dt);
  else if (G.anim && G.anim.kind === 'pop') updateResolve(dt);
  if (hintRing.material.opacity > 0 || G.hintShown) {
    hintRing.material.opacity = G.hintShown && G.piece ? 0.45 + 0.35 * Math.sin(elapsed * 5) : 0;
  }
  if (G.slingId !== null && G.phase === 'drag') {
    const s = 1 + 0.06 * Math.sin(elapsed * 14);
    landRing.scale.set(s, 1, s);
  }
  updatePuffs(dt);
  renderer.render(scene, camera);
}

// ---------- ui wiring ----------
document.querySelectorAll('.lvlbtn').forEach(b => b.addEventListener('click', () => {
  AudioSys.ensure(); startGame(parseInt(b.dataset.lvl, 10));
}));
el('againBtn').addEventListener('click', () => { AudioSys.ensure(); startGame(G.level); });
el('nextLvlBtn').addEventListener('click', () => { AudioSys.ensure(); startGame(Math.min(4, G.level + 1)); });
el('restartBtn').addEventListener('click', () => {
  // back to the level menu: clear the board, show the picker
  G.runId++;
  for (const m of placedMeshes) { m.traverse(o => { if (o.isMesh || o.isSprite) o.material.dispose(); }); scene.remove(m); }
  placedMeshes.length = 0;
  clearPiece();
  G.fly = null; G.anim = null; G.slingId = null; panId = null;
  setHoverSlot(-1);
  hintRing.material.opacity = 0; G.hintShown = false;
  trail.visible = false; landRing.visible = false;
  G.timeRunning = false;
  el('winOverlay').classList.add('hidden');
  el('startOverlay').classList.remove('hidden');
});
el('homeBtn').addEventListener('click', () => { viewTarget.copy(VIEW_HOME); applyView(); });
el('muteBtn').addEventListener('click', function () {
  AudioSys.ensure(); AudioSys.muted = !AudioSys.muted;
  this.textContent = AudioSys.muted ? '🔇' : '🔊';
});
document.addEventListener('gesturestart', e => e.preventDefault());

loop();

// ---------- debug hooks (used by automated tests) ----------
window.__ss = {
  G, STATES, SS, camera, viewTarget, applyView, mapToWorld, worldToMap,
  start: startGame,
  // aim the current piece at map-local (tx, tz) and release, like a drag would.
  // (iterates because the pouch shifts with the pull, and the board is tilted)
  autoAim(tx, tz) {
    if (G.phase !== 'aim' || !G.piece) return false;
    const target = mapToWorld(tx, SS.REST_Y, tz); // 3D point on the tilted surface
    let pull = { x: 0, z: -3 };
    for (let i = 0; i < 10; i++) {
      const lx = POUCH.x - pull.x * 0.45, lz = POUCH.z - pull.z * 0.45;
      const p0 = { x: lx, y: POUCH.y, z: lz };
      const v = ssVelocityForPull(pull.x, pull.z);
      const land = landOnMap(p0, v);
      if (!land) break;
      const ex = target.x - land.x, ez = target.z - land.z;
      if (Math.hypot(ex, ez) < 0.05) break;
      pull.x += ex * 0.12; pull.z += ez * 0.12;
      const c = ssClampPull(pull.x, pull.z);
      pull = { x: c.x, z: c.z };
    }
    G.pull.x = pull.x; G.pull.z = pull.z;
    pouchPos.set(POUCH.x - pull.x * 0.45, POUCH.y, POUCH.z - pull.z * 0.45);
    G.piece.position.set(pouchPos.x, POUCH.y, pouchPos.z);
    launch();
    return true;
  },
  skipTo(name) {
    const i = STATES.findIndex(s => s.name.toLowerCase() === name.toLowerCase());
    if (i < 0) return false;
    clearPiece();
    G.queue[G.qi] = i;
    spawnPiece();
    return true;
  },
  // show the drag preview for a pull aimed at map-local (tx, tz) without launching
  previewAt(tx, tz) {
    if (G.phase !== 'aim' || !G.piece) return false;
    const target = mapToWorld(tx, SS.REST_Y, tz);
    let pull = { x: 0, z: -3 };
    for (let i = 0; i < 10; i++) {
      const lx = POUCH.x - pull.x * 0.45, lz = POUCH.z - pull.z * 0.45;
      const p0 = { x: lx, y: POUCH.y, z: lz };
      const v = ssVelocityForPull(pull.x, pull.z);
      const land = landOnMap(p0, v);
      if (!land) break;
      const ex = target.x - land.x, ez = target.z - land.z;
      if (Math.hypot(ex, ez) < 0.05) break;
      pull.x += ex * 0.12; pull.z += ez * 0.12;
      const c = ssClampPull(pull.x, pull.z);
      pull = { x: c.x, z: c.z };
    }
    G.pull.x = pull.x; G.pull.z = pull.z;
    pouchPos.set(POUCH.x - pull.x * 0.45, POUCH.y, POUCH.z - pull.z * 0.45);
    grabSphere.position.copy(pouchPos);
    G.piece.position.set(pouchPos.x, POUCH.y, pouchPos.z);
    updateSling();
    updatePreview();
    return ringMat.color.getHex();
  },
};
})();
