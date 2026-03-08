"""Shared corpus file discovery, deduplication, hashing, and manifest utilities."""

from .file_discovery import (
    compute_file_hash,
    dedupe_files_by_filename,
    discover_files,
    parse_date_from_birthtime,
    parse_date_from_content,
    parse_date_from_filename,
)
from .manifest import ChangeSet, IngestManifest, compute_changeset
from .request_logging import RequestIdMiddleware, request_id_var, setup_logging
from .text_processing import chunk_text, strip_markdown

__all__ = [
    "chunk_text",
    "compute_file_hash",
    "dedupe_files_by_filename",
    "discover_files",
    "parse_date_from_birthtime",
    "parse_date_from_content",
    "parse_date_from_filename",
    "strip_markdown",
    "ChangeSet",
    "IngestManifest",
    "compute_changeset",
    "RequestIdMiddleware",
    "request_id_var",
    "setup_logging",
]
