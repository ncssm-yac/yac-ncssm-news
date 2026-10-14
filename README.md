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
Google News ────┴──► collector/ (planned: daily GitHub Action)
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

Planned: `collector/` (ncssm.edu/news scraper, Google News filter, link
unwrapping, reading the Drive folder) and its scheduled workflow.

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

Node only, no packages. Expected: `ALL PASSED (47 checks)` and
`38/38 end-to-end checks passed.`

## Deploy

Paste-deployed, like the meeting notes relocator: see
[docs/SETUP.md](docs/SETUP.md).

## Contacts

- Owner: Akhil Jariwala
