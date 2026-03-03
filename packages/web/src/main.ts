import type { Artist, RelatedArtist, Opinion, Recommendation } from '@bandmap/shared';
import {
  searchArtists,
  getArtist,
  getRelatedArtists,
  listOpinions,
  putOpinion,
  deleteOpinion,
  getRecommendations,
  generateRecommendations,
  setApiKey,
  hasApiKey,
} from './api.js';
import { createGraph, type GraphManager, type GraphData } from './graph.js';

// ── View navigation ──────────────────────────────────────────

type ViewName = 'search' | 'ratings' | 'todo' | 'recommendations' | 'graph';

const navLinks = document.querySelectorAll<HTMLAnchorElement>('.nav-link');
const views = document.querySelectorAll<HTMLElement>('.view');

let graphManager: GraphManager | null = null;

function showView(name: ViewName): void {
  views.forEach((v) => v.classList.remove('active'));
  navLinks.forEach((l) => l.classList.remove('active'));

  const view = document.getElementById(`view-${name}`);
  const link = document.querySelector(`[data-view="${name}"]`);
  if (view) view.classList.add('active');
  if (link) link.classList.add('active');

  // Load data for the view
  if (name === 'ratings') void loadRatings();
  if (name === 'todo') void loadTodo();
  if (name === 'recommendations') void loadRecommendations();
  if (name === 'graph') void initGraph();
}

navLinks.forEach((link) => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const viewName = link.dataset['view'] as ViewName | undefined;
    if (viewName) showView(viewName);
  });
});

// ── API Key settings ─────────────────────────────────────────

const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
const saveApiKeyBtn = document.getElementById('save-api-key')!;

// Restore saved key
if (hasApiKey()) {
  apiKeyInput.value = '••••••••';
}

saveApiKeyBtn.addEventListener('click', () => {
  const key = apiKeyInput.value.trim();
  if (key && key !== '••••••••') {
    setApiKey(key);
    apiKeyInput.value = '••••••••';
  }
});

// ── Search ───────────────────────────────────────────────────

const searchInput = document.getElementById('search') as HTMLInputElement;
const searchResultsEl = document.getElementById('search-results')!;
const artistDetailEl = document.getElementById('artist-detail')!;
const detailContentEl = document.getElementById('detail-content')!;
const backToResultsBtn = document.getElementById('back-to-results')!;

let searchTimeout: ReturnType<typeof setTimeout> | null = null;

searchInput.addEventListener('input', () => {
  const query = searchInput.value.trim();
  if (searchTimeout) clearTimeout(searchTimeout);

  if (query.length < 2) {
    searchResultsEl.innerHTML = '';
    return;
  }

  searchTimeout = setTimeout(() => {
    void performSearch(query);
  }, 300);
});

async function performSearch(query: string): Promise<void> {
  try {
    const { results } = await searchArtists(query);
    searchResultsEl.innerHTML = '';
    artistDetailEl.classList.add('hidden');

    if (results.length === 0) {
      searchResultsEl.innerHTML = '<p class="empty-state">No results found</p>';
      return;
    }

    for (const result of results) {
      const card = document.createElement('div');
      card.className = 'card clickable';
      card.innerHTML = `
        <div class="card-title">${escapeHtml(result.name)}</div>
        <div class="card-subtitle">${escapeHtml(result.mbid)}</div>
      `;
      card.addEventListener('click', () => void showArtistDetail(result.mbid));
      searchResultsEl.appendChild(card);
    }
  } catch (err) {
    searchResultsEl.innerHTML = `<p class="empty-state">Error: ${escapeHtml(String(err))}</p>`;
  }
}

backToResultsBtn.addEventListener('click', () => {
  artistDetailEl.classList.add('hidden');
  searchResultsEl.style.display = '';
});

