export function normalizeRecommendationSourceArtistName(
  sourceArtistName: string | null | undefined,
): string {
  const normalizedSourceArtistName = sourceArtistName?.trim() ?? '';
  if (
    normalizedSourceArtistName.length === 0 ||
    normalizedSourceArtistName.toLowerCase() === 'unknown'
  ) {
    return '';
  }
  return normalizedSourceArtistName;
}
