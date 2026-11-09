"""local-files-index-v1: Bounded metadata-only traversal. Workers never follow reparse points."""
import os
import time
from contextlib import nullcontext
from pathlib import Path
try:
    from .local_files_windows import is_link, local_directory
except ImportError:
    from local_files_windows import is_link, local_directory


def empty_scan():
    return dict(task_id=None,state='idle',files=0,folders=0,bytes=0,complete=False,errors=[],skipped_links=[],started_at=None,finished_at=None)


def _portable_entries(directory):
    local_directory(directory)
    with os.scandir(directory) as children:
        for child in children:
            try:
                if is_link(child.path):
                    yield child.name,'link',0,0
                    continue
                info=child.stat(follow_symlinks=False)
                folder=child.is_dir(follow_symlinks=False)
                yield child.name,'directory' if folder else 'file',0 if folder else info.st_size,info.st_mtime
            except OSError:
                yield child.name,'unreadable',0,0


def scan_directory(root,cancel,*,max_entries=50000,max_depth=32,seconds=30,directory_reader=None):
    started=time.monotonic(); scan=empty_scan(); scan.update(state='scanning',started_at=time.time())
    entries=[]; pending=[('',0)]; root=Path(root); partial=False
    while pending:
        if cancel.is_set() or time.monotonic()-started>=seconds or len(entries)>=max_entries:
            partial=True; break
        relative,depth=pending.pop()
        directory=root/relative
        try:
            reader = directory_reader(directory) if directory_reader else nullcontext(None)
            with reader as metadata:
                for name,kind,size,modified in metadata if metadata is not None else _portable_entries(directory):
                    if cancel.is_set() or time.monotonic()-started>=seconds or len(entries)>=max_entries:
                        partial=True; break
                    rel=(Path(relative)/name).as_posix()
                    if kind == 'link':
                        scan['skipped_links'].append(rel); partial=True; continue
                    if kind == 'unreadable':
                        partial=True; scan['errors'].append({'path':rel,'code':'UNREADABLE'}); continue
                    entries.append(dict(name=name,path=rel,parent=relative,type=kind,size=size,modified=modified))
                    scan['folders' if kind == 'directory' else 'files']+=1
                    if kind == 'directory':
                        if depth+1>=max_depth: partial=True; scan['errors'].append({'path':rel,'code':'DEPTH_LIMIT'})
                        else: pending.append((rel,depth+1))
                    else: scan['bytes']+=size
        except (OSError,ValueError):
            partial=True; scan['errors'].append({'path':relative,'code':'UNREADABLE'})
    scan.update(state='cancelled' if cancel.is_set() else 'partial' if partial else 'complete',complete=not partial,finished_at=time.time())
    if partial and not scan['errors'] and not scan['skipped_links'] and not cancel.is_set(): scan['errors'].append({'path':'','code':'SCAN_BUDGET'})
    return entries,scan
