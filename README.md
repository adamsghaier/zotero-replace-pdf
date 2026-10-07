# Replace PDF for Zotero

Right-click a paper → **Add PDF** (if it has none) or **Replace PDF** (if it has one),
then pick the file. The picker opens in your Downloads folder.

**Replace PDF** writes the new PDF into the paper's existing PDF file: same file,
same name, same Zotero attachment. Nothing is deleted and recreated.

Why: swapping a PDF by deleting the item (or its attachment) and adding it again
deletes the file and creates a new one with the same name. Synced folders handle
that badly. iCloud for Windows, for one, can end up showing the file as
`Name (1).pdf`. Writing in place is an ordinary edit, so it syncs cleanly, and
tags, notes and links to the attachment are left alone.

- Checks the new file is a PDF and differs from the current one, then asks you to
  confirm. It shows how many highlights are on the PDF: they stay at the same
  page positions, so they may be misplaced if the new version is laid out differently.
- Copies the old PDF aside, writes and verifies the new one, and puts the old one
  back if verification fails. Once it succeeds, the old PDF is deleted (no undo).
- Closes and reopens the PDF if it's open, and reindexes it for full-text search.

**Add PDF** attaches the file the same way as Zotero's own Add Attachment → File…
(same import and renaming), so plugins that act on new attachments, such as ZotMoov,
treat it exactly like a dragged-in PDF.

**Downloads are tidied up.** With either action, if the file you picked is in your
Downloads folder it's removed once Zotero's copy has been verified byte for byte, as
ZotMoov's Attach New File does. A file picked from anywhere else is left alone.

**File dates follow Zotero (macOS).** With either action the PDF's Date Created and
Date Added are set to the date the paper was added to Zotero, so a folder of PDFs
sorted by either stays in Zotero's order (in iCloud Drive, Windows' Date created too). For Add PDF this happens once ZotMoov
has moved the file into its folder (it waits up to a minute), since that move would
otherwise reset it.

**It also hides Better BibTeX's submenu** in the item right-click menu, to keep that
menu short. Better BibTeX's Tools and File menus are unaffected. (It sets the item's `hidden`
property, since macOS's native menus ignore CSS.)

Works with stored and linked files. Zotero 8–10.

## Install
Download `replace-pdf.xpi` from the latest [release](../../releases/latest), then in
Zotero: **Tools → Plugins → ⚙ → Install Plugin From File…**. Updates arrive through
Zotero's own update check.

## Release (maintainer)
Bump `version` in `manifest.json`, commit, then run `./release.sh`.

## License
MIT, see [LICENSE](LICENSE).
