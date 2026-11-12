const byId = id => document.getElementById(id);
const tabs = {
  wiki: {label:'Wiki',resource:'wiki'},
  news: {label:'News',resource:'articles',section:'news'},
  reviews: {label:'Reviews',resource:'articles',section:'review'},
  reports: {label:'Weekly reports',resource:'articles',section:'weekly_report'},
  tours: {label:'Tour dates',resource:'tours'},
  media: {label:'Images',resource:'media'},
  livestream: {label:'Livestream',resource:'livestream',fixed:true},
  sections: {label:'Page text',resource:'sections',fixed:true},
  socials: {label:'Social links',resource:'socials'},
  account: {label:'Password',fixed:true},
};
let active='news', items=[], media=[], current=null, dirty=false;
function message(text,error=false){byId('message').textContent=text;byId('message').className=error?'error':'';}
async function api(path,options={}){
  const response=await fetch(path,{credentials:'same-origin',...options,headers:{...(options.body && typeof options.body==='string'?{'Content-Type':'application/json'}:{}),...options.headers}});
  const result=await response.json();
  if(!response.ok){if(response.status===401 && path!=='/api/login')showLogin();throw new Error(result.error||'Request failed.');}
  return result;
}
function element(tag,attributes={},text=''){
  const node=document.createElement(tag);Object.assign(node,attributes);if(text)node.textContent=text;return node;
}
function showLogin(){byId('login').hidden=false;byId('dashboard').hidden=true;byId('logout').hidden=true;items=[];media=[];byId('editor').replaceChildren();}
async function enter(){byId('login').hidden=true;byId('dashboard').hidden=false;byId('logout').hidden=false;media=await api('/api/admin/media');await load();}
function discard(){return !dirty||confirm('Discard your unsaved changes?');}
async function load(){
  message('Loading…');current=null;dirty=false;
  document.querySelectorAll('#tabs button').forEach(button=>button.classList.toggle('active',button.dataset.tab===active));
  byId('section-title').textContent=tabs[active].label;byId('new').hidden=!!tabs[active].fixed||active==='media';byId('search').value='';
  byId('editor').replaceChildren(element('p',{className:'muted'},'Choose an item to edit, or add something new.'));
  if(active==='account'){items=[];renderItems();passwordForm();message('');return;}
  items=await api(`/api/admin/${tabs[active].resource}`);
  if(tabs[active].section)items=items.filter(item=>item.section===tabs[active].section);
  renderItems();if(active==='media')mediaLibrary();else if(tabs[active].fixed&&items.length)edit(items[0]);message('');
}
function renderItems(){
  const query=byId('search').value.toLowerCase();byId('items').replaceChildren();
  for(const item of items){const title=item.title||item.artist||item.name||item.original_filename||item.section||'Untitled';if(!title.toLowerCase().includes(query))continue;
    const button=element('button',{type:'button',className:'item'+(current===item?' selected':'')});button.append(element('strong',{},title),element('small',{},item.status||item.section||'Settings'));
    button.onclick=()=>{if(discard())edit(item);};byId('items').append(button);
  }
  if(!items.length)byId('items').append(element('p',{className:'muted'},active==='account'?'Your private account.':'Nothing here yet.'));
}
function field(form,name,label,type='text',value='',options=[]){
  const wrapper=element('label',{},label);let input;
  if(type==='textarea')input=element('textarea',{value:value||'',className:name==='body_markdown'?'body':''});
  else if(type==='select'){input=element('select');for(const option of options){const [key,title]=Array.isArray(option)?option:[option,option];input.append(element('option',{value:key},title));}input.value=value??'';}
  else input=element('input',{type,value:value??''});
  input.name=name;wrapper.append(input);form.append(wrapper);return input;
}
function edit(item={}){
  if(active==='wiki'){wikiForm(item).catch(error=>message(error.message,true));return;}
  current=item;dirty=false;renderItems();byId('editor').replaceChildren();
  if(active==='media'){mediaLibrary(item);return;}
  const form=element('form');const tab=tabs[active];
  const add=(name,label,type='text',options=[])=>field(form,name,label,type,item[name],options);
  const image=(name)=>add(name,'Image','select',[['','No image'],...media.map(image=>[image.id,image.original_filename])]);
  if(tab.section){
    add('title','Title').required=true;add('slug','Page slug (lowercase words separated by hyphens)').required=true;
    add('summary','Short introduction','textarea');add('body_markdown','Article text','textarea');image('cover_media_id');
    if(active==='reviews'){
      add('artist','Artist');add('release_title','Release title');add('label','Record label');add('release_date','Release date','date');
      const rating=add('rating','Rating (optional, 0–10)','number');rating.min='0';rating.max='10';rating.step='0.1';add('listen_url','Listen link (HTTPS)');
    }
    add('status','Visibility','select',['draft','published','archived']);
    if(!item.status)form.elements.status.value='draft';
    add('published_at','Publication date (UTC ISO format; leave blank to publish now)');
    form.append(element('p',{className:'help'},'Drafts are private. Published articles appear on the website; future publication dates stay hidden until that time. Text is displayed safely as plain text, with paragraph breaks.'));
    const preview=element('div',{className:'preview',hidden:true});const toggle=element('button',{type:'button'},'Preview text');toggle.onclick=()=>{preview.hidden=!preview.hidden;preview.textContent=form.elements.body_markdown.value||'No text yet.';};form.append(toggle,preview);
  }else if(active==='tours'){
    for(const [name,label] of [['artist','Artist'],['venue','Venue'],['city','City'],['region','State / region'],['country','Country'],['starts_at','Starts (ISO date/time with UTC offset)'],['ends_at','Ends (optional)'],['timezone','Timezone'],['ticket_url','Ticket link (HTTPS)']])add(name,label);
    if(!item.timezone)form.elements.timezone.value='America/Los_Angeles';form.elements.artist.required=true;form.elements.starts_at.required=true;
    add('body_markdown','Event details','textarea');image('image_media_id');add('status','Visibility','select',['draft','published','cancelled','archived']);if(!item.status)form.elements.status.value='draft';
  }else if(active==='sections'){
    form.append(element('h2',{},item.section));add('eyebrow','Small label');add('heading','Heading');add('description','Description','textarea');image('image_media_id');
    form.append(element('p',{className:'help'},'These settings update immediately when saved. Empty fields retain the website’s original wording. Global heading updates the footer tagline; global description updates its small print.'));
  }else if(active==='socials'){
    add('name','Network name').required=true;add('handle','Handle');add('url','Profile link (HTTPS)').required=true;add('sort_order','Display order','number');if(item.sort_order===undefined)form.elements.sort_order.value='0';
    add('enabled','Visible','select',[[1,'Yes'],[0,'No']]);if(item.enabled===undefined)form.elements.enabled.value='1';
  }else if(active==='livestream'){
    for(const [name,label] of [['title','Show title'],['stream_url','Direct audio stream URL (HTTPS)'],['schedule_text','Schedule'],['timezone','Timezone'],['station_name','Station'],['station_frequency','Frequency'],['station_location','Station location']])add(name,label);
    add('description','Description','textarea');image('image_media_id');add('is_live','Broadcast status','select',[[0,'Offline'],[1,'Live']]);
  }
  const actions=element('div',{className:'actions'});const save=element('button',{type:'submit',className:'primary'},'Save changes');actions.append(save);
  if(item.id&&!tab.fixed){const remove=element('button',{type:'button',className:'danger'},'Delete');remove.onclick=async()=>{if(!confirm('Permanently delete this item?'))return;try{await api(`/api/admin/${tab.resource}/${item.id}`,{method:'DELETE'});dirty=false;await load();message('Deleted.');}catch(error){message(error.message,true);}};actions.append(remove);}
  form.append(actions);form.oninput=()=>{dirty=true;};
  form.onsubmit=async event=>{event.preventDefault();save.disabled=true;try{
    const data=Object.fromEntries(new FormData(form));for(const name of ['sort_order','enabled','is_live'])if(name in data)data[name]=Number(data[name]);
    if(tab.section)data.section=tab.section;const id=item.id??item.section;
    await api(`/api/admin/${tab.resource}${id!==undefined?'/'+encodeURIComponent(id):''}`,{method:id!==undefined?'PUT':'POST',body:JSON.stringify(data)});
    dirty=false;await load();message('Saved.');
  }catch(error){message(error.message,true);}finally{save.disabled=false;}};byId('editor').append(form);
}
function mediaLibrary(selected){
  byId('editor').replaceChildren();const uploadLabel=element('label',{className:'upload-label'},'Upload image — JPEG, PNG, GIF or WebP, up to 10 MB');const input=element('input',{type:'file',accept:'image/jpeg,image/png,image/gif,image/webp'});uploadLabel.append(input);byId('editor').append(uploadLabel);
  input.onchange=async()=>{const file=input.files[0];if(!file)return;if(file.size>10485760){message('Choose an image under 10 MB.',true);return;}input.disabled=true;try{message('Uploading…');await api('/api/admin/media',{method:'POST',headers:{'Content-Type':file.type,'X-Filename':file.name.replace(/[^\x20-\x7e]/g,'_')},body:file});media=await api('/api/admin/media');await load();message('Image uploaded. Choose it in an article or page setting.');}catch(error){message(error.message,true);}finally{input.disabled=false;}};
  if(selected){const form=element('form');form.append(element('img',{src:`/media/${selected.id}`,alt:selected.alt_text,className:'thumb'}));field(form,'alt_text','Image description for accessibility','textarea',selected.alt_text);field(form,'credit','Photo credit','text',selected.credit);form.append(element('button',{type:'submit',className:'primary'},'Save image details'));form.onsubmit=async event=>{event.preventDefault();try{await api(`/api/admin/media/${selected.id}`,{method:'PUT',body:JSON.stringify(Object.fromEntries(new FormData(form)))});media=await api('/api/admin/media');await load();message('Image details saved.');}catch(error){message(error.message,true);}};byId('editor').append(form);}
  else{const grid=element('div',{className:'media-grid'});for(const image of items){const button=element('button',{type:'button'});button.append(element('img',{src:`/media/${image.id}`,alt:image.alt_text||image.original_filename,className:'thumb',loading:'lazy'}),element('span',{},image.original_filename));button.onclick=()=>edit(image);grid.append(button);}byId('editor').append(grid);}
}
function passwordForm(){
  const form=element('form');field(form,'current_password','Current password','password').autocomplete='current-password';field(form,'new_password','New password (15–128 characters)','password').autocomplete='new-password';field(form,'confirm_password','Confirm new password','password').autocomplete='new-password';
  for(const input of form.querySelectorAll('input')){input.required=true;input.maxLength=128;}form.elements.new_password.minLength=15;
  form.append(element('button',{type:'submit',className:'primary'},'Change password and sign out'));
  form.onsubmit=async event=>{event.preventDefault();const data=Object.fromEntries(new FormData(form));if(data.new_password!==data.confirm_password){message('New passwords do not match.',true);return;}const button=form.querySelector('button');button.disabled=true;try{await api('/api/admin/password',{method:'POST',body:JSON.stringify(data)});showLogin();form.reset();message('Password changed. Sign in again.');}catch(error){message(error.message,true);}finally{button.disabled=false;}};byId('editor').append(form);
}
for(const [key,tab] of Object.entries(tabs)){const button=element('button',{type:'button'},tab.label);button.dataset.tab=key;button.onclick=()=>{if(!discard())return;active=key;load().catch(error=>message(error.message,true));};byId('tabs').append(button);}
byId('login-form').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget,button=form.querySelector('button');button.disabled=true;try{await api('/api/login',{method:'POST',body:JSON.stringify(Object.fromEntries(new FormData(form)))});form.elements.password.value='';message('');await enter();}catch(error){message(error.message,true);}finally{button.disabled=false;}};
byId('logout').onclick=async()=>{if(!discard())return;try{await api('/api/admin/logout',{method:'POST',body:'{}'});dirty=false;showLogin();message('Signed out.');}catch(error){message(error.message,true);}};
byId('new').onclick=()=>{if(discard())edit();};byId('search').oninput=renderItems;
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
api('/api/admin/session').then(enter).catch(error=>{showLogin();if(error.message!=='Please sign in.')message(error.message,true);});

