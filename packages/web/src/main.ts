import type { GraphExport } from '@bandmap/shared';
import { createGraph, type GraphManager } from './graph.js';

const GRAPH_DATA_URL = './graph.json';

async function main(): Promise<void> {
  const container = document.getElementById('graph-container')!;
  const searchInput = document.getElementById('search') as HTMLInputElement;
  const searchResults = document.getElementById('search-results')!;
  const tagFilter = document.getElementById('tag-filter') as HTMLSelectElement;
  const minWeightSlider = document.getElementById('min-weight') as HTMLInputElement;
  const minWeightValue = document.getElementById('min-weight-value')!;
  const statsEl = document.getElementById('stats')!;

  // Detail panel elements
  const detailPanel = document.getElementById('detail-panel')!;
  const closePanel = document.getElementById('close-panel')!;
  const detailName = document.getElementById('detail-name')!;
  const detailTags = document.getElementById('detail-tags')!;
  const detailUrl = document.getElementById('detail-url') as HTMLAnchorElement;
  const detailSimilar = document.getElementById('detail-similar')!;

  // Show loading
  container.innerHTML = '<div class="loading">Loading graph data...</div>';

  // Fetch graph data
  let data: GraphExport;
  try {
    const response = await fetch(GRAPH_DATA_URL);
    if (!response.ok) {
      throw new Error(`Failed to load graph data: ${response.statusText}`);
    }
    data = (await response.json()) as GraphExport;
  } catch (err) {
    container.innerHTML = `<div class="loading">Error loading graph data. Place graph.json in public/ directory.</div>`;
    console.error(err);
    return;
  }

  container.innerHTML = '';

  // Create the graph
  const manager: GraphManager = createGraph(container, data);

  // Stats
  statsEl.textContent = `${data.artists.length} artists, ${data.edges.length} edges`;

  // Populate tag filter
  const tagCounts = new Map<string, number>();
  for (const artist of data.artists) {
    for (const tag of artist.tags) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }
  const sortedTags = [...tagCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 50);
  for (const [tag, count] of sortedTags) {
    const option = document.createElement('option');
    option.value = tag;
    option.textContent = `${tag} (${count})`;
    tagFilter.appendChild(option);
  }

  // Build search index
  const artistIndex = data.artists.map((a) => ({
    id: a.id,
    name: a.name,
    nameLower: a.name.toLowerCase(),
  }));

  // --- Event handlers ---

  // Search
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.toLowerCase().trim();
    searchResults.innerHTML = '';

    if (query.length < 2) {
      searchResults.classList.remove('visible');
      return;
    }

    const matches = artistIndex.filter((a) => a.nameLower.includes(query)).slice(0, 20);

    if (matches.length === 0) {
      searchResults.classList.remove('visible');
      return;
    }

    for (const match of matches) {
      const li = document.createElement('li');
      li.textContent = match.name;
      li.addEventListener('click', () => {
        selectArtist(match.id);
        searchInput.value = match.name;
        searchResults.classList.remove('visible');
      });
      searchResults.appendChild(li);
    }
    searchResults.classList.add('visible');
  });

  // Close search results on outside click
  document.addEventListener('click', (e) => {
    if (!(e.target as HTMLElement).closest('.search-box')) {
      searchResults.classList.remove('visible');
    }
  });

  // Tag filter
  tagFilter.addEventListener('change', () => {
    const tag = tagFilter.value;
    if (tag) {
      manager.filterByTag(tag);
    } else {
      manager.resetFilters();
    }
  });

  // Min weight filter
  minWeightSlider.addEventListener('input', () => {
    const val = Number.parseFloat(minWeightSlider.value);
    minWeightValue.textContent = val.toFixed(2);
    manager.filterByMinWeight(val);
  });

  // Click on graph node
  manager.sigma.on('clickNode', ({ node }) => {
    selectArtist(node);
  });

  // Close detail panel
  closePanel.addEventListener('click', () => {
    detailPanel.classList.add('hidden');
    manager.resetFilters();
  });

  // Double-click to reset
  manager.sigma.on('clickStage', () => {
    detailPanel.classList.add('hidden');
    manager.resetFilters();
  });

  function selectArtist(id: string): void {
    manager.focusNode(id);

    const artist = data.artists.find((a) => a.id === id);
    if (!artist) return;

    // Populate detail panel
    detailName.textContent = artist.name;
    detailUrl.href = artist.url;
    detailUrl.textContent = 'View on Last.fm →';

    // Tags
    detailTags.innerHTML = '';
    for (const tag of artist.tags) {
      const badge = document.createElement('span');
      badge.className = 'tag-badge';
      badge.textContent = tag;
      detailTags.appendChild(badge);
    }

    // Similar artists
    const neighbors = manager.getNeighbors(id);
    detailSimilar.innerHTML = '';
    for (const neighbor of neighbors.slice(0, 20)) {
      const li = document.createElement('li');
      li.innerHTML = `
        <span>${neighbor.name}</span>
        <span class="match-score">${(neighbor.weight * 100).toFixed(0)}%</span>
      `;
      li.addEventListener('click', () => selectArtist(neighbor.id));
      detailSimilar.appendChild(li);
    }

    detailPanel.classList.remove('hidden');
  }
}

await main();
