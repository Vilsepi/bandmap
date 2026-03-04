import { listRatings } from '../api.js';
import { escapeHtml } from '../utils.js';
import { renderRatingCard } from './rating-card.js';

export async function loadRatings(
  navigateToArtist: (artistMbid: string) => Promise<void>,
): Promise<void> {
  const container = document.getElementById('ratings-list');
  if (!container) return;

  container.innerHTML = '<p class="empty-state">Loading...</p>';

  try {
    const { ratings } = await listRatings('rated');
    if (ratings.length === 0) {
      container.innerHTML =
        '<p class="empty-state">No ratings yet. Search and rate some artists!</p>';
      return;
    }

    container.innerHTML = '';
    for (const rating of ratings) {
      const card = renderRatingCard(rating, navigateToArtist);
      container.appendChild(card);
    }
  } catch (err) {
    container.innerHTML = `<p class="empty-state">Error: ${escapeHtml(String(err))}</p>`;
  }
}
