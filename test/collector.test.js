// Tests for the collector: parsers on made-up pages shaped like the real ones,
// then whole runs against a fake web and a fake Drive. No network, no secrets.
//   node test/collector.test.js
'use strict';

const assert = require('assert');
const lib = require('../collector/lib');
const { collect, parseArgs } = require('../collector/run');
const google = require('../collector/google');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n     ')); }
}

// ---------------------------------------------------------------------------
// Made-up pages (structure copied from ncssm.edu, content invented)
// ---------------------------------------------------------------------------

const NEWS_PAGE = `
<div class="partial news-feature -primary"><div class="feature-text">
  <p class="is-style-small-heading">news</p>
  <h2 class="title"><a href="https://www.ncssm.edu/news/robotics-team-wins-state" class="link">Robotics team wins state title</a></h2>
  <time class="date" datetime="2026-10-15">October 15, 2026</time></div></div>
<div class="partial news-feature"><div class="feature-text">
  <p class="is-style-small-heading">news</p>
  <h2 class="title"><a href="https://www.ncssm.edu/news/old-story" class="link">An older story</a></h2>
  <time class="date" datetime="2026-06-11">June 11, 2026</time></div></div>
<div class="nmc-slide"><div class="partial -outside-media-card"><div class="text">
  <p class="is-style-small-heading">Media</p>
  <h2 class="title"> <a href="https://example-news.test/2026/10/12/alum-wins-prize/" class="link" target="_blank"> Alum wins national prize </a> </h2>
  <p class="source">Example News </p></div></div></div>
<div class="nmc-slide"><div class="partial -outside-media-card"><div class="text">
  <p class="is-style-small-heading">Media</p>
  <h2 class="title"> <a href="https://other.test/story-without-date" class="link" target="_blank"> A story nobody dated </a> </h2>
  <p class="source">Other Times</p></div></div></div>`;

const ARTICLE_PAGE = (title, date) => `<html><head><meta property="og:description" content="" />
<script type="application/ld+json">{"@type":"Article","headline":"${title}","datePublished":"${date}"}</script></head>
<body><h1 class="masthead-title">${title}</h1>
<main><p>Short byline</p>
<p>The robotics team from NCSSM-Durham took first place at the state finals this weekend, the school's third title in five years.</p>
<p>Coaches said the team rebuilt its main mechanism overnight after a failed qualifier, which made the final run possible.</p>
<script>var ignored = "this paragraph is script text that should never appear in output";</script></main>
<footer><p>Footer text that is long enough to count as a paragraph but belongs to the footer.</p></footer></body></html>`;

const OUTSIDE_PAGE = `<html><head><meta property="article:published_time" content="2026-10-12T14:00:00-04:00" /></head>
<body><main><p>An NCSSM alumnus won a national prize for research on soil bacteria, the awarding foundation announced on Tuesday.</p></main></body></html>`;

const EVENTS_PAGE = `
<h2 class="title"><a href="https://www.ncssm.edu/events/alumni-weekend-2026" class="link">Alumni Weekend 2026</a></h2>
<h2 class="title"><a href="https://www.ncssm.edu/events/open-house-morganton" class="link">Open House (Morganton)</a></h2>
<h2 class="title"><a href="https://www.ncssm.edu/events/summer-camp-2027" class="link">Summer Camp</a></h2>
<h2 class="title"><a href="https://www.ncssm.edu/events/last-month-concert" class="link">Concert That Already Happened</a></h2>
<a href="https://www.ncssm.edu/events/alumni-weekend-2026">Alumni Weekend 2026 again</a>`;

const EVENT_PAGE = (title, when, where, link) => `<html><body><h1 class="masthead-title">${title}</h1>
<div class="event-info"><p class="date icon"><svg></svg><span>${when}</span></p>
<p class="location icon"><svg></svg><span class="location">${where}<span class="address"></span></span></p>
${link ? `<div class="event-link"><a href="${link}" class="btn">Learn more</a></div>` : ''}</div>
<main><p>Join us for a weekend of reunions, tours and a lecture by the chancellor, open to all alumni who can make it.</p></main>
<footer></footer></body></html>`;

