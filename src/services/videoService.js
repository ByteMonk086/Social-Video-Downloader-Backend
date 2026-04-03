/**
 * Video Downloader Service - FINAL STABLE EDITION
 * 🚀 High-Scale Metadata Caching + Proxy Rotation + Robust FFmpeg Merged Streaming.
 *
 * BUG FIX: "Video not showing" was caused by yt-dlp defaulting to MPEG-TS for stdout pipes,
 * which doesn't support VP9 video muxing correctly.
 * FIX: We now use ffmpeg's fragmented MP4 flags (-movflags frag_keyframe+empty_moov)
 * to pipe merged DASH streams to stdout reliably as a valid MP4 file.
 */

const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const NodeCache = require('node-cache');
const Redis = require('ioredis');
const logger = require('../utils/logger');

const execAsync = promisify(exec);
const YTDLP_PATH = process.env.YTDLP_PATH || 'yt-dlp';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ─── Caching layer ────────────────────────────────────────────────────────────
const localCache = new NodeCache({ stdTTL: Number(process.env.CACHE_TTL_SECONDS) || 3600 });
let redisClient = null;
if (process.env.USE_REDIS === 'true') {
  try {
    redisClient = new Redis(process.env.REDIS_URL || 'redis://localhost:6379', { maxRetriesPerRequest: 1 });
    redisClient.on('error', () => logger.debug('Redis down, using memory.'));
  } catch (e) { logger.debug('Redis init failed.'); }
}

async function getCachedInfo(url) {
  const key = `vd:${url}`;
  if (redisClient && redisClient.status === 'ready') {
    const val = await redisClient.get(key);
    if (val) return JSON.parse(val);
  }
  return localCache.get(key);
}

async function setCachedInfo(url, data) {
  const key = `vd:${url}`;
  const ttl = Number(process.env.CACHE_TTL_SECONDS) || 3600;
  if (redisClient && redisClient.status === 'ready') await redisClient.set(key, JSON.stringify(data), 'EX', ttl);
  localCache.set(key, data);
}

// ─── Proxy & Common Args ──────────────────────────────────────────────────────
function getRotationArgs() {
  const proxyList = process.env.PROXY_LIST ? process.env.PROXY_LIST.split(',') : [];
  if (process.env.ROTATE_PROXIES === 'true' && proxyList.length > 0) {
    return ['--proxy', proxyList[Math.floor(Math.random() * proxyList.length)]];
  }
  return [];
}

function commonArgs() {
  return [
    '--no-playlist', '--no-warnings', '--socket-timeout', '30', '--retries', '3', '--no-check-certificate',
    '--add-header', `'User-Agent:${USER_AGENT}'`, ...getRotationArgs(),
  ];
}

async function runYtDlp(args) {
  const command = `${YTDLP_PATH} ${args.join(' ')}`;
  logger.debug(`Running: ${command}`);
  const { stdout, stderr } = await execAsync(command, { timeout: 60000, maxBuffer: 20 * 1024 * 1024, shell: true });
  if (stderr && !stdout) throw new Error(stderr);
  return stdout;
}

// ─── Formatters ────────────────────────────────────────────────────────────────
function formatDuration(s) {
  if (!s || isNaN(s)) return null;
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}` : `${m}:${String(sec).padStart(2, '0')}`;
}

function formatFileSize(b) {
  if (!b || isNaN(b)) return null;
  const u = ['B', 'KB', 'MB', 'GB']; let s = b, i = 0;
  while (s >= 1024 && i < u.length - 1) { s /= 1024; i++; }
  return `${s.toFixed(1)} ${u[i]}`;
}

// ─── Core extraction ────────────────────────────────────────────────────────────
async function fetchVideoInfo(url) {
  const cached = await getCachedInfo(url);
  if (cached) { logger.info(`⚡ Cache hit: ${url}`); return cached; }

  try {
    const output = await runYtDlp(['--dump-json', ...commonArgs(), `"${url}"`]);
    const info = JSON.parse(output);
    const formats = [];

    if (info.formats) {
      const vFormats = info.formats.filter(f => f.vcodec && f.vcodec !== 'none' && f.url && f.height);
      vFormats.sort((a, b) => (b.height || 0) - (a.height || 0));
      const seen = new Set();
      for (const f of vFormats) {
        if (seen.has(f.height)) continue; seen.add(f.height);
        const hasAudio = f.acodec && f.acodec !== 'none';
        formats.push({
          format_id: hasAudio ? f.format_id : `${f.format_id}+bestaudio`,
          quality: f.height ? `${f.height}p` : (f.format_note || 'Unknown'),
          resolution: `${f.width || '?'}x${f.height}`,
          height: f.height, ext: 'mp4',
          filesize: f.filesize || f.filesize_approx || null,
          filesize_human: formatFileSize(f.filesize || f.filesize_approx),
          has_audio: hasAudio
        });
      }
    }
    if (formats.length === 0) formats.push({ format_id: 'bestvideo+bestaudio/best', quality: 'Best', ext: 'mp4', has_audio: true });

    const data = {
      id: info.id, title: info.title || 'Untitled Video', thumbnail: info.thumbnail,
      duration: formatDuration(info.duration), platform: info.extractor_key, webpage_url: url, formats
    };
    await setCachedInfo(url, data);
    return data;
  } catch (e) {
    logger.error('fetchVideoInfo error:', e.message);
    throw new Error(`Extraction failed: ${e.message.split('\n')[0]}`);
  }
}

// ─── Merged Stream Downloader ──────────────────────────────────────────────────
/**
 * Streams a merged video+audio file to the client using segmented MP4 for pipes.
 * This ensures the file is playable even when streamed over a socket.
 */
function streamDownload(url, formatId, filename, res) {
  return new Promise((resolve, reject) => {
    // We use yt-dlp to handle the complex extraction and ffmpeg for the muxing to stdout.
    // Fragmented MP4 (+empty_moov) is required for stdout piping of MP4.
    const args = [
      '-f', formatId,
      '--no-part',
      ...commonArgs(),
      '--downloader', 'ffmpeg',
      '--downloader-args', "'ffmpeg:-f mp4 -movflags frag_keyframe+empty_moov'", // Fixed quoting
      '-o', '-',
      `"${url}"`
    ];

    logger.debug(`Streaming: ${YTDLP_PATH} ${args.join(' ')}`);

    const ytdlp = spawn(YTDLP_PATH, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: true });

    const safeName = (filename || 'video').replace(/[^\w\s.-]/g, '_').substring(0, 80);
    res.setHeader('Content-Type', 'video/mp4');
    res.setHeader('Content-Disposition', `attachment; filename="${safeName}.mp4"`);
    res.setHeader('Transfer-Encoding', 'chunked');

    ytdlp.stdout.pipe(res);

    let errLog = '';
    ytdlp.stderr.on('data', d => errLog += d.toString());

    ytdlp.on('close', code => {
      if (code === 0) resolve();
      else {
        logger.error(`Download failed (code ${code}): ${errLog}`);
        if (!res.headersSent) reject(new Error('Merge failed.'));
        else res.end();
      }
    });

    res.on('close', () => { if (ytdlp.exitCode === null) ytdlp.kill('SIGKILL'); });
  });
}

module.exports = { fetchVideoInfo, streamDownload };
