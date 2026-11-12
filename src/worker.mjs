import { wiki } from './wiki.mjs';
import { verifyPassword, hashPassword } from '../scripts/password.mjs';

const cookieName = '__Host-ff-session';
const security = {
  'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin', 'Cache-Control': 'no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
};
const resources = {
  articles: { table: 'articles', key: 'id', fields: ['section','slug','title','summary','body_markdown','cover_media_id','status','published_at'], required: ['title','slug','section'], enums: { section: ['news','review','weekly_report'], status: ['draft','published','archived'] } },
  tours: { table: 'tour_dates', key: 'id', fields: ['artist','venue','city','region','country','starts_at','ends_at','timezone','ticket_url','body_markdown','image_media_id','status'], required: ['artist','starts_at'], enums: { status: ['draft','published','cancelled','archived'] } },
  sections: { table: 'site_sections', key: 'section', fields: ['eyebrow','heading','description','image_media_id'] },
  socials: { table: 'social_links', key: 'id', fields: ['name','handle','url','sort_order','enabled'], required: ['name','url'] },
  livestream: { table: 'livestream_settings', key: 'id', fields: ['title','description','stream_url','schedule_text','timezone','station_name','station_frequency','station_location','is_live','image_media_id'] },
};
function json(value, status = 200, headers = {}) { return Response.json(value, { status, headers: { ...security, ...headers } }); }
function fail(message, status = 400) { throw Object.assign(new Error(message), { status }); }
async function digest(value) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))), byte => byte.toString(16).padStart(2,'0')).join(''); }
function sessionToken(request) { return request.headers.get('Cookie')?.split(';').map(value => value.trim()).find(value => value.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1) || ''; }
async function session(request, env) {
  const token = sessionToken(request);
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return env.DB.prepare('SELECT admin_id FROM admin_sessions WHERE token_hash = ? AND expires_at > unixepoch()').bind(await digest(token)).first();
}
async function body(request) {
  if (!(request.headers.get('Content-Type') || '').startsWith('application/json')) fail('JSON required.',415);
  const raw = await limitedBytes(request, 262144);
  try { const data = JSON.parse(new TextDecoder().decode(raw)); if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Invalid form.'); return data; } catch { fail('Invalid form.'); }
}
async function limitedBytes(request, limit) {
  if (Number(request.headers.get('Content-Length')) > limit) fail('File or form is too large.',413);
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks = []; let size = 0;
  while (true) { const {done,value} = await reader.read(); if (done) break; size += value.length; if (size > limit) { await reader.cancel(); fail('File or form is too large.',413); } chunks.push(value); }
  const result = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { result.set(chunk,offset); offset += chunk.length; }
  return result;
}
async function login(request, env) {
  const data = await body(request);
  if (typeof data.username !== 'string' || typeof data.password !== 'string' || data.username.length > 64 || data.password.length > 128) fail('Invalid login.',401);
  const key = await digest(request.headers.get('CF-Connecting-IP') || 'local');
  const limit = await env.DB.prepare('INSERT INTO login_limits(key, attempts, reset_at) VALUES (?,1,unixepoch()+900) ON CONFLICT(key) DO UPDATE SET attempts = CASE WHEN reset_at <= unixepoch() THEN 1 ELSE attempts+1 END, reset_at = CASE WHEN reset_at <= unixepoch() THEN unixepoch()+900 ELSE reset_at END RETURNING attempts').bind(key).first();
  if (limit.attempts > 5) fail('Too many login attempts. Try again in 15 minutes.',429);
  const admin = await env.DB.prepare('SELECT id, username, password_hash FROM admin_users WHERE id=1').first();
  const valid = admin && await verifyPassword(data.password, admin.password_hash);
  if (!valid || admin.username.toLowerCase() !== data.username.toLowerCase()) fail('Username or password is incorrect.',401);
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2,'0')).join('');
  await env.DB.batch([
    env.DB.prepare('DELETE FROM admin_sessions WHERE expires_at <= unixepoch()'),
    env.DB.prepare('DELETE FROM login_limits WHERE reset_at <= unixepoch()'),
    env.DB.prepare('INSERT INTO admin_sessions(token_hash,admin_id,expires_at) VALUES (?,1,unixepoch()+28800)').bind(await digest(token)),
  ]);
  return json({ok:true},200,{'Set-Cookie':`${cookieName}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=28800`});
}
function validate(data, spec) {
  const values = {};
  for (const field of spec.fields) {
    if (!(field in data)) continue;
    const value = data[field];
    if (['is_live','enabled'].includes(field)) { if (![0,1].includes(value)) fail(`Invalid ${field}.`); }
    else if (field === 'sort_order') { if (!Number.isSafeInteger(value) || Math.abs(value)>10000) fail('Invalid sort order.'); }
    else if (value !== null && typeof value !== 'string') fail(`Invalid ${field}.`);
    if (typeof value === 'string' && value.length > (field === 'body_markdown' ? 200000 : 5000)) fail(`${field} is too long.`);
    if (spec.required?.includes(field) && (typeof value !== 'string' || !value.trim())) fail(`${field} is required.`);
    if (spec.enums?.[field] && !spec.enums[field].includes(value)) fail(`Invalid ${field}.`);
    if (field.endsWith('_url') || field === 'url') { if (value) { try { const url = new URL(value); if (url.protocol !== 'https:' || url.username || url.password) fail('Use an HTTPS link.'); } catch { fail('Use a valid HTTPS link.'); } } }
    if (['starts_at','ends_at','published_at'].includes(field) && value && !Number.isFinite(Date.parse(value))) fail('Use a valid date.');
    if (field === 'timezone' && value) { try { new Intl.DateTimeFormat('en', {timeZone:value}); } catch { fail('Invalid timezone.'); } }
    if (field === 'slug' && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) fail('Slug must use lowercase letters, numbers, and hyphens.');
    values[field] = (field.endsWith('_media_id') || ['ends_at','published_at'].includes(field)) && !value ? null : ['starts_at','ends_at','published_at'].includes(field) && value ? new Date(value).toISOString() : value;
  }
  return values;
}
async function resource(request, env, name, id) {
  const spec = resources[name]; if (!spec) fail('Not found.',404);
  if (request.method === 'GET') {
    const result = await env.DB.prepare(name === 'articles' ? 'SELECT articles.*, review_details.artist, review_details.release_title, review_details.label, review_details.release_date, review_details.rating, review_details.listen_url FROM articles LEFT JOIN review_details ON articles.id=review_details.article_id ORDER BY articles.updated_at DESC LIMIT 500' : `SELECT * FROM ${spec.table} ORDER BY ${spec.key} LIMIT 500`).all();
    return json(result.results);
  }
  if (!['POST','PUT','DELETE'].includes(request.method)) fail('Method not allowed.',405);
  if (request.method === 'DELETE') {
    if (['sections','livestream'].includes(name)) fail('This setting cannot be deleted.');
    await env.DB.prepare(`DELETE FROM ${spec.table} WHERE ${spec.key}=?`).bind(id).run(); return json({ok:true});
  }
  const data = await body(request); const values = validate(data,spec);
  if (name === 'articles' && values.status === 'published' && !values.published_at) values.published_at = new Date().toISOString();
  const fields = Object.keys(values); if (!fields.length) fail('No changes supplied.');
  const statements = [];
  if (request.method === 'POST') {
    if (['sections','livestream'].includes(name)) fail('Edit the existing setting.');
    for (const required of spec.required || []) if (!values[required]) fail(`${required} is required.`);
    id = crypto.randomUUID();
    statements.push(env.DB.prepare(`INSERT INTO ${spec.table} (${spec.key},${fields.join(',')}) VALUES (?,${fields.map(()=>'?').join(',')})`).bind(id,...Object.values(values)));
  } else {
    if (!await env.DB.prepare(`SELECT ${spec.key} FROM ${spec.table} WHERE ${spec.key}=?`).bind(id).first()) fail('Item no longer exists.',404);
    statements.push(env.DB.prepare(`UPDATE ${spec.table} SET ${fields.map(field=>`${field}=?`).join(',')},updated_at=? WHERE ${spec.key}=?`).bind(...Object.values(values),new Date().toISOString(),id));
  }
  if (name === 'articles' && values.section === 'review') {
    const review = validate(data,{fields:['artist','release_title','label','release_date','listen_url']});
    const rating = data.rating === '' || data.rating === null || data.rating === undefined ? null : Number(data.rating);
    if (rating !== null && (!Number.isFinite(rating) || rating<0 || rating>10)) fail('Rating must be between 0 and 10.');
    if (review.release_date && !Number.isFinite(Date.parse(review.release_date))) fail('Invalid release date.');
    statements.push(env.DB.prepare('INSERT INTO review_details(article_id,artist,release_title,label,release_date,rating,listen_url) VALUES (?,?,?,?,?,?,?) ON CONFLICT(article_id) DO UPDATE SET artist=excluded.artist,release_title=excluded.release_title,label=excluded.label,release_date=excluded.release_date,rating=excluded.rating,listen_url=excluded.listen_url').bind(id,review.artist||'',review.release_title||'',review.label||'',review.release_date||null,rating,review.listen_url||''));
  }
  await env.DB.batch(statements);
  return json({ok:true,id});
}
function imageType(bytes) {
  if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'image/jpeg';
  if ([137,80,78,71,13,10,26,10].every((value,index)=>bytes[index]===value)) return 'image/png';
  const start = new TextDecoder().decode(bytes.slice(0,12));
  if (start.startsWith('GIF87a') || start.startsWith('GIF89a')) return 'image/gif';
  if (start.startsWith('RIFF') && start.slice(8)==='WEBP') return 'image/webp';
  fail('Upload a JPEG, PNG, GIF, or WebP image.');
}
async function upload(request,env) {
  const bytes = await limitedBytes(request,10485760); const type = imageType(bytes);
  const id = crypto.randomUUID(); const key = `images/${id}`;
  await env.MEDIA.put(key,bytes,{httpMetadata:{contentType:type}});
  try { await env.DB.prepare('INSERT INTO media(id,object_key,original_filename,content_type,byte_size) VALUES (?,?,?,?,?)').bind(id,key,(request.headers.get('X-Filename') || 'image').slice(0,200),type,bytes.length).run(); }
  catch (error) { await env.MEDIA.delete(key); throw error; }
  return json({id,url:`/media/${id}`});
}
async function publicContent(env) {
  const results = await env.DB.batch([
    env.DB.prepare("SELECT articles.*, media.alt_text AS cover_alt, media.credit AS cover_credit, review_details.artist, review_details.release_title, review_details.label, review_details.rating, review_details.listen_url FROM articles LEFT JOIN media ON media.id=articles.cover_media_id LEFT JOIN review_details ON articles.id=review_details.article_id WHERE status='published' AND julianday(published_at)<=julianday('now') ORDER BY published_at DESC LIMIT 100"),
    env.DB.prepare("SELECT * FROM tour_dates WHERE status='published' ORDER BY starts_at LIMIT 100"),
    env.DB.prepare('SELECT * FROM social_links WHERE enabled=1 ORDER BY sort_order'),
    env.DB.prepare('SELECT * FROM site_sections'),
    env.DB.prepare('SELECT * FROM livestream_settings WHERE id=1'),
  ]);
  return json({articles:results[0].results,tours:results[1].results,socials:results[2].results,sections:results[3].results,livestream:results[4].results[0]});
}
export default {
  async fetch(request,env) {
    try {
      const url = new URL(request.url); const path = url.pathname;
      if (path.startsWith('/api/') && !['GET','HEAD'].includes(request.method)) {
        if (request.headers.get('Origin') !== url.origin) fail('Request origin rejected.',403);
      }
      if (path === '/api/content' && request.method === 'GET') return await publicContent(env);
      if (path === '/api/login' && request.method === 'POST') return await login(request,env);
      if (path.startsWith('/api/admin/')) {
        const admin = await session(request,env);
        if (!admin) fail('Please sign in.',401);
        const [, , , name, id] = path.split('/');
        if (name === 'wiki') {
          if (path.split('/').length > 5) fail('Not found.',404);
          return await wiki(request,env,id || '',{body,json,admin});
        }
        if (name === 'session') return json({ok:true});
        if (name === 'logout' && request.method === 'POST') { await env.DB.prepare('DELETE FROM admin_sessions WHERE token_hash=?').bind(await digest(sessionToken(request))).run(); return json({ok:true},200,{'Set-Cookie':`${cookieName}=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0`}); }
        if (name === 'password' && request.method === 'POST') {
          const data = await body(request); const admin = await env.DB.prepare('SELECT password_hash FROM admin_users WHERE id=1').first();
          if (!await verifyPassword(data.current_password,admin.password_hash)) fail('Current password is incorrect.',403);
          const hash = await hashPassword(data.new_password);
          await env.DB.batch([env.DB.prepare("UPDATE admin_users SET password_hash=?,updated_at=? WHERE id=1").bind(hash,new Date().toISOString()),env.DB.prepare('DELETE FROM admin_sessions')]);
          return json({ok:true});
        }
        if (name === 'media') {
          if (request.method === 'POST') return await upload(request,env);
          if (request.method === 'GET') return json((await env.DB.prepare('SELECT * FROM media ORDER BY created_at DESC LIMIT 500').all()).results);
          if (request.method === 'PUT') { const data=await body(request); if (typeof data.alt_text!=='string' || typeof data.credit!=='string' || data.alt_text.length>1000 || data.credit.length>1000) fail('Invalid image details.'); await env.DB.prepare('UPDATE media SET alt_text=?,credit=? WHERE id=?').bind(data.alt_text,data.credit,id).run(); return json({ok:true}); }
          fail('Method not allowed.',405);
        }
        return await resource(request,env,name,id);
      }
      if (path.startsWith('/media/')) {
        if (!['GET','HEAD'].includes(request.method)) fail('Method not allowed.',405);
        const id = path.slice(7); const admin = await session(request,env);
        const media = await env.DB.prepare('SELECT * FROM media WHERE id=?').bind(id).first();
        if (!media) fail('Not found.',404);
        if (!admin) {
          const used = await env.DB.prepare("SELECT 1 FROM articles WHERE cover_media_id=? AND status='published' AND julianday(published_at)<=julianday('now') UNION ALL SELECT 1 FROM article_media JOIN articles ON articles.id=article_media.article_id WHERE media_id=? AND status='published' AND julianday(published_at)<=julianday('now') UNION ALL SELECT 1 FROM tour_dates WHERE image_media_id=? AND status='published' UNION ALL SELECT 1 FROM site_sections WHERE image_media_id=? UNION ALL SELECT 1 FROM livestream_settings WHERE image_media_id=? LIMIT 1").bind(id,id,id,id,id).first();
          if (!used) fail('Not found.',404);
        }
        const object = await env.MEDIA.get(media.object_key); if (!object) fail('Not found.',404);
        return new Response(request.method==='HEAD'?null:object.body,{headers:{...security,'Content-Type':media.content_type,'Content-Length':String(media.byte_size)}});
      }
      if (path === '/admin' || path === '/admin/') {
        const response = await env.ASSETS.fetch(new Request(new URL('/admin/',url),request));
        return new Response(response.body,{status:response.status,headers:{...Object.fromEntries(response.headers),...security,'X-Robots-Tag':'noindex, nofollow'}});
      }
      return await env.ASSETS.fetch(request);
    } catch (error) {
      if (error.status) return json({error:error.message},error.status);
      console.error('Request failed',error.name);
      return json({error:'Unable to save or load. Check required fields and unique slugs, then try again.'},500);
    }
  },
};
