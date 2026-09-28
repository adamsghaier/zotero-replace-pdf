# Replace PDF for Zotero

Right-click a paper → **Replace PDF…** → pick the new file. The new PDF is written
into the paper's existing PDF file: same file, same name, same Zotero attachment.
Nothing is deleted and recreated.

Why: swapping a PDF by deleting the item (or its attachment) and adding it again
deletes the file and creates a new one with the same name. Synced folders handle
that badly. iCloud for Windows, for one, can end up showing the file as
`Name (1).pdf`. Writing in place is an ordinary edit, so it syncs cleanly, and
tags, notes and links to the attachment are left alone.

- Checks the new file is a PDF and differs from the current one, then asks you to
  confirm. It shows how many highlights are on the PDF: they stay at the same
  page positions, so they may be misplaced if the new version is laid out differently.
- Copies the old PDF aside, writes and verifies the new one, and puts the old one
  back if verification fails. Once it succeeds, the old PDF goes to the Trash (the
  Recycle Bin on Windows). If that isn't possible, it's kept in
  `replaced-pdfs/` in the Zotero data directory.
- Closes and reopens the PDF if it's open, and reindexes it for full-text search.

Works with stored and linked files. Zotero 8–10.

## Install
Download `replace-pdf.xpi` from the latest [release](../../releases/latest), then in
Zotero: **Tools → Plugins → ⚙ → Install Plugin From File…**. Updates arrive through
Zotero's own update check.

## Release (maintainer)
Bump `version` in `manifest.json`, commit, then run `./release.sh`.
