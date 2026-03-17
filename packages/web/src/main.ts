import { initGlobalConfig } from './config.js';
import type { AppRoute, ViewName } from './router.js';
import { createRouter } from './router.js';
import { initializeSettingsMenu } from './settings-menu.js';
import { loadRatings } from './views/ratings.js';
import { initRecommendationsView, loadRecommendations } from './views/recommendations.js';
import { initSearchView, showArtistDetail, showSearchResults } from './views/search.js';
import { loadTodo } from './views/todo.js';

const navLinks = document.querySelectorAll<HTMLAnchorElement>('.nav-link');
const views = document.querySelectorAll<HTMLElement>('.view');
const topbarTitle = document.querySelector<HTMLElement>('#app-topbar h1');

const VIEW_TITLES: Record<ViewName, string> = {
  search: 'Search artist',
  recommendations: 'Recommended',
  todo: 'To listen',
  ratings: 'Rated artists',
};

let routerNavigate: ((route: AppRoute) => Promise<void>) | null = null;
let appInitialized = false;

function showView(name: ViewName): void {
  views.forEach((view) => view.classList.remove('active'));
  navLinks.forEach((link) => link.classList.remove('active'));

  if (topbarTitle) {
    topbarTitle.textContent = VIEW_TITLES[name];
  }

  const view = document.getElementById(`view-${name}`);
  const link = document.querySelector(`[data-view="${name}"]`);
  view?.classList.add('active');
  link?.classList.add('active');
}

async function navigateToArtist(artistId: string): Promise<void> {
  if (!routerNavigate) return;
  await routerNavigate({ view: 'search', artistId });
}

async function handleRoute(route: AppRoute): Promise<void> {
  if (route.artistId) {
    showView('search');
    await showArtistDetail(route.artistId, async (nextRoute) => {
      if (!routerNavigate) return;
      await routerNavigate(nextRoute);
    });
    return;
  }

  showView(route.view);
  showSearchResults();

  switch (route.view) {
    case 'search':
      break;
    case 'ratings':
      await loadRatings(navigateToArtist);
      break;
    case 'todo':
      await loadTodo(navigateToArtist);
      break;
    case 'recommendations':
      await loadRecommendations(navigateToArtist);
      break;
  }
}

async function initializeApp(): Promise<void> {
  if (appInitialized) return;
  appInitialized = true;

  const router = createRouter(handleRoute);
  routerNavigate = async (route: AppRoute) => {
    await router.navigateToRoute(route);
  };

  initSearchView({
    navigateToRoute: async (route) => {
      if (!routerNavigate) return;
      await routerNavigate(route);
    },
  });

  initRecommendationsView(navigateToArtist);

  await router.navigateToRoute(router.getInitialRoute(), { updateUrl: 'replace' });
}

initGlobalConfig({
  onAuthenticated: () => {
    void initializeApp();
  },
});

initializeSettingsMenu();