async function showArtistDetail(mbid: string): Promise<void> {
  searchResultsEl.style.display = 'none';
  artistDetailEl.classList.remove('hidden');
  detailContentEl.innerHTML = '<p class="empty-state">Loading...</p>';

  try {
    const [{ artist }, { related }] = await Promise.all([getArtist(mbid), getRelatedArtists(mbid)]);

    // Add to graph data if we're collecting it
    addToGraphData(artist, related);

    detailContentEl.innerHTML = renderArtistDetail(artist, related);
    attachDetailActions(artist, related);
  } catch (err) {
    detailContentEl.innerHTML = `<p class="empty-state">Error: ${escapeHtml(String(err))}</p>`;
  }
}

function renderArtistDetail(artist: Artist, related: RelatedArtist[]): string {
  const tagBadges = artist.tags
    .map((t) => `<span class="tag-badge">${escapeHtml(t)}</span>`)
    .join('');

  const relatedList = related
    .slice(0, 30)
    .map(
      (r) => `
      <li class="related-item" data-mbid="${escapeHtml(r.targetMbid)}">
        <span>${escapeHtml(r.targetName)}</span>
        <span class="match-score">${(r.match * 100).toFixed(0)}%</span>
      </li>
    `,
    )
    .join('');

  return `
    <h3>${escapeHtml(artist.name)}</h3>
    <div class="tag-list">${tagBadges}</div>
    <a href="${escapeHtml(artist.url)}" target="_blank" rel="noopener" class="external-link">
      View on Last.fm &rarr;
    </a>
    <div class="action-bar">
      <div class="star-rating" id="star-rating">
        ${[1, 2, 3, 4, 5].map((n) => `<button class="star" data-score="${n}">&#9733;</button>`).join('')}
      </div>
      <button class="btn-secondary" id="btn-todo">Add to Todo</button>
    </div>
    <h4>Related Artists</h4>
    <ul class="related-list">${relatedList}</ul>
  `;
}

function attachDetailActions(artist: Artist, _related: RelatedArtist[]): void {
  // Star rating
  const stars = detailContentEl.querySelectorAll<HTMLButtonElement>('.star');
  stars.forEach((star) => {
    star.addEventListener('click', () => {
      const score = Number(star.dataset['score']);
      void putOpinion(artist.mbid, { score, status: 'rated' });
      stars.forEach((s) => {
        s.classList.toggle('active', Number(s.dataset['score']) <= score);
      });
    });
  });

  // Bookmark button
  const todoBtn = detailContentEl.querySelector('#btn-todo');
  todoBtn?.addEventListener('click', () => {
    void putOpinion(artist.mbid, { score: null, status: 'todo' });
    if (todoBtn instanceof HTMLButtonElement) {
      todoBtn.textContent = 'Added!';
      todoBtn.disabled = true;
    }
  });

  // Clickable related artists
  const relatedItems = detailContentEl.querySelectorAll<HTMLElement>('.related-item');
  relatedItems.forEach((item) => {
    item.addEventListener('click', () => {
      const mbid = item.dataset['mbid'];
      if (mbid) void showArtistDetail(mbid);
    });
  });
}

// ── Ratings view ─────────────────────────────────────────────

async function loadRatings(): Promise<void> {
  const container = document.getElementById('ratings-list')!;
  container.innerHTML = '<p class="empty-state">Loading...</p>';

  try {
    const { opinions } = await listOpinions('rated');
    if (opinions.length === 0) {
      container.innerHTML =
        '<p class="empty-state">No ratings yet. Search and rate some artists!</p>';
      return;
    }

    container.innerHTML = '';
    for (const opinion of opinions) {
      const card = renderOpinionCard(opinion);
      container.appendChild(card);
    }
  } catch (err) {
    container.innerHTML = `<p class="empty-state">Error: ${escapeHtml(String(err))}</p>`;
  }
}

// ── Bookmark view ────────────────────────────────────────────

async function loadTodo(): Promise<void> {
  const container = document.getElementById('todo-list')!;
  container.innerHTML = '<p class="empty-state">Loading...</p>';

  try {
    const { opinions } = await listOpinions('todo');
    if (opinions.length === 0) {
      container.innerHTML = '<p class="empty-state">No items in your todo list.</p>';
      return;
    }

    container.innerHTML = '';
    for (const opinion of opinions) {
      const card = renderOpinionCard(opinion);
      container.appendChild(card);
    }
  } catch (err) {
    container.innerHTML = `<p class="empty-state">Error: ${escapeHtml(String(err))}</p>`;
  }
}

function renderOpinionCard(opinion: Opinion): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card';

  const scoreDisplay =
    opinion.status === 'rated' && opinion.score !== null
      ? '&#9733;'.repeat(opinion.score) + '&#9734;'.repeat(5 - opinion.score)
      : '<span class="badge">Todo</span>';

  card.innerHTML = `
    <div class="card-row">
      <div class="card-title clickable-text" data-mbid="${escapeHtml(opinion.artistMbid)}">
        ${escapeHtml(opinion.artistMbid)}
      </div>
      <div class="card-score">${scoreDisplay}</div>
    </div>
    <div class="card-actions">
      <button class="btn-small btn-danger" data-action="delete" data-mbid="${escapeHtml(opinion.artistMbid)}">Remove</button>
    </div>
  `;

  // Load the actual artist name
  void getArtist(opinion.artistMbid).then(({ artist }) => {
    const titleEl = card.querySelector('.card-title');
    if (titleEl) titleEl.textContent = artist.name;
  });

  // Click to view detail
  card.querySelector('.card-title')?.addEventListener('click', () => {
    showView('search');
    void showArtistDetail(opinion.artistMbid);
  });

  // Delete button
  card.querySelector('[data-action="delete"]')?.addEventListener('click', async (e) => {
    e.stopPropagation();
    await deleteOpinion(opinion.artistMbid);
    card.remove();
  });

  return card;
}

// ── Recommendations view ─────────────────────────────────────

const refreshRecsBtn = document.getElementById('refresh-recommendations')!;
refreshRecsBtn.addEventListener('click', () => {
  void refreshRecommendations();
});

async function loadRecommendations(): Promise<void> {
  const container = document.getElementById('recommendations-list')!;
  container.innerHTML = '<p class="empty-state">Loading...</p>';

  try {
    const { recommendations } = await getRecommendations();
    renderRecommendations(container, recommendations);
  } catch (err) {
    container.innerHTML = `<p class="empty-state">Error: ${escapeHtml(String(err))}</p>`;
  }
}

async function refreshRecommendations(): Promise<void> {
  const container = document.getElementById('recommendations-list')!;
  container.innerHTML = '<p class="empty-state">Generating recommendations...</p>';

  try {
    const { recommendations } = await generateRecommendations();
    renderRecommendations(container, recommendations);
  } catch (err) {
    container.innerHTML = `<p class="empty-state">Error: ${escapeHtml(String(err))}</p>`;
  }
}

function renderRecommendations(container: HTMLElement, recommendations: Recommendation[]): void {
  if (recommendations.length === 0) {
    container.innerHTML =
      '<p class="empty-state">No recommendations yet. Rate some artists first, then click Refresh!</p>';
    return;
  }

  container.innerHTML = '';
  for (const rec of recommendations) {
    const card = document.createElement('div');
    card.className = 'card clickable';
    card.innerHTML = `
      <div class="card-title">${escapeHtml(rec.artistName)}</div>
      <div class="card-subtitle">
        Score: ${rec.score.toFixed(1)} &middot;
        Because you like ${escapeHtml(rec.sourceArtistName)}
      </div>
    `;
    card.addEventListener('click', () => {
      showView('search');
      void showArtistDetail(rec.artistMbid);
    });
    container.appendChild(card);
  }
}

// ── Graph view ───────────────────────────────────────────────

// Accumulate graph data as the user browses
const collectedArtists = new Map<string, { name: string; url: string; tags: string[] }>();
const collectedEdges: { source: string; target: string; weight: number }[] = [];

function addToGraphData(artist: Artist, related: RelatedArtist[]): void {
  collectedArtists.set(artist.mbid, {
    name: artist.name,
    url: artist.url,
    tags: artist.tags,
  });

  for (const r of related) {
    collectedEdges.push({
      source: artist.mbid,
      target: r.targetMbid,
      weight: r.match,
    });
    // Add target as a node if not already present
    if (!collectedArtists.has(r.targetMbid)) {
      collectedArtists.set(r.targetMbid, {
        name: r.targetName,
        url: '',
        tags: [],
      });
    }
  }
}

function buildGraphData(): GraphData {
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

async function initGraph(): Promise<void> {
  const container = document.getElementById('graph-container')!;

  // Also load user's rated artists into the graph
  try {
    const { opinions } = await listOpinions('rated');
    await Promise.all(
      opinions.slice(0, 20).map(async (op) => {
        try {
          const [{ artist }, { related }] = await Promise.all([
            getArtist(op.artistMbid),
            getRelatedArtists(op.artistMbid),
          ]);
          addToGraphData(artist, related);
        } catch {
          // Skip artists that fail to load
        }
      }),
    );
  } catch {
    // If opinions fail, just use what we have
  }

  const data = buildGraphData();
  if (data.artists.length === 0) {
    container.innerHTML =
      '<p class="empty-state">No graph data yet. Search for some artists first!</p>';
    return;
  }

  // Destroy previous graph if exists
  if (graphManager) {
    graphManager.destroy();
    graphManager = null;
  }
  container.innerHTML = '';

  graphManager = createGraph(container, data);

  // Wire up graph controls
  const tagFilter = document.getElementById('tag-filter') as HTMLSelectElement;
  const minWeightSlider = document.getElementById('min-weight') as HTMLInputElement;
  const minWeightValue = document.getElementById('min-weight-value')!;

  // Populate tag filter from graph data
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

  tagFilter.addEventListener('change', () => {
    if (!graphManager) return;
    const tag = tagFilter.value;
    if (tag) {
      graphManager.filterByTag(tag);
    } else {
      graphManager.resetFilters();
    }
  });

  minWeightSlider.addEventListener('input', () => {
    if (!graphManager) return;
    const val = Number.parseFloat(minWeightSlider.value);
    minWeightValue.textContent = val.toFixed(2);
    graphManager.filterByMinWeight(val);
  });

  // Graph node clicks → detail
  graphManager.sigma.on('clickNode', ({ node }) => {
    if (!graphManager) return;
    graphManager.focusNode(node);

    const detail = document.getElementById('graph-detail')!;
    const nameEl = document.getElementById('graph-detail-name')!;
    const tagsEl = document.getElementById('graph-detail-tags')!;
    const similarEl = document.getElementById('graph-detail-similar')!;

    const artistData = collectedArtists.get(node);
    if (!artistData) return;

    nameEl.textContent = artistData.name;
    tagsEl.innerHTML = artistData.tags
      .map((t) => `<span class="tag-badge">${escapeHtml(t)}</span>`)
      .join('');

    const neighbors = graphManager.getNeighbors(node);
    similarEl.innerHTML = neighbors
      .slice(0, 15)
      .map(
        (n) =>
          `<li><span>${escapeHtml(n.name)}</span><span class="match-score">${(n.weight * 100).toFixed(0)}%</span></li>`,
      )
      .join('');

    detail.classList.remove('hidden');
  });

  document.getElementById('close-graph-detail')?.addEventListener('click', () => {
    document.getElementById('graph-detail')!.classList.add('hidden');
    graphManager?.resetFilters();
  });
}

// ── Helpers ──────────────────────────────────────────────────

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

// ── Initialize ───────────────────────────────────────────────

showView('search');
