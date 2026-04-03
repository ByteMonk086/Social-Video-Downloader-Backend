/**
 * Social Video Downloader - Backend Entry Point
 * Express server with CORS, security headers, rate limiting, and modular routing
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const videoRoutes = require('./routes/videoRoutes');
const rateLimiter = require('./middleware/rateLimiter');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');

const app = express();
const PORT = process.env.PORT || 5000;

// ─── Security & Core Middleware ──────────────────────────────────────────────
app.use(helmet({
  crossOriginEmbedderPolicy: false, // Allow embedding thumbnails
  contentSecurityPolicy: false,     // Handled by frontend
}));

// CORS configuration
app.use(cors({
  origin: true, // Reflect back the requester's origin (Allows any domain)
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
}));


// Request logging (skip in test)
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('dev', {
    stream: {
      write: (message) => logger.info(message.trim()),
    },
  }));
}

// Body parsing
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));

// ─── Rate Limiting ────────────────────────────────────────────────────────────
app.use('/api', rateLimiter);

// ─── Routes ──────────────────────────────────────────────────────────────────
app.use('/api', videoRoutes);

// ─── Root endpoint ────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    name: 'Social Video Downloader API',
    version: '1.0.0',
    status: 'running',
    docs: '/api/health',
  });
});

// ─── Error Handling ───────────────────────────────────────────────────────────
app.use(notFoundHandler);
app.use(errorHandler);

// ─── Start Server ─────────────────────────────────────────────────────────────
const server = app.listen(PORT, () => {
  logger.info(`🚀 Server running on http://localhost:${PORT}`);
  logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  logger.info(`📦 CORS allowed origins: ${allowedOrigins.join(', ')}`);
});

// Allow up to 90s for yt-dlp to respond (its own timeout is 60s)
server.setTimeout(90000);

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('SIGTERM received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed.');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('SIGINT received. Shutting down gracefully...');
  server.close(() => {
    logger.info('Server closed.');
    process.exit(0);
  });
});

module.exports = app;
