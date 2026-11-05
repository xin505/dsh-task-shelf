import { readFile } from 'node:fs/promises';
const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url)));
const known = [...manifest.engines.dsh.matchAll(/\d+\.\d+\.\d+(?:-rc\.\d+)?/g)].map(x => x[0]);
if (!known.length) throw new Error('No explicit tested DSH versions in engines.dsh');
const tuple = version => { const m = /^(\d+)\.(\d+)\.(\d+)(?:-rc\.(\d+))?$/.exec(version); return m && [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? Infinity : Number(m[4])]; };
function cmp(a,b) { for (let i=0;i<4;i++) if (a[i] !== b[i]) return a[i] > b[i] ? 1 : -1; return 0; }
const supported = known.map(tuple).filter(Boolean).sort(cmp).at(-1);
const response = await fetch('https://api.github.com/repos/deepseek-ai/DeepSeek-Harness/releases?per_page=100', { headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'dsh-task-shelf-compatibility-check', ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) }, signal: AbortSignal.timeout(20000) });
if (!response.ok) throw new Error(`GitHub release lookup failed: HTTP ${response.status}`);
const releases = await response.json();
if (!Array.isArray(releases)) throw new Error('Unexpected GitHub releases response');
const versions = releases.filter(r => !r.draft && typeof r.tag_name === 'string' && r.tag_name.startsWith('dsh-v')).map(r => ({ version: r.tag_name.slice(5), url: r.html_url })).filter(r => tuple(r.version)).sort((a,b) => cmp(tuple(b.version),tuple(a.version)));
if (!versions.length) throw new Error('No DSH stable or release candidate releases found');
const latest = versions[0];
console.log(`Newest upstream DSH: ${latest.version} ${latest.url}`);
console.log(`Explicitly tested versions: ${known.join(', ')}`);
if (cmp(tuple(latest.version), supported) > 0) { console.error('New DSH version needs compatibility testing; no version declarations were changed.'); process.exitCode = 1; }
else console.log('No newer stable or release candidate version found.');
