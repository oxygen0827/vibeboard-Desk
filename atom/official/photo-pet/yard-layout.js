/* Scene coordinates only. Domain rules must not import this file. */
(function(root) {
  'use strict';
  const api = {
    width: 480, height: 360,
    residents: {
      smith: {row: 0, x: 122, y: 158},
      gardener: {row: 1, x: 270, y: 168},
      fisher: {row: 2, x: 371, y: 171}
    },
    plots: Array.from({length: 4}, (_, i) => ({x: 56 + i * 76, y: 263})),
    beds: [38, 114, 190, 266],
    gate: {x: 330, y: 212}, corner: {x: 330, y: 282}, workY: 282,
    actor: {x: 190, y: 202}, pet: {x: 150, y: 218},
    pathY: x => 202 + Math.max(0, x - 260) * .22
  };
  root.YardLayout = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
