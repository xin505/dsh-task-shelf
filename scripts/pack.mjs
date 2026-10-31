import { mkdir, readFile, writeFile, cp, mkdtemp, readdir } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
const manifest = JSON.parse(await readFile('package.json', 'utf8'));
const base = `${manifest.name}-${manifest.version}`;
const roots = ['LICENSE', 'THIRD_PARTY_NOTICES.md', 'package.json', 'cordis.patch.yml', 'icon.svg', 'README.md', 'lib', 'docs/TRY-IT.md', 'docs/screenshots/fat-fish-light.png', 'docs/IMPLEMENTATION.md', 'docs/TEST-RESULTS.md', 'docs/DSH-REVIEW-RESPONSE.md'];
await mkdir('dist', { recursive: true }); await mkdir('.dev', { recursive: true });
const stage = await mkdtemp(resolve('.dev/package-'));
const packageDir = join(stage, 'package'); await mkdir(packageDir);
for (const item of roots) { await mkdir(join(packageDir, item, '..'), { recursive: true }); await cp(item, join(packageDir, item), { recursive: true }); }
async function files(dir) { const found = []; for (const entry of await readdir(dir, { withFileTypes: true })) { const p = join(dir, entry.name); if (entry.isDirectory()) found.push(...await files(p)); else { assert.ok(entry.isFile(), 'Only regular files may be packed'); found.push(p); } } return found.sort(); }
const sha = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const tar = process.platform === 'win32' ? 'C:/Windows/System32/tar.exe' : 'tar';
const output = resolve('dist', `${base}.tgz`);
function run(args) { const result = spawnSync(tar, args, { encoding: 'utf8', windowsHide: true }); if (result.status !== 0) throw new Error(result.error?.message || result.stderr || 'tar failed'); return result.stdout; }
run(['-czf', output, '-C', stage, 'package']);
const listed = run(['-tf', output]).split(/\r?\n/).filter(x => x && !x.endsWith('/')).sort();
const staged = await files(packageDir);
assert.deepEqual(listed, staged.map(p => `package/${relative(packageDir, p).replaceAll('\\', '/')}`).sort());
const verify = await mkdtemp(resolve('.dev/unpack-'));
run(['-xzf', output, '-C', verify]);
for (const p of staged) assert.equal(await sha(p), await sha(join(verify, 'package', relative(packageDir, p))));
const installDir = resolve('dist', base); await mkdir(installDir, { recursive: true });
await cp(packageDir, installDir, { recursive: true });
const checks = [`${await sha(output)}  ${base}.tgz`];
for (const p of staged) checks.push(`${await sha(p)}  ${base}/${relative(packageDir, p).replaceAll('\\', '/')}`);
await writeFile('dist/SHA256SUMS.txt', `${checks.join('\n')}\n`);
console.log(JSON.stringify({ package: output, installDirectory: installDir, verifiedFiles: staged.length, sha256: await sha(output) }, null, 2));
