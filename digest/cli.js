#!/usr/bin/env node
// Command line for the Monday workflows. Prints JSON ({"text": ...}) on
// success, a reason on stderr and exit 1 on failure. Never prints the keys
// (it never sees any).
//
//   node digest/cli.js check    --digest digest.json
//   node digest/cli.js draft    --digest digest.json --items items.json --run-id 123 --run-url https://...
//   node digest/cli.js quiet    --digest digest.json --items items.json --run-url https://...
//   node digest/cli.js approve  --digest digest.json
//   node digest/cli.js kind     --digest digest.json        prints "digest" or "quiet"
'use strict';

const fs = require('fs');
const lib = require('./lib');

function parse(argv) {
  const [cmd, ...rest] = argv;
  const o = {};
  for (let i = 0; i < rest.length; i += 2) {
    if (!/^--[a-z-]+$/.test(rest[i] || '') || rest[i + 1] === undefined) throw new Error('bad arguments near "' + (rest[i] || '') + '"');
    o[rest[i].slice(2)] = rest[i + 1];
  }
  return { cmd, o };
}

const readJson = (p, what) => {
  if (!p) throw new Error('--' + what + ' is required');
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { throw new Error('cannot read ' + what + ' (' + p + '): ' + e.message); }
};

function run(argv, out = (s) => process.stdout.write(s + '\n')) {
  const { cmd, o } = parse(argv);
  const digest = readJson(o.digest, 'digest');
  if (cmd === 'check') {
    const problems = lib.validateDigest(digest);
    if (problems.length) throw new Error('digest.json is not usable:\n- ' + problems.join('\n- '));
    out('ok');
  } else if (cmd === 'kind') {
    const problems = lib.validateDigest(digest);
    if (problems.length) throw new Error('digest.json is not usable:\n- ' + problems.join('\n- '));
    out(digest.quiet ? 'quiet' : 'digest');
  } else if (cmd === 'draft') {
    out(JSON.stringify({ text: lib.buildDraft({ digest, items: readJson(o.items, 'items'), runUrl: o['run-url'], runId: o['run-id'] }) }));
  } else if (cmd === 'quiet') {
    out(JSON.stringify({ text: lib.buildQuiet({ digest, items: readJson(o.items, 'items'), runUrl: o['run-url'] }) }));
  } else if (cmd === 'approve') {
    out(JSON.stringify({ text: lib.approvedPost(digest) }));
  } else {
    throw new Error('unknown command "' + cmd + '" (check, kind, draft, quiet, approve)');
  }
}

if (require.main === module) {
  try { run(process.argv.slice(2)); } catch (e) { console.error(e.message); process.exit(1); }
}

module.exports = { run, parse };
