import { buildTrackFilename, decodeHtmlEntities, safeFilenamePart } from './filename';

describe('decodeHtmlEntities', () => {
  it('decodes the entities JioSaavn returns', () => {
    expect(decodeHtmlEntities('Barbaad (From &quot;Saiyaara&quot;)')).toBe(
      'Barbaad (From "Saiyaara")',
    );
    expect(decodeHtmlEntities('Tom &amp; Jerry')).toBe('Tom & Jerry');
    expect(decodeHtmlEntities('It&#39;s mine')).toBe("It's mine");
  });
});

describe('safeFilenamePart', () => {
  it('strips non-ASCII characters', () => {
    expect(safeFilenamePart('Café Déjà Vu')).toBe('Cafe Deja Vu');
  });

  it('removes filesystem-reserved characters', () => {
    expect(safeFilenamePart('a/b:c*d?e"f<g>h|i')).toBe('abcdefghi');
  });

  it('collapses whitespace and trims', () => {
    expect(safeFilenamePart('  hello    world  ')).toBe('hello world');
  });

  it('caps the length', () => {
    expect(safeFilenamePart('x'.repeat(200), 10)).toHaveLength(10);
  });

  it('falls back to "track" when nothing printable remains', () => {
    expect(safeFilenamePart('日本語')).toBe('track');
  });
});

describe('buildTrackFilename', () => {
  it('builds Artist - Title for a single track', () => {
    expect(buildTrackFilename({ title: 'Kesariya', artist: 'Arijit Singh' })).toBe(
      'Arijit Singh - Kesariya.mp3',
    );
  });

  it('prefixes a zero-padded track number when present', () => {
    expect(buildTrackFilename({ title: 'Song', artist: 'X', trackNo: 3 })).toBe(
      '03 - X - Song.mp3',
    );
  });

  it('works with just a title', () => {
    expect(buildTrackFilename({ title: 'Solo' })).toBe('Solo.mp3');
  });
});
