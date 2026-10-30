import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { mkdir, copyFile, cp, writeFile } from 'node:fs/promises';
const profile = resolve('.dev/dsh-home/profiles/web/node_modules/dsh-task-shelf');
await mkdir(profile, { recursive: true });
for (const file of ['package.json', 'cordis.patch.yml', 'icon.svg']) await copyFile(file, `${profile}/${file}`);
await cp('lib', `${profile}/lib`, { recursive: true });
const fixture = new URL('../tests/fixture-plugin.mjs', import.meta.url).href;
await writeFile('.dev/test.patch.yml', `- insert:\n    - id: dsh-task-shelf\n      name: dsh-task-shelf\n    - id: task-shelf-fixture\n      name: '${fixture}'\n`);
const child = spawn(process.execPath, ['.dev/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js', '--profile', 'web', '--patch', '.dev/test.patch.yml', '--no-open', '--port', '3188'], { windowsHide: true, env: { ...process.env, DSH_HOME: resolve('.dev/dsh-home'), DSH_AGENTS_HOME: resolve('.dev/agents-home') }, stdio: ['ignore', 'pipe', 'pipe'] });
let lines = '';
child.stdout.on('data', async chunk => {
  lines += chunk.toString();
  const match = lines.match(/dsh web: (http:\/\/[^\s]+)/);
  if (match) { await writeFile('.dev/server.json', JSON.stringify({ url: match[1], pid: child.pid })); console.log('Isolated DSH 0.2.1-rc.3 listening at http://127.0.0.1:3188 (auth URL saved in .dev/server.json).'); lines = ''; }
});
child.stderr.on('data', chunk => process.stderr.write(chunk));
process.on('SIGINT', () => child.kill());
process.on('SIGTERM', () => child.kill());
child.on('exit', code => process.exit(code ?? 0));
