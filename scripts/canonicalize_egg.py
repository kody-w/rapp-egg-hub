#!/usr/bin/env python3
"""canonicalize_egg.py — migrate a legacy .egg to the rapp-rappid-spec/2.0 rappid standard.

Rewrites the egg's repo/rappid.json + manifest.json so the rappid becomes the canonical
`rappid:<birth-slug>:<hex>` form and reserves the eternity-grade ownership fields.

Migration is LOSSLESS for identity: the underlying hash bits never change.
  - legacy UUID (0d51f2b3-7c2c-...) -> strip dashes = 32hex, prefix slug, keep in _migrated_from
  - legacy rappid:v2:...:HEX@host    -> extract HEX, prefix slug
  - legacy rappid:<hex>              -> prefix slug
Legacy twins are GRANDFATHERED at their original 128-bit hash (a UUID has only 128 bits of
entropy — we cannot fabricate 256). NEW twins mint at full 256-bit. Both are valid; the
record documents which via `hash_bits`.

Reserved ownership fields are added empty (filled progressively): pubkey, sig_suite,
birth_attestation, key_succession, registry_anchor.

Usage: python3 scripts/canonicalize_egg.py eggs/<slug>.egg   (rewrites in place; .bak kept)
"""
import io
import json
import os
import re
import sys
import zipfile

PREFIX = "rappid:"


def sluggify(name):
    s = re.sub(r"[^a-z0-9_-]+", "-", (name or "").lower()).strip("-")
    return s or "twin"


def hash_of(rappid):
    if not rappid:
        return ""
    if rappid.startswith(PREFIX):
        body = rappid[len(PREFIX):]
        if ":" in body:
            tail = body.rsplit(":", 1)[1]
            m = re.match(r"^([a-f0-9]{32,64})", tail)
            if m:
                return m.group(1)
            m = re.search(r"([a-f0-9]{32})@", body)
            if m:
                return m.group(1)
        m = re.match(r"^([a-f0-9]{32,64})$", body)
        if m:
            return m.group(1)
    bare = rappid.replace("-", "")
    return bare if re.match(r"^[a-f0-9]{32,64}$", bare) else ""


def canonical(rappid, slug):
    h = hash_of(rappid)
    if not h:
        return rappid  # unknown form; leave untouched
    return f"{PREFIX}{sluggify(slug)}:{h}"


def migrate_record(rj):
    """Migrate a rappid.json dict in place; return (changed, notes)."""
    notes = []
    name = rj.get("name") or "twin"
    old = rj.get("rappid") or rj.get("rappid_uuid") or ""
    new = canonical(old, name)
    if new != old:
        rj["rappid"] = new
        rj.setdefault("_migrated_from", old)
        notes.append(f"rappid {old} -> {new}")
    rj.pop("rappid_uuid", None)
    # parent
    par = rj.get("parent_rappid") or rj.get("parent_rappid_uuid") or ""
    if par:
        # parent slug unknown here; keep its hash, mark parent slug as 'parent' if none
        ph = hash_of(par)
        if ph and not par.startswith(PREFIX + sluggify("")):
            # only re-shape if it's a bare/uuid/v2 form
            if re.match(r"^rappid:[a-z0-9-]+:[a-f0-9]{32,64}$", par) is None:
                rj["parent_rappid"] = f"{PREFIX}parent:{ph}"
                rj.setdefault("_parent_migrated_from", par)
                notes.append("parent re-shaped")
    rj.pop("parent_rappid_uuid", None)
    # record hash width + grandfather note
    rj["hash_bits"] = len(hash_of(new)) * 4
    if rj["hash_bits"] < 256:
        rj.setdefault("_note_hash", "Grandfathered legacy 128-bit identity (pre-2.0). New twins mint 256-bit.")
    # reserve eternity-grade ownership fields (empty = filled progressively)
    rj.setdefault("display_name", name.replace("-", " ").title())
    rj.setdefault("haiku", rj.get("haiku", ""))
    for fld, default in (("pubkey", ""), ("sig_suite", "none"),
                          ("birth_attestation", None), ("key_succession", []),
                          ("registry_anchor", None)):
        rj.setdefault(fld, default)
    rj["schema"] = "rapp/1"
    return notes


def main():
    if len(sys.argv) < 2:
        print("usage: canonicalize_egg.py <egg>"); sys.exit(1)
    egg = sys.argv[1]
    blob = open(egg, "rb").read()
    zin = zipfile.ZipFile(io.BytesIO(blob))
    items = {n: zin.read(n) for n in zin.namelist() if not n.endswith("/")}

    notes = []
    if "repo/rappid.json" in items:
        rj = json.loads(items["repo/rappid.json"])
        notes += migrate_record(rj)
        items["repo/rappid.json"] = (json.dumps(rj, indent=2) + "\n").encode()
        new_rappid = rj["rappid"]
        slug = sluggify(rj.get("name"))
    else:
        print("no repo/rappid.json — skipping"); sys.exit(1)

    if "manifest.json" in items:
        man = json.loads(items["manifest.json"])
        srcm = man.setdefault("source", {})
        srcm["rappid"] = new_rappid
        srcm.pop("rappid_uuid", None)
        if "parent_rappid_uuid" in srcm:
            srcm["parent_rappid"] = f"rappid:parent:{hash_of(srcm.pop('parent_rappid_uuid'))}"
        srcm.setdefault("name", slug)
        srcm.setdefault("kind", json.loads(items['repo/rappid.json']).get("kind", "twin"))
        srcm.setdefault("haiku", json.loads(items['repo/rappid.json']).get("haiku", ""))
        man["_spec"] = "rapp-rappid-spec/2.0"
        items["manifest.json"] = (json.dumps(man, indent=2) + "\n").encode()

    # backup + repack (drop any banned secret files defensively)
    BANNED = {".lineage_key", ".copilot_token", ".copilot_session", ".env", ".env.local"}
    os.rename(egg, egg + ".bak")
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for n, data in items.items():
            if os.path.basename(n) in BANNED:
                notes.append(f"DROPPED banned file {n}")
                continue
            z.writestr(n, data)
    open(egg, "wb").write(buf.getvalue())
    print(f"canonicalized {egg}: {new_rappid}")
    for nt in notes:
        print("   -", nt)


if __name__ == "__main__":
    main()
