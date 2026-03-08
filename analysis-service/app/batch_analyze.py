"""Batch analysis runner — pre-compute summaries + state labels for all entries.

Follows the graph_ingest.py pattern: CLI script with --full and --dry-run flags.
Uses the entry_summary_service in-process (no HTTP calls).

Usage:
  docker compose --profile batch-analysis run --rm batch-analysis [--full] [--dry-run] [--provider mock] [--workers 4]
"""

from __future__ import annotations

import argparse
import logging
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from .corpus_utils import (
    chunk_text,
    dedupe_files_by_filename,
    discover_files,
    parse_date_from_birthtime,
    parse_date_from_content,
    parse_date_from_filename,
    strip_markdown,
)
from .entry_summary_provider import OllamaEntrySummaryProvider
from .entry_summary_service import create_entry_summary_service
from .logging_utils import setup_logging
from .models import EntryChunk, EntrySummaryGenerateRequest
from .state_label_provider import OllamaStateLabelProvider
from .state_label_service import create_state_label_service

setup_logging(os.environ.get("LOG_LEVEL", "INFO"))
logger = logging.getLogger("batch-analyze")

CORPUS_PATH = os.environ.get("CORPUS_PATH", "/corpus")

DEFAULT_WORKERS = 1


def _build_chunks(file_path: Path, plain_text: str) -> list[EntryChunk]:
    """Chunk text and build EntryChunk list with IDs matching the embeddings service."""
    texts = chunk_text(plain_text)
    stem = file_path.stem
    return [
        EntryChunk(
            chunk_id=f"{stem}__chunk_{i}",
            text=text,
            source_file=file_path.name,
        )
        for i, text in enumerate(texts)
    ]


def _is_entry_done(entry_id: str, summary_service, state_label_service) -> bool:
    """Check if entry passes all quality gates for skip-done."""
    existing_summary = summary_service.get_entry_summary(entry_id)
    if existing_summary is None:
        return False
    if existing_summary.processing.provider != "ollama":
        return False
    if existing_summary.processing.prompt_version != OllamaEntrySummaryProvider.prompt_version:
        return False
    if not existing_summary.themes:
        return False
    # Entities must be typed objects (v6 format)
    if existing_summary.entities:
        first = existing_summary.entities[0]
        if not hasattr(first, "type"):
            return False

    if state_label_service is None:
        return True
    existing_labels = state_label_service.get_state_labels(entry_id)
    if existing_labels is None:
        return False
    if existing_labels.processing.provider != "ollama":
        return False
    if existing_labels.processing.prompt_version != OllamaStateLabelProvider.prompt_version:
        return False
    # Check for flatlined state labels
    if all(dim.score == 0.0 for dim in existing_labels.state_profile.dimensions):
        return False
    return True


def _prepare_entry(file_path: Path, full: bool, service, skip_done: bool = False, state_label_service=None):
    """Read and prepare a single entry. Returns (request, None) or (None, skip_reason)."""
    entry_id = file_path.stem

    if skip_done:
        # Cross-table quality check: summary + state labels must both pass
        if _is_entry_done(entry_id, service, state_label_service):
            return None, "cached"
    elif not full:
        existing = service.get_entry_summary(entry_id)
        if existing is not None:
            return None, "cached"

    try:
        text = file_path.read_text(encoding="utf-8", errors="replace")
    except Exception as e:
        logger.warning(f"Skipping {file_path.name}: {e}")
        return None, "error"

    if not text.strip():
        return None, "empty"

    date_str = parse_date_from_filename(file_path.name)
    if date_str is None:
        date_str = parse_date_from_content(text)
    if date_str is None:
        date_str = parse_date_from_birthtime(file_path)

    plain_text = strip_markdown(text)
    if not plain_text.strip():
        return None, "empty"

    chunks = _build_chunks(file_path, plain_text)
    if not chunks:
        return None, "empty"

    request = EntrySummaryGenerateRequest(
        entry_id=entry_id,
        entry_date=date_str,
        source_file=file_path.name,
        chunks=chunks,
        force_regenerate=full or skip_done,
    )
    return request, None


def _analyze_entry(service, request: EntrySummaryGenerateRequest, provider: str | None):
    """Run analysis for a single entry. Thread-safe — each Ollama call uses its own httpx client."""
    if provider:
        request = EntrySummaryGenerateRequest(
            entry_id=request.entry_id,
            entry_date=request.entry_date,
            source_file=request.source_file,
            chunks=request.chunks,
            force_regenerate=request.force_regenerate,
            provider=provider,
        )
    service.generate_and_persist(request)
    return request.entry_id


