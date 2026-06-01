#!/usr/bin/env python3
"""
pii_gate.py — Pre-publish PII & secrets safety gate for rapp-egg-hub.

Enforces SPEC §12 (HARD RULE: NO PII anywhere in the public repo or any egg).
This gate MUST run and PASS before any publish, release, or PR merge. It is the
last line of defense against a leaked .lineage_key (the private germline whose
possession forges an entire lineage), a leaked .copilot_token/.env, or any
named-person data ending up in a shareable artifact.

What it scans (pure stdlib, no deps):
  - eggs/*.egg     : zip archives. Unzipped in memory; every text entry scanned.
                     Banned filenames inside the archive are a hard failure.
  - twins/*.html   : the PRIMARY share artifact. We scan BOTH the visible HTML
                     and the egg baked in as base64 (decoded + unzipped in
                     memory and scanned like any other egg).
  - *.json / *.md  : loose repo files (e.g. rappid.json records, READMEs).

What it detects:
  - Emails (allowlisted: noreply@, *@rapp*, *@microsoft.com, *@example.com,
    git@github.com).
  - Phone numbers, US SSNs.
  - Generic secrets: api_key / secret / token / bearer / password = <value>.
  - GitHub tokens: gho_ / ghp_ / ghs_ / github_pat_.
  - BANNED FILENAMES inside eggs: .lineage_key, .copilot_token,
    .copilot_session, .env, .env.local.

False-positive avoidance:
  - ISO dates (YYYY-MM-DD) are NOT treated as SSNs/phones.
  - 64-hex rappid hashes and bare code identifiers are NOT treated as secrets.

Exit codes:
  0 = PII GATE: PASS (nothing found)
  1 = PII GATE: FAIL (one or more findings) — blocks publish in CI.

Usage:
  python3 scripts/pii_gate.py [REPO_ROOT]   # defaults to repo root above scripts/
"""

import base64
import glob
import io
import json  # noqa: F401  (reserved for record-aware scanning; kept per spec)
import os
import re
import sys
import zipfile

# --------------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------------- #

# Filenames that must NEVER appear inside an egg. A leaked .lineage_key forges
# the entire lineage; the rest are local-only auth/secret material.
BANNED_FILENAMES = {
    ".lineage_key",
    ".copilot_token",
    ".copilot_session",
    ".env",
    ".env.local",
}

# Text-ish extensions we will read & scan when found inside an egg archive.
TEXT_EXTENSIONS = {
    ".py", ".md", ".json", ".txt", ".html", ".htm", ".js", ".css",
    ".yaml", ".yml", ".toml", ".ini", ".cfg", ".csv", ".sh", ".ps1",
    ".xml", ".rst", ".log", "",  # "" = extensionless (e.g. soul, README)
}

# Max bytes of any single archive entry we will load into memory & scan.
MAX_ENTRY_BYTES = 8 * 1024 * 1024  # 8 MiB

# --------------------------------------------------------------------------- #
# Detection patterns
# --------------------------------------------------------------------------- #

EMAIL_RE = re.compile(
    r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b"
)

# Allowlisted email patterns (these are NOT findings).
EMAIL_ALLOW = [
    re.compile(r"^noreply@", re.IGNORECASE),
    re.compile(r"@rapp", re.IGNORECASE),            # *@rapp, *@rapp.dev, etc.
    re.compile(r"@microsoft\.com$", re.IGNORECASE),
    re.compile(r"@example\.com$", re.IGNORECASE),
    re.compile(r"^git@github\.com$", re.IGNORECASE),
    # rappid lineage origins look like <32-64 hex>@github.com — that's an identity
    # anchor (the species/parent rappid), NOT a person's email. Not a finding.
    re.compile(r"^[0-9a-f]{32,64}@github\.com$", re.IGNORECASE),
]

# US-style phone numbers: +1 (555) 123-4567 / 555-123-4567 / 5551234567.
# Requires separators or a leading + to avoid matching arbitrary 10-digit ids.
PHONE_RE = re.compile(
    r"(?<!\d)"
    r"(?:\+?1[\s.\-]?)?"
    r"(?:\(\d{3}\)|\d{3})[\s.\-]"
    r"\d{3}[\s.\-]\d{4}"
    r"(?!\d)"
)

# US SSN: 123-45-6789. Hyphenated form only — avoids clashing with ISO dates
# and 9-digit identifiers.
SSN_RE = re.compile(r"(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)")

# ISO date (YYYY-MM-DD) — explicitly allowed; used to filter false positives.
ISO_DATE_RE = re.compile(r"(?<!\d)\d{4}-\d{2}-\d{2}(?!\d)")

