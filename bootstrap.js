/*
 * Replace PDF
 *
 * Right-click a paper → Add PDF (it has none) or Replace PDF (it has one). Both
 * open a file picker in Downloads.
 *
 * Replace PDF. Problem: to swap a paper's PDF (the wrong file came in when it was
 * added, say) the usual move is to delete it and add it again, or delete the PDF
 * and attach another. ZotMoov then deletes Papers/<citekey>.pdf and gives the new
 * file the same name. iCloud for Windows sees "file deleted, unrelated file
 * created at the same path" and can end up showing it on the PC as
 * <citekey> (1).pdf.
 *
 * Fix: the new PDF's bytes are written into the existing file: same file, same
 * name, same Zotero attachment. iCloud syncs an ordinary edit; the note, tags and
 * PDF link don't change. The old PDF is copied to <Zotero data directory>/
 * replaced-pdfs/ first so a failed write can be rolled back; once the new one has
 * verified, that copy is deleted. There's no undo.
 *
 * Add PDF attaches the picked file the way Zotero's own Add Attachment → File
 * does (same import and renaming), so ZotMoov then moves it into place exactly as
 * it does a dragged-in PDF.
 *
 * Either way, like ZotMoov's own Attach New File, the picked file is removed from
 * Downloads once Zotero's copy has verified byte for byte. A file picked from
 * anywhere else is left where it is.
 *
 * Highlights stay on the attachment. They're stored as page positions, so on a
 * re-laid-out version they'd sit over the wrong text; the confirmation says how
 * many there are before anything changes.
 *
 * It also hides Better BibTeX's submenu in the item context menu, to keep that
 * menu short. Better BibTeX's Tools and File menus are unaffected.
 */

var { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");

var menuID = null;
const FTL = "replace-pdf.ftl";
const TITLE = "Replace PDF";
const HIDE_CSS = "data:text/css," + encodeURIComponent(
  '#zotero-itemmenu .zotero-custom-menu-item[data-l10n-id="better-bibtex"] { display: none !important; }'
);

function log(msg) {
  Zotero.debug("ReplacePDF: " + msg);
}

// The PDF to replace for the selection: a PDF attachment itself, or a paper's
// earliest-added PDF (the same one the pipeline links from the note).
function pdfFor(items) {
  if (!items || items.length !== 1) return null;
  let item = items[0];
  if (item.isPDFAttachment && item.isPDFAttachment()) return item.deleted ? null : item;
  if (!item.isRegularItem()) return null;
  let pdfs = Zotero.Items.get(item.getAttachments())
    .filter(a => a.isPDFAttachment() && !a.deleted)
    .sort((a, b) => (a.dateAdded + a.key).localeCompare(b.dateAdded + b.key));
  return pdfs[0] || null;
}

// The paper to add a PDF to: a single paper that has none.
function paperWithoutPDF(items) {
  if (!items || items.length !== 1) return null;
  let item = items[0];
  return item.isRegularItem() && !pdfFor(items) ? item : null;
}

function nameOf(item) {
  return item.getField("citationKey") || item.getDisplayTitle();
}

function sameBytes(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isPDF(bytes) {
  return String.fromCharCode(...bytes.subarray(0, 5)) === "%PDF-";
}

function mb(bytes) {
  return (bytes.length / 1e6).toFixed(1) + " MB";
}

function downloadsDir() {
  try {
    return Services.dirsvc.get("DfltDwnld", Ci.nsIFile).path;
  }
  catch (e) {
    return PathUtils.join(Services.dirsvc.get("Home", Ci.nsIFile).path, "Downloads");
  }
}

function isInside(path, dir) {
  let p = PathUtils.normalize(path), d = PathUtils.normalize(dir);
  if (Zotero.isWin) {
    p = p.toLowerCase();
    d = d.toLowerCase();
  }
  return p.startsWith(d + (Zotero.isWin ? "\\" : "/"));
}

// Remove a picked file from Downloads once Zotero has a verified copy of it, as
// ZotMoov's Attach New File does. Only inside Downloads, and only if the file is
// still exactly what was copied.
async function removeIfDownloaded(path, bytes) {
  if (!isInside(path, downloadsDir())) return false;
  try {
    if (!sameBytes(await IOUtils.read(path), bytes)) return false;
    await IOUtils.remove(path);
    log(`removed ${path} from Downloads`);
    return true;
  }
  catch (e) {
    Zotero.logError(e);
    return false;
  }
}

// Write into the existing file without replacing it: open it write-only and
// truncated, with no create flag. Never a delete, a rename or a new file, which is
// what keeps iCloud treating this as an edit of the same file.
function writeInPlace(path, bytes) {
  let file = Zotero.File.pathToFile(path);
  let stream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
  stream.init(file, 0x02 | 0x20, -1, 0);    // PR_WRONLY | PR_TRUNCATE
  try {
    let out = Cc["@mozilla.org/binaryoutputstream;1"].createInstance(Ci.nsIBinaryOutputStream);
    out.setOutputStream(stream);
    out.writeByteArray(bytes);
    out.flush();
  }
  finally {
    stream.close();
  }
}

function alert(win, msg) {
  Services.prompt.alert(win, TITLE, msg);
}

// Ask for a PDF, starting in Downloads. The chosen path, or null if cancelled.
async function pickPDF(win, title) {
  let fp = new FilePicker();
  fp.init(win, title, fp.modeOpen);
  fp.appendFilter("PDF", "*.pdf");
  let dl = downloadsDir();
  if (await IOUtils.exists(dl)) fp.displayDirectory = dl;
  if (await fp.show() !== fp.returnOK) return null;
  return typeof fp.file === "string" ? fp.file : fp.file.path;
}

async function addPDF(items, win) {
  let parent = paperWithoutPDF(items);
  if (!parent) return;
  let name = nameOf(parent);

  let path = await pickPDF(win, `Choose the PDF for ${name}`);
  if (!path) return;
  let bytes = await IOUtils.read(path);
  if (!isPDF(bytes)) {
    alert(win, `${PathUtils.filename(path)} isn't a PDF. Nothing changed.`);
    return;
  }

  // Zotero's own Add Attachment → File, with the file already chosen: same import,
  // same renaming. ZotMoov moves it into place a few seconds later.
  let added = await Zotero.getActiveZoteroPane().addAttachmentFromDialog(false, parent.id, [path]);
  let att = added && added[0];
  if (!att) return;
  let copy = await att.getFilePathAsync();
  if (copy && sameBytes(await IOUtils.read(copy), bytes)) {
    await removeIfDownloaded(path, bytes);
  }
  log(`${name}: added ${PathUtils.filename(path)}`);
}

async function replacePDF(items, win) {
  let att = pdfFor(items);
  if (!att) return;
  let parent = att.parentItem;
  let name = (parent && parent.getField("citationKey")) || att.attachmentFilename;

  let path = await att.getFilePathAsync();
  if (!path) {
    alert(win, `${name}'s PDF file can't be found on this computer, so there's nothing to replace.`);
    return;
  }

  let newPath = await pickPDF(win, `Choose the new PDF for ${name}`);
  if (!newPath) return;

  if (PathUtils.normalize(newPath) === PathUtils.normalize(path)) {
    alert(win, `That file is already ${name}'s PDF.`);
    return;
  }
  let newBytes = await IOUtils.read(newPath);
  if (!isPDF(newBytes)) {
    alert(win, `${PathUtils.filename(newPath)} isn't a PDF. Nothing changed.`);
    return;
  }
  let oldBytes = await IOUtils.read(path);
  if (sameBytes(oldBytes, newBytes)) {
    alert(win, `${PathUtils.filename(newPath)} is identical to ${name}'s current PDF. Nothing changed.`);
    return;
  }

  let n = att.getAnnotations().length;
  let msg = `Replace ${name}'s PDF?\n\n`
    + `${PathUtils.filename(path)} (${mb(oldBytes)})  ←  ${PathUtils.filename(newPath)} (${mb(newBytes)})\n\n`
    + "The file keeps its name, so iCloud syncs this as an edit. The note and tags don't change. "
    + "The old PDF is deleted, so there's no undo.";
  if (isInside(newPath, downloadsDir())) {
    msg += ` ${PathUtils.filename(newPath)} is removed from Downloads.`;
  }
  if (n) {
    msg += `\n\n${n} highlight${n === 1 ? "" : "s"} / annotation${n === 1 ? "" : "s"} stay on this PDF `
      + "at the same page positions. If the new version is laid out differently they'll sit over "
      + "the wrong text. Their text and comments in your note are unaffected.";
  }
  if (!Services.prompt.confirm(win, TITLE, msg)) return;

  // An open reader keeps showing the old file; close it now, reopen it after.
  let open = (Zotero.Reader._readers || []).filter(r => r.itemID === att.id);
  for (let r of open) r.close();

  // A copy of the old PDF, kept only until the new one has verified.
  let dir = PathUtils.join(Zotero.DataDirectory.dir, "replaced-pdfs");
  await IOUtils.makeDirectory(dir, { ignoreExisting: true });
  let stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  let backup = PathUtils.join(dir, `${name.replace(/[^\w.-]+/g, "_")}-${stamp}.pdf`);
  await IOUtils.write(backup, oldBytes, { mode: "create" });
  if (!sameBytes(await IOUtils.read(backup), oldBytes)) {
    alert(win, "The backup of the old PDF didn't verify. Nothing changed.");
    return;
  }

  writeInPlace(path, newBytes);
  if (!sameBytes(await IOUtils.read(path), newBytes)) {
    writeInPlace(path, oldBytes);
    alert(win, "The new PDF didn't verify, so the old one was put back.\n\n"
      + `A copy of the old PDF is also at:\n${backup}`);
    return;
  }
  log(`${name}: replaced ${path}`);

  try {
    await IOUtils.remove(backup);
  }
  catch (e) {
    Zotero.logError(e);
  }
  await removeIfDownloaded(newPath, newBytes);

  try {
    await Zotero.Fulltext.indexItems([att.id], { complete: true });   // search sees the new text
  }
  catch (e) {
    Zotero.logError(e);
  }
  if (open.length) await Zotero.Reader.open(att.id);
}

function install() {}
function uninstall() {}

function onMainWindowLoad({ window }) {
  window.MozXULElement.insertFTLIfNeeded(FTL);
  try {
    window.windowUtils.loadSheetUsingURIString(HIDE_CSS, window.windowUtils.AUTHOR_SHEET);
  }
  catch (e) {
    Zotero.logError(e);
  }
}

function onMainWindowUnload({ window }) {
  window.document.querySelector(`link[href="${FTL}"]`)?.remove();
  try {
    window.windowUtils.removeSheetUsingURIString(HIDE_CSS, window.windowUtils.AUTHOR_SHEET);
  }
  catch (e) {
    // not loaded
  }
}

function run(action, context, what, hint = "") {
  let win = context.menuElem?.ownerGlobal || Zotero.getMainWindow();
  action(context.items, win).catch((e) => {
    Zotero.logError(e);
    alert(win, `${what} failed: ${e}${hint}`);
  });
}

function startup({ id }) {
  if (!Zotero.MenuManager) {
    log("Zotero.MenuManager not found; doing nothing");
    return;
  }
  menuID = Zotero.MenuManager.registerMenu({
    menuID: "replace-pdf",
    pluginID: id,
    target: "main/library/item",
    menus: [
      {
        menuType: "menuitem",
        l10nID: "add-pdf-menuitem",
        onShowing: (event, context) => context.setVisible(!!paperWithoutPDF(context.items)),
        onCommand: (event, context) => run(addPDF, context, "Add PDF"),
      },
      {
        menuType: "menuitem",
        l10nID: "replace-pdf-menuitem",
        onShowing: (event, context) => context.setVisible(!!pdfFor(context.items)),
        onCommand: (event, context) => run(replacePDF, context, "Replace PDF",
          "\n\nIf the PDF was changed, a copy of the old one is in replaced-pdfs in your Zotero data directory."),
      },
    ],
  });
  for (let win of Zotero.getMainWindows()) {
    onMainWindowLoad({ window: win });
  }
  log("active");
}

function shutdown() {
  if (menuID) Zotero.MenuManager.unregisterMenu(menuID);
  menuID = null;
  for (let win of Zotero.getMainWindows()) {
    onMainWindowUnload({ window: win });
  }
}
