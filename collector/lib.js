// Pure parsing and filtering for the NCSSM News collector. No network, no
// secrets: the same inputs always give the same output, and run.js does the
// fetching. Everything here is tested offline with made-up HTML.
'use strict';

const crypto = require('crypto');

const NCSSM = 'https://www.ncssm.edu';

// ---------------------------------------------------------------------------
// Text helpers
// ---------------------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', bull: '•' };

function decodeEntities(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, code) => {
    if (code[0] === '#') {
      const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    const v = ENTITIES[code.toLowerCase()];
    return v === undefined ? all : v;
  });
}

const squash = (s) => decodeEntities(String(s)).replace(/[ ​﻿]/g, ' ').replace(/\s+/g, ' ').trim();
const textOf = (html) => squash(String(html).replace(/<[^>]+>/g, ' '));

function absolute(href, base) {
  try { return new URL(decodeEntities(href), base || NCSSM).toString(); } catch (e) { return null; }
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const monthIndex = (name) => MONTHS.indexOf(String(name).slice(0, 3).toLowerCase());
const pad = (n) => String(n).padStart(2, '0');
const iso = (y, m, d) => y + '-' + pad(m + 1) + '-' + pad(d);

/**
 * "October 16 – 18, 2026", "October 16, 2026", "Oct. 30 – Nov. 2, 2026" or
 * "Dec 5, 2026 – Jan 3, 2027" -> { start, end } as YYYY-MM-DD, or null.
 * `nowYear` fills in a missing year.
 */
function parseDateRange(text, nowYear) {
  const s = squash(text);
  const m1 = s.match(/([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/);
  if (!m1) return null;
  const mo1 = monthIndex(m1[1]);
  if (mo1 < 0) return null;
  const day1 = Number(m1[2]);
  let year1 = m1[3] ? Number(m1[3]) : null;
  let mo2 = mo1, day2 = day1, year2 = year1;
  const rest = s.slice(m1.index + m1[0].length);
  const m2 = rest.match(/^\s*[–—-]\s*(?:([A-Za-z]{3,9})\.?\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/);
  if (m2) {
    const named = m2[1] ? monthIndex(m2[1]) : mo1;
    if (named >= 0) { mo2 = named; day2 = Number(m2[2]); year2 = m2[3] ? Number(m2[3]) : year1; }
  }
  if (year1 === null && year2 !== null) year1 = mo1 > mo2 ? year2 - 1 : year2;
  if (year1 === null) year1 = nowYear;
  if (year2 === null) year2 = mo2 < mo1 ? year1 + 1 : year1;
  if (day1 < 1 || day1 > 31 || day2 < 1 || day2 > 31) return null;
  return { start: iso(year1, mo1, day1), end: iso(year2, mo2, day2) };
}

/** Any date-ish value -> YYYY-MM-DD (UTC), or null. */
function toDay(value) {
  if (!value) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  const t = Date.parse(value);
  return Number.isNaN(t) ? null : new Date(t).toISOString().slice(0, 10);
}

const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// ncssm.edu
// ---------------------------------------------------------------------------

/**
 * Items on ncssm.edu/news: NCSSM's own stories (dated) and the "Media" cards
 * linking to outside coverage (undated: the page itself says when).
 * -> [{ title, url, published, tag, external, outlet }]
 */
function parseNewsList(html) {
  const h = String(html);
  const heads = [...h.matchAll(/<h2 class="title">\s*<a href="([^"]+)"[^>]*>([\s\S]*?)<\/a>\s*<\/h2>/g)];
  const out = [];
  const seen = new Set();
  heads.forEach((m, i) => {
    const url = absolute(m[1]);
    const title = textOf(m[2]);
    if (!url || !title || seen.has(url)) return;
    seen.add(url);
    const tags = [...h.slice(Math.max(0, m.index - 500), m.index).matchAll(/<p class="is-style-small-heading">([^<]*)<\/p>/g)];
    const after = h.slice(m.index + m[0].length, heads[i + 1] ? heads[i + 1].index : m.index + m[0].length + 600).slice(0, 600);
    const date = after.match(/<time[^>]*datetime="([^"]+)"/);
    const source = after.match(/<p class="source">([\s\S]*?)<\/p>/);
    const host = new URL(url).hostname.replace(/^www\./, '');
    const external = host !== 'ncssm.edu';
    out.push({
      title, url, published: toDay(date && date[1]), tag: tags.length ? squash(tags[tags.length - 1][1]).toLowerCase() : '',
      external, outlet: external ? (source && textOf(source[1])) || host : 'NCSSM'
    });
  });
  return out;
}

/** When a page was published: article metadata, JSON-LD, a <time>, or a /YYYY/MM/DD/ URL. */
function pageDate(html, url) {
  const h = String(html);
  const patterns = [
    /<meta[^>]+(?:property|name)="(?:article:published_time|og:article:published_time|datePublished|date|pubdate)"[^>]*content="([^"]+)"/i,
    /<meta[^>]+content="([^"]+)"[^>]*(?:property|name)="(?:article:published_time|datePublished)"/i,
    /"datePublished"\s*:\s*"([^"]+)"/,
    /<time[^>]*datetime="([^"]+)"/i
  ];
  for (const re of patterns) {
    const m = h.match(re);
    const d = m && toDay(m[1].slice(0, 25));
    if (d) return d;
  }
  const u = String(url || '').match(/\/(20\d{2})\/(\d{2})\/(\d{2})(?:\/|$)/);
  return u ? u[1] + '-' + u[2] + '-' + u[3] : null;
}

