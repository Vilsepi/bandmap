import { initGlobalConfig } from './config.js';
import { createRouter, type AppRoute, type ViewName } from './router.js';
import { loadRatings } from './views/ratings.js';
import { initRecommendationsView, loadRecommendations } from './views/recommendations.js';
import { initSearchView, showArtistDetail, showSearchResults } from './views/search.js';
import { loadTodo } from './views/todo.js';

interface BuildInfo {
  timestamp: string;
  buildIdentifier: string;
}

const navLinks = document.querySelectorAll<HTMLAnchorElement>('.nav-link');
const views = document.querySelectorAll<HTMLElement>('.view');
const buildInfoText = document.getElementById('build-info-text');
const topbarMenuContainer = document.getElementById('topbar-menu-container');
const topbarMenuToggle = document.getElementById('topbar-menu-toggle') as HTMLButtonElement | null;
const topbarMenuDropdown = document.getElementById('topbar-menu-dropdown');

let routerNavigate: ((route: AppRoute) => Promise<void>) | null = null;
let appInitialized = false;

function setTopbarMenuOpen(isOpen: boolean): void {
  if (!topbarMenuToggle || !topbarMenuDropdown) return;

  topbarMenuToggle.setAttribute('aria-expanded', String(isOpen));
  topbarMenuDropdown.classList.toggle('hidden', !isOpen);
}

function initializeTopbarMenu(): void {
  if (!topbarMenuContainer || !topbarMenuToggle || !topbarMenuDropdown) return;

  topbarMenuToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const isExpanded = topbarMenuToggle.getAttribute('aria-expanded') === 'true';
    setTopbarMenuOpen(!isExpanded);
  });

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Node)) return;
    if (!topbarMenuContainer.contains(event.target)) {
      setTopbarMenuOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setTopbarMenuOpen(false);
    }
  });
}

async function loadBuildInfo(): Promise<void> {
  if (!buildInfoText) return;

  try {
    const response = await fetch('/buildinfo.json', { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`buildinfo.json request failed with status ${response.status}`);
    }

    const buildInfo = (await response.json()) as Partial<BuildInfo>;
    if (typeof buildInfo.timestamp !== 'string' || typeof buildInfo.buildIdentifier !== 'string') {
      throw new TypeError('buildinfo.json has invalid shape');
    }

    buildInfoText.textContent = `${buildInfo.buildIdentifier} • ${buildInfo.timestamp}`;
  } catch {
    buildInfoText.textContent = 'No build info, local development?';
  }
}

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
  }
}

async function initializeApp(): Promise<void> {
  if (appInitialized) return;
  appInitialized = true;

  initializeTopbarMenu();

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

await loadBuildInfo();
