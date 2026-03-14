import type { Rating } from '@bandmap/shared';
import { deleteRating, getArtist } from '../api.js';
import { escapeHtml } from '../utils.js';

export function renderRatingCard(
  rating: Rating,
  navigateToArtist: (artistId: string) => Promise<void>,
  showPlayLink = false,
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
      data-artist-id="${escapeHtml(rating.artistId)}"
      aria-label="Remove artist"
      title="Remove"
    >
      &times;
    </button>
    <div class="card-row card-main-row">
      <div class="card-title-row">
        <div class="card-title clickable-text" data-artist-id="${escapeHtml(rating.artistId)}">
          ${escapeHtml(rating.artistId)}
        </div>
        <div class="card-title-actions">
          <a
            class="card-link card-title-link hidden"
            data-role="play-link"
            href="#"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open artist on Spotify or Last.fm"
            title="Open artist on Spotify or Last.fm"
          ><i class="fa-regular fa-circle-play" aria-hidden="true"></i></a>
          <div class="card-score">${scoreDisplay}</div>
        </div>
      </div>
    </div>
  `;

  void getArtist(rating.artistId).then(({ artist }) => {
    const titleEl = card.querySelector('.card-title');
    if (titleEl) {
      titleEl.textContent = artist.name;
    }

    const playLinkEl = card.querySelector<HTMLAnchorElement>('[data-role="play-link"]');
    if (playLinkEl && showPlayLink) {
      playLinkEl.addEventListener('click', (event) => {
        event.preventDefault();
        const url = artist.spotifyUrl ?? artist.lastFmUrl;
        window.open(url, '_blank', 'noopener,noreferrer');
      });
      playLinkEl.classList.remove('hidden');
    }
  });

  card.querySelector('.card-title')?.addEventListener('click', () => {
    void navigateToArtist(rating.artistId);
  });

  card.querySelector('[data-action="delete"]')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    await deleteRating(rating.artistId);
    card.remove();
  });

  return card;
}
