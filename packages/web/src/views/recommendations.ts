import { RECOMMENDATION_MAX_RESULTS } from '@bandmap/shared';
import type { Recommendation } from '@bandmap/shared';
import { normalizeRecommendationSourceArtistName } from '@bandmap/shared/recommendations';
import { generateRecommendations, getArtist, getRecommendations, putRating } from '../api.js';
import { escapeHtml } from '../utils.js';

const MAX_TAGS_PER_RECOMMENDATION = 8;

let isInitialized = false;
let isRefreshingRecommendations = false;

export function initRecommendationsView(
  navigateToArtist: (artistId: string) => Promise<void>,
): void {
  if (isInitialized) return;
  isInitialized = true;

  const refreshRecsBtn = document.getElementById('refresh-recommendations');
  refreshRecsBtn?.addEventListener('click', () => {
    void refreshRecommendations(navigateToArtist);
  });
}

export async function loadRecommendations(
  navigateToArtist: (artistId: string) => Promise<void>,
): Promise<void> {
  const container = document.getElementById('recommendations-list');
  if (!container) return;

  container.innerHTML = '<p class="empty-state">Loading...</p>';

  try {
    const { recommendations } = await getRecommendations();
    await renderRecommendations(container, recommendations, navigateToArtist);
  } catch (err) {
    console.error('Failed to load recommendations', err);
    container.innerHTML = `<p class="empty-state">Error: ${escapeHtml(String(err))}</p>`;
  }
}

async function refreshRecommendations(
  navigateToArtist: (artistId: string) => Promise<void>,
): Promise<void> {
  if (isRefreshingRecommendations) {
    return;
  }

  const container = document.getElementById('recommendations-list');
  if (!container) return;

  isRefreshingRecommendations = true;
  setRefreshRecommendationsLoading(true);
  container.innerHTML = '<p class="empty-state">Generating recommendations...</p>';

  try {
    const { recommendations } = await generateRecommendations();
    await renderRecommendations(container, recommendations, navigateToArtist);
  } catch (err) {
    console.error('Failed to generate recommendations', err);
    container.innerHTML = `<p class="empty-state">Error: ${escapeHtml(String(err))}</p>`;
  } finally {
    isRefreshingRecommendations = false;
    setRefreshRecommendationsLoading(false);
  }
}

function setRefreshRecommendationsLoading(isLoading: boolean): void {
  const refreshButton = document.getElementById(
    'refresh-recommendations',
  ) as HTMLButtonElement | null;
  const spinnerIcon = refreshButton?.querySelector<HTMLElement>('.loading-spinner');

  if (!refreshButton || !spinnerIcon) {
    return;
  }

  refreshButton.disabled = isLoading;
  refreshButton.setAttribute('aria-busy', String(isLoading));
  spinnerIcon.classList.toggle('hidden', !isLoading);
}

function getRecommendationReason(recommendation: Recommendation): string {
  const sourceName = normalizeRecommendationSourceArtistName(recommendation.sourceName);
  if (sourceName.length > 0) {
    return `Because you like ${escapeHtml(sourceName)}`;
  }

  console.warn('Recommendation missing source artist name', {
    artistId: recommendation.artistId,
    artistName: recommendation.artistName,
    sourceId: recommendation.sourceId,
    sourceName: recommendation.sourceName,
  });
  return 'Based on one of your highly rated artists';
}

async function renderRecommendations(
  container: HTMLElement,
  recommendations: Recommendation[],
  navigateToArtist: (artistId: string) => Promise<void>,
): Promise<void> {
  if (recommendations.length === 0) {
    container.innerHTML =
      '<p class="empty-state">No recommendations yet. Rate some artists first, then click Refresh!</p>';
    return;
  }

  const sortedRecommendations = [...recommendations]
    .sort((a, b) => b.score - a.score)
    .slice(0, RECOMMENDATION_MAX_RESULTS);

  const artistTagsById = new Map<string, string[]>();
  await Promise.all(
    sortedRecommendations.map(async (recommendation) => {
      try {
        const { artist } = await getArtist(recommendation.artistId);
        artistTagsById.set(recommendation.artistId, artist.tags ?? []);
      } catch {
        artistTagsById.set(recommendation.artistId, []);
      }
    }),
  );

  container.innerHTML = '';
  for (const recommendation of sortedRecommendations) {
    const tags = artistTagsById.get(recommendation.artistId) ?? [];
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
        <button
          class="btn-icon btn-bookmark"
          type="button"
          data-action="add-todo"
          aria-label="Add to todo"
          title="Add to todo"
        ><i class="fa-regular fa-bookmark" aria-hidden="true"></i></button>
      </div>
      <div class="card-subtitle">
        Score: ${recommendation.score.toFixed(1)} &middot;
        ${getRecommendationReason(recommendation)}
      </div>
      <div class="tag-list card-tags">${tagBadges}</div>
    `;

    const addToTodoButton = card.querySelector<HTMLButtonElement>('[data-action="add-todo"]');
    addToTodoButton?.addEventListener('click', async (event) => {
      event.stopPropagation();
      await putRating(recommendation.artistId, { score: null, status: 'todo' });
      if (addToTodoButton) {
        addToTodoButton.innerHTML = '<i class="fa-solid fa-bookmark" aria-hidden="true"></i>';
        addToTodoButton.setAttribute('aria-label', 'Added to todo');
        addToTodoButton.setAttribute('title', 'Added to todo');
        addToTodoButton.disabled = true;
      }
    });

    card.addEventListener('click', () => {
      void navigateToArtist(recommendation.artistId);
    });
    container.appendChild(card);
  }
}