/** Paragraph text of a page: the main content only, no footer, no short bits. */
function extractParagraphs(html, maxChars) {
  let s = String(html);
  const main = s.search(/<main\b/i);
  if (main >= 0) s = s.slice(main);
  const foot = s.search(/<footer\b/i);
  if (foot >= 0) s = s.slice(0, foot);
  s = s.replace(/<(script|style|noscript|svg)\b[\s\S]*?<\/\1>/gi, ' ');
  const paras = [];
  const re = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let m;
  while ((m = re.exec(s)) !== null) {
    const t = textOf(m[1]);
    if (t.length >= 40) paras.push(t);
  }
  let out = paras.join('\n\n');
  if (out.length > maxChars) out = out.slice(0, maxChars).replace(/\s+\S*$/, '') + ' …';
  return out;
}

/** A story page -> { title, description, published, text }. */
function parseArticle(html, maxChars) {
  const h = String(html);
  const title = h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const og = h.match(/<meta[^>]+property="og:description"[^>]*content="([^"]*)"/i);
  return {
    title: title ? textOf(title[1]) : '',
    description: og ? squash(og[1]) : '',
    published: pageDate(h, null),
    text: extractParagraphs(h, maxChars || 2500)
  };
}

/** Event page links on ncssm.edu/events -> [{ title, url }] */
function parseEventLinks(html) {
  const out = [];
  const seen = new Set();
  const re = /<a href="((?:https:\/\/www\.ncssm\.edu)?\/events\/[a-z0-9][a-z0-9-]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = re.exec(String(html))) !== null) {
    const url = absolute(m[1]);
    const title = textOf(m[2]);
    if (!url || !title || seen.has(url)) continue;
    seen.add(url);
    out.push({ title, url });
  }
  return out;
}

/** An event page -> { title, when, start, end, location, link, text } */
function parseEventPage(html, nowYear) {
  const h = String(html);
  const title = h.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  const date = h.match(/<p class="date icon">[\s\S]*?<span>([\s\S]*?)<\/span>/);
  const loc = h.match(/<span class="location">([\s\S]*?)<span class="address">([\s\S]*?)<\/span>/);
  const link = h.match(/<div class="event-link">\s*<a href="([^"]+)"/);
  const range = date ? parseDateRange(date[1], nowYear) : null;
  return {
    title: title ? textOf(title[1]) : '',
    when: date ? squash(date[1]) : '',
    start: range && range.start,
    end: range && range.end,
    location: loc ? squash([textOf(loc[1]), textOf(loc[2])].filter(Boolean).join(', ')) : '',
    link: link ? absolute(link[1]) : null,
    text: extractParagraphs(h, 1500)
  };
}

// ---------------------------------------------------------------------------
// Google News
// ---------------------------------------------------------------------------

