AtomApp.navigation.setBackHandler(()=>{
 if(view==='editor'||view==='conflict'){view='list';render();return;}
 if(showDeleted){showDeleted=false;render();return;}
 if(view==='account'&&!locked){view='list';render();return;}
 AtomApp.home();
});
