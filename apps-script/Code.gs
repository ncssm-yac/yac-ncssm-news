/**
 * NCSSM News inbox
 *
 * VERSION:   the VERSION constant below: the one place it is written. Every
 *            saved file's savedBy and the heartbeat report it, so the running
 *            copy can be told from this one.
 *
 * WHAT:      Runs once a day in the ncssm.yac.yakkety@gmail.com account. Saves
 *            each new NCSSM newsletter that reached the account as one JSON
 *            file in the "NCSSM News inbox" Drive folder. The yac-ncssm-news
 *            collector reads that folder as the yakkety service account
 *            (Viewer), and Yakkety turns it into the Monday NCSSM News digest.
 * ONLY:      Messages from ALLOWED_SENDERS are saved. Anything else is
 *            counted in the heartbeat and never saved.
 * NEVER:     Sends, deletes, labels or changes mail (read-only Gmail scope).
 *            Never saves unsubscribe / update-profile / forward links, so
 *            someone reading the folder can't unsubscribe this account.
 * SCOPES:    gmail.readonly (Advanced Gmail service) and drive.file
 *            (Advanced Drive service: only files and folders this script
 *            created). No other scopes; LockService and PropertiesService
 *            need none.
 * STATE:     Script Properties: "DRY_RUN" ('false' = live; anything else or
 *            unset = practice mode) and "INBOX_FOLDER_ID" (written by
 *            setup()). Whether a message was already saved is read from the
 *            folder (a file named "..._<messageId>.json"), never stored, so a
 *            failed save is retried next run and a re-run saves nothing twice.
 * TRIGGER:   Time-driven, daily (5am to 6am), on saveNewsletters. Added in the editor's
 *            Triggers panel. A run that finds the previous one still going
 *            exits (LockService).
 * HEARTBEAT: Every live run rewrites _heartbeat.json in the folder: when it
 *            ran, what it saved, what it ignored and any errors. The YAC
 *            monitor alerts when the heartbeat is stale or reports errors,
 *            because Apps Script's own failure emails go to an inbox no
 *            person reads.
 *
 * Pure logic (no Gmail/Drive/Utilities calls) comes first and is unit-tested
 * offline by Tests.gs and test/run-tests.js.
 */

// ---------------------------------------------------------------------------
// CONFIGURATION
// ---------------------------------------------------------------------------

var VERSION = '1.3.0';
var SCHEMA = 1;                    // bump when the saved JSON shape changes

var DRY_RUN = true;                // default only; the DRY_RUN Script Property wins
var DRY_RUN_KEY = 'DRY_RUN';
var FOLDER_KEY = 'INBOX_FOLDER_ID';
var FORWARD_KEY = 'FORWARD_SENDERS';  // Script Property: comma-separated addresses whose forwards are saved
var FOLDER_NAME = 'NCSSM News inbox';
var HEARTBEAT_NAME = '_heartbeat.json';

// The collector's identity. setup() gives it Viewer on the folder.
var READER_EMAIL = 'yakkety@ncssm-yac.iam.gserviceaccount.com';

// Senders whose mail is saved. Owner's decision (Nov 3, 2026): this inbox only
// receives NCSSM mail and is much less sensitive than the owner's personal
// one, so all NCSSM mail is considered. Anything from ncssm.edu or one of its
// subdomains (including giving@ncssm.edu, the Foundation newsletter) is
// saved. Google's own mail, marketing and anyone else are still ignored.
// ALLOWED_SENDERS is for an exact address outside those domains.
var ALLOWED_DOMAINS = ['ncssm.edu'];
var ALLOWED_SENDERS = [];

// Mail from an allowed sender that isn't news: signup receipts and the like.
var SYSTEM_SUBJECT_RE = /signup confirmation|confirm your (email|subscription|signup)|please confirm|subscription confirm|welcome to (the )?(ncssm|catalyst)/i;