async function wikiForm(item={}) {
  const chosen=item;
  current=chosen;dirty=false;renderItems();
  byId('editor').replaceChildren(element('p',{},'Loading wiki editor…'));
  const [genres,entry]=await Promise.all([api('/api/admin/wiki/genres'),item.id?api('/api/admin/wiki/'+item.id):Promise.resolve({entry_type:'artist',revision:0})]);
  if(active!=='wiki'||current!==chosen)return;
  byId('editor').replaceChildren();
  const form=element('form');
  form.append(element('h2',{},entry.id?'Edit wiki draft':'New wiki entry'));
  form.append(element('p',{className:'help'},'Drafts are private. Save a profile here; public publishing, images and relationships will follow.'));
  const type=field(form,'entry_type','Entry type','select',entry.entry_type,[['artist','Artist'],['band','Band'],['label','Label']]);type.disabled=!!entry.id;
  field(form,'name','Name','text',entry.name).required=true;
  field(form,'slug','Page slug (lowercase words separated by hyphens)','text',entry.slug).required=true;
  field(form,'summary','Short introduction','textarea',entry.summary);
  field(form,'body_markdown','Biography / history','textarea',entry.body_markdown);
  field(form,'location','Location','text',entry.location);
  const genreBox=element('fieldset');genreBox.append(element('legend',{},'Genres'));
  for(const genre of genres){const label=element('label',{},genre.name);const input=element('input',{type:'checkbox',value:String(genre.id),checked:(entry.genre_ids||[]).includes(genre.id)});input.name='genre_ids';label.prepend(input);genreBox.append(label);}form.append(genreBox);
  function rows(title,definitions,initial){
    const section=element('fieldset');section.append(element('legend',{},title));const container=element('div');section.append(container);const records=[];
    function add(values={}){
      const row=element('div',{className:'wiki-row'});const inputs={};
      for(const [key,label,kind='text',options=[]] of definitions)inputs[key]=field(row,key,label,kind,values[key]??(key==='alias_type'?'alternate':''),options);
      const remove=element('button',{type:'button'},'Remove');remove.onclick=()=>{records.splice(records.indexOf(record),1);row.remove();dirty=true;};row.append(remove);const record={inputs};records.push(record);container.append(row);
    }
    initial.forEach(add);const button=element('button',{type:'button'},'Add '+(title==='Aliases'?'alias':title.toLowerCase().replace(/s$/,'')));button.onclick=()=>{add();dirty=true;};section.append(button);form.append(section);
    return ()=>records.map(({inputs})=>Object.fromEntries(Object.entries(inputs).map(([key,input])=>[key,input.value])));
  }
  const aliases=rows('Aliases',[['name','Name'],['alias_type','Kind','select',['alternate','former','stylization']],['notes','Notes']],entry.aliases||[]);
  const links=rows('Links',[['label','Label'],['url','HTTPS URL','url']],entry.links||[]);
  const sources=rows('Sources',[['title','Title'],['url','HTTPS URL (optional)','url'],['publisher','Publisher'],['citation_notes','Citation notes','textarea']],entry.sources||[]);
  const preview=element('div',{className:'preview',hidden:true});const toggle=element('button',{type:'button'},'Preview text');toggle.onclick=()=>{preview.hidden=!preview.hidden;preview.textContent=form.elements.body_markdown.value||'No text yet.';};form.append(toggle,preview);
  form.append(element('p',{className:'help'},'Text preview shows paragraph breaks; Markdown formatting is not rendered in this editor.'));
  const save=element('button',{type:'submit',className:'primary'},'Save draft');form.append(save);
  if(entry.status && entry.status!=='draft'){save.disabled=true;form.append(element('p',{},'This entry is not a draft and cannot be edited in this release.'));}
  if(entry.id)form.append(element('p',{className:'muted'},'Saved revision '+entry.revision));
  form.oninput=()=>{dirty=true;};
  form.onsubmit=async event=>{
    event.preventDefault();save.disabled=true;
    try{
      const data={entry_type:entry.entry_type,revision:entry.revision,status:'draft',aliases:aliases(),links:links(),sources:sources(),genre_ids:[...genreBox.querySelectorAll('input:checked')].map(input=>Number(input.value))};
      if(!entry.id)data.entry_type=type.value;
      for(const key of ['name','slug','summary','body_markdown','location'])data[key]=form.querySelector('[name="'+key+'"]').value;
      const saved=await api('/api/admin/wiki'+(entry.id?'/'+entry.id:''),{method:entry.id?'PUT':'POST',body:JSON.stringify(data)});
      dirty=false;
      if(active==='wiki'){await load();await wikiForm(saved);message('Wiki draft saved. Revision '+saved.revision+'.');}
    }catch(error){message(error.message,true);}finally{save.disabled=false;}
  };
  byId('editor').append(form);
}
