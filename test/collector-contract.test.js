// The collector's output contract (items.json, as the ncssm-news skill reads
// it), its idempotence, what a network failure does, and that no key leaks.
// Fake web and fake Drive only; all content is made up.
//   node test/collector-contract.test.js
'use strict';

const assert = require('assert');
const { collect } = require('../collector/run');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n     ')); }
}

// Made-up pages, shaped like ncssm.edu and Google News.
const NEWS = '<h2 class="title"><a href="https://www.ncssm.edu/news/robotics-story" class="link">Robotics team wins</a></h2>' +
  '<time class="date" datetime="2026-10-15">October 15, 2026</time>';
const ARTICLE = '<html><body><h1>Robotics team wins</h1><main><p>The robotics team took first place at the state finals, the school\'s third title in five years.</p></main></body></html>';
const EVENTS = '<h2 class="title"><a href="https://www.ncssm.edu/events/alumni-weekend" class="link">Alumni Weekend</a></h2>';
const EVENT = '<html><body><h1>Alumni Weekend</h1><div class="event-info"><p class="date icon"><svg></svg><span>October 16 &#8211; 18, 2026</span></p>' +
  '<p class="location icon"><svg></svg><span class="location">NCSSM-Durham<span class="address"></span></span></p></div>' +
  '<main><p>Reunions, tours and a lecture by the chancellor for every alumnus who can make it back to campus.</p></main></body></html>';
const GNEWS = '<?xml version="1.0"?><rss><channel><title>x</title><item><title>NCSSM students record a food drive - Example TV</title>' +
  '<link>https://news.google.com/rss/articles/AAA</link><pubDate>Thu, 15 Oct 2026 12:00:00 GMT</pubDate>' +
  '<source url="https://tv.test">Example TV</source></item></channel></rss>';

const ROUTES = {
  'https://www.ncssm.edu/news': NEWS,
  'https://www.ncssm.edu/news/robotics-story': ARTICLE,
  'https://www.ncssm.edu/events': EVENTS,
  'https://www.ncssm.edu/events/alumni-weekend': EVENT,
  'https://news.google.com/rss/search*': GNEWS
};

// Newsletter record as the Apps Script saves it (schema 1).
const REC = (over) => Object.assign({
  schema: 1, source: 'email', id: 'm1', threadId: 't1', receivedAt: '2026-10-14T20:00:00.000Z',
  from: 'communications@ncssm.edu', fromName: 'NCSSM', subject: 'Catalyst: made-up newsletter',
  text: 'From the chancellor\nMade-up newsletter body.',
  links: [{ text: 'Niche', url: 'https://bbox.blackbaudhosting.com/webforms/service/page.redir?target=https%3a%2f%2fwww.niche.com%2fk12%2f&srcid=1' }],
  savedAt: '2026-10-15T01:00:00.000Z', savedBy: 'test'
}, over);

const NOW = Date.parse('2026-10-18T15:00:00Z');
const HEALTHY = { schema: 1, version: '1.2.0', lastRun: '2026-10-18T14:00:00.000Z', errors: 0 };

// A fake web. `routes` maps an exact URL (or a 'prefix*') to a body, or to
// { status, body } for an error. `failAll` makes every request throw.
function web(routes = ROUTES, { failAll = false } = {}) {
  const fetch = async (url) => {
    if (failAll) throw new TypeError('fetch failed');
    const u = String(url);
    const key = Object.keys(routes).find((k) => (k.endsWith('*') ? u.startsWith(k.slice(0, -1)) : u.split('?')[0] === k));
    if (key === undefined) return { ok: false, status: 404, headers: new Map(), text: async () => '' };
    const r = routes[key];
    const status = typeof r === 'object' ? r.status : 200;
    const body = typeof r === 'object' ? r.body : r;
    return { ok: status < 400, status, headers: new Map(), text: async () => body };
  };
  return fetch;
}

// A fake inbox: `files` is [{ name, rec }], plus the heartbeat.
function inbox(files = [], heartbeat = HEALTHY) {
  const store = { hb: heartbeat };
  const list = files.map((f, i) => { store['id' + i] = f.rec; return { id: 'id' + i, name: f.name }; });
  if (heartbeat) list.push({ id: 'hb', name: '_heartbeat.json' });
  return { connect: async () => ({ listFolder: async () => list, readJson: async (id) => store[id] }) };
}

const ENV = { YAKKETY_GOOGLE_KEY: 'unused-in-tests', NCSSM_NEWS_INBOX_FOLDER_ID: 'folder1' };
const run = (opts) => collect(Object.assign({ env: ENV, now: NOW, fetch: web(), sleep: async () => {}, log: () => {},
  connect: inbox([{ name: '2026-10-14_m1.json', rec: REC() }]).connect }, opts));

