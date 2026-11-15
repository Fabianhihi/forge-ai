// forge3d – Modelle vom FORGE-3D-Designer in eigenen three.js-Spielen benutzen.
//   import { ladeModell } from 'forge3d';
//   const mech = await ladeModell('mech');   // THREE.Group, steht auf y = 0, mittig
//   scene.add(mech);
import * as THREE from 'three';
import { normalizeModel, buildModelGroup } from './model-build.js';

const BASE = new URL('./models/', import.meta.url);
const cache = new Map();

function platzhalter(name) {
  const g = new THREE.Group();
  g.name = name + ' (fehlt)';
  const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: 0xff00ff, wireframe: true }));
  m.position.y = 0.5;
  g.add(m);
  return g;
}

// Lädt ein Modell und gibt eine neue Kopie zurück. Optionen: { hoehe } skaliert auf diese Höhe.
export async function ladeModell(name, optionen = {}) {
  const key = String(name).toLowerCase().replace(/[^a-z0-9äöüß_-]+/gi, '-');
  if (!cache.has(key)) {
    cache.set(
      key,
      fetch(new URL(encodeURIComponent(key) + '.json', BASE))
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error('fehlt'))))
        .then((raw) => buildModelGroup(normalizeModel(raw)))
        .catch(() => {
          console.warn(`[forge3d] Modell „${name}“ gibt es noch nicht – nutze einen Platzhalter.`);
          return null;
        })
    );
  }
  const vorlage = await cache.get(key);
  const g = vorlage ? vorlage.clone(true) : platzhalter(name);
  g.name = g.name || key;
  if (optionen.hoehe) {
    const box = new THREE.Box3().setFromObject(g);
    const h = box.max.y - box.min.y || 1;
    g.scale.setScalar(optionen.hoehe / h);
  }
  return g;
}

export const loadModel = ladeModell;

// Welche Modelle gibt es in diesem Projekt?
export async function modellListe() {
  try {
    const r = await fetch(new URL('index.json', BASE));
    return r.ok ? r.json() : [];
  } catch {
    return [];
  }
}
