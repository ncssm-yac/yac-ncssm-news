# yac-ncssm-news

The deterministic half of **NCSSM News**: Yakkety's biweekly digest of
what's happening at NCSSM, for the NCSSM Young Alumni Council. This repo
collects and cleans the news. Judging what's interesting, scoring it and
writing the digest is Yakkety's job and lives in
[`ncssm-yac/yakkety`](https://github.com/ncssm-yac/yakkety) (`ncssm-news`
skill).

```
NCSSM newsletters ──► ncssm.yac.yakkety@gmail.com
                         │  apps-script/ (daily, read-only Gmail)
                         ▼
                      Drive: "NCSSM News inbox"  (one JSON per newsletter
                         │                         + _heartbeat.json)
ncssm.edu/news ─┐        │  yakkety service account, Viewer
ncssm.edu/events┤        │
Google News ────┴──► collector/  ──► items.json
                         ▼
                      Yakkety, Monday: split, score, draft ──► YAC IT
                                                               (then NCSSM News,
                                                                after approval)
```

## What's here

| Path | What |
| --- | --- |
| `apps-script/Code.gs` | Saves each newsletter from an allowlisted sender as JSON in the Drive folder. Read-only Gmail, Drive limited to its own folder, practice mode by default, one run at a time, never saves the same message twice, drops unsubscribe links. Entry points: `setup`, `saveNewsletters` |
| `apps-script/Tests.gs` | Unit tests for the pure logic (`runTests`, also runnable in the editor) |
| `apps-script/appsscript.json` | Manifest: `gmail.readonly` and `drive.file` scopes, Gmail v1 and Drive v3 advanced services |
| `test/run-tests.js` | Runs the unit tests, then `setup` and `saveNewsletters` end to end against a fake Gmail and Drive |
| `docs/SETUP.md` | Setting up the account, the script and the trigger |
| `collector/` | `run.js` gathers everything into one `items.json`; `lib.js` has the parsers (pure, no network); `google.js` reads the Drive folder as the yakkety service account (read-only) |
| `test/collector.test.js` | The collector's tests: parsers on made-up pages, then whole runs against a fake web and Drive |
| `collector/alumni.js`, `data/notable-alumni.json` | The notable-alumni list, built from the "Notable alumni" section of NCSSM's Wikipedia page. See below |
| `test/alumni.test.js` | Tests for that parser, and checks on the committed list |
| `digest/lib.js`, `digest/cli.js` | The plain-code edges of the Monday digest: check Yakkety's `digest.json`, build the YAC IT draft around it, turn an approved one into the post. See below |
| `test/digest.test.js` | Tests for those |
| `.github/workflows/collect.yml` | Daily early-warning run; keeps `items.json` as an artifact for 14 days |

## Collector

```bash
node collector/run.js --out items.json            # all sources
node collector/run.js --no-drive --out items.json # without the newsletter inbox
```

