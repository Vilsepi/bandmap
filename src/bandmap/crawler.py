"""BFS crawler that traverses the Metal Archives recommendation graph."""

from __future__ import annotations

import asyncio
import logging
import signal
from collections import deque
from pathlib import Path

from curl_cffi.requests import AsyncSession

from bandmap.models import BandGraph, CrawlState
from bandmap.scraper import Scraper
from bandmap.store import JsonStore

logger = logging.getLogger(__name__)


class Crawler:
    """Breadth-first crawler over band recommendations.

    Parameters
    ----------
    seeds : list of band IDs to start from.
    max_depth : max BFS hops from any seed (0 = seeds only).
    max_bands : stop after visiting this many bands.
    rate_limit : minimum seconds between HTTP requests.
    cache_dir : directory for raw HTML cache (None to disable).
    concurrency : max simultaneous HTTP requests.
    save_path : directory or path that determines where incremental JSON saves go.
    """

    def __init__(
        self,
        seeds: list[int],
        *,
        max_depth: int = 2,
        max_bands: int = 500,
        rate_limit: float = 1.0,
        cache_dir: Path | None = Path("data/cache"),
        concurrency: int = 1,
        save_path: Path = Path("data"),
        save_every: int = 10,
    ) -> None:
        self.seeds = seeds
        self.max_depth = max_depth
        self.max_bands = max_bands
        self.concurrency = concurrency
        self.save_path = save_path
        self.save_every = save_every
        self._bands_since_save = 0
        self._dirty = False

        self.scraper = Scraper(rate_limit=rate_limit, cache_dir=cache_dir)
        self.graph = BandGraph()
        self.visited: set[int] = set()
        self._resume_queue: deque[tuple[int, int]] = deque()

        # Load existing progress if available
        self._store = JsonStore(save_path)
        existing = self._store.load()
        state = self._store.load_crawl_state()

        if existing is not None:
            self.graph = existing
            if state is not None:
                self.visited = set(state.crawled_ids)
                self._resume_queue = deque(
                    (band_id, depth)
                    for band_id, depth in state.pending_queue
                    if depth <= self.max_depth
                )
                logger.info(
                    "Resumed with %d bands, %d edges (%d crawled, %d queued)",
                    len(self.graph.bands),
                    len(self.graph.edges),
                    len(self.visited),
                    len(self._resume_queue),
                )
            else:
                logger.warning(
                    "Found existing graph without crawl_state.json; "
                    "starting traversal from seeds and rebuilding checkpoint state"
                )

    def _save_checkpoint(self, queue: deque[tuple[int, int]]) -> None:
        self._store.save(self.graph)
        self._store.save_crawl_state(
            CrawlState(
                crawled_ids=sorted(self.visited),
                pending_queue=list(queue),
            )
        )
        self._dirty = False
        self._bands_since_save = 0

    def _maybe_save_checkpoint(self, queue: deque[tuple[int, int]]) -> None:
        """Mark graph as dirty and flush to disk every *save_every* bands."""
        self._dirty = True
        self._bands_since_save += 1
        if self._bands_since_save >= self.save_every:
            self._save_checkpoint(queue)

    def _flush(self, queue: deque[tuple[int, int]]) -> None:
        """Write current state to disk if there are unsaved changes."""
        if self._dirty:
            self._save_checkpoint(queue)

    def _build_initial_queue(self) -> deque[tuple[int, int]]:
        queue: deque[tuple[int, int]] = deque(self._resume_queue)
        if queue:
            return queue

        for seed in self.seeds:
            if seed not in self.visited:
                queue.append((seed, 0))
        return queue

    async def _fetch_recommendations(
        self,
        session: AsyncSession,
        sem: asyncio.Semaphore,
        band_id: int,
    ) -> tuple[list[tuple], str] | None:
        async with sem:
            try:
                return await self.scraper.get_recommendations(session, band_id)
            except Exception:
                logger.exception("Failed to fetch band %d", band_id)
                return None

    def _add_results_to_graph(
        self,
        results: list[tuple],
        queue: deque[tuple[int, int]],
        depth: int,
    ) -> None:
        for band, edge in results:
            self.graph.add_band(band)
            self.graph.add_edge(edge)

            if (
                depth + 1 <= self.max_depth
                and band.band_id not in self.visited
                and len(self.visited) < self.max_bands
            ):
                queue.append((band.band_id, depth + 1))

    async def crawl(self) -> BandGraph:
        """Run the BFS crawl and return the resulting graph."""
        sem = asyncio.Semaphore(self.concurrency)

        # Queue entries: (band_id, depth)
        queue = self._build_initial_queue()

        # Install signal handlers so Ctrl-C / SIGTERM flush before exit.
        original_sigint = signal.getsignal(signal.SIGINT)
        original_sigterm = signal.getsignal(signal.SIGTERM)

        def _on_signal(sig, frame):
            logger.warning("Caught signal %s — flushing data to disk…", sig)
            self._flush(queue)
            signal.signal(sig, original_sigint if sig == signal.SIGINT else original_sigterm)
            raise KeyboardInterrupt

        signal.signal(signal.SIGINT, _on_signal)
        signal.signal(signal.SIGTERM, _on_signal)

        try:
            async with AsyncSession(impersonate="chrome") as session:
                while queue and len(self.visited) < self.max_bands:
                    band_id, depth = queue.popleft()

                    if band_id in self.visited:
                        continue

                    self.visited.add(band_id)

                    fetched = await self._fetch_recommendations(session, sem, band_id)
                    if fetched is None:
                        self._maybe_save_checkpoint(queue)
                        continue

                    results, source = fetched
                    logger.info(
                        "Crawled band %d from %s (depth=%d, visited=%d/%d)",
                        band_id,
                        source,
                        depth,
                        len(self.visited),
                        self.max_bands,
                    )

                    self._add_results_to_graph(results, queue, depth)

                    self._maybe_save_checkpoint(queue)
        finally:
            # Always flush unsaved work (normal exit, Ctrl-C, or exception).
            self._flush(queue)
            signal.signal(signal.SIGINT, original_sigint)
            signal.signal(signal.SIGTERM, original_sigterm)

        logger.info(
            "Crawl complete: %d bands, %d edges",
            len(self.graph.bands),
            len(self.graph.edges),
        )
        return self.graph


def run_crawl(
    seeds: list[int],
    *,
    max_depth: int = 2,
    max_bands: int = 500,
    rate_limit: float = 1.0,
    save_path: Path = Path("data"),
    save_every: int = 10,
) -> BandGraph:
    """Synchronous convenience wrapper around the async crawler."""
    crawler = Crawler(
        seeds,
        max_depth=max_depth,
        max_bands=max_bands,
        rate_limit=rate_limit,
        save_path=save_path,
        save_every=save_every,
    )
    return asyncio.run(crawler.crawl())
