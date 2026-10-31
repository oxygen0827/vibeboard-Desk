/* Composition root: the only production module allowed to name concrete peers. */
(() => {
  'use strict';
  const platform = YardPlatform.create({host: AtomApp, window, document});
  for (const name of ['repository','clock','scheduler','lifecycle','environment']) YardPorts.check(name, platform[name]);
  const domain = YardDomain.create({catalog: YardCatalog});
  const life = YardLife.create({domain, layout: YardLayout});
  const scene = YardScene.create({domain, life, layout: YardLayout});
  const session = YardSession.create({domain, repository: platform.repository, clock: platform.clock});
  const renderer = YardPorts.check('renderer', YardRenderer.create(document.getElementById('scene'), {
    assets: YardAssets, petCatalog: PixelPets.pets, layout: YardLayout,
    createPetRenderer: canvas => PixelPetRenderer.create(canvas, {pose: PixelPets.pose}),
    createEnvironment: image => YardEnvironment.create(image), createRig: paint => YardRig.create(paint)
  }));
  const view = YardPorts.check('view', YardView.create({document, portraits: {
    pet: pet => renderer.portrait(pet), resident: (canvas, id) => renderer.residentPortrait(canvas, id)
  }}));
  YardController.create({session, scene, view, renderer, ...platform,
    content: {residents: YardCatalog.residents, pets: PixelPets.pets}
  }).start();
})();
