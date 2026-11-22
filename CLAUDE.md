# CLAUDE.md

Collection for NCSSM News, Yakkety's weekly digest of NCSSM news for YAC.
Deterministic code only: no model calls, prompts or agent logic here (those
live in `ncssm-yac/yakkety`, `ncssm-news` skill).

- `apps-script/` runs in ncssm.yac.yakkety@gmail.com as **NCSSM News inbox**,
  and deploys on merge through `.github/workflows/apps-script.yml` (YAC's
  shared deploy). Never edit it in the editor. Keep its scopes to
  `gmail.readonly` and `drive.file`; it must never send, label or delete
  mail. Only mail from `ALLOWED_DOMAINS` (ncssm.edu and its subdomains) or an exact
  `ALLOWED_SENDERS` address is saved (owner, Nov 3, 2026: this inbox is
  dedicated and low-sensitivity, so all NCSSM mail is considered, including the
  Foundation newsletter), and unsubscribe-type links are never saved. Forwards from the addresses in
  the `FORWARD_SENDERS` Script Property (set in the editor, never in this repo:
  they are personal addresses) are saved when the original sender is
  `ncssm.edu`; the forwarder's address is scrubbed from the record.
- `collector/` reads public pages (ncssm.edu, Google News) and the Drive
  inbox, read-only, and writes `items.json`. `lib.js` stays pure. It keeps no
  state, never logs article or newsletter text, and never prints a key.
  A source it can't read is an error, not an empty list.
- `digest/` checks Yakkety's `digest.json` and builds the YAC IT draft. It never
  edits the post: the draft and the approved post carry the skill's text
  unchanged, and a digest that doesn't validate fails the run.
- `data/notable-alumni.json` is public figures and public facts from Wikipedia
  only, with its source and licence. Never add details from the Alumni
  Network directory, and never put member personal data in `data/`.
- Pure logic stays separate from Gmail/Drive/Utilities calls and is tested
  offline. Practice mode (`DRY_RUN`) is the default, and every run must be
  safe to repeat.
- The saved JSON shape (`SCHEMA`) is read by the collector and by yakkety's
  `ncssm-news` skill: change all three together.
- Newsletters are public NCSSM mail. Anything else that reaches the account
  is never saved, logged or committed. Test fixtures are made up.
- Never commit secrets.
- `npm test` before every push.
