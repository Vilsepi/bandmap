import type { Tag, Artist, ArtistRelation, GraphExport } from '@bandmap/shared';

/** Queue stats returned by getQueueStats */
export interface QueueStats {
  pending: number;
  done: number;
  error: number;
}

/** Storage abstraction for the crawler */
export interface CrawlStore {
  // Tags
  upsertTags(tags: Tag[]): void;
  getAllTags(): Tag[];

  // Artist CRUD
  upsertArtist(artist: Artist): void;
  getArtist(mbid: string): Artist | null;
  hasArtist(mbid: string): boolean;

  // Relations
  upsertRelations(relations: ArtistRelation[]): void;
  getRelationsFrom(mbid: string): ArtistRelation[];
  getRelationsTo(mbid: string): ArtistRelation[];

  // Crawl queue
  enqueue(mbid: string, name: string, depth: number): void;
  dequeue(): { mbid: string; name: string; depth: number } | null;
  markDone(mbid: string): void;
  markError(mbid: string, error: string): void;
  getQueueStats(): QueueStats;
  isInQueue(mbid: string): boolean;

  // Export
  exportGraph(): GraphExport;

  close(): void;
}
