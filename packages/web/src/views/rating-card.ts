import type { Rating } from '@bandmap/shared';
import { deleteRating, getArtist } from '../api.js';
import { escapeHtml } from '../utils.js';

export function renderRatingCard(
  rating: Rating,
  navigateToArtist: (artistMbid: string) => Promise<void>,
  showLastFmLink = false,
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card';

  const scoreDisplay =
    rating.status === 'rated' && rating.score !== null
      ? '&#9733;'.repeat(rating.score) + '&#9734;'.repeat(5 - rating.score)
      : '';

  card.innerHTML = `
    <button
      class="card-remove-btn"
      data-action="delete"
      data-mbid="${escapeHtml(rating.artistMbid)}"
      aria-label="Remove artist"
      title="Remove"
    >
      &times;
    </button>
    <div class="card-row card-main-row">
      <div class="card-title-row">
        <div class="card-title clickable-text" data-mbid="${escapeHtml(rating.artistMbid)}">
          ${escapeHtml(rating.artistMbid)}
        </div>
        <div class="card-score">${scoreDisplay}</div>
      </div>
    </div>
    <div class="card-meta ${showLastFmLink ? '' : 'hidden'}">
      <a class="card-link hidden" data-role="lastfm-link" href="#" target="_blank" rel="noopener">Last.fm profile &rarr;</a>
    </div>
  `;

  void getArtist(rating.artistMbid).then(({ artist }) => {
    const titleEl = card.querySelector('.card-title');
    if (titleEl) {
      titleEl.textContent = artist.name;
    }

    const lastFmLinkEl = card.querySelector<HTMLAnchorElement>('[data-role="lastfm-link"]');
    if (lastFmLinkEl && showLastFmLink) {
      lastFmLinkEl.href = artist.url;
      lastFmLinkEl.classList.remove('hidden');
    }
  });

  card.querySelector('.card-title')?.addEventListener('click', () => {
    void navigateToArtist(rating.artistMbid);
  });

  card.querySelector('[data-action="delete"]')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    await deleteRating(rating.artistMbid);
    card.remove();
  });

  return card;
}
