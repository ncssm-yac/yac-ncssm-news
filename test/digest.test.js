// Tests for the Monday digest's plain-code edges: checking digest.json,
// building the YAC IT draft, and the approved post. Made-up content only.
//   node test/digest.test.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const lib = require('../digest/lib');
const cli = require('../digest/cli');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n     ')); }
}

const POST = `*Yakkety here with this week's NCSSM news!* A big week for the school.

*Last week at NCSSM*
• *No. 1 again:* Niche named NCSSM the best public high school in America for 2027. It is the fourth time in five years. https://www.ncssm.edu/news/example-niche

*Coming up*
• *Oct 16: Alumni meeting:* The Chancellor gives a State of the School talk. Every alum can vote. https://alumni.ncssm.edu/e/annual-meeting`;

const DIGEST = { week: '2026-10-12', text: POST, items: [
  { id: 'a1', title: 'No. 1 again', url: 'https://www.ncssm.edu/news/example-niche' },
  { id: 'n1', title: 'Alumni meeting', url: 'https://alumni.ncssm.edu/e/annual-meeting' }] };
const QUIET = { week: '2026-10-12', quiet: true, items: [] };
const ITEMS_OK = { sources: { 'ncssm.edu/news': { ok: true }, 'google-news': { ok: true }, newsletters: { ok: true } } };
const ITEMS_BAD = { sources: { 'ncssm.edu/news': { ok: true }, 'ncssm.edu/events': { ok: false, error: 'ncssm.edu/events answered 500' }, newsletters: { ok: false, error: 'YAKKETY_GOOGLE_KEY is not set' } } };
const RUN = { runId: '39155887635', runUrl: 'https://github.com/ncssm-yac/yakkety/actions/runs/39155887635' };

