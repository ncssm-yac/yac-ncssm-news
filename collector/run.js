#!/usr/bin/env node
// Collects NCSSM news from four places into one items.json for Yakkety:
//   - ncssm.edu/news     NCSSM's stories, plus outside coverage it links to
//   - ncssm.edu/events   upcoming events
//   - Google News        press coverage, with sports listings dropped
//   - the Drive inbox    newsletters saved by apps-script/ (read-only)
// Stateless: every run rebuilds the last few days from scratch, so nothing
// needs storing and a missed run costs nothing. Judging, scoring and writing
// are Yakkety's job, not this script's.
//
//   node collector/run.js --out items.json [--days 10] [--ahead 28]
//                         [--newsletter-days 35] [--no-drive] [--allow-partial]
//
// Env: YAKKETY_GOOGLE_KEY (service account JSON), NCSSM_NEWS_INBOX_FOLDER_ID.
// Exit 1 if any source failed, unless --allow-partial. Logs counts only: no
// keys and no article or newsletter text.
'use strict';

const fs = require('fs');
const lib = require('./lib');
const google = require('./google');

const UA = 'yac-ncssm-news (+https://github.com/ncssm-yac/yac-ncssm-news)';
const GOOGLE_NEWS_QUERIES = [
  { name: 'NCSSM', q: '"NCSSM" OR "North Carolina School of Science and Mathematics"' },
  { name: 'alumni', q: '"NCSSM alumnus" OR "NCSSM alumna" OR "NCSSM graduate" OR "graduate of the North Carolina School of Science and Mathematics"' }
];
const HEARTBEAT_MAX_AGE_HOURS = 6;

const DEFAULTS = { days: 10, ahead: 28, newsletterDays: 35, maxArticles: 15, maxExternal: 12, maxEvents: 40, maxNewsletters: 40, maxResolve: 60, timeoutMs: 20000 };

function makeHttp({ fetch: f, sleep, timeoutMs }) {
  /** GET with retries on network errors, 429 and 5xx. -> { ok, status, text } */
  async function get(url, { retries = 2, redirect = 'follow' } = {}) {
    let last = { ok: false, status: 0, text: '' };
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const res = await f(url, { redirect, headers: { 'User-Agent': UA, Accept: 'text/html,application/xml,*/*' }, signal: AbortSignal.timeout(timeoutMs) });
        const text = res.status >= 300 && res.status < 400 ? '' : await res.text();
        last = { ok: res.ok, status: res.status, text, location: res.headers && res.headers.get ? res.headers.get('location') : null };
        if (res.ok || (res.status < 500 && res.status !== 429)) return last;
      } catch (e) {
        last = { ok: false, status: 0, text: '', error: e.name === 'TimeoutError' ? 'timed out' : e.message };
      }
      if (attempt < retries) await sleep(1000 * (attempt + 1) * (attempt + 1));
    }
    return last;
  }
  return { get };
}

async function pool(list, size, fn) {
  const out = new Array(list.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, list.length) }, async () => {
    while (next < list.length) { const i = next++; out[i] = await fn(list[i], i); }
  }));
  return out;
}

const nyDay = (ms) => new Date(ms).toLocaleDateString('en-CA', { timeZone: 'America/New_York' });

// ---------------------------------------------------------------------------
// Sources. Each returns { ok, error?, items, note? } and never throws.
// ---------------------------------------------------------------------------

async function ncssmNews({ http, today, opts }) {
  const res = await http.get(lib.NCSSM + '/news');
  if (!res.ok) return { ok: false, error: 'ncssm.edu/news answered ' + (res.status || res.error), items: [] };
  const list = lib.parseNewsList(res.text);
  if (!list.length) return { ok: false, error: 'no stories found on ncssm.edu/news (did the page layout change?)', items: [] };

  const dated = list.filter((s) => s.published && s.published >= lib.addDays(today, -opts.days));
  const internal = dated.filter((s) => !s.external).slice(0, opts.maxArticles);
  // Outside coverage has no date on the list: read each page to find out.
  const outside = list.filter((s) => s.external && (!s.published || s.published >= lib.addDays(today, -opts.days))).slice(0, opts.maxExternal);
  const items = [];
  let textFailures = 0;
  await pool(internal.concat(outside), 4, async (s) => {
    const page = await http.get(s.url, { retries: 1 });
    const a = page.ok ? lib.parseArticle(page.text, 2500) : null;
    const published = s.published || (page.ok ? lib.pageDate(page.text, s.url) : null) || lib.pageDate('', s.url);
    if (!published) return;
    if (!a || !a.text) textFailures++;
    items.push({
      id: lib.itemId('article', s.url), kind: 'article', source: 'ncssm.edu', title: s.title, url: s.url, published,
      outlet: s.outlet, tag: s.tag, text: a ? (a.text || a.description) : '', textFetched: !!(a && (a.text || a.description))
    });
  });
  return { ok: true, items, note: list.length + ' listed, ' + items.length + ' dated' + (textFailures ? ', ' + textFailures + ' without text' : '') };
}

