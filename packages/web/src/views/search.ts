import type { Artist, RelatedArtist } from '@bandmap/shared';
import { getArtist, getRelatedArtists, putRating, searchArtists } from '../api.js';
import type { AppRoute } from '../router.js';
import { escapeHtml } from '../utils.js';

interface SearchViewOptions {
  navigateToRoute: (route: AppRoute) => Promise<void>;
}

const searchInput = document.getElementById('search') as HTMLInputElement;
const searchResultsEl = document.getElementById('search-results')!;
const artistDetailEl = document.getElementById('artist-detail')!;
const detailContentEl = document.getElementById('detail-content')!;
const backToResultsBtn = document.getElementById('back-to-results')!;

let searchTimeout: ReturnType<typeof setTimeout> | null = null;

export function initSearchView({ navigateToRoute }: SearchViewOptions): void {
  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    if (searchTimeout) clearTimeout(searchTimeout);

    if (query.length < 2) {
      searchResultsEl.innerHTML = '';
      return;
    }

    searchTimeout = setTimeout(() => {
      void performSearch(query, navigateToRoute);
    }, 2000);
  });

  backToResultsBtn.addEventListener('click', () => {
    void navigateToRoute({ view: 'search' });
  });
}

export function showSearchResults(): void {
  artistDetailEl.classList.add('hidden');
  searchResultsEl.style.display = '';
}

export async function showArtistDetail(
  mbid: string,
  navigateToRoute: (route: AppRoute) => Promise<void>,
): Promise<void> {
  searchResultsEl.style.display = 'none';
  artistDetailEl.classList.remove('hidden');
  detailContentEl.innerHTML = '<p class="empty-state">Loading...</p>';

  try {
    const [{ artist }, { related }] = await Promise.all([getArtist(mbid), getRelatedArtists(mbid)]);

    detailContentEl.innerHTML = renderArtistDetail(artist, related);
    attachDetailActions(artist, navigateToRoute);
  } catch (err) {
    detailContentEl.innerHTML = `<p class="empty-state">Error: ${escapeHtml(String(err))}</p>`;
  }
}

async function performSearch(
  query: string,
  navigateToRoute: (route: AppRoute) => Promise<void>,
): Promise<void> {
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
      card.addEventListener('click', () => {
        void navigateToRoute({ view: 'search', artistMbid: result.mbid });
      });
      searchResultsEl.appendChild(card);
    }
  } catch (err) {
    searchResultsEl.innerHTML = `<p class="empty-state">Error: ${escapeHtml(String(err))}</p>`;
  }
}

function renderArtistDetail(artist: Artist, related: RelatedArtist[]): string {
  const tagBadges = artist.tags
    .map((tag) => `<span class="tag-badge">${escapeHtml(tag)}</span>`)
    .join('');

  const relatedList = related
    .slice(0, 30)
    .map(
      (relation) => `
      <li class="related-item" data-mbid="${escapeHtml(relation.targetMbid)}">
        <span>${escapeHtml(relation.targetName)}</span>
        <span class="match-score">${(relation.match * 100).toFixed(0)}%</span>
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
        ${[1, 2, 3, 4, 5].map((score) => `<button class="star" data-score="${score}">&#9733;</button>`).join('')}
      </div>
      <button class="btn-secondary" id="btn-todo">Add to Todo</button>
    </div>
    <h4>Related Artists</h4>
    <ul class="related-list">${relatedList}</ul>
  `;
}

function attachDetailActions(
  artist: Artist,
  navigateToRoute: (route: AppRoute) => Promise<void>,
): void {
  const stars = detailContentEl.querySelectorAll<HTMLButtonElement>('.star');
  stars.forEach((star) => {
    star.addEventListener('click', () => {
      const score = Number(star.dataset['score']);
      void putRating(artist.mbid, { score, status: 'rated' });
      stars.forEach((targetStar) => {
        targetStar.classList.toggle('active', Number(targetStar.dataset['score']) <= score);
      });
    });
  });

  const todoBtn = detailContentEl.querySelector('#btn-todo');
  todoBtn?.addEventListener('click', () => {
    void putRating(artist.mbid, { score: null, status: 'todo' });
    if (todoBtn instanceof HTMLButtonElement) {
      todoBtn.textContent = 'Added!';
      todoBtn.disabled = true;
    }
  });

  const relatedItems = detailContentEl.querySelectorAll<HTMLElement>('.related-item');
  relatedItems.forEach((item) => {
    item.addEventListener('click', () => {
      const mbid = item.dataset['mbid'];
      if (mbid) {
        void navigateToRoute({ view: 'search', artistMbid: mbid });
      }
    });
  });
}
