# Data retention: what is built, what is not, and how to switch it on

The periods are in section 11 of `privacy-policy-DRAFT.html`. Migration `20261108220000_data_retention.sql` adds `gayze_run_retention(p_apply boolean)`, which either **counts** (false) or **deletes** (true) in one pass. Deletion is permanent, so nothing runs by itself.

## Steps
1. Apply the migration (it only creates a function, a queue table and a `legal_hold` column on reports).
2. Preview, which changes nothing: `select * from public.gayze_run_retention(false);`
3. Read the counts. If they match what you expect, run it once by hand: `select * from public.gayze_run_retention(true);`
4. Only then schedule it daily: `select cron.schedule('gayze-data-retention', '17 3 * * *', 'select public.gayze_run_retention(true)');`
5. Remove event picture files: pictures are queued in `public.storage_purge_queue`. A small server function must remove those files from storage (SQL cannot). It is not written yet; until it is, queued files stay in storage.

## Not built yet (so the policy marks them to confirm)
- **Old device records.** Deleting a device can delete the key envelopes it created for other devices and lock people out of chats. Needs a careful foreign-key review first.
- **Inactive-account deletion at 24 months.** Needs a warning email and a sender.
- **Banned or underage re-registration block.** Needs a stored one-way identifier.
- **Logs and backups.** Set by the hosting plan; confirm the actual periods.

## To hold a report longer
`update public.reports set legal_hold = true where id = '...';`
