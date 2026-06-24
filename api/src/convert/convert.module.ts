import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { ConvertController } from './convert.controller';
import { EXTRACTORS } from './extractors/extractor.interface';
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
    YtDlpExtractor,
    SourceResolver,
    {
      // Ordered specific-first; the yt-dlp catch-all MUST be last.
      // New extractors (JioSaavn, Gaana, Spotify) get prepended here.
      provide: EXTRACTORS,
      useFactory: (ytdlp: YtDlpExtractor) => [ytdlp],
      inject: [YtDlpExtractor],
    },
  ],
})
export class ConvertModule {}
