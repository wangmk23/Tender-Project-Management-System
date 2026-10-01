"""Replace selected data entries in a PyInstaller CArchive without rebuilding Python code."""

from __future__ import annotations

import os
import shutil
import struct
import tempfile
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping

from PyInstaller.archive.readers import CArchiveReader


COOKIE_FORMAT = "!8sIIII64s"
COOKIE_LENGTH = struct.calcsize(COOKIE_FORMAT)
TOC_ENTRY_FORMAT = "!IIIIBc"
TOC_ENTRY_LENGTH = struct.calcsize(TOC_ENTRY_FORMAT)


@dataclass(frozen=True)
class ArchiveEntry:
    name: str
    offset: int
    stored_length: int
    uncompressed_length: int
    compressed: int
    typecode: str


@dataclass(frozen=True)
class ArchiveLayout:
    prefix: bytes
    suffix: bytes
    entries: tuple[ArchiveEntry, ...]
    archive_data: bytes
    magic: bytes
    python_version: int
    python_library: bytes


def _parse_toc(toc_data: bytes) -> tuple[ArchiveEntry, ...]:
    entries: list[ArchiveEntry] = []
    cursor = 0
    while cursor < len(toc_data):
        header = toc_data[cursor : cursor + TOC_ENTRY_LENGTH]
        entry_length, offset, stored, unpacked, compressed, typecode = struct.unpack(
            TOC_ENTRY_FORMAT, header
        )
        name_data = toc_data[cursor + TOC_ENTRY_LENGTH : cursor + entry_length]
        name = name_data.rstrip(b"\0").decode("utf-8")
        entries.append(
            ArchiveEntry(
                name=name,
                offset=offset,
                stored_length=stored,
                uncompressed_length=unpacked,
                compressed=compressed,
                typecode=typecode.decode("ascii"),
            )
        )
        cursor += entry_length
    if cursor != len(toc_data):
        raise ValueError("CArchive TOC 长度无效")
    return tuple(entries)


def _read_layout(source: Path) -> ArchiveLayout:
    reader = CArchiveReader(str(source))
    raw = source.read_bytes()
    cookie_start = reader._end_offset - COOKIE_LENGTH
    magic, archive_length, toc_offset, toc_length, pyvers, pylib = struct.unpack(
        COOKIE_FORMAT, raw[cookie_start : reader._end_offset]
    )
    if archive_length != reader._end_offset - reader._start_offset:
        raise ValueError("CArchive cookie 与归档边界不一致")
    toc_start = reader._start_offset + toc_offset
    toc_data = raw[toc_start : toc_start + toc_length]
    return ArchiveLayout(
        prefix=raw[: reader._start_offset],
        suffix=raw[reader._end_offset :],
        entries=_parse_toc(toc_data),
        archive_data=raw[reader._start_offset : toc_start],
        magic=magic,
        python_version=pyvers,
        python_library=pylib,
    )


def _serialize_toc(entries: list[ArchiveEntry]) -> bytes:
    serialized: list[bytes] = []
    for entry in entries:
        name = entry.name.encode("utf-8")
        raw_length = TOC_ENTRY_LENGTH + len(name) + 1
        entry_length = (raw_length + 15) & ~15
        serialized.append(
            struct.pack(
                TOC_ENTRY_FORMAT,
                entry_length,
                entry.offset,
                entry.stored_length,
                entry.uncompressed_length,
                entry.compressed,
                entry.typecode.encode("ascii"),
            )
            + name
            + b"\0" * (entry_length - TOC_ENTRY_LENGTH - len(name))
        )
    return b"".join(serialized)


def patch_executable(
    source: Path | str,
    destination: Path | str,
    replacements: Mapping[str, Path | str],
    *,
    exclude: frozenset[str] = frozenset(),
) -> None:
    """Write a patched copy of *source*; never modifies *source* in place."""

    source = Path(source).resolve()
    destination = Path(destination).resolve()
    if source == destination:
        raise ValueError("源 EXE 与目标 EXE 必须是不同文件")

    layout = _read_layout(source)
    replacement_paths = {name: Path(path) for name, path in replacements.items()}
    known_names = {entry.name for entry in layout.entries if entry.typecode != "o"}
    unknown = set(replacement_paths) - known_names
    if unknown:
        raise KeyError(f"归档中不存在条目: {sorted(unknown)!r}")
    if set(exclude) - known_names:
        raise KeyError("unknown excluded archive entry")
    if set(exclude) & set(replacement_paths):
        raise ValueError("cannot replace and exclude the same archive entry")
    for name, path in replacement_paths.items():
        if not path.is_file():
            raise FileNotFoundError(f"替换文件不存在: {name} -> {path}")

    payload = bytearray()
    output_entries: list[ArchiveEntry] = []
    for entry in layout.entries:
        if entry.name in exclude:
            continue
        replacement = replacement_paths.get(entry.name)
        if replacement is None:
            stored = layout.archive_data[
                entry.offset : entry.offset + entry.stored_length
            ]
            unpacked_length = entry.uncompressed_length
        else:
            unpacked = replacement.read_bytes()
            stored = zlib.compress(unpacked, level=9) if entry.compressed else unpacked
            unpacked_length = len(unpacked)

        output_entries.append(
            ArchiveEntry(
                name=entry.name,
                offset=len(payload),
                stored_length=len(stored),
                uncompressed_length=unpacked_length,
                compressed=entry.compressed,
                typecode=entry.typecode,
            )
        )
        payload.extend(stored)

    toc_offset = len(payload)
    toc_data = _serialize_toc(output_entries)
    archive_length = len(payload) + len(toc_data) + COOKIE_LENGTH
    cookie = struct.pack(
        COOKIE_FORMAT,
        layout.magic,
        archive_length,
        toc_offset,
        len(toc_data),
        layout.python_version,
        layout.python_library,
    )

    destination.parent.mkdir(parents=True, exist_ok=True)
    temp_path: Path | None = None
    try:
        with tempfile.NamedTemporaryFile(
            mode="wb", delete=False, dir=destination.parent, suffix=".tmp"
        ) as stream:
            temp_path = Path(stream.name)
            stream.write(layout.prefix)
            stream.write(payload)
            stream.write(toc_data)
            stream.write(cookie)
            stream.write(layout.suffix)
            stream.flush()
            os.fsync(stream.fileno())
        shutil.copymode(source, temp_path)
        os.replace(temp_path, destination)
        temp_path = None
    finally:
        if temp_path is not None:
            temp_path.unlink(missing_ok=True)