# Thread-safe counters
_lock = threading.Lock()
_counters = {"analyzed": 0, "skipped": 0, "errors": 0, "submitted": 0}


def _inc(key: str) -> int:
    with _lock:
        _counters[key] += 1
        return _counters[key]


def _snapshot() -> dict:
    with _lock:
        return dict(_counters)


def run_batch(
    full: bool = False,
    dry_run: bool = False,
    provider: str | None = None,
    workers: int = DEFAULT_WORKERS,
    skip_done: bool = False,
):
    """Run batch analysis across all corpus entries."""
    corpus_dir = Path(CORPUS_PATH)
    if not corpus_dir.exists():
        logger.error(f"Corpus path does not exist: {CORPUS_PATH}")
        sys.exit(1)

    discovered = discover_files(CORPUS_PATH)
    md_files, duplicates_skipped = dedupe_files_by_filename(discovered)
    total = len(md_files)
    logger.info(f"Found {len(discovered)} .md files ({total} unique)")
    if duplicates_skipped > 0:
        logger.info(f"Skipping {duplicates_skipped} duplicate basenames.")

    if total == 0:
        logger.error("No .md files found. Check CORPUS_PATH.")
        sys.exit(1)

    service = create_entry_summary_service()
    state_label_svc = create_state_label_service() if skip_done else None

    if dry_run:
        for file_path in md_files:
            logger.info(f"  [DRY RUN] Would analyze: {file_path.name}")
        logger.info(f"[DRY RUN] {total} entries would be analyzed.")
        return

    # Prepare all requests up front (fast — just file reads, no Ollama calls)
    requests: list[tuple[int, EntrySummaryGenerateRequest]] = []
    for i, file_path in enumerate(md_files):
        request, skip_reason = _prepare_entry(file_path, full, service, skip_done=skip_done, state_label_service=state_label_svc)
        if request is None:
            if skip_reason == "error":
                _inc("errors")
            else:
                _inc("skipped")
            continue
        requests.append((i, request))

    pending = len(requests)
    snap = _snapshot()
    logger.info(
        f"Prepared {pending} entries for analysis "
        f"(skipped: {snap['skipped']}, errors: {snap['errors']}). "
        f"Using {workers} workers."
    )

    if pending == 0:
        logger.info("Nothing to analyze.")
        return

    # Process in parallel
    with ThreadPoolExecutor(max_workers=workers) as pool:
        futures = {}
        for idx, request in requests:
            future = pool.submit(_analyze_entry, service, request, provider)
            futures[future] = (idx, request.entry_id)

        for future in as_completed(futures):
            idx, entry_id = futures[future]
            try:
                future.result()
                count = _inc("analyzed")
                submitted = _inc("submitted")
                if count % 10 == 0 or submitted == pending:
                    snap = _snapshot()
                    logger.info(
                        f"Progress: {snap['analyzed']}/{pending} analyzed "
                        f"({snap['errors']} errors)"
                    )
            except Exception as e:
                _inc("errors")
                _inc("submitted")
                logger.error(f"Error analyzing {entry_id}: {e}")

    mode = "FULL" if full else "INCREMENTAL"
    snap = _snapshot()
    logger.info(
        f"[{mode}] Batch analysis complete: {snap['analyzed']} analyzed, "
        f"{snap['skipped']} skipped, {snap['errors']} errors (of {total} total)"
    )


def main():
    parser = argparse.ArgumentParser(description="Batch-analyze corpus entries")
    parser.add_argument("--full", action="store_true", help="Force re-analysis of all entries")
    parser.add_argument("--dry-run", action="store_true", help="Show what would be analyzed without running")
    parser.add_argument(
        "--provider",
        choices=["auto", "mock", "ollama", "anthropic"],
        default=None,
        help="Override analysis provider (default: use env var)",
    )
    parser.add_argument(
        "--workers",
        type=int,
        default=DEFAULT_WORKERS,
        help=f"Number of parallel workers (default: {DEFAULT_WORKERS})",
    )
    parser.add_argument(
        "--skip-done",
        action="store_true",
        help="Skip entries already processed by Ollama (re-process mock fallback entries)",
    )
    args = parser.parse_args()

    run_batch(
        full=args.full,
        dry_run=args.dry_run,
        provider=args.provider,
        workers=args.workers,
        skip_done=args.skip_done,
    )


if __name__ == "__main__":
    main()
