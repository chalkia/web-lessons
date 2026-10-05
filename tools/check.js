// Φύλακες: σύνταξη, ανύπαρκτα στοιχεία HTML, ανύπαρκτες στήλες βάσης.
// Τρέξε:  node tools/check.js   (ή: npm run check)
// Μηδέν ευρήματα = εντάξει. Διόρθωσε τον κώδικα ή τον φύλακα, ποτέ μην κρύψεις το εύρημα.
'use strict';
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const findings = [];

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    if (['node_modules', '.git', 'libs'].includes(name)) { continue; }
    const p = path.join(dir, name);
    if (fs.statSync(p).isDirectory()) { walk(p, out); } else { out.push(p); }
  }
  return out;
}

const files = walk(root, []);
const jsFiles = files.filter((f) => f.endsWith('.js') && !f.endsWith('.min.js'));
const htmlFiles = files.filter((f) => f.endsWith('.html'));

// 1) Σύνταξη
for (const f of jsFiles) {
  const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
  if (r.status !== 0) { findings.push('ΣΥΝΤΑΞΗ ' + path.relative(root, f) + '\n' + r.stderr.trim()); }
}

// 2) Στοιχεία HTML: ζητούμενα id vs ορισμένα id
const defined = new Set();
const requested = new Map();
const idDef = /\bid=\\?["']([^"'\\]+)\\?["']/g;
for (const f of [...htmlFiles, ...jsFiles]) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = idDef.exec(src))) { defined.add(m[1]); }
}
const idReq = /(?:\bel|getElementById)\(\s*['"]([^'"]+)['"]\s*\)/g;
for (const f of jsFiles) {
  const src = fs.readFileSync(f, 'utf8');
  let m;
  while ((m = idReq.exec(src))) {
    if (!requested.has(m[1])) { requested.set(m[1], path.relative(root, f)); }
  }
}
for (const [id, file] of requested) {
  if (!defined.has(id)) { findings.push('ΑΝΥΠΑΡΚΤΟ ΣΤΟΙΧΕΙΟ id="' + id + '" (ζητείται στο ' + file + ')'); }
}

// 3) Στήλες βάσης: πεδία σε insert/update και select απέναντι στο schema.sql
const schema = fs.readFileSync(path.join(root, 'supabase', 'schema.sql'), 'utf8');
const tables = {};
const tRe = /create table if not exists public\.(\w+)\s*\(([\s\S]*?)\n\);/g;
let tm;
while ((tm = tRe.exec(schema))) {
  const cols = new Set();
  for (const line of tm[2].split('\n')) {
    const c = /^\s{2}(\w+)\s+(?:uuid|text|timestamptz|boolean|numeric|int)/.exec(line);
    if (c) { cols.add(c[1]); }
  }
  tables[tm[1]] = cols;
}

// Στήλες που προστίθενται αργότερα με: alter table public.X add column if not exists col type
const aRe = /alter table public\.(\w+)\s+add column if not exists (\w+)/g;
let am;
while ((am = aRe.exec(schema))) {
  if (tables[am[1]]) { tables[am[1]].add(am[2]); }
}

function topLevel(list) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of list) {
    if (ch === '(') { depth++; }
    if (ch === ')') { depth--; }
    if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else { cur += ch; }
  }
  if (cur.trim()) { out.push(cur.trim()); }
  return out;
}

// Συναρτήσεις rpc: όνομα -> παράμετροι (από το schema.sql)
const fns = {};
const fRe = /create or replace function public\.(\w+)\s*\(([^)]*)\)/g;
let fm;
while ((fm = fRe.exec(schema))) {
  fns[fm[1]] = new Set(topLevel(fm[2]).map((p) => p.trim().split(/\s+/)[0]).filter(Boolean));
}

// Έλεγχος ενός select με εμφωλευμένες σχέσεις. Ένα όνομα σχέσης = όνομα πίνακα.
function checkSelect(table, text, rel, where) {
  const cols = tables[table];
  if (!cols) { findings.push('ΑΝΥΠΑΡΚΤΟΣ ΠΙΝΑΚΑΣ ' + table + ' (' + rel + ')'); return; }
  for (let part of topLevel(text)) {
    part = part.replace(/\s+/g, ' ').trim();
    if (!part || part === '*') { continue; }
    const open = part.indexOf('(');
    if (open === -1) {
      const col = part.includes(':') ? part.split(':').pop().trim() : part;
      if (!cols.has(col)) { findings.push('ΑΝΥΠΑΡΚΤΗ ΣΤΗΛΗ ' + table + '.' + col + ' στο ' + where + ' (' + rel + ')'); }
    } else {
      let name = part.slice(0, open).trim();
      name = name.replace(/!.*$/, '');
      if (name.includes(':')) { name = name.split(':').pop().trim(); }
      const inner = part.slice(open + 1, part.lastIndexOf(')'));
      checkSelect(name, inner, rel, where);
    }
  }
}

