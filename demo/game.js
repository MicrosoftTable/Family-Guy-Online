// Clean-room FGO preservation demo: raw WebGL, no dependencies.
// Loads real extracted zone meshes (OBJ) + textures (PNG) listed in manifest.json.
const $ = (id) => document.getElementById(id);
const canvas = $('gl');
const gl = canvas.getContext('webgl', { antialias: true, alpha: false });
if (!gl) { document.body.innerHTML = '<p style="padding:2em">WebGL not available.</p>'; throw 0; }
const ROOT = '../';                       // repo root served by the static server
const log = (m) => { $('log').innerHTML += `<div>${m}</div>`; };
// ---------- math ----------
const m4 = {
  persp(f, a, n, fa) { const t = 1 / Math.tan(f / 2), r = 1 / (n - fa);
    return [t / a,0,0,0, 0,t,0,0, 0,0,(n + fa) * r,-1, 0,0,2 * n * fa * r,0]; },
  look(e, c, u = [0, 1, 0]) {
    let z = norm(sub(e, c)), x = norm(cross(u, z)), y = cross(z, x);
    return [x[0],y[0],z[0],0, x[1],y[1],z[1],0, x[2],y[2],z[2],0, -dot(x,e),-dot(y,e),-dot(z,e),1]; },
  mul(a, b) { const o = new Array(16);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++)
      o[j*4+i] = a[i]*b[j*4] + a[4+i]*b[j*4+1] + a[8+i]*b[j*4+2] + a[12+i]*b[j*4+3]; return o; },
  trs(p, yaw, s) { const c = Math.cos(yaw), si = Math.sin(yaw);
    return [c*s[0],0,-si*s[0],0, 0,s[1],0,0, si*s[2],0,c*s[2],0, p[0],p[1],p[2],1]; },
};
function sub(a, b) { return [a[0]-b[0], a[1]-b[1], a[2]-b[2]]; }
function dot(a, b) { return a[0]*b[0] + a[1]*b[1] + a[2]*b[2]; }
function cross(a, b) { return [a[1]*b[2]-a[2]*b[1], a[2]*b[0]-a[0]*b[2], a[0]*b[1]-a[1]*b[0]]; }
function norm(a) { const l = Math.hypot(...a) || 1; return [a[0]/l, a[1]/l, a[2]/l]; }
// ---------- shaders ----------
function prog(vs, fs) {
  const mk = (t, s) => { const h = gl.createShader(t); gl.shaderSource(h, s); gl.compileShader(h);
    if (!gl.getShaderParameter(h, gl.COMPILE_STATUS)) throw gl.getShaderInfoLog(h); return h; };
  const p = gl.createProgram(); gl.attachShader(p, mk(gl.VERTEX_SHADER, vs)); gl.attachShader(p, mk(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw gl.getProgramInfoLog(p); return p;
}
const SKY = [0.62, 0.82, 0.95];
const worldP = prog(`attribute vec3 p;attribute vec2 uv;attribute vec3 col;uniform mat4 vp;varying vec2 v;varying float d;varying vec3 bc;
void main(){vec4 c=vp*vec4(p,1.);gl_Position=c;v=uv;d=c.w;bc=col;}`,
`precision mediump float;uniform sampler2D t;uniform vec3 fog;uniform float mode;varying vec2 v;varying float d;varying vec3 bc;
void main(){vec4 c=texture2D(t,v);vec3 o;
 if(mode<.5){if(c.a<.5)discard;o=c.rgb;}            // palette / colour textures
 else if(mode<1.5){o=mix(bc,c.rgb,c.a);}             // detail overlay on a tinted base
 else {o=bc;}                                         // flat colour (ground / stand-in walls)
 float f=clamp((d-90.)/160.,0.,1.);gl_FragColor=vec4(mix(o,fog,f),1.);}`);
const solidP = prog(`attribute vec3 p;uniform mat4 vp;uniform mat4 m;void main(){gl_Position=vp*m*vec4(p,1.);}`,
`precision mediump float;uniform vec3 col;void main(){gl_FragColor=vec4(col,1.);}`);
// ---------- OBJ -> non-indexed pos/uv ----------
function parseObj(text) {
  const P = [], T = [], out = [], tris = [];
  let i = 0; const n = text.length;
  while (i < n) {
    let e = text.indexOf('\n', i); if (e < 0) e = n;
    const c0 = text.charCodeAt(i), c1 = text.charCodeAt(i + 1);
    if (c0 === 118 && c1 === 32) { const s = text.slice(i + 2, e).trim().split(/\s+/); P.push(+s[0], +s[1], +s[2]); }
    else if (c0 === 118 && c1 === 116) { const s = text.slice(i + 3, e).trim().split(/\s+/); T.push(+s[0], +s[1]); }
    else if (c0 === 102 && c1 === 32) {
      const cs = text.slice(i + 2, e).trim().split(/\s+/).map(x => { const q = x.split('/'); return [(+q[0]) - 1, q[1] ? (+q[1]) - 1 : -1]; });
      for (let k = 1; k + 1 < cs.length; k++) for (const c of [cs[0], cs[k], cs[k + 1]]) {
        const a = c[0] < 0 ? P.length / 3 + c[0] + 1 : c[0], b = c[1];
        if (a < 0 || a * 3 + 2 >= P.length) continue;
        out.push(P[a*3], P[a*3+1], P[a*3+2], b >= 0 ? T[b*2] : 0, b >= 0 ? T[b*2+1] : 0);
      }
    }
    i = e + 1;
  }
  return new Float32Array(out);
}
// ---------- spatial grid for collision ----------
const CELL = 8;
class TriGrid {
  constructor() { this.cells = new Map(); this.tris = []; }
  add(v) { // v: Float32Array stride 5
    for (let i = 0; i + 14 < v.length; i += 15) {
      const t = [v[i],v[i+1],v[i+2], v[i+5],v[i+6],v[i+7], v[i+10],v[i+11],v[i+12]];
      const id = this.tris.push(t) - 1;
      const x0 = Math.floor(Math.min(t[0],t[3],t[6]) / CELL), x1 = Math.floor(Math.max(t[0],t[3],t[6]) / CELL);
      const z0 = Math.floor(Math.min(t[2],t[5],t[8]) / CELL), z1 = Math.floor(Math.max(t[2],t[5],t[8]) / CELL);
      for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) {
        const k = x * 100003 + z; let a = this.cells.get(k); if (!a) this.cells.set(k, a = []); a.push(id);
      }
    }
  }
  near(minx, minz, maxx, maxz) {
    const s = new Set();
    for (let x = Math.floor(minx / CELL); x <= Math.floor(maxx / CELL); x++)
      for (let z = Math.floor(minz / CELL); z <= Math.floor(maxz / CELL); z++)
        for (const id of this.cells.get(x * 100003 + z) || []) s.add(id);
    return s;
  }
  // Möller–Trumbore; returns nearest t along dir (dir normalised) or Infinity
  ray(o, d, maxT, ids) {
    let best = Infinity;
    for (const id of ids) {
      const t = this.tris[id];
      const e1 = [t[3]-t[0], t[4]-t[1], t[5]-t[2]], e2 = [t[6]-t[0], t[7]-t[1], t[8]-t[2]];
      const h = cross(d, e2), a = dot(e1, h); if (Math.abs(a) < 1e-9) continue;
      const f = 1 / a, s = [o[0]-t[0], o[1]-t[1], o[2]-t[2]], u = f * dot(s, h); if (u < 0 || u > 1) continue;
      const q = cross(s, e1), v = f * dot(d, q); if (v < 0 || u + v > 1) continue;
      const tt = f * dot(e2, q); if (tt > 1e-4 && tt < maxT && tt < best) best = tt;
    }
    return best;
  }
}
const ground = new TriGrid(), walls = new TriGrid();
// ---------- loading ----------
const drawables = [];
const PASTELS = [[.95,.85,.45],[.62,.75,.9],[.93,.62,.68],[.7,.85,.6],[.9,.75,.55],[.85,.85,.8],[.75,.7,.9],[.6,.85,.82]];
const GROUND_COL = { grass: [.42,.74,.32], dirt: [.58,.44,.30], cement: [.70,.70,.72], water: [.35,.62,.88], indoor: [.78,.66,.48], carpet: [.7,.55,.5], wood: [.65,.48,.3] };
function hashCol(x, z) { const h = (Math.floor(x / 16) * 73856093 ^ Math.floor(z / 16) * 19349663) >>> 0; return PASTELS[h % PASTELS.length]; }
function baseFor(name, x, z) {
  if (/Roof|Shingle/i.test(name)) { const c = hashCol(x, z); return [c[0]*.45+.12, c[1]*.35+.12, c[2]*.35+.14]; }
  if (/Grass/i.test(name)) return GROUND_COL.grass; if (/Brick/i.test(name)) return [.72,.36,.28];
  if (/Gravel|Sand|Dirt/i.test(name)) return [.66,.6,.52]; if (/Sidewalk|Tile|Checkered/i.test(name)) return [.84,.84,.82];
  if (/Carpet/i.test(name)) return [.72,.52,.48]; if (/Wood/i.test(name)) return [.66,.48,.3];
  return hashCol(x, z);   // siding etc: per-house pastel (original used vertex colours not present in the OBJ export)
}
function packVerts(v, mode, nameOrCol) {
  const n = v.length / 5, o = new Float32Array(n * 8);
  for (let i = 0; i < n; i++) {
    o.set(v.subarray(i * 5, i * 5 + 5), i * 8);
    const c = mode === 2 ? nameOrCol : mode === 3 ? hashCol(v[i*5], v[i*5+2]) : mode === 1 ? baseFor(nameOrCol, v[i*5], v[i*5+2]) : [1,1,1];
    o[i*8+5] = c[0]; o[i*8+6] = c[1]; o[i*8+7] = c[2];
    if (mode === 2) o[i*8+1] -= 0.02;
  }
  return o;
}
function addDrawable(v, mode, tex, label, colOrName) {
  const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b); gl.bufferData(gl.ARRAY_BUFFER, packVerts(v, mode, colOrName), gl.STATIC_DRAW);
  drawables.push({ b, n: v.length / 5, t: tex, mode, name: label });
}
const texCache = new Map();
function loadTex(url) {
  if (!url) url = null;
  if (texCache.has(url)) return texCache.get(url);
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([200, 200, 200, 255]));
  texCache.set(url, t);
  if (url) { const im = new Image(); im.onload = () => {
    gl.bindTexture(gl.TEXTURE_2D, t); gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, im);
    const pot = (n) => (n & (n - 1)) === 0;
    if (pot(im.width) && pot(im.height)) { gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT); }
    else { gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  }; im.src = ROOT + encodeURI(url).replace(/#/g, '%23'); }
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  return t;
}
const fetchObj = async (p) => parseObj(await (await fetch(ROOT + encodeURI(p).replace(/#/g, '%23'))).text());
const ground_bounds = { minx: 1e9, maxx: -1e9, minz: 1e9, maxz: -1e9 }, groundPts = [];
async function load() {
  const man = await (await fetch('manifest.json')).json();
  const jobs = [...man.ground.map(p => ({ k: 'g', p })), ...man.wall.map(p => ({ k: 'w', p })), ...man.render.map(r => ({ k: 'r', p: r.mesh, r }))];
  let done = 0, next = 0;
  const worker = async () => { while (next < jobs.length) { const j = jobs[next++];
    try { const v = await fetchObj(j.p);
      if (j.k === 'g') { ground.add(v); const kind = Object.keys(GROUND_COL).find(k => j.p.includes('collisionGround_' + k)) || 'cement';
        addDrawable(v, 2, loadTex(null), j.p, GROUND_COL[kind]); for (let i = 0; i < v.length; i += 15) { const x = v[i], z = v[i+2];
        ground_bounds.minx = Math.min(ground_bounds.minx, x); ground_bounds.maxx = Math.max(ground_bounds.maxx, x);
        ground_bounds.minz = Math.min(ground_bounds.minz, z); ground_bounds.maxz = Math.max(ground_bounds.maxz, z); groundPts.push(x, z); } }
      else if (j.k === 'w') { walls.add(v);
        if (/collision_geo|collisionProp/.test(j.p) && !location.search.includes('nowalls')) addDrawable(v, 3, loadTex(null), j.p, j.p); }
      else if (v.length) { const dtl = (j.r.tex || '').includes('_dtl'); addDrawable(v, dtl ? 1 : 0, loadTex(j.r.tex), j.r.name, j.r.name); }
    } catch (e) { console.warn('skip', j.p, e); }
    $('lp').style.width = (++done / jobs.length * 100) + '%'; $('lt').textContent = `${done}/${jobs.length} meshes`; } };
  await Promise.all(Array.from({ length: 6 }, worker));
}
// ---------- player + camera ----------
const player = { p: [0, 0, 0], yaw: 0, vy: 0, onGround: false, walk: 0 };
const cam = { yaw: Math.PI, pitch: 0.35, dist: 7 };
const keys = {};
addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'Space') e.preventDefault(); });
addEventListener('keyup', (e) => { keys[e.code] = false; });
let drag = false;
canvas.addEventListener('pointerdown', (e) => { drag = true; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointerup', () => { drag = false; });
canvas.addEventListener('pointermove', (e) => { if (!drag) return; cam.yaw -= e.movementX * 0.006; cam.pitch = Math.max(0.05, Math.min(1.3, cam.pitch + e.movementY * 0.004)); });
canvas.addEventListener('wheel', (e) => { cam.dist = Math.max(3, Math.min(18, cam.dist + e.deltaY * 0.01)); e.preventDefault(); }, { passive: false });
function groundAt(x, y, z, up = 0.8, down = 4) {
  const ids = ground.near(x - 0.01, z - 0.01, x + 0.01, z + 0.01);
  const t = ground.ray([x, y + up, z], [0, -1, 0], up + down, ids);
  return t === Infinity ? null : y + up - t;
}
function wallHit(x, y, z, dx, dz, len) {
  const d = norm([dx, 0, dz]); const ids = walls.near(Math.min(x, x + dx * len) - 0.5, Math.min(z, z + dz * len) - 0.5, Math.max(x, x + dx * len) + 0.5, Math.max(z, z + dz * len) + 0.5);
  return Math.min(walls.ray([x, y + 0.5, z], d, len, ids), walls.ray([x, y + 1.0, z], d, len, ids)) < len;
}
const R = 0.35;
function step(dt) {
  if (keys.KeyQ) cam.yaw += 1.8 * dt; if (keys.KeyE) cam.yaw -= 1.8 * dt;
  let ix = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  let iz = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const speed = (keys.ShiftLeft || keys.ShiftRight ? 9 : 5.2);
  if (ix || iz) {
    const l = Math.hypot(ix, iz); ix /= l; iz /= l;
    const fx = -Math.sin(cam.yaw), fz = -Math.cos(cam.yaw), rx = Math.cos(cam.yaw), rz = -Math.sin(cam.yaw);
    const dx = (fx * iz + rx * ix) * speed * dt, dz = (fz * iz + rz * ix) * speed * dt;
    const len = Math.hypot(dx, dz), [x, y, z] = player.p;
    const tryMove = (mx, mz) => { const L = Math.hypot(mx, mz); if (L < 1e-6) return false;
      if (wallHit(x, y, z, mx, mz, L + R)) return false;
      const g = groundAt(x + mx, y, z + mz, 0.6, 1.5); if (g === null) return false;
      player.p[0] += mx; player.p[2] += mz; return true; };
    if (!tryMove(dx, dz) && !tryMove(dx, 0)) tryMove(0, dz);
    const target = Math.atan2(dx, dz); let d = target - player.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    player.yaw += d * Math.min(1, dt * 14); player.walk += dt * speed * 1.6;
  } else player.walk = 0;
  const g = groundAt(player.p[0], player.p[1], player.p[2], 0.6, 6);
  if (keys.Space && player.onGround) { player.vy = 6.5; player.onGround = false; }
  player.vy -= 18 * dt; player.p[1] += player.vy * dt;
  if (g !== null && player.p[1] <= g) { player.p[1] = g; player.vy = 0; player.onGround = true; } else if (g === null || player.p[1] > g + 0.05) player.onGround = false;
}
// ---------- chibi player (placeholder primitives, original design) ----------
const cube = (() => { const v = []; const f = [[0,0,1],[0,0,-1],[1,0,0],[-1,0,0],[0,1,0],[0,-1,0]];
  for (const n of f) { const u = Math.abs(n[1]) ? [1,0,0] : [0,1,0], w = cross(n, u);
    const q = [[-1,-1],[1,-1],[1,1],[-1,1]].map(([a,b]) => [n[0]+u[0]*a+w[0]*b, n[1]+u[1]*a+w[1]*b, n[2]+u[2]*a+w[2]*b].map(x => x * 0.5));
    for (const i of [0,1,2,0,2,3]) v.push(...q[i]); } return new Float32Array(v); })();
const cubeBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuf); gl.bufferData(gl.ARRAY_BUFFER, cube, gl.STATIC_DRAW);
const PARTS = [ // [offset, scale, colour]  (y up from feet)
  [[0, 0.30, 0], [0.30, 0.55, 0.22], [0.2, 0.3, 0.55]],       // legs
  [[0, 0.78, 0], [0.42, 0.45, 0.26], [0.12, 0.12, 0.14]],      // torso
  [[0, 1.30, 0], [0.80, 0.70, 0.70], [0.93, 0.76, 0.58]],     // head
  [[0, 1.68, 0], [0.62, 0.14, 0.62], [0.35, 0.28, 0.20]],      // hat crown
  [[0, 1.60, 0], [1.00, 0.05, 1.00], [0.30, 0.24, 0.17]],     // brim
  [[-0.16, 1.33, 0.36], [0.17, 0.17, 0.04], [1, 1, 1]], [[0.16, 1.33, 0.36], [0.17, 0.17, 0.04], [1, 1, 1]],
  [[-0.16, 1.33, 0.385], [0.07, 0.07, 0.03], [0.05, 0.05, 0.05]], [[0.16, 1.33, 0.385], [0.07, 0.07, 0.03], [0.05, 0.05, 0.05]],
];
function drawPlayer(vp) {
  gl.useProgram(solidP); gl.bindBuffer(gl.ARRAY_BUFFER, cubeBuf);
  const loc = gl.getAttribLocation(solidP, 'p'); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 12, 0);
  gl.uniformMatrix4fv(gl.getUniformLocation(solidP, 'vp'), false, vp);
  const bob = Math.abs(Math.sin(player.walk)) * 0.06, sw = Math.sin(player.walk) * 0.0;
  for (const [o, s, c] of PARTS) {
    const cy = Math.cos(player.yaw), sy = Math.sin(player.yaw);
    const wp = [player.p[0] + o[0]*cy + o[2]*sy, player.p[1] + o[1] + bob, player.p[2] - o[0]*sy + o[2]*cy];
    gl.uniformMatrix4fv(gl.getUniformLocation(solidP, 'm'), false, m4.trs(wp, player.yaw, s));
    gl.uniform3fv(gl.getUniformLocation(solidP, 'col'), c); gl.drawArrays(gl.TRIANGLES, 0, 36);
  }
}
// ---------- minimap ----------
const mm = $('mm'), mc = mm.getContext('2d'); let mmBase = null;
function buildMini() {
  const b = ground_bounds, W = mm.width, H = mm.height; mmBase = document.createElement('canvas'); mmBase.width = W; mmBase.height = H;
  const c = mmBase.getContext('2d'); c.fillStyle = '#2f6b3a'; c.fillRect(0, 0, W, H); c.fillStyle = '#9fd68a';
  const sx = W / (b.maxx - b.minx), sz = H / (b.maxz - b.minz);
  for (let i = 0; i < groundPts.length; i += 2) c.fillRect((groundPts[i] - b.minx) * sx, (groundPts[i+1] - b.minz) * sz, 2, 2);
}
function drawMini() {
  if (!mmBase) return; const b = ground_bounds; mc.drawImage(mmBase, 0, 0);
  mc.fillStyle = '#fff'; mc.strokeStyle = '#e33'; mc.lineWidth = 2; mc.beginPath();
  mc.arc((player.p[0] - b.minx) / (b.maxx - b.minx) * mm.width, (player.p[2] - b.minz) / (b.maxz - b.minz) * mm.height, 4, 0, 7); mc.fill(); mc.stroke();
}
// ---------- main loop ----------
function resize() { const r = devicePixelRatio || 1; canvas.width = innerWidth * r; canvas.height = innerHeight * r; gl.viewport(0, 0, canvas.width, canvas.height); }
addEventListener('resize', resize); resize();
let last = performance.now();
const wl = { p: gl.getAttribLocation(worldP, 'p'), uv: gl.getAttribLocation(worldP, 'uv'), col: gl.getAttribLocation(worldP, 'col') }; const modeLoc = gl.getUniformLocation(worldP, 'mode');
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now; step(dt);
  gl.clearColor(...(location.search.includes("bg") ? [1,0,1] : SKY), 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT); gl.enable(gl.DEPTH_TEST);
  const tgt = [player.p[0], player.p[1] + 1.2, player.p[2]];
  const cp = Math.cos(cam.pitch), eye = [tgt[0] + Math.sin(cam.yaw) * cp * cam.dist, tgt[1] + Math.sin(cam.pitch) * cam.dist, tgt[2] + Math.cos(cam.yaw) * cp * cam.dist];
  const vp = m4.mul(m4.persp(0.9, canvas.width / canvas.height, 0.2, 600), m4.look(eye, tgt));
  gl.useProgram(worldP); gl.uniformMatrix4fv(gl.getUniformLocation(worldP, 'vp'), false, vp); gl.uniform3fv(gl.getUniformLocation(worldP, 'fog'), SKY);
  gl.uniform1i(gl.getUniformLocation(worldP, 't'), 0);  gl.enableVertexAttribArray(wl.p); gl.enableVertexAttribArray(wl.uv); gl.enableVertexAttribArray(wl.col);
  const ONLY = new URLSearchParams(location.search).get('only');
  for (const d of drawables) { if (ONLY && (ONLY[0] === '=' ? d.name !== ONLY.slice(1) : !d.name.includes(ONLY))) continue; gl.bindBuffer(gl.ARRAY_BUFFER, d.b); gl.vertexAttribPointer(wl.p, 3, gl.FLOAT, false, 32, 0); gl.vertexAttribPointer(wl.uv, 2, gl.FLOAT, false, 32, 12); gl.vertexAttribPointer(wl.col, 3, gl.FLOAT, false, 32, 20); gl.uniform1f(modeLoc, d.mode === 3 ? 2 : d.mode);
    gl.bindTexture(gl.TEXTURE_2D, d.t); gl.drawArrays(gl.TRIANGLES, 0, d.n); }
  gl.disableVertexAttribArray(wl.uv); gl.disableVertexAttribArray(wl.col); drawPlayer(vp); drawMini(); requestAnimationFrame(frame);
}
// hotbar
for (let i = 1; i <= 8; i++) { const s = document.createElement('div'); s.className = 'slot' + (i === 1 ? ' on' : ''); s.textContent = i; $('bar').appendChild(s); }
log('Welcome to Spooner Street.');
load().then(() => {
  // spawn on the ground nearest the centroid of loaded ground
  let sx = 0, sz = 0, n = groundPts.length / 2; for (let i = 0; i < groundPts.length; i += 2) { sx += groundPts[i]; sz += groundPts[i+1]; }
  sx /= n; sz /= n; let best = null, bd = 1e18;
  for (let i = 0; i < groundPts.length; i += 2) { const d = (groundPts[i]-sx)**2 + (groundPts[i+1]-sz)**2; if (d < bd) { bd = d; best = [groundPts[i], groundPts[i+1]]; } }
  const qs = new URLSearchParams(location.search); if (qs.has('x')) best = [+qs.get('x'), +qs.get('z')];
  const g = groundAt(best[0], 5, best[1], 10, 20) ?? 0; player.p = [best[0], g, best[1]];
  buildMini(); $('load').remove(); log(`${drawables.length} meshes loaded.`); requestAnimationFrame(frame);
}).catch(e => { $('lt').textContent = 'Error: ' + e; console.error(e); });
window.__fgo = { player, cam, keys };
