import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { ConvertController } from './convert.controller';
import { JobsService } from './jobs.service';
import { YtDlpService } from './ytdlp.service';

@Module({
  imports: [CommonModule],
  controllers: [ConvertController],
  providers: [JobsService, YtDlpService],
})
export class ConvertModule {}
