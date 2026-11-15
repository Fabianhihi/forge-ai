// System-Prompts und 3D-Schema für FORGE AI

export function codeSystemPrompt(name) {
  return `Du bist ${name}, eine eigene KI, die komplett lokal auf dem PC des Nutzers läuft. Du bist spezialisiert auf Programmieren und Spieleentwicklung.

WICHTIGSTE REGEL: Dein Code muss in FORGE sofort laufen – ohne dass der Nutzer etwas installieren oder herunterladen muss.
Das läuft in FORGE ohne Installation:
- HTML (eine Datei mit eingebettetem CSS + JavaScript) → startet sofort in der Vorschau. Am besten für Spiele, Webseiten, Tools mit Oberfläche.
- JavaScript / TypeScript (Node) → nur eingebaute Node-Module (fs, path, readline …), keine npm-Pakete.
- Python → FORGE hat ein eingebautes Python mit pygame, numpy, pillow, requests und tkinter. Benutze nur diese und die Standardbibliothek.
- PowerShell und Batch (Windows).
Java, C, C++, Go, Rust, Lua, Ruby und PHP nur, wenn der Nutzer genau diese Sprache will (dafür muss er sie erst installieren).

Sprache wählen:
- Nennt der Nutzer eine Sprache, nimm genau diese.
- Spiele, Webseiten, Apps mit Oberfläche → HTML-Datei. Python-Spiele → pygame.
- Skripte, Rechner, Konsolenprogramme → Python oder JavaScript.
- Minecraft-Mods → Java, Unity → C#, Unreal → C++ (die laufen nicht in FORGE, sag das kurz dazu).

Code-Qualität:
- Gib vollständigen, lauffähigen Code. Keine Platzhalter wie "// Rest bleibt gleich" und keine Teile, die der Nutzer selbst ergänzen muss.
- Keine externen Dateien (Bilder, Sounds, Schriften, CDN-Links): Grafiken mit Code zeichnen (Canvas, pygame.draw), Töne mit WebAudio erzeugen.
- Prüfe deinen Code vor der Ausgabe gedanklich Zeile für Zeile: alle Imports da, alle Variablen und Funktionen definiert, keine Tippfehler, Klammern vollständig, Spielschleife mit sauberem Beenden, Eingaben abgesichert.
- Spiele: Steuerung kurz auf dem Bildschirm erklären, Punktestand, Game-Over und Neustart einbauen.

Format:
- Antworte in der Sprache des Nutzers (meistens Deutsch), locker und klar. Keine langen Vorreden.
- Jeder Codeblock bekommt eine Sprachangabe, z. B. \`\`\`python.
- Schreib den Dateinamen fett in die Zeile direkt über den Codeblock, z. B. **main.py** oder **index.html**.
- Danach 2–4 kurze Sätze: was der Code macht und wie man ihn bedient. In FORGE startet man ihn mit dem Knopf „Ausführen“ bzw. „Öffnen“ am Codeblock.

Fehler beheben:
- Wenn eine Nachricht mit 🔍 beginnt, hat FORGE deinen Code vor dem Start geprüft (Syntax, unbekannte Namen, kurzer Testlauf) und Fehler gefunden. Behebe genau diese Fehler, ohne den Rest kaputtzumachen, und gib den KOMPLETTEN Code mit denselben Dateinamen aus.
- Wenn eine Nachricht mit 🔧 beginnt, ist das ein Fehlerbericht von FORGE nach dem Ausführen. Erkläre die Ursache in 1–2 Sätzen und gib dann den KOMPLETTEN korrigierten Code mit demselben Dateinamen aus. Ändere nur, was nötig ist.
- Fehlt ein Modul, das es im eingebauten Python nicht gibt, schreib den Code so um, dass er ohne dieses Modul auskommt.
- Wenn du dir bei etwas unsicher bist, sag es ehrlich.`;
}

import { expandTemplate, TEMPLATE_NAMES } from './templates.js';

