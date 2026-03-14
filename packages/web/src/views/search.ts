import type { Artist } from '@bandmap/shared';
import { getArtist, getRelatedArtists, listRatings, putRating, searchArtists } from '../api.js';
import type { AppRoute } from '../router.js';
import { escapeHtml } from '../utils.js';
import { findArtistRating, renderArtistDetail } from './artist-detail.js';

interface SearchViewOptions {
  navigateToRoute: (route: AppRoute) => Promise<void>;
}

const DELAY_BEFORE_SEARCHING_IN_MS = 1000;

const searchInput = document.getElementById('search') as HTMLInputElement;
const searchResultsEl = document.getElementById('search-results')!;
const artistDetailEl = document.getElementById('artist-detail')!;
const detailContentEl = document.getElementById('detail-content')!;

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
    }, DELAY_BEFORE_SEARCHING_IN_MS);
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

    detailContentEl.innerHTML = renderArtistDetail(
      artist,
      related,
      findArtistRating(ratings, artistId),
    );
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
      `;
      card.addEventListener('click', () => {
        void navigateToRoute({ view: 'search', artistId: result.artistId });
      });
      searchResultsEl.appendChild(card);
    }
  } catch (err) {
    searchResultsEl.innerHTML = `<p class="empty-state">Error: ${escapeHtml(String(err))}</p>`;
  }
}

function attachDetailActions(
  artist: Artist,
  navigateToRoute: (route: AppRoute) => Promise<void>,
): void {
  const playLink = detailContentEl.querySelector<HTMLAnchorElement>('#detail-play-link');
  playLink?.addEventListener('click', (event) => {
    event.preventDefault();
    const url = artist.spotifyUrl ?? artist.lastFmUrl;
    window.open(url, '_blank', 'noopener,noreferrer');
  });

  const stars = detailContentEl.querySelectorAll<HTMLButtonElement>('.star');
  const todoBtn = detailContentEl.querySelector<HTMLButtonElement>('#btn-todo');
  stars.forEach((star) => {
    star.addEventListener('click', () => {
      const score = Number(star.dataset['score']);
      void putRating(artist.artistId, { score, status: 'rated' });
      stars.forEach((targetStar) => {
        targetStar.classList.toggle('active', Number(targetStar.dataset['score']) <= score);
      });

      if (todoBtn) {
        todoBtn.innerHTML = '<i class="fa-regular fa-bookmark" aria-hidden="true"></i>';
        todoBtn.setAttribute('aria-label', 'Add to todo');
        todoBtn.setAttribute('title', 'Add to todo');
        todoBtn.disabled = false;
      }
    });
  });

  todoBtn?.addEventListener('click', () => {
    void putRating(artist.artistId, { score: null, status: 'todo' });
    stars.forEach((targetStar) => {
      targetStar.classList.remove('active');
    });
    todoBtn.innerHTML = '<i class="fa-solid fa-bookmark" aria-hidden="true"></i>';
    todoBtn.setAttribute('aria-label', 'Added to todo');
    todoBtn.setAttribute('title', 'Added to todo');
    todoBtn.disabled = true;
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