var LOOKBACK_DAYS = 14;            // only look at mail this recent
var MAX_RUN_MS = 4.5 * 60 * 1000;  // stop early; Apps Script kills runs at 6 min
var MAX_TEXT_CHARS = 100000;       // per message
var MAX_LINKS = 300;               // per message
var MAX_ERRORS_LISTED = 5;
var MAX_ERROR_CHARS = 200;

// A link is dropped when its URL or its text matches one of these.
var JUNK_URL_RE = /unsubscribe|optout|opt-out|opt_out|safeunsubscribe|[?&]p=un(&|$)|\/manage\/optin|update.?profile|preferences|forward.?to.?a.?friend|pid=233\b|pid=247\b/i;
var JUNK_TEXT_RE = /unsubscribe|opt.?out|update (your )?profile|manage (your )?(preferences|subscription)|forward (this )?(email|to a friend)|privacy policy|data notice/i;

// ---------------------------------------------------------------------------
// PURE LOGIC (no Gmail/Drive/Utilities calls -- unit-tested offline)
// ---------------------------------------------------------------------------

/** Practice mode unless the property says exactly 'false'; unset -> code default. */
function isDryRun_(propValue, codeDefault) {
  if (propValue === null || propValue === undefined || propValue === '') return codeDefault;
  return String(propValue).trim().toLowerCase() !== 'false';
}

/** Gmail search for the run. Spam and trash are excluded by Gmail itself. */
function buildQuery_(days) {
  return 'newer_than:' + days + 'd';
}

/** "Name <a@b.c>" or "a@b.c" -> { name, email } with the email lower-cased. */
function parseAddress_(header) {
  var s = String(header || '').trim();
  var m = s.match(/^(.*)<([^>]+)>\s*$/);
  if (m) {
    return { name: m[1].replace(/^\s*"|"\s*$/g, '').trim(), email: m[2].trim().toLowerCase() };
  }
  return { name: '', email: s.toLowerCase() };
}

function isAllowedSender_(email, allowed, domains) {
  var e = String(email || '').toLowerCase();
  for (var i = 0; i < (allowed || []).length; i++) {
    if (allowed[i].toLowerCase() === e) return true;
  }
  var at = e.lastIndexOf('@');
  if (at < 1) return false;
  var domain = e.slice(at + 1);
  for (var j = 0; j < (domains || []).length; j++) {
    var d = domains[j].toLowerCase();
    // The domain itself or a subdomain; not a look-alike such as ncssm.edu.evil.com.
    if (domain === d || domain.slice(-(d.length + 1)) === '.' + d) return true;
  }
  return false;
}

/**
 * Forwards. Owner's decision (Nov 3, 2026): newsletters the owner forwards to
 * this inbox are saved too. The forwarding addresses are personal, so they
 * live in the FORWARD_SENDERS Script Property (set in the editor), never in
 * this file or anywhere on GitHub. A message counts only when it comes from
 * one of them, its subject is "Fwd:" or "Fw:", and the original sender named
 * in the forwarded message is an allowed (ncssm.edu) sender. A forward of
 * anything else is ignored. The saved record shows the original sender, and the
 * forwarder's address is removed from the text and links.
 */
function parseForwardSenders_(value) {
  var out = [];
  String(value || '').split(/[,;\s]+/).forEach(function (s) {
    s = s.trim().toLowerCase();
    if (s && s.indexOf('@') > 0) out.push(s);
  });
  return out;
}

function isForwardSubject_(subject) {
  return /^\s*(fwd?|fw)\s*:/i.test(String(subject || ''));
}

/**
 * The "From:" of the first forwarded message in a body, as { name, email } or
 * null. Knows Gmail's "---------- Forwarded message ---------" and Apple
 * Mail's "Begin forwarded message:" (a colon, then a blank line before From:).
 */
function forwardedOriginalSender_(text) {
  var m = String(text || '').match(/forwarded message[\s\-_:]*\r?\n\s*from:[ \t]*([^\r\n]+)/i);
  if (!m) return null;
  var a = parseAddress_(m[1].trim());
  return a.email && a.email.indexOf('@') > 0 ? a : null;
}

