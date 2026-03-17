import type { Artist, Rating, RelatedArtist } from '@bandmap/shared';
import { escapeHtml, getExternalLinkIconClass } from '../utils.js';

export function findArtistRating(ratings: Rating[], artistId: string): Rating | null {
  return ratings.find((rating) => rating.artistId === artistId) ?? null;
}

export function renderArtistDetail(
  artist: Artist,
  related: RelatedArtist[],
  rating: Rating | null,
): string {
  const playLinkUrl = artist.spotifyUrl ?? artist.lastFmUrl;
  const playIconClass = getExternalLinkIconClass(playLinkUrl);
  const tagBadges = (artist.tags ?? [])
    .map((tag) => `<span class="tag-badge">${escapeHtml(tag)}</span>`)
    .join('');

  const relatedList = related
    .slice(0, 30)
    .map((relation) => {
      const matchPercent = (relation.match * 100).toFixed(0);
      return `
      <li class="related-item" data-artist-id="${escapeHtml(relation.targetId)}" style="--related-match-width: ${matchPercent}%">
        <span class="related-item-content">
          <span class="related-name">${escapeHtml(relation.targetName)}</span>
          <span class="match-score">${matchPercent}%</span>
        </span>
      </li>
    `;
    })
    .join('');

  const selectedScore = rating?.status === 'rated' ? (rating.score ?? 0) : 0;
  const isTodo = rating?.status === 'todo';

  return `
    <div class="detail-title-row">
      <h3>${escapeHtml(artist.name)}</h3>
      <a
        href="#"
        class="external-link detail-title-link"
        id="detail-play-link"
        aria-label="Open artist on Spotify or Last.fm"
        title="Open artist on Spotify or Last.fm"
      ><i class="${playIconClass}" aria-hidden="true"></i></a>
    </div>
    <div class="tag-list">${tagBadges}</div>
    <div class="action-bar">
      <div class="star-rating" id="star-rating">
        ${[1, 2, 3, 4, 5]
          .map((score) => {
            const isActive = score <= selectedScore;
            return `<button class="star${isActive ? ' active' : ''}" data-score="${score}"><i class="fa-solid fa-star" aria-hidden="true"></i></button>`;
          })
          .join('')}
      </div>
      <button
        class="btn-icon btn-bookmark"
        id="btn-todo"
        aria-label="${isTodo ? 'Added to todo' : 'Add to todo'}"
        title="${isTodo ? 'Added to todo' : 'Add to todo'}"
        ${isTodo ? 'disabled' : ''}
      >
        <i class="${isTodo ? 'fa-solid' : 'fa-regular'} fa-bookmark" aria-hidden="true"></i>
      </button>
    </div>
    <h4>Related artists</h4>
    <ul class="related-list">${relatedList}</ul>
  `;
}