for (const f of jsFiles.filter((x) => !x.includes(path.sep + 'tools' + path.sep))) {
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(root, f);
  let m;
  const wRe = /\.from\('(\w+)'\)\s*\.(insert|update|upsert)\(\{([\s\S]*?)\}\)/g;
  while ((m = wRe.exec(src))) {
    const cols = tables[m[1]];
    if (!cols) { findings.push('ΑΝΥΠΑΡΚΤΟΣ ΠΙΝΑΚΑΣ ' + m[1] + ' (' + rel + ')'); continue; }
    const kRe = /(?:^|[,{\s])(\w+)\s*:/g; let k;
    while ((k = kRe.exec(m[3]))) {
      if (!cols.has(k[1])) { findings.push('ΑΝΥΠΑΡΚΤΗ ΣΤΗΛΗ ' + m[1] + '.' + k[1] + ' (' + rel + ')'); }
    }
  }
  const sRe = /\.from\('(\w+)'\)\s*\.select\(\s*'([^']*)'/g;
  while ((m = sRe.exec(src))) { checkSelect(m[1], m[2], rel, 'select'); }
  // Κάθε .from('x') πρέπει να είναι γνωστός πίνακας
  const fromRe = /\.from\('(\w+)'\)/g;
  while ((m = fromRe.exec(src))) {
    if (!tables[m[1]] && !['credentials'].includes(m[1])) { findings.push('ΑΝΥΠΑΡΚΤΟΣ ΠΙΝΑΚΑΣ ' + m[1] + ' (' + rel + ')'); }
  }
  // rpc: όνομα και κλειδιά παραμέτρων
  const rRe = /\.rpc\('(\w+)'(?:,\s*\{([\s\S]*?)\})?\s*\)/g;
  while ((m = rRe.exec(src))) {
    if (!fns[m[1]]) { findings.push('ΑΝΥΠΑΡΚΤΗ RPC ' + m[1] + ' (' + rel + ')'); continue; }
    const keys = [];
    const kRe = /(?:^|[,{\s])(\w+)\s*:/g; let k;
    while ((k = kRe.exec(m[2] || ''))) { keys.push(k[1]); }
    for (const key of keys) {
      if (!fns[m[1]].has(key)) { findings.push('ΑΝΥΠΑΡΚΤΗ ΠΑΡΑΜΕΤΡΟΣ ' + m[1] + '(' + key + ') (' + rel + ')'); }
    }
  }
}

// Edge Functions: κάθε functions.invoke('όνομα') πρέπει να έχει φάκελο supabase/functions/όνομα/index.ts,
// και οι rpc μέσα στις συναρτήσεις (TypeScript) ελέγχονται όπως και στα αρχεία JS.
const fnDir = path.join(root, 'supabase', 'functions');
const edgeNames = fs.existsSync(fnDir) ? fs.readdirSync(fnDir).filter((n) => fs.existsSync(path.join(fnDir, n, 'index.ts'))) : [];
for (const f of jsFiles.filter((x) => !x.includes(path.sep + 'tools' + path.sep))) {
  const src = fs.readFileSync(f, 'utf8');
  const iRe = /functions\.invoke\(\s*'([\w-]+)'/g;
  let im;
  while ((im = iRe.exec(src))) {
    if (!edgeNames.includes(im[1])) { findings.push('ΑΝΥΠΑΡΚΤΗ EDGE FUNCTION ' + im[1] + ' (' + path.relative(root, f) + ')'); }
  }
}
for (const name of edgeNames) {
  const f = path.join(fnDir, name, 'index.ts');
  const src = fs.readFileSync(f, 'utf8');
  const rel = path.relative(root, f);
  const tRe = /\.rpc\(\s*"(\w+)"(?:,\s*\{([\s\S]*?)\})?\s*\)/g;
  let m;
  while ((m = tRe.exec(src))) {
    if (!fns[m[1]]) { findings.push('ΑΝΥΠΑΡΚΤΗ RPC ' + m[1] + ' (' + rel + ')'); continue; }
    const kRe = /(?:^|[,{\s])(\w+)\s*:/g; let k;
    while ((k = kRe.exec(m[2] || ''))) {
      if (!fns[m[1]].has(k[1])) { findings.push('ΑΝΥΠΑΡΚΤΗ ΠΑΡΑΜΕΤΡΟΣ ' + m[1] + '(' + k[1] + ') (' + rel + ')'); }
    }
  }
  const fromRe = /\.from\(\s*"(\w+)"\s*\)/g;
  while ((m = fromRe.exec(src))) {
    if (!tables[m[1]]) { findings.push('ΑΝΥΠΑΡΚΤΟΣ ΠΙΝΑΚΑΣ ' + m[1] + ' (' + rel + ')'); }
  }
  // Σύνταξη: το αρχείο είναι JavaScript συμβατό με TypeScript, άρα ελέγχεται ως ενότητα .mjs
  const tmp = path.join(require('os').tmpdir(), 'edge-syntax-' + name + '.mjs');
  fs.writeFileSync(tmp, src);
  const r = spawnSync(process.execPath, ['--check', tmp], { encoding: 'utf8' });
  fs.unlinkSync(tmp);
  if (r.status !== 0) { findings.push('ΣΥΝΤΑΞΗ ' + rel + '\n' + r.stderr.trim()); }
}

if (findings.length) {
  console.error('ΕΥΡΗΜΑΤΑ: ' + findings.length + '\n- ' + findings.join('\n- '));
  process.exit(1);
}
console.log('OK: σύνταξη, στοιχεία HTML και στήλες βάσης χωρίς ευρήματα. Αρχεία JS: ' + jsFiles.length);
