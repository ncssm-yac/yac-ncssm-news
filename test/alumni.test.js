// Tests for the notable-alumni list: the Wikipedia parser on made-up wikitext
// shaped like the real page, and checks on the committed data file.
//   node test/alumni.test.js
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const a = require('../collector/alumni');

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); passed++; console.log('PASS ' + name); }
  catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + String(e && e.stack || e).split('\n').slice(0, 4).join('\n     ')); }
}

// Made-up people; markup patterns copied from the real page.
const PAGE = (bullets) => `{{Infobox school|name=Example School}}
Some intro text.

==History==
* [[Not An Alumnus]] 1901, listed in the wrong section

== Notable alumni ==
${bullets}

==See also==
* [[Another Person]] 1999, also in the wrong section
`;

const ENTRIES = [
  "* [[Ada Example]] 1983, President of [[Example College]]<ref>{{cite web|title=Ada named president|url=http://example.test/a?x=1&y=2|access-date=4 May 2018}}</ref><ref>[http://example.test/b Office]. {{Webarchive|url=https://web.archive.org/x |date=January 5, 2010 }}. Retrieved.</ref>",
  "* [[Ben Sample (mathematician)|Ben Sample]] 1984, mathematician<ref name=\"b\" />",
  "*[[Cy Tester]] 1985, attorney currently serving as [[US Assistant Attorney General]] for the [[United States Department of Justice Civil Rights Division|Civil Rights Division]]",
  "* [[Dee Pilot|Dolores Pilot Jones]] 1997, NASA astronaut on [[Expedition 59|Expeditions 59]], [[Expedition 60|60]] and the 2026 mission where she took ''[[Earthset]]''<ref>{{cite news | url=https://example.test/n | title=Landing }}</ref>",
  "* [[Eli Cuber (speedcuber)|Eli Cuber]] 2002, competitive [[Speedcubing|speedcuber]]",
  "* [https://www.example-site.test/ Fay Producer] 2011, Tony award winning producer",
  "* [[Gus Comedy]] 1995 - comedy writer (''[[Bob's Burgers]]'') and four-time Emmy winner",
  "* [[Hal Writer]] 2006, Journalist, staff writer at ''The Atlantic''",
  "* [[Ida Senator]] 1988, member of the [[North Carolina Senate]]",
  "* [[Jo Scholar]] 1992, academic in political science",
  "* [[Kit Musician]] 1995, member of the Grammy-winning [[Group Name]]"
].join('\n');

