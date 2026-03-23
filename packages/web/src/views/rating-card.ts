import type { Rating } from '@bandmap/shared';
import { getArtist } from '../api.js';
import { escapeHtml, getExternalLinkIconClass } from '../utils.js';

export function renderRatingCard(
  rating: Rating,
  navigateToArtist: (artistId: string) => Promise<void>,
  options: {
    showPlayLink?: boolean;
    onRemove: () => Promise<void>;
  },
): HTMLElement {
  const card = document.createElement('div');
  card.className = 'card';

  const scoreDisplay =
    rating.score !== null
      ? `<i class="card-score-star fa-solid fa-star" aria-hidden="true"></i><span class="card-score-value">${rating.score}</span>`
      : '';
  const scoreLabel = rating.score !== null ? ` aria-label="Rated ${rating.score} out of 5"` : '';

  card.innerHTML = `
    <div class="card-row card-main-row">
      <div class="card-title-row">
        <a class="card-title" href="#/artists/${encodeURIComponent(rating.artistId)}" data-artist-id="${escapeHtml(rating.artistId)}">
          ${escapeHtml(rating.artistId)}
        </a>
        <div class="card-title-actions">
          <a
            class="card-link card-title-action card-title-link hidden"
            data-role="play-link"
            href="#"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="Open artist on Spotify or Last.fm"
            title="Open artist on Spotify or Last.fm"
          ><i class="fa-regular fa-circle-play" aria-hidden="true"></i></a>
          <div class="card-score card-title-action"${scoreLabel}>${scoreDisplay}</div>
          <button
            class="card-remove-btn card-title-action"
            data-action="delete"
            data-artist-id="${escapeHtml(rating.artistId)}"
            aria-label="Remove artist"
            title="Remove"
          >
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
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
    if (playLinkEl && options.showPlayLink) {
      playLinkEl.addEventListener('click', (event) => {
        event.preventDefault();
        const url = artist.spotifyUrl ?? artist.lastFmUrl;
        window.open(url, '_blank', 'noopener,noreferrer');
      });
      const playIconEl = playLinkEl.querySelector('i');
      const playLinkUrl = artist.spotifyUrl ?? artist.lastFmUrl;
      if (playIconEl) {
        playIconEl.className = getExternalLinkIconClass(playLinkUrl);
        playIconEl.setAttribute('aria-hidden', 'true');
      }
      playLinkEl.classList.remove('hidden');
    }
  });

  card.querySelector<HTMLAnchorElement>('.card-title')?.addEventListener('click', (event) => {
    if (event.ctrlKey || event.metaKey || event.shiftKey) return;
    event.preventDefault();
    void navigateToArtist(rating.artistId);
  });

  card.querySelector('[data-action="delete"]')?.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (!confirm('Are you sure you want to remove this artist?')) return;
    await options.onRemove();
    card.remove();
  });

  return card;
}
