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
    db.prepare('SELECT title,url,publisher,citation_notes FROM entry_sources WHERE entry_id=? ORDER BY sort_order,id').bind(id),
    db.prepare('SELECT COALESCE(MAX(revision_number),0) AS revision FROM entry_revisions WHERE entry_id=?').bind(id),
  ]);
  return {...entry, aliases:results[0].results, genre_ids:results[1].results.map(row=>row.genre_id), links:results[2].results, sources:results[3].results, revision:results[4].results[0].revision};
}
export async function wiki(request, env, suffix, {body,json,admin}) {
  const db=env.WIKI_DB;
  if (!db) fail('Wiki storage is not configured.',503);
  if (suffix === 'genres' && request.method === 'GET') return json((await db.prepare('SELECT * FROM genres ORDER BY name').all()).results);
  if (suffix && !/^[1-9][0-9]*$/.test(suffix)) fail('Not found.',404);
  let id = suffix ? Number(suffix) : null;
  if (id !== null && !Number.isSafeInteger(id)) fail('Invalid entry ID.');
  if (request.method === 'GET') {
    if (id) return json(await detail(db,id));
    return json((await db.prepare('SELECT id,entry_type,name,slug,status,updated_at FROM entries ORDER BY updated_at DESC,id DESC LIMIT 500').all()).results);
  }
  if (!(request.method === 'POST' && !id) && !(request.method === 'PUT' && id)) fail('Method not allowed.',405);
  const data=await body(request);
  if (data.status !== undefined && data.status !== 'draft') fail('This editor saves drafts only.');
  const entry_type=text(data.entry_type,'entry type');
  if (!['artist','band','label'].includes(entry_type)) fail('Choose Artist, Band or Label.');
  const name=text(data.name,'name',200); if (!name) fail('Name is required.');
  const slug=text(data.slug,'slug',200); if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) fail('Use lowercase words separated by hyphens for the slug.');
  const snapshot={entry_type,name,slug,summary:text(data.summary,'introduction'),body_markdown:text(data.body_markdown,'biography',200000),location:text(data.location,'location',200)};
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
  snapshot.sources=list(data.sources,'sources').map(row=>{
    if (!row || typeof row!=='object') fail('Invalid source.');
    const title=text(row.title,'source title',500);if(!title)fail('Source title is required.');
    return {title,url:link(row.url,true),publisher:text(row.publisher ?? '','publisher',500),citation_notes:text(row.citation_notes ?? '','citation notes')};
  });
  let revision=0;
  if(id){
    const existing=await detail(db,id);
    if(existing.status!=='draft')fail('Only draft entries can be edited in this release.',409);
    if(existing.entry_type!==entry_type)fail('Entry type cannot be changed.');
    if(!Number.isSafeInteger(data.revision)||data.revision!==existing.revision)fail('This entry changed. Reopen it before saving.',409);
    revision=existing.revision;
  }
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
  // A unique revision number makes concurrent stale saves roll back atomically.
  statements.push(db.prepare('INSERT INTO entry_revisions(entry_id,revision_number,snapshot_json,editor_reference,change_note) VALUES(?,?,?,?,?)').bind(id,revision+1,JSON.stringify({...snapshot,status:'draft',snapshot_scope:'draft-editor-v1'}),String(admin.admin_id),'Saved draft'));
  for(const table of ['aliases','entry_genres','entry_links','entry_sources'])statements.push(db.prepare(`DELETE FROM ${table} WHERE entry_id=?`).bind(id));
  for(const row of snapshot.aliases)statements.push(db.prepare('INSERT INTO aliases(entry_id,name,alias_type,notes) VALUES(?,?,?,?)').bind(id,row.name,row.alias_type,row.notes));
  for(const genre of snapshot.genre_ids)statements.push(db.prepare('INSERT INTO entry_genres(entry_id,genre_id) VALUES(?,?)').bind(id,genre));
  snapshot.links.forEach((row,i)=>statements.push(db.prepare('INSERT INTO entry_links(entry_id,label,url,sort_order) VALUES(?,?,?,?)').bind(id,row.label,row.url,i)));
  snapshot.sources.forEach((row,i)=>statements.push(db.prepare('INSERT INTO entry_sources(entry_id,title,url,publisher,citation_notes,sort_order) VALUES(?,?,?,?,?,?)').bind(id,row.title,row.url,row.publisher,row.citation_notes,i)));
  try { await db.batch(statements); }
  catch(error){if(/UNIQUE constraint failed/.test(error.message))fail('A conflicting save occurred. Reopen the entry and try again.',409);throw error;}
  return json(await detail(db,id));
}
