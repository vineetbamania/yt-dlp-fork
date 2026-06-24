import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { AudioNormalizer } from './audio-normalizer.service';
import { ConvertController } from './convert.controller';
import { EXTRACTORS } from './extractors/extractor.interface';
import { JioSaavnClient } from './extractors/jiosaavn.client';
import { JioSaavnExtractor } from './extractors/jiosaavn.extractor';
import { SourceResolver } from './extractors/source-resolver';
import { YtDlpExtractor } from './extractors/ytdlp.extractor';
import { JobsService } from './jobs.service';
import { YtDlpService } from './ytdlp.service';

@Module({
  imports: [CommonModule],
  controllers: [ConvertController],
  providers: [
    JobsService,
    YtDlpService,
    AudioNormalizer,
    { provide: JioSaavnClient, useFactory: () => new JioSaavnClient() },
    JioSaavnExtractor,
    YtDlpExtractor,
    SourceResolver,
    {
      // Ordered specific-first; the yt-dlp catch-all MUST be last.
      // New extractors (Gaana, Spotify) get prepended before YtDlpExtractor.
      provide: EXTRACTORS,
      useFactory: (jiosaavn: JioSaavnExtractor, ytdlp: YtDlpExtractor) => [jiosaavn, ytdlp],
      inject: [JioSaavnExtractor, YtDlpExtractor],
    },
  ],
})
export class ConvertModule {}
