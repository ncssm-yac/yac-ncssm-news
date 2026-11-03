# Setting up the NCSSM News inbox

The Apps Script runs in **ncssm.yac.yakkety@gmail.com** and copies NCSSM
newsletters into a Drive folder that Yakkety can read. About 20 minutes,
once.

## 1. The account

- Two-step verification on. Recovery email and phone belong to a YAC
  officer, not one person's personal account only.
- Nothing else is ever sent to this address. It exists only to receive the
  newsletters below.

## 2. Subscribe it to the newsletters

At <https://www.ncssm.edu/newsletter-signup>, subscribe
`ncssm.yac.yakkety@gmail.com` to:

| Newsletter | Sent from (any ncssm.edu address is saved: `ALLOWED_DOMAINS` in `Code.gs`) |
| --- | --- |
| Catalyst | `communications@ncssm.edu` |
| NCSSM-Durham Update | `terry.lynch@ncssm.edu` |
| NCSSM-Morganton Update | `kevin.baxter@ncssm.edu` |
| NCSSM Foundation newsletter | `giving@ncssm.edu` |
| Extended Learning Update | not known yet: see step 7 |

Also add the address to the **NCSSM Alumni Network** list
(`ncssm-alumni-relations@alumni.ncssm.edu`), for example by asking Alumni
Relations.

Each signup sends a confirmation email. Open the account and click each one.
No Gmail filters or labels are needed: the script decides what to save.

## 3. Create the script

1. Signed in as ncssm.yac.yakkety@gmail.com, open <https://script.google.com>
   and create a project named **NCSSM News inbox**.
2. Project Settings → tick **Show "appsscript.json" manifest file in editor**.
3. Replace `appsscript.json` with `apps-script/appsscript.json` from this repo.
4. Replace `Code.gs` with `apps-script/Code.gs`. Add a script file named
   `Tests` and paste `apps-script/Tests.gs`.
5. Save. The manifest turns on the Gmail and Drive advanced services; there
   is nothing to add under Services by hand.

## 4. Check it and grant access

1. Run **runTests**. The log should end `ALL PASSED`. It needs no access.
2. Run **setup**. Google asks for two permissions: *read your email* and
   *see and edit only the Drive files this app creates*. Google will show
   "Google hasn't verified this app": choose Advanced → Go to NCSSM News
   inbox. That warning is normal for a script you wrote yourself.
3. The log shows the new **NCSSM News inbox** folder link and that
   `yakkety@ncssm-yac.iam.gserviceaccount.com` is a Viewer. Copy the folder
   link into the yakkety repo's `docs/ncssm-news.md`.

## 5. Practice run

Run **saveNewsletters**. It starts in practice mode: the log lists each
newsletter it *would* save, and the heartbeat line shows what it ignored.
Nothing is written. Check the list looks right.

## 6. Go live

1. Project Settings → Script Properties → add `DRY_RUN` = `false`.
2. Run **saveNewsletters** once. The folder now has one `.json` file per
   newsletter from the last 14 days, plus `_heartbeat.json`.
3. Triggers (clock icon) → Add Trigger → function `saveNewsletters`,
   event source **Time-driven**, **Day timer**, **5am to 6am**. Failure
   notifications: **Notify me daily**. Once a day is enough: the digest runs
   weekly, and the daily **Collect** workflow (7:30 AM Eastern) treats the
   inbox as stopped when `_heartbeat.json` is over 30 hours old.

## 7. Later

- **A newsletter isn't being saved.** Open `_heartbeat.json`. Its `ignored`
  list shows every NCSSM address the script skipped. Any ncssm.edu sender is saved already. For
  a sender outside ncssm.edu, add it to `ALLOWED_SENDERS` here, merge, and paste the new `Code.gs`.
- **Updating the script.** The script isn't deployed from GitHub: after a
  merge, paste the changed files into the editor and save. The `DRY_RUN`
  and `INBOX_FOLDER_ID` Script Properties survive a paste.
- **Pausing.** Set `DRY_RUN` to `true`, or delete the trigger.
- **Failure emails** go to this account, which nobody reads. The YAC monitor
  watches `_heartbeat.json` instead (stale, or `errors` above 0).
