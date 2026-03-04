import { initGlobalConfig } from './config.js';
import { createRouter, type AppRoute, type ViewName } from './router.js';
import { initGraphView } from './views/graph.js';
import { loadRatings } from './views/ratings.js';
import { initRecommendationsView, loadRecommendations } from './views/recommendations.js';
import { initSearchView, showArtistDetail, showSearchResults } from './views/search.js';
import { loadTodo } from './views/todo.js';

const navLinks = document.querySelectorAll<HTMLAnchorElement>('.nav-link');
const views = document.querySelectorAll<HTMLElement>('.view');

let routerNavigate: ((route: AppRoute) => Promise<void>) | null = null;
let appInitialized = false;

function showView(name: ViewName): void {
  views.forEach((view) => view.classList.remove('active'));
  navLinks.forEach((link) => link.classList.remove('active'));

  const view = document.getElementById(`view-${name}`);
  const link = document.querySelector(`[data-view="${name}"]`);
  view?.classList.add('active');
  link?.classList.add('active');
}

async function navigateToArtist(mbid: string): Promise<void> {
  if (!routerNavigate) return;
  await routerNavigate({ view: 'search', artistMbid: mbid });
}

async function handleRoute(route: AppRoute): Promise<void> {
  if (route.artistMbid) {
    showView('search');
    await showArtistDetail(route.artistMbid, async (nextRoute) => {
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
    case 'graph':
      await initGraphView();
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
