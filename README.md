# yac-ncssm-news

The deterministic half of **NCSSM News**: Yakkety's weekly Monday digest of
what's happening at NCSSM, for the NCSSM Young Alumni Council. This repo
collects and cleans the news. Judging what's interesting, scoring it and
writing the digest is Yakkety's job and lives in
[`ncssm-yac/yakkety`](https://github.com/ncssm-yac/yakkety) (`ncssm-news`
skill).

```
NCSSM newsletters ──► ncssm.yac.yakkety@gmail.com
                         │  apps-script/ (hourly, read-only Gmail)
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
| `.github/workflows/collect.yml` | Daily early-warning run; keeps `items.json` as an artifact for 14 days |

## Collector

```bash
node collector/run.js --out items.json            # all sources
node collector/run.js --no-drive --out items.json # without the newsletter inbox
```

Options: `--days 10` (how far back articles go), `--ahead 28` (how far ahead
events go), `--newsletter-days 35`, `--allow-partial` (exit 0 even if a
source failed; Yakkety's Monday run uses it). It needs
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
| Newsletter inbox | The saved newsletters, with tracking links unwrapped (Blackbaud offline, Constant Contact by following the redirect) | Fails the run if the inbox script's heartbeat is over 6 hours old, reports errors, or is missing |

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
`38/38 end-to-end checks passed.` and `18 passed, 0 failed` for the collector.

## Deploy

Paste-deployed, like the meeting notes relocator: see
[docs/SETUP.md](docs/SETUP.md).

## Contacts

- Owner: Akhil Jariwala
