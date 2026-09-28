/*
 * Replace PDF
 *
 * Problem: to swap a paper's PDF (the wrong file came in when it was added, say)
 * the usual move is to delete it and add it again, or delete the PDF and attach
 * another. ZotMoov then deletes Papers/<citekey>.pdf and gives the new file the
 * same name. iCloud for Windows sees "file deleted, unrelated file created at the
 * same path" and can end up showing it on the PC as <citekey> (1).pdf.
 *
 * Fix: right-click the paper → Replace PDF…, pick the new file. Its bytes are
 * written into the existing file: same file, same name, same Zotero attachment.
 * iCloud syncs an ordinary edit; the note, tags and PDF link don't change.
 *
 * The old PDF is copied to <Zotero data directory>/replaced-pdfs/ first, and once
 * the new one has verified, that copy goes to the Trash (Recycle Bin on Windows).
 * If that fails, it stays in replaced-pdfs/. To undo, take it out of the Trash
 * and use Replace PDF… again with it.
 *
 * Highlights stay on the attachment. They're stored as page positions, so on a
 * re-laid-out version they'd sit over the wrong text; the confirmation says how
 * many there are before anything changes.
 */

var { FilePicker } = ChromeUtils.importESModule("chrome://zotero/content/modules/filePicker.mjs");

var menuID = null;
const FTL = "replace-pdf.ftl";
const TITLE = "Replace PDF";

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

// Run a program without a console window (Windows) and report whether it succeeded.
function runHidden(exe, args) {
  return new Promise((resolve) => {
    let file = Zotero.File.pathToFile(exe);
    if (!file.exists()) {
      resolve(false);
      return;
    }
    let proc = Cc["@mozilla.org/process/util;1"].createInstance(Ci.nsIProcess);
    proc.init(file);
    proc.startHidden = true;
    proc.runwAsync(args, args.length, {
      observe: (subject, topic) => resolve(topic === "process-finished" && proc.exitValue === 0),
    });
  });
}

// The system Trash: /usr/bin/trash on macOS, the Recycle Bin via PowerShell on
// Windows. True only if the file is actually gone from where it was.
async function toTrash(path) {
  let ok = false;
  try {
    if (Zotero.isMac) {
      ok = await runHidden("/usr/bin/trash", [path]);
    }
    else if (Zotero.isWin) {
      let ps = PathUtils.join(Services.dirsvc.get("SysD", Ci.nsIFile).path,
        "WindowsPowerShell", "v1.0", "powershell.exe");
      let quoted = "'" + path.replace(/'/g, "''") + "'";
      ok = await runHidden(ps, ["-NoProfile", "-NonInteractive", "-WindowStyle", "Hidden", "-Command",
        "Add-Type -AssemblyName Microsoft.VisualBasic; "
        + `[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(${quoted}, 'OnlyErrorDialogs', 'SendToRecycleBin')`]);
    }
  }
  catch (e) {
    Zotero.logError(e);
  }
  return ok && !(await IOUtils.exists(path));
}

function alert(win, msg) {
  Services.prompt.alert(win, TITLE, msg);
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

  let fp = new FilePicker();
  fp.init(win, `Choose the new PDF for ${name}`, fp.modeOpen);
  fp.appendFilter("PDF", "*.pdf");
  if (await fp.show() !== fp.returnOK) return;
  let newPath = typeof fp.file === "string" ? fp.file : fp.file.path;

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
    + "The file keeps its name, so iCloud syncs this as an edit. The note and tags don't change, "
    + `and the old PDF goes to the ${Zotero.isWin ? "Recycle Bin" : "Trash"}.`;
  if (n) {
    msg += `\n\n${n} highlight${n === 1 ? "" : "s"} / annotation${n === 1 ? "" : "s"} stay on this PDF `
      + "at the same page positions. If the new version is laid out differently they'll sit over "
      + "the wrong text. Their text and comments in your note are unaffected.";
  }
  if (!Services.prompt.confirm(win, TITLE, msg)) return;

  // An open reader keeps showing the old file; close it now, reopen it after.
  let open = (Zotero.Reader._readers || []).filter(r => r.itemID === att.id);
  for (let r of open) r.close();

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
    alert(win, "The new PDF didn't verify, so the old one was put back.");
    return;
  }
  log(`${name}: replaced ${path} (backup ${backup})`);

  try {
    await Zotero.Fulltext.indexItems([att.id], { complete: true });   // search sees the new text
  }
  catch (e) {
    Zotero.logError(e);
  }
  if (open.length) await Zotero.Reader.open(att.id);

  let bin = Zotero.isWin ? "Recycle Bin" : "Trash";
  if (await toTrash(backup)) {
    alert(win, `Replaced ${name}'s PDF.\n\nThe old PDF is in the ${bin} as ${PathUtils.filename(backup)}. `
      + `To undo, take it out of the ${bin} and use Replace PDF… again with it.`);
  }
  else {
    alert(win, `Replaced ${name}'s PDF.\n\nThe old PDF couldn't be moved to the ${bin}, so it was kept at:\n`
      + `${backup}\n\nTo undo, use Replace PDF… again and pick that file.`);
  }
}

function install() {}
function uninstall() {}

function onMainWindowLoad({ window }) {
  window.MozXULElement.insertFTLIfNeeded(FTL);
}

function onMainWindowUnload({ window }) {
  window.document.querySelector(`link[href="${FTL}"]`)?.remove();
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
    menus: [{
      menuType: "menuitem",
      l10nID: "replace-pdf-menuitem",
      onShowing: (event, context) => context.setVisible(!!pdfFor(context.items)),
      onCommand: (event, context) => {
        let win = context.menuElem?.ownerGlobal || Zotero.getMainWindow();
        replacePDF(context.items, win).catch((e) => {
          Zotero.logError(e);
          alert(win, "Replace PDF failed: " + e + "\n\nIf the PDF was changed, the old one is in "
            + "replaced-pdfs in your Zotero data directory.");
        });
      },
    }],
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
