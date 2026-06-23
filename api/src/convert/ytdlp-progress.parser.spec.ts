import { parseLine } from './ytdlp-progress.parser';

describe('parseLine', () => {
  it('parses standard download progress', () => {
    const r = parseLine('[download]  42.3% of    3.42MiB at  1.24MiB/s ETA 00:14');
    expect(r).toEqual({
      stage: 'download',
      percent: 42.3,
      size: '3.42MiB',
      speed: '1.24MiB/s',
      eta: '00:14',
    });
  });

  it('parses progress with "Unknown speed"', () => {
    const r = parseLine('[download]   2.3% of    3.42MiB at Unknown speed ETA Unknown');
    expect(r?.stage).toBe('download');
    expect(r?.percent).toBe(2.3);
  });

  it('parses final download line with elapsed time', () => {
    const r = parseLine('[download] 100% of 3.42MiB in 00:02');
    expect(r?.percent).toBe(100);
    expect(r?.stage).toBe('download');
  });

  it('parses integer percent', () => {
    const r = parseLine('[download]   0% of 3.42MiB at Unknown speed ETA Unknown');
    expect(r?.percent).toBe(0);
  });

  it.each([
    ['[ExtractAudio] Destination: /tmp/x.mp3', 'extract_audio'],
    ['[Metadata] Adding metadata to "/tmp/x.mp3"', 'metadata'],
    ['[VideoConvertor] Converting video', 'video_convert'],
  ])('parses stage line %s', (line, stage) => {
    expect(parseLine(line)).toEqual({ stage });
  });

  it.each([
    '[info] Downloading 1 format(s): 251',
    '[youtube] dQw4w9WgXcQ: Downloading webpage',
    'Some random text',
    '',
    'Deleting original file /tmp/foo.webm',
  ])('returns null for non-matching line: %s', (line) => {
    expect(parseLine(line)).toBeNull();
  });
});
