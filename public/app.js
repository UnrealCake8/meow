const $=id=>document.getElementById(id);const msg=(id,value)=>$(id).textContent=value;async function api(path,options={}){const r=await fetch(path,{credentials:'same-origin',...options,headers:{'Content-Type':'application/json',...(options.headers||{})}});const data=await r.json().catch(()=>({}));if(!r.ok)throw Error(data.error||'Request failed');return data;}async function refresh(){const {user}=await api('/api/me');$('loginPanel').classList.toggle('hidden',!!user);$('dashboard').classList.toggle('hidden',!user);if(!user)return;msg('greeting','Hello, '+user.email);const [{vm},list]=await Promise.all([api('/api/my-vm'),api('/api/vms')]);msg('assignment',vm?'Assigned: '+vm.name+(vm.connectUrl?'':' · Ask your administrator to check the desktop URL'):'You have not claimed a desktop yet.');$('openVm').classList.toggle('hidden',!vm?.connectUrl);if(vm?.connectUrl)$('openVm').href=vm.connectUrl;const holder=$('vms');holder.replaceChildren();for(const item of list.vms){const row=document.createElement('div');row.className='vmrow';const label=document.createElement('span');label.textContent=item.name+' · '+item.os+(item.mine?' · Yours':item.claimed?' · Taken':' · Available');row.append(label);if(!item.claimed&&!vm){const btn=document.createElement('button');btn.className='small';btn.textContent='Claim';btn.onclick=async()=>{try{await api('/api/vms/'+item.id+'/claim',{method:'POST'});await refresh();}catch(e){msg('dashMessage',e.message)}};row.append(btn)}holder.append(row)}if(user.role==='admin'){try{const s=await api('/api/admin/overview');await renderAdmin(s)}catch{}}} $('login').addEventListener('submit',async e=>{e.preventDefault();msg('message','Signing in…');const f=new FormData(e.currentTarget);try{await api('/api/auth/login',{method:'POST',body:JSON.stringify(Object.fromEntries(f))});msg('message','');await refresh()}catch(err){msg('message',err.message)}});$('logout').onclick=async()=>{await api('/api/auth/logout',{method:'POST'});await refresh()};refresh().catch(e=>msg('message',e.message));
async function renderAdmin(stats){
 const box=$('adminBox');box.replaceChildren();
 const heading=document.createElement('h3');heading.textContent='Administration';box.append(heading);
 const count=document.createElement('p');count.textContent=stats.students+' students · '+stats.vms+' VMs · '+stats.claimed+' active claims';box.append(count);
 const {vms}=await api('/api/admin/vms');
 for(const vm of vms){
  const row=document.createElement('div');row.className='vmrow';
  const label=document.createElement('span');label.textContent=vm.name+' · '+(vm.assigned_to||'Available')+(vm.enabled?'':' · Disabled');row.append(label);
  if(vm.assigned_to){
   const release=document.createElement('button');release.className='small';release.textContent='Release';
   release.onclick=async()=>{if(!confirm('Release '+vm.name+' from '+vm.assigned_to+'?'))return;try{await api('/api/admin/vms/'+vm.id+'/release',{method:'POST'});await refresh()}catch(e){msg('dashMessage',e.message)}};
   row.append(release);
  }box.append(row);
 }
}
