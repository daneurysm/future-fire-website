import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { hashPassword } from './password.mjs';

function readHidden(prompt) {
  if (!process.stdin.isTTY) throw new Error('Run this in an interactive terminal.');
  process.stdout.write(prompt);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  return new Promise((resolve, reject) => {
    let value = '';
    const finish = () => {
      process.stdin.removeListener('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
    };
    const onData = chunk => {
      for (const character of chunk) {
        if (character === '\u0003' || character === '\u0004') {
          finish();
          reject(new Error('Cancelled.'));
          return;
        }
        if (character === '\r' || character === '\n') {
          finish();
          resolve(value);
          return;
        }
        if (character === '\u007f' || character === '\b') value = Array.from(value).slice(0, -1).join('');
        else if (character >= ' ' && value.length < 129) value += character;
      }
    };
    process.stdin.on('data', onData);
  });
}

let directory;
try {
  const [target, username = 'admin'] = process.argv.slice(2);
  if (!['--local', '--remote'].includes(target) || !/^[a-zA-Z0-9_.-]{1,64}$/.test(username)) {
    throw new Error('Usage: node scripts/create-admin.mjs --local|--remote [username]');
  }
  const password = await readHidden('New admin password (15–128 characters, hidden): ');
  const confirmation = await readHidden('Confirm password: ');
  if (password !== confirmation) throw new Error('Passwords do not match.');
  const hash = await hashPassword(password);
  directory = await mkdtemp(join(tmpdir(), 'futurefire-admin-'));
  const filename = join(directory, 'admin.sql');
  await writeFile(filename, `INSERT INTO admin_users (id, username, password_hash) VALUES (1, '${username}', '${hash}');\n`, { mode: 0o600 });
  const result = spawnSync('npx', ['--no-install', 'wrangler', 'd1', 'execute', 'futurefire-club-db', target, '--file', filename], { stdio: 'inherit' });
  if (result.error || result.status !== 0) throw new Error('Account creation failed. Check database configuration; an existing admin is never overwritten.');
  console.log('Admin account created. Your password was not saved or printed.');
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
} finally {
  if (directory) await rm(directory, { recursive: true, force: true });
}
