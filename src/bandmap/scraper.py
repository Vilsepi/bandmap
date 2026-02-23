"""HTTP fetching and HTML parsing for Metal Archives recommendations."""

from __future__ import annotations

import asyncio
import hashlib
import logging
import re
import time
from pathlib import Path

from bs4 import BeautifulSoup
from curl_cffi.requests import AsyncSession

from bandmap.models import Band, SimilarEdge

logger = logging.getLogger(__name__)

BASE_URL = "https://www.metal-archives.com"
RECOMMENDATIONS_URL = f"{BASE_URL}/band/ajax-recommendations/id/{{band_id}}"
BAND_URL_RE = re.compile(r"/bands/[^/]+/(\d+)")

DEFAULT_CACHE_DIR = Path("data/cache")


class Scraper:
    """Fetches and parses Metal Archives recommendation pages.

    Uses curl_cffi to impersonate a real browser TLS fingerprint,
    which is necessary to bypass Cloudflare protection on metal-archives.com.
    """

    def __init__(
        self,
        *,
        rate_limit: float = 1.0,
        cache_dir: Path | None = DEFAULT_CACHE_DIR,
        max_retries: int = 3,
    ) -> None:
        self.rate_limit = rate_limit  # seconds between requests
        self.cache_dir = cache_dir
        self.max_retries = max_retries
        self._last_request_time: float = 0.0

        if self.cache_dir is not None:
            self.cache_dir.mkdir(parents=True, exist_ok=True)

    # -- caching ---------------------------------------------------------

    def _cache_path(self, url: str) -> Path | None:
        if self.cache_dir is None:
            return None
        key = hashlib.sha256(url.encode()).hexdigest()[:16]
        return self.cache_dir / f"{key}.html"

    def _read_cache(self, url: str) -> str | None:
        path = self._cache_path(url)
        if path and path.exists():
            return path.read_text(encoding="utf-8")
        return None

    def _write_cache(self, url: str, html: str) -> None:
        path = self._cache_path(url)
        if path:
            path.write_text(html, encoding="utf-8")

    # -- HTTP ------------------------------------------------------------

    async def _throttle(self) -> None:
        """Enforce minimum delay between requests."""
        now = time.monotonic()
        elapsed = now - self._last_request_time
        if elapsed < self.rate_limit:
            await asyncio.sleep(self.rate_limit - elapsed)
        self._last_request_time = time.monotonic()

    async def _fetch(self, session: AsyncSession, url: str) -> tuple[str, str]:
        """Fetch a URL with caching, rate limiting, and retries.

        Returns (html, source) where source is either "cache" or "remote".
        """
        cached = self._read_cache(url)
        if cached is not None:
            return cached, "cache"

        for attempt in range(1, self.max_retries + 1):
            await self._throttle()
            try:
                resp = await session.get(url)
                if resp.status_code == 429:
                    retry_after = int(resp.headers.get("Retry-After", "5"))
                    logger.warning("Rate limited, sleeping %ds", retry_after)
                    await asyncio.sleep(retry_after)
                    continue
                if resp.status_code >= 500 and attempt < self.max_retries:
                    wait = 2**attempt
                    logger.warning(
                        "Server error %d, retry %d/%d in %ds",
                        resp.status_code,
                        attempt,
                        self.max_retries,
                        wait,
                    )
                    await asyncio.sleep(wait)
                    continue
                resp.raise_for_status()
                html = resp.text
                self._write_cache(url, html)
                return html, "remote"
            except Exception as exc:
                if attempt < self.max_retries:
                    wait = 2**attempt
                    logger.warning(
                        "Request failed (%s), retry %d/%d in %ds",
                        exc,
                        attempt,
                        self.max_retries,
                        wait,
                    )
                    await asyncio.sleep(wait)
                else:
                    raise

        raise RuntimeError(f"Failed to fetch {url} after {self.max_retries} retries")

    # -- parsing ---------------------------------------------------------

    @staticmethod
    def parse_recommendations(
        html: str, source_band_id: int
    ) -> list[tuple[Band, SimilarEdge]]:
        """Parse the recommendations HTML table.

        Returns a list of (Band, SimilarEdge) tuples discovered from the page.
        """
        soup = BeautifulSoup(html, "lxml")
        table = soup.find("table", id="artist_list")
        if table is None:
            logger.warning("No artist_list table found for band %d", source_band_id)
            return []

        results: list[tuple[Band, SimilarEdge]] = []

        for row in table.find_all("tr", id=re.compile(r"^recRow_")):
            cells = row.find_all("td")
            if len(cells) < 3:
                continue

            # Band name + ID from link
            link = cells[0].find("a")
            if link is None:
                continue
            band_name = link.get_text(strip=True)
            href = link.get("href")
            if not isinstance(href, str):
                continue
            band_url = href if href.startswith("http") else f"{BASE_URL}{href}"
            m = BAND_URL_RE.search(href)
            if m is None:
                continue
            target_id = int(m.group(1))

            # Country
            country = cells[1].get_text(strip=True)

            # Genre text from source table (kept as-is)
            genre = cells[2].get_text(strip=True)

            # Score (optional 4th column)
            score: int | None = None
            if len(cells) >= 4:
                score_text = cells[3].get_text(strip=True)
                try:
                    score = int(score_text)
                except ValueError:
                    pass

            band = Band(
                band_id=target_id,
                name=band_name,
                country=country,
                genre=genre,
                url=band_url,
            )
            edge = SimilarEdge(
                source_id=source_band_id, target_id=target_id, score=score
            )
            results.append((band, edge))

        return results

    # -- public API ------------------------------------------------------

    async def get_recommendations(
        self, session: AsyncSession, band_id: int
    ) -> tuple[list[tuple[Band, SimilarEdge]], str]:
        """Fetch and parse recommendations for a single band."""
        url = RECOMMENDATIONS_URL.format(band_id=band_id)
        html, source = await self._fetch(session, url)
        return self.parse_recommendations(html, band_id), source