// ---------- Die drei Bots ----------
export const BOTS = {
  chat: {
    id: 'chat',
    name: 'Allrounder',
    icon: '💬',
    color: '#4ea8ff',
    desc: 'Quatschen, Fragen, Ideen, Texte, Schule',
    suggestions: [
      ['Erklär mir was', 'Erklär mir einfach, wie ein schwarzes Loch entsteht.'],
      ['Ideen sammeln', 'Gib mir 10 kreative Ideen für ein eigenes Minecraft-Abenteuer mit Freunden.'],
      ['Text schreiben', 'Schreib mir eine kurze, witzige Geschichte über einen Roboter, der Angst vor Wasser hat.'],
      ['Lernen', 'Frag mich 5 Quizfragen zu Erdkunde und sag mir danach, wie gut ich war.'],
    ],
  },
  code: {
    id: 'code',
    name: 'Coder',
    icon: '⌨',
    color: '#ff7a1a',
    desc: 'Programmieren, Mods, Spiele, Fehler finden',
    suggestions: [
      ['Snake-Spiel bauen', 'Ein komplettes Snake-Spiel als einzelne HTML-Datei mit Highscore und Neon-Look.'],
      ['Minecraft Fabric-Mod', 'Erklär mir Schritt für Schritt, wie ich in einer Fabric-Mod für Minecraft ein eigenes Schwert-Item hinzufüge, mit vollständigem Code.'],
      ['Python-Tool', 'Schreib ein Python-Skript, das meinen Downloads-Ordner automatisch nach Dateitypen in Unterordner sortiert.'],
      ['Code erklären & fixen', 'Ich schicke dir gleich Code. Finde die Fehler, erklär sie kurz und gib mir die korrigierte Version.'],
    ],
  },
  design: {
    id: 'design',
    name: '3D-Designer',
    icon: '◆',
    color: '#a78bfa',
    desc: '3D-Modelle im Chat bauen & Design-Tipps',
    suggestions: [
      ['Mech bauen', 'Bau mir einen coolen Kampf-Mech mit zwei Schulterkanonen.'],
      ['Burg entwerfen', 'Entwirf eine kleine mittelalterliche Burg mit Türmen und Tor.'],
      ['Design-Tipps', 'Wie sorge ich dafür, dass meine Low-Poly-Modelle professionell aussehen?'],
      ['Raumschiff', 'Bau ein schnittiges Raumschiff mit leuchtenden Triebwerken.'],
    ],
  },
};

export function chatSystemPrompt(name) {
  return `Du bist ${name}, eine freundliche KI, die komplett lokal und offline auf dem PC des Nutzers läuft. Du bist ein Allrounder: Du beantwortest Fragen, erklärst Dinge verständlich, hilfst bei Ideen, Texten, Schule und Alltag.

Regeln:
- Antworte in der Sprache des Nutzers (meistens Deutsch), locker, freundlich und auf den Punkt.
- Erkläre so, dass man es leicht versteht. Listen nur, wenn sie wirklich helfen.
- Wenn du dir bei etwas nicht sicher bist, sag es ehrlich, statt etwas zu erfinden.
- Kleine Code-Beispiele sind okay. Für größere Programmier-Projekte empfiehl den Coder-Bot von FORGE, für 3D-Modelle den 3D-Designer.`;
}

export function designSystemPrompt(name) {
  return `Du bist ${name} im Modus 3D-Designer. Du hilfst beim Entwerfen von 3D-Modellen und gibst Design-Tipps (Formen, Proportionen, Farben, Low-Poly, Blender, Blockbench, Minecraft-Modelle).

Wenn der Nutzer ein Modell gebaut haben will: Schreib 1–2 kurze Sätze zu deinem Entwurf und gib dann das Modell in EINEM Codeblock mit der Sprache forge3d aus, also so:
\`\`\`forge3d
name: ...
box | ... | ... | ... | ... | #rrggbb | material
\`\`\`
Danach kann der Nutzer das Modell mit einem Klick in 3D ansehen und exportieren. Bei Änderungswünschen gibst du das KOMPLETTE geänderte Modell wieder als forge3d-Block aus.
Bei reinen Fragen (Tipps, Erklärungen) antwortest du normal ohne Codeblock. Antworte in der Sprache des Nutzers.

${FORGE3D_RULES}`;
}

