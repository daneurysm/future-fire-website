import {test} from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../src/worker.mjs';
import {hashPassword,verifyPassword} from '../scripts/password.mjs';

function fixture() {
  const sqlite = new DatabaseSync(':memory:');
  for (const filename of ['0001_content.sql','0002_login_limits.sql']) sqlite.exec(readFileSync(new URL(`../migrations/${filename}`,import.meta.url),'utf8'));
  function statement(sql,values=[]) {
    return {
      bind(...parameters) { return statement(sql,parameters); },
      async first() { return sqlite.prepare(sql).get(...values) || null; },
      async all() { return {results:sqlite.prepare(sql).all(...values)}; },
      async run() { const result=sqlite.prepare(sql).run(...values); return {meta:{changes:result.changes}}; },
    };
  }
  const wikiSqlite = new DatabaseSync(':memory:');
  wikiSqlite.exec('PRAGMA foreign_keys=ON');
  for(const filename of ['0001_wiki.sql','0002_discography.sql','0003_label_enhancements.sql'])wikiSqlite.exec(readFileSync(new URL(`../wiki-migrations/${filename}`,import.meta.url),'utf8'));
  function wikiStatement(sql,values=[]) { return {
    bind(...args){return wikiStatement(sql,args);},
    async first(){return wikiSqlite.prepare(sql).get(...values)||null;},
    async all(){return {results:wikiSqlite.prepare(sql).all(...values)};},
    async run(){return wikiSqlite.prepare(sql).run(...values);}
  }; }
  const files = new Map();
  const env = {
    WIKI_DB:{prepare:wikiStatement,async batch(statements){wikiSqlite.exec('BEGIN');try{const results=[];for(const query of statements)results.push(await query.all());wikiSqlite.exec('COMMIT');return results;}catch(error){wikiSqlite.exec('ROLLBACK');throw error;}}},
    DB:{prepare:statement,async batch(statements){sqlite.exec('BEGIN');try{const result=[];for(const query of statements){try{result.push(await query.all());}catch{result.push(await query.run());}}sqlite.exec('COMMIT');return result;}catch(error){sqlite.exec('ROLLBACK');throw error;}}},
    MEDIA:{async head(key){return files.has(key)?{size:files.get(key).length}:null;},async put(key,bytes){files.set(key,bytes);},async get(key){const bytes=files.get(key);return bytes?{body:bytes,size:bytes.length}:null;},async delete(key){files.delete(key);}},
    ASSETS:{async fetch(){return new Response('<!doctype html><title>Control room</title>',{headers:{'Content-Type':'text/html'}});}},
  };
  async function request(path,options={}) {
    const {cookie,ip='192.0.2.1',origin='https://futurefire.club',...rest}=options;
    return worker.fetch(new Request(`https://futurefire.club${path}`,{...rest,headers:{Origin:origin,'CF-Connecting-IP':ip,...(cookie?{Cookie:cookie}:{}),...(typeof rest.body==='string'?{'Content-Type':'application/json'}:{}),...rest.headers}}),env);
  }
  async function admin() {
    const hash=await hashPassword('local-test-only-password');
    sqlite.prepare('INSERT INTO admin_users(id,username,password_hash) VALUES(1,?,?)').run('admin',hash);
    const response=await request('/api/login',{method:'POST',body:JSON.stringify({username:'admin',password:'local-test-only-password'})});
    assert.equal(response.status,200);
    const header=response.headers.get('Set-Cookie');assert.match(header,/Secure; HttpOnly; SameSite=Strict/);
    return header.split(';')[0];
  }
  return {sqlite,wikiSqlite,env,request,admin,files};
}

