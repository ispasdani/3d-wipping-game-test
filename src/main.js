// Vanilla Doom-like raycaster with swipe melee + monsters collecting flowers.
// No frameworks. Single level. Canvas only.

const canvas = document.getElementById("game");
const swipeCanvas = document.getElementById("swipeLine");
const sctx = swipeCanvas.getContext("2d");
const ctx = canvas.getContext("2d", { alpha: false });

const hpText = document.getElementById("hpText");
const healthFill = document.getElementById("healthFill");
const stolenText = document.getElementById("stolenText");
const monstersText = document.getElementById("monstersText");

const DPR = Math.max(1, Math.min(2, window.devicePixelRatio || 1));

// --- Game config ---
const RENDER_W = 420;
const RENDER_H = 260;
const FOV = (70 * Math.PI) / 180;
const MAX_DIST = 20;

const PLAYER = {
  x: 3.5,
  y: 3.5,
  a: 0,
  moveSpeed: 3.2,
  radius: 0.18,
  hp: 100,
  hurtFlash: 0,
};

const MAP_W = 16, MAP_H = 16;
// 0 empty, 1 wall, 2 door-closed, 3 door-open
const map = [
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
  [1,0,0,0,0,0,0,0,0,0,0,0,0,0,0,1],
  [1,0,1,1,1,0,1,1,1,0,1,1,1,1,0,1],
  [1,0,1,0,0,0,1,0,0,0,1,0,0,1,0,1],
  [1,0,1,0,1,0,1,0,1,0,1,0,1,1,0,1],
  [1,0,0,0,1,0,0,0,1,0,0,0,0,0,0,1],
  [1,0,1,0,1,1,1,0,1,0,1,1,1,1,0,1],
  [1,0,1,0,0,0,0,0,0,0,0,0,0,1,0,1],
  [1,0,1,1,1,1,0,1,1,1,0,1,0,1,0,1],
  [1,0,0,0,0,1,0,0,0,1,0,1,0,0,0,1],
  [1,0,1,1,0,1,1,1,0,1,0,1,1,1,0,1],
  [1,0,0,1,0,0,0,1,0,0,0,0,0,1,0,1],
  [1,1,0,1,1,1,0,1,1,1,1,1,0,1,0,1],
  [1,0,0,0,0,0,0,0,0,0,0,2,0,0,0,1],
  [1,0,1,1,1,1,1,1,1,1,0,1,1,1,0,1],
  [1,1,1,1,1,1,1,1,1,1,1,1,1,1,1,1],
];

// --- Entities ---
const flowers = [];
const medkits = [];
const monsters = [];
let flowersStolen = 0;

// --- Helpers ---
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dist2 = (ax, ay, bx, by) => {
  const dx = ax - bx, dy = ay - by;
  return dx * dx + dy * dy;
};
const angNorm = (a) => {
  while (a <= -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
};

function inBounds(mx, my) { return mx >= 0 && my >= 0 && mx < MAP_W && my < MAP_H; }
function isSolidCell(c) { return c === 1 || c === 2; }

function collideCircle(x, y, r) {
  const minx = Math.floor(x - r), maxx = Math.floor(x + r);
  const miny = Math.floor(y - r), maxy = Math.floor(y + r);
  for (let cy = miny; cy <= maxy; cy++) {
    for (let cx = minx; cx <= maxx; cx++) {
      if (!inBounds(cx, cy)) return true;
      const c = map[cy][cx];
      if (!isSolidCell(c)) continue;

      const nx = clamp(x, cx, cx + 1);
      const ny = clamp(y, cy, cy + 1);
      if (dist2(x, y, nx, ny) < r * r) return true;
    }
  }
  return false;
}

// --- Spawn ---
function spawnFlowers() {
  const spots = [
    [5.5,5.5],[7.5,7.2],[10.4,9.4],[12.5,13.2],[2.5,13.5],[13.4,2.6],[8.5,11.5],
    [4.6,9.7],[11.3,5.7],[6.4,13.4],[9.6,3.6],
  ];
  for (const [x,y] of spots) flowers.push({ x, y, alive: true });
}
function spawnMedkits() {
  const spots = [[2.5,2.5],[13.2,12.7],[8.5,14.2]];
  for (const [x,y] of spots) medkits.push({ x, y, alive: true });
}
function makeMonster(x, y) {
  return {
    x, y, vx: 0, vy: 0,
    hp: 60,
    state: "collect",
    targetFlowerId: -1,
    carried: 0,
    hurtT: 0,
    aggroT: 0,
    _atkCd: 0,
    // render info
    depth: -1, sx: 0, sy: 0, sw: 0, sh: 0,
  };
}
function spawnMonsters() {
  monsters.length = 0;
  // put one very close so you ALWAYS see it immediately
  const spots = [
    [6.2, 4.2],
    [12.4, 3.4],
    [10.5, 12.4],
  ];
  for (const [x,y] of spots) monsters.push(makeMonster(x,y));
  monstersText.textContent = String(monsters.length);
}

// --- Simple audio blip ---
let audioCtx = null;
function blip(freq, attack=0.01, dur=0.06){
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    o.type = "square";
    o.frequency.value = freq;
    g.gain.value = 0;
    o.connect(g); g.connect(audioCtx.destination);
    const t0 = audioCtx.currentTime;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.07, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + dur);
    o.start(t0);
    o.stop(t0 + attack + dur + 0.02);
  } catch {}
}