const rssItem = (title, outlet, url, pub, srcUrl) => `<item><title>${title} - ${outlet}</title><link>${url}</link><pubDate>${pub}</pubDate><source url="${srcUrl}">${outlet}</source></item>`;
const RSS = (items) => `<?xml version="1.0"?><rss><channel><title>x</title>${items.join('')}</channel></rss>`;
const GNEWS_NCSSM = RSS([
  rssItem('NCSSM students record a food drive', 'Example TV', 'https://news.google.com/rss/articles/AAA', 'Thu, 08 Oct 2026 12:00:00 GMT', 'https://tv.test'),
  rssItem('NCSSM Girls Varsity Volleyball Schedule', 'MaxPreps', 'https://news.google.com/rss/articles/BBB', 'Thu, 08 Oct 2026 12:00:00 GMT', 'https://www.maxpreps.com'),
  rssItem('Watch Live: NCSSM vs Triangle Academy', 'NFHS Network', 'https://news.google.com/rss/articles/CCC', 'Wed, 07 Oct 2026 12:00:00 GMT', 'https://www.nfhsnetwork.com'),
  rssItem('NCSSM tennis shuts out Piedmont', 'https://www.thepaper.test/', 'https://news.google.com/rss/articles/DDD', 'Sat, 26 Sep 2026 12:00:00 GMT', 'https://www.thepaper.test/'),
  rssItem('Robotics team wins state title', 'Example TV', 'https://news.google.com/rss/articles/EEE', 'Thu, 15 Oct 2026 12:00:00 GMT', 'https://tv.test')
]);
const GNEWS_ALUMNI = RSS([
  rssItem('Former NCSSM student named Rhodes finalist', 'Example Gazette', 'https://news.google.com/rss/articles/FFF', 'Mon, 12 Oct 2026 12:00:00 GMT', 'https://gazette.test'),
  rssItem('NCSSM students record a food drive', 'Example TV', 'https://news.google.com/rss/articles/AAA', 'Thu, 08 Oct 2026 12:00:00 GMT', 'https://tv.test')
]);

// Newsletter records, as saved by apps-script/ (schema 1)
const rec = (over) => Object.assign({
  schema: 1, source: 'email', id: 'm1', threadId: 't1', receivedAt: '2026-10-08T20:55:48.000Z', from: 'communications@ncssm.edu', fromName: 'NCSSM',
  subject: 'Catalyst: Alumni annual meeting', text: 'From Chancellor Roberts\nNCSSM is No. 1 again.',
  links: [
    { text: 'Niche', url: 'https://bbox.blackbaudhosting.com/webforms/service/page.redir?target=https%3a%2f%2fwww.niche.com%2fk12%2f&srcid=1' },
    { text: 'Learn more', url: 'https://r20.rs6.net/tn.jsp?f=001abc' },
    { text: 'Gone', url: 'https://r20.rs6.net/tn.jsp?f=001dead' },
    { text: 'Plain', url: 'https://alumni.ncssm.edu/e/alumni-weekend' }
  ], savedAt: '2026-10-09T01:00:00.000Z', savedBy: 'test'
}, over);