# Generic secret assignment: api_key/secret/token/bearer/password = "value".
# Requires a value of >= 8 chars to skip empty/placeholder fields.
SECRET_RE = re.compile(
    r"""(?ix)
    \b(api[_-]?key|secret|token|bearer|password|passwd|pwd)\b
    \s*[:=]\s*
    ['"]?
    ([^\s'"]{8,})
    ['"]?
    """,
)

# Values that are obviously NOT real secrets (placeholders / reserved fields).
SECRET_VALUE_ALLOW = re.compile(
    r"^(?:"
    r"none|null|nil|true|false|"
    r"changeme|change_me|placeholder|example|todo|xxx+|"
    r"your[_-].*|<.*>|\$\{.*\}|"
    r"\.{3,}|-+|_+"
    r")$",
    re.IGNORECASE,
)

# GitHub tokens (and PATs). These are always findings.
GH_TOKEN_RE = re.compile(r"\b(?:gho|ghp|ghs|ghu|ghr)_[A-Za-z0-9]{20,}\b")
GH_PAT_RE = re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}\b")

# A 64-hex rappid hash (or other long hex blob). NOT a secret — used to filter
# SECRET_RE false positives where the "value" is just a hash.
HEX_BLOB_RE = re.compile(r"^[0-9a-fA-F]{32,}$")

# --------------------------------------------------------------------------- #
# Scanning core
# --------------------------------------------------------------------------- #


def _is_allowed_email(addr):
    return any(p.search(addr) for p in EMAIL_ALLOW)


def _mask(value, keep=4):
    """Mask a sensitive value so the report never re-leaks it."""
    if len(value) <= keep:
        return "*" * len(value)
    return value[:keep] + "*" * (len(value) - keep)


def scan_text(text, location):
    """Scan a blob of text. Return a list of (severity, message) findings."""
    findings = []

    # Pre-compute spans occupied by ISO dates so SSN/phone don't match them.
    iso_spans = [m.span() for m in ISO_DATE_RE.finditer(text)]

    def _overlaps_iso(span):
        s, e = span
        return any(not (e <= a or s >= b) for (a, b) in iso_spans)

    # Emails (minus allowlist).
    for m in EMAIL_RE.finditer(text):
        addr = m.group(0)
        if not _is_allowed_email(addr):
            findings.append(("EMAIL", "email address: %s" % addr))

    # SSNs.
    for m in SSN_RE.finditer(text):
        if not _overlaps_iso(m.span()):
            findings.append(("SSN", "possible SSN: %s" % _mask(m.group(0), 0)))

    # Phone numbers.
    for m in PHONE_RE.finditer(text):
        if not _overlaps_iso(m.span()):
            findings.append(("PHONE", "possible phone number: %s" % m.group(0)))

    # GitHub tokens / PATs.
    for m in GH_TOKEN_RE.finditer(text):
        findings.append(("GH_TOKEN", "GitHub token: %s" % _mask(m.group(0), 8)))
    for m in GH_PAT_RE.finditer(text):
        findings.append(("GH_TOKEN", "GitHub PAT: %s" % _mask(m.group(0), 12)))

    # Generic secret assignments.
    for m in SECRET_RE.finditer(text):
        key, value = m.group(1), m.group(2)
        if SECRET_VALUE_ALLOW.match(value):
            continue
        if HEX_BLOB_RE.match(value):
            # 64-hex rappid hash etc. — authoritative public data, not a secret.
            continue
        findings.append(
            ("SECRET", "secret-like assignment '%s' = %s" % (key, _mask(value)))
        )

    return [(sev, "%s :: %s" % (location, msg)) for sev, msg in findings]


def _is_text_entry(name):
    _, ext = os.path.splitext(name)
    return ext.lower() in TEXT_EXTENSIONS


def scan_egg_bytes(egg_bytes, label):
    """Scan a single egg (zip) given as raw bytes. Returns list of findings."""
    findings = []
    try:
        zf = zipfile.ZipFile(io.BytesIO(egg_bytes))
    except zipfile.BadZipFile:
        # Not a zip — some eggs are JSON-format (e.g. .network.egg neighborhood
        # organisms). Scan the raw bytes as text rather than failing the gate.
        try:
            txt = egg_bytes.decode("utf-8", "ignore")
            return scan_text(txt, label)
        except Exception:
            return [("MALFORMED", "%s :: unreadable egg (neither zip nor text)" % label)]

    for info in zf.infolist():
        if info.is_dir():
            continue
        entry = info.filename
        base = os.path.basename(entry)

        # Banned-filename check (hard failure regardless of content).
        if base in BANNED_FILENAMES:
            findings.append(
                ("BANNED_FILE",
                 "%s :: BANNED FILE inside egg: %s" % (label, entry))
            )
            # Still attempt to scan its contents below for extra signal.

        if info.file_size > MAX_ENTRY_BYTES:
            continue
        if not _is_text_entry(entry):
            continue

        try:
            raw = zf.read(info)
        except Exception as exc:  # corrupt member, encrypted, etc.
            findings.append(
                ("UNREADABLE",
                 "%s :: could not read entry %s (%s)" % (label, entry, exc))
            )
            continue

        try:
            text = raw.decode("utf-8")
        except UnicodeDecodeError:
            text = raw.decode("latin-1", errors="replace")

        findings.extend(scan_text(text, "%s!%s" % (label, entry)))

    return findings


