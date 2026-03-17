import { getCurrentUser, getLatestInviteLink } from './api.js';
import { initGlobalConfig } from './config.js';
import type { AppRoute, ViewName } from './router.js';
import { createRouter } from './router.js';
import { escapeHtml, formatEpochSeconds } from './utils.js';
import { loadRatings } from './views/ratings.js';
import { initRecommendationsView, loadRecommendations } from './views/recommendations.js';
import { initSearchView, showArtistDetail, showSearchResults } from './views/search.js';
import { loadTodo } from './views/todo.js';

interface BuildInfo {
  timestamp: string;
  buildIdentifier: string;
  githubSha?: string;
  githubRunId?: string;
  deploymentUrl?: string;
}

const navLinks = document.querySelectorAll<HTMLAnchorElement>('.nav-link');
const views = document.querySelectorAll<HTMLElement>('.view');
const topbarTitle = document.querySelector<HTMLElement>('#app-topbar h1');
const buildInfoText = document.getElementById('build-info-text');
const topbarMenuContainer = document.getElementById('topbar-menu-container');
const topbarMenuToggle = document.getElementById('topbar-menu-toggle') as HTMLButtonElement | null;
const topbarMenuDropdown = document.getElementById('topbar-menu-dropdown');
const topbarMenuIcon = topbarMenuToggle?.querySelector<HTMLElement>('i') ?? null;
const topbarMenuPanel = document.querySelector<HTMLElement>(
  '#topbar-menu-dropdown .topbar-menu-panel',
);
const adminInviteLink = document.getElementById('admin-invite-link') as HTMLAnchorElement | null;
const adminInviteStatus = document.getElementById('admin-invite-status');
let topbarMenuCloseTimer: ReturnType<typeof setTimeout> | null = null;
let adminInviteListenerInitialized = false;

const VIEW_TITLES: Record<ViewName, string> = {
  search: 'Search artist',
  recommendations: 'Recommended',
  todo: 'To listen',
  ratings: 'Rated artists',
};

let routerNavigate: ((route: AppRoute) => Promise<void>) | null = null;
let appInitialized = false;

function setTopbarMenuOpen(isOpen: boolean): void {
  if (!topbarMenuToggle || !topbarMenuDropdown) return;

  if (topbarMenuCloseTimer) {
    clearTimeout(topbarMenuCloseTimer);
    topbarMenuCloseTimer = null;
  }

  topbarMenuToggle.setAttribute('aria-expanded', String(isOpen));
  topbarMenuToggle.setAttribute('aria-label', isOpen ? 'Close menu' : 'Open menu');
  if (topbarMenuIcon) {
    topbarMenuIcon.classList.toggle('fa-gear', !isOpen);
    topbarMenuIcon.classList.toggle('fa-xmark', isOpen);
  }

  if (isOpen) {
    topbarMenuDropdown.classList.remove('hidden');
    requestAnimationFrame(() => {
      topbarMenuDropdown.classList.add('is-open');
    });
  } else {
    topbarMenuDropdown.classList.remove('is-open');
    topbarMenuCloseTimer = setTimeout(() => {
      topbarMenuDropdown.classList.add('hidden');
      topbarMenuCloseTimer = null;
    }, 240);
  }

  document.body.classList.toggle('topbar-menu-open', isOpen);
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

  topbarMenuDropdown.addEventListener('click', (event) => {
    if (event.target === topbarMenuDropdown) {
      setTopbarMenuOpen(false);
    }
  });

  topbarMenuPanel?.addEventListener('click', (event) => {
    event.stopPropagation();
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

    const buildInfoLines = [
      `Frontend version: <a href="https://github.com/Vilsepi/bandmap/commit/${escapeHtml(buildInfo.buildIdentifier)}" target="_blank" rel="noopener noreferrer">${escapeHtml(buildInfo.buildIdentifier)}</a>`,
      `Built at: ${escapeHtml(buildInfo.timestamp)}`,
    ];

    if (typeof buildInfo.githubSha === 'string') {
      buildInfoLines.push(`GitHub SHA: ${escapeHtml(buildInfo.githubSha)}`);
    }

    if (typeof buildInfo.githubRunId === 'string') {
      if (typeof buildInfo.deploymentUrl === 'string') {
        buildInfoLines.push(
          `Deployment: <a href="${escapeHtml(buildInfo.deploymentUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(buildInfo.githubRunId)}</a>`,
        );
      } else {
        buildInfoLines.push(`Deployment: ${escapeHtml(buildInfo.githubRunId)}`);
      }
    }

    buildInfoText.innerHTML = buildInfoLines.join('<br>');
  } catch {
    buildInfoText.innerHTML = 'No build info<br>Local development?';
  }
}

async function loadAdminInviteLink(): Promise<void> {
  if (!adminInviteLink || !adminInviteStatus) {
    return;
  }

  const currentUser = getCurrentUser();
  const isAdmin = currentUser?.isAdmin === true;
  adminInviteLink.classList.toggle('hidden', !isAdmin);
  adminInviteStatus.classList.toggle('hidden', !isAdmin);

  if (!isAdmin) {
    adminInviteLink.removeAttribute('href');
    adminInviteLink.textContent = 'Latest invite link';
    adminInviteStatus.textContent = '';
    return;
  }

  adminInviteStatus.textContent = 'Loading latest invite link...';

  try {
    const response = await getLatestInviteLink();
    adminInviteLink.href = response.invite.inviteUrl;
    adminInviteLink.textContent = 'Latest invite link';
    adminInviteStatus.textContent = `${response.invite.remainingUses} use(s) left · ${formatEpochSeconds(response.invite.createdAt)}`;
  } catch (error) {
    adminInviteLink.removeAttribute('href');
    adminInviteLink.textContent = 'Latest invite link unavailable';
    adminInviteStatus.textContent =
      error instanceof Error ? error.message : 'Unable to load invite link.';
  }
}

function initializeAdminInviteLink(): void {
  if (adminInviteListenerInitialized) {
    return;
  }

  adminInviteListenerInitialized = true;
  globalThis.addEventListener('bandmap:session-updated', () => {
    void loadAdminInviteLink();
  });
}

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

  initializeTopbarMenu();
  initializeAdminInviteLink();
  void loadAdminInviteLink();

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