// --- Input ---
const keys = new Set();
let minimapOn = true;

window.addEventListener("keydown", (e) => {
  keys.add(e.code);
  if (e.code === "KeyM") minimapOn = !minimapOn;
  if (e.code === "KeyE") tryUseDoor();
});
window.addEventListener("keyup", (e) => keys.delete(e.code));

let locked = false;
document.body.addEventListener("click", () => {
  if (!locked) canvas.requestPointerLock?.();
});
document.addEventListener("pointerlockchange", () => {
  locked = (document.pointerLockElement === canvas);
  document.body.classList.toggle("locked", locked);
});

// mouselook
let mouseDX = 0;
document.addEventListener("mousemove", (e) => {
  if (locked) mouseDX += e.movementX;
  if (attack.dragging) {
    // Even in pointer lock, movementX/Y still changes: use it to build swipe power.
    attack.dragDX += e.movementX;
    attack.dragDY += e.movementY;
  }
});

// --- Wipe attack (animation + hit logic that works in pointer lock) ---
const attack = {
  dragging: false,
  dragDX: 0,
  dragDY: 0,
  startTime: 0,

  // animation
  animT: 0,     // 0..1 while swinging
  active: false,
  power: 0,     // computed from swipe distance/speed
};

window.addEventListener("mousedown", (e) => {
  attack.dragging = true;
  attack.dragDX = 0;
  attack.dragDY = 0;
  attack.startTime = performance.now();
});

window.addEventListener("mouseup", (e) => {
  if (!attack.dragging) return;
  attack.dragging = false;

  const dt = Math.max(1, performance.now() - attack.startTime);
  const len = Math.hypot(attack.dragDX, attack.dragDY);

  // Long wipe requirement (works in pointer lock)
  // (If not locked, movementX/Y can be 0; so we also consider screen drag from swipe canvas below.)
  let ok = len > 160 && (len / dt) > 0.35;

  // Fallback for non-locked “cursor drag”
  if (!locked) {
    // Use the last swipe line on overlay (we keep it updated)
    // If you don't drag much, len might be small; so let it be easier outside lock.
    ok = len > 80 || ok;
  }

  if (!ok) return;

  // Compute swipe power
  const speed = len / dt; // px/ms
  attack.power = clamp(0.8 + (len * 0.004) + (speed * 0.9), 1.0, 3.0);

  // Trigger animation + apply hit once (on swing start)
  startWipeSwing();
});

function startWipeSwing(){
  if (attack.active) return;
  attack.active = true;
  attack.animT = 0;
  blip(420, 0.01, 0.05);

  // Apply melee hit in WORLD SPACE (reliable)
  // Doom-ish: distance + angle cone
  const reach = 2.2 + (attack.power - 1) * 0.35;  // up to ~2.7
  const cone = (28 * Math.PI / 180) + (attack.power - 1) * (8 * Math.PI / 180);

  for (const m of monsters){
    if (m.state === "dead") continue;
    const dx = m.x - PLAYER.x;
    const dy = m.y - PLAYER.y;
    const d = Math.hypot(dx,dy);
    if (d > reach) continue;

    const angTo = Math.atan2(dy, dx);
    const da = Math.abs(angNorm(angTo - PLAYER.a));
    if (da > cone) continue;

    const dmg = clamp(18 * attack.power, 18, 55);
    damageMonster(m, dmg);
  }
}

