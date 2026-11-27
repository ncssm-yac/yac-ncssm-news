// Safety promises of apps-script/Code.gs that test/run-tests.js does not pin
// down: the scopes and the Gmail/Drive calls the script may make, what is
// logged, how links and forwards are cleaned, and what a failed run leaves
// behind. Loads Code.gs into a vm context with fake Gmail, Drive and Apps
// Script services. All senders and content are made up.
//   node test/apps-script-safety.test.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const collectorLib = require('../collector/lib');

const SRC = path.join(__dirname, '..', 'apps-script');
const CODE = fs.readFileSync(path.join(SRC, 'Code.gs'), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n     ')); }
}

function load() {
  const c = vm.createContext({ console });
  vm.runInContext(CODE, c, { filename: 'Code.gs' });
  return c;
}

// Fake Apps Script services. `existing` is a list of files already in the
// inbox folder ({ name, parents, content }).
function fakeEnv(c, { props = {}, mail = [], existing = [], listError = null, driveListError = null } = {}) {
  const env = { props, logs: [], files: {}, gets: [], created: 0, nextId: 1, updated: 0 };
  for (const f of existing) {
    const id = 'x' + env.nextId++;
    env.files[id] = { id, name: f.name, parents: f.parents, content: f.content };
  }
  c.Logger = { log: (m) => env.logs.push(String(m)) };
  c.LockService = { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) };
  c.PropertiesService = { getScriptProperties: () => ({
    getProperty: (k) => (k in props ? props[k] : null),
    setProperty: (k, v) => { props[k] = String(v); }
  }) };
  c.Utilities = {
    base64DecodeWebSafe: (s) => Array.from(Buffer.from(s, 'base64url')),
    newBlob: (data, mime, name) => ({
      mime, name,
      getDataAsString: () => (typeof data === 'string' ? data : Buffer.from(data).toString('utf8'))
    })
  };
  c.Gmail = { Users: { Messages: {
    list: () => {
      if (listError) throw new Error(listError);
      return { messages: mail.map((m) => ({ id: m.id })) };
    },
    get: (user, id) => {
      env.gets.push(id);
      const m = mail.find((x) => x.id === id);
      if (!m) throw new Error('no such message');
      return m;
    }
  } } };
  c.Drive = {
    Files: {
      create: (meta, blob) => {
        const id = 'f' + env.nextId++;
        env.files[id] = { id, name: meta.name, parents: meta.parents || [], content: blob ? blob.getDataAsString() : null };
        env.created++;
        return { id };
      },
      list: (opts) => {
        if (driveListError) throw new Error(driveListError);
        const parent = opts.q.match(/^'([^']+)' in parents/)[1];
        return { files: Object.values(env.files).filter((f) => f.parents.includes(parent)).map((f) => ({ id: f.id, name: f.name })) };
      },
      update: (meta, id, blob) => { env.files[id].content = blob.getDataAsString(); env.updated++; return { id }; }
    },
    Permissions: { create: () => ({}) }
  };
  env.saved = () => Object.values(env.files).filter((f) => f.name !== '_heartbeat.json' && f.parents.length);
  env.heartbeat = () => {
    const hb = Object.values(env.files).filter((f) => f.name === '_heartbeat.json');
    return hb.length ? JSON.parse(hb[0].content) : null;
  };
  return env;
}

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64url');

function msg(id, { from, subject, date, text, html }) {
  const headers = [
    { name: 'From', value: from }, { name: 'Subject', value: subject },
    { name: 'To', value: 'ncssm.yac.yakkety@gmail.com' }
  ];
  let payload;
  if (text && html) {
    payload = { mimeType: 'multipart/alternative', headers, parts: [
      { mimeType: 'text/plain', body: { data: b64(text) } },
      { mimeType: 'text/html', body: { data: b64(html) } }
    ] };
  } else {
    payload = { mimeType: html ? 'text/html' : 'text/plain', headers, body: { data: b64(html || text) } };
  }
  return { id, threadId: 't-' + id, internalDate: String(Date.parse(date)), payload };
}

function saveRun(c) {
  try { vm.runInContext('saveNewsletters()', c); return null; } catch (e) { return e; }
}

const LIVE = { DRY_RUN: 'false', INBOX_FOLDER_ID: 'folder1' };

// Made-up fixtures.
const CONCERT = msg('1a2b3c000000aaa1', {
  from: 'NCSSM Communications <communications@ncssm.edu>', subject: 'Winter concert moves to Durham',
  date: '2026-11-02T18:00:00Z',
  text: 'CONCERT BODY MARKER: the winter concert moves to the Durham hall.',
  html: '<p>CONCERT BODY MARKER: the winter concert moves to the Durham hall.</p>' +
    '<a href="https://www.ncssm.edu/news/winter-concert">Read more</a>' +
    '<a href="https://visitor.constantcontact.com/do?p=un&amp;m=001">Unsubscribe</a>'
});
const PROMO = msg('1a2b3c000000bbb2', {
  from: 'Discount Shop <offers@marketing.example.test>', subject: 'SPECIAL OFFER MARKER',
  date: '2026-11-02T19:00:00Z', text: 'PROMO BODY MARKER: buy now'
});

