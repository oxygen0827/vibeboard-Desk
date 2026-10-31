// One batch owns one account session, even across asynchronous requests.
const collections={
 notes:{route:'/notes',pending:'pending',items:'notes',field:'note',flag:'syncing'},
 agenda:{route:'/agenda',pending:'agenda_pending',items:'agenda',field:'item',flag:'agendaSyncing'}
};
export async function syncPrivate(studio,kind){
 const spec=collections[kind];
 if(studio[spec.flag])return;
 const session=studio.session(),profile=studio.profile();
 studio.assertPrivateWritable(spec.route);
 studio[spec.flag]=true;
 try{
  for(const edit of [...profile[spec.pending]]){
   studio.assertSession(session);
   if(edit.conflict)continue;
   const sent=structuredClone(edit[spec.field]);
   let result;
   try{result=await studio.remote(spec.route,{method:'POST',body:sent});}
   catch(error){
    studio.assertSession(session);
    if(error.status!==409||!error.details?.current)throw error;
    edit.conflict=error.details;studio.save();continue;
   }
   studio.assertSession(session);
   const saved=result[spec.field],index=profile[spec.items].findIndex(item=>item.id===saved.id);
   if(index<0)profile[spec.items].push(saved);else profile[spec.items][index]=saved;
   if(JSON.stringify(edit[spec.field])===JSON.stringify(sent))profile[spec.pending]=profile[spec.pending].filter(item=>item!==edit);
   else edit[spec.field].revision=saved.revision;
   studio.save();
  }
 }finally{studio[spec.flag]=false;}
}
