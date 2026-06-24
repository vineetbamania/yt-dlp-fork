import { Inject, Injectable, Logger } from '@nestjs/common';
import { EXTRACTORS, type Extractor } from './extractor.interface';

/**
 * Picks an extractor for a URL: the first whose `supports()` claims the host.
 * The injected list is ordered specific-first with the yt-dlp catch-all last,
 * so an unrecognised host always falls through to yt-dlp.
 */
@Injectable()
export class SourceResolver {
  private readonly logger = new Logger(SourceResolver.name);

  constructor(@Inject(EXTRACTORS) private readonly extractors: Extractor[]) {}

  resolve(rawUrl: string): Extractor {
    const url = new URL(rawUrl);
    for (const extractor of this.extractors) {
      if (extractor.supports(url)) {
        this.logger.log(`Routing ${url.host} -> ${extractor.name}`);
        return extractor;
      }
    }
    // Unreachable in practice: the yt-dlp catch-all returns true for everything.
    // Guard anyway so a misconfigured provider list fails loudly.
    throw new Error(`No extractor matched URL host: ${url.host}`);
  }
}
