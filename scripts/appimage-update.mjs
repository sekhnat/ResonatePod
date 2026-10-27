// Gives an AppImage the address its updates come from, and makes the .zsync file that lets AppImageUpdate (and Gear
// Lever and the like) fetch only what changed. Usage: node scripts/appimage-update.mjs release/Resonate-1.5.4.AppImage
//
// A type-2 AppImage's runtime has a section, .upd_info, set aside for that address; `appimagetool -u` only writes into it,
// so this does the same without needing appimagetool. It refuses a file that has no such section rather than guess.
import { execFileSync } from 'node:child_process';
import { closeSync, fstatSync, openSync, readFileSync, readSync, writeSync } from 'node:fs';
import path from 'node:path';

const file = process.argv[2];
if (!file) { console.error('usage: node scripts/appimage-update.mjs <file>.AppImage'); process.exit(2); }

const repo = /github\.com[/:]([^/]+\/[^/.]+)/.exec(JSON.parse(readFileSync('package.json', 'utf8')).repository?.url ?? '')?.[1];
if (!repo) throw new Error('package.json has no GitHub repository to take updates from');
// Resonate-1.5.4.AppImage -> Resonate-*.AppImage.zsync, whatever the next release is called.
const name = path.basename(file);
const family = /^(.*?-)\d[\w.+-]*(\.AppImage)$/.exec(name);
if (!family) throw new Error(`can't tell the version in ${name}`);
const info = `gh-releases-zsync|${repo.replace('/', '|')}|latest|${family[1]}*${family[2]}.zsync`;

const fd = openSync(file, 'r+');
try {
  const at = (offset, length) => {
    const b = Buffer.alloc(length);
    if (readSync(fd, b, 0, length, offset) !== length) throw new Error(`${name} ends before its section headers do`);
    return b;
  };
  const head = at(0, 64);
  if (head.readUInt32BE(0) !== 0x7f454c46 || head[4] !== 2 || head[5] !== 1) throw new Error(`${name} is not a 64-bit little-endian ELF file`);
  const shoff = Number(head.readBigUInt64LE(0x28));
  const shentsize = head.readUInt16LE(0x3a);
  const shnum = head.readUInt16LE(0x3c);
  const shstrndx = head.readUInt16LE(0x3e);
  if (!shoff || shoff + shnum * shentsize > fstatSync(fd).size) throw new Error(`${name} has no usable section headers`);
  const sections = Array.from({ length: shnum }, (_, i) => {
    const h = at(shoff + i * shentsize, shentsize);
    return { name: h.readUInt32LE(0), offset: Number(h.readBigUInt64LE(0x18)), size: Number(h.readBigUInt64LE(0x20)) };
  });
  const strings = at(sections[shstrndx].offset, sections[shstrndx].size);
  const nameOf = (s) => strings.subarray(s.name, strings.indexOf(0, s.name)).toString();
  const slot = sections.find((s) => nameOf(s) === '.upd_info');
  if (!slot) throw new Error(`${name} has no .upd_info section, so it is not a type-2 AppImage this can update`);
  if (info.length >= slot.size) throw new Error(`the update information (${info.length} bytes) doesn't fit in ${slot.size}`);
  const text = Buffer.alloc(slot.size); // zero-filled, as appimagetool leaves it
  text.write(info);
  if (writeSync(fd, text, 0, text.length, slot.offset) !== text.length) throw new Error(`couldn't write to ${name}`);
  console.log(`${name}: update information set to ${info}`);
} finally {
  closeSync(fd);
}

// -u is the file's address relative to the .zsync file, where the two sit side by side in a release.
execFileSync('zsyncmake', ['-u', name, '-o', `${file}.zsync`, file], { stdio: 'inherit' });
console.log(`${name}.zsync written`);
