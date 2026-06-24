import {
  JioSaavnClient,
  bestQualityUrl,
  decryptMediaUrl,
  parseTypeAndToken,
} from './jiosaavn.client';

describe('decryptMediaUrl', () => {
  // Verified against the live JioSaavn API on 2026-06-24: this encrypted blob
  // decrypts to this exact CDN URL (the scheme is deterministic, so the vector
  // is stable regardless of JioSaavn changing their catalog).
  const ENCRYPTED =
    'ID2ieOjCrwfgWvL5sXl4B1ImC5QfbsDyryhkSYK5IH2E7FCO52VR6yhNbcEbes5iCcja4+W8xhE0SwtCJToN4Bw7tS9a8Gtq';
  const EXPECTED = 'https://aac.saavncdn.com/871/c2febd353f3a076a406fa37510f31f9f_96.mp4';

  it('decrypts a known encrypted_media_url to its CDN URL', () => {
    expect(decryptMediaUrl(ENCRYPTED)).toBe(EXPECTED);
  });

  it('throws when the decrypted value is not a URL', () => {
    expect(() => decryptMediaUrl('bm90LWEtdXJs')).toThrow();
  });
});

describe('bestQualityUrl', () => {
  const base = 'https://aac.saavncdn.com/871/abc_96.mp4';

  it('upgrades the bitrate suffix to 320 when 320kbps is available', () => {
    expect(bestQualityUrl(base, true)).toBe('https://aac.saavncdn.com/871/abc_320.mp4');
  });

  it('leaves the URL untouched when 320kbps is not available', () => {
    expect(bestQualityUrl(base, false)).toBe(base);
  });

  it('handles other source bitrates (e.g. _160)', () => {
    expect(bestQualityUrl('https://aac.saavncdn.com/x/y_160.mp4', true)).toBe(
      'https://aac.saavncdn.com/x/y_320.mp4',
    );
  });
});

describe('parseTypeAndToken', () => {
  it('parses a song perma URL', () => {
    expect(parseTypeAndToken('https://www.jiosaavn.com/song/kesariya/AgIAQyBeWlI')).toEqual({
      type: 'song',
      token: 'AgIAQyBeWlI',
    });
  });

  it('parses an album perma URL', () => {
    expect(parseTypeAndToken('https://www.jiosaavn.com/album/brahmastra/xq4v9ZFC9iA_')).toEqual({
      type: 'album',
      token: 'xq4v9ZFC9iA_',
    });
  });

  it('parses a featured playlist perma URL', () => {
    expect(
      parseTypeAndToken('https://www.jiosaavn.com/featured/lets-play/cyd1elB4lx5ieSJqt9HmOQ__'),
    ).toEqual({ type: 'playlist', token: 'cyd1elB4lx5ieSJqt9HmOQ__' });
  });

  it('tolerates a trailing slash', () => {
    expect(parseTypeAndToken('https://www.jiosaavn.com/song/x/TOKEN/')).toEqual({
      type: 'song',
      token: 'TOKEN',
    });
  });

  it('throws when no token can be derived', () => {
    expect(() => parseTypeAndToken('https://www.jiosaavn.com/')).toThrow();
  });
});

describe('JioSaavnClient.handles', () => {
  it.each([
    ['https://www.jiosaavn.com/song/x/y', true],
    ['https://jiosaavn.com/s/song/abc', true],
    ['https://www.saavn.com/song/x/y', true],
    ['https://open.spotify.com/track/x', false],
    ['https://youtube.com/watch?v=x', false],
  ])('handles(%s) === %s', (url, expected) => {
    expect(JioSaavnClient.handles(new URL(url))).toBe(expected);
  });
});
