export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function formatEpochSeconds(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

export function getExternalLinkIconClass(url: string | undefined): string {
  if (isHostname(url, ['last.fm', 'www.last.fm'])) {
    return 'fa-brands fa-lastfm';
  }

  if (isHostname(url, ['spotify.com', 'open.spotify.com'])) {
    return 'fa-brands fa-spotify';
  }

  return 'fa-regular fa-circle-play';
}

function isHostname(url: string | undefined, allowedHosts: string[]): boolean {
  if (!url) {
    return false;
  }

  try {
    return allowedHosts.includes(new URL(url).hostname);
  } catch {
    return false;
  }
}
