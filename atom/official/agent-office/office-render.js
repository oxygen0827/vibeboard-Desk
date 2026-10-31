/* Canvas adapter: paints a scene frame. Reads no task state and no clock. */
(function(root) {
  'use strict';
  function create(canvas, {map, art, document: doc}) {
    const ctx = canvas.getContext('2d'), W = canvas.width, H = canvas.height;
    const base = doc.createElement('canvas'); base.width = W; base.height = H;
    const bctx = base.getContext('2d'); bctx.imageSmoothingEnabled = false; ctx.imageSmoothingEnabled = false;
    art.paintMap(bctx, map);
    function render(frame) {
      ctx.drawImage(base, 0, 0);
      for (const id of frame.glows) art.screenGlow(ctx, map.desks[id], frame.frame);
      for (const a of frame.actors) art.drawCharacter(ctx, a.px, a.py, a.look, a.pose, a.frame, a.facing);
      for (const a of frame.actors) if (a.bubble) art.drawBubble(ctx, a.px, a.py, a.bubble, a.frame);
    }
    function portrait(target, look) {
      const c = target.getContext('2d'); c.imageSmoothingEnabled = false; c.clearRect(0, 0, target.width, target.height);
      art.drawCharacter(c, target.width / 2, target.height - 1, look, 'stand', 0, 'down');
    }
    return {render, portrait};
  }
  const api = {create};
  root.OfficeRender = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
