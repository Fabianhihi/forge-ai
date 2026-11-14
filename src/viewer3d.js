// 3D-Ansicht: baut Modelle aus dem JSON der KI und exportiert sie als GLB / OBJ / STL
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// Nur leuchtende Teile (Material „glow“) bekommen den Glüh-Effekt
const BLOOM_LAYER = 1;
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { SHAPES, MATERIALS } from './prompts.js';

const DEG = Math.PI / 180;

// ---------- JSON aufräumen & absichern ----------
function num(v, d = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function clampSize(v, d) {
  return Math.min(Math.max(Math.abs(num(v, d)), 0.002), 200);
}
function vec3(a, d = [0, 0, 0]) {
  if (!Array.isArray(a)) return d.slice();
  return [num(a[0], d[0]), num(a[1], d[1]), num(a[2], d[2])];
}
function color(c) {
  const s = String(c || '').trim();
  if (/^#?[0-9a-f]{6}$/i.test(s)) return s.startsWith('#') ? s : '#' + s;
  if (/^#?[0-9a-f]{3}$/i.test(s)) {
    const h = s.replace('#', '');
    return '#' + h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  }
  try {
    return '#' + new THREE.Color(s).getHexString();
  } catch {
    return '#9aa3b2';
  }
}

export function extractJson(text) {
  const t = String(text || '');
  try {
    return JSON.parse(t);
  } catch {}
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) {
    try {
      return JSON.parse(fence[1]);
    } catch {}
  }
  const a = t.indexOf('{');
  const b = t.lastIndexOf('}');
  if (a >= 0 && b > a) {
    try {
      return JSON.parse(t.slice(a, b + 1));
    } catch {}
  }
  // abgeschnittenes JSON retten: bis zum letzten vollständigen Teil
  const pIdx = t.indexOf('"parts"');
  if (pIdx > 0) {
    const lastObj = t.lastIndexOf('}');
    for (let end = lastObj; end > pIdx; end = t.lastIndexOf('}', end - 1)) {
      try {
        return JSON.parse(t.slice(a, end + 1) + ']}');
      } catch {}
    }
  }
  return null;
}

export function normalizeModel(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('Kein gültiges Modell');
  const partsIn = Array.isArray(raw.parts) ? raw.parts : Array.isArray(raw) ? raw : [];
  const parts = [];
  for (const p of partsIn.slice(0, 300)) {
    if (!p || typeof p !== 'object') continue;
    let shape = String(p.shape || p.type || 'box').toLowerCase();
    if (shape === 'cube') shape = 'box';
    if (shape === 'ball') shape = 'sphere';
    if (shape === 'ring') shape = 'torus';
    if (!SHAPES.includes(shape)) shape = 'box';
    const size = Array.isArray(p.size) ? p.size.map((v) => num(v, 0.1)) : [0.1, 0.1, 0.1];
    let points = Array.isArray(p.points)
      ? p.points.filter((pt) => Array.isArray(pt) && pt.length >= 2).map((pt) => [num(pt[0]), num(pt[1])])
      : null;
    if ((shape === 'lathe' && (!points || points.length < 2)) || (shape === 'extrude' && (!points || points.length < 3))) {
      shape = 'box';
      points = null;
    }
    const mat = String(p.material || 'plastic').toLowerCase();
    parts.push({
      name: String(p.name || shape).slice(0, 60),
      shape,
      size,
      ...(points ? { points } : {}),
      position: vec3(p.position),
      rotation: vec3(p.rotation),
      color: color(p.color),
      material: MATERIALS.includes(mat) ? mat : 'plastic',
      ...(p.mirrorX ? { mirrorX: true } : {}),
      ...(p.mirrorX && Number.isFinite(+p.mirrorAt) && +p.mirrorAt ? { mirrorAt: +p.mirrorAt } : {}),
      ...(p.fromTemplate ? { fromTemplate: String(p.fromTemplate) } : {}),
    });
  }
  if (!parts.length) throw new Error('Das Modell enthält keine Teile');
  return {
    name: String(raw.name || 'Modell').slice(0, 80),
    plan: String(raw.plan || ''),
    parts,
    ...(raw.source ? { source: String(raw.source).slice(0, 20000) } : {}),
  };
}

export function compactModel(model) {
  const r = (v) => Math.round(v * 1000) / 1000;
  return JSON.stringify({
    name: model.name,
    parts: model.parts.map((p) => ({
      ...p,
      size: p.size.map(r),
      position: p.position.map(r),
      rotation: p.rotation.map(r),
      ...(p.points ? { points: p.points.map((pt) => pt.map(r)) } : {}),
    })),
  });
}

// ---------- Geometrie ----------
function buildGeometry(p) {
  const s = p.size;
  switch (p.shape) {
    case 'box':
      return new THREE.BoxGeometry(clampSize(s[0], 0.1), clampSize(s[1], s[0] || 0.1), clampSize(s[2], s[0] || 0.1));
    case 'sphere':
      return new THREE.SphereGeometry(clampSize(s[0], 0.1), 40, 24);
    case 'cylinder': {
      const rt = Math.abs(num(s[0], 0.1));
      const h = clampSize(s[1], 0.2);
      const rb = s.length > 2 ? Math.abs(num(s[2], rt)) : rt;
      return new THREE.CylinderGeometry(Math.min(rt, 200), Math.min(rb, 200), h, 40);
    }
    case 'cone':
      return new THREE.ConeGeometry(clampSize(s[0], 0.1), clampSize(s[1], 0.2), 40);
    case 'torus':
      return new THREE.TorusGeometry(clampSize(s[0], 0.2), clampSize(s[1], 0.05), 18, 56);
    case 'capsule':
      return new THREE.CapsuleGeometry(clampSize(s[0], 0.1), clampSize(s[1], 0.2), 8, 20);
    case 'wedge': {
      const w = clampSize(s[0], 0.2);
      const h = clampSize(s[1], 0.2);
      const d = clampSize(s[2], 0.2);
      const shape = new THREE.Shape([new THREE.Vector2(-d / 2, -h / 2), new THREE.Vector2(d / 2, -h / 2), new THREE.Vector2(-d / 2, h / 2)]);
      const g = new THREE.ExtrudeGeometry(shape, { depth: w, bevelEnabled: false });
      g.translate(0, 0, -w / 2);
      g.rotateY(Math.PI / 2);
      return g;
    }
    case 'lathe': {
      const pts = p.points.map(([r, y]) => new THREE.Vector2(Math.min(Math.abs(r), 200), y));
      return new THREE.LatheGeometry(pts, 48);
    }
    case 'extrude': {
      const depth = clampSize(s[0], 0.05);
      const shape = new THREE.Shape(p.points.map(([x, y]) => new THREE.Vector2(x, y)));
      const bev = Math.min(depth * 0.15, 0.01);
      const g = new THREE.ExtrudeGeometry(shape, {
        depth: Math.max(depth - bev * 2, 0.001),
        bevelEnabled: true,
        bevelThickness: bev,
        bevelSize: bev,
        bevelSegments: 2,
      });
      g.translate(0, 0, -depth / 2 + bev);
      return g;
    }
    default:
      return new THREE.BoxGeometry(0.1, 0.1, 0.1);
  }
}

// Geometrie an der YZ-Ebene spiegeln (für mirrorX), inkl. korrekter Dreiecks-Reihenfolge
function mirrorGeometry(geo) {
  const g = geo.clone();
  g.scale(-1, 1, 1);
  if (g.index) {
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) {
      const t = idx[i + 1];
      idx[i + 1] = idx[i + 2];
      idx[i + 2] = t;
    }
    g.index.needsUpdate = true;
  } else {
    for (const key of Object.keys(g.attributes)) {
      const attr = g.attributes[key];
      const n = attr.itemSize;
      const arr = attr.array;
      for (let v = 0; v < attr.count; v += 3) {
        for (let k = 0; k < n; k++) {
          const a = (v + 1) * n + k;
          const b = (v + 2) * n + k;
          const t = arr[a];
          arr[a] = arr[b];
          arr[b] = t;
        }
      }
      attr.needsUpdate = true;
    }
  }
  return g;
}

