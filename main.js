const { input, mpv, overlay, utils } = iina;

let start = null;

function notify(msg, error = false, ms = 2500) {
  overlay.simpleMode();
  overlay.setContent(`<p>${msg}</p>`);
  overlay.setStyle(`
    p {
      color: ${error ? "#ff5555" : "#55ff88"};
      font-size: 16px;
      margin-top: 40px;
      white-space: pre-wrap;
    }
  `);
  overlay.show();
  setTimeout(() => overlay.hide(), ms);
}

function escapeAS(p) {
  return String(p)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "")
    .replace(/\n/g, "");
}

function findFfmpeg() {
  if (utils.fileInPath("ffmpeg")) return "ffmpeg";
  if (utils.fileInPath("/opt/homebrew/bin/ffmpeg")) return "/opt/homebrew/bin/ffmpeg";
  if (utils.fileInPath("/usr/local/bin/ffmpeg")) return "/usr/local/bin/ffmpeg";
  return null;
}

function safeBaseName(filename) {
  const base = filename.replace(/\.[^/.]+$/, "");
  return base.replace(/[\/\\:]/g, "_");
}

// Robust "Finder-style" file-on-clipboard using AppKit pasteboard (public.file-url)
async function copyFileToClipboard(posixPath) {
  const p = escapeAS(posixPath);

  // AppleScriptObjC to write a file URL to the general pasteboard
  await utils.exec("/usr/bin/osascript", [
    "-l", "AppleScript",
    "-e", 'use framework "AppKit"',
    "-e", 'use framework "Foundation"',
    "-e", `set thePath to "${p}"`,
    "-e", 'set pb to current application\'s NSPasteboard\'s generalPasteboard()',
    "-e", 'pb\'s clearContents()',
    "-e", 'set fileURL to current application\'s NSURL\'s fileURLWithPath:thePath',
    "-e", 'pb\'s writeObjects:{fileURL}',
  ]);
}

input.onKeyDown("Alt+s", async () => {
  if (start === null) {
    start = Math.max(0, mpv.getNumber("time-pos"));
    notify("Start set", false, 2500);
    return true;
  }

  const end = Math.max(0, mpv.getNumber("time-pos"));

  // Constraint: start must be earlier than end. If not, just reset quietly.
  if (!(end > start)) {
    start = null;
    return true;
  }

  const inputPath = mpv.getString("path");
  const filename = mpv.getString("filename");

  const dir = inputPath.substring(0, inputPath.lastIndexOf("/"));
  const base = safeBaseName(filename);
  const output = `${dir}/${base}_clip.mp4`;

  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    notify("ffmpeg not found in PATH. Install it with Homebrew.", true, 5000);
    start = null;
    return true;
  }

  try {
    notify("Exporting…", false, 2000);

    const { status, stderr } = await utils.exec(ffmpeg, [
      "-y",
      "-ss", String(start),
      "-to", String(end),
      "-i", inputPath,
      "-c", "copy",
      output,
    ]);

    if (status === 0) {
      try { await copyFileToClipboard(output); } catch (_) {}
      notify("Saved (copied to clipboard):\n" + output, false, 5000);
    } else {
      notify("ffmpeg failed:\n" + (stderr || `exit code ${status}`), true, 5000);
    }
  } catch (e) {
    notify("exec error:\n" + e, true, 5000);
  } finally {
    start = null;
  }

  return true;
});