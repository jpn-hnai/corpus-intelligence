"""Shared file discovery, deduplication, date parsing, and hashing utilities."""

from __future__ import annotations

import hashlib
import re
from datetime import datetime
from pathlib import Path

# --- Date patterns ---

# M-D-YYYY or MM-DD-YYYY at start of filename
DATE_PATTERN_MDY = re.compile(r"^(\d{1,2})-(\d{1,2})-(\d{4})")
# YYYY-MM-DD
DATE_PATTERN_YMD = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")
# YYYYMMDD
DATE_PATTERN_COMPACT = re.compile(r"^(\d{4})(\d{2})(\d{2})")
# MM/DD/YYYY in file content header
HEADER_DATE_PATTERN = re.compile(r"(\d{2})/(\d{2})/(\d{4})")


def parse_date_from_filename(filename: str) -> str | None:
    """Try to extract a date from the filename. Returns YYYY-MM-DD or None."""
    stem = Path(filename).stem

    # Try M-D-YYYY or MM-DD-YYYY (e.g. 1-1-2025.md, 08-18-2025 10-15 Title.md)
    m = DATE_PATTERN_MDY.match(stem)
    if m:
        month, day, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return datetime(year, month, day).strftime("%Y-%m-%d")
        except ValueError:
            pass

    # Try YYYY-MM-DD
    m = DATE_PATTERN_YMD.match(stem)
    if m:
        year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return datetime(year, month, day).strftime("%Y-%m-%d")
        except ValueError:
            pass

    # Try YYYYMMDD
    m = DATE_PATTERN_COMPACT.match(stem)
    if m:
        year, month, day = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return datetime(year, month, day).strftime("%Y-%m-%d")
        except ValueError:
            pass

    return None


def parse_date_from_content(text: str) -> str | None:
    """Try to extract a date from the file content header (e.g. # 08/18/2025)."""
    head = text[:300]
    m = HEADER_DATE_PATTERN.search(head)
    if m:
        month, day, year = int(m.group(1)), int(m.group(2)), int(m.group(3))
        try:
            return datetime(year, month, day).strftime("%Y-%m-%d")
        except ValueError:
            pass
    return None


def parse_date_from_birthtime(file_path: Path) -> str | None:
    """Try to extract a date from the file's creation time (birthtime)."""
    try:
        stat = file_path.stat()
        # st_birthtime on macOS, fall back to st_mtime
        ts = getattr(stat, "st_birthtime", None) or stat.st_mtime
        return datetime.fromtimestamp(ts).strftime("%Y-%m-%d")
    except (OSError, ValueError):
        return None


def discover_files(corpus_path: str) -> list[Path]:
    """Find all .md files in the corpus directory."""
    root = Path(corpus_path)
    return sorted(root.rglob("*.md"))


def dedupe_files_by_filename(files: list[Path]) -> tuple[list[Path], int]:
    """
    Keep a single file per basename.
    If duplicates exist, prefer the shallower path (typically the canonical copy).
    """
    chosen: dict[str, Path] = {}

    for path in files:
        key = path.name.lower()
        current = chosen.get(key)
        if current is None:
            chosen[key] = path
            continue

        current_depth = len(current.parts)
        candidate_depth = len(path.parts)
        if candidate_depth < current_depth:
            chosen[key] = path
            continue
        if candidate_depth == current_depth and len(str(path)) < len(str(current)):
            chosen[key] = path

    deduped = sorted(chosen.values())
    skipped = len(files) - len(deduped)
    return deduped, skipped


def compute_file_hash(file_path: Path) -> str:
    """Return the SHA-256 hex digest of a file's raw bytes."""
    h = hashlib.sha256()
    with open(file_path, "rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()