/** Removes each address (case-insensitive) from text. */
function scrubAddresses_(text, addrs) {
  var out = String(text || '');
  (addrs || []).forEach(function (a) {
    out = out.split(new RegExp(a.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi')).join('(forwarder)');
  });
  return out;
}

/**
 * How an ignored sender is counted in the heartbeat: NCSSM addresses in
 * full (so a renamed newsletter sender is easy to add), anyone else by
 * domain only.
 */
function ignoredBucket_(email) {
  var e = String(email || '').toLowerCase();
  var at = e.lastIndexOf('@');
  if (at < 0) return '(no address)';
  var domain = e.slice(at + 1);
  if (domain === 'ncssm.edu' || /\.ncssm\.edu$/.test(domain)) return e;
  return domain;
}

/** Signup receipts and similar from an allowed sender: not saved. */
function isSystemSubject_(subject) {
  return SYSTEM_SUBJECT_RE.test(String(subject || ''));
}

function headerValue_(headers, name) {
  var want = name.toLowerCase();
  for (var i = 0; i < (headers || []).length; i++) {
    if (String(headers[i].name).toLowerCase() === want) return headers[i].value;
  }
  return '';
}

/**
 * The first text/plain and text/html body parts of a Gmail API payload,
 * skipping attachments. Returns { text: part|null, html: part|null }.
 */
function findBodyParts_(payload) {
  var found = { text: null, html: null };
  (function walk(part) {
    if (!part) return;
    var mime = String(part.mimeType || '').toLowerCase();
    var isAttachment = part.filename && String(part.filename).length > 0;
    if (!isAttachment && part.body && part.body.data) {
      if (mime === 'text/plain' && !found.text) found.text = part;
      if (mime === 'text/html' && !found.html) found.html = part;
    }
    for (var i = 0; i < (part.parts || []).length; i++) walk(part.parts[i]);
  })(payload);
  return found;
}

var ENTITIES_ = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  rsquo: '\u2019', lsquo: '\u2018', rdquo: '\u201d', ldquo: '\u201c',
  ndash: '\u2013', mdash: '\u2014', hellip: '\u2026', bull: '\u2022', middot: '\u00b7' };

function decodeEntities_(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, function (all, code) {
    if (code[0] === '#') {
      var n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : all;
    }
    var v = ENTITIES_[code.toLowerCase()];
    return v === undefined ? all : v;
  });
}

/** Collapse runs of spaces, trim each line, and allow at most one blank line. */
function tidyWhitespace_(s) {
  return String(s)
    .replace(/\r\n?/g, '\n')
    .replace(/[\u00a0\u200b\u200c\u200d\ufeff\u034f\u00ad]/g, ' ')
    .replace(/[ \t\f\v]+/g, ' ')
    .split('\n').map(function (l) { return l.trim(); }).join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Readable text from newsletter HTML, for messages with no text/plain part. */
function htmlToText_(html) {
  var s = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(head|style|script|title)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|tr|li|h[1-6]|table|blockquote)>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '\n\u2022 ')
    .replace(/<[^>]+>/g, ' ');
  return tidyWhitespace_(decodeEntities_(s));
}

function isJunkLink_(url, text) {
  return JUNK_URL_RE.test(String(url || '')) || JUNK_TEXT_RE.test(String(text || ''));
}

/**
 * Links from newsletter HTML as [{ text, url }]: http(s) only, no junk
 * (unsubscribe and friends), no duplicates, at most MAX_LINKS. Tracking
 * redirects are kept as they are; the collector unwraps them.
 */
