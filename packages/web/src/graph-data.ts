import type { Artist, RelatedArtist } from '@bandmap/shared';
import type { GraphData } from './graph.js';

type CollectedArtist = {
  name: string;
  url: string;
  tags: string[];
};

const collectedArtists = new Map<string, CollectedArtist>();
const collectedEdges: { source: string; target: string; weight: number }[] = [];

export function addToGraphData(artist: Artist, related: RelatedArtist[]): void {
  collectedArtists.set(artist.mbid, {
    name: artist.name,
    url: artist.url,
    tags: artist.tags,
  });

  for (const relation of related) {
    collectedEdges.push({
      source: artist.mbid,
      target: relation.targetMbid,
      weight: relation.match,
    });

    if (!collectedArtists.has(relation.targetMbid)) {
      collectedArtists.set(relation.targetMbid, {
        name: relation.targetName,
        url: '',
        tags: [],
      });
    }
  }
}

export function buildGraphData(): GraphData {
  return {
    artists: [...collectedArtists.entries()].map(([id, data]) => ({
      id,
      name: data.name,
      url: data.url,
      tags: data.tags,
    })),
    edges: collectedEdges,
  };
}

export function getCollectedArtist(mbid: string): CollectedArtist | undefined {
  return collectedArtists.get(mbid);
}
