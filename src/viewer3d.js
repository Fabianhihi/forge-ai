import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { BLOOM_LAYER, extractJson, normalizeModel, compactModel, buildGeometry, snapFloatingParts, buildModelGroup } from './model-build.js';
export { extractJson, normalizeModel, compactModel, snapFloatingParts, buildModelGroup };

const DEG = Math.PI / 180;

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
