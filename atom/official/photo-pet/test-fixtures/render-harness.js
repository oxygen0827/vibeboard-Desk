// Renderer adapter tests inject a fully specified frame, independent of the app scheduler.
window.Yard=YardDomain.create({catalog:YardCatalog});
window.Life=YardLife.create({domain:Yard,layout:YardLayout});
window.createTestRenderer=function(canvas){
 const renderer=YardRenderer.create(canvas,{
  assets:YardAssets,petCatalog:PixelPets.pets,layout:YardLayout,
  createPetRenderer:canvas=>PixelPetRenderer.create(canvas,{pose:PixelPets.pose}),
  createEnvironment:image=>YardEnvironment.create(image),createRig:paint=>YardRig.create(paint)
 });
 return {...renderer,render(state,actor,pet,time,motion,effect,options={}){
  const now=Date.now(),model=Yard.project(state,now),job=state.jobs.gardener;
  const careTime=job?.care===1?Yard.careTime(job,now):0;
  const frame={...model,actor,pet,time,motion,effect,
   residents:Yard.residents.map(n=>Life.npc(n,state,now,time,options.ambient,motion)),
   plots:model.plots.map((p,i)=>({...p,...YardLayout.plots[i]})),
   readyProducts:model.jobs.filter(j=>j.canClaim).map(j=>j.id),parkedCan:careTime>=44&&careTime<86};
  renderer.render(frame);canvas.dataset.readyProducts=frame.readyProducts.join(',');return frame.residents;
 }};
};
