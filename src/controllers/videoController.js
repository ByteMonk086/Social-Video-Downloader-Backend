/**
 * Video Controller
 * Handles HTTP request/response logic for video operations
 */

const { fetchVideoInfo, streamDownload } = require('../services/videoService');
const { validateUrl } = require('../utils/platformDetector');
const logger = require('../utils/logger');

/**
 * POST /api/video/info
 * Fetch video metadata and available formats
 */
async function getVideoInfo(req, res) {
  try {
    const { url } = req.body;

    const { valid, platform, error: validationError } = validateUrl(url);
    if (!valid) {
      return res.status(400).json({ success: false, error: validationError });
    }

    logger.info(`Fetching video info for ${platform}: ${url}`);

    const videoInfo = await fetchVideoInfo(url);

    if (!videoInfo || !videoInfo.formats || videoInfo.formats.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'No downloadable video formats found.',
      });
    }

    return res.status(200).json({
      success: true,
      platform,
      data: videoInfo,
    });
  } catch (error) {
    logger.error('getVideoInfo error:', error.message);
    return res.status(500).json({ success: false, error: error.message });
  }
}

/**
 * GET /api/video/download?url=...&formatId=...&title=...
 *
 * Streams a merged (video + audio) mp4 directly to the browser.
 * Using GET so the browser can trigger a file download via <a href>.
 * yt-dlp + ffmpeg merge DASH streams server-side and pipe to response.
 */
async function downloadVideo(req, res) {
  try {
    const { url, formatId, title } = req.query;

    if (!url) {
      return res.status(400).json({ success: false, error: 'URL is required.' });
    }

    const { valid, error: validationError } = validateUrl(url);
    if (!valid) {
      return res.status(400).json({ success: false, error: validationError });
    }

    const format = formatId || 'bestvideo+bestaudio/best';
    const filename = title ? decodeURIComponent(title) : 'video';

    logger.info(`Streaming download — format:"${format}" url:"${url}"`);

    await streamDownload(url, format, filename, res);
  } catch (error) {
    logger.error('downloadVideo error:', error.message);
    if (!res.headersSent) {
      return res.status(500).json({
        success: false,
        error: error.message || 'Download failed. Please try again.',
      });
    }
  }
}

/**
 * GET /api/health
 * Health check endpoint
 */
function healthCheck(req, res) {
  return res.status(200).json({
    success: true,
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
  });
}

module.exports = { getVideoInfo, downloadVideo, healthCheck };