Options: `--days 10` (how far back articles go; the digest run uses 17), `--ahead 28` (how far ahead
events go), `--newsletter-days 35`, `--allow-partial` (exit 0 even if a
source failed; Yakkety's digest run uses it). It needs
`YAKKETY_GOOGLE_KEY` (the service account's JSON key) and
`NCSSM_NEWS_INBOX_FOLDER_ID` for the newsletters. Logs show counts only, not
content or keys.

It is **stateless**: every run rebuilds the last few days from scratch, so a
missed run costs nothing and there is nothing to store.

| Source | What it gives | Notes |
| --- | --- | --- |
| ncssm.edu/news | NCSSM's own stories, with the text of each, plus the outside coverage the page links to | Outside pages are read for their date (the list has none); ones with no findable date are left out |
| ncssm.edu/events | Upcoming events: dates, place, sign-up link | Past and far-off events are filtered out |
| Google News | Press coverage from two searches (NCSSM, and alumni described as NCSSM graduates) | Sports schedules, rosters and live streams are dropped. Links stay Google News links (their real addresses can't be unwrapped), and there's no article text, so each item says `textFetched: false` |
| Newsletter inbox | The saved newsletters, with tracking links unwrapped (Blackbaud offline, Constant Contact by following the redirect) | Fails the run if the inbox script's heartbeat is over 30 hours old, reports errors, or is missing |

`items.json` has `sources` (ok or error, per source), `counts`, and `items`:
`kind` is `article`, `event` or `newsletter`. Each has `textFetched`, so
Yakkety only summarizes text that was actually read. The same story from two
sources is kept once, from the better one. A newsletter is never split here:
it holds several stories, and Yakkety separates them.

A broken source fails the run (and the daily **Collect** workflow). The usual
cause is ncssm.edu changing its page layout: the error says which page.

To run the daily workflow, add the repository secret `YAKKETY_GOOGLE_KEY` and
the repository variable `NCSSM_NEWS_INBOX_FOLDER_ID`
(`1Td05tbtTjo9N5ltUSEBXaN-uR6qm4Y5t`).

## Notable alumni

`data/notable-alumni.json` lists the alumni named on NCSSM's Wikipedia page:
18 people, each with `name`, `names` (what to search for), `classYear`, a
`description`, and a public source (`wikipedia` or `website`). It is a
**starting list**: widening it is on the roadmap (see
`docs/ncssm-news.md` in `ncssm-yac/yakkety`).

```bash
npm run alumni          # re-read Wikipedia and rewrite the file
node collector/alumni.js --from-file page.wikitext --out data/notable-alumni.json
```

- **Public information only.** It holds public figures and facts from
  Wikipedia. It never reads the Alumni Network directory, and no member
  details go in this file.
- **Licence.** The wording comes from Wikipedia (CC BY-SA 4.0), so the file
  records its source, licence and retrieval date. Keep that if you edit it.
- `sharesNameWith` is set when Wikipedia needed a "(speedcuber)"-style
  suffix to tell people apart. A news search for such a name needs a second
  clue, or it will find the wrong person.
- A page that changes shape is an error (no section, or under 10 people), so
  a quiet Wikipedia edit can't silently empty the list.
- Wikimedia rate-limits shared addresses (it did in the cloud session that
  built this). The script identifies itself and retries using `Retry-After`;
  if it still fails, run it again later or from your own machine.

## The biweekly digest

Yakkety (the `ncssm-news` skill in `ncssm-yac/yakkety`) writes `digest.json`;
`digest/` is the plain code around it, which the two workflows in `yakkety`
call (**NCSSM News digest**, every other Monday 8 AM Eastern from Nov 2, 2026, and **Send approved NCSSM
News post**).

```json
{ "week": "2026-10-12", "text": "<the post>", "items": [{ "id": "a1", "title": "...", "url": "https://..." }] }
```

A week with nothing worth posting is `{ "week": "2026-10-12", "quiet": true, "items": [] }`.
A missing file is a failed run, never a quiet week.

```bash
node digest/cli.js check   --digest digest.json                     # is it usable?
node digest/cli.js kind    --digest digest.json                     # "digest" or "quiet"
node digest/cli.js draft   --digest digest.json --items items.json --run-id 123 --run-url https://...
node digest/cli.js quiet   --digest digest.json --items items.json --run-url https://...
node digest/cli.js posted  --digest digest.json --items items.json --run-url https://...   # note for YAC IT after posting
node digest/cli.js approve --digest digest.json                     # the post for NCSSM News
```

- **The post goes out without approval** (owner's decision, Oct 22, 2026).
  `approve` builds it: the skill's post, unchanged. After it is posted,
  `posted` builds the note for YAC IT: how many stories, any collector
  source that failed (names only), and a link to the run with every story's
  score. `draft` (the post wrapped as "not sent yet") is still there for a
  person who wants to hold a digest back.
- **`items`** lists every story the post carries, so next week's run can skip
  them. A post with stories and an empty `items` is refused.
- A post over 3,500 characters, a post that still has the draft wrapper, or a
  link that isn't `http(s)` is refused rather than fixed.

## Saved record

`<YYYY-MM-DD>_<gmail message id>.json`:

```json
{
  "schema": 1,
  "source": "email",
  "id": "1a11d4e415ebfb2b",
  "threadId": "1a11d4e415ebfb2b",
  "receivedAt": "2026-10-08T20:55:48.000Z",
  "from": "communications@ncssm.edu",
  "fromName": "NCSSM",
  "subject": "Catalyst: Alumni annual meeting, #1 public high school, NCSSM Connect",
  "text": "From Chancellor Roberts ...",
  "links": [{ "text": "Niche.com", "url": "https://bbox.blackbaudhosting.com/...page.redir?target=..." }],
  "savedAt": "2026-10-15T13:00:04.000Z",
  "savedBy": "yac-ncssm-news apps-script v1.0.1"
}
```

Links are saved as they appear (tracking redirects included); the collector
unwraps them. Unsubscribe, update-profile, forward and privacy links are
never saved. Changing this shape means bumping `SCHEMA` and updating the
collector and the yakkety skill in step.

## Run tests

```bash
npm test
```

Node only, no packages. Expected: `ALL PASSED (47 checks)`,
`38/38 end-to-end checks passed.`, `18 passed, 0 failed` for the collector and
`9 passed, 0 failed` for the alumni list and `9 passed, 0 failed` for the digest.

## Deploy

Paste-deployed, like the meeting notes relocator: see
[docs/SETUP.md](docs/SETUP.md).

## Contacts

- Owner: Akhil Jariwala
