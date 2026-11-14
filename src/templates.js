// FORGE AI – Baupläne für häufige 3D-Modelle.
// Die KI wählt nur Bauplan + Farben/Optionen, den Rest baut dieser Code sauber und proportional.

const isColor = (v) => /^#?[0-9a-f]{6}$/i.test(v || '') || /^#?[0-9a-f]{3}$/i.test(v || '');
const col = (v, d) => (v ? (isColor(v) ? (v[0] === '#' ? v : '#' + v) : v) : d);
// Farbe leicht abdunkeln (damit gleichfarbige Körperteile sichtbar getrennt sind)
const shade = (c, f) => {
  const m = /^#([0-9a-f]{6})$/i.exec(c);
  if (!m) return c;
  const n = parseInt(m[1], 16);
  const ch = (k) => Math.max(0, Math.min(255, Math.round(((n >> k) & 255) * f)));
  return '#' + ((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0');
};
const yes = (v, d = false) => (v == null ? d : /^(ja|yes|true|1|an|on)$/i.test(String(v)));
const opt = (v, list, d) => (list.includes(String(v || '').toLowerCase()) ? String(v).toLowerCase() : d);

// Teil-Helfer
function P(shape, name, size, position, color, material = 'plastic', extra = {}) {
  return { shape, name, size, position, rotation: extra.rotation || [0, 0, 0], color, material, ...(extra.mirror ? { mirrorX: true } : {}), ...(extra.points ? { points: extra.points } : {}) };
}

// ---------------------------------------------------------------- Figur
function humanoid(p) {
  const style = opt(p.style, ['roblox', 'minecraft', 'lego'], 'roblox');
  const skin = col(p.skin, style === 'minecraft' ? '#c68c5c' : '#f8d95b');
  const shirt = col(p.shirt, '#2f6fde');
  const pants = col(p.pants, '#2b2f3a');
  const shoes = p.shoes === 'none' ? null : col(p.shoes, '#1b1d24');
  const hairColor = col(p.haircolor, '#3b2a1e');
  const hair = opt(p.hair, ['none', 'short', 'long', 'cap', 'spiky', 'helmet', 'bald'], 'short');
  const sleeves = opt(p.sleeves, ['short', 'long', 'none'], style === 'roblox' ? 'none' : 'short');
  const item = opt(p.item, ['none', 'sword', 'shield', 'staff', 'gun', 'pickaxe'], 'none');
  const eyes = col(p.eyes, '#111111');
  const parts = [];
  // Beine & Schuhe
  parts.push(P('box', 'Bein', [0.44, 0.9, 0.45], [0.228, 0.45, 0], pants, 'matte', { mirror: true }));
  if (shoes) parts.push(P('box', 'Schuh', [0.47, 0.12, 0.5], [0.225, 0.06, 0.015], shoes, 'matte', { mirror: true }));
  // Rumpf & Gürtel
  parts.push(P('box', 'Oberkörper', [0.9, 0.9, 0.45], [0, 1.35, 0], shirt, 'matte'));
  if (yes(p.belt, style !== 'roblox')) parts.push(P('box', 'Gürtel', [0.92, 0.08, 0.47], [0, 0.94, 0], col(p.beltcolor, '#3a2a1a'), 'matte'));
  // Arme (je nach Ärmeln Haut- oder Shirtfarbe)
  if (sleeves === 'long') parts.push(P('box', 'Arm', [0.44, 0.9, 0.45], [0.68, 1.35, 0], shade(shirt, 0.88), 'matte', { mirror: true }));
  else {
    parts.push(P('box', 'Arm', [0.44, 0.9, 0.45], [0.68, 1.35, 0], skin, 'matte', { mirror: true }));
    if (sleeves === 'short') parts.push(P('box', 'Ärmel', [0.47, 0.32, 0.47], [0.68, 1.64, 0], shirt, 'matte', { mirror: true }));
  }
  // Kopf
  if (style === 'roblox') {
    parts.push(P('cylinder', 'Kopf', [0.28, 0.5, 0.28], [0, 2.05, 0], skin, 'plastic'));
    parts.push(P('cylinder', 'Hals', [0.12, 0.08, 0.12], [0, 1.82, 0], skin, 'plastic'));
    parts.push(P('box', 'Auge', [0.06, 0.1, 0.02], [0.09, 2.1, 0.275], eyes, 'plastic', { mirror: true }));
    // Lächeln
    parts.push(P('extrude', 'Mund', [0.02], [0, 1.95, 0.275], '#222222', 'plastic', { points: [[-0.1, 0.03], [-0.06, -0.01], [0, -0.025], [0.06, -0.01], [0.1, 0.03], [0.06, 0.005], [0, -0.005], [-0.06, 0.005]] }));
  } else {
    const h = style === 'minecraft' ? 0.56 : 0.5;
    parts.push(P('box', 'Kopf', [h, h, h], [0, 1.8 + h / 2, 0], skin, 'matte'));
    parts.push(P('box', 'Auge weiß', [0.12, 0.07, 0.02], [0.1, 2.08, h / 2 + 0.005], '#ffffff', 'matte', { mirror: true }));
    parts.push(P('box', 'Pupille', [0.06, 0.07, 0.025], [0.13, 2.08, h / 2 + 0.008], eyes, 'matte', { mirror: true }));
    parts.push(P('box', 'Mund', [0.2, 0.05, 0.02], [0, 1.94, h / 2 + 0.005], col(p.mouth, '#7a4a36'), 'matte'));
  }
  // Haare / Kopfbedeckung
  const top = 2.3;
  const hw = style === 'roblox' ? 0.59 : style === 'minecraft' ? 0.6 : 0.54;
  if (hair === 'short' || hair === 'long') {
    parts.push(P('box', 'Haare oben', [hw, 0.12, hw], [0, top + 0.03, 0], hairColor, 'matte'));
    parts.push(P('box', 'Haare hinten', [hw, hair === 'long' ? 0.75 : 0.32, 0.1], [0, hair === 'long' ? 1.98 : 2.17, -hw / 2 + 0.03], hairColor, 'matte'));
    parts.push(P('box', 'Haare Seite', [0.06, 0.2, hw * 0.7], [hw / 2 - 0.02, 2.2, -0.08], hairColor, 'matte', { mirror: true }));
  } else if (hair === 'spiky') {
    parts.push(P('box', 'Haare', [hw, 0.1, hw], [0, top + 0.02, 0], hairColor, 'matte'));
    for (const [x, z] of [[-0.15, 0.1], [0.12, 0.08], [0, -0.1], [-0.18, -0.15], [0.18, -0.12]]) parts.push(P('cone', 'Strähne', [0.1, 0.22], [x, top + 0.16, z], hairColor, 'matte'));
  } else if (hair === 'cap') {
    const cap = col(p.capcolor, '#d33b3b');
    parts.push(P('cylinder', 'Kappe', [0.29, 0.16, 0.3], [0, top + 0.05, 0], cap, 'plastic'));
    parts.push(P('box', 'Schirm', [0.4, 0.03, 0.26], [0, top - 0.01, 0.36], cap, 'plastic'));
  } else if (hair === 'helmet') {
    const hc = col(p.helmetcolor, '#9aa3b2');
    parts.push(P('box', 'Helm', [hw + 0.04, 0.34, hw + 0.04], [0, top - 0.05, 0], hc, 'metal'));
    parts.push(P('box', 'Visier', [hw, 0.06, 0.03], [0, 2.1, hw / 2 + 0.03], '#222831', 'metal'));
  }
  // Umhang
  if (p.cape && p.cape !== 'none') parts.push(P('box', 'Umhang', [0.86, 1.15, 0.04], [0, 1.25, -0.26], col(p.cape, '#b3242e'), 'matte', { rotation: [-6, 0, 0] }));
  // Gegenstand in der rechten Hand
  const hx = -0.68;
  if (item === 'sword') {
    parts.push(P('cylinder', 'Griff', [0.035, 0.22, 0.035], [hx, 0.95, 0.25], '#4a3020', 'wood', { rotation: [90, 0, 0] }));
    parts.push(P('box', 'Parierstange', [0.28, 0.05, 0.05], [hx, 0.95, 0.38], '#c9a227', 'metal'));
    parts.push(P('extrude', 'Klinge', [0.02], [hx, 0.95, 0.4], col(p.itemcolor, '#cfd8e3'), yes(p.glow) ? 'glow' : 'metal', { points: [[-0.05, 0], [0.05, 0], [0.05, 0.8], [0, 0.92], [-0.05, 0.8]], rotation: [90, 0, 0] }));
  } else if (item === 'shield') {
    parts.push(P('cylinder', 'Schild', [0.35, 0.06, 0.35], [hx - 0.05, 1.2, 0.3], col(p.itemcolor, '#8a1c1c'), 'metal', { rotation: [90, 0, 0] }));
    parts.push(P('sphere', 'Schildbuckel', [0.08], [hx - 0.05, 1.2, 0.35], '#c9a227', 'metal'));
  } else if (item === 'staff') {
    parts.push(P('cylinder', 'Stab', [0.03, 1.8, 0.03], [hx, 1.1, 0.25], '#6b4220', 'wood'));
    parts.push(P('sphere', 'Kristall', [0.1], [hx, 2.05, 0.25], col(p.itemcolor, '#7c5cff'), 'glow'));
  } else if (item === 'pickaxe') {
    parts.push(P('cylinder', 'Stiel', [0.03, 0.9, 0.03], [hx, 1.1, 0.25], '#6b4220', 'wood'));
    parts.push(P('box', 'Spitzhacke', [0.6, 0.08, 0.06], [hx, 1.55, 0.25], col(p.itemcolor, '#7fd6ff'), 'metal', { rotation: [0, 0, 8] }));
  } else if (item === 'gun') {
    parts.push(P('box', 'Blaster', [0.12, 0.16, 0.5], [hx, 0.95, 0.35], col(p.itemcolor, '#2e3440'), 'metal'));
    parts.push(P('cylinder', 'Lauf', [0.04, 0.2, 0.04], [hx, 1.0, 0.65], '#555b66', 'metal', { rotation: [90, 0, 0] }));
  }
  if (yes(p.backpack)) parts.push(P('box', 'Rucksack', [0.6, 0.65, 0.25], [0, 1.4, -0.35], col(p.backpackcolor, '#6b4f2a'), 'matte'));
  return parts;
}

// ---------------------------------------------------------------- Roboter / Mech
function robot(p) {
  const main = col(p.color, '#d9822b');
  const acc = col(p.accent, '#3b4252');
  const glow = col(p.glow, '#36e0ff');
  const w = opt(p.weapons, ['cannons', 'none', 'blades'], 'cannons');
  const parts = [
    P('box', 'Becken', [1.0, 0.4, 0.7], [0, 1.5, 0], acc, 'metal'),
    P('box', 'Rumpf', [1.4, 1.0, 1.0], [0, 2.2, 0], main, 'plastic'),
    P('box', 'Brustplatte', [1.0, 0.5, 0.06], [0, 2.25, 0.52], acc, 'metal'),
    P('box', 'Cockpit', [0.7, 0.18, 0.04], [0, 2.4, 0.56], glow, 'glow'),
    P('box', 'Kopf', [0.5, 0.32, 0.5], [0, 2.86, 0.05], acc, 'metal'),
    P('box', 'Visier', [0.36, 0.07, 0.03], [0, 2.88, 0.31], glow, 'glow'),
    P('box', 'Oberschenkel', [0.36, 0.7, 0.42], [0.38, 1.05, 0], main, 'plastic', { mirror: true }),
    P('sphere', 'Knie', [0.2], [0.38, 0.7, 0.07], acc, 'metal', { mirror: true }),
    P('box', 'Schienbein', [0.42, 0.6, 0.5], [0.38, 0.4, 0], acc, 'metal', { mirror: true }),
    P('box', 'Fuß', [0.5, 0.14, 0.8], [0.38, 0.07, 0.12], main, 'plastic', { mirror: true }),
    P('sphere', 'Schulter', [0.27], [0.86, 2.55, 0], acc, 'metal', { mirror: true }),
    P('box', 'Schulterpanzer', [0.5, 0.18, 0.6], [0.9, 2.78, 0], main, 'plastic', { mirror: true }),
    P('cylinder', 'Oberarm', [0.14, 0.55, 0.14], [0.95, 2.18, 0], acc, 'metal', { mirror: true }),
    P('box', 'Unterarm', [0.32, 0.62, 0.38], [0.95, 1.65, 0.06], main, 'plastic', { mirror: true }),
    P('box', 'Faust', [0.26, 0.22, 0.26], [0.95, 1.25, 0.1], acc, 'metal', { mirror: true }),
    P('box', 'Rucksack', [1.0, 0.8, 0.4], [0, 2.25, -0.68], acc, 'metal'),
    P('cylinder', 'Düse', [0.1, 0.3, 0.14], [0.28, 1.75, -0.75], '#1d2129', 'metal', { mirror: true }),
    P('cone', 'Düsenfeuer', [0.09, 0.2], [0.28, 1.52, -0.75], glow, 'glow', { mirror: true, rotation: [180, 0, 0] }),
  ];
  if (w === 'cannons') {
    parts.push(P('box', 'Kanonenhalter', [0.3, 0.2, 0.4], [0.58, 2.82, -0.05], acc, 'metal', { mirror: true }));
    parts.push(P('cylinder', 'Schulterkanone', [0.11, 1.0, 0.13], [0.58, 3.0, 0.3], '#2a2f3a', 'metal', { mirror: true, rotation: [90, 0, 0] }));
    parts.push(P('torus', 'Mündung', [0.11, 0.025], [0.58, 3.0, 0.8], col(p.muzzle, '#ff7a1a'), 'glow', { mirror: true }));
  } else if (w === 'blades') {
    parts.push(P('extrude', 'Armklinge', [0.03], [0.95, 1.3, 0.2], glow, 'glow', { mirror: true, points: [[-0.06, 0], [0.06, 0], [0.02, 0.9], [-0.02, 0.9]], rotation: [180, 0, 0] }));
  }
  return parts;
}

// ---------------------------------------------------------------- Auto
function car(p) {
  const c = col(p.color, '#d22b2b');
  const type = opt(p.type, ['sport', 'suv', 'truck'], 'sport');
  const H = type === 'sport' ? 0.5 : 0.75;
  const L = type === 'truck' ? 5 : 4.2;
  const parts = [
    P('box', 'Karosserie', [1.85, H, L], [0, 0.35 + H / 2, 0], c, 'plastic'),
    P('box', 'Kabine', [1.6, type === 'sport' ? 0.45 : 0.6, type === 'truck' ? 1.6 : 2.0], [0, 0.35 + H + (type === 'sport' ? 0.22 : 0.3), type === 'truck' ? 0.9 : -0.15], c, 'plastic'),
    P('box', 'Frontscheibe', [1.5, 0.4, 0.05], [0, 0.35 + H + 0.2, type === 'truck' ? 1.72 : 0.87], '#9fd3ff', 'glass', { rotation: [-25, 0, 0] }),
    P('box', 'Seitenfenster', [0.04, 0.32, type === 'truck' ? 1.3 : 1.6], [0.81, 0.35 + H + 0.24, type === 'truck' ? 0.9 : -0.15], '#9fd3ff', 'glass', { mirror: true }),
    P('cylinder', 'Rad', [0.36, 0.28, 0.36], [0.9, 0.36, L / 2 - 0.85], '#1b1d22', 'matte', { mirror: true, rotation: [0, 0, 90] }),
    P('cylinder', 'Rad hinten', [0.36, 0.28, 0.36], [0.9, 0.36, -L / 2 + 0.85], '#1b1d22', 'matte', { mirror: true, rotation: [0, 0, 90] }),
    P('cylinder', 'Felge', [0.2, 0.3, 0.2], [0.9, 0.36, L / 2 - 0.85], '#c9ced8', 'metal', { mirror: true, rotation: [0, 0, 90] }),
    P('cylinder', 'Felge hinten', [0.2, 0.3, 0.2], [0.9, 0.36, -L / 2 + 0.85], '#c9ced8', 'metal', { mirror: true, rotation: [0, 0, 90] }),
    P('box', 'Scheinwerfer', [0.4, 0.12, 0.04], [0.6, 0.35 + H * 0.65, L / 2 + 0.01], '#fff6c8', 'glow', { mirror: true }),
    P('box', 'Rücklicht', [0.4, 0.12, 0.04], [0.6, 0.35 + H * 0.65, -L / 2 - 0.01], '#ff2a2a', 'glow', { mirror: true }),
    P('box', 'Stoßstange', [1.9, 0.14, 0.1], [0, 0.42, L / 2 + 0.03], '#2a2d33', 'matte'),
    P('box', 'Stoßstange hinten', [1.9, 0.14, 0.1], [0, 0.42, -L / 2 - 0.03], '#2a2d33', 'matte'),
  ];
  if (type === 'sport' && yes(p.spoiler, true)) {
    parts.push(P('box', 'Spoiler', [1.7, 0.05, 0.35], [0, 0.35 + H + 0.32, -L / 2 + 0.2], col(p.accent, '#111111'), 'plastic'));
    parts.push(P('box', 'Spoilerhalter', [0.06, 0.3, 0.1], [0.6, 0.35 + H + 0.15, -L / 2 + 0.2], col(p.accent, '#111111'), 'plastic', { mirror: true }));
  }
  if (type === 'truck') parts.push(P('box', 'Ladefläche', [1.85, 0.5, 2.4], [0, 0.35 + H + 0.25, -1.2], col(p.accent, '#2b2f3a'), 'metal'));
  return parts;
}

// ---------------------------------------------------------------- Haus
function house(p) {
  const wall = col(p.wall, '#e8d8b0');
  const roof = col(p.roof, '#a33b2b');
  const floors = Math.min(Math.max(parseInt(p.floors, 10) || 1, 1), 4);
  const W = 6;
  const D = 5;
  const FH = 2.8;
  const H = floors * FH;
  const parts = [
    P('box', 'Fundament', [W + 0.3, 0.3, D + 0.3], [0, 0.15, 0], '#7d7f86', 'stone'),
    P('box', 'Wände', [W, H, D], [0, 0.3 + H / 2, 0], wall, 'matte'),
    P('extrude', 'Dach', [D + 0.6], [0, 0.3 + H, 0], roof, 'matte', { points: [[-W / 2 - 0.4, 0], [W / 2 + 0.4, 0], [0, 2.2]], rotation: [0, 0, 0] }),
    P('box', 'Tür', [1.0, 2.1, 0.08], [0, 0.3 + 1.05, D / 2 + 0.03], col(p.door, '#6b4220'), 'wood'),
    P('sphere', 'Türknauf', [0.05], [0.35, 0.3 + 1.0, D / 2 + 0.09], '#c9a227', 'metal'),
  ];
  // Dach als Giebel über die ganze Tiefe: Umriss in XY, Dicke entlang Z
  for (let f = 0; f < floors; f++) {
    const y = 0.3 + f * FH + (f === 0 ? 1.6 : 1.5);
    for (const x of f === 0 ? [W / 2 - 1.3] : [W / 2 - 1.3, 0.0]) {
      if (f > 0 && x === 0) {
        parts.push(P('box', 'Fenster', [1.1, 1.0, 0.06], [0, y, D / 2 + 0.03], '#9fd3ff', 'glass'));
        parts.push(P('box', 'Fensterrahmen', [1.25, 1.15, 0.04], [0, y, D / 2 + 0.01], '#f4f4f4', 'matte'));
      } else {
        parts.push(P('box', 'Fenster', [1.1, 1.0, 0.06], [x, y, D / 2 + 0.03], '#9fd3ff', 'glass', { mirror: true }));
        parts.push(P('box', 'Fensterrahmen', [1.25, 1.15, 0.04], [x, y, D / 2 + 0.01], '#f4f4f4', 'matte', { mirror: true }));
      }
    }
  }
  if (yes(p.chimney, true)) parts.push(P('box', 'Schornstein', [0.6, 1.6, 0.6], [1.6, 0.3 + H + 1.2, -0.8], '#8a4b3a', 'stone'));
  return parts;
}

// ---------------------------------------------------------------- Baum
function tree(p) {
  const type = opt(p.type, ['round', 'pine', 'blocky', 'palm'], 'round');
  const leaves = col(p.leaves, type === 'pine' ? '#2e6b3a' : '#3f9a3f');
  const trunk = col(p.trunk, '#6b4a2b');
  const parts = [];
  if (type === 'pine') {
    parts.push(P('cylinder', 'Stamm', [0.18, 1.2, 0.25], [0, 0.6, 0], trunk, 'wood'));
    parts.push(P('cone', 'Nadeln unten', [1.4, 1.8], [0, 1.9, 0], leaves, 'matte'));
    parts.push(P('cone', 'Nadeln Mitte', [1.1, 1.6], [0, 2.8, 0], leaves, 'matte'));
    parts.push(P('cone', 'Nadeln oben', [0.75, 1.4], [0, 3.6, 0], leaves, 'matte'));
  } else if (type === 'blocky') {
    parts.push(P('box', 'Stamm', [0.5, 2.4, 0.5], [0, 1.2, 0], trunk, 'wood'));
    parts.push(P('box', 'Blätter', [2.5, 1.0, 2.5], [0, 2.7, 0], leaves, 'matte'));
    parts.push(P('box', 'Blätter oben', [1.5, 1.0, 1.5], [0, 3.6, 0], leaves, 'matte'));
  } else if (type === 'palm') {
    parts.push(P('cylinder', 'Stamm', [0.14, 3.6, 0.22], [0, 1.8, 0], trunk, 'wood', { rotation: [0, 0, 6] }));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * 360;
      parts.push(P('box', 'Palmwedel', [0.4, 0.06, 1.6], [Math.sin((a * Math.PI) / 180) * 0.75 - 0.2, 3.55, Math.cos((a * Math.PI) / 180) * 0.75], leaves, 'matte', { rotation: [-20, a, 0] }));
    }
    parts.push(P('sphere', 'Kokosnuss', [0.14], [0.05, 3.45, 0.15], '#5a3a1e', 'matte', { mirror: true }));
  } else {
    parts.push(P('cylinder', 'Stamm', [0.22, 1.8, 0.32], [0, 0.9, 0], trunk, 'wood'));
    parts.push(P('sphere', 'Krone', [1.2], [0, 2.6, 0], leaves, 'matte'));
    parts.push(P('sphere', 'Krone Seite', [0.85], [0.75, 2.3, 0.2], leaves, 'matte', { mirror: true }));
    parts.push(P('sphere', 'Krone oben', [0.8], [0.1, 3.4, -0.2], leaves, 'matte'));
  }
  if (p.fruit && p.fruit !== 'none') for (const [x, y, z] of [[0.6, 2.4, 0.9], [-0.7, 2.7, 0.6], [0.2, 3.0, 1.0]]) parts.push(P('sphere', 'Frucht', [0.12], [x, y, z], col(p.fruit, '#e53935'), 'plastic'));
  return parts;
}

// ---------------------------------------------------------------- Schwert
function sword(p) {
  const blade = col(p.blade, '#cfd8e3');
  const glow = yes(p.glow);
  return [
    P('sphere', 'Knauf', [0.06], [0, 0.04, 0], col(p.pommel, '#c9a227'), 'metal'),
    P('cylinder', 'Griff', [0.035, 0.28, 0.04], [0, 0.22, 0], col(p.grip, '#3a2a1a'), 'wood'),
    P('box', 'Parierstange', [0.42, 0.06, 0.08], [0, 0.39, 0], col(p.guard, '#c9a227'), 'metal'),
    P('sphere', 'Edelstein', [0.035], [0, 0.39, 0.045], col(p.gem, '#e0245e'), 'glow'),
    P('extrude', 'Klinge', [0.025], [0, 0.42, 0], blade, glow ? 'glow' : 'metal', { points: [[-0.055, 0], [0.055, 0], [0.05, 1.05], [0, 1.22], [-0.05, 1.05]] }),
    P('extrude', 'Hohlkehle', [0.03], [0, 0.45, 0], col(p.fuller, glow ? '#ffffff' : '#9aa6b5'), glow ? 'glow' : 'metal', { points: [[-0.012, 0], [0.012, 0], [0.012, 0.85], [-0.012, 0.85]] }),
  ];
}

// ---------------------------------------------------------------- Raumschiff
function spaceship(p) {
  const hull = col(p.color, '#cfd6e6');
  const acc = col(p.accent, '#3b4252');
  const glow = col(p.glow, '#36e0ff');
  return [
    P('lathe', 'Rumpf', [1], [0, 1.0, 0], hull, 'metal', { points: [[0, -2.2], [0.35, -2.0], [0.55, -1.2], [0.6, 0.4], [0.45, 1.4], [0.18, 2.1], [0, 2.3]], rotation: [90, 0, 0] }),
    P('sphere', 'Cockpit', [0.36], [0, 1.4, 0.9], '#8fd8ff', 'glass'),
    P('extrude', 'Flügel', [0.08], [0.45, 1.0, -0.2], hull, 'metal', { mirror: true, points: [[0, 0.8], [2.2, -0.6], [2.2, -1.1], [0, -0.9]], rotation: [90, 0, 0] }),
    P('box', 'Flügelstreifen', [1.2, 0.09, 0.15], [1.4, 1.0, -0.55], col(p.stripe, '#ff7a1a'), 'plastic', { mirror: true }),
    P('cylinder', 'Triebwerk', [0.22, 0.9, 0.26], [0.55, 1.0, -1.9], acc, 'metal', { mirror: true, rotation: [90, 0, 0] }),
    P('cone', 'Antriebsflamme', [0.2, 0.5], [0.55, 1.0, -2.55], glow, 'glow', { mirror: true, rotation: [-90, 0, 0] }),
    P('extrude', 'Heckflosse', [0.07], [0, 1.45, -1.2], hull, 'metal', { points: [[-0.7, 0], [0.2, 0], [-0.4, 0.8], [-0.75, 0.8]], rotation: [0, -90, 0] }),
    P('box', 'Landebein', [0.08, 0.6, 0.08], [0.35, 0.3, 0.6], acc, 'metal', { mirror: true }),
    P('box', 'Landebein hinten', [0.08, 0.6, 0.08], [0.35, 0.3, -1.0], acc, 'metal', { mirror: true }),
    P('box', 'Positionslicht', [0.08, 0.08, 0.08], [2.6, 1.0, -0.7], '#ff3b3b', 'glow', { mirror: true }),
  ];
}

// ---------------------------------------------------------------- Burgturm
function tower(p) {
  const stone = col(p.stone, '#8a8f99');
  const r = 1.4;
  const h = 6;
  const parts = [
    P('cylinder', 'Turm', [r, h, r * 1.08], [0, h / 2, 0], stone, 'stone'),
    P('cylinder', 'Turmkrone', [r + 0.2, 0.5, r + 0.2], [0, h + 0.25, 0], stone, 'stone'),
    P('box', 'Tor', [1.0, 1.8, 0.2], [0, 0.9, r * 1.04], col(p.door, '#5a3a1e'), 'wood'),
    P('box', 'Fenster', [0.35, 0.7, 0.15], [0, 3.6, r + 0.02], '#1b1d24', 'matte'),
    P('box', 'Fenster Seite', [0.15, 0.7, 0.35], [r + 0.02, 4.6, 0], '#1b1d24', 'matte', { mirror: true }),
  ];
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    parts.push(P('box', 'Zinne', [0.45, 0.5, 0.35], [Math.sin(a) * (r + 0.05), h + 0.75, Math.cos(a) * (r + 0.05)], stone, 'stone', { rotation: [0, (a * 180) / Math.PI, 0] }));
  }
  if (yes(p.roof, false) || (p.roof && isColor(p.roof))) {
    parts.push(P('cone', 'Dach', [r + 0.5, 2.6], [0, h + 1.8, 0], col(isColor(p.roof) ? p.roof : null, '#5a3a7a'), 'matte'));
    parts.push(P('box', 'Fahne', [0.6, 0.35, 0.03], [0.32, h + 3.4, 0], col(p.flag, '#c0392b'), 'matte'));
    parts.push(P('cylinder', 'Fahnenmast', [0.03, 0.8, 0.03], [0, h + 3.3, 0], '#5a3a1e', 'wood'));
  }
  return parts;
}

