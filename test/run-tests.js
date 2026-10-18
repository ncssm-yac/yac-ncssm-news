// Runs the Apps Script tests locally in Node, with no dependencies.
// Loads the .gs files into one vm context (like the Apps Script global scope),
// runs runTests() for the pure logic, then runs saveNewsletters() and setup()
// end to end against a fake Gmail, Drive, Utilities, Properties and Lock.
// All mail here is made up.

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const SRC = path.join(__dirname, '..', 'apps-script');
const FILES = ['Code.gs', 'Tests.gs'];

function load() {
  const context = vm.createContext({ Logger: { log: () => {} }, console });
  for (const file of FILES) {
    vm.runInContext(fs.readFileSync(path.join(SRC, file), 'utf8'), context, { filename: file });
  }
  return context;
}

let failed = false;

console.log('=== runTests (pure logic) ===');
try {
  const c = load();
  c.Logger = { log: console.log };
  vm.runInContext('runTests()', c);
} catch (e) {
  console.error('runTests failed: ' + e.message);
  failed = true;
}

// The header comment must not carry a version of its own: it went stale once
// (v1.0.0 above VERSION = '1.0.1'), and the heartbeat is how a pasted copy is
// told from the repo's.
console.log('=== version ===');
{
  const src = fs.readFileSync(path.join(SRC, 'Code.gs'), 'utf8');
  const header = src.slice(0, src.indexOf('*/'));
  const stale = header.match(/\bv?\d+\.\d+\.\d+\b/);
  if (stale) { console.error('FAIL: the header comment hard-codes a version (' + stale[0] + '); VERSION is the only place'); failed = true; }
  else console.log('PASS the header carries no version of its own');
  const m = src.match(/^var VERSION = '(\d+\.\d+\.\d+)';/m);
  if (!m) { console.error('FAIL: no VERSION constant'); failed = true; }
  else console.log('PASS VERSION is ' + m[1]);
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const b64url = (s) => Buffer.from(s, 'utf8').toString('base64url');

function fakeEnv(c, { props = {}, mail = [], lockFree = true, failGet = [], pageSize = 100, drive } = {}) {
  const env = { props, logs: [], drive: drive || { files: {}, perms: [], nextId: 1 }, gets: [] };
  c.Logger = { log: (m) => env.logs.push(String(m)) };
  c.LockService = { getScriptLock: () => ({ tryLock: () => lockFree, releaseLock: () => {} }) };
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
    list: (user, opts) => {
      const start = opts.pageToken ? Number(opts.pageToken) : 0;
      const page = mail.slice(start, start + pageSize).map((m) => ({ id: m.id }));
      const next = start + pageSize < mail.length ? String(start + pageSize) : undefined;
      env.lastQuery = opts.q;
      return { messages: page, nextPageToken: next };
    },
    get: (user, id) => {
      env.gets.push(id);
      if (failGet.includes(id)) throw new Error('Gmail is having a moment');
      return mail.find((m) => m.id === id);
    }
  } } };
  const d = env.drive;
  c.Drive = {
    Files: {
      create: (meta, blob) => {
        const id = 'f' + d.nextId++;
        d.files[id] = { id, name: meta.name, mimeType: meta.mimeType, parents: meta.parents || [], content: blob ? blob.getDataAsString() : null };
        return { id };
      },
      list: (opts) => {
        const parent = opts.q.match(/^'([^']+)' in parents/)[1];
        return { files: Object.values(d.files).filter((f) => f.parents.includes(parent)).map((f) => ({ id: f.id, name: f.name })) };
      },
      update: (meta, id, blob) => { d.files[id].content = blob.getDataAsString(); return { id }; }
    },
    Permissions: { create: (perm, fileId, opts) => { d.perms.push({ perm, fileId, opts }); return {}; } }
  };
  env.inFolder = (folderId) => Object.values(d.files).filter((f) => f.parents.includes(folderId));
  env.json = (folderId) => env.inFolder(folderId).filter((f) => f.name !== '_heartbeat.json');
  env.heartbeat = (folderId) => {
    const hb = env.inFolder(folderId).filter((f) => f.name === '_heartbeat.json');
    return hb.length === 1 ? JSON.parse(hb[0].content) : hb.length;
  };
  return env;
}

function message(id, { from, subject, date, text, html, bytes = false }) {
  const enc = (s) => (bytes ? Array.from(Buffer.from(s, 'utf8')) : b64url(s));
  const headers = [{ name: 'From', value: from }, { name: 'Subject', value: subject }, { name: 'To', value: 'ncssm.yac.yakkety@gmail.com' }];
  let payload;
  if (text && html) {
    payload = { mimeType: 'multipart/alternative', headers, parts: [
      { mimeType: 'text/plain', body: { data: enc(text) } },
      { mimeType: 'text/html', body: { data: enc(html) } }
    ] };
  } else {
    payload = { mimeType: html ? 'text/html' : 'text/plain', headers, body: { data: enc(html || text) } };
  }
  return { id, threadId: 't-' + id, internalDate: String(Date.parse(date)), payload };
}