function damageMonster(m, dmg){
  m.hp -= dmg;
  m.state = (m.hp <= 0) ? "dead" : "hurt";
  m.hurtT = 0.35;
  m.aggroT = 3.0;

  // knockback away from player
  if (m.hp > 0){
    const ax = m.x - PLAYER.x;
    const ay = m.y - PLAYER.y;
    const d = Math.max(0.001, Math.hypot(ax,ay));
    m.vx += (ax/d) * 2.2;
    m.vy += (ay/d) * 2.2;
  }

  // drop carried flowers if hurt (not dead)
  if (m.carried > 0 && m.hp > 0) {
    for (let i=0; i<m.carried; i++){
      flowers.push({
        x: m.x + (Math.random()-0.5)*0.6,
        y: m.y + (Math.random()-0.5)*0.6,
        alive: true
      });
    }
    m.carried = 0;
  }

  blip(180, 0.03, 0.03);
  if (m.hp <= 0) blip(90, 0.06, 0.06);
}

// --- Doors ---
function tryUseDoor(){
  const fx = PLAYER.x + Math.cos(PLAYER.a)*0.8;
  const fy = PLAYER.y + Math.sin(PLAYER.a)*0.8;
  const mx = Math.floor(fx), my = Math.floor(fy);
  if (!inBounds(mx,my)) return;
  if (map[my][mx] === 2) {
    map[my][mx] = 3;
    blip(240, 0.01, 0.08);
  }
}

// --- Resize ---
function resize(){
  canvas.width = Math.floor(RENDER_W * DPR);
  canvas.height = Math.floor(RENDER_H * DPR);
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  ctx.imageSmoothingEnabled = false;

  swipeCanvas.width = Math.floor(window.innerWidth * DPR);
  swipeCanvas.height = Math.floor(window.innerHeight * DPR);
  swipeCanvas.style.width = "100%";
  swipeCanvas.style.height = "100%";
}
window.addEventListener("resize", resize);
resize();

// --- Raycast ---
function castRay(rayA){
  const sin = Math.sin(rayA);
  const cos = Math.cos(rayA);

  let x = PLAYER.x, y = PLAYER.y;
  let mapX = Math.floor(x), mapY = Math.floor(y);

  const deltaDistX = Math.abs(1 / (cos || 1e-6));
  const deltaDistY = Math.abs(1 / (sin || 1e-6));

  let stepX, stepY;
  let sideDistX, sideDistY;

  if (cos < 0) { stepX = -1; sideDistX = (x - mapX) * deltaDistX; }
  else { stepX = 1; sideDistX = (mapX + 1.0 - x) * deltaDistX; }

  if (sin < 0) { stepY = -1; sideDistY = (y - mapY) * deltaDistY; }
  else { stepY = 1; sideDistY = (mapY + 1.0 - y) * deltaDistY; }

  let hit = 0;
  let side = 0;
  let dist = 0;
  let u = 0;

  while (!hit && dist < MAX_DIST) {
    if (sideDistX < sideDistY) {
      sideDistX += deltaDistX;
      mapX += stepX;
      side = 0;
    } else {
      sideDistY += deltaDistY;
      mapY += stepY;
      side = 1;
    }
    if (!inBounds(mapX,mapY)) { hit = 1; break; }
    const c = map[mapY][mapX];
    if (isSolidCell(c)) hit = c;
  }

  dist = (side === 0) ? (sideDistX - deltaDistX) : (sideDistY - deltaDistY);

  const hitX = PLAYER.x + cos * dist;
  const hitY = PLAYER.y + sin * dist;
  u = (side === 0) ? (hitY - Math.floor(hitY)) : (hitX - Math.floor(hitX));

  return { hit, dist, side, u };
}

function shadeColor([r,g,b], mul){
  return `rgb(${(r*mul)|0},${(g*mul)|0},${(b*mul)|0})`;
}

const wallPalette = {
  1: [160, 70, 60],
  2: [70, 140, 170],
};