(async () => {
  await test('only the Notable alumni section is read, and it ends at the next heading', () => {
    const s = a.alumniSection(PAGE(ENTRIES));
    assert.ok(s.includes('Ada Example') && !s.includes('Not An Alumnus') && !s.includes('Another Person'));
    assert.strictEqual(a.alumniSection('==History==\ntext'), null);
    assert.ok(a.alumniSection('==Notable alumni==\n* x').includes('* x'), 'spacing around == does not matter');
  });

  await test('references and templates are stripped, links become plain text', () => {
    assert.strictEqual(a.plainText(a.stripMarkup("<ref>{{cite|a=1}}</ref>[[Foo|bar]] and [[Baz]] ''Title'' [http://x.test Site] {{tpl|{{inner}}}}done")), 'bar and Baz Title Site done');
    assert.strictEqual(a.stripMarkup('a<ref name="x" />b<ref>c</ref>d<!-- hidden -->e'), 'abde');
  });

  await test('every bullet becomes one entry with name, year and a clean description', () => {
    const list = a.parseAlumni(PAGE(ENTRIES));
    assert.strictEqual(list.length, 11);
    const byName = Object.fromEntries(list.map((e) => [e.name, e]));
    assert.deepStrictEqual([byName['Ada Example'].classYear, byName['Ada Example'].description], [1983, 'President of Example College']);
    assert.strictEqual(byName['Cy Tester'].description, 'Attorney currently serving as US Assistant Attorney General for the Civil Rights Division');
    assert.strictEqual(byName['Gus Comedy'].description, "Comedy writer (Bob's Burgers) and four-time Emmy winner");
    assert.ok(!JSON.stringify(list).match(/<ref|\{\{|\[\[|'{2}/), 'no markup left anywhere');
  });

  await test('search names: the label, plus the page title when it differs; Wikipedia link; external sites', () => {
    const byName = Object.fromEntries(a.parseAlumni(PAGE(ENTRIES)).map((e) => [e.name, e]));
    assert.deepStrictEqual(byName['Dolores Pilot Jones'].names, ['Dolores Pilot Jones', 'Dee Pilot']);
    assert.deepStrictEqual(byName['Ben Sample'].names, ['Ben Sample'], 'a parenthetical alone is not another name');
    assert.strictEqual(byName['Ada Example'].wikipedia, 'https://en.wikipedia.org/wiki/Ada_Example');
    assert.strictEqual(byName['Ben Sample'].wikipedia, 'https://en.wikipedia.org/wiki/Ben_Sample_(mathematician)');
    assert.deepStrictEqual([byName['Fay Producer'].wikipedia, byName['Fay Producer'].website], [null, 'https://www.example-site.test/']);
  });

  await test('names shared with someone else are marked, so a later search asks for a second clue', () => {
    const byName = Object.fromEntries(a.parseAlumni(PAGE(ENTRIES)).map((e) => [e.name, e]));
    assert.strictEqual(byName['Eli Cuber'].sharesNameWith, 'speedcuber');
    assert.strictEqual(byName['Ben Sample'].sharesNameWith, 'mathematician');
    assert.strictEqual(byName['Ada Example'].sharesNameWith, null);
  });

  await test('lines that are not "Name year, description" are skipped; duplicates are kept once', () => {
    const noisy = ENTRIES + "\n* Just some words with no link 1999, text\n* [[No Year]] description only\n* [[Ada Example]] 1983, again\nA paragraph line, not a bullet.";
    const list = a.parseAlumni(PAGE(noisy));
    assert.strictEqual(list.length, 11);
    assert.ok(!list.some((e) => e.name === 'No Year'));
  });

  await test('a page that changed shape is an error, not an empty list', () => {
    assert.throws(() => a.parseAlumni('==History==\ntext'), /no "Notable alumni" section/);
    assert.throws(() => a.parseAlumni(PAGE('* [[Only One]] 1999, alone')), /only 1 alumni found/);
  });

  await test('fetching retries a 429 using Retry-After, and gives up on a 404', async () => {
    const calls = []; const waits = [];
    const f = async (url, opts) => {
      calls.push(opts.headers['User-Agent']);
      return calls.length < 3 ? { ok: false, status: 429, headers: new Map([['retry-after', '7']]) } : { ok: true, status: 200, text: async () => 'wikitext' };
    };
    assert.strictEqual(await a.fetchWikitext({ fetch: f, sleep: async (ms) => waits.push(ms) }), 'wikitext');
    assert.deepStrictEqual(waits, [7000, 7000]);
    assert.ok(/yac-ncssm-news/.test(calls[0]), 'identifies itself to Wikimedia');
    await assert.rejects(a.fetchWikitext({ fetch: async () => ({ ok: false, status: 404, headers: new Map() }), sleep: async () => {} }), /answered 404/);
  });

  await test('the committed list is well formed, sourced and free of personal data fields', () => {
    const file = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'notable-alumni.json'), 'utf8'));
    assert.strictEqual(file.schema, 1);
    assert.ok(/CC BY-SA/.test(file.source.license) && /wikipedia\.org/.test(file.source.url) && /^\d{4}-\d{2}-\d{2}$/.test(file.source.retrievedOn));
    assert.ok(file.alumni.length >= a.MIN_ENTRIES);
    const seen = new Set();
    for (const e of file.alumni) {
      assert.deepStrictEqual(Object.keys(e).sort(), ['classYear', 'description', 'name', 'names', 'sharesNameWith', 'website', 'wikipedia']);
      assert.ok(e.name && e.names[0] === e.name && e.description, e.name);
      assert.ok(e.classYear >= 1980 && e.classYear <= new Date().getFullYear(), e.name);
      assert.ok(e.wikipedia || e.website, e.name + ' needs a public source');
      assert.ok(!seen.has(e.name), 'duplicate ' + e.name); seen.add(e.name);
    }
  });

  console.log('\n' + passed + ' passed, ' + failed + ' failed');
  process.exit(failed ? 1 : 0);
})();
