// The deterministic edges of the Monday digest. Yakkety (the ncssm-news skill)
// writes digest.json; this checks it, builds the YAC IT draft around it, and
// turns it into the post for NCSSM News. Pure: no network, no
// secrets, same inputs give the same output.
//
// digest.json, as the skill writes it:
//   { "week": "2026-10-12", "text": "<the post>", "items": [{ "id", "title", "url" }] }
// or, in a week with nothing worth posting:
//   { "week": "2026-10-12", "quiet": true, "items": [] }
'use strict';

const MAX_POST = 3500;          // the skill's limit; YAC Chat's is 4000, and the draft adds a wrapper
const MAX_MESSAGE = 4000;       // YAC Chat refuses anything longer
const SEND_WORKFLOW = 'Send approved NCSSM News post';

const isDay = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const isUrl = (s) => typeof s === 'string' && /^https?:\/\/\S+$/.test(s);

// A story line: a bullet, or a number like "1." (the post is a numbered list since Nov 3, 2026).
const STORY_LINE = /^\s*(?:[\u2022\-*]|\d{1,2}\.)\s+\S/;
const MONTHS = { Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5, Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11 };
const dayKey = (y, m, d) => Date.UTC(y, m, d);

/**
 * Every story under "Last two weeks at NCSSM (Mon D-Mon D)" must carry its own
 * date, and that date must fall inside the range in the heading. The Nov 3,
 * 2026 digest posted a Nov 3 story under "Oct 20-Nov 2": the skill said to drop
 * what is dated before the range but nothing about after it, and the model
 * does not count days reliably. Other sections ("Coming up") are not checked,
 * and a post without that heading (the older "Last week" shape) is left alone.
 * `week` is the run date, which fixes the year.
 */
function dateRangeProblems(text, week) {
  const lines = String(text || '').split('\n');
  const at = lines.findIndex((l) => /^\s*\*?\s*Last two weeks at NCSSM/i.test(l));
  if (at < 0) return [];
  const m = lines[at].match(/\(\s*([A-Z][a-z]{2}) (\d{1,2})\s*[\u2013-]\s*([A-Z][a-z]{2}) (\d{1,2})\s*\)/);
  if (!m || !(m[1] in MONTHS) || !(m[3] in MONTHS)) return ['the "Last two weeks" heading has no date range like (Oct 20\u2013Nov 2)'];
  const run = new Date(week + 'T00:00:00Z');
  const runY = run.getUTCFullYear();
  const endM = MONTHS[m[3]], startM = MONTHS[m[1]];
  const endY = endM > run.getUTCMonth() ? runY - 1 : runY;
  const startY = startM > endM ? endY - 1 : endY;
  const start = dayKey(startY, startM, Number(m[2])), end = dayKey(endY, endM, Number(m[4]));
  const problems = [];
  let n = 0;
  for (let i = at + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*\*[^\u2022]/.test(line) && !/^\s*[\u2022\-]/.test(line)) break; // the next heading
    if (!STORY_LINE.test(line)) continue;
    n++;
    // The date sits at the end of the story's first line, "(Oct 21)" (the format since Nov 3, 2026),
    // or leads it as "*Oct 21:*" (the earlier shape, still accepted).
    const d = line.match(/\(([A-Z][a-z]{2}) (\d{1,2})\)\s*$/) || line.match(/^\s*(?:[\u2022\-*]|\d{1,2}\.)\s+\*?([A-Z][a-z]{2}) (\d{1,2}):/);
    if (!d || !(d[1] in MONTHS)) { problems.push('story ' + n + ' under "Last two weeks" has no date like "Oct 21:"'); continue; }
    const when = [endY, endY - 1].map((y) => dayKey(y, MONTHS[d[1]], Number(d[2]))).find((k) => k >= start && k <= end);
    if (when === undefined) problems.push('story ' + n + ' is dated ' + d[1] + ' ' + d[2] + ', outside the range ' + m[1] + ' ' + m[2] + '\u2013' + m[3] + ' ' + m[4] + ' (a story after the range belongs in the next digest)');
  }
  return problems;
}

