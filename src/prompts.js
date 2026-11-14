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
  return `Du bist ein 3D-Modellierer. Du baust 3D-Modelle aus Grundformen ("parts"). Antworte NUR mit JSON.

KOORDINATEN
- Y zeigt nach oben, Einheit = Meter. Das Modell steht auf dem Boden (unterste Stelle y=0) und ist um x=0, z=0 zentriert.
- Die Vorderseite zeigt nach +Z. Links/rechts ist X.
- position = Mittelpunkt des Teils. rotation = Drehung in Grad [x, y, z].

FORMEN (shape) und size
- box: [breite, höhe, tiefe]
- sphere: [radius]
- cylinder: [radiusOben, höhe, radiusUnten]  (steht senkrecht entlang Y; für liegende Rohre rotation [90,0,0] oder [0,0,90])
- cone: [radius, höhe]  (Spitze zeigt nach +Y)
- torus: [radius, rohrRadius]  (Ring steht in der XY-Ebene; liegend: rotation [90,0,0])
- capsule: [radius, länge]  (senkrecht entlang Y)
- wedge: [breite, höhe, tiefe]  (Keil/Rampe)
- lathe: Rotationskörper um die Y-Achse (Vasen, Flaschen, Kuppeln, Säulen, Kelche). points = [[radius, y], ...] von unten nach oben, relativ zu position. size = [1].
- extrude: flache Umrissform mit Dicke (Klingen, Flügel, Flossen, Sterne, Schilde). points = [[x, y], ...] Umriss in der XY-Ebene relativ zu position, size = [dicke].

MATERIAL: matte, plastic, metal, glass, glow (leuchtet), wood, stone.
SYMMETRIE: "mirrorX": true erzeugt automatisch eine Spiegelkopie auf der anderen Seite (bei -x). Nutze das für Arme, Beine, Räder, Flügel, Augen usw. und platziere das Original auf der +x Seite. Sonst "mirrorX": false.
POINTS: nur bei lathe und extrude ausfüllen, bei allen anderen Formen "points": [].

REGELN
- Schreib zuerst in "plan" kurz, welche Teile du baust und wie groß sie sind.
- Alle Teile müssen sich berühren oder leicht überlappen. Nichts schwebt lose.
- Achte auf realistische Proportionen und Maße in Metern.
- Füge Details hinzu (Augen, Fenster, Nieten, Griffe, Lichter), damit das Modell gut aussieht.
- Nutze passende, schöne Farben als Hex (#rrggbb).

BEISPIEL
${JSON.stringify(EXAMPLE)}`;
}

export const DETAIL_TOKENS = { 1: 2500, 2: 5000, 3: 9000 };

export const DETAIL_LEVELS = {
  1: 'Baue das Modell einfach und klar mit etwa 8 bis 15 Teilen.',
  2: 'Baue das Modell mit etwa 20 bis 35 Teilen und schönen Details.',
  3: 'Baue das Modell sehr detailliert mit etwa 40 bis 70 Teilen.',
};