function extractLinks_(html, maxLinks) {
  var out = [];
  var seen = {};
  var re = /<a\b[^>]*?\bhref\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi;
  var m;
  while ((m = re.exec(String(html || ''))) !== null) {
    var url = decodeEntities_((m[2] !== undefined ? m[2] : m[3]) || '').trim();
    if (!/^https?:\/\//i.test(url)) continue;
    var inner = m[4];
    var text = tidyWhitespace_(decodeEntities_(inner.replace(/<[^>]+>/g, ' '))).replace(/\n+/g, ' ');
    if (!text) {
      var alt = inner.match(/\balt\s*=\s*("([^"]*)"|'([^']*)')/i);
      text = alt ? decodeEntities_(alt[2] !== undefined ? alt[2] : alt[3]).trim() : '';
    }
    if (isJunkLink_(url, text)) continue;
    var key = url + '\n' + text;
    if (seen[key]) continue;
    seen[key] = true;
    out.push({ text: text, url: url });
    if (out.length >= maxLinks) break;
  }
  return out;
}

/**
 * Plain-text body with junk links removed (inline "<url>" and bare URLs),
 * whitespace tidied and length capped. As in extractLinks_, a link is judged
 * by its URL and by its text: in plain text, the words between the previous
 * link (or the start of the line) and this one, so "Update Profile <url>"
 * loses its URL even when the URL itself looks harmless.
 */
function cleanText_(text, maxChars) {
  var s = String(text || '').split('\n').map(function (line) {
    var last = 0;
    return line.replace(/<(https?:\/\/[^>\s]+)>|https?:\/\/[^\s<>"]+/gi, function (all, bracketed, offset) {
      var label = line.slice(last, offset);
      last = offset + all.length;
      return isJunkLink_(bracketed || all, label) ? '' : all;
    });
  }).join('\n');
  s = tidyWhitespace_(s);
  if (s.length > maxChars) s = s.slice(0, maxChars) + '\n[truncated]';
  return s;
}

/** Message IDs already saved, read from the folder's file names. */
function savedIdsFromNames_(names) {
  var ids = {};
  for (var i = 0; i < names.length; i++) {
    var m = String(names[i]).match(/^\d{4}-\d{2}-\d{2}_([0-9a-zA-Z]+)\.json$/);
    if (m) ids[m[1]] = true;
  }
  return ids;
}

/** "2026-10-08_1a11d4e415ebfb2b.json" (UTC date of when Gmail received it). */
function fileNameFor_(internalDateMs, messageId) {
  return new Date(Number(internalDateMs)).toISOString().slice(0, 10) + '_' + messageId + '.json';
}

/**
 * The saved record. `msg` is a Gmail API message; `bodies` is
 * { text, html } as decoded strings (either may be '').
 */
function buildRecord_(msg, bodies, savedAtIso, forward) {
  var headers = (msg.payload && msg.payload.headers) || [];
  var from = forward ? forward.original : parseAddress_(headerValue_(headers, 'From'));
  var text = bodies.text ? bodies.text : htmlToText_(bodies.html);
  text = cleanText_(text, MAX_TEXT_CHARS);
  var links = extractLinks_(bodies.html, MAX_LINKS);
  if (forward) {
    text = scrubAddresses_(text, forward.forwarders);
    links = links.filter(function (l) {
      return scrubAddresses_(l.url + ' ' + l.text, forward.forwarders).indexOf('(forwarder)') < 0;
    });
  }
  return {
    schema: SCHEMA,
    source: 'email',
    id: msg.id,
    threadId: msg.threadId,
    receivedAt: new Date(Number(msg.internalDate)).toISOString(),
    from: from.email,
    fromName: from.name,
    subject: scrubAddresses_(headerValue_(headers, 'Subject'), forward ? forward.forwarders : []),
    text: text,
    links: links,
    savedAt: savedAtIso,
    savedBy: 'yac-ncssm-news apps-script v' + VERSION
  };
}

function buildHeartbeat_(stats, nowIso) {
  return {
    schema: SCHEMA,
    version: VERSION,
    lastRun: nowIso,
    lookbackDays: LOOKBACK_DAYS,
    seen: stats.seen,
    saved: stats.saved,
    alreadySaved: stats.alreadySaved,
    skipped: stats.skipped,
    ignored: stats.ignored,
    errors: stats.errors,
    errorSamples: stats.errorSamples,
    stoppedEarly: stats.stoppedEarly
  };
}

function newStats_() {
  return { seen: 0, saved: 0, alreadySaved: 0, skipped: 0, ignored: {}, errors: 0, errorSamples: [], stoppedEarly: false };
}

function noteError_(stats, what, e) {
  stats.errors++;
  if (stats.errorSamples.length < MAX_ERRORS_LISTED) {
    stats.errorSamples.push((what + ': ' + (e && e.message ? e.message : String(e))).slice(0, MAX_ERROR_CHARS));
  }
}

// ---------------------------------------------------------------------------
// GOOGLE SERVICES (Advanced Gmail v1 and Drive v3)
// ---------------------------------------------------------------------------

/**
 * Run once from the editor. Creates the folder (drive.file can only see
 * folders this script made), gives the yakkety service account Viewer, and
 * stores the folder ID. Safe to run again.
 */
function setup() {
  var props = PropertiesService.getScriptProperties();
  var folderId = props.getProperty(FOLDER_KEY);
  if (!folderId) {
    var folder = Drive.Files.create({ name: FOLDER_NAME, mimeType: 'application/vnd.google-apps.folder' });
    folderId = folder.id;
    props.setProperty(FOLDER_KEY, folderId);
    Logger.log('Created folder "' + FOLDER_NAME + '".');
  }
  Drive.Permissions.create({ role: 'reader', type: 'user', emailAddress: READER_EMAIL }, folderId,
    { sendNotificationEmail: false });
  Logger.log('Folder: https://drive.google.com/drive/folders/' + folderId);
  Logger.log('Viewer: ' + READER_EMAIL);
  Logger.log('DRY_RUN is ' + (isDryRun_(props.getProperty(DRY_RUN_KEY), DRY_RUN) ?
    'on (practice). Set the DRY_RUN Script Property to false to go live.' : 'off (live).'));
}

/** Trigger entry point. One run at a time. */
function saveNewsletters() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(0)) {
    Logger.log('Previous run still in progress; skipping this one.');
    return;
  }
  try {
    saveNewslettersLocked_();
  } finally {
    lock.releaseLock();
  }
}

