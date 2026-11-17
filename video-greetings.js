const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { stat } = require('node:fs/promises');

const run = promisify(execFile);
const MAX_VIDEO_BYTES = 50 * 1024 ** 2;
const MAX_VIDEOS_PER_EVENT = 10;
const MAX_SECONDS = 30;
const allowedFormats = ['mov', 'matroska'];

async function prepareVideo(input, output, config) {
  const options = { timeout: 30_000, maxBuffer: 256 * 1024 };
  const limits = ['-protocol_whitelist', 'file', '-format_whitelist', allowedFormats.join(',')];
  try {
    const { stdout } = await run(config.FFPROBE_BIN || 'ffprobe', [
      '-v', 'error', ...limits, '-show_entries',
      'format=duration:stream=codec_type,width,height', '-of', 'json', input,
    ], options);
    const info = JSON.parse(stdout);
    const video = info.streams?.find(stream => stream.codec_type === 'video');
    if (!video || !video.width || !video.height || video.width * video.height > 9_000_000) {
      throw new Error('Bitte ein Video mit bis zu 4K Auflösung auswählen.');
    }
    const duration = Number(info.format?.duration);
    // Browser WebM recordings may omit duration. The bounded conversion below stops at 31 seconds.
    if (Number.isFinite(duration) && (duration <= 0 || duration > MAX_SECONDS + 0.25)) {
      throw new Error('Der Videogruß darf höchstens 30 Sekunden lang sein.');
    }
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Die Videoverarbeitung ist momentan nicht verfügbar.');
    if (error.cmd || error instanceof SyntaxError) throw new Error('Bitte ein abspielbares MP4-, MOV- oder WebM-Video auswählen.');
    throw error;
  }

  try {
    await run(config.FFMPEG_BIN || 'ffmpeg', [
      '-nostdin', '-v', 'error', '-threads', '2', ...limits, '-i', input,
      '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-map_chapters', '-1',
      '-t', '31', '-vf', "scale='min(1280,iw)':'min(1280,ih)':force_original_aspect_ratio=decrease:force_divisible_by=2",
      '-r', '30', '-c:v', 'libx264', '-threads', '2', '-preset', 'veryfast', '-pix_fmt', 'yuv420p',
      '-maxrate', '3M', '-bufsize', '6M', '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart',
      '-fs', String(MAX_VIDEO_BYTES), output,
    ], { ...options, timeout: 90_000 });
    const { stdout } = await run(config.FFPROBE_BIN || 'ffprobe', [
      '-v', 'error', ...limits, '-show_entries', 'format=duration', '-of', 'csv=p=0', output,
    ], options);
    const duration = Number(stdout.trim());
    const { size } = await stat(output);
    if (!Number.isFinite(duration) || duration <= 0 || !size || size >= MAX_VIDEO_BYTES) {
      throw new Error('Video konnte nicht vollständig verarbeitet werden.');
    }
    if (duration > MAX_SECONDS + 0.25) throw new Error('Der Videogruß darf höchstens 30 Sekunden lang sein.');
    return { duration, size };
  } catch (error) {
    if (error.code === 'ENOENT') throw new Error('Die Videoverarbeitung ist momentan nicht verfügbar.');
    if (error.cmd) throw new Error('Der Videogruß konnte nicht verarbeitet werden. Bitte versuche eine andere Datei.');
    throw error;
  }
}

module.exports = { prepareVideo, MAX_VIDEO_BYTES, MAX_VIDEOS_PER_EVENT };
