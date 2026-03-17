import {
  clearCachedData,
  clearSession,
  hasSession,
  isApiConfigured,
  login,
  redeemInvite,
  refreshSession,
  validateInvite,
} from './api.js';
import { formatEpochSeconds } from './utils.js';

interface GlobalConfigOptions {
  onAuthenticated: () => void;
}

export function initGlobalConfig({ onAuthenticated }: GlobalConfigOptions): void {
  const authGate = document.getElementById('auth-gate');
  const loginPanel = document.getElementById('login-panel');
  const invitePanel = document.getElementById('invite-panel');
  const loginForm = document.getElementById('login-form') as HTMLFormElement | null;
  const loginUsernameInput = document.getElementById('login-username') as HTMLInputElement | null;
  const loginPasswordInput = document.getElementById('login-password') as HTMLInputElement | null;
  const inviteForm = document.getElementById('invite-form') as HTMLFormElement | null;
  const inviteUsernameInput = document.getElementById('invite-username') as HTMLInputElement | null;
  const invitePasswordInput = document.getElementById('invite-password') as HTMLInputElement | null;
  const inviteCodeText = document.getElementById('invite-code-text');
  const inviteStatus = document.getElementById('invite-status');
  const authMessage = document.getElementById('auth-message');
  const inviteMessage = document.getElementById('invite-message');
  const inviteBackButton = document.getElementById('invite-back-button');
  const appShell = document.getElementById('app-shell');
  const logoutButton = document.getElementById('logout-button');
  const clearCacheButton = document.getElementById('clear-cache-button');
  const warning = document.getElementById('api-url-warning');

  const showAppShell = (): void => {
    authGate?.classList.add('hidden');
    appShell?.classList.remove('hidden');
    if (globalThis.location.hash.startsWith('#invite')) {
      globalThis.location.hash = '#/';
    }
    onAuthenticated();
  };

  const showAuthGate = (): void => {
    appShell?.classList.add('hidden');
    authGate?.classList.remove('hidden');
  };

  const setMessage = (element: HTMLElement | null, message: string, isError = false): void => {
    if (!element) return;
    element.textContent = message;
    element.classList.toggle('hidden', message.length === 0);
    element.classList.toggle('auth-error', isError);
    element.classList.toggle('auth-success', !isError && message.length > 0);
  };

  const clearMessages = (): void => {
    setMessage(authMessage, '');
    setMessage(inviteMessage, '');
  };

  const readInviteCodeFromHash = (): string | null => {
    const raw = globalThis.location.hash.startsWith('#')
      ? globalThis.location.hash.slice(1)
      : globalThis.location.hash;
    const normalized = raw.startsWith('/') ? raw.slice(1) : raw;
    if (!normalized.startsWith('invite')) {
      return null;
    }

    const queryIndex = normalized.indexOf('?');
    if (queryIndex === -1) {
      return null;
    }

    const search = normalized.slice(queryIndex + 1);
    const params = new URLSearchParams(search);
    const code = params.get('code')?.trim();
    return code && code.length > 0 ? code : null;
  };

  const showLoginPanel = (): void => {
    clearMessages();
    loginPanel?.classList.remove('hidden');
    invitePanel?.classList.add('hidden');
    if (loginPasswordInput) loginPasswordInput.value = '';
    loginUsernameInput?.focus();
  };

  const showInvitePanel = async (): Promise<void> => {
    clearMessages();
    const inviteCode = readInviteCodeFromHash();
    loginPanel?.classList.add('hidden');
    invitePanel?.classList.remove('hidden');
    if (inviteCodeText) {
      inviteCodeText.textContent = inviteCode ?? 'Unknown';
    }

    if (!inviteCode) {
      setMessage(inviteMessage, 'Invite code is missing from the URL.', true);
      setMessage(inviteStatus, 'Invite unavailable', true);
      return;
    }

    setMessage(inviteStatus, 'Checking invite...', false);
    try {
      const response = await validateInvite(inviteCode);
      if (!response.invite.isValid) {
        setMessage(inviteStatus, 'Invite is invalid, expired, or already exhausted.', true);
        return;
      }

      setMessage(
        inviteStatus,
        `Invite valid. ${response.invite.remainingUses} spot(s) left until ${formatEpochSeconds(response.invite.expiresAt)}.`,
      );
      inviteUsernameInput?.focus();
    } catch (error) {
      setMessage(inviteStatus, errorMessage(error, 'Unable to validate invite.'), true);
    }
  };

  const updateGateForLocation = (): void => {
    if (readInviteCodeFromHash()) {
      void showInvitePanel();
      return;
    }

    showLoginPanel();
  };

  loginForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessages();

    const username = loginUsernameInput?.value.trim() ?? '';
    const password = loginPasswordInput?.value ?? '';
    if (!username || !password) {
      setMessage(authMessage, 'Username and password are required.', true);
      return;
    }

    try {
      await login(username, password);
      showAppShell();
    } catch (error) {
      setMessage(authMessage, errorMessage(error, 'Unable to sign in.'), true);
    }
  });

  inviteForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    clearMessages();

    const code = readInviteCodeFromHash();
    const username = inviteUsernameInput?.value.trim() ?? '';
    const password = invitePasswordInput?.value ?? '';

    if (!code || !username || !password) {
      setMessage(inviteMessage, 'Invite code, username, and password are required.', true);
      return;
    }

    try {
      await redeemInvite({ code, username, password });
      if (loginUsernameInput) {
        loginUsernameInput.value = username;
      }
      if (invitePasswordInput) {
        invitePasswordInput.value = '';
      }
      if (loginPasswordInput) {
        loginPasswordInput.value = '';
      }
      globalThis.location.hash = '#/';
      showLoginPanel();
      setMessage(authMessage, 'Account created. Sign in with your new username and password.');
    } catch (error) {
      setMessage(inviteMessage, errorMessage(error, 'Unable to redeem invite.'), true);
    }
  });

  inviteBackButton?.addEventListener('click', () => {
    globalThis.location.hash = '#/';
    showLoginPanel();
  });

  logoutButton?.addEventListener('click', () => {
    if (!confirm('Are you sure you want to log out?')) return;
    clearSession();
    showAuthGate();
    updateGateForLocation();
  });

  clearCacheButton?.addEventListener('click', () => {
    if (!confirm('Are you sure you want to clear the local storage cache?')) return;
    clearCachedData();
  });

  if (!isApiConfigured()) {
    warning?.classList.remove('hidden');
  }

  globalThis.addEventListener('hashchange', () => {
    if (!hasSession()) {
      updateGateForLocation();
    }
  });

  if (hasSession()) {
    showAppShell();
    void refreshSession().catch((error: unknown) => {
      console.warn('Session refresh failed, signing out', error);
      clearSession();
      showAuthGate();
      updateGateForLocation();
    });
    return;
  }

  showAuthGate();
  updateGateForLocation();
}

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) {
    const apiError = /API error \d+: (.+)$/s.exec(error.message);
    if (apiError?.[1]) {
      try {
        const parsed = JSON.parse(apiError[1]) as { error?: string };
        if (parsed.error) {
          return parsed.error;
        }
      } catch {
        return apiError[1];
      }
    }

    return error.message;
  }

  return fallback;
}
