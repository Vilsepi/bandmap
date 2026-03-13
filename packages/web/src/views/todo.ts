import { listRatings } from '../api.js';
import { escapeHtml } from '../utils.js';
import { renderRatingCard } from './rating-card.js';

export async function loadTodo(
  navigateToArtist: (artistAid: string) => Promise<void>,
): Promise<void> {
  const container = document.getElementById('todo-list');
  if (!container) return;

  container.innerHTML = '<p class="empty-state">Loading...</p>';

  try {
    const { ratings } = await listRatings('todo');
    if (ratings.length === 0) {
      container.innerHTML = '<p class="empty-state">No items in your todo list.</p>';
      return;
    }

    container.innerHTML = '';
    for (const rating of ratings) {
      const card = renderRatingCard(rating, navigateToArtist, true);
      container.appendChild(card);
    }
  } catch (err) {
    container.innerHTML = `<p class="empty-state">Error: ${escapeHtml(String(err))}</p>`;
  }
}