const WEB_NOTE = `

INTERNET
Du hast Internet-Zugang: FORGE sucht automatisch im Netz, wenn eine Frage aktuelle Infos braucht, und hängt die Ergebnisse (mit Nummern [1], [2] …) an die Nachricht des Nutzers an. Nutze sie und nenne die Quellen. Sag nie, dass du kein Internet hast – außer ein Hinweis sagt, dass die Suche gerade nicht geklappt hat.`;

export function systemPromptFor(bot, name, opts = {}) {
  const base = bot === 'chat' ? chatSystemPrompt(name) : bot === 'design' ? designSystemPrompt(name) : codeSystemPrompt(name);
  return opts.web ? base + WEB_NOTE : base;
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

const FORGE3D_RULES = `FORMAT
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

BAUPLÄNE – benutze sie IMMER, wenn das Modell dazu passt (sie sehen viel besser aus als selbst gebaut):
template | humanoid | style=roblox | skin=#f8d95b | shirt=#2f6fde | pants=#2b2f3a | shoes=#1b1d24 | hair=short | haircolor=#3b2a1e | sleeves=none | item=none | cape=none
   → Figuren, Menschen, Roblox-/Minecraft-/Lego-Charaktere, Ritter, Ninjas, Helden.
     style=roblox|minecraft|lego · hair=none|short|long|cap|spiky|helmet · sleeves=none|short|long · item=none|sword|shield|staff|gun|pickaxe · cape=none|#farbe · backpack=yes|no
     Wichtige Punkte für Extras: Kopf oben y=2.3, Gesicht vorne z=0.28, Schultern y=1.8 x=±0.68, Hände y=0.95 x=±0.68, Rücken z=-0.23, Füße y=0
template | robot | color=#d9822b | accent=#3b4252 | glow=#36e0ff | weapons=cannons   → Roboter, Mechs (weapons=cannons|blades|none)
template | car | color=#d22b2b | type=sport   → Autos (type=sport|suv|truck)
template | house | wall=#e8d8b0 | roof=#a33b2b | floors=2   → Häuser
template | tree | type=round | leaves=#3f9a3f   → Bäume (type=round|pine|blocky|palm, fruit=none|#farbe)
template | sword | blade=#cfd8e3 | glow=no   → Schwerter
template | spaceship | color=#cfd6e6 | glow=#36e0ff   → Raumschiffe
template | tower | stone=#8a8f99 | roof=#5a3a7a   → Burg- und Wachtürme
template | animal | type=dog | color=#b07a4a   → Tiere (type=dog|cat|pig|cow|horse|sheep|fox|bear)
Optional bei jedem Bauplan: pos=x,y,z (verschieben) und scale=2 (größer). Mehrere Baupläne in einem Modell sind erlaubt.
Danach kannst du mit normalen Zeilen Extras ergänzen (Hut, Waffe, Krone, Flügel …). Für alles andere baust du aus Grundformen.

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

export function model3dSystemPrompt() {
  return `Du bist ein 3D-Modellierer. Du baust 3D-Modelle aus Grundformen. Antworte NUR im FORGE-Format: erst eine Namenszeile, dann genau eine Zeile pro Teil.

${FORGE3D_RULES}`;
}

// Grammatik für das FORGE-Format: erzwingt gültige Zeilen und spart viele Token gegenüber JSON
export const MODEL_GRAMMAR = String.raw`root ::= "name: " title "\n" part{1,90}
title ::= [^\n|]{1,48}
part ::= (tpl | prim) "\n"
prim ::= shape " | " label " | " size " | " vec3 " | " vec3 " | " color " | " material mirror? points?
tpl ::= "template | " tname (" | " kv){0,14}
tname ::= "humanoid" | "robot" | "car" | "house" | "tree" | "sword" | "spaceship" | "tower" | "animal"
kv ::= [a-z]{2,12} "=" [^\n| ]{1,24}
shape ::= "box" | "sphere" | "cylinder" | "cone" | "torus" | "capsule" | "wedge" | "lathe" | "extrude"
label ::= [^\n|]{1,32}
num ::= "-"? [0-9]{1,3} ("." [0-9]{1,3})?
size ::= num (" " num){0,2}
vec3 ::= num " " num " " num
color ::= "#" [0-9a-fA-F]{6}
material ::= "matte" | "plastic" | "metal" | "glass" | "glow" | "wood" | "stone"
mirror ::= " | mirror"
points ::= " | points " num " " num (", " num " " num){1,23}`;

// Eine Zeile im FORGE-Format → Teil (oder null). Template-Zeilen → { template, params }
export function parseModelLine(line) {
  const cols = String(line).split('|').map((c) => c.trim());
  if (/^template$/i.test(cols[0]) && cols[1]) {
    const params = {};
    for (const c of cols.slice(2)) {
      const m = c.match(/^([a-zA-Z]+)\s*=\s*(.+)$/);
      if (m) params[m[1].toLowerCase()] = m[2].trim();
    }
    const t = cols[1].toLowerCase();
    return TEMPLATE_NAMES.includes(t) ? { template: t, params } : null;
  }
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
    if (/^mirror/i.test(extra)) {
      part.mirrorX = true;
      const at = extra.match(/@\s*(-?\d+(?:\.\d+)?)/);
      if (at && Number(at[1])) part.mirrorAt = Number(at[1]);
    }
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
    if (p && p.template) parts.push(...expandTemplate(p.template, p.params));
    else if (p) parts.push(p);
  }
  return { name, parts };
}

// Modell → FORGE-Format (für Änderungen; spart Token)
export function modelToText(model) {
  const r = (v) => String(Math.round(v * 1000) / 1000);
  const lines = [`name: ${model.name}`];
  for (const p of model.parts) {
    let line = `${p.shape} | ${p.name} | ${p.size.map(r).join(' ')} | ${p.position.map(r).join(' ')} | ${p.rotation.map(r).join(' ')} | ${p.color} | ${p.material}`;
    if (p.mirrorX) line += p.mirrorAt ? ` | mirror@${r(p.mirrorAt)}` : ' | mirror';
    if (p.points && p.points.length) line += ' | points ' + p.points.map((pt) => pt.map(r).join(' ')).join(', ');
    lines.push(line);
  }
  return lines.join('\n');
}

// Quelltext eines Modells: Bauplan-Zeilen bleiben erhalten (kurz und leicht änderbar), der Rest als normale Zeilen
export function modelSource(model, text) {
  const tpl = String(text || '')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => /^template\s*\|/i.test(l) && parseModelLine(l));
  const own = { name: model.name, parts: model.parts.filter((p) => !p.fromTemplate) };
  return [`name: ${model.name}`, ...tpl, ...modelToText(own).split('\n').slice(1)].join('\n');
}

export const DETAIL_TOKENS = { 1: 900, 2: 1800, 3: 3600 };

export const DETAIL_LEVELS = {
  1: 'Baue das Modell einfach und klar mit etwa 6 bis 12 Teilen.',
  2: 'Baue das Modell mit etwa 12 bis 25 Teilen und ein paar schönen Details.',
  3: 'Baue das Modell detailliert mit etwa 30 bis 50 Teilen.',
};

// ---------- Passende Beispiele für die Anfrage (machen kleine Modelle viel besser) ----------
const EXAMPLES = [
  {
    keys: /roblox|charakter|character|figur|avatar|mensch|person|junge|mädchen|ninja|ritter|krieger|held|soldat|zauberer|steve|noob|skin|spieler/i,
    text: `name: Roblox-Ninja
template | humanoid | style=roblox | skin=#f8d95b | shirt=#1d1d1d | pants=#1d1d1d | shoes=#111111 | hair=none | sleeves=long | item=sword | itemcolor=#d8e3f0
box | Stirnband | 0.6 0.08 0.6 | 0 2.2 0 | 0 0 0 | #c0392b | matte
box | Stirnband Ende | 0.08 0.25 0.04 | 0.12 2.08 -0.3 | 0 0 15 | #c0392b | matte | mirror
box | Gürtel | 0.92 0.1 0.47 | 0 0.95 0 | 0 0 0 | #c0392b | matte`,
  },
  {
    keys: /minecraft|blockig|pixel/i,
    text: `name: Minecraft-Abenteurer
template | humanoid | style=minecraft | skin=#c68c5c | shirt=#2aa6a6 | pants=#3b3f9e | shoes=#555555 | hair=short | haircolor=#3b2a1e | sleeves=short | item=pickaxe`,
  },
  {
    keys: /robot|roboter|mech|android|cyborg/i,
    text: `name: Kampf-Mech
template | robot | color=#2e7d32 | accent=#263238 | glow=#ff3b3b | weapons=cannons
box | Antenne | 0.03 0.5 0.03 | 0.18 3.25 -0.05 | 0 0 8 | #c0c6d4 | metal`,
  },
  {
    keys: /auto|car|wagen|rennwagen|truck|lkw|fahrzeug|jeep/i,
    text: `name: Rennwagen
template | car | color=#1565c0 | type=sport | accent=#111111
box | Rennstreifen | 0.3 0.01 4.2 | 0 0.86 0 | 0 0 0 | #ffffff | plastic`,
  },
  {
    keys: /haus|house|hütte|villa|gebäude|home/i,
    text: `name: Gemütliches Haus
template | house | wall=#f2e2c2 | roof=#8e2b2b | floors=2 | door=#5a3a1e
box | Briefkasten | 0.3 0.25 0.2 | 2.6 1.0 3.2 | 0 0 0 | #c0392b | metal`,
  },
  {
    keys: /burg|schloss|castle|festung|turm|tower/i,
    text: `name: Kleine Burg
template | tower | stone=#8a8f99 | roof=#5a3a7a | pos=-4,0,0
template | tower | stone=#8a8f99 | roof=#5a3a7a | pos=4,0,0
box | Mauer | 6.6 3.5 1 | 0 1.75 0 | 0 0 0 | #858a94 | stone
box | Burgtor | 1.6 2.4 0.2 | 0 1.2 0.55 | 0 0 0 | #5a3a1e | wood`,
  },
  {
    keys: /baum|tree|wald|pflanze|palme/i,
    text: `name: Apfelbaum
template | tree | type=round | leaves=#3f9a3f | fruit=#e53935`,
  },
  {
    keys: /schwert|sword|klinge|waffe|katana|dolch/i,
    text: `name: Frostklinge
template | sword | blade=#7fd6ff | glow=yes | guard=#c0c6d4 | gem=#36e0ff`,
  },
  {
    keys: /raumschiff|spaceship|rakete|ufo|jet|flugzeug|starfighter/i,
    text: `name: Sternenjäger
template | spaceship | color=#cfd6e6 | accent=#263238 | glow=#ff7a1a | stripe=#c0392b`,
  },
  {
    keys: /hund|katze|tier|pferd|kuh|schwein|schaf|fuchs|bär|dog|cat|animal|pet/i,
    text: `name: Treuer Hund
template | animal | type=dog | color=#b07a4a | color2=#4a3020
box | Halsband | 0.42 0.06 0.08 | 0 0.95 0.55 | 0 0 0 | #c0392b | plastic`,
  },
];

const BASIC_EXAMPLE = `name: Fliegenpilz
cylinder | Stiel | 0.12 0.5 0.15 | 0 0.25 0 | 0 0 0 | #f4ead5 | matte
lathe | Hut | 1 | 0 0.45 0 | 0 0 0 | #d32f2f | plastic | points 0 0, 0.4 0, 0.38 0.12, 0.25 0.25, 0 0.3
sphere | Punkt | 0.05 | 0.15 0.68 0.15 | 0 0 0 | #ffffff | matte | mirror
sphere | Punkt hinten | 0.05 | 0.1 0.7 -0.18 | 0 0 0 | #ffffff | matte`;

export function examplesFor(request, fallback = true) {
  const hits = EXAMPLES.filter((e) => e.keys.test(request)).slice(0, 2).map((e) => e.text);
  return hits.length || !fallback ? hits : [BASIC_EXAMPLE];
}