# Embedded base64 egg inside a twin .html. We look for a long base64 run that
# decodes to a zip (PK\x03\x04 magic). The .html bakes the egg in as base64.
B64_RUN_RE = re.compile(r"[A-Za-z0-9+/=]{256,}")


def _extract_embedded_eggs(html_text):
    """Yield raw bytes for every base64 blob in the HTML that is a valid zip."""
    eggs = []
    for m in B64_RUN_RE.finditer(html_text):
        blob = m.group(0)
        # base64 length must be a multiple of 4; trim stray chars defensively.
        trimmed = blob[: len(blob) - (len(blob) % 4)]
        try:
            decoded = base64.b64decode(trimmed, validate=True)
        except Exception:
            continue
        if decoded[:4] == b"PK\x03\x04":  # zip local-file header == an egg
            eggs.append(decoded)
    return eggs


def scan_twin_html(path):
    """Scan a twin .html: visible HTML text + every embedded base64 egg."""
    findings = []
    with open(path, "rb") as fh:
        raw = fh.read()
    try:
        html_text = raw.decode("utf-8")
    except UnicodeDecodeError:
        html_text = raw.decode("latin-1", errors="replace")

    # 1) Scan the visible HTML itself.
    findings.extend(scan_text(html_text, "%s (visible html)" % path))

    # 2) Decode & scan every embedded egg.
    embedded = _extract_embedded_eggs(html_text)
    if not embedded:
        # Not necessarily an error — but worth a note in the report.
        pass
    for idx, egg_bytes in enumerate(embedded):
        label = "%s (embedded egg #%d)" % (path, idx)
        findings.extend(scan_egg_bytes(egg_bytes, label))

    return findings


def scan_loose_file(path):
    """Scan a loose *.json / *.md file."""
    with open(path, "rb") as fh:
        raw = fh.read()
    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError:
        text = raw.decode("latin-1", errors="replace")
    return scan_text(text, path)


def scan_egg_file(path):
    """Scan an eggs/*.egg file from disk."""
    with open(path, "rb") as fh:
        return scan_egg_bytes(fh.read(), path)


# --------------------------------------------------------------------------- #
# Orchestration
# --------------------------------------------------------------------------- #


def _collect(root, *patterns):
    paths = []
    for pat in patterns:
        paths.extend(glob.glob(os.path.join(root, pat), recursive=True))
    return sorted(set(p for p in paths if os.path.isfile(p)))


def main(argv):
    if len(argv) > 1:
        root = os.path.abspath(argv[1])
    else:
        # scripts/ lives directly under the repo root.
        root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))

    print("PII GATE — enforcing SPEC §12 (no PII / secrets in public artifacts)")
    print("Repo root: %s" % root)
    print("-" * 72)

    eggs = _collect(root, "eggs/*.egg", "eggs/**/*.egg")
    twins = _collect(root, "twins/*.html", "twins/**/*.html")
    loose = _collect(root, "*.json", "*.md", "**/*.json", "**/*.md")

    # Don't double-scan twins as loose files (they're scanned specially).
    twin_set = set(twins)
    loose = [p for p in loose if p not in twin_set]

    # Per-artifact reporting.
    total_findings = []
    artifacts = (
        [("egg", p) for p in eggs]
        + [("twin", p) for p in twins]
        + [("loose", p) for p in loose]
    )

    if not artifacts:
        print("No artifacts found to scan (eggs/, twins/, loose *.json/*.md).")

    for kind, path in artifacts:
        rel = os.path.relpath(path, root)
        if kind == "egg":
            findings = scan_egg_file(path)
        elif kind == "twin":
            findings = scan_twin_html(path)
        else:
            findings = scan_loose_file(path)

        if findings:
            print("\n[FAIL] %s (%s) — %d finding(s):" % (rel, kind, len(findings)))
            for severity, msg in findings:
                print("    - %-12s %s" % (severity, msg))
            total_findings.extend(findings)
        else:
            print("[ ok ] %s (%s)" % (rel, kind))

    print("-" * 72)
    print("Scanned: %d egg(s), %d twin(s), %d loose file(s)."
          % (len(eggs), len(twins), len(loose)))

    if total_findings:
        print("\nPII GATE: FAIL — %d finding(s). Publish is BLOCKED."
              % len(total_findings))
        return 1

    print("\nPII GATE: PASS — no PII or secrets detected.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))