function projectSprite(x, y){
  const dx = x - PLAYER.x;
  const dy = y - PLAYER.y;

  const sinA = Math.sin(PLAYER.a);
  const cosA = Math.cos(PLAYER.a);

  // camera space
  const cx = dx * cosA + dy * sinA;
  const cy = -dx * sinA + dy * cosA;

  if (cx <= 0.1) return null;

  const f = (RENDER_W/2) / Math.tan(FOV/2);
  const sx = (RENDER_W/2) + (cy / cx) * f;
  const depth = cx;
  return { sx, depth };
}

// --- Rendering ---
function drawScene(dt){
  const W = canvas.width, H = canvas.height;
  ctx.clearRect(0,0,W,H);

  // mouselook
  PLAYER.a += mouseDX * 0.0022;
  mouseDX = 0;

  // floor/ceiling
  ctx.fillStyle = "rgb(16,16,18)";
  ctx.fillRect(0,0,W, H/2);
  ctx.fillStyle = "rgb(10,10,10)";
  ctx.fillRect(0,H/2,W, H/2);

  const depthBuffer = new Float32Array(RENDER_W);

  for (let x=0; x<RENDER_W; x++){
    const cameraX = (2*x/RENDER_W - 1);
    const rayA = PLAYER.a + Math.atan(cameraX * Math.tan(FOV/2));

    const ray = castRay(rayA);
    const dist = Math.max(0.001, ray.dist * Math.cos(rayA - PLAYER.a));
    depthBuffer[x] = dist;

    const lineH = Math.min(H, (H / dist));
    const y0 = (H/2 - lineH/2);

    const base = wallPalette[ray.hit] || [120,120,120];
    const sideMul = ray.side ? 0.75 : 1.0;
    const fogMul = clamp(1.2 - dist*0.05, 0.2, 1.0);
    const stripe = (Math.floor(ray.u * 10) % 2) ? 0.9 : 1.0;

    ctx.fillStyle = shadeColor(base, sideMul * fogMul * stripe);

    ctx.fillRect(
      Math.floor(x * (W/RENDER_W)),
      Math.floor(y0),
      Math.ceil(W/RENDER_W),
      Math.ceil(lineH)
    );
  }

  // sprites (FIXED: use center-column depth test; draw once)
  renderSprites(depthBuffer);

  // hurt flash
  if (PLAYER.hurtFlash > 0){
    PLAYER.hurtFlash = Math.max(0, PLAYER.hurtFlash - dt*1.5);
    ctx.fillStyle = `rgba(255,0,0,${0.18*PLAYER.hurtFlash})`;
    ctx.fillRect(0,0,W,H);
  }

  if (minimapOn) drawMinimap();
  drawWipeAnimation(dt);
  drawSwipeOverlay();
}