test('passwords use random salts and reject invalid credentials',async()=>{
  const first=await hashPassword('local-test-only-password');const second=await hashPassword('local-test-only-password');
  assert.notEqual(first,second);assert(await verifyPassword('local-test-only-password',first));
  assert.equal(await verifyPassword('wrong-password',first),false);assert.equal(await verifyPassword('anything','malformed'),false);
  await assert.rejects(()=>hashPassword('short'));
});
test('admin authentication, same-origin writes, throttling, session revocation',async()=>{
  const {request,admin,sqlite}=fixture();
  assert.equal((await request('/api/admin/articles')).status,401);
  assert.equal((await request('/api/login',{method:'POST',origin:'https://evil.example',body:'{}'})).status,403);
  const cookie=await admin();assert.equal((await request('/api/admin/session',{cookie})).status,200);
  const stored=sqlite.prepare('SELECT token_hash FROM admin_sessions').get();assert.notEqual(stored.token_hash,cookie.split('=')[1]);
  for(let attempt=0;attempt<5;attempt++)assert.equal((await request('/api/login',{method:'POST',ip:'192.0.2.2',body:JSON.stringify({username:'admin',password:'wrong'})})).status,401);
  assert.equal((await request('/api/login',{method:'POST',ip:'192.0.2.2',body:JSON.stringify({username:'admin',password:'wrong'})})).status,429);
  assert.equal((await request('/api/admin/logout',{cookie,method:'POST',body:'{}'})).status,200);
  assert.equal((await request('/api/admin/session',{cookie})).status,401);
});
test('draft, scheduled and published articles; review details; deletion',async()=>{
  const {request,admin}=fixture();const cookie=await admin();
  const create=async data=>{const response=await request('/api/admin/articles',{cookie,method:'POST',body:JSON.stringify(data)});assert.equal(response.status,200);return (await response.json()).id;};
  const id=await create({section:'news',title:'Draft',slug:'draft',body_markdown:'Private text',status:'draft'});
  await create({section:'news',title:'Scheduled',slug:'scheduled',status:'published',published_at:'2099-01-01T00:00:00Z'});
  assert.equal((await(await request('/api/content')).json()).articles.length,0);
  assert.equal((await request(`/api/admin/articles/${id}`,{cookie,method:'PUT',body:JSON.stringify({section:'news',title:'Published',status:'published'})})).status,200);
  assert.equal((await(await request('/api/content')).json()).articles[0].title,'Published');
  await create({section:'review',title:'Review',slug:'review',status:'published',artist:'Artist',release_title:'Record',rating:'8.5',listen_url:'https://example.com/music'});
  const review=(await(await request('/api/content')).json()).articles.find(article=>article.section==='review');assert.equal(review.rating,8.5);assert.equal(review.artist,'Artist');
  assert.equal((await request('/api/admin/articles',{cookie,method:'POST',body:JSON.stringify({section:'wiki',slug:'wiki',title:'No wiki'})})).status,400);
  assert.equal((await request('/api/admin/socials',{cookie,method:'POST',body:JSON.stringify({name:'Bad',url:'javascript:alert(1)'})})).status,400);
  await request(`/api/admin/articles/${id}`,{cookie,method:'DELETE'});
  assert.equal((await(await request('/api/content')).json()).articles.some(article=>article.id===id),false);
});
test('uploads validate signatures and drafts cannot expose private images',async()=>{
  const {request,admin,files}=fixture();const cookie=await admin();
  assert.equal((await request('/api/admin/media',{cookie,method:'POST',body:'<svg>unsafe</svg>'})).status,400);
  const bytes=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
  const uploaded=await request('/api/admin/media',{cookie,method:'POST',body:bytes,headers:{'X-Filename':'cover.png'}});assert.equal(uploaded.status,200);
  const {id}=await uploaded.json();assert.equal(files.size,1);
  assert.equal((await request(`/media/${id}`)).status,404);assert.equal((await request(`/media/${id}`,{cookie})).status,200);
  const response=await request('/api/admin/articles',{cookie,method:'POST',body:JSON.stringify({section:'news',slug:'cover',title:'Cover',status:'published',cover_media_id:id})});assert.equal(response.status,200);
  assert.equal((await request(`/media/${id}`)).status,200);
});
test('password changes invalidate every session and old password',async()=>{
  const {request,admin,sqlite}=fixture();const cookie=await admin();
  const response=await request('/api/admin/password',{cookie,method:'POST',body:JSON.stringify({current_password:'local-test-only-password',new_password:'replacement-test-password'})});assert.equal(response.status,200);
  assert.equal((await request('/api/admin/session',{cookie})).status,401);
  const {password_hash:hash}=sqlite.prepare('SELECT password_hash FROM admin_users').get();assert(await verifyPassword('replacement-test-password',hash));assert.equal(await verifyPassword('local-test-only-password',hash),false);
});

