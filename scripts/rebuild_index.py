"""rebuild_index.py — regenerate index.json from the eggs/ directory.

Walks every *.egg under eggs/, recomputes sha256, parses the inner
manifest.json, merges with the matching <slug>.json sidecar (if present),
and writes a fresh index.json at the repo root.

Run locally:
    python3 scripts/rebuild_index.py

Run in CI: see .github/workflows/rebuild-index.yml — fires on push to
main when anything under eggs/ changes, regenerates index.json,
commits + pushes back if it differs from what's on disk.
"""

import hashlib
import io
import json
import pathlib
import sys
import time
import zipfile


HUB_ROOT = pathlib.Path(__file__).resolve().parent.parent
EGGS_DIR = HUB_ROOT / "eggs"
INDEX_PATH = HUB_ROOT / "index.json"

RAW_BASE = "https://raw.githubusercontent.com/kody-w/rapp-egg-hub/main"


def read_inner_manifest(blob: bytes) -> dict:
    try:
        with zipfile.ZipFile(io.BytesIO(blob)) as z:
            return json.loads(z.read("manifest.json"))
    except Exception:
        return {}


def derive_entry(egg_path: pathlib.Path) -> dict:
    """Build a sidecar-shaped dict from an .egg file + its (optional) sidecar."""
    blob = egg_path.read_bytes()
    sha = hashlib.sha256(blob).hexdigest()
    inner = read_inner_manifest(blob)
    src = inner.get("source") or {}
    slug = egg_path.stem  # filename without .egg

    sidecar_path = egg_path.with_suffix(".json")
    sidecar = {}
    if sidecar_path.exists():
        try:
            sidecar = json.loads(sidecar_path.read_text())
        except json.JSONDecodeError:
            print(f"[rebuild] WARN: malformed sidecar {sidecar_path}", file=sys.stderr)

    # The consolidated Eternity rappid (Art. XXXIV.1) is rappid:@<owner>/<slug>:<hex>;
    # the location-less self-describing form rappid:<slug>:<hex> is also accepted. In
    # both the hash is the final colon-delimited segment. Pull it from the egg manifest
    # source.rappid; tolerate a legacy rappid_uuid sidecar during migration.
    rappid = (src.get("rappid") or sidecar.get("rappid")
              or sidecar.get("rappid_uuid") or inner.get("rappid"))
    hexpart = ""
    if rappid:
        m = rappid.rsplit(":", 1)
        hexpart = m[1] if len(m) > 1 else rappid
    twin_html = f"twins/{slug}.html"
    has_twin = (HUB_ROOT / twin_html).exists()

    # Sidecar wins for human-curated fields; egg manifest fills technical defaults.
    entry = {
        "schema": "rapp-egg-hub-entry/2.0",
        "slug": sidecar.get("slug") or slug,
        "rappid": rappid,
        "hash_bits": len(hexpart) * 4 if hexpart else None,
        "name": sidecar.get("name") or src.get("name") or slug,
        "display_name": sidecar.get("display_name") or sidecar.get("name") or src.get("name") or slug,
        "kind": sidecar.get("kind") or src.get("kind"),
        "haiku": sidecar.get("haiku") or src.get("haiku") or "",
        "description": sidecar.get("description") or "",
        "tags": sidecar.get("tags") or [],
        "egg_schema": inner.get("schema") or sidecar.get("egg_schema"),
        "size_bytes": len(blob),
        "sha256": sha,
        "packed_by": sidecar.get("packed_by") or "(unknown)",
        "packed_at": sidecar.get("packed_at") or inner.get("exported_at"),
        # the .html twin is the PRIMARY share artifact (the .html IS the twin); .egg kept raw
        "twin_html": twin_html if has_twin else None,
        "twin_url": f"{RAW_BASE}/{twin_html}" if has_twin else None,
        "egg_path": f"eggs/{egg_path.name}",
        "raw_url": f"{RAW_BASE}/eggs/{egg_path.name}",
        "lineage": sidecar.get("lineage") or {
            "parent_rappid": src.get("parent_rappid"),
            "parent_repo": src.get("repo"),
        },
    }

    # Phase-1 attestation note: integrity verification = sha256 in this
    # entry. Phase 2 will add a publisher signature; the inner egg
    # manifest already carries an `attestation` slot for that.
    if inner.get("attestation"):
        entry["attestation"] = inner["attestation"]

    return entry


def main() -> int:
    if not EGGS_DIR.is_dir():
        print(f"[rebuild] no eggs/ directory at {EGGS_DIR}", file=sys.stderr)
        return 1

    eggs = sorted(EGGS_DIR.glob("*.egg"))
    entries = []
    for egg in eggs:
        try:
            entries.append(derive_entry(egg))
            print(f"[rebuild] indexed {egg.name} ({entries[-1]['size_bytes']} B, {entries[-1]['sha256'][:12]}…)")
        except Exception as e:
            print(f"[rebuild] FAIL on {egg.name}: {e}", file=sys.stderr)

    catalog = {
        "schema": "rapp-egg-hub/2.0",
        "spec": "rapp-rappid-spec/2.0",
        "name": "rapp-egg-hub",
        "description": "Public hub for digital twins. Each twin ships as a single-file .html (open in a browser, click Get, drop the agent into your RAPP brainstem) with the raw .egg also available for the Twin agent.",
        "homepage": "https://kody-w.github.io/rapp-egg-hub/",
        "raw_base": RAW_BASE,
        "updated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "egg_count": len(entries),
        "eggs": entries,
    }

    new_text = json.dumps(catalog, indent=2) + "\n"
    if INDEX_PATH.exists() and INDEX_PATH.read_text() == new_text:
        print(f"[rebuild] index.json already up to date ({len(entries)} eggs)")
        return 0
    INDEX_PATH.write_text(new_text)
    print(f"[rebuild] wrote {INDEX_PATH} ({len(entries)} eggs)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
