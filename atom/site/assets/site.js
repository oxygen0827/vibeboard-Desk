'use strict';
(() => {
  const field=document.querySelector('#guide-search');
  if(!field)return;
  const sections=[...document.querySelectorAll('.guide-content section')];
  const links=[...document.querySelectorAll('.guide-side nav a')];
  const empty=document.querySelector('.no-results');
  field.addEventListener('input',()=>{
    const q=field.value.trim().toLocaleLowerCase();let count=0;
    for(const section of sections){const hit=!q||section.textContent.toLocaleLowerCase().includes(q);section.hidden=!hit;if(hit)count++;const link=links.find(a=>a.hash==='#'+section.id);if(link)link.hidden=!hit;}
    empty.hidden=count>0;
  });
  const mark=id=>{for(const a of links){const active=a.hash==='#'+id;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','location');else a.removeAttribute('aria-current');}};
  for(const a of links)a.addEventListener('click',()=>mark(a.hash.slice(1)));
  if('IntersectionObserver'in window){const observer=new IntersectionObserver(entries=>{for(const e of entries)if(e.isIntersecting)mark(e.target.id);},{rootMargin:'-5% 0px -65% 0px'});sections.forEach(s=>observer.observe(s));}
})();
