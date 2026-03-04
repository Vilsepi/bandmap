import { getArtist, getRelatedArtists, listRatings } from '../api.js';
import { addToGraphData, buildGraphData, getCollectedArtist } from '../graph-data.js';
import { createGraph, type GraphManager } from '../graph.js';
import { escapeHtml } from '../utils.js';

let graphManager: GraphManager | null = null;

export async function initGraphView(): Promise<void> {
  const container = document.getElementById('graph-container');
  if (!container) return;

  try {
    const { ratings } = await listRatings('rated');
    await mapWithConcurrency(ratings.slice(0, 20), 4, async (rating) => {
      try {
        const [{ artist }, { related }] = await Promise.all([
          getArtist(rating.artistMbid),
          getRelatedArtists(rating.artistMbid),
        ]);
        addToGraphData(artist, related);
      } catch {
        return;
      }
    });
  } catch {
    // If ratings fail, just use whatever graph data we already collected.
  }

  const data = buildGraphData();
  if (data.artists.length === 0) {
    container.innerHTML =
      '<p class="empty-state">No graph data yet. Search for some artists first!</p>';
    return;
  }

  if (graphManager) {
    graphManager.destroy();
    graphManager = null;
  }

  container.innerHTML = '';
  graphManager = createGraph(container, data);

  const tagFilter = document.getElementById('tag-filter') as HTMLSelectElement;
  const minWeightSlider = document.getElementById('min-weight') as HTMLInputElement;
  const minWeightValue = document.getElementById('min-weight-value');
  if (!minWeightValue) return;

  const tagCounts = new Map<string, number>();
  for (const artist of data.artists) {
    for (const tag of artist.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const sortedTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
  tagFilter.innerHTML = '<option value="">All tags</option>';
  for (const [tag, count] of sortedTags) {
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = `${tag} (${count})`;
    tagFilter.appendChild(option);
  }

  tagFilter.onchange = () => {
    if (!graphManager) return;
    const selectedTag = tagFilter.value;
    if (selectedTag) {
      graphManager.filterByTag(selectedTag);
    } else {
      graphManager.resetFilters();
    }
  };

  minWeightSlider.oninput = () => {
    if (!graphManager) return;
    const value = Number.parseFloat(minWeightSlider.value);
    minWeightValue.textContent = value.toFixed(2);
    graphManager.filterByMinWeight(value);
  };

  graphManager.sigma.on('clickNode', ({ node }) => {
    if (!graphManager) return;
    graphManager.focusNode(node);

    const detail = document.getElementById('graph-detail');
    const nameEl = document.getElementById('graph-detail-name');
    const tagsEl = document.getElementById('graph-detail-tags');
    const similarEl = document.getElementById('graph-detail-similar');
    if (!detail || !nameEl || !tagsEl || !similarEl) return;

    const artistData = getCollectedArtist(node);
    if (!artistData) return;

    nameEl.textContent = artistData.name;
    tagsEl.innerHTML = artistData.tags
      .map((tag) => `<span class="tag-badge">${escapeHtml(tag)}</span>`)
      .join('');

    const neighbors = graphManager.getNeighbors(node);
    similarEl.innerHTML = neighbors
      .slice(0, 15)
      .map(
        (neighbor) =>
          `<li><span>${escapeHtml(neighbor.name)}</span><span class="match-score">${(neighbor.weight * 100).toFixed(0)}%</span></li>`,
      )
      .join('');

    detail.classList.remove('hidden');
  });

  const closeDetailButton = document.getElementById('close-graph-detail');
  if (closeDetailButton) {
    closeDetailButton.onclick = () => {
      document.getElementById('graph-detail')?.classList.add('hidden');
      graphManager?.resetFilters();
    };
  }
}

async function mapWithConcurrency<T>(
  values: T[],
  limit: number,
  mapper: (value: T) => Promise<void>,
): Promise<void> {
  if (values.length === 0) return;

  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(limit, values.length));

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < values.length) {
        const currentIndex = nextIndex;
        nextIndex += 1;
        await mapper(values[currentIndex]);
      }
    }),
  );
}
