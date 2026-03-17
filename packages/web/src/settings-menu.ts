import { getCurrentUser, getLatestInviteLink } from './api.js';
import { escapeHtml, formatEpochSeconds } from './utils.js';

interface BuildInfo {
  timestamp: string;
  buildIdentifier: string;
  githubSha?: string;
  githubRunId?: string;
  deploymentUrl?: string;
}

const buildInfoText = document.getElementById('build-info-text');
const settingsMenuContainer = document.getElementById('settings-menu-container');
const settingsMenuToggle = document.getElementById(
  'settings-menu-toggle',
) as HTMLButtonElement | null;
const settingsMenuDropdown = document.getElementById('settings-menu-dropdown');
const settingsMenuIcon = settingsMenuToggle?.querySelector<HTMLElement>('i') ?? null;
const settingsMenuPanel = document.querySelector<HTMLElement>(
  '#settings-menu-dropdown .settings-menu-panel',
);
const adminInviteLink = document.getElementById('admin-invite-link') as HTMLAnchorElement | null;
const adminInviteStatus = document.getElementById('admin-invite-status');

let settingsMenuCloseTimer: ReturnType<typeof setTimeout> | null = null;
let settingsMenuInitialized = false;
let adminInviteListenerInitialized = false;

function setSettingsMenuOpen(isOpen: boolean): void {
  if (!settingsMenuToggle || !settingsMenuDropdown) {
    return;
  }

  if (settingsMenuCloseTimer) {
    clearTimeout(settingsMenuCloseTimer);
    settingsMenuCloseTimer = null;
  }

  settingsMenuToggle.setAttribute('aria-expanded', String(isOpen));
  settingsMenuToggle.setAttribute(
    'aria-label',
    isOpen ? 'Close settings menu' : 'Open settings menu',
  );

  if (settingsMenuIcon) {
    settingsMenuIcon.classList.toggle('fa-gear', !isOpen);
    settingsMenuIcon.classList.toggle('fa-xmark', isOpen);
  }

  if (isOpen) {
    settingsMenuDropdown.classList.remove('hidden');
    requestAnimationFrame(() => {
      settingsMenuDropdown.classList.add('is-open');
    });
  } else {
    settingsMenuDropdown.classList.remove('is-open');
    settingsMenuCloseTimer = setTimeout(() => {
      settingsMenuDropdown.classList.add('hidden');
      settingsMenuCloseTimer = null;
    }, 240);
  }

  document.body.classList.toggle('settings-menu-open', isOpen);
}

function initializeMenuInteractions(): void {
  if (!settingsMenuContainer || !settingsMenuToggle || !settingsMenuDropdown) {
    return;
  }

  settingsMenuToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    const isExpanded = settingsMenuToggle.getAttribute('aria-expanded') === 'true';
    setSettingsMenuOpen(!isExpanded);
  });

  document.addEventListener('click', (event) => {
    if (!(event.target instanceof Node)) {
      return;
    }

    if (!settingsMenuContainer.contains(event.target)) {
      setSettingsMenuOpen(false);
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      setSettingsMenuOpen(false);
    }
  });

  settingsMenuDropdown.addEventListener('click', (event) => {
    if (event.target === settingsMenuDropdown) {
      setSettingsMenuOpen(false);
    }
  });

  settingsMenuPanel?.addEventListener('click', (event) => {
    event.stopPropagation();
  });
}

async function loadBuildInfo(): Promise<void> {
  if (!buildInfoText) {
    return;
  }

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

export function initializeSettingsMenu(): void {
  if (settingsMenuInitialized) {
    return;
  }

  settingsMenuInitialized = true;
  initializeMenuInteractions();
  initializeAdminInviteLink();
  void loadBuildInfo();
  void loadAdminInviteLink();
}