// ---------------------------------------------------------------- Tier (blockig)
function animal(p) {
  const type = opt(p.type, ['dog', 'cat', 'pig', 'cow', 'horse', 'sheep', 'fox', 'bear'], 'dog');
  const D = { dog: '#b07a4a', cat: '#e0a050', pig: '#f2a7b5', cow: '#ffffff', horse: '#8b5a2b', sheep: '#f4f1e8', fox: '#e2732e', bear: '#6b4a2b' };
  const c = col(p.color, D[type]);
  const c2 = col(p.color2, type === 'cow' ? '#222222' : type === 'fox' ? '#ffffff' : '#4a3020');
  const big = ['cow', 'horse', 'bear'].includes(type);
  const L = big ? 1.6 : 0.9;
  const legH = type === 'horse' ? 1.0 : big ? 0.7 : type === 'pig' ? 0.25 : 0.4;
  const bodyH = big ? 0.8 : type === 'pig' ? 0.55 : 0.45;
  const W = big ? 0.8 : type === 'pig' ? 0.6 : 0.42;
  const by = legH + bodyH / 2;
  const hs = big ? 0.55 : 0.4;
  const parts = [
    P('box', 'Körper', [W, bodyH, L], [0, by, 0], type === 'sheep' ? '#ffffff' : c, 'matte'),
    P('box', 'Bein vorne', [W * 0.3, legH, W * 0.3], [W * 0.32, legH / 2, L / 2 - W * 0.2], c, 'matte', { mirror: true }),
    P('box', 'Bein hinten', [W * 0.3, legH, W * 0.3], [W * 0.32, legH / 2, -L / 2 + W * 0.2], c, 'matte', { mirror: true }),
    P('box', 'Kopf', [hs, hs, hs], [0, by + bodyH * 0.45 + (type === 'horse' ? 0.35 : 0.1), L / 2 + hs * 0.35], type === 'sheep' ? '#d9cbb4' : c, 'matte'),
    P('box', 'Auge', [0.06, 0.06, 0.02], [hs * 0.25, by + bodyH * 0.55 + (type === 'horse' ? 0.35 : 0.1), L / 2 + hs * 0.86], '#111111', 'matte', { mirror: true }),
  ];
  const headY = by + bodyH * 0.45 + (type === 'horse' ? 0.35 : 0.1);
  const snoutZ = L / 2 + hs * 0.85 + 0.08;
  if (['dog', 'fox', 'bear', 'horse', 'cow'].includes(type)) parts.push(P('box', 'Schnauze', [hs * 0.55, hs * 0.4, 0.2], [0, headY - hs * 0.2, snoutZ], type === 'fox' ? '#ffffff' : c2 === '#222222' ? '#f2b8a8' : c2, 'matte'));
  if (type === 'pig') parts.push(P('box', 'Rüssel', [0.2, 0.14, 0.06], [0, headY - 0.05, L / 2 + hs * 0.85 + 0.02], '#e48a9c', 'matte'));
  if (['cat', 'fox', 'dog', 'bear'].includes(type)) parts.push(P('box', 'Ohr', [0.1, type === 'dog' ? 0.14 : 0.16, 0.06], [hs * 0.32, headY + hs * 0.55, L / 2 + hs * 0.3], type === 'bear' ? c : c2 === '#ffffff' ? c : c2, 'matte', { mirror: true }));
  if (['cow'].includes(type)) {
    parts.push(P('cone', 'Horn', [0.05, 0.18], [hs * 0.45, headY + hs * 0.5, L / 2 + hs * 0.3], '#f2e6c8', 'matte', { mirror: true }));
    parts.push(P('box', 'Fleck', [W + 0.01, 0.3, 0.4], [0, by + 0.1, 0.1], c2, 'matte'));
  }
  if (type === 'horse') parts.push(P('box', 'Mähne', [0.08, 0.6, 0.5], [0, headY + 0.1, L / 2 - 0.05], c2, 'matte'));
  if (type === 'sheep') parts.push(P('box', 'Wolle', [W + 0.12, bodyH + 0.1, L + 0.1], [0, by + 0.02, 0], '#f4f1e8', 'matte'));
  if (!['pig', 'bear', 'sheep'].includes(type)) parts.push(P('box', 'Schwanz', [0.1, 0.1, type === 'fox' || type === 'cat' ? 0.55 : 0.3], [0, by + bodyH * 0.25, -L / 2 - 0.2], type === 'fox' ? '#e2732e' : c, 'matte', { rotation: [-25, 0, 0] }));
  return parts;
}

export const TEMPLATES = { humanoid, robot, car, house, tree, sword, spaceship, tower, animal };

// Template-Zeile anwenden: Teile erzeugen, verschieben, skalieren
export function expandTemplate(name, params) {
  const gen = TEMPLATES[name];
  if (!gen) return [];
  const parts = gen(params || {});
  const s = Math.min(Math.max(parseFloat(params.scale) || 1, 0.05), 50);
  const pos = String(params.pos || '').split(',').map(Number);
  const [ox, oy, oz] = [pos[0] || 0, pos[1] || 0, pos[2] || 0];
  return parts.map((pt) => ({
    ...pt,
    name: (params.prefix ? params.prefix + ' ' : '') + pt.name,
    size: pt.size.map((v) => v * s),
    position: [pt.position[0] * s + ox, pt.position[1] * s + oy, pt.position[2] * s + oz],
    ...(pt.points ? { points: pt.points.map(([a, b]) => [a * s, b * s]) } : {}),
    ...(pt.mirrorX && ox ? { mirrorAt: ox } : {}),
    fromTemplate: name,
  }));
}

export const TEMPLATE_NAMES = Object.keys(TEMPLATES);
