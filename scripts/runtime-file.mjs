// Development helper: read an installed Electron archive without changing it.
import fs from 'node:fs';
import pathModule from 'node:path';
const archive = process.env.DSH_ASAR || 'D:/DeepSeek Harness/resources/app.asar';
const fd = fs.openSync(archive, 'r');
const prefix = Buffer.alloc(16);
fs.readSync(fd, prefix, 0, 16, 0);
const header = Buffer.alloc(prefix.readUInt32LE(12));
fs.readSync(fd, header, 0, header.length, 16);
const root = JSON.parse(header);
const dataOffset = 8 + prefix.readUInt32LE(4);
function entry(path) {
  let value = root;
  for (const part of path.split('/')) value = value.files?.[part];
  if (!value) throw new Error(`Missing archive entry: ${path}`);
  if (value.link) return entry(value.link);
  return value;
}
if (process.argv[2] === '--extract') {
  const destination = pathModule.resolve('.dev/runtime');
  let count = 0;
  function copy(path, value, target) {
    if (value.files) {
      fs.mkdirSync(target, { recursive: true });
      for (const [name, child] of Object.entries(value.files)) copy(`${path}/${name}`, child, pathModule.join(target, name));
    } else if (value.link) copy(value.link, entry(value.link), target);
    else {
      if (value.unpacked) fs.copyFileSync(`${archive}.unpacked/${path}`, target);
      else {
        const content = Buffer.alloc(value.size);
        fs.readSync(fd, content, 0, value.size, dataOffset + Number(value.offset));
        fs.writeFileSync(target, content);
      }
      count++;
    }
  }
  copy('dsh', entry('dsh'), destination);
  console.log(`Extracted ${count} installed runtime files to ${destination} (development only).`);
  fs.closeSync(fd);
  process.exit(0);
}
for (const path of process.argv.slice(2)) {
  const value = entry(path);
  if (value.files) { console.log(path, Object.keys(value.files)); continue; }
  let content;
  if (value.unpacked) content = fs.readFileSync(`${archive}.unpacked/${path}`);
  else {
    content = Buffer.alloc(value.size);
    fs.readSync(fd, content, 0, value.size, dataOffset + Number(value.offset));
  }
  console.log(`FILE: ${path}\n${content.toString('utf8')}`);
}
fs.closeSync(fd);
