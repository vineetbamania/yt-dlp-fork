import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Env } from '../config/env';

@Injectable()
export class TempDirService implements OnModuleInit {
  private readonly logger = new Logger(TempDirService.name);
  private readonly root: string;

  constructor(config: ConfigService<Env, true>) {
    this.root = resolve(config.get('TMP_DIR', { infer: true }));
  }

  async onModuleInit(): Promise<void> {
    await mkdir(this.root, { recursive: true });
    this.logger.log(`Temp root: ${this.root}`);
  }

  async create(prefix: string): Promise<string> {
    return mkdtemp(join(this.root, `${prefix}-`));
  }

  async cleanup(dir: string): Promise<void> {
    if (!dir.startsWith(this.root)) {
      this.logger.warn(`Refusing to cleanup path outside temp root: ${dir}`);
      return;
    }
    await rm(dir, { recursive: true, force: true });
  }
}
