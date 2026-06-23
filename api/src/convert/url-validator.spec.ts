import { UnsupportedUrlError } from '../common/errors/domain.errors';
import { validateUrl } from './url-validator';

describe('validateUrl', () => {
  it.each([
    ['https://www.youtube.com/watch?v=dQw4w9WgXcQ', 'www.youtube.com'],
    ['http://example.com/path?q=1', 'example.com'],
    ['https://music.youtube.com/watch?v=abc', 'music.youtube.com'],
  ])('accepts %s', (url, host) => {
    const r = validateUrl(url);
    expect(r.host).toBe(host);
    expect(r.href).toContain('://');
  });

  it.each(['ftp://example.com/x', 'file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x'])(
    'rejects non-http scheme: %s',
    (url) => {
      expect(() => validateUrl(url)).toThrow(UnsupportedUrlError);
    },
  );

  it.each([
    'http://localhost/x',
    'http://127.0.0.1:8080/x',
    'http://10.0.0.5/x',
    'http://192.168.1.1/x',
    'http://172.16.0.1/x',
    'http://172.31.255.255/x',
    'http://169.254.1.1/x',
    'http://[::1]/x',
  ])('rejects private/loopback host: %s', (url) => {
    expect(() => validateUrl(url)).toThrow(UnsupportedUrlError);
  });

  it.each(['not-a-url', '', '   ', 'http://'])('rejects unparseable URL: %s', (url) => {
    expect(() => validateUrl(url)).toThrow(UnsupportedUrlError);
  });

  it('does not reject 172.15.x.x (just outside the private range)', () => {
    expect(() => validateUrl('http://172.15.0.1/x')).not.toThrow();
  });

  it('does not reject 172.32.x.x (just outside the private range)', () => {
    expect(() => validateUrl('http://172.32.0.1/x')).not.toThrow();
  });
});
