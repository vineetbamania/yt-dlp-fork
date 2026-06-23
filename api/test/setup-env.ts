process.env.NODE_ENV = 'test';
process.env.AUTH_TOKEN = process.env.AUTH_TOKEN ?? 'test-token-with-at-least-32-chars-xx';
process.env.PORT = '8888';
process.env.TMP_DIR = process.env.TMP_DIR ?? '/tmp/yt-dlp-fork-test';
process.env.LOG_LEVEL = 'error';