const wikiDraft = () => ({entry_type:'artist',name:'Test Artist',slug:'test-artist',summary:'Introduction',body_markdown:'Private biography',location:'Seattle',aliases:[{name:'Former Name',alias_type:'former',notes:''}],genre_ids:[1,2],links:[{label:'Official',url:'https://example.com'}],sources:[{title:'Interview',url:'https://example.com/interview',publisher:'Test',citation_notes:'Background'}]});
test('wiki drafts reuse authentication, remain private, and save all fields with revisions',async()=>{
  const {request,admin,wikiSqlite,sqlite}=fixture();
  assert.equal((await request('/api/admin/wiki')).status,401);
  assert.equal((await request('/api/admin/wiki/genres')).status,401);
  const cookie=await admin();
  assert.equal((await request('/api/admin/wiki',{cookie,method:'POST',origin:'https://evil.example',body:JSON.stringify(wikiDraft())})).status,403);
  const response=await request('/api/admin/wiki',{cookie,method:'POST',body:JSON.stringify(wikiDraft())});assert.equal(response.status,200);
  const entry=await response.json();assert.equal(entry.revision,1);assert.equal(entry.status,'draft');assert.equal(entry.aliases[0].name,'Former Name');assert.equal(entry.sources[0].title,'Interview');assert.deepEqual(entry.genre_ids,[1,2]);
  assert.equal((await request('/api/admin/wiki/'+entry.id)).status,401);
  assert.equal((await(await request('/api/content')).json()).articles.length,0);
  assert.equal(sqlite.prepare("SELECT count(*) AS n FROM sqlite_schema WHERE name='entries'").get().n,0);
  const update={...entry,name:'Updated Artist',aliases:[],links:[],sources:[],genre_ids:[3]};
  const saved=await request('/api/admin/wiki/'+entry.id,{cookie,method:'PUT',body:JSON.stringify(update)});assert.equal(saved.status,200);assert.equal((await saved.json()).revision,2);
  const reopened=await(await request('/api/admin/wiki/'+entry.id,{cookie})).json();assert.equal(reopened.name,'Updated Artist');assert.deepEqual(reopened.aliases,[]);assert.deepEqual(reopened.genre_ids,[3]);
  assert.equal(wikiSqlite.prepare('SELECT count(*) AS n FROM entry_revisions').get().n,2);
  assert.equal((await request('/api/admin/wiki/'+entry.id,{cookie,method:'PUT',body:JSON.stringify(update)})).status,409);
  assert.equal(wikiSqlite.prepare('SELECT count(*) AS n FROM entry_revisions').get().n,2);
});
test('wiki validation rejects unsafe links, duplicate slugs, publishing and malformed fields',async()=>{
  const {request,admin,wikiSqlite}=fixture();const cookie=await admin();
  for(const changes of [{status:'published'},{genre_ids:[999]},{aliases:[null]},{links:[{label:'Unsafe',url:'javascript:alert(1)'}]},{slug:'../bad'},{entry_type:'venue'}]){
    const response=await request('/api/admin/wiki',{cookie,method:'POST',body:JSON.stringify({...wikiDraft(),...changes})});assert.equal(response.status,400);
  }
  assert.equal(wikiSqlite.prepare('SELECT count(*) AS n FROM entries').get().n,0);
  for(const type of ['artist','band','label']){
    const response=await request('/api/admin/wiki',{cookie,method:'POST',body:JSON.stringify({...wikiDraft(),entry_type:type,slug:type})});assert.equal(response.status,200);
  }
  assert.equal((await request('/api/admin/wiki',{cookie,method:'POST',body:JSON.stringify({...wikiDraft(),slug:'artist'})})).status,409);
  assert.equal((await request('/api/admin/wiki/123',{cookie,method:'DELETE'})).status,405);
  assert.deepEqual(wikiSqlite.prepare('PRAGMA foreign_key_check').all(),[]);
});
test('wiki save rolls back parent and child changes if revision insert fails',async()=>{
  const {request,admin,wikiSqlite}=fixture();const cookie=await admin();
  const entry=await(await request('/api/admin/wiki',{cookie,method:'POST',body:JSON.stringify(wikiDraft())})).json();
  wikiSqlite.exec("CREATE TRIGGER reject_revision BEFORE INSERT ON entry_revisions BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  const response=await request('/api/admin/wiki/'+entry.id,{cookie,method:'PUT',body:JSON.stringify({...entry,name:'Must roll back',aliases:[]})});assert.equal(response.status,500);
  assert.equal(wikiSqlite.prepare('SELECT name FROM entries').get().name,'Test Artist');
  assert.equal(wikiSqlite.prepare('SELECT count(*) AS n FROM aliases').get().n,1);
});

test('wiki overview is private, read-only, and returns an empty dashboard',async()=>{
  const {request,admin,env}=fixture();
  assert.equal((await request('/api/admin/wiki/overview')).status,401);
  const cookie=await admin();
  const response=await request('/api/admin/wiki/overview',{cookie});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Cache-Control'),'no-store');
  assert.deepEqual(await response.json(),{counts:{total:0,by_status:{draft:0,published:0,archived:0},by_type:{artist:0,band:0,label:0}},recent_changes:[],recent_drafts:[]});
  for(const method of ['POST','PUT','DELETE'])assert.equal((await request('/api/admin/wiki/overview',{cookie,method,body:'{}'})).status,405);
  delete env.WIKI_DB;
  assert.equal((await request('/api/admin/wiki/overview',{cookie})).status,503);
});

test('wiki overview counts beyond the directory limit and orders bounded activity across timestamp formats',async()=>{
  const {request,admin,wikiSqlite}=fixture();const cookie=await admin();
  const insert=wikiSqlite.prepare('INSERT INTO entries(id,entry_type,name,slug,status,published_at,updated_at) VALUES(?,?,?,?,?,?,?)');
  for(let id=1;id<=501;id++)insert.run(id,'artist','Artist '+id,'artist-'+id,'draft',null,'2026-11-13 10:00:00');
  insert.run(502,'band','Published band','published-band','published','2026-11-13 09:00:00','2026-11-13 09:00:00');
  insert.run(503,'label','Archived label','archived-label','archived',null,'2026-11-13 09:00:00');
  wikiSqlite.prepare('UPDATE entries SET updated_at=? WHERE id=1').run('2026-11-13T09:00:00.000Z');
  const revision=wikiSqlite.prepare("INSERT INTO entry_revisions(entry_id,revision_number,snapshot_json,change_note,created_at) VALUES(?,1,'{}','Saved draft',?)");
  for(let id=1;id<=12;id++)revision.run(id,id===1?'2026-11-13T09:00:00.000Z':'2026-11-13 10:00:00');
  const overview=await(await request('/api/admin/wiki/overview',{cookie})).json();
  assert.deepEqual(overview.counts,{total:503,by_status:{draft:501,published:1,archived:1},by_type:{artist:501,band:1,label:1}});
  assert.deepEqual(overview.recent_drafts.map(row=>row.id),[501,500,499,498,497]);
  assert.deepEqual(overview.recent_changes.map(row=>row.entry_id),[12,11,10,9,8,7,6,5,4,3]);
  assert.equal(overview.recent_changes[0].name,'Artist 12');
  assert.equal(wikiSqlite.prepare('SELECT count(*) AS n FROM entries').get().n,503);
});


test('artist years round trip, preserve omitted values, clear explicitly, and appear in revisions',async()=>{
  const {request,admin,wikiSqlite}=fixture();const cookie=await admin();
  const create=await request('/api/admin/wiki',{cookie,method:'POST',body:JSON.stringify({...wikiDraft(),active_from_year:1998,active_to_year:2020})});
  assert.equal(create.status,200);let entry=await create.json();
  assert.equal(entry.active_from_year,1998);assert.equal(entry.active_to_year,2020);
  const save=async data=>{const response=await request('/api/admin/wiki/'+entry.id,{cookie,method:'PUT',body:JSON.stringify(data)});assert.equal(response.status,200);return response.json();};
  const omitted={...entry,name:'Renamed'};delete omitted.active_from_year;delete omitted.active_to_year;
  entry=await save(omitted);assert.equal(entry.active_from_year,1998);assert.equal(entry.active_to_year,2020);
  const snapshot=JSON.parse(wikiSqlite.prepare('SELECT snapshot_json FROM entry_revisions WHERE entry_id=? AND revision_number=2').get(entry.id).snapshot_json);
  assert.equal(snapshot.active_from_year,1998);assert.equal(snapshot.active_to_year,2020);assert.equal(snapshot.snapshot_scope,'draft-editor-v3');
  entry=await save({...entry,active_from_year:null,active_to_year:null});
  const reopened=await(await request('/api/admin/wiki/'+entry.id,{cookie})).json();
  assert.equal(reopened.active_from_year,null);assert.equal(reopened.active_to_year,null);
});

test('artist year validation and failed saves leave artist details unchanged',async()=>{
  const {request,admin,wikiSqlite}=fixture();const cookie=await admin();
  for(const years of [{active_from_year:999},{active_to_year:10000},{active_from_year:'2000'},{active_from_year:2000.5},{active_from_year:2020,active_to_year:2010},{entry_type:'band',active_from_year:2000}]){
    assert.equal((await request('/api/admin/wiki',{cookie,method:'POST',body:JSON.stringify({...wikiDraft(),...years})})).status,400);
  }
  const entry=await(await request('/api/admin/wiki',{cookie,method:'POST',body:JSON.stringify({...wikiDraft(),active_from_year:2000})})).json();
  assert.equal((await request('/api/admin/wiki/'+entry.id,{cookie,method:'PUT',body:JSON.stringify({...entry,revision:0,active_from_year:2001})})).status,409);
  wikiSqlite.exec("CREATE TRIGGER reject_artist_revision BEFORE INSERT ON entry_revisions BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  assert.equal((await request('/api/admin/wiki/'+entry.id,{cookie,method:'PUT',body:JSON.stringify({...entry,active_from_year:2002,name:'Must roll back'})})).status,500);
  assert.equal(wikiSqlite.prepare('SELECT active_from_year FROM artist_details WHERE entry_id=?').get(entry.id).active_from_year,2000);
  assert.equal(wikiSqlite.prepare('SELECT name FROM entries WHERE id=?').get(entry.id).name,entry.name);
});

test('source dates survive editing, reordering and legacy payloads, and may be explicitly cleared',async()=>{
  const {request,admin,wikiSqlite}=fixture();const cookie=await admin();
  let entry=await(await request('/api/admin/wiki',{cookie,method:'POST',body:JSON.stringify({...wikiDraft(),sources:[{...wikiDraft().sources[0],accessed_on:'2024-02-29'}]})})).json();
  const sourceId=entry.sources[0].id;
  const save=async sources=>{const response=await request('/api/admin/wiki/'+entry.id,{cookie,method:'PUT',body:JSON.stringify({...entry,sources})});assert.equal(response.status,200);entry=await response.json();};
  const edited={...entry.sources[0],title:'Edited interview'};delete edited.accessed_on;
  await save([{title:'New source',url:null,publisher:'',citation_notes:'',accessed_on:null},edited]);
  assert.equal(entry.sources[1].id,sourceId);assert.equal(entry.sources[1].accessed_on,'2024-02-29');
  const legacy={...entry.sources[1]};delete legacy.id;delete legacy.accessed_on;
  await save([legacy]);assert.equal(entry.sources[0].accessed_on,'2024-02-29');
  const snapshot=JSON.parse(wikiSqlite.prepare('SELECT snapshot_json FROM entry_revisions WHERE entry_id=? AND revision_number=?').get(entry.id,entry.revision).snapshot_json);
  assert.equal(snapshot.sources[0].accessed_on,'2024-02-29');
  await save([{...entry.sources[0],accessed_on:null}]);assert.equal(entry.sources[0].accessed_on,null);
});

test('source validation rejects invalid dates, foreign IDs, and ambiguous legacy edits without data loss',async()=>{
  const {request,admin,wikiSqlite}=fixture();const cookie=await admin();
  const entry=await(await request('/api/admin/wiki',{cookie,method:'POST',body:JSON.stringify({...wikiDraft(),sources:[{...wikiDraft().sources[0],accessed_on:'2024-02-29'}]})})).json();
  const save=source=>request('/api/admin/wiki/'+entry.id,{cookie,method:'PUT',body:JSON.stringify({...entry,sources:[source]})});
  for(const accessed_on of ['2023-02-29','2024-13-01','invalid',123])assert.equal((await save({...entry.sources[0],accessed_on})).status,400);
  assert.equal((await save({...entry.sources[0],id:999})).status,400);
  const legacy={...entry.sources[0],title:'Unidentifiable edit'};delete legacy.id;delete legacy.accessed_on;
  assert.equal((await save(legacy)).status,409);
  assert.equal(wikiSqlite.prepare('SELECT accessed_on FROM entry_sources WHERE entry_id=?').get(entry.id).accessed_on,'2024-02-29');
  assert.equal(wikiSqlite.prepare('SELECT count(*) AS n FROM entry_revisions').get().n,1);
});

test('wiki directory searches all entries, filters types and paginates deterministically',async()=>{
  const {request,admin,wikiSqlite}=fixture();const cookie=await admin();
  const insert=wikiSqlite.prepare("INSERT INTO entries(id,entry_type,name,slug,updated_at) VALUES(?,?,?,?, '2026-11-13 10:00:00')");
  for(let id=1;id<=530;id++)insert.run(id,'artist',id===1?'Oldest special artist':'Artist '+id,'artist-'+id);
  insert.run(531,'band','Special band','special-band');insert.run(532,'label','100% label','literal-percent');
  const get=async query=>{const response=await request('/api/admin/wiki?'+query,{cookie});assert.equal(response.status,200);return response.json();};
  const page1=await get('type=artist'),page2=await get('type=artist&page=2');
  assert.equal(page1.total,530);assert.equal(page1.items.length,25);assert.equal(page1.pages,22);
  assert.equal(page1.items[0].id,530);assert.equal(page2.items[0].id,505);
  assert.equal(new Set([...page1.items,...page2.items].map(row=>row.id)).size,50);
  assert.deepEqual((await get('type=artist&q=SPECIAL')).items.map(row=>row.id),[1]);
  assert.deepEqual((await get('q=special-band')).items.map(row=>row.id),[531]);
  assert.deepEqual((await get('q=%25')).items.map(row=>row.id),[532]);
  const empty=await get('q=not-found');assert.equal(empty.total,0);assert.equal(empty.page,1);assert.deepEqual(empty.items,[]);
  assert.equal((await get('type=artist&page=999')).page,22);
  for(const query of ['page=0','page=-1','page=1.5','page=NaN','page=99999999999999999','type=venue','q='+ 'a'.repeat(201)])assert.equal((await request('/api/admin/wiki?'+query,{cookie})).status,400);
  assert.equal((await request('/api/admin/wiki?type=artist&page=2')).status,401);
});


const testPng=new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0]);
async function uploadWikiImage(request,cookie){
  const response=await request('/api/admin/media',{cookie,method:'POST',body:testPng,headers:{'X-Filename':'artist.png'}});
  assert.equal(response.status,200);return response.json();
}
test('wiki images round trip with metadata, ordering, primary selection and revision snapshots',async()=>{
  const {request,admin,wikiSqlite,files}=fixture();const cookie=await admin();
  const first=await uploadWikiImage(request,cookie),second=await uploadWikiImage(request,cookie);
  const image={media_id:first.id,alt_text:'Artist portrait',caption:'On stage',credit:'Photographer',source_url:'https://example.com/photo',rights_notes:'Permission granted',is_primary:1};
  let response=await request('/api/admin/wiki',{cookie,method:'POST',body:JSON.stringify({...wikiDraft(),images:[image,{media_id:second.id}]})});
  assert.equal(response.status,200);let entry=await response.json();
  assert.equal(entry.images.length,2);assert.equal(entry.images[0].credit,'Photographer');assert.equal(entry.images[0].is_primary,1);
  const firstId=entry.images[0].id,secondId=entry.images[1].id;
  response=await request('/api/admin/wiki/'+entry.id,{cookie,method:'PUT',body:JSON.stringify({...entry,images:[{id:secondId,is_primary:1},{id:firstId,is_primary:0,caption:'Updated caption'}]})});
  assert.equal(response.status,200);entry=await response.json();
  assert.deepEqual(entry.images.map(image=>image.id),[secondId,firstId]);assert.equal(entry.images[0].is_primary,1);
  assert.equal(entry.images[1].caption,'Updated caption');assert.equal(entry.images[1].rights_notes,'Permission granted');
  const snapshot=JSON.parse(wikiSqlite.prepare('SELECT snapshot_json FROM entry_revisions WHERE entry_id=? AND revision_number=2').get(entry.id).snapshot_json);
  assert.equal(snapshot.images[0].r2_key,entry.images[0].r2_key);assert.equal(snapshot.images[1].caption,'Updated caption');
  const legacy={...entry};delete legacy.images;
  response=await request('/api/admin/wiki/'+entry.id,{cookie,method:'PUT',body:JSON.stringify(legacy)});assert.equal(response.status,200);entry=await response.json();assert.equal(entry.images.length,2);
  response=await request('/api/admin/wiki/'+entry.id,{cookie,method:'PUT',body:JSON.stringify({...entry,images:[]})});assert.equal(response.status,200);assert.equal((await response.json()).images.length,0);
  assert.equal(files.size,2);assert.equal((await request('/media/'+first.id,{cookie})).status,200);
  assert.equal((await request('/api/admin/wiki-images/'+firstId,{cookie})).status,404);
});

