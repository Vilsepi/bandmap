import type { Artist, Rating, RelatedArtist } from '@bandmap/shared';
import { escapeHtml } from '../utils.js';

export function findArtistRating(ratings: Rating[], artistMbid: string): Rating | null {
  return ratings.find((rating) => rating.artistMbid === artistMbid) ?? null;
}

export function renderArtistDetail(
  artist: Artist,
  related: RelatedArtist[],
  rating: Rating | null,
): string {
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
      ><i class="fa-regular fa-circle-play" aria-hidden="true"></i></a>
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
    <h4>Related Artists</h4>
    <ul class="related-list">${relatedList}</ul>
  `;
}
