/* Domain data. No screen coordinates, rendering, storage or clocks. */
(function(root) {
  'use strict';
  const care = {
    version: 1, duration: 96000,
    beds: Array.from({length: 4}, (_, i) => ({
      arrive: 11 + i * 9, seed: 12 + i * 9,
      waterStart: 13 + i * 9, water: 15 + i * 9, waterEnd: 17 + i * 9,
      fertilizeStart: 65 - i * 7, fertilized: 68 - i * 7, fertilizeEnd: 69 - i * 7,
      harvestStart: 69 + i * 5, harvested: 71 + i * 5
    }))
  };
  const residents = [
    {id: 'smith', name: '阿砧', role: '铁匠', task: '打造园艺工具', duration: 35000,
      description: '在工坊打造一件工具。每件工具让每块菜地多收获 1 根萝卜，最多加 3 根。'},
    {id: 'gardener', name: '小禾', role: '园丁', task: '播种、浇水与施肥', duration: care.duration,
      description: '补种、浇水、施堆肥后采收。每块多收 1 根，堆肥免费。保留已有作物，完成后领取。'},
    {id: 'fisher', name: '阿澈', role: '渔夫', task: '去池塘钓鱼', duration: 30000,
      description: '在池塘钓回 2 条鱼。萝卜用完时，可以用鱼喂伙伴。'}
  ];
  function freeze(value) {
    if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);}
    return value;
  }
  const api = freeze({grow: 30000, maxTools: 3, care, residents,
    petIds: ['dog', 'cat', 'rabbit', 'lion', 'tiger', 'bear']});
  root.YardCatalog = api;
  if (typeof module !== 'undefined') module.exports = api;
})(globalThis);
