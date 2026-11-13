// Draft editing only. Publishing and public routes are a separate release.
function fail(message, status = 400) { throw Object.assign(new Error(message), {status}); }
function text(value, name, limit = 5000) {
  if (typeof value !== 'string' || value.length > limit) fail(`Invalid ${name}.`);
  return value.trim();
}
function list(value, name) {
  if (!Array.isArray(value) || value.length > 100) fail(`Invalid ${name} (maximum 100).`);
  return value;
}
function link(value, optional = false) {
  if (optional && !value) return null;
  const result = text(value, 'URL', 2048);
  try { const url = new URL(result); if (url.protocol !== 'https:' || url.username || url.password) throw Error(); }
  catch { fail('Use a valid HTTPS link without credentials.'); }
  return result;
}
async function detail(db, id) {
  const entry = await db.prepare('SELECT * FROM entries WHERE id=?').bind(id).first();
  if (!entry) fail('Wiki entry not found.',404);
  const results = await db.batch([
    db.prepare('SELECT name,alias_type,notes FROM aliases WHERE entry_id=? ORDER BY id').bind(id),
    db.prepare('SELECT genre_id FROM entry_genres WHERE entry_id=? ORDER BY genre_id').bind(id),
    db.prepare('SELECT label,url FROM entry_links WHERE entry_id=? ORDER BY sort_order,id').bind(id),
    db.prepare('SELECT id,title,url,publisher,accessed_on,citation_notes FROM entry_sources WHERE entry_id=? ORDER BY sort_order,id').bind(id),
    db.prepare('SELECT COALESCE(MAX(revision_number),0) AS revision FROM entry_revisions WHERE entry_id=?').bind(id),
    db.prepare('SELECT active_from_year,active_to_year FROM artist_details WHERE entry_id=?').bind(id),
    db.prepare('SELECT * FROM entry_images WHERE entry_id=? ORDER BY sort_order,id').bind(id),
  ]);
  return {...entry, ...(entry.entry_type==='artist'?{active_from_year:null,active_to_year:null,...results[5].results[0]}:{}), images:results[6].results.map(image=>({...image,url:'/api/admin/wiki-images/'+image.id})), aliases:results[0].results, genre_ids:results[1].results.map(row=>row.genre_id), links:results[2].results, sources:results[3].results, revision:results[4].results[0].revision};
}
export async function wiki(request, env, suffix, {body,json,admin}) {
  const db=env.WIKI_DB;
  if (!db) fail('Wiki storage is not configured.',503);
  if (suffix === 'overview') {
    if (request.method !== 'GET') fail('Method not allowed.',405);
    const results=await db.batch([
      db.prepare('SELECT entry_type,status,COUNT(*) AS count FROM entries GROUP BY entry_type,status'),
      db.prepare('SELECT r.id,r.entry_id,r.revision_number,r.change_note,r.created_at,e.name,e.entry_type,e.status FROM entry_revisions r JOIN entries e ON e.id=r.entry_id ORDER BY julianday(r.created_at) DESC,r.id DESC LIMIT 10'),
      db.prepare("SELECT id,name,entry_type,updated_at FROM entries WHERE status='draft' ORDER BY julianday(updated_at) DESC,id DESC LIMIT 5"),
    ]);
    const counts={total:0,by_status:{draft:0,published:0,archived:0},by_type:{artist:0,band:0,label:0}};
    for(const row of results[0].results){counts.total+=row.count;counts.by_status[row.status]+=row.count;counts.by_type[row.entry_type]+=row.count;}
    return json({counts,recent_changes:results[1].results,recent_drafts:results[2].results});
  }
  if (suffix === 'genres' && request.method === 'GET') return json((await db.prepare('SELECT * FROM genres ORDER BY name').all()).results);
  if (suffix && !/^[1-9][0-9]*$/.test(suffix)) fail('Not found.',404);
  let id = suffix ? Number(suffix) : null;
  if (id !== null && !Number.isSafeInteger(id)) fail('Invalid entry ID.');
  if (request.method === 'GET') {
    if (id) return json(await detail(db,id));
    const params=new URL(request.url).searchParams;
    const query=text(params.get('q')??'','search',200);
    const type=params.get('type')??'';
    if(type && !['artist','band','label'].includes(type))fail('Invalid entry type filter.');
    const pageValue=params.get('page')??'1';
    if(!/^[1-9][0-9]*$/.test(pageValue)||!Number.isSafeInteger(Number(pageValue)))fail('Invalid page.');
    const pageSize=25;
    const where="WHERE (?='' OR entry_type=?) AND (?='' OR instr(lower(name),lower(?))>0 OR instr(lower(slug),lower(?))>0)";
    const values=[type,type,query,query,query];
    const total=(await db.prepare(`SELECT COUNT(*) AS total FROM entries ${where}`).bind(...values).first()).total;
    const pages=Math.max(1,Math.ceil(total/pageSize));
    const page=Math.min(Number(pageValue),pages);
    const items=(await db.prepare(`SELECT id,entry_type,name,slug,status,updated_at FROM entries ${where} ORDER BY julianday(updated_at) DESC,id DESC LIMIT ? OFFSET ?`).bind(...values,pageSize,(page-1)*pageSize).all()).results;
    return json({items,total,page,page_size:pageSize,pages});
  }
  if (!(request.method === 'POST' && !id) && !(request.method === 'PUT' && id)) fail('Method not allowed.',405);
  const data=await body(request);
  if (data.status !== undefined && data.status !== 'draft') fail('This editor saves drafts only.');
  const entry_type=text(data.entry_type,'entry type');
  if (!['artist','band','label'].includes(entry_type)) fail('Choose Artist, Band or Label.');
  const name=text(data.name,'name',200); if (!name) fail('Name is required.');
  const slug=text(data.slug,'slug',200); if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail('Use lowercase words separated by hyphens for the slug.');
  const existing=id?await detail(db,id):null;
  let revision=0;
  if(existing){
    if(existing.status!=='draft')fail('Only draft entries can be edited in this release.',409);
    if(existing.entry_type!==entry_type)fail('Entry type cannot be changed.');
    if(!Number.isSafeInteger(data.revision)||data.revision!==existing.revision)fail('This entry changed. Reopen it before saving.',409);
    revision=existing.revision;
  }
  const snapshot={entry_type,name,slug,summary:text(data.summary,'introduction'),body_markdown:text(data.body_markdown,'biography',200000),location:text(data.location,'location',200)};
  for(const key of ['active_from_year','active_to_year']){
    const value=data[key]===undefined?(existing?.[key]??null):data[key];
    if(value!==null && (!Number.isInteger(value)||value<1000||value>9999))fail('Activity years must be whole years from 1000 to 9999, or blank.');
    if(entry_type==='artist')snapshot[key]=value;
    else if(value!==null)fail('Activity years apply to artists only.');
  }
  if(snapshot.active_from_year!=null && snapshot.active_to_year!=null && snapshot.active_to_year<snapshot.active_from_year)fail('Activity end year cannot precede the start year.');
  snapshot.aliases=list(data.aliases,'aliases').map(row=>{
    if (!row || typeof row!=='object') fail('Invalid alias.');
    const name=text(row.name,'alias',200); if (!name) fail('Alias name is required.');
    if (!['alternate','former','stylization'].includes(row.alias_type)) fail('Invalid alias type.');
    return {name,alias_type:row.alias_type,notes:text(row.notes ?? '','alias notes')};
  });
  if (new Set(snapshot.aliases.map(row=>row.name.toLowerCase())).size!==snapshot.aliases.length) fail('Remove duplicate aliases.');
  snapshot.genre_ids=list(data.genre_ids,'genres');
  if (snapshot.genre_ids.some(id=>!Number.isSafeInteger(id)||id<1) || new Set(snapshot.genre_ids).size!==snapshot.genre_ids.length) fail('Invalid genre selection.');
  const genres=(await db.prepare('SELECT id FROM genres').all()).results;
  if (snapshot.genre_ids.some(id=>!genres.some(row=>row.id===id))) fail('Unknown genre.');
  snapshot.links=list(data.links,'links').map(row=>{
    if (!row || typeof row!=='object') fail('Invalid link.');
    const label=text(row.label,'link label',200);if(!label)fail('Link label is required.');
    return {label,url:link(row.url)};
  });
  if(new Set(snapshot.links.map(row=>row.url)).size!==snapshot.links.length)fail('Remove duplicate links.');
  const usedSourceIds=new Set();
  snapshot.sources=list(data.sources,'sources').map(row=>{
    if (!row || typeof row!=='object') fail('Invalid source.');
    const title=text(row.title,'source title',500);if(!title)fail('Source title is required.');
    const url=link(row.url,true);
    let previous;
    if(row.id!==undefined){
      if(!Number.isSafeInteger(row.id)||usedSourceIds.has(row.id))fail('Invalid or duplicate source ID.');
      previous=existing?.sources.find(source=>source.id===row.id);
      if(!previous)fail('Source does not belong to this entry.');
    }else if(row.accessed_on===undefined && existing){
      // Older clients did not send source IDs or access dates. Match only an
      // unambiguous unchanged identity; otherwise require a fresh editor load.
      const matches=existing.sources.filter(source=>source.title===title && source.url===url);
      if(matches.length===1)previous=matches[0];
      else if(existing.sources.some(source=>source.accessed_on!==null))fail('Reopen this entry to preserve its source dates.',409);
    }
    if(previous){if(usedSourceIds.has(previous.id))fail('Duplicate source ID.');usedSourceIds.add(previous.id);}
    const accessed_on=row.accessed_on===undefined?(previous?.accessed_on??null):(row.accessed_on===''?null:row.accessed_on);
    if(accessed_on!==null && (typeof accessed_on!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(accessed_on)||!Number.isFinite(Date.parse(accessed_on))||new Date(accessed_on).toISOString().slice(0,10)!==accessed_on))fail('Use a valid source access date.');
    return {...(previous?{id:previous.id}:{}),title,url,accessed_on,publisher:text(row.publisher ?? '','publisher',500),citation_notes:text(row.citation_notes ?? '','citation notes')};
  });
  const imageIds=new Set(),imageKeys=new Set();
  snapshot.images=[];
  for(const row of list(data.images===undefined?(existing?.images??[]):data.images,'images')){
    if(!row||typeof row!=='object')fail('Invalid image.');
    let previous,r2_key;
    if(row.id!==undefined){
      if(!Number.isSafeInteger(row.id)||imageIds.has(row.id))fail('Invalid or duplicate image ID.');
      previous=existing?.images.find(image=>image.id===row.id);
      if(!previous)fail('Image does not belong to this entry.');
      if(row.media_id!==undefined)fail('Remove the image and select its replacement from the library.');
      imageIds.add(row.id);r2_key=previous.r2_key;
    }else{
      const media_id=text(row.media_id,'library image ID',100);
      const media=await env.DB.prepare('SELECT object_key,content_type FROM media WHERE id=?').bind(media_id).first();
      if(!media||!['image/jpeg','image/png','image/gif','image/webp'].includes(media.content_type))fail('Choose an uploaded JPEG, PNG, GIF or WebP image.');
      if(!env.MEDIA||!await env.MEDIA.head(media.object_key))fail('The image file is unavailable. Upload it again.',409);
      r2_key=media.object_key;
    }
    if(imageKeys.has(r2_key))fail('Remove duplicate images.');imageKeys.add(r2_key);
    const value=(key,fallback='')=>row[key]===undefined?(previous?.[key]??fallback):row[key];
    const is_primary=value('is_primary',0);
    if(![0,1].includes(is_primary))fail('Invalid primary image selection.');
    snapshot.images.push({...(previous?{id:previous.id}:{}),r2_key,
      alt_text:text(value('alt_text'),'image description',1000),caption:text(value('caption'),'caption',5000),
      credit:text(value('credit'),'image credit',1000),source_url:link(value('source_url',null),true),
      rights_notes:text(value('rights_notes'),'image rights notes',5000),is_primary,sort_order:snapshot.images.length});
  }
  if(snapshot.images.filter(image=>image.is_primary===1).length>1)fail('Choose only one primary image.');
  const duplicate=await db.prepare('SELECT id FROM entries WHERE slug=?').bind(slug).first();
  if(duplicate && duplicate.id!==id)fail('That slug is already in use.',409);
  const now=new Date().toISOString();
  const statements=[];
  if(!id){
    const bytes=crypto.getRandomValues(new Uint8Array(6));id=bytes.reduce((n,b)=>n*256+b,0)||1;
    statements.push(db.prepare('INSERT INTO entries(id,entry_type,name,slug,summary,body_markdown,location,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?)').bind(id,entry_type,name,slug,snapshot.summary,snapshot.body_markdown,snapshot.location,now,now));
  }else{
    statements.push(db.prepare('UPDATE entries SET name=?,slug=?,summary=?,body_markdown=?,location=?,updated_at=? WHERE id=?').bind(name,slug,snapshot.summary,snapshot.body_markdown,snapshot.location,now,id));
  }
  if(entry_type==='artist')statements.push(db.prepare('INSERT INTO artist_details(entry_id,active_from_year,active_to_year) VALUES(?,?,?) ON CONFLICT(entry_id) DO UPDATE SET active_from_year=excluded.active_from_year,active_to_year=excluded.active_to_year').bind(id,snapshot.active_from_year,snapshot.active_to_year));
  // A unique revision number makes concurrent stale saves roll back atomically.
  statements.push(db.prepare('INSERT INTO entry_revisions(entry_id,revision_number,snapshot_json,editor_reference,change_note) VALUES(?,?,?,?,?)').bind(id,revision+1,JSON.stringify({...snapshot,status:'draft',snapshot_scope:'draft-editor-v3'}),String(admin.admin_id),'Saved draft'));
  for(const table of ['aliases','entry_genres','entry_links','entry_sources','entry_images'])statements.push(db.prepare(`DELETE FROM ${table} WHERE entry_id=?`).bind(id));
  for(const row of snapshot.aliases)statements.push(db.prepare('INSERT INTO aliases(entry_id,name,alias_type,notes) VALUES(?,?,?,?)').bind(id,row.name,row.alias_type,row.notes));
  for(const genre of snapshot.genre_ids)statements.push(db.prepare('INSERT INTO entry_genres(entry_id,genre_id) VALUES(?,?)').bind(id,genre));
  snapshot.links.forEach((row,i)=>statements.push(db.prepare('INSERT INTO entry_links(entry_id,label,url,sort_order) VALUES(?,?,?,?)').bind(id,row.label,row.url,i)));
  snapshot.sources.map((row,i)=>({row,i})).sort((a,b)=>Number(!!b.row.id)-Number(!!a.row.id)).forEach(({row,i})=>statements.push(db.prepare('INSERT INTO entry_sources(id,entry_id,title,url,publisher,accessed_on,citation_notes,sort_order) VALUES(?,?,?,?,?,?,?,?)').bind(row.id??null,id,row.title,row.url,row.publisher,row.accessed_on,row.citation_notes,i)));
  // Reinsert retained IDs before allocating new IDs, including when reordered.
  for(const image of [...snapshot.images].sort((a,b)=>Number(!!b.id)-Number(!!a.id))){
    statements.push(db.prepare('INSERT INTO entry_images(id,entry_id,r2_key,alt_text,caption,credit,source_url,rights_notes,is_primary,sort_order) VALUES(?,?,?,?,?,?,?,?,?,?)').bind(image.id??null,id,image.r2_key,image.alt_text,image.caption,image.credit,image.source_url,image.rights_notes,image.is_primary,image.sort_order));
  }
  try { await db.batch(statements); }
  catch(error){if(/UNIQUE constraint failed/.test(error.message))fail('A conflicting save occurred. Reopen the entry and try again.',409);throw error;}
  return json(await detail(db,id));
}