/** Problems with a digest.json; [] means it is fine to use. */
function validateDigest(d) {
  const problems = [];
  if (!d || typeof d !== 'object' || Array.isArray(d)) return ['digest.json is not an object'];
  if (!isDay(d.week)) problems.push('"week" must be a date like 2026-10-12');
  if (!Array.isArray(d.items)) problems.push('"items" must be a list');
  else d.items.forEach((it, i) => {
    if (!it || typeof it.title !== 'string' || !it.title.trim()) problems.push('item ' + (i + 1) + ' has no title');
    if (!it || !isUrl(it.url)) problems.push('item ' + (i + 1) + ' has no link');
  });
  if (d.quiet === true) {
    if (d.text) problems.push('a quiet week has no post');
    return problems;
  }
  const text = typeof d.text === 'string' ? d.text.trim() : '';
  if (!text) problems.push('"text" is empty (a week with nothing to post must say "quiet": true)');
  if (text.length > MAX_POST) problems.push('the post is ' + text.length + ' characters (max ' + MAX_POST + ')');
  if (text && !new RegExp(STORY_LINE.source, 'm').test(text)) problems.push('the post has no stories');
  if (text) problems.push.apply(problems, dateRangeProblems(text, d.week));
  if (/not sent yet/i.test(text)) problems.push('the post carries the draft wrapper; "text" must be the post alone');
  if (Array.isArray(d.items) && text && d.items.length === 0) problems.push('the post has stories but "items" is empty, so next week could not skip them');
  return problems;
}

/** Names of the collector sources that failed this week (names only: no error text). */
function failedSources(items) {
  const sources = (items && items.sources) || {};
  return Object.keys(sources).filter((n) => sources[n] && sources[n].ok === false);
}

function warning(failed) {
  return failed.length
    ? '\n:warning: Not collected this week: ' + failed.join(', ') + '. The digest may be missing stories from there.'
    : '';
}

/** The message for YAC IT: the post, wrapped so nobody mistakes it for sent. */
function buildDraft({ digest, items, runUrl, runId }) {
  const problems = validateDigest(digest);
  if (problems.length) throw new Error('digest.json is not usable: ' + problems.join('; '));
  if (digest.quiet) throw new Error('a quiet week has no draft; use buildQuiet');
  if (!/^\d+$/.test(String(runId || ''))) throw new Error('runId must be the number of the run that made this draft');
  const text = [
    '*Draft NCSSM News digest, not sent yet*',
    digest.text.trim(),
    warning(failedSources(items)).trim(),
    runUrl ? 'Every story and its score: ' + runUrl : '',
    'To send it: Actions → "' + SEND_WORKFLOW + '" in ncssm-yac/yakkety with run "' + runId + '", or tell Yakkety "send the NCSSM News digest".'
  ].filter(Boolean).join('\n');
  if (text.length > MAX_MESSAGE) throw new Error('the draft is ' + text.length + ' characters; YAC Chat allows ' + MAX_MESSAGE);
  return text;
}

/** The note for YAC IT after the digest has been posted to NCSSM News automatically. */
function buildPosted({ digest, items, runUrl }) {
  const problems = validateDigest(digest);
  if (problems.length) throw new Error('digest.json is not usable: ' + problems.join('; '));
  if (digest.quiet) throw new Error('a quiet week has nothing posted; use buildQuiet');
  const n = digest.items.length;
  return [
    '*NCSSM News digest posted* to the NCSSM News space (' + n + (n === 1 ? ' story' : ' stories') + '). It goes out without approval; tell Yakkety what to change for next time.',
    warning(failedSources(items)).trim(),
    runUrl ? 'Every story and its score: ' + runUrl : ''
  ].filter(Boolean).join('\n');
}

/** The message for YAC IT in a week with nothing worth posting. */
function buildQuiet({ digest, items, runUrl }) {
  const problems = validateDigest(digest);
  if (problems.length) throw new Error('digest.json is not usable: ' + problems.join('; '));
  if (digest.quiet !== true) throw new Error('this week has a digest; use buildDraft');
  return [
    '*NCSSM News: a quiet week.* No story scored high enough for the digest, so nothing was posted.',
    warning(failedSources(items)).trim(),
    runUrl ? 'Every story and its score: ' + runUrl : ''
  ].filter(Boolean).join('\n');
}

/** The post for NCSSM News: the skill's post, unchanged. */
function approvedPost(digest) {
  const problems = validateDigest(digest);
  if (problems.length) throw new Error('digest.json is not usable: ' + problems.join('; '));
  if (digest.quiet) throw new Error('a quiet week has nothing to send');
  return digest.text.trim();
}

module.exports = { validateDigest, dateRangeProblems, failedSources, buildDraft, buildPosted, buildQuiet, approvedPost, MAX_POST, MAX_MESSAGE, SEND_WORKFLOW };