function buildMaterial(p) {
  const c = new THREE.Color(p.color);
  const flat = ['box', 'wedge'].includes(p.shape);
  switch (p.material) {
    case 'metal':
      return new THREE.MeshStandardMaterial({ color: c, metalness: 0.9, roughness: 0.32, flatShading: flat });
    case 'glass':
      return new THREE.MeshPhysicalMaterial({
        color: c,
        metalness: 0,
        roughness: 0.05,
        transmission: 0.9,
        thickness: 0.1,
        transparent: true,
        opacity: 0.55,
        ior: 1.45,
      });
    case 'glow':
      return new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 2.0, roughness: 0.4 });
    case 'wood':
      return new THREE.MeshStandardMaterial({ color: c, metalness: 0, roughness: 0.85, flatShading: flat });
    case 'stone':
      return new THREE.MeshStandardMaterial({ color: c, metalness: 0, roughness: 1, flatShading: true });
    case 'matte':
      return new THREE.MeshStandardMaterial({ color: c, metalness: 0, roughness: 0.95, flatShading: flat });
    default:
      return new THREE.MeshStandardMaterial({ color: c, metalness: 0.05, roughness: 0.45, flatShading: flat });
  }
}

// ---------- Schwebende Teile andocken ----------
// Kleine KI-Modelle setzen Details (Augen, Hut, Knöpfe …) oft ein Stück neben den Körper.
// Kleine, lose Teilgruppen werden bis an die nächste Fläche des Hauptkörpers geschoben.
export function snapFloatingParts(model) {
  const parts = model.parts;
  if (parts.length < 2) return { model, moved: 0 };
  const boxes = parts.map((p) => {
    let geo;
    try {
      geo = buildGeometry(p);
    } catch {
      geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    }
    const mesh = new THREE.Mesh(geo);
    mesh.position.set(...p.position);
    mesh.rotation.set(p.rotation[0] * DEG, p.rotation[1] * DEG, p.rotation[2] * DEG);
    mesh.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(mesh);
    geo.dispose();
    const list = [b];
    if (p.mirrorX) {
      const a = p.mirrorAt || 0;
      const m = b.clone();
      m.min.x = 2 * a - b.max.x;
      m.max.x = 2 * a - b.min.x;
      list.push(m);
    }
    return list;
  });
  const all = new THREE.Box3();
  boxes.flat().forEach((b) => all.union(b));
  const diag = all.getSize(new THREE.Vector3()).length() || 1;
  const tol = diag * 0.012;
  const touch = (i, j) => boxes[i].some((a) => boxes[j].some((b) => a.clone().expandByScalar(tol).intersectsBox(b)));
  // Gruppen aus sich berührenden Teilen bilden
  const group = parts.map((_, i) => i);
  const find = (i) => (group[i] === i ? i : (group[i] = find(group[i])));
  for (let i = 0; i < parts.length; i++)
    for (let j = i + 1; j < parts.length; j++) if (find(i) !== find(j) && touch(i, j)) group[find(i)] = find(j);
  const clusters = new Map();
  const vol = (i) => boxes[i].reduce((n, b) => {
    const s = b.getSize(new THREE.Vector3());
    return n + Math.max(s.x, 0.01) * Math.max(s.y, 0.01) * Math.max(s.z, 0.01);
  }, 0);
  parts.forEach((_, i) => {
    const r = find(i);
    if (!clusters.has(r)) clusters.set(r, { idx: [], vol: 0 });
    const c = clusters.get(r);
    c.idx.push(i);
    c.vol += vol(i);
  });
  if (clusters.size < 2) return { model, moved: 0 };
  const groundY = all.min.y;
  const list = [...clusters.values()].sort((a, b) => b.vol - a.vol);
  for (const c of list) {
    c.box = new THREE.Box3();
    c.idx.forEach((i) => c.box.union(boxes[i][0]));
    c.boxes = c.idx.flatMap((i) => boxes[i]);
    c.ground = c.box.min.y <= groundY + tol; // steht auf dem Boden → eigenes Objekt, bleibt wo es ist
    c.template = c.idx.some((i) => parts[i].fromTemplate);
    c.mirror = c.idx.some((i) => parts[i].mirrorX);
    c.keep = c.idx.some((i) => /wolke|cloud|partikel|funke|stern|halo|schein|rauch|flamme|blase|schatten/i.test(parts[i].name));
  }
  // Kleinste Verschiebung, bis die Gruppe ein Teil der anderen Gruppe berührt (in Original-Koordinaten)
  const gapTo = (c, k) => {
    let best = null;
    for (const mb of k.boxes) {
      const cb = c.box;
      const d = new THREE.Vector3(
        cb.min.x > mb.max.x ? mb.max.x - cb.min.x : cb.max.x < mb.min.x ? mb.min.x - cb.max.x : 0,
        cb.min.y > mb.max.y ? mb.max.y - cb.min.y : cb.max.y < mb.min.y ? mb.min.y - cb.max.y : 0,
        cb.min.z > mb.max.z ? mb.max.z - cb.min.z : cb.max.z < mb.min.z ? mb.min.z - cb.max.z : 0
      );
      if (!best || d.length() < best.length()) best = d;
    }
    return best;
  };
  // Jede lose Gruppe hängt an der nächsten größeren Gruppe und wandert mit ihr mit
  list[0].delta = new THREE.Vector3();
  for (let n = 1; n < list.length; n++) {
    const c = list[n];
    c.delta = new THREE.Vector3();
    if (c.ground || c.template) continue;
    let parent = null;
    let gap = null;
    for (let k = 0; k < n; k++) {
      const g = gapTo(c, list[k]);
      if (g && (!gap || g.length() < gap.length())) {
        gap = g;
        parent = list[k];
      }
    }
    if (!parent) continue;
    c.delta.copy(parent.delta);
    if (c.keep || gap.length() > diag * 0.25) continue;
    if (gap.x && c.mirror) gap.x = 0; // Spiegelteile nicht über die Spiegelachse schieben
    if (gap.length() < tol * 0.5) continue;
    // ein kleines Stück überlappen lassen, damit keine Ritze bleibt
    const o = Math.min(0.01, tol);
    gap.set(gap.x && gap.x + Math.sign(gap.x) * o, gap.y && gap.y + Math.sign(gap.y) * o, gap.z && gap.z + Math.sign(gap.z) * o);
    c.delta.add(gap);
  }
  let moved = 0;
  const out = parts.map((p) => ({ ...p, position: [...p.position] }));
  for (const c of list) {
    if (!c.delta || c.delta.lengthSq() < 1e-10) continue;
    for (const i of c.idx) {
      out[i].position[0] += c.delta.x;
      out[i].position[1] += c.delta.y;
      out[i].position[2] += c.delta.z;
      moved++;
    }
  }
  return { model: moved ? { ...model, parts: out } : model, moved };
}

