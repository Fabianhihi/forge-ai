// System-Prompts und 3D-Schema für FORGE AI

export function codeSystemPrompt(name) {
  return `Du bist ${name}, eine eigene KI, die komplett lokal und offline auf dem PC des Nutzers läuft. Du bist spezialisiert auf Programmieren und Spieleentwicklung.

Regeln:
- Antworte in der Sprache des Nutzers (meistens Deutsch), locker und klar.
- Gib vollständigen, lauffähigen Code. Keine Platzhalter wie "// Rest bleibt gleich", außer der Nutzer will nur einen Ausschnitt.
- Jeder Codeblock bekommt eine Sprachangabe, z. B. \`\`\`python.
- Wenn Code in eine bestimmte Datei gehört, schreib den Dateinamen fett in die Zeile direkt über dem Codeblock, z. B. **main.py**.
- Für Web-Demos, Tools und kleine Spiele: liefere EINE einzelne HTML-Datei mit eingebettetem CSS und JavaScript, ohne externe Links, damit sie offline in der Vorschau läuft.
- Erkläre kurz, was der Code macht und wie man ihn startet. Keine langen Vorreden.
- Wenn du dir bei etwas unsicher bist, sag es ehrlich.`;
}

export const SHAPES = ['box', 'sphere', 'cylinder', 'cone', 'torus', 'capsule', 'wedge', 'lathe', 'extrude'];
export const MATERIALS = ['matte', 'plastic', 'metal', 'glass', 'glow', 'wood', 'stone'];

const vec3 = { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 };

// Alle Felder sind Pflicht (so erzwingt der eingebaute Motor sauberes JSON)
export const MODEL_SCHEMA = {
  type: 'object',
  properties: {
    plan: { type: 'string', maxLength: 400 },
    name: { type: 'string', maxLength: 60 },
    parts: {
      type: 'array',
      minItems: 1,
      maxItems: 90,
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', maxLength: 40 },
          shape: { type: 'string', enum: SHAPES },
          size: { type: 'array', items: { type: 'number' }, minItems: 1, maxItems: 3 },
          points: { type: 'array', maxItems: 24, items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 } },
          position: vec3,
          rotation: vec3,
          color: { type: 'string', minLength: 4, maxLength: 7 },
          material: { type: 'string', enum: MATERIALS },
          mirrorX: { type: 'boolean' },
        },
      },
    },
  },
};

const EXAMPLE = {
  plan: 'Tisch: Platte 1.2x0.06x0.7 auf Höhe 0.75, vier Beine 0.72 hoch an den Ecken (2 Teile mit mirrorX).',
  name: 'Holztisch',
  parts: [
    { name: 'Platte', shape: 'box', size: [1.2, 0.06, 0.7], points: [], position: [0, 0.75, 0], rotation: [0, 0, 0], color: '#8b5a2b', material: 'wood', mirrorX: false },
    { name: 'Bein vorne', shape: 'box', size: [0.06, 0.72, 0.06], points: [], position: [0.54, 0.36, 0.29], rotation: [0, 0, 0], color: '#6b4220', material: 'wood', mirrorX: true },
    { name: 'Bein hinten', shape: 'box', size: [0.06, 0.72, 0.06], points: [], position: [0.54, 0.36, -0.29], rotation: [0, 0, 0], color: '#6b4220', material: 'wood', mirrorX: true },
    { name: 'Vase', shape: 'lathe', size: [1], points: [[0, 0], [0.07, 0.01], [0.09, 0.08], [0.04, 0.2], [0.05, 0.24]], position: [0.2, 0.78, 0], rotation: [0, 0, 0], color: '#3fa7d6', material: 'plastic', mirrorX: false },
  ],
};

