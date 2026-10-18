#!/usr/bin/env node
// Builds data/notable-alumni.json from the "Notable alumni" section of NCSSM's
// Wikipedia page. Public figures and public facts only; the page's text is
// CC BY-SA 4.0, so the file records where it came from.
//
//   node collector/alumni.js --out data/notable-alumni.json
//   node collector/alumni.js --from-file page.wikitext --out data/notable-alumni.json
//
// This is a starting list, not the whole story: widening it is on the
// roadmap (see docs/ncssm-news.md in ncssm-yac/yakkety). Nothing here reads
// the Alumni Network directory.
'use strict';

const fs = require('fs');

const PAGE = 'North_Carolina_School_of_Science_and_Mathematics';
const SOURCE_URL = 'https://en.wikipedia.org/wiki/' + PAGE;
const RAW_URL = 'https://en.wikipedia.org/w/index.php?title=' + PAGE + '&action=raw';
const UA = 'yac-ncssm-news/1.0 (https://github.com/ncssm-yac/yac-ncssm-news)';
const MIN_ENTRIES = 10; // fewer than this means the page changed shape, not that NCSSM lost its alumni

// ---------------------------------------------------------------------------
// Parsing (pure)
// ---------------------------------------------------------------------------

/** The text under "== Notable alumni ==", up to the next heading. */
function alumniSection(wikitext) {
  const start = wikitext.match(/^==\s*Notable alumni\s*==\s*$/m);
  if (!start) return null;
  const rest = wikitext.slice(start.index + start[0].length);
  const next = rest.match(/^==[^=]/m);
  return next ? rest.slice(0, next.index) : rest;
}

/** Remove <ref>...</ref>, <ref ... />, comments and {{templates}} (nested too). */
function stripMarkup(s) {
  let out = String(s)
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<ref\b[^>]*\/>/gi, '')
    .replace(/<ref\b[^>]*>[\s\S]*?<\/ref>/gi, '');
  for (let i = 0; i < 6 && /\{\{[^{}]*\}\}/.test(out); i++) out = out.replace(/\{\{[^{}]*\}\}/g, '');
  return out;
}

/** [[Target|Label]] -> Label, [[Target]] -> Target, [url Label] -> Label, ''italics'' -> plain. */
function plainText(s) {
  return String(s)
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, '$2')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/\[https?:\/\/\S+\]/g, '')
    .replace(/'{2,}/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** One bullet -> entry, or null if it isn't "Name year, description". */
function parseBullet(line) {
  const text = stripMarkup(line.replace(/^\*\s*/, '')).trim();
  // Name: a wiki link, or an external link whose label is the name.
  const wiki = text.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]\s*/);
  const ext = !wiki && text.match(/^\[(https?:\/\/\S+)\s+([^\]]+)\]\s*/);
  if (!wiki && !ext) return null;
  const head = wiki || ext;
  const afterName = text.slice(head[0].length);
  const m = afterName.match(/^((?:19|20)\d{2})\s*[,;:–-]?\s*(.*)$/);
  if (!m) return null;

  const name = plainText(wiki ? (wiki[2] || wiki[1]) : ext[2]);
  const target = wiki ? wiki[1].trim() : null;
  const description = plainText(m[2]).replace(/[\s,;]+$/, '').replace(/^[a-z]/, (c) => c.toUpperCase());
  const paren = target && target.match(/\(([^)]+)\)\s*$/);
  const baseTarget = target ? target.replace(/\s*\([^)]*\)\s*$/, '') : null;
  const names = [name];
  if (baseTarget && baseTarget.toLowerCase() !== name.toLowerCase()) names.push(baseTarget);

  return {
    name,
    names,
    classYear: Number(m[1]),
    description,
    wikipedia: target ? 'https://en.wikipedia.org/wiki/' + encodeURI(target.replace(/ /g, '_')) : null,
    website: ext ? ext[1] : null,
    // Wikipedia only adds "(speedcuber)" when other people share the name:
    // searching the bare name later needs a second clue.
    sharesNameWith: paren ? paren[1] : null
  };
}

function parseAlumni(wikitext) {
  const section = alumniSection(String(wikitext));
  if (section === null) throw new Error('no "Notable alumni" section found (did the Wikipedia page change?)');
  const out = [];
  const seen = new Set();
  for (const line of section.split('\n')) {
    if (!/^\*/.test(line)) continue;
    const e = parseBullet(line);
    if (!e || seen.has(e.name.toLowerCase())) continue;
    seen.add(e.name.toLowerCase());
    out.push(e);
  }
  if (out.length < MIN_ENTRIES) throw new Error('only ' + out.length + ' alumni found (did the Wikipedia page change?)');
  return out;
}

function buildFile(wikitext, retrievedOn) {
  return {
    schema: 1,
    source: {
      name: 'Wikipedia: North Carolina School of Science and Mathematics, "Notable alumni"',
      url: SOURCE_URL,
      retrievedOn,
      license: 'Text from Wikipedia, CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)',
      note: 'Public figures and public facts only. A starting list: widening it is on the roadmap.'
    },
    alumni: parseAlumni(wikitext)
  };
}

// ---------------------------------------------------------------------------
// Fetching and CLI
// ---------------------------------------------------------------------------

async function fetchWikitext({ fetch: f = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), attempts = 4 } = {}) {
  let lastStatus = 0;
  for (let i = 0; i < attempts; i++) {
    const res = await f(RAW_URL, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
    if (res.ok) return res.text();
    lastStatus = res.status;
    if (res.status !== 429 && res.status < 500) break;
    const wait = Number(res.headers && res.headers.get && res.headers.get('retry-after'));
    await sleep(Math.min(60000, (Number.isFinite(wait) && wait > 0 ? wait * 1000 : 5000 * (i + 1))));
  }
  throw new Error('Wikipedia answered ' + lastStatus);
}

async function main(argv) {
  let out = 'data/notable-alumni.json', fromFile = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i];
    else if (argv[i] === '--from-file') fromFile = argv[++i];
    else throw new Error('unknown option ' + argv[i]);
  }
  const wikitext = fromFile ? fs.readFileSync(fromFile, 'utf8') : await fetchWikitext();
  const file = buildFile(wikitext, new Date().toISOString().slice(0, 10));
  fs.mkdirSync(require('path').dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(file, null, 2) + '\n');
  console.log('Wrote ' + file.alumni.length + ' alumni to ' + out);
  return 0;
}

if (require.main === module) main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error('Not written: ' + e.message); process.exit(1); });

module.exports = { alumniSection, stripMarkup, plainText, parseBullet, parseAlumni, buildFile, fetchWikitext, MIN_ENTRIES };