test('wiki image bytes stay private, including published entries, with GET and HEAD protection',async()=>{
  const {request,admin,wikiSqlite}=fixture();const cookie=await admin();
  const uploaded=await uploadWikiImage(request,cookie);
  const entry=await(await request('/api/admin/wiki',{cookie,method:'POST',body:JSON.stringify({...wikiDraft(),images:[{media_id:uploaded.id,is_primary:1}]})})).json();
  const path=entry.images[0].url;
  for(const method of ['GET','HEAD']){
    assert.equal((await request(path,{method})).status,401);
    assert.equal((await request('/media/'+uploaded.id,{method})).status,404);
    const response=await request(path,{cookie,method});assert.equal(response.status,200);assert.equal(response.headers.get('Content-Type'),'image/png');assert.equal(response.headers.get('Cache-Control'),'no-store');assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
    assert.equal((await response.arrayBuffer()).byteLength,method==='HEAD'?0:testPng.length);
  }
  wikiSqlite.prepare("UPDATE entries SET status='published',published_at='2020-01-01' WHERE id=?").run(entry.id);
  assert.equal((await request(path)).status,401);assert.equal((await request('/media/'+uploaded.id)).status,404);
  assert.equal((await request(path,{cookie,method:'POST',body:'{}'})).status,405);
  assert.equal((await request(path+'/extra',{cookie})).status,404);
});

