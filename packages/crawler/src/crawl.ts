import type { ArtistRelation, Tag } from '@bandmap/shared';
import { LastFmClient, LastFmApiError } from './client.js';
import { RateLimiter } from './rateLimiter.js';
import type { CrawlStore } from './store/interface.js';

export interface CrawlOptions {
  maxDepth: number;
  maxArtists: number;
}

/**
 * BFS crawler that traverses the Last.fm artist similarity graph.
 */
export async function crawl(
  client: LastFmClient,
  store: CrawlStore,
  options: CrawlOptions,
): Promise<void> {
  const rateLimiter = new RateLimiter();
  const stats = store.getQueueStats();
  let crawledCount = stats.done;

  console.log(
    `Starting crawl: ${stats.pending} pending, ${stats.done} done, ${stats.error} errors`,
  );

  while (true) {
    if (crawledCount >= options.maxArtists) {
      console.log(`Reached max artists limit (${options.maxArtists}). Stopping.`);
      break;
    }

    const entry = store.dequeue();
    if (!entry) {
      console.log('No more pending artists in queue. Crawl complete.');
      break;
    }

    if (entry.depth > options.maxDepth) {
      // This artist exceeds max depth; skip and mark done without crawling
      store.markDone(entry.mbid);
      continue;
    }

    const totalInQueue = crawledCount + store.getQueueStats().pending;
    console.log(
      `[${crawledCount + 1}/${Math.min(totalInQueue, options.maxArtists)}] ` +
        `Crawling "${entry.name}" (${entry.mbid}) depth=${entry.depth}`,
    );

    try {
      // 1. Fetch artist info
      const info = await rateLimiter.execute(() => client.getArtistInfo(entry.mbid), isRetryable);

      const now = new Date().toISOString();

      // Upsert tags
      if (info.artist.tags.length > 0) {
        store.upsertTags(info.artist.tags);
      }

      // Upsert artist
      store.upsertArtist({
        mbid: info.artist.mbid,
        name: info.artist.name,
        url: info.artist.url,
        tags: info.artist.tags.map((t: Tag) => t.name),
        fetchedAt: now,
      });

      // 2. Fetch similar artists
      const similar = await rateLimiter.execute(
        () => client.getSimilarArtists(entry.mbid),
        isRetryable,
      );

      // Build relations
      const relations: ArtistRelation[] = similar.map((s) => ({
        sourceMbid: entry.mbid,
        targetMbid: s.mbid,
        targetName: s.name,
        targetUrl: s.url,
        match: s.match,
        fetchedAt: now,
      }));

      if (relations.length > 0) {
        store.upsertRelations(relations);
      }

      // 3. Enqueue new artists (only those with mbid)
      for (const s of similar) {
        if (s.mbid && !store.hasArtist(s.mbid) && !store.isInQueue(s.mbid)) {
          store.enqueue(s.mbid, s.name, entry.depth + 1);
        }
      }

      // 4. Mark done
      store.markDone(entry.mbid);
      crawledCount++;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Error crawling "${entry.name}" (${entry.mbid}): ${message}`);
      store.markError(entry.mbid, message);
    }
  }

  const finalStats = store.getQueueStats();
  console.log(
    `Crawl finished: ${finalStats.done} done, ${finalStats.pending} pending, ${finalStats.error} errors`,
  );
}

function isRetryable(error: unknown): boolean {
  if (error instanceof LastFmApiError) {
    return error.retryable;
  }
  // Network errors are retryable
  if (error instanceof TypeError) {
    return true;
  }
  return false;
}