// ---------------------------------------------------------------------------

console.log('=== scopes and calls ===');

test('the manifest asks for gmail.readonly and drive.file only, with Gmail v1 and Drive v3', () => {
  const m = JSON.parse(fs.readFileSync(path.join(SRC, 'appsscript.json'), 'utf8'));
  assert.deepStrictEqual(m.oauthScopes.slice().sort(), [
    'https://www.googleapis.com/auth/drive.file', 'https://www.googleapis.com/auth/gmail.readonly'
  ]);
  assert.deepStrictEqual(m.dependencies.enabledAdvancedServices.map((s) => [s.userSymbol, s.serviceId, s.version]), [
    ['Gmail', 'gmail', 'v1'], ['Drive', 'drive', 'v3']
  ]);
});

test('the script calls only read or save methods: no Gmail send, modify, trash, label or delete, no Drive delete', () => {
  // Comments are stripped first, so a word in a comment does not count as a call.
  const code = CODE.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');
  const called = new Set();
  for (const m of code.matchAll(/\b(?:Gmail|Drive)((?:\.[A-Za-z]+)+)\s*\(/g)) called.add(m[0].replace(/\s*\($/, ''));
  const allowed = new Set(['Gmail.Users.Messages.list', 'Gmail.Users.Messages.get',
    'Drive.Files.create', 'Drive.Files.list', 'Drive.Files.update', 'Drive.Permissions.create']);
  const extra = [...called].filter((c) => !allowed.has(c));
  assert.deepStrictEqual(extra, [], 'unexpected Gmail/Drive call(s)');
  assert.ok(called.has('Gmail.Users.Messages.list') && called.has('Drive.Files.create'), 'the expected calls are there');
});

console.log('=== practice mode and the saved record ===');

test('practice mode writes no file and no heartbeat even when the inbox folder is set', () => {
  const c = load();
  const env = fakeEnv(c, { props: { INBOX_FOLDER_ID: 'folder1' }, mail: [CONCERT] });
  assert.strictEqual(saveRun(c), null);
  assert.strictEqual(env.created, 0, 'no file created');
  assert.strictEqual(env.updated, 0, 'no heartbeat rewritten');
  assert.strictEqual(env.heartbeat(), null, 'no heartbeat file');
  assert.ok(env.logs.some((l) => l.startsWith('PRACTICE MODE')));
});

test('the saved record has exactly the documented keys, and the collector accepts it', () => {
  const c = load();
  const env = fakeEnv(c, { props: LIVE, mail: [CONCERT] });
  assert.strictEqual(saveRun(c), null);
  const saved = env.saved();
  assert.strictEqual(saved.length, 1);
  const rec = JSON.parse(saved[0].content);
  assert.deepStrictEqual(Object.keys(rec).sort(), ['from', 'fromName', 'id', 'links', 'receivedAt', 'savedAt', 'savedBy',
    'schema', 'source', 'subject', 'text', 'threadId'].sort());
  assert.strictEqual(rec.schema, 1);
  assert.strictEqual(rec.source, 'email');
  assert.ok(/^yac-ncssm-news apps-script v\d+\.\d+\.\d+$/.test(rec.savedBy), rec.savedBy);
  assert.strictEqual(collectorLib.newsletterProblem(rec), '', 'the collector reads the record without complaint');
});

test('the saved file name is the UTC date and the Gmail message id', () => {
  const c = load();
  const env = fakeEnv(c, { props: LIVE, mail: [CONCERT] });
  saveRun(c);
  assert.deepStrictEqual(env.saved().map((f) => f.name), ['2026-11-02_1a2b3c000000aaa1.json']);
});

console.log('=== what is logged and what is cleaned ===');

test('mail from a sender outside the allowed domains: its subject and body are never logged or saved', () => {
  const c = load();
  const env = fakeEnv(c, { props: LIVE, mail: [PROMO, CONCERT] });
  assert.strictEqual(saveRun(c), null);
  const everything = env.logs.join('\n') + '\n' + Object.values(env.files).map((f) => String(f.content)).join('\n');
  assert.ok(!everything.includes('SPECIAL OFFER MARKER') && !everything.includes('PROMO BODY MARKER'), 'ignored mail never appears');
  assert.deepStrictEqual(env.heartbeat().ignored, { 'marketing.example.test': 1 }, 'counted by domain only');
  assert.strictEqual(env.saved().length, 1, 'the NCSSM mail is still saved');
});

test('a plain-text unsubscribe link is removed from the saved text', () => {
  const c = load();
  const text = 'Winter concert details: https://www.ncssm.edu/news/winter-concert\n' +
    'Unsubscribe <https://bbox.blackbaudhosting.com/webforms/service/page.aspx?pid=233&srctid=1>\n' +
    'Unsubscribe here: https://visitor.constantcontact.com/do?p=un&m=001';
  c.__t = text;
  const out = vm.runInContext('cleanText_(__t, 1000)', c);
  assert.ok(out.includes('https://www.ncssm.edu/news/winter-concert'), 'the real link stays');
  assert.ok(!/pid=233|p=un&/.test(out), 'no unsubscribe URL in the text');
});

test('a plain-text "Update Profile" link is never saved', () => {
  // Regression (yac-ncssm-news#12, fixed in v1.3.0). Was: cleanText_ judges each bare URL by the URL alone, so a plain-text
  // "Update Profile <url>" line keeps a Constant Contact update-profile link
  // (do?p=oo). The README and CLAUDE.md promise update-profile links are
  // never saved. The HTML path is fine: extractLinks_ also reads the link text.
  const UPDATE = msg('1a2b3c000000ccc3', {
    from: 'NCSSM Communications <communications@ncssm.edu>', subject: 'Campus update',
    date: '2026-11-02T20:00:00Z',
    text: 'Campus update body.\nUpdate Profile <https://visitor.constantcontact.com/do?p=oo&m=001>',
    html: '<p>Campus update body.</p><a href="https://visitor.constantcontact.com/do?p=oo&amp;m=001">Update Profile</a>'
  });
  const c = load();
  const env = fakeEnv(c, { props: LIVE, mail: [UPDATE] });
  saveRun(c);
  const rec = JSON.parse(env.saved()[0].content);
  assert.ok(!/p=oo/.test(rec.text), 'the update-profile URL is in the saved text: ' + rec.text.replace(/\n/g, ' | '));
  assert.ok(!rec.links.some((l) => /p=oo/.test(l.url)), 'and not in links');
});

test('a plain-text story link next to an update-profile link is kept', () => {
  const c = load();
  c.__t = 'Read more <https://www.ncssm.edu/news/story-1>\nUpdate Profile <https://visitor.constantcontact.com/do?p=oo&m=001> | Story two https://www.ncssm.edu/news/story-2';
  const out = vm.runInContext('cleanText_(__t, 1000)', c);
  assert.ok(out.includes('https://www.ncssm.edu/news/story-1'), out);
  assert.ok(out.includes('https://www.ncssm.edu/news/story-2'), out);
  assert.ok(!/p=oo/.test(out), out);
});

test('a body far over the cap is cut and marked, not saved whole', () => {
  const c = load();
  c.__body = 'word '.repeat(40000);
  const rec = vm.runInContext('buildRecord_({ id: "m", threadId: "t", internalDate: "1793000000000", payload: { headers: [' +
    '{ name: "From", value: "NCSSM <communications@ncssm.edu>" }, { name: "Subject", value: "Long" }] } }, { text: __body, html: "" }, "2026-11-02T00:00:00.000Z", null)', c);
  assert.ok(rec.text.endsWith('[truncated]'));
  assert.ok(rec.text.length <= 100000 + 20, 'length ' + rec.text.length);
});

console.log('=== forwards ===');

test('a forward in Gmail\'s own "Forwarded message" form is saved from the original NCSSM sender', () => {
  const FWD = msg('1a2b3c000000ddd4', {
    from: 'Owner <owner.fake@example.test>', subject: 'Fwd: NCSSM-Durham Update', date: '2026-11-02T21:00:00Z',
    text: 'FYI\n\n---------- Forwarded message ---------\nFrom: Jordan Ellis <jordan.ellis@ncssm.edu>\nTo: Owner <owner.fake@example.test>\n\nDURHAM BODY MARKER'
  });
  const c = load();
  const env = fakeEnv(c, { props: Object.assign({ FORWARD_SENDERS: 'owner.fake@example.test' }, LIVE), mail: [FWD] });
  assert.strictEqual(saveRun(c), null);
  const rec = JSON.parse(env.saved()[0].content);
  assert.strictEqual(rec.from, 'jordan.ellis@ncssm.edu');
  assert.ok(rec.text.includes('DURHAM BODY MARKER'));
  assert.ok(!JSON.stringify(rec).includes('owner.fake@example.test'), 'the forwarder is not saved');
});

test('a forward in Apple Mail\'s "Begin forwarded message" form is saved, not silently dropped', () => {
  // Regression (yac-ncssm-news#12, fixed in v1.3.0). Was: forwardedOriginalSender_ only knows the Gmail header form
  // ("---------- Forwarded message ---------"). An Apple Mail forward has
  // "Begin forwarded message:" and is ignored, and the heartbeat reports it as
  // "forward (not from NCSSM)" although the original sender is NCSSM.
  const APPLE = msg('1a2b3c000000eee5', {
    from: 'Owner <owner.fake@example.test>', subject: 'Fwd: NCSSM-Durham Update', date: '2026-11-02T22:00:00Z',
    text: 'FYI\n\nBegin forwarded message:\n\nFrom: Jordan Ellis <jordan.ellis@ncssm.edu>\nSubject: NCSSM-Durham Update\n\nAPPLE BODY MARKER'
  });
  const c = load();
  const env = fakeEnv(c, { props: Object.assign({ FORWARD_SENDERS: 'owner.fake@example.test' }, LIVE), mail: [APPLE] });
  saveRun(c);
  assert.strictEqual(env.saved().length, 1, 'the NCSSM newsletter was not saved; heartbeat: ' + JSON.stringify(env.heartbeat().ignored));
});

test('a forwarded note that is not from NCSSM is never saved', () => {
  const PRIVATE = msg('1a2b3c000000fff6', {
    from: 'Owner <owner.fake@example.test>', subject: 'Fwd: lunch', date: '2026-11-02T23:00:00Z',
    text: '---------- Forwarded message ---------\nFrom: A Friend <friend.fake@example.test>\n\nPRIVATE NOTE MARKER'
  });
  const c = load();
  const env = fakeEnv(c, { props: Object.assign({ FORWARD_SENDERS: 'owner.fake@example.test' }, LIVE), mail: [PRIVATE] });
  saveRun(c);
  assert.strictEqual(env.saved().length, 0);
  assert.ok(!env.logs.join('\n').includes('PRIVATE NOTE MARKER'));
});

console.log('=== bad input and failure paths ===');

test('a message with no payload is one counted error; the others are still saved', () => {
  const c = load();
  const env = fakeEnv(c, { props: LIVE, mail: [{ id: '1a2b3c000000gg07' }, CONCERT] });
  const err = saveRun(c);
  assert.ok(err && /1 message\(s\) failed/.test(err.message), 'the run reports the failure');
  assert.strictEqual(env.saved().length, 1, 'the good message is saved');
  assert.strictEqual(env.heartbeat().errors, 1);
});

test('signup and confirmation mail from an NCSSM sender is skipped and counted, not saved', () => {
  const SIGNUP = msg('1a2b3c000000hh08', {
    from: 'NCSSM <communications@ncssm.edu>', subject: 'Email Signup Confirmation', date: '2026-11-02T10:00:00Z',
    html: '<p>Thanks for signing up!</p>'
  });
  const c = load();
  const env = fakeEnv(c, { props: LIVE, mail: [SIGNUP] });
  assert.strictEqual(saveRun(c), null);
  assert.strictEqual(env.saved().length, 0);
  assert.strictEqual(env.heartbeat().skipped, 1);
  assert.deepStrictEqual(env.heartbeat().ignored, {}, 'not an ignored sender');
});

test('a Drive error while listing the folder stops the run before any mail is read', () => {
  const c = load();
  const env = fakeEnv(c, { props: LIVE, mail: [CONCERT], driveListError: 'Drive is unavailable' });
  const err = saveRun(c);
  assert.ok(err && /Drive is unavailable/.test(err.message));
  assert.strictEqual(env.gets.length, 0, 'no message fetched');
  assert.strictEqual(env.created, 0);
});

test('a Gmail error that stops the whole run still leaves the heartbeat saying so', () => {
  // Regression (yac-ncssm-news#12, fixed in v1.3.0). Was: the file header promises that every live run rewrites
  // _heartbeat.json with its errors. When Gmail itself fails the run throws
  // before the heartbeat is written, so the folder keeps yesterday's heartbeat
  // (no error). The collector only notices after 30 hours, and the failure
  // e-mail from Apps Script goes to an inbox no person reads.
  const c = load();
  const old = JSON.stringify({ schema: 1, lastRun: '2026-11-14T05:00:00.000Z', errors: 0 });
  const env = fakeEnv(c, { props: LIVE, mail: [CONCERT], listError: 'Gmail is unavailable',
    existing: [{ name: '_heartbeat.json', parents: ['folder1'], content: old }] });
  const err = saveRun(c);
  assert.ok(err, 'the run fails');
  const hb = env.heartbeat();
  assert.ok(hb.lastRun !== '2026-11-14T05:00:00.000Z' || hb.errors > 0,
    'heartbeat still says lastRun ' + hb.lastRun + ', errors ' + hb.errors);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed');
process.exit(failed ? 1 : 0);