test('wiki images reject unsafe references, duplicates, multiple primary images and missing files',async()=>{
  const {request,admin,wikiSqlite,files}=fixture();const cookie=await admin();
  const first=await uploadWikiImage(request,cookie),second=await uploadWikiImage(request,cookie);
  const cases=[[{r2_key:'secret-object'}],[{media_id:'missing'}],[{id:999}],[{media_id:first.id},{media_id:first.id}],[{media_id:first.id,is_primary:1},{media_id:second.id,is_primary:1}],[{media_id:first.id,is_primary:true}],[{media_id:first.id,source_url:'javascript:alert(1)'}],[{media_id:first.id,credit:'x'.repeat(1001)}]];
  for(const images of cases)assert.equal((await request('/api/admin/wiki',{cookie,method:'POST',body:JSON.stringify({...wikiDraft(),images})})).status,400);
  assert.equal(wikiSqlite.prepare('SELECT count(*) AS n FROM entries').get().n,0);
  files.clear();assert.equal((await request('/api/admin/wiki',{cookie,method:'POST',body:JSON.stringify({...wikiDraft(),images:[{media_id:first.id}]})})).status,409);
  assert.equal((await request('/api/admin/media',{method:'POST',body:testPng})).status,401);
  assert.equal((await request('/api/admin/media',{cookie,method:'POST',origin:'https://evil.example',body:testPng})).status,403);
  assert.equal((await request('/api/admin/media',{cookie,method:'POST',body:testPng,headers:{'Content-Length':'10485761'}})).status,413);
});

