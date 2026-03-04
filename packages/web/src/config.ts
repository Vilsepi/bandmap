import { hasApiKey, isApiConfigured, setApiKey } from './api.js';

export function initGlobalConfig(): void {
  const apiKeyInput = document.getElementById('api-key-input') as HTMLInputElement;
  const saveApiKeyBtn = document.getElementById('save-api-key');

  if (hasApiKey()) {
    apiKeyInput.value = '••••••••';
  }

  saveApiKeyBtn?.addEventListener('click', () => {
    const key = apiKeyInput.value.trim();
    if (key && key !== '••••••••') {
      setApiKey(key);
      apiKeyInput.value = '••••••••';
    }
  });

  if (!isApiConfigured()) {
    const warning = document.getElementById('api-url-warning');
    warning?.classList.remove('hidden');
  }
}
