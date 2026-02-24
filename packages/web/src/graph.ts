import Graph from 'graphology';
import Sigma from 'sigma';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import type { GraphExport } from '@bandmap/shared';

// Stable palette of distinct hues for tag coloring
const TAG_COLORS = [
  '#e6194b',
  '#3cb44b',
  '#ffe119',
  '#4363d8',
  '#f58231',
  '#911eb4',
  '#42d4f4',
  '#f032e6',
  '#bfef45',
  '#fabed4',
  '#469990',
  '#dcbeff',
  '#9A6324',
  '#fffac8',
  '#800000',
  '#aaffc3',
  '#808000',
  '#ffd8b1',
  '#000075',
  '#a9a9a9',
];

export interface GraphManager {
  sigma: Sigma;
  graph: Graph;
  focusNode(id: string): void;
  filterByTag(tag: string): void;
  filterByMinWeight(minWeight: number): void;
  getNeighbors(id: string): { id: string; name: string; weight: number }[];
  resetFilters(): void;
  destroy(): void;
}

/**
 * Build a graphology graph from graph export data and render it with Sigma.js.
 */
export function createGraph(container: HTMLElement, data: GraphExport): GraphManager {
  const graph = new Graph();

  // Count edges per artist to size nodes
  const edgeCounts = new Map<string, number>();
  for (const edge of data.edges) {
    edgeCounts.set(edge.source, (edgeCounts.get(edge.source) ?? 0) + 1);
    edgeCounts.set(edge.target, (edgeCounts.get(edge.target) ?? 0) + 1);
  }
  const maxEdges = Math.max(1, ...edgeCounts.values());

  // Build tag → color mapping from most common tags
  const tagCounts = new Map<string, number>();
  for (const artist of data.artists) {
    for (const tag of artist.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const sortedTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).map((e) => e[0]);
  const tagColorMap = new Map<string, string>();
  sortedTags.forEach((tag, i) => {
    tagColorMap.set(tag, TAG_COLORS[i % TAG_COLORS.length]);
  });

  // Add nodes
  for (const artist of data.artists) {
    const count = edgeCounts.get(artist.id) ?? 0;
    const size = 3 + (count / maxEdges) * 15;
    const primaryTag = artist.tags[0];
    const color = primaryTag ? (tagColorMap.get(primaryTag) ?? '#888') : '#888';

    // Random initial positions
    graph.addNode(artist.id, {
      label: artist.name,
      x: Math.random() * 1000,
      y: Math.random() * 1000,
      size,
      color,
      originalColor: color,
      originalSize: size,
      tags: artist.tags,
      url: artist.url,
      hidden: false,
    });
  }

  // Add edges
  for (const edge of data.edges) {
    if (graph.hasNode(edge.source) && graph.hasNode(edge.target)) {
      const key = `${edge.source}-${edge.target}`;
      if (!graph.hasEdge(key)) {
        graph.addEdgeWithKey(key, edge.source, edge.target, {
          weight: edge.weight,
          originalWeight: edge.weight,
          size: 0.5 + edge.weight * 2,
          color: `rgba(255,255,255,${0.05 + edge.weight * 0.15})`,
        });
      }
    }
  }

  // Run ForceAtlas2 layout
  forceAtlas2.assign(graph, {
    iterations: 100,
    settings: {
      gravity: 1,
      scalingRatio: 10,
      barnesHutOptimize: graph.order > 500,
      strongGravityMode: true,
      slowDown: 5,
    },
  });

  // Render with Sigma
  const sigma = new Sigma(graph, container, {
    renderEdgeLabels: false,
    labelRenderedSizeThreshold: 8,
    labelSize: 12,
    labelColor: { color: '#ccc' },
    defaultEdgeType: 'line',
    minEdgeThickness: 0.5,
  });

  // State for filters
  let activeTagFilter = '';
  let activeMinWeight = 0;

  function applyFilters(): void {
    // Show/hide nodes based on tag
    graph.forEachNode((node, attrs) => {
      const tags = (attrs['tags'] as string[]) ?? [];
      const visible = !activeTagFilter || tags.includes(activeTagFilter);
      graph.setNodeAttribute(node, 'hidden', !visible);
    });

    // Show/hide edges based on weight and endpoint visibility
    graph.forEachEdge((edge, attrs, source, target) => {
      const weight = attrs['originalWeight'] as number;
      const sourceHidden = graph.getNodeAttribute(source, 'hidden') as boolean;
      const targetHidden = graph.getNodeAttribute(target, 'hidden') as boolean;
      graph.setEdgeAttribute(
        edge,
        'hidden',
        sourceHidden || targetHidden || weight < activeMinWeight,
      );
    });
  }

  function focusNode(id: string): void {
    if (!graph.hasNode(id)) return;

    const nodeAttrs = graph.getNodeAttributes(id);
    const x = nodeAttrs['x'] as number;
    const y = nodeAttrs['y'] as number;

    // Center camera on node
    sigma.getCamera().animate({ x, y, ratio: 0.2 }, { duration: 500 });

    // Highlight: dim all nodes except this one and its neighbors
    const neighbors = new Set(graph.neighbors(id));
    neighbors.add(id);

    graph.forEachNode((node, attrs) => {
      if (neighbors.has(node)) {
        graph.setNodeAttribute(node, 'color', attrs['originalColor']);
        graph.setNodeAttribute(node, 'size', attrs['originalSize']);
      } else {
        graph.setNodeAttribute(node, 'color', '#222');
        graph.setNodeAttribute(node, 'size', (attrs['originalSize'] as number) * 0.5);
      }
    });

    graph.forEachEdge((edge, _attrs, source, target) => {
      const connected = source === id || target === id;
      graph.setEdgeAttribute(
        edge,
        'color',
        connected ? 'rgba(108,140,255,0.6)' : 'rgba(255,255,255,0.02)',
      );
    });
  }

  function resetFilters(): void {
    activeTagFilter = '';
    activeMinWeight = 0;
    graph.forEachNode((node, attrs) => {
      graph.setNodeAttribute(node, 'color', attrs['originalColor']);
      graph.setNodeAttribute(node, 'size', attrs['originalSize']);
      graph.setNodeAttribute(node, 'hidden', false);
    });
    graph.forEachEdge((edge, attrs) => {
      const w = attrs['originalWeight'] as number;
      graph.setEdgeAttribute(edge, 'color', `rgba(255,255,255,${0.05 + w * 0.15})`);
      graph.setEdgeAttribute(edge, 'hidden', false);
    });
  }

  function filterByTag(tag: string): void {
    resetFilters();
    activeTagFilter = tag;
    applyFilters();
  }

  function filterByMinWeight(minWeight: number): void {
    activeMinWeight = minWeight;
    applyFilters();
  }

  function getNeighbors(id: string): { id: string; name: string; weight: number }[] {
    if (!graph.hasNode(id)) return [];

    const result: { id: string; name: string; weight: number }[] = [];
    graph.forEachEdge(id, (edge, attrs, source, target) => {
      const neighborId = source === id ? target : source;
      result.push({
        id: neighborId,
        name: graph.getNodeAttribute(neighborId, 'label') as string,
        weight: attrs['weight'] as number,
      });
    });

    return result.sort((a, b) => b.weight - a.weight);
  }

  function destroy(): void {
    sigma.kill();
  }

  return {
    sigma,
    graph,
    focusNode,
    filterByTag,
    filterByMinWeight,
    getNeighbors,
    resetFilters,
    destroy,
  };
}