export function buildModelGroup(model) {
  const group = new THREE.Group();
  group.name = model.name || 'Modell';
  model.parts.forEach((p, i) => {
    let geo;
    try {
      geo = buildGeometry(p);
    } catch {
      geo = new THREE.BoxGeometry(0.1, 0.1, 0.1);
    }
    const mat = buildMaterial(p);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = p.name;
    mesh.position.set(...p.position);
    mesh.rotation.set(p.rotation[0] * DEG, p.rotation[1] * DEG, p.rotation[2] * DEG);
    mesh.castShadow = p.material !== 'glow';
    mesh.receiveShadow = true;
    mesh.userData.partIndex = i;
    if (p.material === 'glow') mesh.layers.enable(BLOOM_LAYER);
    group.add(mesh);
    if (p.mirrorX) {
      const m2 = new THREE.Mesh(mirrorGeometry(geo), mat);
      m2.name = p.name + ' (gespiegelt)';
      m2.position.set(2 * (p.mirrorAt || 0) - p.position[0], p.position[1], p.position[2]);
      m2.rotation.set(p.rotation[0] * DEG, -p.rotation[1] * DEG, -p.rotation[2] * DEG);
      m2.castShadow = p.material !== 'glow';
      m2.receiveShadow = true;
      m2.userData.partIndex = i;
      if (p.material === 'glow') m2.layers.enable(BLOOM_LAYER);
      group.add(m2);
    }
  });
  // Auf den Boden stellen und zentrieren
  const box = new THREE.Box3().setFromObject(group);
  if (!box.isEmpty()) {
    const c = box.getCenter(new THREE.Vector3());
    for (const child of group.children) {
      child.position.x -= c.x;
      child.position.z -= c.z;
      child.position.y -= box.min.y;
    }
  }
  return group;
}