function renderSprites(depthBuffer){
  const sprites = [];

  for (const fl of flowers){
    if (!fl.alive) continue;
    const p = projectSprite(fl.x, fl.y);
    if (!p) continue;
    sprites.push({ kind:"flower", ...p, ref: fl, x: fl.x, y: fl.y });
  }
  for (const mk of medkits){
    if (!mk.alive) continue;
    const p = projectSprite(mk.x, mk.y);
    if (!p) continue;
    sprites.push({ kind:"medkit", ...p, ref: mk, x: mk.x, y: mk.y });
  }
  for (const m of monsters){
    if (m.state === "dead") continue;
    const p = projectSprite(m.x, m.y);
    if (!p) continue;
    sprites.push({ kind:"monster", ...p, ref: m, x: m.x, y: m.y });
  }

  sprites.sort((a,b) => b.depth - a.depth);

  const W = canvas.width, H = canvas.height;
  const scaleX = W / RENDER_W;
  const colW = W / RENDER_W;

  for (const sp of sprites){
    const size = clamp((H / sp.depth) * 0.8, 2, H*1.2);
    const screenX = sp.sx * scaleX;
    const screenY = (H/2) - size/2;

    // center-column depth test
    const centerCol = clamp(Math.floor((screenX / colW)), 0, RENDER_W-1);
    if (sp.depth >= depthBuffer[centerCol]) continue;

    if (sp.kind === "flower") {
      ctx.save();
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = "rgb(250,120,200)";
      ctx.beginPath();
      ctx.arc(screenX, screenY + size*0.68, size*0.10, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = "rgb(255,220,80)";
      ctx.beginPath();
      ctx.arc(screenX, screenY + size*0.68, size*0.05, 0, Math.PI*2);
      ctx.fill();
      ctx.fillStyle = "rgb(80,220,120)";
      ctx.fillRect(screenX - size*0.01, screenY + size*0.72, size*0.02, size*0.18);
      ctx.restore();
      continue;
    }

    if (sp.kind === "medkit") {
      ctx.save();
      ctx.globalAlpha = 0.95;
      ctx.fillStyle = "rgb(220,220,220)";
      ctx.fillRect(screenX - size*0.12, screenY + size*0.62, size*0.24, size*0.16);
      ctx.fillStyle = "rgb(220,50,50)";
      ctx.fillRect(screenX - size*0.03, screenY + size*0.635, size*0.06, size*0.11);
      ctx.fillRect(screenX - size*0.07, screenY + size*0.675, size*0.14, size*0.03);
      ctx.restore();
      continue;
    }

    if (sp.kind === "monster") {
      const m = sp.ref;

      // store projected info (optional now, still useful)
      m.depth = sp.depth;
      m.sx = screenX;
      m.sy = screenY;
      m.sw = size;
      m.sh = size;

      ctx.save();
      const hurtPulse = (m.hurtT > 0) ? 0.45 : 0.0;
      const bodyTop = screenY + size*0.45;
      const bodyH = size*0.35;
      const bodyW = size*0.28;

      ctx.globalAlpha = 0.98;
      ctx.fillStyle = hurtPulse ? "rgb(255,90,90)" : "rgb(140,200,255)";
      ctx.fillRect(screenX - bodyW/2, bodyTop, bodyW, bodyH);

      ctx.fillStyle = hurtPulse ? "rgb(255,140,140)" : "rgb(190,240,255)";
      ctx.beginPath();
      ctx.arc(screenX, screenY + size*0.40, size*0.12, 0, Math.PI*2);
      ctx.fill();

      ctx.fillStyle = "rgb(10,10,10)";
      ctx.beginPath();
      ctx.arc(screenX - size*0.045, screenY + size*0.385, size*0.018, 0, Math.PI*2);
      ctx.arc(screenX + size*0.045, screenY + size*0.385, size*0.018, 0, Math.PI*2);
      ctx.fill();

      ctx.strokeStyle = hurtPulse ? "rgb(255,110,110)" : "rgb(120,190,240)";
      ctx.lineWidth = Math.max(1, size*0.03);
      ctx.beginPath();
      ctx.moveTo(screenX - bodyW/2, bodyTop + bodyH*0.25);
      ctx.lineTo(screenX - bodyW/2 - size*0.10, bodyTop + bodyH*0.55);
      ctx.moveTo(screenX + bodyW/2, bodyTop + bodyH*0.25);
      ctx.lineTo(screenX + bodyW/2 + size*0.10, bodyTop + bodyH*0.55);
      ctx.stroke();

      if (m.carried > 0) {
        ctx.fillStyle = "rgb(255,220,80)";
        ctx.fillRect(screenX - size*0.12, screenY + size*0.80, size*0.24, size*0.03);
      }

      ctx.restore();
    }
  }
}

function drawMinimap(){
  const scale = 7 * DPR;
  const pad = 10 * DPR;
  const ox = pad, oy = pad;

  ctx.save();
  ctx.globalAlpha = 0.95;
  ctx.fillStyle = "rgba(0,0,0,0.45)";
  ctx.fillRect(ox-6, oy-6, MAP_W*scale+12, MAP_H*scale+12);

  for (let y=0; y<MAP_H; y++){
    for (let x=0; x<MAP_W; x++){
      const c = map[y][x];
      if (c === 0 || c === 3) continue;
      ctx.fillStyle = (c===2) ? "rgb(80,160,190)" : "rgb(170,70,60)";
      ctx.fillRect(ox + x*scale, oy + y*scale, scale, scale);
    }
  }

  ctx.fillStyle = "rgb(250,120,200)";
  for (const fl of flowers) if (fl.alive)
    ctx.fillRect(ox + fl.x*scale - 1, oy + fl.y*scale - 1, 2, 2);

  ctx.fillStyle = "rgb(220,220,220)";
  for (const mk of medkits) if (mk.alive)
    ctx.fillRect(ox + mk.x*scale - 1, oy + mk.y*scale - 1, 2, 2);

  ctx.fillStyle = "rgb(140,200,255)";
  for (const m of monsters) if (m.state !== "dead")
    ctx.fillRect(ox + m.x*scale - 1, oy + m.y*scale - 1, 2, 2);

  ctx.fillStyle = "rgb(255,255,255)";
  ctx.fillRect(ox + PLAYER.x*scale - 1, oy + PLAYER.y*scale - 1, 2, 2);
  ctx.strokeStyle = "rgb(255,255,255)";
  ctx.beginPath();
  ctx.moveTo(ox + PLAYER.x*scale, oy + PLAYER.y*scale);
  ctx.lineTo(ox + (PLAYER.x + Math.cos(PLAYER.a)*0.8)*scale, oy + (PLAYER.y + Math.sin(PLAYER.a)*0.8)*scale);
  ctx.stroke();

  ctx.restore();
}

function drawSwipeOverlay(){
  // purely visual: show drag line even when not locked (cursor moves)
  sctx.clearRect(0,0,swipeCanvas.width, swipeCanvas.height);
  if (!attack.dragging) return;

  // In pointer lock, client coords don't change much; draw “direction” line from center.
  const cx = (window.innerWidth * 0.5) * DPR;
  const cy = (window.innerHeight * 0.5) * DPR;
  const x2 = cx + attack.dragDX * 1.2 * DPR;
  const y2 = cy + attack.dragDY * 1.2 * DPR;

  sctx.lineWidth = 4 * DPR;
  sctx.strokeStyle = "rgba(255,255,255,0.65)";
  sctx.beginPath();
  sctx.moveTo(cx, cy);
  sctx.lineTo(x2, y2);
  sctx.stroke();
}

// --- Wipe animation (big “arc” on HUD) ---
function drawWipeAnimation(dt){
  if (!attack.active) return;

  attack.animT += dt * 5.0; // speed of swing
  const t = clamp(attack.animT, 0, 1);

  // End
  if (t >= 1){
    attack.active = false;
    attack.animT = 0;
    return;
  }

  // Render a bright arc sweeping across the screen (Doom-ish melee)
  const W = canvas.width, H = canvas.height;

  // arc params
  const intensity = (t < 0.5) ? (t/0.5) : ((1-t)/0.5);
  const alpha = 0.55 * intensity;
  const arcR = Math.min(W,H) * (0.22 + 0.03 * attack.power);

  // Sweep angle
  const a0 = (-0.9 + 1.8 * t);
  const a1 = a0 + 0.6;

  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.lineWidth = Math.max(2, 10 * DPR);
  ctx.strokeStyle = "rgba(255,255,255,0.95)";
  ctx.shadowColor = "rgba(255,255,255,0.35)";
  ctx.shadowBlur = 12 * DPR;

  const px = W * 0.52;
  const py = H * 0.62;

  ctx.beginPath();
  ctx.arc(px, py, arcR, a0, a1);
  ctx.stroke();

  // little streak
  ctx.globalAlpha = alpha * 0.65;
  ctx.lineWidth = Math.max(1, 6 * DPR);
  ctx.beginPath();
  ctx.arc(px + arcR*0.15, py + arcR*0.05, arcR*0.65, a0 + 0.15, a1 + 0.15);
  ctx.stroke();

  ctx.restore();
}

// --- Monster AI ---
function findNearestFlower(x,y){
  let best = -1;
  let bestD = 1e9;
  for (let i=0; i<flowers.length; i++){
    const fl = flowers[i];
    if (!fl.alive) continue;
    const d = dist2(x,y,fl.x,fl.y);
    if (d < bestD){ bestD = d; best = i; }
  }
  return best;
}

function moveEntityToward(m, tx, ty, dt, spd){
  const dx = tx - m.x;
  const dy = ty - m.y;
  const d = Math.hypot(dx,dy) || 1;
  m.vx += (dx/d) * spd;
  m.vy += (dy/d) * spd;
}

function roam(m, dt){
  if (!m._roamT || m._roamT <= 0){
    m._roamT = 1.2 + Math.random()*1.8;
    m._roamA = Math.random()*Math.PI*2;
  } else m._roamT -= dt;

  m.vx += Math.cos(m._roamA) * 0.6;
  m.vy += Math.sin(m._roamA) * 0.6;
}

// --- Update ---
function update(dt){
  // Movement
  const fwd = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
  const str = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);

  const cos = Math.cos(PLAYER.a);
  const sin = Math.sin(PLAYER.a);

  let ax = (cos * fwd + Math.cos(PLAYER.a + Math.PI/2) * str);
  let ay = (sin * fwd + Math.sin(PLAYER.a + Math.PI/2) * str);
  const mag = Math.hypot(ax, ay) || 1;
  ax /= mag; ay /= mag;

  const speed = PLAYER.moveSpeed * dt;
  const nx = PLAYER.x + ax * speed;
  const ny = PLAYER.y + ay * speed;

  if (!collideCircle(nx, PLAYER.y, PLAYER.radius)) PLAYER.x = nx;
  if (!collideCircle(PLAYER.x, ny, PLAYER.radius)) PLAYER.y = ny;

  // Pickups
  for (const mk of medkits){
    if (!mk.alive) continue;
    if (dist2(PLAYER.x,PLAYER.y,mk.x,mk.y) < 0.6*0.6) {
      mk.alive = false;
      PLAYER.hp = clamp(PLAYER.hp + 35, 0, 100);
      blip(520, 0.01, 0.06);
    }
  }

  // Monsters
  let aliveCount = 0;
  for (const m of monsters){
    if (m.state === "dead") continue;
    aliveCount++;

    if (m.hurtT > 0) m.hurtT = Math.max(0, m.hurtT - dt);

    m.vx *= Math.pow(0.0001, dt);
    m.vy *= Math.pow(0.0001, dt);

    if (m.aggroT > 0) {
      m.aggroT = Math.max(0, m.aggroT - dt);
      if (m.state !== "hurt") m.state = "chase";
    } else if (m.state !== "collect") m.state = "collect";

    if (m.state === "collect") {
      if (m.targetFlowerId < 0 || !flowers[m.targetFlowerId] || !flowers[m.targetFlowerId].alive) {
        m.targetFlowerId = findNearestFlower(m.x, m.y);
      }
      if (m.targetFlowerId >= 0) {
        const fl = flowers[m.targetFlowerId];
        moveEntityToward(m, fl.x, fl.y, dt, 1.15);
        if (dist2(m.x,m.y,fl.x,fl.y) < 0.35*0.35) {
          fl.alive = false;
          m.carried++;
          flowersStolen++;
          blip(320, 0.01, 0.04);
          m.targetFlowerId = -1;
        }
      } else roam(m, dt);
    } else {
      moveEntityToward(m, PLAYER.x, PLAYER.y, dt, 1.75);

      const d2p = dist2(m.x,m.y,PLAYER.x,PLAYER.y);
      if (d2p < 0.75*0.75) {
        m._atkCd -= dt;
        if (m._atkCd <= 0){
          m._atkCd = 0.7;
          PLAYER.hp = clamp(PLAYER.hp - 10, 0, 100);
          PLAYER.hurtFlash = 1;
          blip(110, 0.01, 0.05);
        }
      }
    }

    // integrate with collision
    const mr = 0.2;
    const mx = m.x + m.vx * dt;
    const my = m.y + m.vy * dt;
    if (!collideCircle(mx, m.y, mr)) m.x = mx;
    if (!collideCircle(m.x, my, mr)) m.y = my;

    if (m.hp <= 0) m.state = "dead";
  }

  // UI
  hpText.textContent = String(Math.floor(PLAYER.hp));
  healthFill.style.width = `${PLAYER.hp}%`;
  stolenText.textContent = String(flowersStolen);
  monstersText.textContent = String(aliveCount);
}

// --- Main loop ---
let last = performance.now();

function loop(now){
  const dt = clamp((now - last) / 1000, 0, 0.05);
  last = now;

  if (PLAYER.hp <= 0){
    PLAYER.hp = 100;
    PLAYER.x = 3.5; PLAYER.y = 3.5; PLAYER.a = 0;
    PLAYER.hurtFlash = 1;
    flowers.length = 0;
    spawnFlowers();
    flowersStolen = 0;
    spawnMonsters();
  }

  update(dt);
  drawScene(dt);

  requestAnimationFrame(loop);
}

// init
spawnFlowers();
spawnMedkits();
spawnMonsters();
requestAnimationFrame(loop);