const CATALYST = message('1a11d4e415ebfb2b', {
  from: 'NCSSM <communications@ncssm.edu>', subject: 'Catalyst: Alumni annual meeting, #1 public high school',
  date: '2026-10-08T20:55:48Z',
  html: '<p>From Chancellor Roberts</p><p>NCSSM is No. 1 again – for 2027.</p>' +
    '<a href="https://bbox.blackbaudhosting.com/webforms/service/page.redir?target=https%3a%2f%2fwww.niche.com%2f&amp;srcid=1">Niche</a>' +
    '<a href="https://bbox.blackbaudhosting.com/webforms/service/page.aspx?pid=233&amp;srctid=1">Unsubscribe</a>'
});
const MORGANTON = message('1a0cdeec8bf1859f', {
  from: '"Kevin Baxter" <kevin.baxter@ncssm.edu>', subject: 'NCSSM-Morganton Update', date: '2026-09-23T11:02:52Z',
  text: 'Greetings, Family Day was a hit! Learn more. Unsubscribe <https://visitor.constantcontact.com/do?p=un&m=1>',
  html: '<div>Family Day was a hit!</div><a href="https://r20.rs6.net/tn.jsp?f=001">Learn more.</a>' +
    '<a href="https://visitor.constantcontact.com/do?p=un&amp;m=1">Unsubscribe</a>',
  bytes: true
});
const BOARD = message('1a0c60ac085472de', {
  from: 'winslow@ncssm.edu', subject: '[NCSSM FBOD] NCSSM Leadership Update', date: '2026-09-21T22:15:00Z',
  text: 'PRIVATE BOARD CONTENT'
});
const PERSONAL = message('1a0000000000aaaa', {
  from: 'A Friend <friend@gmail.com>', subject: 'hi', date: '2026-10-01T10:00:00Z', text: 'PERSONAL CONTENT'
});
const SIGNUP = message('1a13ca64a2b943a0', {
  from: 'NCSSM <communications@ncssm.edu>', subject: 'Email Signup Confirmation', date: '2026-10-14T23:10:00Z',
  html: '<p>Thanks for signing up!</p><a href="https://lp.constantcontactpages.com/confirm?x=1">Confirm</a>'
});
const CONFIRM = message('1a0000000000bbbb', {
  from: 'NCSSM <confirmations@constantcontact.com>', subject: 'Please confirm', date: '2026-10-14T10:00:00Z', text: 'Confirm'
});

// ---------------------------------------------------------------------------
// End-to-end checks
// ---------------------------------------------------------------------------

console.log('=== saveNewsletters / setup end to end ===');
let pass = 0;
let fail = 0;
function check(cond, name) {
  if (cond) pass++; else { fail++; console.error('FAIL: ' + name); }
}
function run(c, fn) {
  try { vm.runInContext(fn + '()', c); return null; } catch (e) { return e; }
}

// 1. Practice mode by default: reads, saves nothing, needs no folder.
{
  const c = load();
  const env = fakeEnv(c, { mail: [CATALYST, BOARD] });
  const err = run(c, 'saveNewsletters');
  check(err === null, 'practice run without a folder does not throw');
  check(Object.keys(env.drive.files).length === 0, 'practice run writes nothing to Drive');
  check(env.logs.some((l) => l.startsWith('PRACTICE MODE')), 'practice run says so');
  check(env.logs.some((l) => l.includes('[DRY-RUN] Would save 2026-10-08_1a11d4e415ebfb2b.json')), 'practice run logs what it would save');
  check(env.lastQuery === 'newer_than:14d', 'searches the lookback window');
}

// 2. Live without setup() refuses.
{
  const c = load();
  fakeEnv(c, { props: { DRY_RUN: 'false' }, mail: [CATALYST] });
  const err = run(c, 'saveNewsletters');
  check(err && /Run setup\(\) first/.test(err.message), 'live run without a folder asks for setup()');
}

// 3. setup() creates the folder once and shares it with the service account.
let shared;
{
  const c = load();
  const env = fakeEnv(c);
  check(run(c, 'setup') === null, 'setup runs');
  check(run(c, 'setup') === null, 'setup runs again');
  const folders = Object.values(env.drive.files).filter((f) => f.mimeType === 'application/vnd.google-apps.folder');
  check(folders.length === 1 && folders[0].name === 'NCSSM News inbox', 'one folder, created once');
  check(env.props.INBOX_FOLDER_ID === folders[0].id, 'folder ID stored');
  check(env.drive.perms.length === 2 && env.drive.perms.every((p) =>
    p.perm.role === 'reader' && p.perm.type === 'user' && p.perm.emailAddress === 'yakkety@ncssm-yac.iam.gserviceaccount.com' &&
    p.fileId === folders[0].id && p.opts.sendNotificationEmail === false), 'yakkety service account gets Viewer, no email');
  shared = env;
}

