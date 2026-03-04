import type { Recommendation } from '@bandmap/shared';
import { generateRecommendations, getArtist, getRecommendations, putRating } from '../api.js';
import { escapeHtml } from '../utils.js';

const MAX_RECOMMENDATIONS = 10;
const MAX_TAGS_PER_RECOMMENDATION = 8;

let isInitialized = false;

export function initRecommendationsView(
  navigateToArtist: (artistMbid: string) => Promise<void>,
): void {
  if (isInitialized) return;
  isInitialized = true;

  const refreshRecsBtn = document.getElementById('refresh-recommendations');
  refreshRecsBtn?.addEventListener('click', () => {
    void refreshRecommendations(navigateToArtist);
  });
}

export async function loadRecommendations(
  navigateToArtist: (artistMbid: string) => Promise<void>,
): Promise<void> {
  const container = document.getElementById('recommendations-list');
  if (!container) return;

  container.innerHTML = '<p class="empty-state">Loading...</p>';

  try {
    const { recommendations } = await getRecommendations();
    await renderRecommendations(container, recommendations, navigateToArtist);
  } catch (err) {
    container.innerHTML = `<p class="empty-state">Error: ${escapeHtml(String(err))}</p>`;
  }
}

async function refreshRecommendations(
  navigateToArtist: (artistMbid: string) => Promise<void>,
): Promise<void> {
  const container = document.getElementById('recommendations-list');
  if (!container) return;

  container.innerHTML = '<p class="empty-state">Generating recommendations...</p>';

  try {
    const { recommendations } = await generateRecommendations();
    await renderRecommendations(container, recommendations, navigateToArtist);
  } catch (err) {
    container.innerHTML = `<p class="empty-state">Error: ${escapeHtml(String(err))}</p>`;
  }
}

async function renderRecommendations(
  container: HTMLElement,
  recommendations: Recommendation[],
  navigateToArtist: (artistMbid: string) => Promise<void>,
): Promise<void> {
  if (recommendations.length === 0) {
    container.innerHTML =
      '<p class="empty-state">No recommendations yet. Rate some artists first, then click Refresh!</p>';
    return;
  }

  const sortedRecommendations = [...recommendations]
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_RECOMMENDATIONS);

  const artistTagsByMbid = new Map<string, string[]>();
  await Promise.all(
    sortedRecommendations.map(async (recommendation) => {
      try {
        const { artist } = await getArtist(recommendation.artistMbid);
        artistTagsByMbid.set(recommendation.artistMbid, artist.tags);
      } catch {
        artistTagsByMbid.set(recommendation.artistMbid, []);
      }
    }),
  );

  container.innerHTML = '';
  for (const recommendation of sortedRecommendations) {
    const tags = artistTagsByMbid.get(recommendation.artistMbid) ?? [];
    const tagBadges =
      tags.length > 0
        ? tags
            .slice(0, MAX_TAGS_PER_RECOMMENDATION)
            .map((tag) => `<span class="tag-badge">${escapeHtml(tag)}</span>`)
            .join('')
        : '<span class="card-subtitle">No tags available</span>';

    const card = document.createElement('div');
    card.className = 'card clickable';
    card.innerHTML = `
      <div class="card-row">
        <div class="card-title">${escapeHtml(recommendation.artistName)}</div>
        <button class="btn-small btn-secondary" type="button" data-action="add-todo">Add to Todo</button>
      </div>
      <div class="card-subtitle">
        Score: ${recommendation.score.toFixed(1)} &middot;
        Because you like ${escapeHtml(recommendation.sourceArtistName)}
      </div>
      <div class="tag-list card-tags">${tagBadges}</div>
    `;

    const addToTodoButton = card.querySelector<HTMLButtonElement>('[data-action="add-todo"]');
    addToTodoButton?.addEventListener('click', async (event) => {
      event.stopPropagation();
      await putRating(recommendation.artistMbid, { score: null, status: 'todo' });
      if (addToTodoButton) {
        addToTodoButton.textContent = 'Added!';
        addToTodoButton.disabled = true;
      }
    });

    card.addEventListener('click', () => {
      void navigateToArtist(recommendation.artistMbid);
    });
    container.appendChild(card);
  }
}
