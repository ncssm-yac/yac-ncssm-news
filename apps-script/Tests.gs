/**
 * NCSSM News inbox -- unit tests for the pure logic in Code.gs.
 *
 * No Gmail or Drive calls and no authorization needed. In the Apps Script
 * editor: select runTests, press Run, and read the Execution log. Locally:
 * `npm test` (test/run-tests.js also runs end-to-end checks with a fake
 * Gmail and Drive).
 *
 * Fixtures are made up, shaped like the real newsletters (Blackbaud for
 * Catalyst, Constant Contact for the campus Updates).
 */

var T_CATALYST_HTML =
  '<html><head><style>p{color:red}</style><title>Catalyst</title></head><body>' +
  '<p>From Chancellor Roberts</p>' +
  '<p>NCSSM was named the No. 1 public high school &amp; more.</p>' +
  '<a href="https://bbox.blackbaudhosting.com/webforms/service/page.redir?target=https%3a%2f%2fwww.niche.com%2fk12&amp;srcid=1">Niche.com</a>' +
  '<a href="https://bbox.blackbaudhosting.com/webforms/service/page.redir?target=https%3a%2f%2fwww.niche.com%2fk12&amp;srcid=1">Niche.com</a>' +
  '<a href=\'https://alumni.ncssm.edu/e/alumni-weekend\'><img src="x.png" alt="Alumni Weekend"></a>' +
  '<a href="https://bbox.blackbaudhosting.com/webforms/service/page.aspx?pid=233&amp;srctid=1">Unsubscribe</a>' +
  '<a href="https://bbox.blackbaudhosting.com/webforms/service/page.aspx?pid=247">Privacy Policy</a>' +
  '<a href="mailto:connect@ncssm.edu">email us</a>' +
  '<ul><li>Oct. 16 &bull; Annual Meeting</li><li>Nov. 7 &#8226; Open House</li></ul>' +
  '</body></html>';

var T_CC_HTML =
  '<div>Greetings Akhil,</div><div>Family Day was a hit!&nbsp;</div>' +
  '<a href="https://r20.rs6.net/tn.jsp?f=001abc&amp;c=xyz">Learn more.</a>' +
  '<a href="https://visitor.constantcontact.com/do?p=un&amp;m=001">Unsubscribe</a>' +
  '<a href="https://visitor.constantcontact.com/do?p=oo&amp;m=001">Update Profile</a>' +
  '<a href="https://myemail.constantcontact.com/NCSSM-Morganton-Update.html?soid=1&amp;aid=2">View as Webpage</a>';

