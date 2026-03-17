import type { Artist, Rating } from '@bandmap/shared';
import { getArtist, getRelatedArtists, listRatings, putRating, searchArtists } from '../api.js';
import type { AppRoute } from '../router.js';
import { escapeHtml } from '../utils.js';
import { findArtistRating, renderArtistDetail } from './artist-detail.js';

interface SearchViewOptions {
  navigateToRoute: (route: AppRoute) => Promise<void>;
}

const DELAY_BEFORE_SEARCHING_IN_MS = 1000;

const searchInput = document.getElementById('search') as HTMLInputElement;
const searchClearButton = document.getElementById('search-clear') as HTMLButtonElement;
const searchSpinner = document.getElementById('search-spinner') as HTMLElement;
const searchResultsEl = document.getElementById('search-results')!;
const artistDetailEl = document.getElementById('artist-detail')!;
const detailContentEl = document.getElementById('detail-content')!;

let searchTimeout: ReturnType<typeof setTimeout> | null = null;
let activeSearchRequestId = 0;

export function initSearchView({ navigateToRoute }: SearchViewOptions): void {
  updateSearchClearButton();

  searchInput.addEventListener('input', () => {
    const query = searchInput.value.trim();
    updateSearchClearButton();
    clearPendingSearch();
    activeSearchRequestId += 1;
    setSearchLoading(false);

    if (query.length < 2) {
      searchResultsEl.innerHTML = '';
      return;
    }

    const requestId = activeSearchRequestId;
    searchTimeout = setTimeout(() => {
      void performSearch(query, requestId, navigateToRoute);
    }, DELAY_BEFORE_SEARCHING_IN_MS);
  });

  searchClearButton.addEventListener('click', () => {
    searchInput.value = '';
    updateSearchClearButton();
    clearPendingSearch();
    activeSearchRequestId += 1;
    setSearchLoading(false);
    searchResultsEl.innerHTML = '';
    searchInput.focus();
  });
}

export function showSearchResults(): void {
  artistDetailEl.classList.add('hidden');
  searchResultsEl.style.display = '';
}

export async function showArtistDetail(
  artistId: string,
  navigateToRoute: (route: AppRoute) => Promise<void>,
): Promise<void> {
  searchResultsEl.style.display = 'none';
  artistDetailEl.classList.remove('hidden');
  detailContentEl.innerHTML = '<p class="empty-state">Loading...</p>';

  try {
    const [{ artist }, { related }, { ratings }] = await Promise.all([
      getArtist(artistId),
      getRelatedArtists(artistId),
      listRatings(),
    ]);

    const currentRating = findArtistRating(ratings, artistId);
    detailContentEl.innerHTML = renderArtistDetail(artist, related, currentRating);
    attachDetailActions(artist, currentRating, navigateToRoute);
  } catch (err) {
    detailContentEl.innerHTML = `<p class="empty-state">Error: ${escapeHtml(String(err))}</p>`;
  }
}

async function performSearch(
  query: string,
  requestId: number,
  navigateToRoute: (route: AppRoute) => Promise<void>,
): Promise<void> {
  setSearchLoading(true);

  try {
    const { results } = await searchArtists(query);

    if (requestId !== activeSearchRequestId || searchInput.value.trim() !== query) {
      return;
    }

    searchResultsEl.innerHTML = '';
    searchResultsEl.style.display = '';
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
      `;
      card.addEventListener('click', () => {
        void navigateToRoute({ view: 'search', artistId: result.artistId });
      });
      searchResultsEl.appendChild(card);
    }
  } catch (err) {
    if (requestId !== activeSearchRequestId || searchInput.value.trim() !== query) {
      return;
    }

    searchResultsEl.style.display = '';
    searchResultsEl.innerHTML = `<p class="empty-state">Error: ${escapeHtml(String(err))}</p>`;
  } finally {
    if (requestId === activeSearchRequestId) {
      setSearchLoading(false);
    }
  }
}

function clearPendingSearch(): void {
  if (searchTimeout) {
    clearTimeout(searchTimeout);
    searchTimeout = null;
  }
}

function updateSearchClearButton(): void {
  searchClearButton.classList.toggle('hidden', searchInput.value.length === 0);
}

function setSearchLoading(isLoading: boolean): void {
  searchSpinner.classList.toggle('hidden', !isLoading);
}

function attachDetailActions(
  artist: Artist,
  initialRating: Rating | null,
  navigateToRoute: (route: AppRoute) => Promise<void>,
): void {
  const playLink = detailContentEl.querySelector<HTMLAnchorElement>('#detail-play-link');
  playLink?.addEventListener('click', (event) => {
    event.preventDefault();
    const url = artist.spotifyUrl ?? artist.lastFmUrl;
    window.open(url, '_blank', 'noopener,noreferrer');
  });

  let currentScore: number | null = initialRating?.score ?? null;
  let currentTodo: boolean = initialRating?.todo ?? false;

  const stars = detailContentEl.querySelectorAll<HTMLButtonElement>('.star');
  const todoBtn = detailContentEl.querySelector<HTMLButtonElement>('#btn-todo');
  stars.forEach((star) => {
    star.addEventListener('click', () => {
      const score = Number(star.dataset['score']);
      currentScore = score;
      void putRating(artist.artistId, { score, todo: currentTodo });
      stars.forEach((targetStar) => {
        targetStar.classList.toggle('active', Number(targetStar.dataset['score']) <= score);
      });
    });
  });

  todoBtn?.addEventListener('click', () => {
    currentTodo = !currentTodo;
    void putRating(artist.artistId, { score: currentScore, todo: currentTodo });
    todoBtn.innerHTML = `<i class="${currentTodo ? 'fa-solid' : 'fa-regular'} fa-bookmark" aria-hidden="true"></i>`;
    todoBtn.setAttribute('aria-label', currentTodo ? 'Remove from todo' : 'Add to todo');
    todoBtn.setAttribute('title', currentTodo ? 'Remove from todo' : 'Add to todo');
  });

  const relatedItems = detailContentEl.querySelectorAll<HTMLElement>('.related-item');
  relatedItems.forEach((item) => {
    item.addEventListener('click', () => {
      const artistId = item.dataset['artistId'];
      if (artistId) {
        void navigateToRoute({ view: 'search', artistId });
      }
    });
  });
}