(async () => {
  await test('items.json has the shape the skill reads: sources, counts and items', async () => {
    const r = await run();
    assert.strictEqual(r.schema, 1);
    assert.strictEqual(typeof r.generatedAt, 'string');
    assert.strictEqual(r.today, '2026-10-18');
    assert.deepStrictEqual(Object.keys(r.window).sort(), ['ahead', 'days', 'newsletterDays']);
    for (const [name, s] of Object.entries(r.sources)) {
      assert.strictEqual(typeof s.ok, 'boolean', name + ' has ok');
      if (!s.ok) assert.strictEqual(typeof s.error, 'string', name + ' says why');
    }
    assert.deepStrictEqual(Object.keys(r.sources).sort(), ['google-news', 'ncssm.edu/events', 'ncssm.edu/news', 'newsletters']);
    assert.deepStrictEqual(Object.keys(r.counts).sort(), ['article', 'duplicates', 'event', 'newsletter', 'outOfWindow']);
    assert.ok(Array.isArray(r.items));
  });

  await test('every item has the fields the skill needs for its kind', async () => {
    const r = await run();
    const kinds = new Set(r.items.map((i) => i.kind));
    assert.deepStrictEqual([...kinds].sort(), ['article', 'event', 'newsletter']);
    for (const i of r.items) {
      assert.ok(['article', 'event', 'newsletter'].includes(i.kind), 'kind ' + i.kind);
      assert.ok(typeof i.title === 'string' && i.title.length > 0, 'title');
      assert.strictEqual(typeof i.textFetched, 'boolean', 'textFetched');
      assert.strictEqual(typeof i.text, 'string', 'text');
      assert.ok(/^[aen][0-9a-f]{10}$/.test(i.id), 'id ' + i.id);
    }
    for (const a of r.items.filter((i) => i.kind === 'article')) {
      assert.ok(/^https?:\/\//.test(a.url), 'article url');
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(a.published), 'article published day');
    }
    for (const e of r.items.filter((i) => i.kind === 'event')) {
      assert.ok(/^https?:\/\//.test(e.url), 'event url');
      assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(e.start) && /^\d{4}-\d{2}-\d{2}$/.test(e.end), 'event dates');
    }
    const n = r.items.find((i) => i.kind === 'newsletter');
    assert.ok(typeof n.from === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(n.receivedAt), 'newsletter sender and time');
    assert.strictEqual(n.textFetched, true);
    assert.ok(Array.isArray(n.links) && n.links.every((l) => typeof l.text === 'string' && typeof l.url === 'string' && typeof l.resolved === 'boolean'), 'links');
  });

  await test('the counts agree with the items', async () => {
    const r = await run();
    for (const kind of ['newsletter', 'article', 'event']) {
      assert.strictEqual(r.counts[kind], r.items.filter((i) => i.kind === kind).length, kind);
    }
    assert.strictEqual(r.counts.newsletter + r.counts.article + r.counts.event, r.items.length);
  });

  await test('a second run over the same web and inbox gives the same items (stateless, no duplicates)', async () => {
    const a = await run();
    const b = await run();
    const strip = (r) => JSON.stringify(Object.assign({}, r, { generatedAt: null }));
    assert.strictEqual(strip(b), strip(a));
    assert.strictEqual(new Set(a.items.map((i) => i.id)).size, a.items.length, 'no item id appears twice');
  });

  await test('a network failure on every request is a failed source, not a crash', async () => {
    const r = await run({ fetch: web(ROUTES, { failAll: true }) });
    assert.strictEqual(r.sources['ncssm.edu/news'].ok, false);
    assert.ok(/answered/.test(r.sources['ncssm.edu/news'].error), r.sources['ncssm.edu/news'].error);
    assert.strictEqual(r.sources['ncssm.edu/events'].ok, false);
    assert.strictEqual(r.sources['google-news'].ok, false);
    assert.strictEqual(r.sources.newsletters.ok, true, 'the inbox is read separately and still works');
    assert.deepStrictEqual(r.items.map((i) => i.kind), ['newsletter']);
  });

  await test('an event page that cannot be read is reported, not dropped silently', async () => {
    // Tool bug: ncssmEvents skips an event page that fails to load (`if (!page.ok) return;`)
    // without counting it. The source reports ok with no mention of the missing
    // event, unlike articles, whose unread pages are counted in the source note.
    const routes = Object.assign({}, ROUTES, { 'https://www.ncssm.edu/events/alumni-weekend': { status: 500, body: '' } });
    const r = await run({ fetch: web(routes), noDrive: true });
    assert.strictEqual(r.counts.event, 0);
    const note = r.sources['ncssm.edu/events'].note || '';
    assert.ok(/could not be read|unreadable|without text|not read/.test(note), 'the events note says a page was missed; note: "' + note + '"');
  });

  await test('a key that is not JSON, or cannot sign, never shows up in the output or the log', async () => {
    const logs = [];
    const bad = ['{"client_email":"yakkety@example.test","private_key":"-----BEGIN PRIVATE KEY-----SECRETFRAGMENT',
      JSON.stringify({ client_email: 'yakkety@example.test', private_key: '-----BEGIN PRIVATE KEY-----SECRETFRAGMENT-not-a-key' })];
    for (const key of bad) {
      const r = await collect({ env: { YAKKETY_GOOGLE_KEY: key, NCSSM_NEWS_INBOX_FOLDER_ID: 'folder1' }, now: NOW,
        fetch: web(), sleep: async () => {}, log: (m) => logs.push(String(m)) });
      assert.strictEqual(r.sources.newsletters.ok, false, 'the inbox fails without a usable key');
      assert.ok(!JSON.stringify(r).includes('SECRETFRAGMENT') && !logs.join('\n').includes('SECRETFRAGMENT'), 'the key fragment leaked');
    }
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
