import {createServer} from 'node:http';
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {hashPassword} from './password.mjs';

const target=process.argv[2];
if(!['--local','--remote'].includes(target))throw new Error('Usage: node scripts/setup-admin.mjs --local|--remote');
const root=fileURLToPath(new URL('../',import.meta.url));
const token=randomBytes(32).toString('hex');
const nonce=randomBytes(16).toString('hex');
let working=false,finished=false;
function validToken(value){return typeof value==='string'&&/^[a-f0-9]{64}$/.test(value)&&timingSafeEqual(Buffer.from(value),Buffer.from(token));}
function execute(filename){return new Promise((resolve,reject)=>{const child=spawn(process.execPath,[join(root,'node_modules/wrangler/bin/wrangler.js'),'d1','execute','futurefire-club-db',target,'--file',filename],{cwd:root,stdio:['ignore','ignore','ignore']});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error('Account creation failed. The account may already exist, or Cloudflare access may have expired. No existing account was changed.')));});}
const page=`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Future Fire — Private account setup</title><style nonce="${nonce}">*{box-sizing:border-box}body{background:#0b1015;color:#e5f1e2;font:16px Arial,sans-serif;margin:0;padding:40px 20px}main{max-width:520px;margin:40px auto;border:1px solid #38453a;padding:32px;border-radius:10px}h1{color:#d0f19a;font-size:32px}p{line-height:1.6;color:#afbfaf}label{display:block;margin:20px 0}input{display:block;margin-top:10px;padding:12px;width:100%;background:#111c1b;color:white;border:1px solid #536650;border-radius:4px;font:inherit}button{padding:14px 20px;background:#d0f19a;border:0;border-radius:4px;color:#13200e;font-weight:bold;cursor:pointer}#status{white-space:pre-wrap}</style></head><body><main><p>FUTURE FIRE / OWNER SETUP</p><h1>Make it yours.</h1><p>This one-time setup runs on your computer. Your password is hashed here; only the hash is sent to your Cloudflare database.</p><form id="setup"><label>Username<input name="username" value="admin" autocomplete="username" required pattern="[a-zA-Z0-9_.-]{1,64}" maxlength="64"></label><label>Password (15–128 characters)<input name="password" type="password" autocomplete="new-password" minlength="15" maxlength="128" required></label><label>Confirm password<input name="confirmation" type="password" autocomplete="new-password" minlength="15" maxlength="128" required></label><button>Create my admin account</button></form><p id="status" role="status" aria-live="polite"></p></main><script nonce="${nonce}">const token=new URL(location.href).searchParams.get('token');history.replaceState(null,'','/');document.getElementById('setup').onsubmit=async event=>{event.preventDefault();const form=event.currentTarget;const button=form.querySelector('button');const status=document.getElementById('status');const data=Object.fromEntries(new FormData(form));if(data.password!==data.confirmation){status.textContent='Passwords do not match.';return;}button.disabled=true;status.textContent='Creating your private account…';try{const response=await fetch('/setup',{method:'POST',headers:{'Content-Type':'application/json','Authorization':'Bearer '+token},body:JSON.stringify(data)});const result=await response.json();if(!response.ok)throw new Error(result.error);form.reset();form.hidden=true;status.textContent='Account created. You can close this page and sign in at https://futurefire.club/admin';}catch(error){status.textContent=error.message;button.disabled=false;}};</script></body></html>`;
const server=createServer(async(request,response)=>{
  const address=server.address();const origin=`http://127.0.0.1:${address.port}`;
  const headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY','Content-Security-Policy':`default-src 'none'; style-src 'nonce-${nonce}'; script-src 'nonce-${nonce}'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'`};
  const send=(status,data)=>{response.writeHead(status,{...headers,'Content-Type':'application/json'});response.end(JSON.stringify(data));};
  if(request.headers.host!==`127.0.0.1:${address.port}`){send(403,{error:'Access denied.'});return;}
  const url=new URL(request.url,origin);
  if(request.method==='GET'&&url.pathname==='/'&&validToken(url.searchParams.get('token'))&&!finished){response.writeHead(200,{...headers,'Content-Type':'text/html; charset=utf-8'});response.end(page);return;}
  if(request.method!=='POST'||url.pathname!=='/setup'||request.headers.origin!==origin||!validToken(request.headers.authorization?.replace(/^Bearer /,''))||finished){send(403,{error:'This private setup link is invalid or expired.'});return;}
  if(working){send(409,{error:'Setup is already in progress.'});return;}
  working=true;let directory;
  try{
    if(request.headers['content-type']!=='application/json')throw new Error('Invalid request.');
    let body='';for await(const chunk of request){body+=chunk.toString();if(Buffer.byteLength(body)>4096)throw new Error('Request too large.');}
    const data=JSON.parse(body);
    if(typeof data.username!=='string'||!/^[a-zA-Z0-9_.-]{1,64}$/.test(data.username))throw new Error('Use a username with letters, numbers, periods, underscores, or hyphens.');
    if(data.password!==data.confirmation)throw new Error('Passwords do not match.');
    const hash=await hashPassword(data.password);
    directory=await mkdtemp(join(tmpdir(),'ff-owner-'));
    const filename=join(directory,'admin.sql');
    await writeFile(filename,`INSERT INTO admin_users(id,username,password_hash) VALUES(1,'${data.username}','${hash}');`,{mode:0o600});
    await execute(filename);finished=true;send(200,{ok:true});console.log('Administrator account created successfully. No password was logged.');
    clearTimeout(expiry);setTimeout(()=>server.close(),1500);
  }catch(error){send(400,{error:error instanceof SyntaxError?'Invalid request.':error.message});}
  finally{working=false;if(directory)await rm(directory,{recursive:true,force:true});}
});
const expiry=setTimeout(()=>{console.log('Private setup link expired. Restart setup to try again.');server.close();},15*60*1000);
server.listen(0,'127.0.0.1',()=>console.log(`Private owner setup (expires in 15 minutes): http://127.0.0.1:${server.address().port}/?token=${token}`));