function saveNewslettersLocked_() {
  var started = Date.now();
  var props = PropertiesService.getScriptProperties();
  var dryRun = isDryRun_(props.getProperty(DRY_RUN_KEY), DRY_RUN);
  var folderId = props.getProperty(FOLDER_KEY);
  if (dryRun) Logger.log('PRACTICE MODE: nothing will be saved. Set the DRY_RUN Script Property to false to go live.');
  if (!folderId && !dryRun) throw new Error('No ' + FOLDER_KEY + ' Script Property. Run setup() first.');

  var files = folderId ? listFolder_(folderId) : [];
  var savedIds = savedIdsFromNames_(files.map(function (f) { return f.name; }));
  var stats = newStats_();
  var forwarders = parseForwardSenders_(props.getProperty(FORWARD_KEY));

  // Anything that stops the whole run (Gmail down, a quota) is caught so the
  // heartbeat below still says so, then thrown again. A Drive error listing
  // the folder above stops the run before this point: with no listing, the
  // heartbeat can't be found to rewrite, and a stale one is alerted on anyway.
  var runError = null;
  try {
  var ids = listMessageIds_(buildQuery_(LOOKBACK_DAYS));
  for (var i = 0; i < ids.length; i++) {
    if (Date.now() - started > MAX_RUN_MS) {
      stats.stoppedEarly = true;
      Logger.log('Stopping early to stay under the time limit; the rest is picked up next run.');
      break;
    }
    var id = ids[i];
    stats.seen++;
    if (savedIds[id]) { stats.alreadySaved++; continue; }
    try {
      var msg = Gmail.Users.Messages.get('me', id, { format: 'full' });
      var from = parseAddress_(headerValue_(msg.payload.headers, 'From'));
      var subject = headerValue_(msg.payload.headers, 'Subject');
      var parts = findBodyParts_(msg.payload);
      var bodies = {
        text: parts.text ? decodeBody_(parts.text.body.data) : '',
        html: parts.html ? decodeBody_(parts.html.body.data) : ''
      };
      var forward = null;
      if (!isAllowedSender_(from.email, ALLOWED_SENDERS, ALLOWED_DOMAINS)) {
        if (forwarders.indexOf(from.email) >= 0 && isForwardSubject_(subject)) {
          var original = forwardedOriginalSender_(bodies.text ? bodies.text : htmlToText_(bodies.html));
          if (original && isAllowedSender_(original.email, ALLOWED_SENDERS, ALLOWED_DOMAINS)) {
            forward = { original: original, forwarders: forwarders };
          } else {
            stats.ignored['forward (not from NCSSM)'] = (stats.ignored['forward (not from NCSSM)'] || 0) + 1;
            continue;
          }
        } else {
          var bucket = ignoredBucket_(from.email);
          stats.ignored[bucket] = (stats.ignored[bucket] || 0) + 1;
          continue;
        }
      }
      if (isSystemSubject_(subject)) {
        stats.skipped++;
        Logger.log('Skipping signup/system mail: "' + subject + '"');
        continue;
      }
      var record = buildRecord_(msg, bodies, new Date().toISOString(), forward);
      var name = fileNameFor_(msg.internalDate, id);
      if (dryRun) {
        Logger.log('[DRY-RUN] Would save ' + name + ': "' + record.subject + '" from ' + record.from +
          ' (' + record.text.length + ' chars, ' + record.links.length + ' links)');
      } else {
        createJsonFile_(folderId, name, record);
        Logger.log('Saved ' + name + ': "' + record.subject + '"');
      }
      stats.saved++;
    } catch (e) {
      noteError_(stats, 'message ' + id, e);
      Logger.log('FAILED message ' + id + ': ' + (e && e.message ? e.message : e));
    }
  }
  } catch (e) {
    runError = e;
    noteError_(stats, 'run', e);
    Logger.log('RUN FAILED: ' + (e && e.message ? e.message : e));
  }

  var heartbeat = buildHeartbeat_(stats, new Date().toISOString());
  Logger.log('Heartbeat: ' + JSON.stringify(heartbeat));
  if (!dryRun) writeHeartbeat_(folderId, files, heartbeat);
  if (runError) throw runError;
  if (stats.errors > 0) throw new Error(stats.errors + ' message(s) failed to save: ' + stats.errorSamples.join(' | '));
}

