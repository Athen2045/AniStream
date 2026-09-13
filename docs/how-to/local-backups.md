# Back up local progress

Open **Profile → Local progress and backups**. This works with or without an AniList connection.
Choose **Export backup**, then save the JSON file using the Mac save dialog.

The backup contains the latest locally recorded activity for each title, anime and manga resume
points, per-title manga language/group preferences, reader width/fit/image quality, and dismissed
release notices. Locally recorded activity from different sign-ins is combined by exact AniList ID;
the most recent journal row for each title is retained.

Account connections, credentials, pending sync operations, AniList lists and ratings, catalog caches,
and For You feedback are excluded. Artwork is omitted; restored Continue cards have an anime/manga
placeholder until fresh metadata is available. The JSON file is unencrypted and contains your title
history and reading/watching positions.

## Restore a backup

1. Choose **Choose backup to restore** and select an AniStream JSON backup.
2. Review the counts of missing items that can be added and existing items that will be kept.
3. Choose **Add missing items**, or **Cancel restore** to leave the device unchanged.

Restore preserves existing data. If a title already has any local activity or a resume point, its
entire imported history/resume bundle is skipped. This prevents an old backup from restoring a
checkpoint for a title you already completed. Saved manga preferences, reader settings, and release
notices also keep their current values. Default reader settings can be imported when no explicit
settings have been saved yet.

Imported history remains local and is never queued for AniList sync. New watching/reading after
restore follows the usual account rules. Reader preferences apply when you next open a chapter.
Restoring the same backup again does not add duplicates. The final counts can differ from the preview
if you use the app while reviewing it; conflicts are checked again inside the restore transaction.

## If something fails

A preview lasts five minutes. Choose the file again if it expires or a restore fails. All imported
database changes share one transaction: a failed restore leaves the database unchanged. Export
writes a temporary file beside the selected destination and replaces the destination only after the
complete file has been written and flushed.

Only version 1 AniStream backups are accepted, up to 10 MiB, 10,000 titles, 10,000 manga preferences,
and 1,000 release notices. A merge that would exceed the existing 1,000-notice storage limit is
rejected without changing data. Malformed IDs, invalid settings or progress, duplicate entries, and
unsupported versions are rejected before restore. Backup files are data, never executable commands.

## Verification status

Automated SQLite/file/IPC tests and the production renderer with local fixtures pass. Native macOS
save/open sheets, overwrite handling, and a real device-to-device backup round trip still need
verification on the target Apple Silicon Mac. This iteration has not been packaged or released.
