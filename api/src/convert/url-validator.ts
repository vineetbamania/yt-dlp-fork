import { UnsupportedUrlError } from '../common/errors/domain.errors';

const ALLOWED_SCHEMES = new Set(['http:', 'https:']);

// Block hostnames that resolve to private / loopback / link-local ranges.
// yt-dlp itself doesn't fetch arbitrary URLs, but we never want a user-pasted
// URL to point at internal infra. Cheap belt-and-suspenders.
const BLOCKED_HOST_PATTERNS: RegExp[] = [
  /^localhost$/i,
  /^127(?:\.\d{1,3}){3}$/,
  /^::1$/,
  /^0\.0\.0\.0$/,
  /^10(?:\.\d{1,3}){3}$/,
  /^192\.168(?:\.\d{1,3}){2}$/,
  /^172\.(1[6-9]|2\d|3[01])(?:\.\d{1,3}){2}$/,
  /^169\.254(?:\.\d{1,3}){2}$/, // link-local
  /^fe80::/i, // ipv6 link-local
  /^fc00::/i, // ipv6 unique-local
];

export interface ValidatedUrl {
  href: string;
  host: string;
}

export function validateUrl(raw: string): ValidatedUrl {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new UnsupportedUrlError('URL is not parseable');
  }

  if (!ALLOWED_SCHEMES.has(parsed.protocol)) {
    throw new UnsupportedUrlError(`Unsupported URL scheme: ${parsed.protocol}`);
  }

  if (!parsed.hostname) {
    throw new UnsupportedUrlError('URL has no hostname');
  }

  // URL parser preserves IPv6 brackets in .hostname (e.g. "[::1]") — strip
  // for matching but keep the original for error messages.
  const hostForMatching = parsed.hostname.replace(/^\[|\]$/g, '');

  for (const pattern of BLOCKED_HOST_PATTERNS) {
    if (pattern.test(hostForMatching)) {
      throw new UnsupportedUrlError(`Refusing to fetch from private host ${parsed.hostname}`);
    }
  }

  return { href: parsed.href, host: parsed.hostname };
}
