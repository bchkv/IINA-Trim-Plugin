const { input, mpv, overlay, utils } = iina;

let start = null;

function notify(msg, error = false, ms = 2500) {
  overlay.simpleMode();
  overlay.setContent(`<p>${msg}</p>`);
  overlay.show();
  setTimeout(() => overlay.hide(), ms);
}

input.onKeyDown("Alt+s", async () => {
  if (start === null) {
    start = mpv.getNumber("time-pos");
    notify("Start set");
  } else {
    const end = mpv.getNumber("time-pos");

    const inputPath = mpv.getString("path");
    const filename = mpv.getString("filename");

    const dir = inputPath.substring(0, inputPath.lastIndexOf("/"));
    const base = filename.replace(/\.[^/.]+$/, "");
    const output = `${dir}/${base}_clip.mp4`;

    const ffmpeg = utils.fileInPath("ffmpeg")
      ? "ffmpeg"
      : utils.fileInPath("/opt/homebrew/bin/ffmpeg")
        ? "/opt/homebrew/bin/ffmpeg"
        : utils.fileInPath("/usr/local/bin/ffmpeg")
          ? "/usr/local/bin/ffmpeg"
          : null;

    if (!ffmpeg) {
      notify("ffmpeg not found in PATH", true, 4000);
      start = null;
      return true;
    }

    try {
      notify("Exporting…", false, 1500);

      const { status, stdout, stderr } = await utils.exec(ffmpeg, [
        "-y",
        "-ss",
        String(start),
        "-to",
        String(end),
        "-i",
        inputPath,
        "-c",
        "copy",
        output,
      ]);

      if (status === 0) {
        notify("Saved:\n" + output);
      } else {
        notify("ffmpeg failed:\n" + stderr, true, 4000);
      }
    } catch (e) {
      notify("exec error:\n" + e, true, 4000);
    }

    start = null;
  }
  return true;
});
