"""Preserve the Android Git history and exact tracked/untracked working files."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import subprocess
import zipfile
from datetime import datetime, timezone


def git(source, *args):
    return subprocess.run(["git", "-C", str(source), *args], check=True,
                          stdout=subprocess.PIPE).stdout


def snapshot(source, output):
    output.mkdir(parents=True, exist_ok=False)
    head = git(source, "rev-parse", "HEAD").decode().strip()
    branch = git(source, "branch", "--show-current").decode().strip()
    names = sorted(set(filter(None, git(source, "ls-files", "-z", "--cached",
                                       "--others", "--exclude-standard").decode("utf-8").split("\0"))))
    git(source, "bundle", "create", str(output / "history.bundle"), "--all")
    (output / "working-tree.patch").write_bytes(git(source, "diff", "--binary", "HEAD"))
    (output / "index.patch").write_bytes(git(source, "diff", "--binary", "--cached"))
    (output / "status.txt").write_bytes(git(source, "status", "--short", "--untracked-files=all"))
    entries = []
    with zipfile.ZipFile(output / "working-files.zip", "w", zipfile.ZIP_DEFLATED,
                         compresslevel=3, allowZip64=True) as archive:
        for name in names:
            file = source / name
            if file.is_symlink():
                target = os.readlink(file)
                info = zipfile.ZipInfo(name)
                info.create_system = 3
                info.external_attr = 0o120777 << 16
                archive.writestr(info, target.encode("utf-8"))
                entries.append({"path": name, "symlink": target})
            elif file.is_file():
                digest = hashlib.sha256()
                with file.open("rb") as stream:
                    for block in iter(lambda: stream.read(1024 * 1024), b""):
                        digest.update(block)
                archive.write(file, name)
                entries.append({"path": name, "bytes": file.stat().st_size,
                                "sha256": digest.hexdigest()})
            else:
                entries.append({"path": name, "deleted": True})
    # Reports are evidence, not source; retain the latest report when present.
    report = source / "build/compatibility-verification/report.json"
    if report.is_file():
        (output / "previous-verification-report.json").write_bytes(report.read_bytes())
    manifest = {"schemaVersion": 1, "createdAt": datetime.now(timezone.utc).isoformat(),
                "source": str(source), "head": head, "branch": branch,
                "fileCount": len(entries), "files": entries,
                "restore": "Clone history.bundle, checkout recorded head, apply deleted entries, then extract working-files.zip; use index.patch to restore staging separately."}
    (output / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
                                           encoding="utf-8")
    print(json.dumps({"output": str(output), "head": head, "branch": branch,
                      "fileCount": len(entries), "archiveBytes": (output / "working-files.zip").stat().st_size}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    snapshot(args.source.resolve(), args.output.resolve())
