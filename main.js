// main.js
const { input, mpv, overlay, utils, preferences } = iina;

let start = null;

/* ---------- UI ---------- */

function escapeHTML(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function notify(title, detail = "", error = false, ms = 2500) {
  overlay.simpleMode();
  overlay.setContent(`
    <div class="card ${error ? "err" : "ok"}">
      <div class="title"><strong>${escapeHTML(title)}</strong></div>
      ${detail ? `<div class="detail">${escapeHTML(detail).replace(/\n/g, "<br>")}</div>` : ""}
    </div>
  `);

  overlay.setStyle(`
    .card{
      display:inline-block;
      padding:10px 14px;
      border-radius:14px;
      backdrop-filter:blur(20px);
      -webkit-backdrop-filter:blur(20px);
      border:1px solid rgba(255,255,255,0.12);
      box-shadow:0 12px 30px rgba(0,0,0,0.35);
      font:13px -apple-system,BlinkMacSystemFont,"SF Pro Text","Helvetica Neue",Arial,sans-serif;
      max-width:70vw;
      margin-top:30px;
      color:rgba(255,255,255,0.95);
    }
    .card.ok{ background:rgba(28,28,30,0.78); }
    .card.err{
      background:rgba(255,59,48,0.55);
      border-color:rgba(255,59,48,0.55);
      box-shadow:0 12px 30px rgba(255,59,48,0.18), 0 12px 30px rgba(0,0,0,0.35);
    }
    .title{ line-height:1.15; }
    .detail{
      margin-top:2px;
      line-height:1.15;
      opacity:0.92;
      word-break:break-word;
      white-space: normal;
    }
  `);

  overlay.show();
  setTimeout(() => overlay.hide(), ms);
}

/* ---------- Preferences (sync + async compatible) ---------- */

function prefGetCompat(key) {
  return new Promise((resolve) => {
    try {
      if (typeof preferences?.get !== "function") return resolve(undefined);

      // callback-based: get(key, cb)
      if (preferences.get.length >= 2) {
        preferences.get(key, (value) => resolve(value));
        return;
      }

      // sync: get(key) -> value
      resolve(preferences.get(key));
    } catch (_) {
      resolve(undefined);
    }
  });
}

async function prefBool(key, defaultValue = false) {
  const v = await prefGetCompat(key);

  if (v === undefined || v === null) return defaultValue;
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes", "on"].includes(s)) return true;
    if (["false", "0", "no", "off", ""].includes(s)) return false;
  }
  return defaultValue;
}

async function prefStr(key, defaultValue = "") {
  const v = await prefGetCompat(key);
  return v === undefined || v === null ? defaultValue : String(v);
}

/* ---------- Helpers ---------- */

function pad2(n) {
  return String(Math.floor(Number(n) || 0)).padStart(2, "0");
}

// 00-31-22 (hh-mm-ss)
function formatHMS(sec) {
  sec = Math.max(0, Number(sec) || 0);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  return `${pad2(h)}-${pad2(m)}-${pad2(s)}`;
}

function sanitizeBase(name) {
  return (
    String(name)
      .replace(/\.[^/.]+$/, "")
      .replace(/[ .]+/g, "_")
      .replace(/[^A-Za-z0-9_()-]+/g, "")
      .replace(/_+/g, "_")
      .replace(/^_+|_+$/g, "") || "clip"
  );
}

function findFfmpeg() {
  if (utils.fileInPath("ffmpeg")) return "ffmpeg";
  if (utils.fileInPath("/opt/homebrew/bin/ffmpeg")) return "/opt/homebrew/bin/ffmpeg";
  if (utils.fileInPath("/usr/local/bin/ffmpeg")) return "/usr/local/bin/ffmpeg";
  return null;
}

function extFromFilename(filename) {
  const m = String(filename).match(/\.([A-Za-z0-9]+)$/);
  return m ? m[1].toLowerCase() : "mp4";
}

function escapeAS(p) {
  return String(p)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\r/g, "")
    .replace(/\n/g, "");
}

// Finder-style “file on clipboard”
async function copyFileToClipboard(posixPath) {
  const p = escapeAS(posixPath);
  const { status, stderr } = await utils.exec("/usr/bin/osascript", [
    "-l", "AppleScript",
    "-e", 'use framework "AppKit"',
    "-e", 'use framework "Foundation"',
    "-e", `set thePath to "${p}"`,
    "-e", "set pb to current application's NSPasteboard's generalPasteboard()",
    "-e", "pb's clearContents()",
    "-e", "set fileURL to current application's NSURL's fileURLWithPath:thePath",
    "-e", "pb's writeObjects:{fileURL}",
  ]);
  if (status !== 0) throw new Error(stderr || `osascript exit ${status}`);
}

async function expandPathTemplate(path) {
  const p = String(path || "").trim();
  if (!p) return "";
  const { status, stdout, stderr } = await utils.exec("/bin/zsh", ["-lc", `echo ${p}`]);
  if (status !== 0) throw new Error(stderr || `path expand failed ${status}`);
  return String(stdout || "").trim();
}

function dirname(p) {
  const s = String(p);
  const i = s.lastIndexOf("/");
  return i >= 0 ? s.slice(0, i) : "";
}

async function ensureDirExists(dir) {
  if (!dir) return;
  const { status, stderr } = await utils.exec("/bin/mkdir", ["-p", dir]);
  if (status !== 0) throw new Error(stderr || `mkdir failed ${status}`);
}

/* ---------- Main ---------- */

input.onKeyDown("Alt+s", async () => {
  if (start === null) {
    start = Math.max(0, mpv.getNumber("time-pos"));
    notify("Start set", formatHMS(start), false, 2600);
    return true;
  }

  const end = Math.max(0, mpv.getNumber("time-pos"));
  if (!(end > start)) {
    start = null;
    return true;
  }

  const inputPath = mpv.getString("path");
  const filename = mpv.getString("filename");

  const sourceDir = dirname(inputPath);
  const base = sanitizeBase(filename);
  const inputExt = extFromFilename(filename);

  // ✅ settings we keep
  const copyToClipboardPref = await prefBool("copyToClipboard", true);
  const useCustomDir = await prefBool("useCustomDir", false);
  const customDirRaw = await prefStr("customDir", "");

  let outDir = sourceDir;
  try {
    if (useCustomDir && customDirRaw.trim()) outDir = await expandPathTemplate(customDirRaw);
  } catch (_) {
    outDir = sourceDir;
  }

  const outPath = `${outDir}/${base}_${formatHMS(start)}_to_${formatHMS(end)}.${inputExt}`;

  const ffmpeg = findFfmpeg();
  if (!ffmpeg) {
    notify("ffmpeg not found", "Install with Homebrew", true, 5000);
    start = null;
    return true;
  }

  try {
    await ensureDirExists(outDir);

    // ✅ stream copy only
    const args = [
      "-y",
      "-ss", String(start),
      "-to", String(end),
      "-i", inputPath,
      "-c", "copy",
      outPath,
    ];

    notify("Exporting (fast)", "", false, 2000);

    const { status, stderr } = await utils.exec(ffmpeg, args);

    if (status === 0) {
      if (copyToClipboardPref) {
        try { await copyFileToClipboard(outPath); } catch (_) {}
        notify("Saved & copied", outPath, false, 5200);
      } else {
        notify("Saved", outPath, false, 5200);
      }
    } else {
      notify("Export failed", stderr || `code ${status}`, true, 6500);
    }
  } catch (e) {
    notify("Execution error", String(e), true, 6500);
  } finally {
    start = null;
  }

  return true;
});