async function ncssmEvents({ http, today, opts, year }) {
  const res = await http.get(lib.NCSSM + '/events');
  if (!res.ok) return { ok: false, error: 'ncssm.edu/events answered ' + (res.status || res.error), items: [] };
  const links = lib.parseEventLinks(res.text);
  if (!links.length) return { ok: false, error: 'no events found on ncssm.edu/events (did the page layout change?)', items: [] };
  const items = [];
  let undated = 0;
  await pool(links.slice(0, opts.maxEvents), 4, async (l) => {
    const page = await http.get(l.url, { retries: 1 });
    if (!page.ok) return;
    const e = lib.parseEventPage(page.text, year);
    if (!e.start) { undated++; return; }
    items.push({
      id: lib.itemId('event', l.url), kind: 'event', source: 'ncssm.edu', title: e.title || l.title, url: l.url,
      start: e.start, end: e.end, when: e.when, location: e.location, moreInfo: e.link, text: e.text, textFetched: !!e.text
    });
  });
  return { ok: true, items, note: links.length + ' listed' + (undated ? ', ' + undated + ' without a date' : '') };
}

async function googleNews({ http }) {
  const items = [];
  let noise = 0, failed = 0;
  for (const query of GOOGLE_NEWS_QUERIES) {
    const url = 'https://news.google.com/rss/search?' + new URLSearchParams({ q: query.q + ' when:14d', hl: 'en-US', gl: 'US', ceid: 'US:en' });
    const res = await http.get(url, { retries: 3 });
    if (!res.ok) { failed++; continue; }
    for (const r of lib.parseGoogleNews(res.text)) {
      if (lib.isNoise(r)) { noise++; continue; }
      items.push({
        id: lib.itemId('article', r.title + '|' + r.outlet), kind: 'article', source: 'google-news', title: r.title, url: r.url,
        published: r.published, outlet: r.outlet, query: query.name, text: '', textFetched: false
      });
    }
  }
  if (failed === GOOGLE_NEWS_QUERIES.length) return { ok: false, error: 'Google News did not answer', items: [] };
  return { ok: true, items, noise, note: noise + ' sports listings dropped' + (failed ? ', ' + failed + ' query failed' : '') };
}

async function newsletters({ http, env, now, today, opts, connect }) {
  const key = env.YAKKETY_GOOGLE_KEY, folder = env.NCSSM_NEWS_INBOX_FOLDER_ID;
  if (!key) return { ok: false, error: 'YAKKETY_GOOGLE_KEY is not set', items: [] };
  if (!folder) return { ok: false, error: 'NCSSM_NEWS_INBOX_FOLDER_ID is not set', items: [] };
  let drive, files;
  try {
    drive = await connect(key, { now });
    files = await drive.listFolder(folder);
  } catch (e) {
    return { ok: false, error: e.message, items: [] };
  }

  // The script's own status file: if it stopped, newsletters silently stop.
  let heartbeat = null, problem = '';
  const hb = files.find((f) => f.name === '_heartbeat.json');
  if (!hb) problem = 'no _heartbeat.json in the inbox: has the script gone live (DRY_RUN=false)?';
  else {
    try {
      heartbeat = await drive.readJson(hb.id);
      const age = (now - Date.parse(heartbeat.lastRun)) / 3600000;
      if (!Number.isFinite(age)) problem = 'heartbeat has no valid lastRun';
      else if (age > HEARTBEAT_MAX_AGE_HOURS) problem = 'the inbox script last ran ' + Math.round(age) + ' hours ago';
      else if (heartbeat.errors > 0) problem = 'the inbox script reported ' + heartbeat.errors + ' error(s) on its last run';
    } catch (e) { problem = 'could not read the heartbeat: ' + e.message; }
  }

  const since = lib.addDays(today, -opts.newsletterDays - 1);
  const wanted = files.filter((f) => /^\d{4}-\d{2}-\d{2}_.+\.json$/.test(f.name) && f.name.slice(0, 10) >= since)
    .sort((a, b) => (a.name < b.name ? 1 : -1)).slice(0, opts.maxNewsletters);
  const items = [];
  let bad = 0, resolveBudget = opts.maxResolve, unresolved = 0;

  const resolve = async (url) => {
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      if (lib.unwrapLink(current).status !== 'needs-redirect') return { url: current, resolved: hop > 0 || current !== url };
      const r = await http.get(current, { retries: 0, redirect: 'manual' });
      if (r.status >= 300 && r.status < 400 && r.location) { current = lib.absolute(r.location, current) || current; continue; }
      return { url, resolved: false };
    }
    return { url, resolved: false };
  };

  for (const f of wanted) {
    let rec;
    try { rec = await drive.readJson(f.id); } catch (e) { bad++; continue; }
    if (lib.newsletterProblem(rec)) { bad++; continue; }
    const links = [];
    for (const l of rec.links) {
      const u = lib.unwrapLink(l.url);
      if (u.status === 'needs-redirect') {
        if (resolveBudget > 0) {
          resolveBudget--;
          const r = await resolve(u.url);
          if (!r.resolved) unresolved++;
          links.push({ text: l.text, url: r.url, resolved: r.resolved });
        } else { unresolved++; links.push({ text: l.text, url: u.url, resolved: false }); }
      } else links.push({ text: l.text, url: u.url, resolved: true });
    }
    items.push({
      id: lib.itemId('newsletter', rec.id), kind: 'newsletter', source: 'newsletter', title: rec.subject, from: rec.from,
      receivedAt: rec.receivedAt, text: rec.text, links, textFetched: true
    });
  }
  const note = wanted.length + ' recent' + (bad ? ', ' + bad + ' unreadable' : '') + (unresolved ? ', ' + unresolved + ' tracking links not unwrapped' : '') +
    (heartbeat ? ', inbox script last ran ' + heartbeat.lastRun : '');
  return problem ? { ok: false, error: problem, items, note } : { ok: true, items, note, heartbeat: heartbeat && { lastRun: heartbeat.lastRun, version: heartbeat.version } };
}