(async () => {
  await test('a good digest and a quiet week are both fine', () => {
    assert.deepStrictEqual(lib.validateDigest(DIGEST), []);
    assert.deepStrictEqual(lib.validateDigest(QUIET), []);
  });

  await test('what a bad digest.json is told it got wrong', () => {
    const bad = (d, re) => assert.ok(lib.validateDigest(d).some((p) => re.test(p)), JSON.stringify(d).slice(0, 80) + ' -> ' + lib.validateDigest(d));
    bad(null, /not an object/);
    bad([], /not an object/);
    bad(Object.assign({}, DIGEST, { week: 'Monday' }), /"week"/);
    bad(Object.assign({}, DIGEST, { items: 'none' }), /"items"/);
    bad(Object.assign({}, DIGEST, { text: '   ' }), /"text" is empty/);
    bad(Object.assign({}, DIGEST, { text: 'No bullets here, just a paragraph.' }), /no stories/);
    bad(Object.assign({}, DIGEST, { text: POST + '\n' + 'x'.repeat(3500) }), /characters/);
    bad(Object.assign({}, DIGEST, { text: '*Draft NCSSM News digest, not sent yet*\n' + POST }), /draft wrapper/);
    bad(Object.assign({}, DIGEST, { items: [] }), /"items" is empty/);
    bad(Object.assign({}, DIGEST, { items: [{ id: 'x', title: '', url: 'https://x.test' }] }), /no title/);
    bad(Object.assign({}, DIGEST, { items: [{ id: 'x', title: 'T', url: 'javascript:alert(1)' }] }), /no link/);
    bad({ week: '2026-10-12', quiet: true, text: POST, items: [] }, /quiet week has no post/);
  });

  await test('the draft wraps the post, says it is not sent, and says how to send it', () => {
    const t = lib.buildDraft(Object.assign({ digest: DIGEST, items: ITEMS_OK }, RUN));
    assert.ok(t.startsWith('*Draft NCSSM News digest, not sent yet*\n*Yakkety here'));
    assert.ok(t.includes(POST), 'the post is carried unchanged');
    assert.ok(t.includes('Every story and its score: ' + RUN.runUrl));
    assert.ok(t.includes('"Send approved NCSSM News post"') && t.includes('with run "39155887635"'));
    assert.ok(!/Not collected/.test(t), 'no warning when every source worked');
    assert.ok(t.length <= lib.MAX_MESSAGE);
  });

  await test('a source that failed is named in the draft, with no error text', () => {
    const t = lib.buildDraft(Object.assign({ digest: DIGEST, items: ITEMS_BAD }, RUN));
    assert.ok(t.includes('Not collected this week: ncssm.edu/events, newsletters.'));
    assert.ok(!/GOOGLE_KEY|answered 500/.test(t), 'details stay in the run log');
    assert.deepStrictEqual(lib.failedSources(ITEMS_BAD), ['ncssm.edu/events', 'newsletters']);
    assert.deepStrictEqual(lib.failedSources({}), []);
  });

  await test('the draft refuses a bad digest, a missing run number, a quiet week and an over-long message', () => {
    assert.throws(() => lib.buildDraft(Object.assign({ digest: { week: 'x' }, items: ITEMS_OK }, RUN)), /not usable/);
    assert.throws(() => lib.buildDraft({ digest: DIGEST, items: ITEMS_OK, runId: '', runUrl: RUN.runUrl }), /runId/);
    assert.throws(() => lib.buildDraft({ digest: DIGEST, items: ITEMS_OK, runId: '12; rm -rf', runUrl: RUN.runUrl }), /runId/);
    assert.throws(() => lib.buildDraft(Object.assign({ digest: QUIET, items: ITEMS_OK }, RUN)), /quiet/);
    const fullPost = Object.assign({}, DIGEST, { text: POST + '\n\u2022 *Padding:* ' + 'word '.repeat(560) + '. https://x.test/p' });
    fullPost.text += 'y'.repeat(lib.MAX_POST - fullPost.text.length);
    assert.strictEqual(fullPost.text.length, lib.MAX_POST, 'the largest post the skill may write');
    assert.deepStrictEqual(lib.validateDigest(fullPost), []);
    // The largest legal post plus the wrapper still fits; a wrapper that pushes it over is refused, not truncated.
    assert.ok(lib.buildDraft(Object.assign({ digest: fullPost, items: ITEMS_BAD }, RUN)).length <= lib.MAX_MESSAGE);
    assert.throws(() => lib.buildDraft({ digest: fullPost, items: ITEMS_BAD, runId: RUN.runId, runUrl: 'https://x.test/' + 'a'.repeat(300) }), /YAC Chat allows/);
  });

  await test('the note to YAC IT after an automatic post counts the stories and names missing sources', () => {
    const t = lib.buildPosted({ digest: DIGEST, items: ITEMS_BAD, runUrl: RUN.runUrl });
    assert.ok(t.startsWith('*NCSSM News digest posted*') && t.includes('(2 stories)'));
    assert.ok(t.includes('without approval') && t.includes('ncssm.edu/events') && t.includes(RUN.runUrl));
    assert.ok(!t.includes(POST), 'the note does not repeat the post');
    assert.ok(!/GOOGLE_KEY|answered 500/.test(t));
    assert.throws(() => lib.buildPosted({ digest: QUIET, items: ITEMS_OK }), /nothing posted/);
    assert.throws(() => lib.buildPosted({ digest: { week: 'x' }, items: ITEMS_OK }), /not usable/);
  });

  await test('a quiet week says so, and names missing sources', () => {
    const t = lib.buildQuiet({ digest: QUIET, items: ITEMS_BAD, runUrl: RUN.runUrl });
    assert.ok(/quiet week/i.test(t) && /nothing was posted/.test(t));
    assert.ok(t.includes('ncssm.edu/events') && t.includes(RUN.runUrl));
    assert.throws(() => lib.buildQuiet({ digest: DIGEST, items: ITEMS_OK }), /has a digest/);
  });

  await test('the approved post is exactly the skill\'s post: no wrapper, no changes', () => {
    assert.strictEqual(lib.approvedPost(Object.assign({}, DIGEST, { text: '  ' + POST + '\n\n' })), POST);
    assert.throws(() => lib.approvedPost(QUIET), /nothing to send/);
    assert.throws(() => lib.approvedPost(Object.assign({}, DIGEST, { text: '' })), /not usable/);
  });

  await test('the command line prints JSON for draft, quiet and approve, and says what is wrong otherwise', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digest-test-'));
    const w = (n, v) => { const p = path.join(dir, n); fs.writeFileSync(p, typeof v === 'string' ? v : JSON.stringify(v)); return p; };
    const d = w('digest.json', DIGEST), q = w('quiet.json', QUIET), i = w('items.json', ITEMS_BAD), broken = w('broken.json', '{ not json');
    const run = (...a) => { const got = []; cli.run(a, (s) => got.push(s)); return got.join('\n'); };
    assert.strictEqual(run('kind', '--digest', d), 'digest');
    assert.strictEqual(run('kind', '--digest', q), 'quiet');
    assert.strictEqual(run('check', '--digest', d), 'ok');
    const draft = JSON.parse(run('draft', '--digest', d, '--items', i, '--run-id', RUN.runId, '--run-url', RUN.runUrl));
    assert.ok(draft.text.startsWith('*Draft NCSSM News digest, not sent yet*'));
    assert.ok(JSON.parse(run('posted', '--digest', d, '--items', i, '--run-url', RUN.runUrl)).text.startsWith('*NCSSM News digest posted*'));
    assert.throws(() => run('posted', '--digest', q, '--items', i), /nothing posted/);
    assert.ok(JSON.parse(run('quiet', '--digest', q, '--items', i, '--run-url', RUN.runUrl)).text.includes('quiet week'));
    assert.strictEqual(JSON.parse(run('approve', '--digest', d)).text, POST);
    assert.throws(() => run('approve', '--digest', q), /nothing to send/);
    assert.throws(() => run('check', '--digest', broken), /cannot read digest/);
    assert.throws(() => run('check', '--digest', path.join(dir, 'missing.json')), /cannot read digest/);
    assert.throws(() => run('draft', '--digest', d), /--items is required/);
    assert.throws(() => run('frobnicate', '--digest', d), /unknown command/);
    assert.throws(() => run('check', 'digest', d), /bad arguments/);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