// ---------- Viewer ----------
export class Viewer3D {
  constructor(container) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5)); // spart Grafikspeicher für die KI
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 0.95;
    container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0d0f15');
    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.55;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.01, 2000);
    this.camera.position.set(3, 2.2, 4);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.autoRotateSpeed = 1.2;
    this.controls.target.set(0, 0.6, 0);

    const hemi = new THREE.HemisphereLight('#bcd3ff', '#2a2018', 0.55);
    this.scene.add(hemi);
    this.sun = new THREE.DirectionalLight('#fff3e0', 1.9);
    this.sun.position.set(4, 7, 5);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(1024, 1024);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);
    const rim = new THREE.DirectionalLight('#7fb2ff', 1.0);
    rim.position.set(-5, 3, -4);
    this.scene.add(rim);

    this.ground = new THREE.Mesh(new THREE.CircleGeometry(1, 64), new THREE.ShadowMaterial({ opacity: 0.35 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.grid = new THREE.GridHelper(1, 20, '#3a3f4f', '#1f2330');
    this.grid.material.transparent = true;
    this.grid.material.opacity = 0.6;
    this.scene.add(this.grid);

    // Selektives Leuchten: erst nur die Glow-Teile rendern und weichzeichnen, dann über das Bild legen
    this.bloomLayer = new THREE.Layers();
    this.bloomLayer.set(BLOOM_LAYER);
    this.darkMat = new THREE.MeshBasicMaterial({ color: 0x000000 });
    this.bloomComposer = new EffectComposer(this.renderer);
    this.bloomComposer.renderToScreen = false;
    this.bloomComposer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.35, 0.0);
    this.bloomComposer.addPass(this.bloom);
    const mix = new ShaderPass(
      new THREE.ShaderMaterial({
        uniforms: { baseTexture: { value: null }, bloomTexture: { value: this.bloomComposer.renderTarget2.texture } },
        vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
        fragmentShader: 'uniform sampler2D baseTexture; uniform sampler2D bloomTexture; varying vec2 vUv; void main(){ gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv); }',
      }),
      'baseTexture'
    );
    mix.needsSwap = true;
    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(mix);
    this.composer.addPass(new OutputPass());
    this._saved = new Map();

    this.model = null;
    this.modelGroup = null;
    this.highlighted = null;
    this.wireframe = false;

    this._resize = this.resize.bind(this);
    new ResizeObserver(this._resize).observe(container);
    this.resize();
    // Nur zeichnen, wenn sich etwas ändert. So nimmt die 3D-Ansicht der KI
    // keine Grafikkarten-Leistung weg (vorher lief sie ständig mit 60 Bildern/s).
    this._dirty = true;
    this.controls.addEventListener('change', () => (this._dirty = true));
    const loop = () => {
      requestAnimationFrame(loop);
      if (this.container.offsetParent === null) return; // Ansicht unsichtbar (Code-Modus)
      const moved = this.controls.update();
      if (moved || this._dirty || this.controls.autoRotate) {
        this._dirty = false;
        this.renderFrame();
      }
    };
    loop();
  }

  requestRender() {
    this._dirty = true;
  }

  renderFrame() {
    // 1) Leuchtschicht: alles außer Glow-Teilen schwarz
    const bg = this.scene.background;
    const gridVis = this.grid.visible;
    this.scene.background = null;
    this.grid.visible = false;
    let hasGlow = false;
    this.scene.traverse((o) => {
      if (!o.isMesh) return;
      if (this.bloomLayer.test(o.layers)) {
        hasGlow = true;
        return;
      }
      this._saved.set(o, o.material);
      o.material = this.darkMat;
    });
    if (hasGlow) {
      const au = this.renderer.shadowMap.autoUpdate;
      this.renderer.shadowMap.autoUpdate = false; // Schatten nur einmal pro Bild berechnen
      this.bloomComposer.render();
      this.renderer.shadowMap.autoUpdate = au;
    }
    else this.renderer.setRenderTarget(this.bloomComposer.renderTarget2), this.renderer.clear(), this.renderer.setRenderTarget(null);
    for (const [o, m] of this._saved) o.material = m;
    this._saved.clear();
    this.scene.background = bg;
    this.grid.visible = gridVis;
    // 2) Normales Bild + Leuchten
    this.composer.render();
  }

  resize() {
    this._dirty = true;
    const w = Math.max(this.container.clientWidth, 1);
    const h = Math.max(this.container.clientHeight, 1);
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    if (this.bloomComposer) this.bloomComposer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clear() {
    if (this.modelGroup) {
      this.scene.remove(this.modelGroup);
      this.modelGroup.traverse((o) => {
        if (o.isMesh) {
          o.geometry.dispose();
          if (o.material && !o.material._shared) o.material.dispose();
        }
      });
    }
    this.modelGroup = null;
    this.model = null;
    this._dirty = true;
  }

  setModel(model, { keepCamera = false } = {}) {
    this.clear();
    this.model = model;
    this.modelGroup = buildModelGroup(model);
    this.setWireframe(this.wireframe);
    this.scene.add(this.modelGroup);
    const box = new THREE.Box3().setFromObject(this.modelGroup);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(size.length() / 2, 0.05);
    const gsize = Math.max(Math.ceil(radius * 4), 2);
    this.grid.scale.setScalar(gsize);
    this.ground.scale.setScalar(gsize);
    const sh = this.sun.shadow.camera;
    sh.left = sh.bottom = -radius * 2;
    sh.right = sh.top = radius * 2;
    sh.near = 0.01;
    sh.far = radius * 20;
    this.sun.position.set(center.x + radius * 2.5, center.y + radius * 4, center.z + radius * 3);
    this.sun.target.position.copy(center);
    sh.updateProjectionMatrix();
    if (!keepCamera) this.frame();
    this._dirty = true;
    return this.modelGroup;
  }

  frame() {
    if (!this.modelGroup) return;
    const box = new THREE.Box3().setFromObject(this.modelGroup);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.05);
    const dist = radius / Math.sin((this.camera.fov * DEG) / 2) * 1.3;
    const dir = new THREE.Vector3(0.75, 0.45, 1).normalize();
    this.camera.position.copy(center).addScaledVector(dir, dist);
    this.camera.near = Math.max(dist / 200, 0.001);
    this.camera.far = dist * 50;
    this.camera.updateProjectionMatrix();
    this.controls.target.copy(center);
    this.controls.update();
    this._dirty = true;
  }

  setAutoRotate(on) {
    this.controls.autoRotate = on;
  }
  setGrid(on) {
    this.grid.visible = on;
    this._dirty = true;
  }
  setWireframe(on) {
    this.wireframe = on;
    this._dirty = true;
    if (this.modelGroup) this.modelGroup.traverse((o) => o.isMesh && (o.material.wireframe = on));
  }

  highlight(partIndex) {
    if (!this.modelGroup) return;
    const seen = new Set();
    this.modelGroup.traverse((o) => {
      if (!o.isMesh || seen.has(o.material)) return;
      seen.add(o.material);
      const m = o.material;
      if (!m.emissive) return;
      if (m.userData.origEmissive === undefined) {
        m.userData.origEmissive = m.emissive.getHex();
        m.userData.origEI = m.emissiveIntensity;
      }
      if (partIndex !== null && o.userData.partIndex === partIndex) {
        m.emissive.set('#ff7a1a');
        m.emissiveIntensity = 0.7;
      } else {
        m.emissive.setHex(m.userData.origEmissive);
        m.emissiveIntensity = m.userData.origEI;
      }
    });
    this._dirty = true;
  }

  screenshot() {
    this.renderFrame();
    return this.renderer.domElement.toDataURL('image/png');
  }

  // ---------- Export ----------
  exportGroup() {
    if (!this.modelGroup) throw new Error('Kein Modell vorhanden');
    this.highlight(null);
    const g = this.modelGroup.clone(true);
    g.traverse((o) => {
      if (o.isMesh && o.material.wireframe) {
        o.material = o.material.clone();
        o.material.wireframe = false;
      }
    });
    g.updateMatrixWorld(true);
    return g;
  }

  async toGLB() {
    const g = this.exportGroup();
    const res = await new GLTFExporter().parseAsync(g, { binary: true });
    return new Uint8Array(res);
  }

  toSTL() {
    const dv = new STLExporter().parse(this.exportGroup(), { binary: true });
    return new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
  }

  toOBJ() {
    return new OBJExporter().parse(this.exportGroup());
  }
}
