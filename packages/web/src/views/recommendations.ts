import type { Recommendation } from '@bandmap/shared';
import { generateRecommendations, getRecommendations } from '../api.js';
import { escapeHtml } from '../utils.js';

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
    renderRecommendations(container, recommendations, navigateToArtist);
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
    renderRecommendations(container, recommendations, navigateToArtist);
  } catch (err) {
    container.innerHTML = `<p class="empty-state">Error: ${escapeHtml(String(err))}</p>`;
  }
}

function renderRecommendations(
  container: HTMLElement,
  recommendations: Recommendation[],
  navigateToArtist: (artistMbid: string) => Promise<void>,
): void {
  if (recommendations.length === 0) {
    container.innerHTML =
      '<p class="empty-state">No recommendations yet. Rate some artists first, then click Refresh!</p>';
    return;
  }

  const sortedRecommendations = [...recommendations].sort((a, b) => b.score - a.score);

  container.innerHTML = '';
  for (const recommendation of sortedRecommendations) {
    const card = document.createElement('div');
    card.className = 'card clickable';
    card.innerHTML = `
      <div class="card-title">${escapeHtml(recommendation.artistName)}</div>
      <div class="card-subtitle">
        Score: ${recommendation.score.toFixed(1)} &middot;
        Because you like ${escapeHtml(recommendation.sourceArtistName)}
      </div>
    `;
    card.addEventListener('click', () => {
      void navigateToArtist(recommendation.artistMbid);
    });
    container.appendChild(card);
  }
}
