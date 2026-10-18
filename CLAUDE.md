# CLAUDE.md

Collection for NCSSM News, Yakkety's weekly digest of NCSSM news for YAC.
Deterministic code only: no model calls, prompts or agent logic here (those
live in `ncssm-yac/yakkety`, `ncssm-news` skill).

- `apps-script/` runs in ncssm.yac.yakkety@gmail.com. Keep its scopes to
  `gmail.readonly` and `drive.file`; it must never send, label or delete
  mail. Only `ALLOWED_SENDERS` are saved, and unsubscribe-type links are
  never saved.
- `collector/` reads public pages (ncssm.edu, Google News) and the Drive
  inbox, read-only, and writes `items.json`. `lib.js` stays pure. It keeps no
  state, never logs article or newsletter text, and never prints a key.
  A source it can't read is an error, not an empty list.
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