function runTests() {
  var pass = 0, fail = 0;
  function ok(cond, name) {
    if (cond) { pass++; } else { fail++; log_('FAIL: ' + name); }
  }
  function eq(a, b, name) {
    var sa = JSON.stringify(a), sb = JSON.stringify(b);
    ok(sa === sb, name + ' (got ' + sa + ', want ' + sb + ')');
  }

  // isDryRun_
  eq(isDryRun_(null, true), true, 'unset property -> code default (practice)');
  eq(isDryRun_(null, false), false, 'unset property -> code default (live)');
  eq(isDryRun_('false', true), false, "'false' -> live");
  eq(isDryRun_(' FALSE ', true), false, "' FALSE ' -> live");
  eq(isDryRun_('true', false), true, "'true' -> practice");
  eq(isDryRun_('no', false), true, 'anything else -> practice');

  // buildQuery_
  eq(buildQuery_(14), 'newer_than:14d', 'query');

  // parseAddress_
  eq(parseAddress_('"Terry Lynch" <Terry.Lynch@ncssm.edu>'), { name: 'Terry Lynch', email: 'terry.lynch@ncssm.edu' }, 'quoted name');
  eq(parseAddress_('NCSSM <communications@ncssm.edu>'), { name: 'NCSSM', email: 'communications@ncssm.edu' }, 'plain name');
  eq(parseAddress_('kevin.baxter@ncssm.edu'), { name: '', email: 'kevin.baxter@ncssm.edu' }, 'bare address');
  eq(parseAddress_(''), { name: '', email: '' }, 'empty');

  // isAllowedSender_
  ok(isAllowedSender_('communications@ncssm.edu', ALLOWED_SENDERS), 'Catalyst allowed');
  ok(isAllowedSender_('Kevin.Baxter@NCSSM.edu', ALLOWED_SENDERS), 'case-insensitive');
  ok(!isAllowedSender_('winslow@ncssm.edu', ALLOWED_SENDERS), 'other NCSSM sender refused');
  ok(!isAllowedSender_('communications@ncssm.edu.evil.com', ALLOWED_SENDERS), 'look-alike domain refused');
  ok(!isAllowedSender_('', ALLOWED_SENDERS), 'empty refused');

  // ignoredBucket_
  eq(ignoredBucket_('someone@ncssm.edu'), 'someone@ncssm.edu', 'NCSSM sender kept in full');
  eq(ignoredBucket_('news@alumni.ncssm.edu'), 'news@alumni.ncssm.edu', 'NCSSM subdomain kept in full');
  eq(ignoredBucket_('person@gmail.com'), 'gmail.com', 'others by domain only');
  eq(ignoredBucket_('junk'), '(no address)', 'no @');

  // findBodyParts_
  var payload = { mimeType: 'multipart/mixed', parts: [
    { mimeType: 'multipart/alternative', parts: [
      { mimeType: 'text/plain', body: { data: 'P' } },
      { mimeType: 'text/html', body: { data: 'H' } }
    ] },
    { mimeType: 'text/html', filename: 'flyer.html', body: { attachmentId: 'a1' } }
  ] };
  var parts = findBodyParts_(payload);
  eq([parts.text.body.data, parts.html.body.data], ['P', 'H'], 'nested parts found');
  var single = findBodyParts_({ mimeType: 'text/html', body: { data: 'H' } });
  eq([single.text, single.html.body.data], [null, 'H'], 'single-part HTML');
  eq(findBodyParts_({ mimeType: 'text/plain', filename: 'a.txt', body: { data: 'X' } }).text, null, 'attachment skipped');

  // decodeEntities_ / htmlToText_
  eq(decodeEntities_('A &amp; B &#8226; C &#x2019; &nbsp;&bogus;'), 'A & B • C ’  &bogus;', 'entities');
  var text = htmlToText_(T_CATALYST_HTML);
  ok(text.indexOf('From Chancellor Roberts\nNCSSM was named the No. 1 public high school & more.') === 0, 'html -> text paragraphs');
  ok(text.indexOf('color:red') < 0 && text.indexOf('Catalyst') < 0, 'style and title dropped');
  ok(text.indexOf('• Oct. 16 • Annual Meeting') >= 0, 'list items bulleted');

  // extractLinks_
  var links = extractLinks_(T_CATALYST_HTML, 300);
  eq(links.map(function (l) { return l.text; }), ['Niche.com', 'Alumni Weekend'], 'catalyst links: deduped, img alt, junk and mailto dropped');
  eq(links[0].url, 'https://bbox.blackbaudhosting.com/webforms/service/page.redir?target=https%3a%2f%2fwww.niche.com%2fk12&srcid=1', '&amp; decoded in URL');
  var ccLinks = extractLinks_(T_CC_HTML, 300);
  eq(ccLinks.map(function (l) { return l.text; }), ['Learn more.', 'View as Webpage'], 'constant contact: unsubscribe and profile dropped, web version kept');
  eq(extractLinks_(T_CATALYST_HTML, 1).length, 1, 'link cap');
  eq(extractLinks_('', 300), [], 'no html');

  // cleanText_
  var plain = 'Read <https://www.ncssm.edu/news> now.\n\n\n\nUnsubscribe <https://bbox.blackbaudhosting.com/webforms/service/page.aspx?pid=233&srctid=1>\n' +
    'Or https://visitor.constantcontact.com/do?p=un&m=001 here';
  eq(cleanText_(plain, 1000), 'Read <https://www.ncssm.edu/news> now.\n\nUnsubscribe\nOr here', 'junk URLs removed, blank lines collapsed');
  eq(cleanText_('abcdef', 3), 'abc\n[truncated]', 'length cap');

  // savedIdsFromNames_ / fileNameFor_
  var ids = savedIdsFromNames_(['2026-10-08_1a11d4e415ebfb2b.json', '_heartbeat.json', 'notes.txt']);
  eq(Object.keys(ids), ['1a11d4e415ebfb2b'], 'ids from file names; heartbeat ignored');
  eq(fileNameFor_('1791492948000', '1a11d4e415ebfb2b'), '2026-10-08_1a11d4e415ebfb2b.json', 'file name');

  // buildRecord_
  var msg = { id: 'm1', threadId: 't1', internalDate: '1791492948000', payload: { headers: [
    { name: 'From', value: 'NCSSM <communications@ncssm.edu>' },
    { name: 'Subject', value: 'Catalyst: Alumni annual meeting' },
    { name: 'To', value: 'ncssm.yac.yakkety@gmail.com' }
  ] } };
  var rec = buildRecord_(msg, { text: '', html: T_CATALYST_HTML }, '2026-10-08T21:00:00.000Z');
  eq([rec.schema, rec.source, rec.id, rec.threadId, rec.from, rec.fromName, rec.subject, rec.receivedAt],
    [1, 'email', 'm1', 't1', 'communications@ncssm.edu', 'NCSSM', 'Catalyst: Alumni annual meeting', '2026-10-08T20:55:48.000Z'], 'record fields');
  ok(rec.text.indexOf('From Chancellor Roberts') === 0, 'text falls back to HTML');
  ok(JSON.stringify(rec).indexOf('pid=233') < 0, 'no unsubscribe link anywhere in the record');
  ok(rec.to === undefined, 'recipient not saved');
  var rec2 = buildRecord_(msg, { text: 'Plain body', html: '' }, 'x');
  eq([rec2.text, rec2.links], ['Plain body', []], 'plain text preferred; no html -> no links');

  // buildHeartbeat_
  var st = newStats_();
  noteError_(st, 'message m9', new Error('boom'));
  var hb = buildHeartbeat_(st, '2026-10-15T12:00:00.000Z');
  eq([hb.errors, hb.errorSamples, hb.lastRun, hb.version], [1, ['message m9: boom'], '2026-10-15T12:00:00.000Z', VERSION], 'heartbeat');

  log_((fail === 0 ? 'ALL PASSED' : fail + ' FAILED') + ' (' + (pass + fail) + ' checks)');
  if (fail > 0) throw new Error(fail + ' test(s) failed');
}

function log_(msg) {
  if (typeof Logger !== 'undefined' && Logger.log) { Logger.log(msg); }
  else { console.log(msg); }
}
