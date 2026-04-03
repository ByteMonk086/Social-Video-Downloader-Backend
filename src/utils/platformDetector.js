/**
 * Platform Detector Utility
 * Detects the social media platform from a given URL
 */

const PLATFORM_PATTERNS = {
  instagram: [
    /https?:\/\/(www\.)?instagram\.com\/(reel|p|tv)\//i,
    /https?:\/\/(www\.)?instagram\.com\/[^/]+\/(reel|p|tv)\//i,
  ],
  twitter: [
    /https?:\/\/(www\.)?(twitter\.com|x\.com)\/[^/]+\/status\/\d+/i,
    /https?:\/\/(mobile\.)?(twitter\.com|x\.com)\/[^/]+\/status\/\d+/i,
  ],
};

/**
 * Detect the platform from a URL
 * @param {string} url - The URL to detect platform from
 * @returns {string|null} - 'instagram', 'twitter', or null if unknown
 */
function detectPlatform(url) {
  if (!url || typeof url !== 'string') return null;

  // Trim and normalize URL
  const trimmedUrl = url.trim();

  for (const [platform, patterns] of Object.entries(PLATFORM_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(trimmedUrl)) {
        return platform;
      }
    }
  }

  return null;
}

/**
 * Validate if the URL is a supported video URL
 * @param {string} url - The URL to validate
 * @returns {{ valid: boolean, platform: string|null, error: string|null }}
 */
function validateUrl(url) {
  if (!url || typeof url !== 'string' || url.trim().length === 0) {
    return { valid: false, platform: null, error: 'URL is required' };
  }

  const trimmedUrl = url.trim();

  // Basic URL format check
  try {
    new URL(trimmedUrl);
  } catch {
    return { valid: false, platform: null, error: 'Invalid URL format' };
  }

  const platform = detectPlatform(trimmedUrl);

  if (!platform) {
    return {
      valid: false,
      platform: null,
      error: 'Unsupported platform. Only Instagram and Twitter/X URLs are supported.',
    };
  }

  return { valid: true, platform, error: null };
}

module.exports = { detectPlatform, validateUrl };
