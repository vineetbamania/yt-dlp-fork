import { buildYtDlpArgs } from './ytdlp.service';

describe('buildYtDlpArgs', () => {
  const opts = { url: 'https://youtube.com/watch?v=abc', outputDir: '/tmp/job-1' };

  it('requests MP3 audio extraction', () => {
    const args = buildYtDlpArgs(opts, '192K');
    expect(args).toContain('--extract-audio');
    expect(args).toEqual(expect.arrayContaining(['--audio-format', 'mp3']));
  });

  it('passes the bitrate as a CBR --audio-quality value', () => {
    const args = buildYtDlpArgs(opts, '192K');
    const idx = args.indexOf('--audio-quality');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('192K');
  });

  it('forces ID3v1 + ID3v2.3 tags via postprocessor args', () => {
    const args = buildYtDlpArgs(opts, '192K');
    const idx = args.indexOf('--postprocessor-args');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('ExtractAudio:-id3v2_version 3 -write_id3v1 1');
  });

  it('keeps single-track mode and restricted filenames', () => {
    const args = buildYtDlpArgs(opts, '128K');
    expect(args).toContain('--no-playlist');
    expect(args).toContain('--restrict-filenames');
  });

  it('puts the output dir and URL in place', () => {
    const args = buildYtDlpArgs(opts, '192K');
    const pathsIdx = args.indexOf('--paths');
    expect(args[pathsIdx + 1]).toBe('/tmp/job-1');
    expect(args[args.length - 1]).toBe(opts.url); // URL is always the final positional arg
  });

  it('omits --cookies when no cookies path is given', () => {
    expect(buildYtDlpArgs(opts, '192K')).not.toContain('--cookies');
  });

  it('passes --cookies with the resolved path when provided', () => {
    const args = buildYtDlpArgs(opts, '192K', '/data/cookies.txt');
    const idx = args.indexOf('--cookies');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe('/data/cookies.txt');
    expect(args[args.length - 1]).toBe(opts.url); // URL still the final positional arg
  });
});