/** Gmail API body data: a web-safe base64 string, or bytes in Apps Script. */
function decodeBody_(data) {
  if (typeof data === 'string') {
    return Utilities.newBlob(Utilities.base64DecodeWebSafe(data)).getDataAsString('UTF-8');
  }
  return Utilities.newBlob(data).getDataAsString('UTF-8');
}

function listMessageIds_(query) {
  var ids = [];
  var pageToken;
  do {
    var res = Gmail.Users.Messages.list('me', { q: query, maxResults: 100, pageToken: pageToken });
    (res.messages || []).forEach(function (m) { ids.push(m.id); });
    pageToken = res.nextPageToken;
  } while (pageToken);
  return ids;
}

function listFolder_(folderId) {
  var files = [];
  var pageToken;
  do {
    var res = Drive.Files.list({
      q: "'" + folderId + "' in parents and trashed = false",
      fields: 'nextPageToken, files(id, name)',
      pageSize: 1000,
      pageToken: pageToken
    });
    (res.files || []).forEach(function (f) { files.push({ id: f.id, name: f.name }); });
    pageToken = res.nextPageToken;
  } while (pageToken);
  return files;
}

function jsonBlob_(name, obj) {
  return Utilities.newBlob(JSON.stringify(obj, null, 2), 'application/json', name);
}

function createJsonFile_(folderId, name, obj) {
  return Drive.Files.create({ name: name, parents: [folderId], mimeType: 'application/json' }, jsonBlob_(name, obj));
}

function writeHeartbeat_(folderId, files, heartbeat) {
  for (var i = 0; i < files.length; i++) {
    if (files[i].name === HEARTBEAT_NAME) {
      Drive.Files.update({}, files[i].id, jsonBlob_(HEARTBEAT_NAME, heartbeat));
      return;
    }
  }
  createJsonFile_(folderId, HEARTBEAT_NAME, heartbeat);
}
