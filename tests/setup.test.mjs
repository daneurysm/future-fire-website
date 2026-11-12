import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';

test('owner setup stays loopback-only and rejects missing tokens, cross-origin requests, and weak passwords',async()=>{
  const child=spawn(process.execPath,['scripts/setup-admin.mjs','--local'],{cwd:new URL('../',import.meta.url),stdio:['ignore','pipe','pipe']});
  try{
    const address=await new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(new Error('Setup server did not start.')),10000);
      child.once('error',reject);child.stdout.on('data',chunk=>{const match=chunk.toString().match(/http:\/\/127\.0\.0\.1:\d+\/\?token=[a-f0-9]+/);if(match){clearTimeout(timeout);resolve(new URL(match[0]));}});
    });
    const origin=address.origin;const token=address.searchParams.get('token');
    const page=await fetch(address);assert.equal(page.status,200);assert.match(page.headers.get('Content-Security-Policy'),/frame-ancestors 'none'/);
    assert.equal((await fetch(origin)).status,403);
    assert.equal((await fetch(`${origin}/?token=${'é'.repeat(64)}`)).status,403);
    assert.equal((await fetch(`${origin}/setup`,{method:'POST',headers:{Origin:'https://evil.example',Authorization:`Bearer ${token}`}})).status,403);
    const response=await fetch(`${origin}/setup`,{method:'POST',headers:{Origin:origin,Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({username:'admin',password:'short',confirmation:'short'})});
    assert.equal(response.status,400);assert.match((await response.json()).error,/15 and 128/);
  }finally{child.kill('SIGTERM');}
});
