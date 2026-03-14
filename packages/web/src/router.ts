export type ViewName = 'search' | 'ratings' | 'todo' | 'recommendations';

export interface AppRoute {
  view: ViewName;
  artistId?: string;
}

export interface NavigateOptions {
  updateUrl?: 'push' | 'replace' | 'none';
}

function parseRoute(hash: string): AppRoute {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const withLeadingSlash = raw.startsWith('/') ? raw : `/${raw}`;
  const normalized = withLeadingSlash.replace(/\/+$/, '') || '/';
  const artistMatch = /^\/artists\/([^/]+)$/.exec(normalized);
  if (artistMatch?.[1]) {
    try {
      return { view: 'search', artistId: decodeURIComponent(artistMatch[1]) };
    } catch {
      return { view: 'search' };
    }
  }

  switch (normalized) {
    case '/':
    case '/search':
      return { view: 'search' };
    case '/ratings':
      return { view: 'ratings' };
    case '/todo':
      return { view: 'todo' };
    case '/recommendations':
      return { view: 'recommendations' };
    default:
      return { view: 'search' };
  }
}

function routeToHash(route: AppRoute): string {
  if (route.artistId) return `#/artists/${encodeURIComponent(route.artistId)}`;

  switch (route.view) {
    case 'search':
      return '#/';
    case 'ratings':
      return '#/ratings';
    case 'todo':
      return '#/todo';
    case 'recommendations':
      return '#/recommendations';
  }
}

function setUrlForRoute(route: AppRoute, mode: 'push' | 'replace'): boolean {
  const nextHash = routeToHash(route);
  if (globalThis.location.hash === nextHash) return false;

  if (mode === 'replace') {
    const url = `${globalThis.location.pathname}${globalThis.location.search}${nextHash}`;
    history.replaceState(route, '', url);
    return false;
  }

  globalThis.location.hash = nextHash;
  return true;
}

export function createRouter(onNavigate: (route: AppRoute) => Promise<void>): {
  getInitialRoute: () => AppRoute;
  navigateToRoute: (route: AppRoute, options?: NavigateOptions) => Promise<void>;
} {
  const navLinks = document.querySelectorAll<HTMLAnchorElement>('.nav-link');
  let suppressNextHashChange = false;

  const navigateToRoute = async (route: AppRoute, options: NavigateOptions = {}): Promise<void> => {
    const updateUrl = options.updateUrl ?? 'push';
    if (updateUrl !== 'none') {
      suppressNextHashChange = setUrlForRoute(route, updateUrl);
    }

    await onNavigate(route);
  };

  navLinks.forEach((link) => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const viewName = link.dataset['view'] as ViewName | undefined;
      if (viewName) {
        void navigateToRoute({ view: viewName });
      }
    });
  });

  globalThis.addEventListener('hashchange', () => {
    if (suppressNextHashChange) {
      suppressNextHashChange = false;
      return;
    }

    const route = parseRoute(globalThis.location.hash);
    void navigateToRoute(route, { updateUrl: 'none' });
  });

  return {
    getInitialRoute: () => parseRoute(globalThis.location.hash),
    navigateToRoute,
  };
}
