/**
 * Video Routes
 */

const express = require('express');
const router = express.Router();
const { getVideoInfo, downloadVideo, healthCheck } = require('../controllers/videoController');

// Health check
router.get('/health', healthCheck);

/**
 * POST /api/video/info
 * Body: { url: string }
 * Returns: video metadata + available formats
 */
router.post('/video/info', getVideoInfo);

/**
 * GET /api/video/download?url=...&formatId=...&title=...
 * Streams a merged mp4 (video + audio) directly to the browser.
 * GET method allows direct <a href> browser download links.
 */
router.get('/video/download', downloadVideo);

module.exports = router;
