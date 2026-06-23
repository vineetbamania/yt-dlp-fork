import { Module } from '@nestjs/common';
import { TempDirService } from './temp-dir.service';

@Module({
  providers: [TempDirService],
  exports: [TempDirService],
})
export class CommonModule {}