// 4. Live run saves only allowlisted senders, cleanly.
{
  const c = load();
  const env = fakeEnv(c, { props: { DRY_RUN: 'false', INBOX_FOLDER_ID: 'folder1' }, mail: [CATALYST, MORGANTON, BOARD, PERSONAL, CONFIRM, SIGNUP] });
  check(run(c, 'saveNewsletters') === null, 'live run succeeds');
  const saved = env.json('folder1');
  check(saved.map((f) => f.name).sort().join(',') === '2026-09-23_1a0cdeec8bf1859f.json,2026-10-08_1a11d4e415ebfb2b.json', 'saves Catalyst and Morganton only');
  const all = Object.values(env.drive.files).map((f) => f.content).join('\n');
  check(!all.includes('PRIVATE BOARD CONTENT') && !all.includes('PERSONAL CONTENT'), 'no ignored mail content in Drive');
  check(!/pid=233|p=un|visitor\.constantcontact\.com/i.test(all), 'no unsubscribe link in Drive');
  check(!all.includes('Thanks for signing up'), 'signup receipt not saved');
  check(!all.includes('ncssm.yac.yakkety@gmail.com'), 'recipient address not saved');
  const cat = JSON.parse(saved.find((f) => f.name.includes('1a11d4')).content);
  check(cat.from === 'communications@ncssm.edu' && cat.subject.startsWith('Catalyst') && cat.text.includes('No. 1 again – for 2027'), 'Catalyst record (UTF-8 kept)');
  check(cat.links.length === 1 && cat.links[0].text === 'Niche', 'Catalyst links');
  const mor = JSON.parse(saved.find((f) => f.name.includes('1a0cde')).content);
  check(mor.text.startsWith('Greetings, Family Day') && mor.links[0].url === 'https://r20.rs6.net/tn.jsp?f=001', 'Morganton: plain text preferred, byte-array bodies decoded');
  const hb = env.heartbeat('folder1');
  check(hb.saved === 2 && hb.skipped === 1 && hb.seen === 6 && hb.alreadySaved === 0 && hb.errors === 0, 'heartbeat counts');
  check(JSON.stringify(hb.ignored) === JSON.stringify({ 'winslow@ncssm.edu': 1, 'gmail.com': 1, 'constantcontact.com': 1 }), 'heartbeat ignored: NCSSM senders in full, others by domain');

  // 5. A second run saves nothing new and rewrites the one heartbeat.
  check(run(c, 'saveNewsletters') === null, 'second run succeeds');
  check(env.json('folder1').length === 2, 'second run saves nothing twice');
  const hb2 = env.heartbeat('folder1');
  check(hb2.saved === 0 && hb2.alreadySaved === 2, 'second heartbeat: already saved');
  check(env.gets.filter((id) => id === CATALYST.id).length === 1, 'saved messages are not fetched again');
}

// 6. A failed message is reported, the rest still saved, and it is retried next run.
{
  const c = load();
  const mail = [CATALYST, MORGANTON];
  const env = fakeEnv(c, { props: { DRY_RUN: 'false', INBOX_FOLDER_ID: 'folder1' }, mail, failGet: [CATALYST.id] });
  const err = run(c, 'saveNewsletters');
  check(err && /1 message\(s\) failed/.test(err.message), 'run throws after a failure (Apps Script records it)');
  check(env.json('folder1').length === 1, 'other message still saved');
  const hb = env.heartbeat('folder1');
  check(hb.errors === 1 && hb.errorSamples[0].includes(CATALYST.id), 'heartbeat written before throwing, with the error');
  const env2 = fakeEnv(c, { props: env.props, mail, drive: env.drive });
  check(run(c, 'saveNewsletters') === null, 'next run succeeds');
  check(env2.json('folder1').length === 2, 'failed message saved on retry');
  check(env2.heartbeat('folder1').errors === 0, 'heartbeat clears the error');
}

// 7. A run that finds the lock taken does nothing.
{
  const c = load();
  const env = fakeEnv(c, { props: { DRY_RUN: 'false', INBOX_FOLDER_ID: 'folder1' }, mail: [CATALYST], lockFree: false });
  check(run(c, 'saveNewsletters') === null, 'locked run returns quietly');
  check(Object.keys(env.drive.files).length === 0 && env.gets.length === 0, 'locked run touches nothing');
}

// 8. Pagination, and stopping early under the time limit.
{
  const c = load();
  const env = fakeEnv(c, { props: { DRY_RUN: 'false', INBOX_FOLDER_ID: 'folder1' }, mail: [CATALYST, MORGANTON, BOARD], pageSize: 1 });
  check(run(c, 'saveNewsletters') === null && env.json('folder1').length === 2, 'reads every page of results');
  const c2 = load();
  const env2 = fakeEnv(c2, { props: { DRY_RUN: 'false', INBOX_FOLDER_ID: 'folder1' }, mail: [CATALYST] });
  vm.runInContext('MAX_RUN_MS = -1', c2);
  check(run(c2, 'saveNewsletters') === null, 'out-of-time run succeeds');
  const hb = env2.heartbeat('folder1');
  check(hb.stoppedEarly === true && hb.saved === 0 && env2.json('folder1').length === 0, 'out-of-time run stops and says so');
}

check(shared !== undefined, 'setup scenario ran');

console.log(pass + '/' + (pass + fail) + ' end-to-end checks passed.');
if (fail > 0) failed = true;
process.exit(failed ? 1 : 0);