/** Google News RSS -> [{ title, outlet, outletUrl, url, published }] */
function parseGoogleNews(xml) {
  const out = [];
  const re = /<item>([\s\S]*?)<\/item>/g;
  let m;
  while ((m = re.exec(String(xml))) !== null) {
    const body = m[1];
    const pick = (tag) => { const t = body.match(new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>')); return t ? t[1].replace(/^<!\[CDATA\[|\]\]>$/g, '') : ''; };
    const src = body.match(/<source\s+url="([^"]*)"[^>]*>([\s\S]*?)<\/source>/);
    const rawOutlet = src ? textOf(src[2]) : '';
    let outlet = rawOutlet;
    if (/^https?:\/\//i.test(outlet)) { try { outlet = new URL(outlet).hostname.replace(/^www\./, ''); } catch (e) { /* keep as is */ } }
    let title = textOf(pick('title'));
    for (const o of [rawOutlet, outlet]) if (o && title.endsWith(' - ' + o)) { title = title.slice(0, -(o.length + 3)); break; }
    const url = decodeEntities(pick('link')).trim();
    if (!title || !/^https?:\/\//.test(url)) continue;
    out.push({ title, outlet, outletUrl: src ? decodeEntities(src[1]) : '', url, published: toDay(pick('pubDate')) });
  }
  return out;
}

const NOISE_OUTLET = /\b(maxpreps|nfhs)\b/i;
const NOISE_TITLE = /\b(schedule|roster|scoreboard|box score|standings|watch live|live stream|on demand)\b/i;

/** Sports listings and the like: never news. */
function isNoise(item) {
  return NOISE_OUTLET.test(item.outlet || '') || NOISE_TITLE.test(item.title || '') || /maxpreps\.com|nfhsnetwork\.com/i.test(item.outletUrl || '');
}

// ---------------------------------------------------------------------------
// Newsletter links
// ---------------------------------------------------------------------------

/**
 * Tracking links in newsletters. Blackbaud carries the real address in
 * `target=`, so it unwraps offline. Constant Contact needs a redirect followed.
 * -> { url, status: 'direct' | 'unwrapped' | 'needs-redirect' }
 */
function unwrapLink(url) {
  let u;
  try { u = new URL(url); } catch (e) { return { url, status: 'direct' }; }
  if (/blackbaudhosting\.com$/i.test(u.hostname) && /page\.redir/i.test(u.pathname) && u.searchParams.get('target')) {
    const target = u.searchParams.get('target');
    if (/^https?:\/\//i.test(target)) return { url: target, status: 'unwrapped' };
  }
  if (/(^|\.)rs6\.net$/i.test(u.hostname) || /^(click|r20)\./i.test(u.hostname) && /constantcontact|rs6/i.test(u.hostname)) {
    return { url: url, status: 'needs-redirect' };
  }
  return { url, status: 'direct' };
}

// ---------------------------------------------------------------------------
// Items
// ---------------------------------------------------------------------------

const normTitle = (t) => String(t).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const itemId = (kind, key) => kind.slice(0, 1) + crypto.createHash('sha1').update(key).digest('hex').slice(0, 10);

const SOURCE_RANK = { newsletter: 0, 'ncssm.edu': 1, 'google-news': 2 };

/**
 * One item per story. The same title from two sources keeps the better
 * source (the school's own page beats a newsletter beats a news aggregator).
 * Newsletters are never merged: Yakkety splits them into stories itself.
 */
function dedupe(items) {
  const keep = [];
  const byTitle = new Map();
  const ranked = items.slice().sort((a, b) => (SOURCE_RANK[a.source] === undefined ? 9 : SOURCE_RANK[a.source]) - (SOURCE_RANK[b.source] === undefined ? 9 : SOURCE_RANK[b.source]));
  for (const item of ranked) {
    if (item.kind === 'newsletter') { keep.push(item); continue; }
    const key = item.kind + '|' + normTitle(item.title) + (item.kind === 'event' ? '|' + (item.start || '') : '');
    const prior = byTitle.get(key);
    if (prior) { prior.alsoIn = (prior.alsoIn || []).concat(item.source); continue; }
    byTitle.set(key, item);
    keep.push(item);
  }
  return keep;
}

/** Keep what belongs in this week's digest. `today` is YYYY-MM-DD. */
function inWindow(item, today, opts) {
  const { days, ahead, newsletterDays } = opts;
  if (item.kind === 'newsletter') return toDay(item.receivedAt) >= addDays(today, -newsletterDays);
  if (item.kind === 'event') return !!item.start && item.end >= today && item.start <= addDays(today, ahead);
  return !!item.published && item.published >= addDays(today, -days) && item.published <= addDays(today, 1);
}

/** Check a record saved by the Apps Script. -> problem string, or '' if fine. */
function newsletterProblem(rec) {
  if (!rec || typeof rec !== 'object') return 'not an object';
  if (rec.schema !== 1) return 'unknown schema ' + rec.schema;
  for (const k of ['id', 'receivedAt', 'from', 'subject', 'text']) if (typeof rec[k] !== 'string' || !rec[k]) return 'missing ' + k;
  if (!Array.isArray(rec.links)) return 'missing links';
  return '';
}

module.exports = {
  NCSSM, decodeEntities, textOf, squash, absolute, parseDateRange, toDay, addDays,
  parseNewsList, pageDate, extractParagraphs, parseArticle, parseEventLinks, parseEventPage,
  parseGoogleNews, isNoise, unwrapLink, normTitle, itemId, dedupe, inWindow, newsletterProblem
};