test('wiki image changes roll back on failure and stale saves cannot replace attachments',async()=>{
  const {request,admin,wikiSqlite,files}=fixture();const cookie=await admin();
  const uploaded=await uploadWikiImage(request,cookie);
  const entry=await(await request('/api/admin/wiki',{cookie,method:'POST',body:JSON.stringify({...wikiDraft(),images:[{media_id:uploaded.id,caption:'Keep this',is_primary:1}]})})).json();
  assert.equal((await request('/api/admin/wiki/'+entry.id,{cookie,method:'PUT',body:JSON.stringify({...entry,revision:0,images:[]})})).status,409);
  wikiSqlite.exec("CREATE TRIGGER reject_image BEFORE INSERT ON entry_images BEGIN SELECT RAISE(ABORT,'test failure'); END;");
  const response=await request('/api/admin/wiki/'+entry.id,{cookie,method:'PUT',body:JSON.stringify({...entry,name:'Must roll back',images:[{id:entry.images[0].id,caption:'Changed'}]})});assert.equal(response.status,500);
  const reopened=await(await request('/api/admin/wiki/'+entry.id,{cookie})).json();assert.equal(reopened.name,entry.name);assert.equal(reopened.revision,1);assert.equal(reopened.images[0].caption,'Keep this');assert.equal(files.size,1);
});

test('shared public library images retain existing visibility without exposing private wiki metadata',async()=>{
  const {request,admin}=fixture();const cookie=await admin();const uploaded=await uploadWikiImage(request,cookie);
  const article=await request('/api/admin/articles',{cookie,method:'POST',body:JSON.stringify({section:'news',slug:'shared',title:'Shared image',status:'published',cover_media_id:uploaded.id})});assert.equal(article.status,200);
  const entry=await(await request('/api/admin/wiki',{cookie,method:'POST',body:JSON.stringify({...wikiDraft(),images:[{media_id:uploaded.id,caption:'Private wiki caption'}]})})).json();
  assert.equal((await request('/media/'+uploaded.id)).status,200);
  assert.equal((await request(entry.images[0].url)).status,401);
  assert.equal(JSON.stringify(await(await request('/api/content')).json()).includes('Private wiki caption'),false);
});
