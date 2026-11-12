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
  wikiSqlite.exec(readFileSync(new URL('../wiki-migrations/0001_wiki.sql',import.meta.url),'utf8'));
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
    MEDIA:{async put(key,bytes){files.set(key,bytes);},async get(key){const bytes=files.get(key);return bytes?{body:bytes}:null;},async delete(key){files.delete(key);}},
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