// ---------------------------------------------------------------------------

async function collect({ env = process.env, now = Date.now(), fetch: f = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)), connect = google.connect, log = console.log, options = {}, noDrive = false } = {}) {
  const opts = Object.assign({}, DEFAULTS, options);
  const http = makeHttp({ fetch: f, sleep, timeoutMs: opts.timeoutMs });
  const today = nyDay(now);
  const year = Number(today.slice(0, 4));
  const ctx = { http, env, now, today, opts, year, connect };

  const run = { 'ncssm.edu/news': ncssmNews, 'ncssm.edu/events': ncssmEvents, 'google-news': googleNews };
  if (!noDrive) run.newsletters = newsletters;
  const sources = {};
  let all = [];
  for (const [name, fn] of Object.entries(run)) {
    let r;
    try { r = await fn(ctx); } catch (e) { r = { ok: false, error: 'unexpected: ' + e.message, items: [] }; }
    sources[name] = { ok: r.ok, count: r.items.length, ...(r.error ? { error: r.error } : {}), ...(r.note ? { note: r.note } : {}), ...(r.heartbeat ? { heartbeat: r.heartbeat } : {}) };
    all = all.concat(r.items);
    log((r.ok ? 'ok   ' : 'FAIL ') + name + ': ' + r.items.length + ' item(s)' + (r.error ? ' - ' + r.error : '') + (r.note ? ' (' + r.note + ')' : ''));
  }

  const inWin = all.filter((i) => lib.inWindow(i, today, opts));
  const items = lib.dedupe(inWin).sort((a, b) => {
    const order = { newsletter: 0, article: 1, event: 2 };
    if (a.kind !== b.kind) return order[a.kind] - order[b.kind];
    if (a.kind === 'event') return a.start < b.start ? -1 : a.start > b.start ? 1 : 0;
    const da = a.published || a.receivedAt || '', db = b.published || b.receivedAt || '';
    return da < db ? 1 : da > db ? -1 : 0;
  });
  const counts = { newsletter: 0, article: 0, event: 0 };
  items.forEach((i) => { counts[i.kind]++; });
  const result = {
    schema: 1, generatedAt: new Date(now).toISOString(), today,
    window: { days: opts.days, ahead: opts.ahead, newsletterDays: opts.newsletterDays },
    sources, counts: Object.assign(counts, { outOfWindow: all.length - inWin.length, duplicates: inWin.length - items.length }), items
  };
  log('items: ' + counts.newsletter + ' newsletter(s), ' + counts.article + ' article(s), ' + counts.event + ' event(s); ' + result.counts.outOfWindow + ' outside the window, ' + result.counts.duplicates + ' duplicate(s)');
  return result;
}

function parseArgs(argv) {
  const a = { options: {}, noDrive: false, allowPartial: false, out: 'items.json' };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--no-drive') a.noDrive = true;
    else if (k === '--allow-partial') a.allowPartial = true;
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--days') a.options.days = Number(argv[++i]);
    else if (k === '--ahead') a.options.ahead = Number(argv[++i]);
    else if (k === '--newsletter-days') a.options.newsletterDays = Number(argv[++i]);
    else throw new Error('unknown option ' + k);
  }
  for (const [k, v] of Object.entries(a.options)) if (!Number.isFinite(v) || v < 0) throw new Error('bad value for --' + k);
  return a;
}

async function main(argv, env) {
  const args = parseArgs(argv);
  const result = await collect({ env, options: args.options, noDrive: args.noDrive });
  fs.writeFileSync(args.out, JSON.stringify(result, null, 2) + '\n');
  const failed = Object.entries(result.sources).filter(([, s]) => !s.ok).map(([n]) => n);
  if (failed.length) console.error('Source(s) failed: ' + failed.join(', ') + (args.allowPartial ? ' (continuing: --allow-partial)' : ''));
  return failed.length && !args.allowPartial ? 1 : 0;
}

if (require.main === module) main(process.argv.slice(2), process.env).then((code) => process.exit(code), (e) => { console.error('Collector failed: ' + e.message); process.exit(1); });

module.exports = { collect, parseArgs, makeHttp, DEFAULTS, GOOGLE_NEWS_QUERIES };
