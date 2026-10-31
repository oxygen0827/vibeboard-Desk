/* Original procedural pixel art. Every pixel is drawn here; no external or third-party sprites. */
(function(root) {
  'use strict';
  const P = {
    wall: '#e9dcc4', wallDark: '#cdbb9b', trim: '#8a6f52', floorA: '#d7c3a1', floorB: '#cfb995', floorLine: '#bea67f',
    rug: '#8fae9a', rugEdge: '#6f8f7b', wood: '#a7774f', woodDark: '#7c5537', woodLight: '#c9976a',
    metal: '#6c7a89', metalDark: '#4a5562', screen: '#26323f', screenOn: '#6fd3c6', glass: '#9fd0e8', glassDark: '#79b2cf',
    leaf: '#4f9a5b', leafDark: '#357a45', pot: '#b86a4b', paper: '#f7f3e8', sofa: '#c46c5a', sofaDark: '#9d5143',
    shadow: 'rgba(60,40,20,.22)', ink: '#2c2620', outline: '#3a2f27'
  };
  function rect(c, x, y, w, h, color) { c.fillStyle = color; c.fillRect(x, y, w, h); }
  function drawDesk(c, d, accent) {
    const x = d.x * 8, y = d.y * 8, w = d.w * 8, h = d.h * 8;
    rect(c, x + 1, y + h, w - 2, 2, P.shadow);
    rect(c, x, y + 2, w, h - 2, P.wood); rect(c, x, y + 2, w, 2, P.woodLight); rect(c, x, y + h - 2, w, 2, P.woodDark);
    // Monitor and keyboard. The screen glow is painted by the live layer when the staff is working.
    rect(c, x + w / 2 - 7, y - 5, 14, 9, P.metalDark); rect(c, x + w / 2 - 6, y - 4, 12, 7, P.screen);
    rect(c, x + w / 2 - 1, y + 4, 2, 2, P.metalDark); rect(c, x + w / 2 - 6, y + 9, 12, 3, P.metal);
    rect(c, x + 3, y + 5, 6, 5, P.paper); rect(c, x + 4, y + 6, 4, 1, '#c9c2b0'); rect(c, x + 4, y + 8, 3, 1, '#c9c2b0');
    rect(c, x + w - 8, y + 5, 4, 5, accent); rect(c, x + w - 7, y + 4, 2, 1, '#fff');
    // Chair below the desk.
    const sx = d.seat.x * 8, sy = d.seat.y * 8;
    rect(c, sx - 1, sy + 4, 10, 3, P.metalDark); rect(c, sx, sy + 1, 8, 4, P.metal);
  }
  function drawPlant(c, f) {
    const x = f.x * 8 + (f.w * 8) / 2, y = f.y * 8;
    rect(c, x - 4, y + 10, 8, 6, P.pot); rect(c, x - 5, y + 9, 10, 2, '#9c553a');
    rect(c, x - 2, y + 2, 4, 8, P.leafDark); rect(c, x - 6, y + 4, 5, 4, P.leaf); rect(c, x + 1, y + 1, 5, 5, P.leaf); rect(c, x - 3, y - 1, 4, 4, P.leaf);
  }
  function drawFurniture(c, f) {
    const x = f.x * 8, y = f.y * 8, w = f.w * 8, h = f.h * 8;
    if (f.kind === 'meeting') {
      rect(c, x + 2, y + h + 1, w - 4, 2, P.shadow);
      rect(c, x, y + 2, w, h - 2, P.woodDark); rect(c, x + 1, y + 2, w - 2, h - 4, P.wood); rect(c, x + 1, y + 2, w - 2, 2, P.woodLight);
      rect(c, x + 8, y + 8, 8, 6, P.paper); rect(c, x + 26, y + 7, 6, 6, P.paper); rect(c, x + 19, y + 11, 4, 4, '#e7b65c');
      for (let i = 0; i < 3; i++) { rect(c, x + 6 + i * 15, y - 2, 7, 4, P.metal); rect(c, x + 6 + i * 15, y + h, 7, 4, P.metal); }
    } else if (f.kind === 'cabinet') {
      rect(c, x, y + 2, w, h + 4, P.metalDark); rect(c, x + 1, y + 3, w - 2, h + 2, P.metal);
      for (let i = 0; i < 3; i++) { rect(c, x + 2, y + 4 + i * 5, w - 4, 4, '#7f8d9c'); rect(c, x + w / 2 - 2, y + 5 + i * 5, 4, 1, P.metalDark); }
    } else if (f.kind === 'shelf') {
      rect(c, x, y, w, h + 4, P.woodDark); rect(c, x + 1, y + 1, w - 2, 6, '#5c3d27'); rect(c, x + 1, y + 9, w - 2, 6, '#5c3d27');
      const books = ['#c9533f', '#3f7fc9', '#e3b341', '#5aa36b', '#8a5fbf', '#d77a3a'];
      for (let i = 0; i < 9; i++) { rect(c, x + 2 + i * 2.4, y + 2, 2, 5, books[i % 6]); rect(c, x + 2 + i * 2.4, y + 10, 2, 5, books[(i + 3) % 6]); }
    } else if (f.kind === 'coffee') {
      rect(c, x + 1, y + 3, w - 2, h - 2, P.woodDark); rect(c, x + 3, y, 9, 9, P.metalDark); rect(c, x + 5, y + 2, 5, 3, P.screenOn);
      rect(c, x + 6, y + 7, 3, 2, P.paper);
    } else if (f.kind === 'sofa') {
      rect(c, x, y + 2, w, h - 1, P.sofaDark); rect(c, x + 2, y + 4, w - 4, h - 6, P.sofa); rect(c, x + 2, y + 2, w - 4, 3, '#d98a76');
      rect(c, x + 8, y + 6, 6, 4, '#f0c35c');
    } else if (f.kind === 'plant') drawPlant(c, f);
  }
  // Static map is painted once into an offscreen canvas.
  function paintMap(c, map) {
    const W = map.COLS * 8, H = map.ROWS * 8 + 4;
    for (let y = 0; y < H; y += 8) for (let x = 0; x < W; x += 8) {
      rect(c, x, y, 8, 8, ((x + y) / 8) % 2 ? P.floorA : P.floorB);
      rect(c, x, y + 7, 8, 1, P.floorLine);
    }
    // Back wall with windows.
    rect(c, 0, 0, W, map.FLOOR_TOP * 8, P.wall); rect(c, 0, 0, W, 4, P.wallDark); rect(c, 0, map.FLOOR_TOP * 8 - 3, W, 3, P.trim);
    for (const wx of [30, 62, 166, 198]) {
      rect(c, wx - 1, 5, 22, 20, P.trim); rect(c, wx, 6, 20, 18, P.glass); rect(c, wx, 6, 20, 6, P.glassDark);
      rect(c, wx + 9, 6, 2, 18, P.trim); rect(c, wx, 14, 20, 1, P.trim); rect(c, wx + 2, 18, 5, 2, '#d8eef7');
    }
    // Clock and notice board.
    rect(c, 132, 8, 12, 12, P.outline); rect(c, 133, 9, 10, 10, P.paper); rect(c, 137, 11, 1, 4, P.ink); rect(c, 137, 14, 3, 1, P.ink);
    rect(c, 100, 7, 18, 16, P.woodDark); rect(c, 101, 8, 16, 14, '#d9b98a');
    rect(c, 103, 10, 5, 4, '#f7e27a'); rect(c, 110, 11, 5, 5, '#a8d8f0'); rect(c, 104, 16, 6, 4, '#f2a7a0');
    // Lounge rug and central walkway rug.
    rect(c, 0, 14 * 8, 7 * 8, 5 * 8 + 4, P.rugEdge); rect(c, 2, 14 * 8 + 2, 7 * 8 - 4, 5 * 8, P.rug);
    rect(c, 11 * 8, 14 * 8 + 4, 9 * 8, 4 * 8, '#c7a1a1'); rect(c, 11 * 8 + 2, 14 * 8 + 6, 9 * 8 - 4, 4 * 8 - 4, '#d9b7b2');
    map.furniture.filter(f => f.kind !== 'plant').forEach(f => drawFurniture(c, f));
    const accents = {researcher: '#3f7fc9', writer: '#e3b341', engineer: '#5aa36b', coordinator: '#c9533f'};
    Object.entries(map.desks).forEach(([id, d]) => drawDesk(c, d, accents[id]));
    map.furniture.filter(f => f.kind === 'plant').forEach(f => drawFurniture(c, f));
  }
  // Character looks: original palettes per role.
  const looks = {
    boss: {skin: '#f1c7a2', hair: '#3b2a20', shirt: '#2f4a6b', pants: '#24303d', tie: '#d1493f'},
    coordinator: {skin: '#e9b892', hair: '#7a3b2a', shirt: '#c9533f', pants: '#4a3c35', bun: true},
    researcher: {skin: '#f3cfae', hair: '#1f1f2a', shirt: '#3f7fc9', pants: '#3b4250', glasses: true},
    writer: {skin: '#d9a07a', hair: '#e0b04f', shirt: '#f0c64a', pants: '#5b4a6e', long: true},
    engineer: {skin: '#c98d68', hair: '#2b2b2b', shirt: '#5aa36b', pants: '#33402f', cap: true}
  };
  /* Characters are 10×16 px, anchored at the bottom centre (feet). */
  function drawCharacter(c, px, py, look, pose, frame, facing) {
    const x = Math.round(px) - 5, y = Math.round(py) - 16, L = looks[look] || looks.boss;
    const sitting = pose === 'sit' || pose === 'type' || pose === 'read' || pose === 'check';
    rect(c, x + 1, y + 15, 8, 2, P.shadow);
    // Legs
    if (!sitting) {
      const step = pose === 'walk' ? (frame % 2 ? 1 : -1) : 0;
      rect(c, x + 2, y + 11, 2, 4 + (step > 0 ? 0 : -1), L.pants); rect(c, x + 6, y + 11, 2, 4 + (step < 0 ? 0 : -1), L.pants);
      rect(c, x + 2, y + 14 + (step > 0 ? 0 : -1), 2, 1, P.outline); rect(c, x + 6, y + 14 + (step < 0 ? 0 : -1), 2, 1, P.outline);
    } else rect(c, x + 2, y + 11, 6, 2, L.pants);
    // Body
    const by = sitting ? y + 6 : y + 6;
    rect(c, x + 1, by, 8, 6, L.shirt);
    if (L.tie && facing !== 'up') rect(c, x + 4, by, 2, 4, L.tie);
    // Arms
    let la = 0, ra = 0;
    if (pose === 'type') { la = frame % 2 ? -1 : 0; ra = frame % 2 ? 0 : -1; }
    if (pose === 'stretch') { rect(c, x, y + 1, 1, 6, L.shirt); rect(c, x + 9, y + 1, 1, 6, L.shirt); rect(c, x, y, 1, 1, L.skin); rect(c, x + 9, y, 1, 1, L.skin); }
    else if (pose === 'wave') { rect(c, x, by + 1, 1, 4, L.shirt); rect(c, x + 9, y + 2 - (frame % 2), 1, 5, L.shirt); rect(c, x + 9, y + 1 - (frame % 2), 1, 1, L.skin); }
    else { rect(c, x, by + 1 + la, 1, 4, L.shirt); rect(c, x + 9, by + 1 + ra, 1, 4, L.shirt); rect(c, x, by + 5 + la, 1, 1, L.skin); rect(c, x + 9, by + 5 + ra, 1, 1, L.skin); }
    if (pose === 'read' || pose === 'hold') { rect(c, x + 2, by + 2, 6, 4, P.paper); rect(c, x + 3, by + 3, 4, 1, '#bbb3a0'); }
    if (pose === 'sip') { rect(c, x + 8, by + 2, 2, 3, '#f7f3e8'); rect(c, x + 8, by + 2, 2, 1, '#7b4a2e'); }
    // Head (bobs while checking)
    const hy = y + (pose === 'check' && frame % 2 ? 1 : 0);
    rect(c, x + 2, hy + 1, 6, 5, L.skin);
    if (facing === 'up') rect(c, x + 2, hy, 6, 5, L.hair);
    else {
      rect(c, x + 2, hy, 6, 2, L.hair);
      if (facing === 'left') { rect(c, x + 6, hy + 1, 2, 3, L.hair); rect(c, x + 3, hy + 3, 1, 1, P.ink); }
      else if (facing === 'right') { rect(c, x + 2, hy + 1, 2, 3, L.hair); rect(c, x + 6, hy + 3, 1, 1, P.ink); }
      else { rect(c, x + 3, hy + 3, 1, 1, P.ink); rect(c, x + 6, hy + 3, 1, 1, P.ink); if (L.glasses) { rect(c, x + 2, hy + 3, 6, 1, '#555'); rect(c, x + 3, hy + 3, 1, 1, '#cfe9f5'); rect(c, x + 6, hy + 3, 1, 1, '#cfe9f5'); } }
    }
    if (L.long && facing !== 'up') { rect(c, x + 1, hy + 1, 1, 5, L.hair); rect(c, x + 8, hy + 1, 1, 5, L.hair); }
    if (L.long && facing === 'up') rect(c, x + 2, hy + 5, 6, 2, L.hair);
    if (L.bun) rect(c, x + 4, hy - 2, 2, 2, L.hair);
    if (L.cap) { rect(c, x + 1, hy - 1, 8, 2, '#2f6d3b'); if (facing === 'down') rect(c, x + 2, hy + 1, 6, 1, '#2f6d3b'); }
  }
  const bubbleColors = {working: '#ffffff', approval: '#ffd34d', done: '#9be37f', failed: '#f28b82', waiting: '#e8e2d6', stale: '#c9c9c9', idle: '#ffffff'};
  // Small status marks above heads. Shapes carry meaning, never colour alone.
  function drawBubble(c, px, py, kind, frame) {
    const x = Math.round(px) - 5, y = Math.round(py) - 26;
    rect(c, x, y, 10, 8, P.outline); rect(c, x + 1, y + 1, 8, 6, bubbleColors[kind] || '#fff'); rect(c, x + 4, y + 8, 2, 2, P.outline);
    c.fillStyle = P.ink;
    if (kind === 'approval') { rect(c, x + 4, y + 2, 2, 3, P.ink); rect(c, x + 4, y + 6, 2, 1, P.ink); }
    else if (kind === 'done') { rect(c, x + 4, y + 2, 2, 4, P.ink); rect(c, x + 3, y + 3, 4, 2, P.ink); }
    else if (kind === 'failed') { for (let i = 0; i < 4; i++) { rect(c, x + 3 + i, y + 2 + i, 1, 1, P.ink); rect(c, x + 6 - i, y + 2 + i, 1, 1, P.ink); } }
    else if (kind === 'waiting' || kind === 'working') { for (let i = 0; i < 3; i++) if (kind === 'waiting' || i <= frame % 3) rect(c, x + 2 + i * 2, y + 4, 1, 1, P.ink); }
    else if (kind === 'stale') { rect(c, x + 3, y + 2, 4, 1, P.ink); rect(c, x + 6, y + 3, 1, 1, P.ink); rect(c, x + 4, y + 4, 2, 1, P.ink); rect(c, x + 4, y + 6, 2, 1, P.ink); }
  }
  function screenGlow(c, desk, frame) {
    const x = (desk.x + desk.w / 2) * 8 - 6, y = desk.y * 8 - 4;
    rect(c, x, y, 12, 7, P.screenOn);
    for (let i = 0; i < 3; i++) rect(c, x + 1, y + 1 + i * 2, 4 + ((frame + i * 3) % 7), 1, '#2f8f86');
  }
  const api = {palette: P, looks, paintMap, drawCharacter, drawBubble, screenGlow};
  root.OfficeArt = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