export function model3dSystemPrompt() {
  return `Du bist ein 3D-Modellierer. Du baust 3D-Modelle aus Grundformen. Antworte NUR im FORGE-Format: erst eine Namenszeile, dann genau eine Zeile pro Teil.

FORMAT
name: <Name des Modells>
<form> | <teilname> | <größe> | <x y z> | <drehung x y z> | <#farbe> | <material>
Optional am Zeilenende: " | mirror" und/oder " | points x y, x y, ..."

KOORDINATEN
- Y zeigt nach oben, Einheit = Meter. Das Modell steht auf dem Boden (unterste Stelle y=0) und ist um x=0, z=0 zentriert.
- Die Vorderseite zeigt nach +Z. Links/rechts ist X.
- Position = Mittelpunkt des Teils. Drehung in Grad.

FORMEN und größe
- box: breite höhe tiefe
- sphere: radius
- cylinder: radiusOben höhe radiusUnten (steht senkrecht; liegend: drehung 90 0 0 oder 0 0 90)
- cone: radius höhe (Spitze nach oben)
- torus: radius rohrRadius (Ring steht aufrecht; liegend: drehung 90 0 0)
- capsule: radius länge
- wedge: breite höhe tiefe (Keil/Rampe)
- lathe: Rotationskörper (Vasen, Flaschen, Kuppeln, Säulen). größe = 1. Dazu "points radius y, radius y, ..." von unten nach oben.
- extrude: flache Umrissform mit Dicke (Klingen, Flügel, Flossen, Sterne). größe = dicke. Dazu "points x y, x y, ..." als Umriss.

MATERIAL: matte, plastic, metal, glass, glow (leuchtet), wood, stone
MIRROR: "| mirror" erzeugt automatisch eine Spiegelkopie auf der anderen Seite (bei -x). Nutze das für Arme, Beine, Räder, Flügel, Augen. Das Original kommt auf die +x Seite.

REGELN
- Alle Teile berühren sich oder überlappen leicht. Nichts schwebt lose.
- Realistische Proportionen in Metern. Schöne, passende Farben.
- Ein paar Details (Augen, Fenster, Lichter, Griffe) machen das Modell lebendig.

BEISPIEL
name: Holztisch
box | Platte | 1.2 0.06 0.7 | 0 0.75 0 | 0 0 0 | #8b5a2b | wood
box | Bein vorne | 0.06 0.72 0.06 | 0.54 0.36 0.29 | 0 0 0 | #6b4220 | wood | mirror
box | Bein hinten | 0.06 0.72 0.06 | 0.54 0.36 -0.29 | 0 0 0 | #6b4220 | wood | mirror
lathe | Vase | 1 | 0.2 0.78 0 | 0 0 0 | #3fa7d6 | plastic | points 0 0, 0.07 0.01, 0.09 0.08, 0.04 0.2, 0.05 0.24`;
}

// Grammatik für das FORGE-Format: erzwingt gültige Zeilen und spart viele Token gegenüber JSON
export const MODEL_GRAMMAR = String.raw`root ::= "name: " title "\n" part{1,90}
title ::= [^\n|]{1,48}
part ::= shape " | " label " | " size " | " vec3 " | " vec3 " | " color " | " material mirror? points? "\n"
shape ::= "box" | "sphere" | "cylinder" | "cone" | "torus" | "capsule" | "wedge" | "lathe" | "extrude"
label ::= [^\n|]{1,32}
num ::= "-"? [0-9]{1,3} ("." [0-9]{1,3})?
size ::= num (" " num){0,2}
vec3 ::= num " " num " " num
color ::= "#" [0-9a-fA-F]{6}
material ::= "matte" | "plastic" | "metal" | "glass" | "glow" | "wood" | "stone"
mirror ::= " | mirror"
points ::= " | points " num " " num (", " num " " num){1,23}`;

// Eine Zeile im FORGE-Format → Teil (oder null)
export function parseModelLine(line) {
  const cols = String(line).split('|').map((c) => c.trim());
  if (cols.length < 7) return null;
  const nums = (t) => (t.match(/-?\d+(?:\.\d+)?/g) || []).map(Number);
  const part = {
    shape: cols[0].toLowerCase(),
    name: cols[1] || cols[0],
    size: nums(cols[2]),
    position: nums(cols[3]).slice(0, 3),
    rotation: nums(cols[4]).slice(0, 3),
    color: cols[5],
    material: cols[6].toLowerCase(),
  };
  for (const extra of cols.slice(7)) {
    if (/^mirror/i.test(extra)) part.mirrorX = true;
    else if (/^points/i.test(extra)) {
      part.points = extra
        .replace(/^points\s*/i, '')
        .split(',')
        .map((pt) => nums(pt))
        .filter((pt) => pt.length >= 2)
        .map((pt) => pt.slice(0, 2));
    }
  }
  if (!SHAPES.includes(part.shape) || part.position.length < 3) return null;
  while (part.rotation.length < 3) part.rotation.push(0);
  return part;
}

// Ganzer Text im FORGE-Format → Modell
export function parseModelText(text) {
  const lines = String(text).split('\n');
  let name = 'Modell';
  const parts = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^name\s*:\s*(.+)$/i);
    if (m) {
      name = m[1].trim();
      continue;
    }
    const p = parseModelLine(line);
    if (p) parts.push(p);
  }
  return { name, parts };
}

// Modell → FORGE-Format (für Änderungen; spart Token)
export function modelToText(model) {
  const r = (v) => String(Math.round(v * 1000) / 1000);
  const lines = [`name: ${model.name}`];
  for (const p of model.parts) {
    let line = `${p.shape} | ${p.name} | ${p.size.map(r).join(' ')} | ${p.position.map(r).join(' ')} | ${p.rotation.map(r).join(' ')} | ${p.color} | ${p.material}`;
    if (p.mirrorX) line += ' | mirror';
    if (p.points && p.points.length) line += ' | points ' + p.points.map((pt) => pt.map(r).join(' ')).join(', ');
    lines.push(line);
  }
  return lines.join('\n');
}

export const DETAIL_TOKENS = { 1: 900, 2: 1800, 3: 3600 };

export const DETAIL_LEVELS = {
  1: 'Baue das Modell einfach und klar mit etwa 6 bis 12 Teilen.',
  2: 'Baue das Modell mit etwa 12 bis 25 Teilen und ein paar schönen Details.',
  3: 'Baue das Modell detailliert mit etwa 30 bis 50 Teilen.',
};
