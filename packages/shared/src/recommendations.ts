export function normalizeRecommendationSourceArtistName(
  sourceName: string | null | undefined,
): string {
  const normalizedSourceArtistName = sourceName?.trim() ?? '';
  if (
    normalizedSourceArtistName.length === 0 ||
    normalizedSourceArtistName.toLowerCase() === 'unknown'
  ) {
    return '';
  }
  return normalizedSourceArtistName;
}
