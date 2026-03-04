import { clearApiKey, hasApiKey, isApiConfigured, setApiKey } from './api.js';

interface GlobalConfigOptions {
  onAuthenticated: () => void;
}

export function initGlobalConfig({ onAuthenticated }: GlobalConfigOptions): void {
  const apiKeyGate = document.getElementById('api-key-gate');
  const apiKeyForm = document.getElementById('api-key-form') as HTMLFormElement | null;
  const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement | null;
  const appShell = document.getElementById('app-shell');
  const logoutButton = document.getElementById('logout-button');
  const warning = document.getElementById('api-url-warning');

  const showAppShell = (): void => {
    apiKeyGate?.classList.add('hidden');
    appShell?.classList.remove('hidden');
    onAuthenticated();
  };

  const showApiKeyGate = (): void => {
    appShell?.classList.add('hidden');
    apiKeyGate?.classList.remove('hidden');
    if (apiKeyInput) {
      apiKeyInput.value = '';
      apiKeyInput.focus();
    }
  };

  apiKeyForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const key = apiKeyInput?.value.trim() ?? '';
    if (!key) return;

    setApiKey(key);
    showAppShell();
  });

  logoutButton?.addEventListener('click', () => {
    clearApiKey();
    showApiKeyGate();
  });

  if (!isApiConfigured()) {
    warning?.classList.remove('hidden');
  }

  if (hasApiKey()) {
    showAppShell();
    return;
  }

  showApiKeyGate();
}
