export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

export function formatEpochSeconds(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleString();
}

export function getExternalLinkIconClass(url: string | undefined): string {
  if (url?.includes('last.fm')) {
    return 'fa-brands fa-lastfm';
  }

  if (url?.includes('spotify.com')) {
    return 'fa-brands fa-spotify';
  }

  return 'fa-regular fa-circle-play';
}
