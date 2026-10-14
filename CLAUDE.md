# CLAUDE.md

Collection for NCSSM News, Yakkety's weekly digest of NCSSM news for YAC.
Deterministic code only: no model calls, prompts or agent logic here (those
live in `ncssm-yac/yakkety`, `ncssm-news` skill).

- `apps-script/` runs in ncssm.yac.yakkety@gmail.com. Keep its scopes to
  `gmail.readonly` and `drive.file`; it must never send, label or delete
  mail. Only `ALLOWED_SENDERS` are saved, and unsubscribe-type links are
  never saved.
- Pure logic stays separate from Gmail/Drive/Utilities calls and is tested
  offline. Practice mode (`DRY_RUN`) is the default, and every run must be
  safe to repeat.
- The saved JSON shape (`SCHEMA`) is read by the collector and by yakkety's
  `ncssm-news` skill: change all three together.
- Newsletters are public NCSSM mail. Anything else that reaches the account
  is never saved, logged or committed. Test fixtures are made up.
- Never commit secrets.
- `npm test` before every push.
