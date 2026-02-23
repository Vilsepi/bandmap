"""Pydantic data models for the band graph."""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel
from pydantic import model_validator


class Band(BaseModel):
    """A metal band node in the graph."""

    band_id: int
    name: str
    country: str
    genre: str
    url: str | None = None

    @model_validator(mode="before")
    @classmethod
    def _migrate_legacy_genres(cls, data: Any) -> Any:
        if not isinstance(data, dict):
            return data

        if "genre" in data and isinstance(data["genre"], str):
            return data

        legacy_genres = data.get("genres")
        if isinstance(legacy_genres, list):
            data["genre"] = ", ".join(
                genre.strip()
                for genre in legacy_genres
                if isinstance(genre, str) and genre.strip()
            )
        elif isinstance(legacy_genres, str):
            data["genre"] = legacy_genres
        else:
            data["genre"] = ""

        return data


class SimilarEdge(BaseModel):
    """An edge representing a 'similar to' relationship between two bands."""

    source_id: int
    target_id: int
    score: int | None = None


class BandGraph(BaseModel):
    """The full graph of bands and their similarity edges."""

    bands: dict[int, Band] = {}
    edges: list[SimilarEdge] = []

    def add_band(self, band: Band) -> None:
        self.bands[band.band_id] = band

    def add_edge(self, edge: SimilarEdge) -> None:
        # Avoid duplicate edges
        for existing in self.edges:
            if (
                existing.source_id == edge.source_id
                and existing.target_id == edge.target_id
            ):
                return
        self.edges.append(edge)

    def merge(self, other: BandGraph) -> None:
        """Merge another graph into this one."""
        for band in other.bands.values():
            self.add_band(band)
        for edge in other.edges:
            self.add_edge(edge)


class CrawlState(BaseModel):
    """Persistent crawler checkpoint state for resuming BFS."""

    crawled_ids: list[int] = []
    pending_queue: list[tuple[int, int]] = []