const NOW = Date.parse('2026-10-18T15:00:00Z'); // Sunday, Oct 18 (New York)
const KEY = JSON.stringify({ client_email: 'test@example.iam.gserviceaccount.com', private_key: require('crypto').generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' }) });

// A fake web: exact URL -> response, with call counting.
function fakeWeb(routes, { flaky = {} } = {}) {
  const calls = [];
  const fetch = async (url, opts = {}) => {
    const u = String(url);
    calls.push({ url: u, redirect: opts.redirect });
    const base = u.split('?')[0];
    const key = u in routes ? u : base in routes ? base : Object.keys(routes).find((k) => k.endsWith('*') && u.startsWith(k.slice(0, -1)));
    if (key === undefined) return { ok: false, status: 404, headers: new Map(), text: async () => '' };
    if (flaky[key] > 0) { flaky[key]--; return { ok: false, status: 503, headers: new Map(), text: async () => '' }; }
    const r = routes[key];
    if (typeof r === 'function') return r(u, opts);
    return { ok: true, status: 200, headers: new Map(), text: async () => r };
  };
  return { fetch, calls };
}
const redirect = (to) => () => ({ ok: false, status: 302, headers: new Map([['location', to]]), text: async () => '' });

function baseRoutes(extra) {
  return Object.assign({
    'https://www.ncssm.edu/news': NEWS_PAGE,
    'https://www.ncssm.edu/news/robotics-team-wins-state': ARTICLE_PAGE('Robotics team wins state title', '2026-10-15'),
    'https://example-news.test/2026/10/12/alum-wins-prize/': OUTSIDE_PAGE,
    'https://other.test/story-without-date': '<html><body><main><p>This page carries no date anywhere in it, so it can never be placed in a week.</p></main></body></html>',
    'https://www.ncssm.edu/events': EVENTS_PAGE,
    'https://www.ncssm.edu/events/alumni-weekend-2026': EVENT_PAGE('Alumni Weekend 2026', 'October 16 &#8211; 18, 2026', 'NCSSM-Durham', 'https://alumni.ncssm.edu/e/alumni-weekend/'),
    'https://www.ncssm.edu/events/open-house-morganton': EVENT_PAGE('Open House (Morganton)', 'November 7, 2026', 'NCSSM-Morganton', ''),
    'https://www.ncssm.edu/events/summer-camp-2027': EVENT_PAGE('Summer Camp', 'June 14 – 18, 2027', 'Durham', ''),
    'https://www.ncssm.edu/events/last-month-concert': EVENT_PAGE('Concert That Already Happened', 'September 12, 2026', 'Morganton', ''),
    'https://news.google.com/rss/search*': (u) => ({ ok: true, status: 200, headers: new Map(), text: async () => (decodeURIComponent(u).includes('alumnus') ? GNEWS_ALUMNI : GNEWS_NCSSM) })
  }, extra);
}

function fakeDrive({ files, heartbeat, failList } = {}) {
  const store = {};
  const list = (files || []).map((f, i) => { store['id' + i] = f.json; return { id: 'id' + i, name: f.name, modifiedTime: '2026-10-09T00:00:00Z' }; });
  if (heartbeat) { store.hb = heartbeat; list.push({ id: 'hb', name: '_heartbeat.json', modifiedTime: '2026-10-18T14:00:00Z' }); }
  const connected = [];
  return {
    connected,
    connect: async (key) => {
      connected.push(key);
      if (failList) throw new Error('Google sign-in failed: 401');
      return { listFolder: async () => list, readJson: async (id) => { const v = store[id]; if (v instanceof Error) throw v; return v; } };
    }
  };
}
const HEALTHY = { schema: 1, version: '1.0.1', lastRun: '2026-10-18T14:00:00.000Z', saved: 1, errors: 0 };
const ENV = { YAKKETY_GOOGLE_KEY: KEY, NCSSM_NEWS_INBOX_FOLDER_ID: 'folder1' };
const run = (web, drive, extra) => collect(Object.assign({ env: ENV, now: NOW, fetch: web.fetch, sleep: async () => {}, connect: drive && drive.connect, log: () => {} }, extra));

(async () => {
  // ---- dates --------------------------------------------------------------
  await test('date ranges: one day, same month, across months and years, with times', () => {
    assert.deepStrictEqual(lib.parseDateRange('October 16, 2026'), { start: '2026-10-16', end: '2026-10-16' });
    assert.deepStrictEqual(lib.parseDateRange('October 16 – 18, 2026'), { start: '2026-10-16', end: '2026-10-18' });
    assert.deepStrictEqual(lib.parseDateRange('Oct. 30 – Nov. 2, 2026'), { start: '2026-10-30', end: '2026-11-02' });
    assert.deepStrictEqual(lib.parseDateRange('Dec 28, 2026 – Jan 3, 2027'), { start: '2026-12-28', end: '2027-01-03' });
    assert.deepStrictEqual(lib.parseDateRange('Dec 28 – Jan 3, 2027'), { start: '2026-12-28', end: '2027-01-03' });
    assert.deepStrictEqual(lib.parseDateRange('November 7, 2026 7:00 PM – 9:00 PM'), { start: '2026-11-07', end: '2026-11-07' });
    assert.deepStrictEqual(lib.parseDateRange('March 3', 2027), { start: '2027-03-03', end: '2027-03-03' });
    assert.strictEqual(lib.parseDateRange('To be announced'), null);
    assert.strictEqual(lib.parseDateRange('Smarch 3, 2026'), null);
  });

  // ---- ncssm.edu ----------------------------------------------------------
  await test('news list: featured, dated and "Media" cards; outside coverage is marked', () => {
    const l = lib.parseNewsList(NEWS_PAGE);
    assert.deepStrictEqual(l.map((s) => [s.title, s.published, s.external, s.outlet]), [
      ['Robotics team wins state title', '2026-10-15', false, 'NCSSM'],
      ['An older story', '2026-06-11', false, 'NCSSM'],
      ['Alum wins national prize', null, true, 'Example News'],
      ['A story nobody dated', null, true, 'Other Times']
    ]);
    assert.strictEqual(l[2].tag, 'media');
  });

  await test('article: title, date and body text, with scripts and footer left out', () => {
    const a = lib.parseArticle(ARTICLE_PAGE('Robotics team wins state title', '2026-10-15'), 2500);
    assert.strictEqual(a.title, 'Robotics team wins state title');
    assert.strictEqual(a.published, '2026-10-15');
    assert.ok(a.text.startsWith('The robotics team from NCSSM-Durham took first place'));
    assert.ok(!/Short byline|ignored|Footer text/.test(a.text));
    assert.ok(lib.parseArticle(ARTICLE_PAGE('X', '2026-10-15'), 60).text.endsWith('…'), 'long text is cut at a word');
  });

  await test('page dates: metadata, JSON-LD, <time> and URL fallbacks', () => {
    assert.strictEqual(lib.pageDate(OUTSIDE_PAGE, ''), '2026-10-12');
    assert.strictEqual(lib.pageDate('<time datetime="2026-09-30T10:00:00Z">x</time>', ''), '2026-09-30');
    assert.strictEqual(lib.pageDate('<html></html>', 'https://x.test/2026/08/03/summer-ventures'), '2026-08-03');
    assert.strictEqual(lib.pageDate('<html></html>', 'https://x.test/story'), null);
  });

  await test('events: links are found once; the page gives dates, place and the sign-up link', () => {
    const links = lib.parseEventLinks(EVENTS_PAGE);
    assert.strictEqual(links.length, 4);
    const e = lib.parseEventPage(EVENT_PAGE('Alumni Weekend 2026', 'October 16 &#8211; 18, 2026', 'NCSSM-Durham', 'https://alumni.ncssm.edu/e/alumni-weekend/'), 2026);
    assert.deepStrictEqual([e.title, e.start, e.end, e.location, e.link], ['Alumni Weekend 2026', '2026-10-16', '2026-10-18', 'NCSSM-Durham', 'https://alumni.ncssm.edu/e/alumni-weekend/']);
    assert.ok(e.text.includes('reunions, tours'));
  });

  // ---- Google News --------------------------------------------------------
  await test('Google News: outlets cleaned, sports listings recognised as noise', () => {
    const items = lib.parseGoogleNews(GNEWS_NCSSM);
    assert.strictEqual(items.length, 5);
    assert.deepStrictEqual([items[0].title, items[0].outlet, items[0].published], ['NCSSM students record a food drive', 'Example TV', '2026-10-08']);
    assert.deepStrictEqual([items[3].title, items[3].outlet], ['NCSSM tennis shuts out Piedmont', 'thepaper.test']);
    assert.deepStrictEqual(items.map(lib.isNoise), [false, true, true, false, false]);
  });

  // ---- newsletter links ---------------------------------------------------
  await test('tracking links: Blackbaud unwraps offline; Constant Contact needs a redirect', () => {
    assert.deepStrictEqual(lib.unwrapLink('https://bbox.blackbaudhosting.com/webforms/service/page.redir?target=https%3a%2f%2fwww.niche.com%2fk12%2f&srcid=1'), { url: 'https://www.niche.com/k12/', status: 'unwrapped' });
    assert.strictEqual(lib.unwrapLink('https://r20.rs6.net/tn.jsp?f=001abc').status, 'needs-redirect');
    assert.strictEqual(lib.unwrapLink('https://alumni.ncssm.edu/e/x').status, 'direct');
    assert.strictEqual(lib.unwrapLink('not a url').status, 'direct');
    assert.strictEqual(lib.unwrapLink('https://bbox.blackbaudhosting.com/webforms/service/page.redir?target=javascript:alert(1)').status, 'direct');
  });

  await test('newsletter records are checked before use', () => {
    assert.strictEqual(lib.newsletterProblem(rec()), '');
    assert.ok(lib.newsletterProblem(rec({ schema: 2 })));
    assert.ok(lib.newsletterProblem(rec({ text: '' })));
    assert.ok(lib.newsletterProblem(rec({ links: null })));
    assert.ok(lib.newsletterProblem(null));
  });

  // ---- merging and windows -------------------------------------------------
  await test('the same story from two sources is kept once, from the better source; newsletters are never merged', () => {
    const a = { kind: 'article', source: 'google-news', title: 'Robotics Team Wins State Title!' };
    const b = { kind: 'article', source: 'ncssm.edu', title: 'Robotics team wins state title' };
    const n1 = { kind: 'newsletter', source: 'newsletter', title: 'Catalyst' }, n2 = { kind: 'newsletter', source: 'newsletter', title: 'Catalyst' };
    const out = lib.dedupe([a, n1, b, n2]);
    assert.strictEqual(out.length, 3);
    assert.strictEqual(out.find((i) => i.kind === 'article').source, 'ncssm.edu');
    assert.deepStrictEqual(out.find((i) => i.kind === 'article').alsoIn, ['google-news']);
  });

  await test('windows: recent articles, events not over and starting soon, recent newsletters', () => {
    const o = { days: 10, ahead: 28, newsletterDays: 35 };
    const today = '2026-10-18';
    assert.ok(lib.inWindow({ kind: 'article', published: '2026-10-08' }, today, o));
    assert.ok(!lib.inWindow({ kind: 'article', published: '2026-10-07' }, today, o));
    assert.ok(!lib.inWindow({ kind: 'article', published: null }, today, o));
    assert.ok(lib.inWindow({ kind: 'event', start: '2026-10-16', end: '2026-10-18' }, today, o), 'still going today');
    assert.ok(!lib.inWindow({ kind: 'event', start: '2026-10-16', end: '2026-10-17' }, today, o), 'already over');
    assert.ok(lib.inWindow({ kind: 'event', start: '2026-11-15', end: '2026-11-15' }, today, o));
    assert.ok(!lib.inWindow({ kind: 'event', start: '2026-11-16', end: '2026-11-16' }, today, o));
    assert.ok(lib.inWindow({ kind: 'newsletter', receivedAt: '2026-09-15T12:00:00Z' }, today, o));
    assert.ok(!lib.inWindow({ kind: 'newsletter', receivedAt: '2026-09-01T12:00:00Z' }, today, o));
  });

  // ---- whole runs ---------------------------------------------------------
  await test('a full run: every source, windows applied, newsletters resolved, nothing leaked', async () => {
    const web = fakeWeb(baseRoutes({
      'https://r20.rs6.net/tn.jsp?f=001abc': redirect('https://www.ncssm.edu/events/alumni-weekend-2026?utm_source=ctct'),
      'https://r20.rs6.net/tn.jsp?f=001dead': () => ({ ok: false, status: 500, headers: new Map(), text: async () => '' })
    }));
    const drive = fakeDrive({ files: [{ name: '2026-10-08_m1.json', json: rec() }, { name: '2026-08-01_old.json', json: rec({ id: 'old' }) }, { name: 'notes.txt', json: {} }], heartbeat: HEALTHY });
    const logs = [];
    const r = await run(web, drive, { log: (m) => logs.push(m) });

    assert.deepStrictEqual(Object.values(r.sources).map((s) => s.ok), [true, true, true, true]);
    assert.deepStrictEqual(r.counts, { newsletter: 1, article: r.counts.article, event: 2, outOfWindow: r.counts.outOfWindow, duplicates: r.counts.duplicates });
    const titles = r.items.filter((i) => i.kind === 'article').map((i) => i.title);
    assert.ok(titles.includes('Robotics team wins state title'), 'ncssm.edu story');
    assert.ok(titles.includes('Alum wins national prize'), 'outside coverage dated from its own page');
    assert.ok(!titles.includes('A story nobody dated'), 'undatable coverage is left out');
    assert.ok(!titles.includes('An older story'), 'too old');
    assert.ok(!titles.some((t) => /Schedule|Watch Live/.test(t)), 'sports listings dropped');
    assert.strictEqual(titles.filter((t) => /robotics team wins/i.test(t)).length, 1, 'same story from Google News merged');
    assert.strictEqual(titles.filter((t) => /food drive/.test(t)).length, 1, 'same story from both queries merged');
    assert.ok(titles.includes('Former NCSSM student named Rhodes finalist'), 'alumni query');
    assert.deepStrictEqual(r.items.filter((i) => i.kind === 'event').map((e) => [e.title, e.start]), [['Alumni Weekend 2026', '2026-10-16'], ['Open House (Morganton)', '2026-11-07']]);

    const n = r.items.find((i) => i.kind === 'newsletter');
    assert.deepStrictEqual(n.links.map((l) => [l.url, l.resolved]), [
      ['https://www.niche.com/k12/', true],
      ['https://www.ncssm.edu/events/alumni-weekend-2026?utm_source=ctct', true],
      ['https://r20.rs6.net/tn.jsp?f=001dead', false],
      ['https://alumni.ncssm.edu/e/alumni-weekend', true]
    ]);
    assert.ok(r.sources.newsletters.note.includes('1 tracking links not unwrapped'));
    assert.ok(n.text.startsWith('From Chancellor Roberts'));
    assert.ok(!JSON.stringify(r).includes('private_key') && !logs.join('\n').includes('BEGIN PRIVATE KEY'), 'the key never appears');
    assert.ok(!logs.join('\n').includes('Chancellor') && !logs.join('\n').includes('robotics team from'), 'logs hold counts, not content');
    assert.strictEqual(drive.connected[0], KEY);
  });

  await test('Google News retries a 503 and still gets the feed', async () => {
    const web = fakeWeb(baseRoutes(), { flaky: { 'https://news.google.com/rss/search*': 2 } });
    const r = await run(web, null, { noDrive: true });
    assert.strictEqual(r.sources['google-news'].ok, true);
    assert.ok(r.counts.article > 0);
  });

  await test('a source that fails is reported, the others still run', async () => {
    const web = fakeWeb(baseRoutes({ 'https://www.ncssm.edu/events': '<html>nothing here</html>', 'https://www.ncssm.edu/news': () => ({ ok: false, status: 500, headers: new Map(), text: async () => '' }) }));
    const r = await run(web, null, { noDrive: true });
    assert.strictEqual(r.sources['ncssm.edu/news'].ok, false);
    assert.ok(/answered 500/.test(r.sources['ncssm.edu/news'].error));
    assert.strictEqual(r.sources['ncssm.edu/events'].ok, false);
    assert.ok(/layout change/.test(r.sources['ncssm.edu/events'].error));
    assert.strictEqual(r.sources['google-news'].ok, true);
  });

  await test('Google News down for every query is a failure', async () => {
    const web = fakeWeb(baseRoutes({ 'https://news.google.com/rss/search*': () => ({ ok: false, status: 503, headers: new Map(), text: async () => '' }) }));
    const r = await run(web, null, { noDrive: true });
    assert.strictEqual(r.sources['google-news'].ok, false);
  });

  await test('the inbox is unhealthy when its script went quiet, errored, or never went live', async () => {
    const web = () => fakeWeb(baseRoutes());
    const stale = await run(web(), fakeDrive({ files: [{ name: '2026-10-08_m1.json', json: rec() }], heartbeat: Object.assign({}, HEALTHY, { lastRun: '2026-10-17T00:00:00.000Z' }) }));
    assert.strictEqual(stale.sources.newsletters.ok, false);
    assert.ok(/hours ago/.test(stale.sources.newsletters.error));
    assert.strictEqual(stale.counts.newsletter, 1, 'newsletters are still passed on');
    const errors = await run(web(), fakeDrive({ files: [], heartbeat: Object.assign({}, HEALTHY, { errors: 2 }) }));
    assert.ok(/2 error/.test(errors.sources.newsletters.error));
    const none = await run(web(), fakeDrive({ files: [] }));
    assert.ok(/DRY_RUN=false/.test(none.sources.newsletters.error));
  });

  await test('inbox problems: bad sign-in, missing settings, unreadable files', async () => {
    const web = () => fakeWeb(baseRoutes());
    const signin = await run(web(), fakeDrive({ failList: true }));
    assert.ok(/sign-in failed/.test(signin.sources.newsletters.error));
    const nokey = await run(web(), fakeDrive(), { env: {} });
    assert.ok(/YAKKETY_GOOGLE_KEY is not set/.test(nokey.sources.newsletters.error));
    const nofolder = await run(web(), fakeDrive(), { env: { YAKKETY_GOOGLE_KEY: KEY } });
    assert.ok(/NCSSM_NEWS_INBOX_FOLDER_ID is not set/.test(nofolder.sources.newsletters.error));
    const damaged = await run(web(), fakeDrive({ files: [{ name: '2026-10-08_a.json', json: new Error('bad json') }, { name: '2026-10-08_b.json', json: { schema: 9 } }, { name: '2026-10-09_c.json', json: rec({ id: 'c' }) }], heartbeat: HEALTHY }));
    assert.strictEqual(damaged.sources.newsletters.ok, true);
    assert.strictEqual(damaged.counts.newsletter, 1);
    assert.ok(damaged.sources.newsletters.note.includes('2 unreadable'));
  });

  await test('the service-account sign-in asks for read-only Drive access and sends the signed JWT', async () => {
    const seen = [];
    const f = async (url, opts) => {
      seen.push({ url: String(url), opts });
      if (String(url).startsWith(google.TOKEN_URL)) return { ok: true, status: 200, json: async () => ({ access_token: 'tok' }) };
      if (String(url).includes('alt=media')) return { ok: true, status: 200, text: async () => '{"a":1}' };
      return { ok: true, status: 200, json: async () => ({ files: [{ id: 'x', name: 'n' }] }) };
    };
    const d = await google.connect(KEY, { fetch: f, now: NOW });
    assert.deepStrictEqual(await d.listFolder('folder1'), [{ id: 'x', name: 'n' }]);
    assert.deepStrictEqual(await d.readJson('x'), { a: 1 });
    const assertion = new URLSearchParams(seen[0].opts.body).get('assertion');
    const claims = JSON.parse(Buffer.from(assertion.split('.')[1], 'base64url').toString());
    assert.strictEqual(claims.scope, 'https://www.googleapis.com/auth/drive.readonly');
    assert.strictEqual(seen[1].opts.headers.Authorization, 'Bearer tok');
    await assert.rejects(google.connect('not json'), /not valid JSON/);
    await assert.rejects(google.connect('{}'), /missing client_email/);
  });

  await test('options: defaults, overrides and bad values', () => {
    assert.deepStrictEqual(parseArgs([]).options, {});
    const a = parseArgs(['--days', '7', '--ahead', '14', '--no-drive', '--allow-partial', '--out', 'x.json']);
    assert.deepStrictEqual([a.options.days, a.options.ahead, a.noDrive, a.allowPartial, a.out], [7, 14, true, true, 'x.json']);
    assert.throws(() => parseArgs(['--days', 'many']), /bad value/);
    assert.throws(() => parseArgs(['--bogus']), /unknown option/);
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
