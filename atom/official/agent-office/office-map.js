/* Fixed office layout on a 30×22 tile grid (8 px tiles, 240×180 low-res canvas). Pure data + pathfinding. */
(function(root) {
  'use strict';
  const COLS = 30, ROWS = 22, TILE = 8, FLOOR_TOP = 4, FLOOR_BOTTOM = 18;
  // Furniture footprints block walking. Coordinates are tiles.
  const desks = {
    researcher: {x: 3, y: 6, w: 5, h: 2, seat: {x: 5, y: 8}, label: {x: 5.5, y: 6}},
    writer: {x: 3, y: 12, w: 5, h: 2, seat: {x: 5, y: 14}, label: {x: 5.5, y: 12}},
    engineer: {x: 22, y: 6, w: 5, h: 2, seat: {x: 24, y: 8}, label: {x: 24.5, y: 6}},
    coordinator: {x: 22, y: 12, w: 5, h: 2, seat: {x: 24, y: 14}, label: {x: 24.5, y: 12}}
  };
  const furniture = [
    {kind: 'meeting', x: 12, y: 7, w: 6, h: 3},
    {kind: 'cabinet', x: 18, y: 3, w: 3, h: 2},
    {kind: 'shelf', x: 9, y: 3, w: 3, h: 2},
    {kind: 'coffee', x: 0, y: 15, w: 2, h: 2},
    {kind: 'sofa', x: 0, y: 17, w: 4, h: 2},
    {kind: 'plant', x: 28, y: 4, w: 2, h: 2},
    {kind: 'plant', x: 0, y: 4, w: 1, h: 2},
    {kind: 'plant', x: 28, y: 16, w: 2, h: 2}
  ];
  const points = {
    boss: {x: 15, y: 16},
    meeting: {x: 15, y: 11},
    cabinet: {x: 19, y: 5},
    lounge: {x: 4, y: 16},
    reportSlots: [{x: 13, y: 15}, {x: 17, y: 15}, {x: 12, y: 16}, {x: 18, y: 16}],
    approvalSlots: [{x: 13, y: 17}, {x: 17, y: 17}, {x: 11, y: 17}]
  };
  // The interaction tile the boss walks to for each target.
  const approach = {
    researcher: {x: 6, y: 9}, writer: {x: 6, y: 15}, engineer: {x: 23, y: 9}, coordinator: {x: 23, y: 15},
    meeting: points.meeting, cabinet: points.cabinet, boss: points.boss
  };
  const blocked = new Uint8Array(COLS * ROWS);
  function block(r) { for (let y = r.y; y < r.y + r.h; y++) for (let x = r.x; x < r.x + r.w; x++) blocked[y * COLS + x] = 1; }
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) if (y < FLOOR_TOP || y > FLOOR_BOTTOM) blocked[y * COLS + x] = 1;
  Object.values(desks).forEach(block); furniture.forEach(block);
  function walkable(x, y) { return x >= 0 && y >= 0 && x < COLS && y < ROWS && !blocked[y * COLS + x]; }
  // Breadth-first search on the 4-neighbour grid; returns tile waypoints excluding the start.
  function path(from, to) {
    const sx = Math.round(from.x), sy = Math.round(from.y), tx = Math.round(to.x), ty = Math.round(to.y);
    if (!walkable(tx, ty)) return null;
    if (sx === tx && sy === ty) return [];
    const prev = new Int32Array(COLS * ROWS).fill(-1), start = sy * COLS + sx, goal = ty * COLS + tx;
    const queue = [start]; prev[start] = start;
    for (let head = 0; head < queue.length; head++) {
      const cur = queue[head]; if (cur === goal) break;
      const cx = cur % COLS, cy = (cur / COLS) | 0;
      for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx = cx + dx, ny = cy + dy, n = ny * COLS + nx;
        if (walkable(nx, ny) && prev[n] < 0) { prev[n] = cur; queue.push(n); }
      }
    }
    if (prev[goal] < 0) return null;
    const out = [];
    for (let cur = goal; cur !== start; cur = prev[cur]) out.push({x: cur % COLS, y: (cur / COLS) | 0});
    return out.reverse();
  }
  const api = {COLS, ROWS, TILE, FLOOR_TOP, FLOOR_BOTTOM, desks, furniture, points, approach, walkable, path};
  root.OfficeMap = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
