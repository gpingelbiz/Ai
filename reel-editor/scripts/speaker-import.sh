#!/bin/bash
# ZIP64 is handled by Python's standard library; each selected file streams to disk.
# SPEAKER_PYTHON and SPEAKER_CURL can select installed binaries; no packages required.
set -euo pipefail
exec "${SPEAKER_PYTHON:-python3}" - "$@" <<'PY'
import argparse
import datetime
import fnmatch
import hashlib
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import stat
import subprocess
import sys
import urllib.parse
import zipfile

parser = argparse.ArgumentParser(description='Import original speaker footage and proof from a Dropbox folder ZIP or a local ZIP.')
parser.add_argument('link')
parser.add_argument('client')
parser.add_argument('--include', action='append', default=[])
parser.add_argument('--exclude', action='append', default=[])
parser.add_argument('--dry-run', action='store_true')
parser.add_argument('--delete-zip', action='store_true')
args = parser.parse_args()
client = Path(args.client).expanduser().resolve()

def log(message):
    print(datetime.datetime.now().astimezone().isoformat(timespec='seconds') + ' ' + message, flush=True)

try:
    url = urllib.parse.urlsplit(args.link)
    if url.scheme in ('http', 'https'):
        if url.hostname not in ('dropbox.com', 'www.dropbox.com', 'dl.dropboxusercontent.com'):
            raise ValueError('Expected a Dropbox shared folder link (or a local ZIP path).')
        query = [(k, v) for k, v in urllib.parse.parse_qsl(url.query, keep_blank_values=True) if k != 'dl']
        query.append(('dl', '1'))
        download = urllib.parse.urlunsplit((url.scheme, url.netloc, url.path, urllib.parse.urlencode(query), ''))
        archive = client / 'work' / 'imports' / (hashlib.sha256(download.encode()).hexdigest()[:16] + '.zip')
        if not archive.exists():
            if args.dry_run:
                print('Would download Dropbox folder ZIP with dl=1, follow redirects, and retry from byte zero up to 3 times.')
                print('Would keep ZIP at ' + str(archive) + '; list and stream selected files into footage/ and proof/.')
                sys.exit(0)
            archive.parent.mkdir(parents=True, exist_ok=True)
            partial = archive.with_suffix('.zip.part')
            for attempt in range(1, 4):
                # Never resume a Dropbox folder ZIP. Every attempt truncates the partial file.
                with partial.open('wb'):
                    pass
                result = subprocess.run([os.environ.get('SPEAKER_CURL', 'curl'), '--location', '--fail', '--silent', '--show-error', '--output', str(partial), download])
                received = partial.stat().st_size
                log('download attempt %d: %d bytes received%s' % (attempt, received, '' if result.returncode == 0 else ' (failed; restart from zero)'))
                if result.returncode == 0 and zipfile.is_zipfile(partial):
                    partial.replace(archive)
                    break
                if attempt == 3:
                    raise ValueError('Dropbox folder download failed after 3 attempts; partial ZIP kept at ' + str(partial))
        else:
            log('using retained ZIP ' + str(archive))
    elif url.scheme == 'file':
        if url.netloc not in ('', 'localhost'):
            raise ValueError('file:// must name a local ZIP.')
        archive = Path(urllib.parse.unquote(url.path)).expanduser().resolve()
    elif not url.scheme:
        archive = Path(args.link).expanduser().resolve()
    else:
        raise ValueError('Expected a Dropbox folder link, file:// URL or local ZIP path.')
    if not archive.is_file():
        raise ValueError('ZIP not found: ' + str(archive))
    video_audio = set('.mp4 .mov .m4v .mkv .avi .webm .mts .m2ts .mpg .mpeg .mp3 .wav .m4a .aac .aif .aiff .flac .ogg .wma'.split())
    images = set('.png .jpg .jpeg .heic .heif .webp .tif .tiff .gif .svg'.split())
    raw = {'.cr2', '.cr3', '.arw', '.dng', '.nef', '.raf', '.rw2', '.orf'}
    totals = {'footage': [0, 0], 'proof/testimonials': [0, 0], 'proof/logos': [0, 0], 'proof/press': [0, 0], 'proof/photos': [0, 0]}
    skipped = {}
    selected = set()
    def skip(reason, name):
        skipped[reason] = skipped.get(reason, 0) + 1
        print('skip (%s): %s' % (reason, name))
    def matches(patterns, name):
        return any(fnmatch.fnmatchcase(name, pattern) or fnmatch.fnmatchcase(PurePosixPath(name).name, pattern) for pattern in patterns)
    def destination(parts):
        # Folder or filename labels outrank media type: a testimonial movie is proof.
        for prefix, bucket in [('testimonial', 'testimonials'), ('logo', 'logos'), ('press', 'press'), ('screenshot', 'press'), ('photo', 'photos')]:
            for i, part in enumerate(parts):
                if part.lower().startswith(prefix):
                    # Replace only exact category folder names; keep event/client folders and descriptive names.
                    exact = part.lower() in (prefix, prefix + 's', 'photos', 'testimonials', 'logos', 'screenshots')
                    keep = parts[:i] + parts[i + 1:] if i < len(parts) - 1 and exact else parts
                    return 'proof/' + bucket, keep
        ext = PurePosixPath(parts[-1]).suffix.lower()
        if ext in video_audio:
            return 'footage', parts
        if ext in images:
            return 'proof/photos', parts
        return None, parts
    with zipfile.ZipFile(archive, allowZip64=True) as z:
        # Listing and validation happen before any extraction. Central-directory metadata stays small
        # even when individual videos are tens of gigabytes; payloads are never loaded into memory.
        entries = []
        for info in z.infolist():
            name = info.filename
            print('zip: %s (%d bytes)' % (name, info.file_size))
            if info.is_dir():
                continue
            parts = list(PurePosixPath(name).parts)
            if not parts or name.startswith(('/', '\\')) or '\\' in name or '..' in parts or re.match(r'^[A-Za-z]:', name) or any(ord(c) < 32 for c in name):
                raise ValueError('Unsafe ZIP entry: ' + repr(name))
            if stat.S_ISLNK(info.external_attr >> 16):
                skip('symlink', name); continue
            if any(p.startswith('.') or p == '__MACOSX' for p in parts) or PurePosixPath(name).suffix.lower() in raw:
                skip('raw still or macOS junk', name); continue
            if args.include and not matches(args.include, name) or matches(args.exclude, name):
                skip('filter', name); continue
            bucket, rel = destination(parts)
            if not bucket:
                skip('unsupported type', name); continue
            target = client / bucket / Path(*rel)
            # Reject existing symlink parents before even making directories.
            if any(p.is_symlink() for p in [target, *target.parents] if p != client.parent):
                raise ValueError('Refusing symlink destination: ' + str(target))
            target.resolve().relative_to(client)
            if target in selected:
                raise ValueError('ZIP entries collide at ' + str(target))
            selected.add(target)
            if target.exists():
                skip('already exists (kept original)', name); continue
            entries.append((info, target, bucket))
        for info, target, bucket in entries:
            print(('%s: ' % ('would extract' if args.dry_run else 'extract')) + str(target))
            if not args.dry_run:
                target.parent.mkdir(parents=True, exist_ok=True)
                # Stage next to the destination so completion can be linked atomically without
                # replacing an original or exposing a truncated movie to the watcher.
                staged = target.with_name('.' + target.name + '.speaker-import.part')
                with staged.open('xb') as output, z.open(info) as source:
                    shutil.copyfileobj(source, output, length=8 * 1024 * 1024)
                os.link(staged, target)  # fails safely if an original appeared during extraction
                staged.unlink()
            totals[bucket][0] += 1
            totals[bucket][1] += info.file_size
    print('Import summary%s:' % (' (dry run)' if args.dry_run else ''))
    for bucket, (count, size) in totals.items():
        print('  %s: %d files, %.3f GB' % (bucket, count, size / 1_000_000_000))
    print('  skipped: %d%s' % (sum(skipped.values()), ' (' + ', '.join('%s: %d' % item for item in sorted(skipped.items())) + ')' if skipped else ''))
    if args.delete_zip and not args.dry_run:
        archive.unlink()
        print('Deleted ZIP (--delete-zip): ' + str(archive))
    else:
        print('ZIP kept: ' + str(archive))
except (OSError, ValueError, zipfile.BadZipFile, RuntimeError) as error:
    print('speaker-import: ' + str(error), file=sys.stderr)
    sys.exit(1)
PY
