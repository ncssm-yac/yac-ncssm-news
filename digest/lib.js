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
  if (text && !/^\s*[•\-*]\s+\S/m.test(text)) problems.push('the post has no stories');
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

module.exports = { validateDigest, failedSources, buildDraft, buildPosted, buildQuiet, approvedPost, MAX_POST, MAX_MESSAGE, SEND_WORKFLOW };
