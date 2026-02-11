const { input, mpv, overlay, utils } = iina;

let start = null;

/* ---------- UI (Apple-ish OSD card) ---------- */

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function notify(title, detail = "", error = false, ms = 2500) {
  const t = escapeHTML(title);
  const d = escapeHTML(detail);

  overlay.simpleMode();
  overlay.setContent(`
    <div class="card ${error ? "err" : "ok"}">
      <div class="text">
        <div class="title"><strong>${t}</strong></div>
        ${detail ? `<div class="detail">${d.replace(/\n/g, "<br>")}</div>` : ""}
      </div>
    </div>
  `);

  overlay.setStyle(`
    .card{
      display: inline-flex;
      padding: 10px 14px;
      border-radius: 12px;
      backdrop-filter: blur(18px);
      -webkit-backdrop-filter: blur(18px);
      border: 1px solid rgba(255,255,255,0.14);
      box-shadow: 0 10px 30px rgba(0,0,0,0.35);
      font: 13px -apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", Arial, sans-serif;
      letter-spacing: 0.2px;
      max-width: 72vw;
      margin-top: 34px;
    }
    .card.ok{
      background: rgba(28, 28, 30, 0.72);
    }
    .card.err{
      background: rgba(255, 59, 48, 0.22);
      border-color: rgba(255, 59, 48, 0.28);
    }
    .text{
      color: rgba(255,255,255,0.92);
      line-height: 1.22;
      word-break: break-word;
      white-space: pre-wrap;
    }
    .title strong{
      font-weight: 700;
    }
    .detail{
      margin-top: 1px;      /* reduced vertical gap */
      line-height: 1.1;     /* tighter */
      color: rgba(235,235,245,0.82);
    }
  `);

  overlay.show();
  setTimeout(() => overlay.hide(), ms);
}

/* ---------- Helpers ---------- */

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

function pad2(n) {
  n = Math.floor(Number(n) || 0);
  return String(n).padStart(2, "0");
}

// 00-31-22 (hh-mm-ss)
function formatDashHMS(seconds) {
  const s = Math.max(0, Number(seconds) || 0);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${pad2(h)}-${pad2(m)}-${pad2(sec)}`;
}

// Base filename: keep ASCII-ish, turn spaces/dots into underscores, drop other junk.
function sanitizeBase(filename) {
  let base = String(filename).replace(/\.[^/.]+$/, ""); // drop extension

  // Replace spaces and dots with underscores
  base = base.replace(/[ .]+/g, "_");

  // Remove characters that look bad in filenames
  base = base.replace(/[^A-Za-z0-9_()-]+/g, "");

  // Collapse multiple underscores
  base = base.replace(/_+/g, "_").replace(/^_+|_+$/g, "");

  return base || "clip";
}

// Robust "Finder-style" file-on-clipboard using AppKit pasteboard (public.file-url)
async function copyFileToClipboard(posixPath) {
  const p = escapeAS(posixPath);
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

/* ---------- Main ---------- */

input.onKeyDown("Alt+s", async () => {
  if (start === null) {
    start = Math.max(0, mpv.getNumber("time-pos"));
    notify("Start set", formatDashHMS(start), false, 2800);
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
  const base = sanitizeBase(filename);

  // Desired format:
  // John_Danaher_Feet_to_Floor_Vol3_00-31-22_to_00-31-24.mp4
  const output = `${dir}/${base}_${formatDashHMS(start)}_to_${formatDashHMS(end)}.mp4`;

  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    notify("ffmpeg not found", "Install ffmpeg with Homebrew.", true, 5200);
    start = null;
    return true;
  }

  try {
    notify("Exporting…", "", false, 2200);

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
      notify("Saved & copied to clipboard", output, false, 5200);
    } else {
      notify("ffmpeg failed", stderr || `exit code ${status}`, true, 5200);
    }
  } catch (e) {
    notify("exec error", String(e), true, 5200);
  } finally {
    start = null;
  }

  return true;
});