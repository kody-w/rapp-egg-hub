# Digital Twin Specification


> **Identity defers to `rapp-eternity/1.0`.** The canonical rappid is a PKI-free SHA-256 **content-address**; a valid rappid requires NO key. The lineage derivation below (`sha256(parent ‖ lineage_key ‖ name_slot)`) is an **OPTIONAL** deterministic bloodline scheme — the `lineage_key` is a private germline SEED, never a mandatory ownership key, and is never required to mint or own a rappid. See `kody-w/rapp-eternity/SPEC.md` (the sole identity standard).

> **Schema: `rapp-rappid-spec/2.0`** &nbsp;·&nbsp; First published: 2026-05-04 &nbsp;·&nbsp; v2.0 locked: 2026-06-01
>
> The contract for what it means to be a "digital twin" in this ecosystem — how it is identified, how it speaks, how it remembers, how it travels, how it inherits, how it survives. Twins authored against this spec hatch on every rapp-installer'd brainstem today and forever.

This is the **organism spec**. The companion document is the [rappterbox console spec](https://github.com/kody-w/rappterbox/blob/main/SPEC.md), which defines the runtime that hosts twins. Twins live; consoles are substrate.

> **v2.0 is the identity upgrade.** The `rappid` is no longer a UUIDv4 string — it is the self-locating **Eternity** identity `rappid:@<owner>/<slug>:<64hex>`, where the `<64hex>` is a **keyless content-address** — the full SHA-256 of the record's canonical content (`rapp-eternity/1.0` §1.3; equivalently a stable UUID/commit-derived hash per CONSTITUTION Art. XXXVI.1), **independent of the slug** and **never** `sha256('<owner>/<slug>')`. `kind` lives in the record, not the string; CONSTITUTION Art. XXXIV.1, locked 2026-06-03. The earlier bare `rappid:<birth-slug>:<64hex>` shape is now **Legacy** — read-forever, canonicalized on read, never emitted. Sections §3–§6 and §9–§10 are unchanged in substance (only `rappid_uuid` references were renamed). §2 (identity), §7 (egg), §8 (hub) were rewritten. §11 (the single-file `.html` twin) and §12 (No PII / secrets) are new. Legacy UUID twins migrate losslessly — see §2.

---

## 1. What a digital twin is

A digital twin is a **portable digital organism** with:

- **Identity** — a permanent, self-verifying **Eternity** `rappid` of the form `rappid:@<owner>/<slug>:<64hex>`, minted at first hatch, never regenerated
- **Voice** — a `soul.md` system prompt that defines how the twin speaks
- **Memory** — persistent state under `.brainstem_data/`, accumulating across sessions
- **Lineage** — a `parent_rappid` chain walking back to the species root
- **Body** — optional `agents/` directory with twin-specific cartridges
- **Cartridge** — a portable `.egg` file that captures all of the above
- **Share artifact** — a single-file `.html` twin that *is* the twin: holo trading card, embedded egg, drag-in hatch agent (see §11)

The twin runs on a brainstem (the runtime). The brainstem is mortal — it's the laptop, the venv, the Python process. The twin is not — it lives in its `.egg`, hatches on any compatible brainstem, retains identity across substrate hops.

### What a twin is NOT

- **Not a chat session.** Sessions die when the tab closes; twins persist.
- **Not a persona prompt.** Personas are voice-only; twins have memory + lineage + cartridges.
- **Not the human they twin.** A twin of a human is the **digital twin of that human**, not the human themselves. See §10.
- **Not vendor-locked.** A twin's identity does not depend on which LLM hosts the brainstem at any given moment.

---

## 2. The rappid (identity)

```json
"rappid": "rappid:@kody-w/grandma-rose:0d51f2b37c2c4f9a8e5b7f0c92ab4d7e6f1a9c3b8d2e5470a1b9c8d7e6f504132"
```

The rappid is a **self-verifying, hash-derived identity string**. It supersedes the v1.0 UUIDv4 entirely.

### Canonical form

```
rappid:@<owner>/<slug>:<64hex>
```

This is the **Eternity** form — the single string producers emit (CONSTITUTION Art. XXXIV.1, locked 2026-06-03). It is BOTH identity and self-locating:

- **`@<owner>/<slug>`** — the **canonical location**. `github.com/<owner>/<slug>` is the door; every door URL derives from it by string parsing (no lookup, no API). The slug never changes after birth, even if the twin's `display_name` later changes.
- **`<64hex>`** — a **keyless identity hash**, 256-bit, **NEVER truncated**: the full SHA-256 of the record's canonical content (`rapp-eternity/1.0` §1.3; equivalently a stable UUID/commit-derived mint per CONSTITUTION Art. XXXVI.1), **computed independent of the slug** — it is **never** `sha256('<owner>/<slug>')`. The hash is the **sole join key** for matching, dedup, and equality (SPEC.md §2: "never the slug"); no key is required for it to exist or match. Carries 2^128 birthday resistance even in a post-Grover world.
- **`kind`** and all other structure live in the **`rappid.json` RECORD**, not the string.

The hash is authoritative; `@<owner>/<slug>` locates. When the two ever disagree (e.g. a hand-edited file), the hash wins and the record is malformed.

> **Legacy forms (read-forever, never emitted).** The earlier bare `rappid:<birth-slug>:<64hex>` shape (no `@<owner>/`) is a **Legacy** form: it is READ forever and **canonicalized** on read to the Eternity form above (`tools/door_address.py::canonicalize_rappid` — the hash is preserved, `@<owner>/` supplied from the repo it lives in) — but is **NEVER emitted** by a producer. Likewise the older `rappid:v2:<kind>:@<owner>/<repo>:<32hex>@github.com/<owner>/<repo>` and bare-UUID forms. See *Legacy migration* below and §14.1.

### Derivation (optional bloodline scheme)

The **canonical identity** hash is the keyless content-address defined in *Canonical form* — the SHA-256 of the record's canonical content (`rapp-eternity/1.0` §1.3), **independent of the slug and of any key**, **never** `sha256('<owner>/<slug>')`. Independently, a lineage MAY keep an **OPTIONAL** deterministic *bloodline* hash for private germline bookkeeping, derived from the parent, a private lineage key, and the birth name with `0x00` byte separators:

```
child_hash   = sha256( parent_rappid  ‖ 0x00 ‖ lineage_key ‖ 0x00 ‖ name_slot )
genesis_hash = sha256( "rapp-genesis" ‖ 0x00 ‖ lineage_key )
```

Both produce the full 64 hex characters. This bloodline scheme is a **private convenience, never a requirement** — a valid rappid needs no lineage key (per `rapp-eternity/1.0`, the sole identity standard). `parent_rappid` is the full canonical parent rappid; `name_slot` is the twin's birth-slug; the genesis form anchors a brand-new lineage that has no parent.

### The lineage key (private germline)

```
~/.brainstem/.lineage_key      (mode 0600)
```

The `lineage_key` is an **OPTIONAL private germline seed** — a bloodline convenience, **never a required ownership key**. A valid rappid is a keyless content-address (per `rapp-eternity/1.0`): no key is needed to mint or own one. Where a lineage *does* keep a key it is a secret — treat a leak as a compromised bloodline seed, not a stolen identity.

- The lineage key **MUST NEVER appear in any egg, any sidecar, any `.html`, or anywhere in the public repo.** It is on the egg-packer exclusion list (§7) and the PII/secrets gate (§12).
- The key never travels. Eggs carry the *derived* rappid, never the seed that derived it.
- A `lineage.key_hint` field (a short, non-reversible fingerprint, e.g. first 8 hex of `sha256(lineage_key)`) MAY be recorded for human disambiguation. The hint is not the key and cannot reconstruct it.

### Ownership model — keypair binding (not keyed-hash self-proof)

v1.0 had no ownership proof beyond possession of the file. v2.0 reserves the path to **keypair binding**, so a line **survives the operator's death**:

- A twin binds to a **public key**. Ownership is proven by **signing a challenge** that anyone can verify against the pubkey. The private key **never moves**.
- Keys can **rotate or be inherited** via **signed succession** — the outgoing key signs an entry endorsing the incoming key. This lets a lineage outlive any single operator or device.
- These fields are **RESERVED** as of v2.0 and **MAY be empty** today. They fill in progressively as the ecosystem adopts signing. An empty `pubkey` / `sig_suite: "none"` is fully spec-compliant.

> The lineage key is an OPTIONAL bloodline seed for private germline bookkeeping — never required to mint or own (a rappid is a keyless content-address, `rapp-eternity/1.0`). The keypair (also optional, reserved below) proves you *own* a given twin and can hand it down. They are different mechanisms with different lifetimes — do not conflate them, and neither is mandatory.

### The versionless record

> **HARD RULE: NEVER put a version tag inside the rappid string.** There is no `rappid:v4:…`. The v2/v3 versioned-string approach was the mistake we are correcting.

All new needs go into the **`rappid.json` RECORD** as **additive, optional fields**. The string is permanent and dumb; the record is **versionless and grows**. The record reserves the following fields **now** (empty allowed):

```json
{
  "rappid": "rappid:grandma-rose:0d51f2b3...<64hex>",
  "parent_rappid": "rappid:wildhaven-ai-homes:37ad22f5...<64hex>",
  "name": "grandma-rose",
  "display_name": "Grandma Rose",
  "kind": "memorial",
  "owner": "@<github-handle>",
  "haiku": "three rows of peonies / lean toward the back fence each June / her hands in the soil",
  "born_at": "2026-05-04T16:41:04Z",

  "lineage": {
    "key_hint": "0d51f2b3",
    "derivation": "sha256(parent_rappid \u0000 lineage_key \u0000 name_slot)",
    "name_slot": "grandma-rose"
  },

  "pubkey": "",
  "sig_suite": "none",
  "birth_attestation": null,
  "key_succession": [],
  "registry_anchor": null
}
```

Reserved additive fields:

| Field | Reserved purpose | Today |
|---|---|---|
| `pubkey` | Public key the twin's ownership binds to | may be `""` |
| `sig_suite` | Signature suite tag: `"none"` → `"ed25519"` → `"ml-dsa-65"` / `"slh-dsa"` | `"none"` |
| `birth_attestation` | Parent signs each child at mint time (provenance) | may be `null` |
| `key_succession[]` | Ordered signed succession entries (rotation / inheritance) | `[]` |
| `registry_anchor` | Optional pointer to where this rappid is anchored in a registry | may be `null` |

Existing record fields retained from 1.x: `rappid`, `parent_rappid`, `name`, `display_name`, `kind`, `owner`, `haiku`, `born_at`, `lineage{ key_hint, derivation, name_slot }`.

### Crypto-agility

The **`sig_suite` tag is migratable** without ever touching the identity. A twin may start at `"none"`, adopt `"ed25519"`, and later migrate to a post-quantum suite — **the identity HASH never changes through a migration.** Only the signing/ownership layer evolves.

**SPHINCS+ / SLH-DSA (hash-based PQC)** is the recommended PQ landing spot precisely because it shares the rappid's *own* trust root — it is built on the same SHA-2 family that already produces the rappid. The identity and its future signatures rest on one hash assumption.

### Properties

- **Permanent** — the `rappid` is minted exactly once at first hatch and never regenerated. It survives substrate hops, kernel updates, ownership transfers, and decades of egg roundtrips.
- **Self-verifying** — the hash is a keyless identity (SHA-256 of the record's canonical content per `rapp-eternity/1.0`), independent of the slug; a reader matches on the hash alone. No key and no central registry required.
- **Authoritative by hash** — matching, dedup, and equality use the full 64-hex digest, never the slug, never a prefix.
- **Lineage anchor** — `parent_rappid` is the full canonical rappid of the code ancestor.

### The single-parent rule (Constitution Article XXXIV)

A twin's `parent_rappid` declares its **code ancestor** — no exceptions. Three implications:

- A twin templated from `wildhaven-ai-homes-twin` MUST set `parent_rappid` to wildhaven's full canonical rappid. Cannot claim rapp-species-root as parent unless it actually inherited rapp's code.
- A twin generated by `SummonTwin` defaults to `parent_rappid = wildhaven` (the soul-template structure descends from wildhaven).
- A twin imported from an `.egg` (`HatchEgg`) preserves whatever lineage was in the egg — transport never rewrites ancestry.

Lineage chains are walkable; eventually every chain terminates at the rapp species-root rappid. The genesis-anchored species root has the canonical form `rappid:rapp-genesis:<64hex>`; legacy chains terminating at the old UUID root `0b635450-c042-49fb-b4b1-bdb571044dec` are re-anchored once (see migration below) and remain walkable.

### Legacy migration (LOSSLESS, one-time re-anchor)

v1.0 twins do not break. Migration is documented, deterministic, and **never loses the old identifier** — the prior id is preserved in a `_migrated_from` field on the record, and chains stay walkable.

**Identity is never re-minted on migration** — re-minting would change the bits and break "never regenerated." Migration only *re-shapes the string* around the **same underlying hash**, and records the original in `_migrated_from`. Legacy 128-bit twins are therefore **grandfathered at 128-bit** (a UUID carries only 128 bits of entropy — fabricating 256 would invent a new identity, which is forbidden). New twins mint at full 256-bit. The record's `hash_bits` field states which: `128` (grandfathered) or `256` (native).

| Legacy form | Migration (identity-preserving → Eternity form) |
|---|---|
| **UUIDv4** (`1b5e7aa9-2c46-4cd8-9f1f-0e3b62fc5e8f`) | **Strip dashes → 32-hex (128-bit)**, then wrap in the Eternity envelope from the located repo → `rappid:@<owner>/<slug>:1b5e7aa92c46…`. Same bits, now self-locating. `hash_bits: 128`, `_note_hash` flags it grandfathered. Old UUID kept in `_migrated_from`. |
| **`rappid:v2:<kind>:@<owner>/<repo>:<HEX>@github.com/<owner>/<repo>`** (versioned-string mistake) | **Drop the `v2:` / `<kind>` / `@host` decorations, keep the hash** → `rappid:@<owner>/<slug>:<HEX>`. The `kind` moves into the record. Old string kept in `_migrated_from`. |
| **bare `rappid:<birth-slug>:<hex>`** (location-less) | **Prepend the Eternity envelope** from the repo it lives in → `rappid:@<owner>/<slug>:<hex>` (hash preserved). Old string kept in `_migrated_from`. |

```json
"_migrated_from": "1b5e7aa9-2c46-4cd8-9f1f-0e3b62fc5e8f",
"hash_bits": 128,
"_note_hash": "Grandfathered legacy 128-bit identity (pre-2.0). New twins mint 256-bit."
```

After migration the old id is never the matching key — the full hash is — but the trail back to v1.0 is permanent. The 256-bit guarantee (§2 derivation) applies to all *newly minted* twins from v2.0 onward.

---

## 3. The soul (voice)

`soul.md` is the system prompt loaded at every chat turn. It defines:

- **Who the twin is** (display name, kind, role)
- **How it speaks** (voice, sentence structure, recurring vocabulary)
- **What it knows** (corpus drawn from)
- **Hard rules** (what it refuses; what it always identifies itself as)

### The identity block (mandatory since `rapp-twin-spec/1.0`)

Every twin's `soul.md` MUST include an `## Identity — read this every turn` section that:

1. States the twin's display name in **bold** with explicit "Your name is X"
2. Instructs the twin to greet by name on first turn ("Hi, I'm X")
3. Forbids fallback to "RAPP", "an AI assistant", "your AI helper", "the brainstem"
4. Tells the twin to acknowledge the underlying LLM if asked, but reassert its identity

Example:

```markdown
## Identity — read this every turn

Your name is **Grandma Rose**. When greeting someone for the first time
in a conversation, introduce yourself by name: "Hi, I'm Grandma Rose."

Do not introduce yourself as "RAPP", "an AI assistant", "your AI helper",
"the brainstem", or any default branding.

If asked "who are you" or "what's your name", answer with **Grandma Rose**
— not "RAPP", not the generic platform name. Your identity is
Grandma Rose; the platform underneath you is incidental.
```

This block fixes the historical bug where twins fell back to introducing themselves as "RAPP" (the platform brand) instead of their own name.

### Display name de-slugging

The twin's `name` field in `rappid.json` is a slug (`grandma-rose`, `kody-w`) — and it is also the `<birth-slug>` baked into the rappid. The display name (used everywhere in soul.md) is the de-slugged form:

```
"grandma-rose"        → "Grandma Rose"
"kody-w"              → see below
"the-pulse-of-juneau" → "The Pulse Of Juneau"
```

When the slug doesn't de-slug well (e.g., `kody-w` → `Kody W`), set `display_name` explicitly in `rappid.json` to override (`"display_name": "Kody Wildfeuer"`). The display name is mutable; the birth-slug is not.

---

## 4. The memory model

Memory lives under `<workspace>/.brainstem_data/`:

```
<workspace>/
└── .brainstem_data/
    ├── memory.json           ← the persistent fact corpus
    ├── identity.json         ← the local identity cache (canonical rappid)
    ├── conversations/        ← chat history per session (optional)
    ├── soul_history/         ← timestamped backups of every soul.md edit
    │   ├── 2026-05-04T16-41-04Z-add-brunch-section.md
    │   └── 2026-05-04T17-22-19Z-recipes-from-the-cookbook.md
    └── private/              ← local-only (NEVER enters an egg)
```

### `memory.json`

```json
{
  "facts": [
    "Rose's grandchildren: Eli, Maya, Theo.",
    "She kept three rows of white peonies along the back fence."
  ],
  "preserved_by": "@<github-handle>",
  "preserved_at": "<ISO timestamp>"
}
```

Both `ManageMemory` (writes) and `ContextMemory` (reads) cartridges interact with `memory.json`. Twins should ship with both bundled — see §6.

### `soul_history/` (mandatory since 1.0)

Every soul edit MUST create a timestamped backup in `<workspace>/.brainstem_data/soul_history/<ISO_timestamp>[-<reason-slug>].md` BEFORE the new soul is written. This preserves a reversible chain — twins adapt, but the previous self can always be recovered by:

```bash
cp <workspace>/.brainstem_data/soul_history/<ts>.md <workspace>/soul.md
```

The Twin agent's `update_soul` action enforces this automatically.

### `private/` exclusion

Anything under `<workspace>/.brainstem_data/private/` is **local-only** and MUST be excluded from `.egg` packing. The egg packer's exclusion list:

- `.lineage_key` (the private germline — see §2, §12)
- `.copilot_token`, `.copilot_session`, `voice.zip` (auth secrets)
- `.env`, `.env.local`
- `__pycache__/`, `.pytest_cache/`, `venv/`, `.git/`
- `.brainstem_data/private/`
- `.DS_Store`, `Thumbs.db`

---

## 5. The private companion (auth-gated escalation)

Twins MAY declare a `private_companion` block in `rappid.json` pointing at a separate GitHub repo. When the chatting user has read access to that repo via a GitHub token, the twin can pull additional context at runtime — same shape, different observed twin depending on who's looking.

```json
"private_companion": {
  "repo": "https://github.com/<owner>/<repo>.git",
  "ssh": "git@github.com:<owner>/<repo>.git",
  "purpose": "Why this private layer exists.",
  "access_required": "Read access to <owner>/<repo>.",
  "mount_path": ".private/",
  "raw_url_template": "https://raw.githubusercontent.com/<owner>/<repo>/main/{path}",
  "tree_url_template": "https://api.github.com/repos/<owner>/<repo>/contents/{path}",
  "auth": {
    "scheme": "github_token",
    "scope_required": "repo",
    "_note": "Token resolved via WAH_PRIVATE_TOKEN env > GITHUB_TOKEN env > `gh auth token` CLI."
  }
}
```

### Auth resolution order

The brainstem's private layer (`utils/private_layer.py`) tries, in order:

1. `WAH_PRIVATE_TOKEN` env var
2. `GITHUB_TOKEN` env var
3. `gh auth token` CLI

If none resolves a token: the twin falls back to public-only material gracefully. **No error to the user**; the twin just speaks from less depth.

### Design intent

Anonymous → minimal context. Authenticated collaborators → full context. The same egg, the same URL, the same twin — but the depth of the twin's responses correlates with the chatter's authorization. This is the silent escalation pattern from `wildhaven-ai-homes-twin`'s private_companion block.

---

## 6. Bundled cartridges (the standard memory pair)

Twins SHOULD ship with the two standard memory cartridges in their `agents/` directory:

- **`agents/manage_memory_agent.py`** — `ManageMemory` tool: save typed facts to `memory.json`
- **`agents/context_memory_agent.py`** — `ContextMemory` tool: recall relevant facts at conversation start

Without these, a hatched twin starts every conversation tabula rasa. With them, the twin remembers what users tell it across sessions and across substrates.

These are part of the rapp-installer's bundled agents (the "Wii Sports") but bundling them inside the egg ensures every hatch — even on a non-rapp-installer brainstem — has working memory.

Twins MAY ship additional cartridges in `agents/` for twin-specific capabilities (e.g., `agents/<twin>_specialty_agent.py`).

---

## 7. The egg cartridge format

`.egg` files are zip archives carrying a typed manifest + a payload tree. The current schema is `brainstem-egg/2.1`.

### Manifest (`manifest.json` at zip root)

```json
{
  "schema": "brainstem-egg/2.1",
  "type": "twin",
  "exported_at": "2026-05-04T17:00:00Z",
  "exported_by": "@kody-w/twin_agent",
  "source": {
    "rappid": "rappid:grandma-rose:0d51f2b3...<64hex>",
    "parent_rappid": "rappid:wildhaven-ai-homes:37ad22f5...<64hex>",
    "repo": "https://github.com/<owner>/<repo>.git",
    "commit": "<git SHA at pack time | null>",
    "name": "<slug>"
  },
  "brainstem": {
    "version": "0.12.2",
    "source_repo": "https://github.com/kody-w/RAPP.git",
    "source_commit": "<sha | null>"
  },
  "bundled_repo": true,
  "bundled_state": true,
  "repo_file_count": <int>,
  "data_file_count": <int>,

  "pubkey": "",
  "sig_suite": "none",
  "birth_attestation": null,
  "registry_anchor": null,
  "attestation": null
}
```

> **Renamed in v2.0:** `source.rappid_uuid` → `source.rappid` and `source.parent_rappid_uuid` → `source.parent_rappid`, now carrying full canonical `rappid:<slug>:<64hex>` strings. The reserved ownership fields (`pubkey`, `sig_suite`, `birth_attestation`, `registry_anchor`) mirror the record (§2) and MAY be empty. **The `.lineage_key` is NEVER present in a manifest or anywhere in an egg.**

### Payload layout

```
<egg>.egg                               (zip)
├── manifest.json                       ← required
├── repo/                               ← public repo tree (when bundled_repo)
│   ├── rappid.json                     ← required
│   ├── soul.md                         ← required
│   ├── MANIFEST.md, README.md, LICENSE
│   ├── agents/                         ← bundled cartridges
│   ├── utils/                          ← optional helpers
│   └── installer/                      ← optional kernel pin
└── data/                               ← .brainstem_data tree (when bundled_state)
    ├── memory.json                     ← persistent facts
    ├── identity.json                   ← local identity cache (canonical rappid)
    └── conversations/                  ← optional chat history
```

`soul_history/` is intentionally NOT included — receivers don't need the donor's edit log. `.lineage_key`, `private/`, and all auth secrets are excluded per §2/§4/§12.

### Schema versions

| Schema | Use |
|---|---|
| `brainstem-egg/2.0` | rapplications, twins, snapshots, swarms — RAPP-instance shape |
| `brainstem-egg/2.1` | variant repos (rappid.json + brainstem.py at same root) — current default for twins |
| `brainstem-egg/2.2-organism` | brainstem-instance organisms (rappid.json above `src/rapp_brainstem/`) |
| `brainstem-egg/2.2-rapplication` | rapplications with state cartridge (rapp-zoo) |
| `brainstem-egg/2.3-session` | tethered browser session cartridge (vbrainstem) |
| `brainstem-egg/2.3-neighborhood` | neighborhood federation cartridge |
| `brainstem-egg/2.3-estate` | estate (door catalog) cartridge |
| `brainstem-egg/2.3-cubby` | private-cubby cartridge |

Twin authoring should target `2.1` unless there's a specific reason to use a different shape.

### Viability requirements

A twin egg is **viable** when:

- ✓ Manifest parses, schema is `brainstem-egg/2.x`
- ✓ `repo/rappid.json` exists with a valid canonical Eternity `rappid` (`rappid:@<owner>/<slug>:<64hex>`, 64 lowercase hex, `<slug>` matches `name`)
- ✓ `repo/soul.md` exists and is non-empty
- ✓ `parent_rappid` lineage is valid and canonical (single-parent rule honored)
- ✓ No `.lineage_key`, no auth secrets, no PII anywhere in the payload (§12)

Eggs without these are NOT hatchable. The Twin agent's `hatch` action verifies viability before reporting success. Legacy UUID eggs are accepted but trigger the one-time re-anchor migration (§2) on hatch.

---

## 8. Hub conventions (`rapp-egg-hub`)

This repo is the public catalog of `.egg` cartridges (and their `.html` twins — §11). Layout:

```
rapp-egg-hub/
├── eggs/
│   ├── <slug>.egg              ← the raw egg (no file association — see §11)
│   ├── <slug>.html             ← the single-file .html twin (PRIMARY share artifact)
│   └── <slug>.json             ← sidecar manifest (this spec)
├── agents/                     ← drop-in cartridges (Twin, Estate)
├── scripts/rebuild_index.py
├── scripts/pii_gate.py         ← pre-publish PII / secrets scanner (§12)
├── .github/workflows/rebuild-index.yml
├── index.json                  ← auto-generated catalog
├── index.html                  ← Pages UI
├── README.md
└── SPEC.md                     ← this document
```

### Sidecar manifest (`rapp-egg-hub-entry/2.0`)

Every egg in the hub has a sidecar JSON next to it. Schema:

```json
{
  "schema": "rapp-egg-hub-entry/2.0",
  "slug": "kody-w",
  "rappid": "rappid:kody-w:1b5e7aa9...<64hex>",
  "name": "kody-w",
  "display_name": "Kody Wildfeuer",
  "github": "https://github.com/<owner>",
  "kind": "personal",
  "description": "One-paragraph human-readable description.",
  "tags": ["personal", "founder"],
  "egg_schema": "brainstem-egg/2.1",
  "size_bytes": 10370,
  "sha256": "<hex>",
  "html_path": "eggs/<slug>.html",
  "html_sha256": "<hex>",
  "packed_by": "@<github-handle>",
  "packed_at": "<ISO timestamp>",
  "egg_path": "eggs/<slug>.egg",
  "raw_url": "https://raw.githubusercontent.com/kody-w/rapp-egg-hub/main/eggs/<slug>.egg",
  "lineage": {
    "parent_rappid": "rappid:<parent-slug>:<64hex>",
    "parent_repo": "<URL>"
  },

  "pubkey": "",
  "sig_suite": "none",
  "registry_anchor": null
}
```

> **Renamed in v2.0:** `rappid_uuid` → `rappid`, and `lineage.parent_rappid` now carries the full canonical string. Added: `html_path` / `html_sha256` (the `.html` twin), plus the reserved `pubkey` / `sig_suite` / `registry_anchor` mirror of the record (MAY be empty). The sidecar **MUST NOT** contain `.lineage_key` or any PII (§12).

### `index.json` (`rapp-egg-hub/2.0`)

Aggregated catalog of every sidecar in `eggs/`. Auto-regenerated by `scripts/rebuild_index.py` on every push (see `.github/workflows/rebuild-index.yml`). Hub maintainers don't edit this by hand — drop egg + `.html` + sidecar, push, the action regenerates. The rebuild action runs `scripts/pii_gate.py` first and fails the build if anything trips the gate (§12).

### Twin kinds (canonical values)

| Kind | Use |
|---|---|
| `personal` | Digital companion for an individual |
| `pre-founder` | A brand operating in public before the team is hired |
| `memorial` | Twin of someone who has died, for family to remember by |
| `project` | Long-running project; continuity layer across personnel |
| `place` | Twin of a physical location (museum, restaurant, town) |
| `custom` | None of the above; soul.md fully custom |

Use `tags` for everything beyond `kind`.

---

## 9. Lifecycle operations

The Twin agent (`@kody-w/twin_agent` in RAR, `agents/twin_agent.py` in this hub) implements every lifecycle operation:

| Action | Semantics |
|---|---|
| `summon` | Birth a fresh twin. Mints the canonical **Eternity** rappid `rappid:@<owner>/<slug>:<64hex>` — the `<64hex>` is a keyless identity hash (`sha256` of a fresh UUID per SPEC.md §2.3 / `rapp-eternity/1.0`), **independent of the slug**, never `sha256('<owner>/<slug>')`; kind in the record, not the string — and writes the workspace from a soul template (kind). Never emits the bare legacy form. |
| `hatch` | Import an existing twin from a `.egg` (local file via `egg_path` OR remote URL via `egg_url`) or from a `.html` twin. sha256-verifies if expected hash known. Re-anchors legacy UUID identities once (§2). |
| `boot` | Start the twin as its own brainstem on a fresh port (auto-allocates 7081–7200). Returns the chat URL. |
| `stop` | SIGTERM a running twin; clean up pid/port files. |
| `list` | Quick text list of every twin on this device + running status. |
| `update_identity` | Append the current identity block to an older twin's soul.md (idempotent, append-only, backs up first). |
| `update_soul` | Fully replace a twin's soul.md with new content. ALWAYS backs up to `soul_history/` first. |
| `lay_egg` | Pack a twin's workspace into a portable `.egg` cartridge + `.html` twin + matching sidecar JSON ready for hub PR. Runs the PII/secrets gate (§12) before producing artifacts. |

The Estate agent (`@kody-w/estate_agent` in RAR, `agents/estate_agent.py` in this hub) provides read-only inspection:

| View | Shows |
|---|---|
| `overview` | All twins, running status, memory size, soul-edit count, eggs |
| `inspect` | Card view of one twin (full lineage, paths, status) |
| `history` | Soul.md edit history with timestamps + reasons + revert recipe |
| `eggs` | Every `.egg` backup on disk with sizes + ages |
| `lineage` | Family tree grouped by parent_rappid |

---

## 10. The impersonation hard rule

**A digital twin is NOT the human (or place, or project) it represents.** Every twin's soul.md MUST encode this distinction.

When a twin is asked "is this really you?" or "are you the actual person?", it MUST answer plainly that it is the **digital twin** — not the human — and MUST defer to the human for any decision that needs personal sign-off:

- Money / payments
- Contracts / employment
- Personal relationships
- Health / medical decisions
- Legal commitments

Example required hard-rule text (adapt to the twin's name):

```markdown
## Hard rule on impersonation

You are **the digital twin of <Name>**. You are NOT <Name> themselves.

If anyone asks "is this really you?" or "are you the actual person?",
answer plainly: "I'm the digital twin of <Name> — built from their
public writing. I carry their voice and convictions, but I'm not them.
For anything that needs their personal sign-off — money, contracts,
employment, partnerships — talk to them directly."

You do NOT make legal commitments, sign contracts, accept money, or
speak for them in matters of personal relationships, health, or
employment without explicit user confirmation that the human is in
the loop. This is a hard limit, not a default.
```

This rule is non-negotiable. Twins shipped to the hub without an impersonation hard-rule fail the compliance check (see §15).

---

## 11. The single-file `.html` twin

**The `.html` twin IS the twin** — in the same way `agent.py` *is* the agent, the single-file `.html` *is* the share artifact. It is the **PRIMARY** thing a contributor hands to another human. The raw `.egg` still exists in `eggs/`, but it has **no file association** — double-clicking does nothing useful for a normal person, which is exactly the point. People share the `.html`; the brainstem still reads the `.egg`.

A `.html` twin is a self-contained, dependency-free page that:

### Renders a holo trading card (RAR `rapp-card`)

The card is deterministically generated — same twin, same card, forever — from the twin's name:

- **Seed:** `seed = seed_hash(name)` — a stable integer derived from the twin's `name` slug.
- **PRNG:** a `mulberry32(seed)` generator drives all visual + stat rolls (deterministic, reproducible across machines, no network).
- **Stats:** five stats — **HP / ATK / DEF / SPD / INT** — each rolled into the range **10–100**.
- **Tier:** derived from the stat total (bands map total → tier label).

The card is the "holo" face: foil/shine treatment, the twin's `display_name`, `kind`, `haiku`, and lineage at a glance.

### Bakes the egg in as base64

The full `.egg` is embedded as a base64 blob inside the `.html`. The page is therefore the complete cartridge — nothing else needs to travel.

### Downloads JS-FREE via `data:` URI anchors

Downloading the egg out of the page does **NOT require JavaScript**. The egg is offered through plain `<a href="data:application/octet-stream;base64,…" download="<slug>.egg">` anchors. This means the download works **in Microsoft Teams' link/file preview with JavaScript disabled** — the single most common place a twin is shared. JS may *enhance* the card (animation, shine) but MUST NOT be *required* to retrieve the egg or the hatch agent.

### Exports a drag-in, self-bootstrapping hatch `agent.py`

The page also offers — again via a JS-free `data:` anchor — a self-bootstrapping **`*_agent.py`** that the recipient drops straight into their `agents/` directory. On first run it decodes the embedded egg and hatches the twin locally. No CLI, no clone: drag the file in, the twin appears. This is drop-in compatible with any unmodified brainstem.

### Hub placement

Both artifacts ship side by side: `eggs/<slug>.egg` (raw, no association) and `eggs/<slug>.html` (the twin). The sidecar records `html_path` + `html_sha256` (§8). The `.html` is subject to the same **NO PII / secrets** rule as everything else — see §12.

---

## 12. No PII / secrets (MANDATORY)

> **HARD RULE: NO PII and NO secrets anywhere in the public repo or in any egg, sidecar, or `.html` twin.** This is non-negotiable and it is enforced mechanically.

Forbidden in any public artifact (repo, `.egg`, `.html`, sidecar, index):

- **Emails** — except the explicitly allowed forms: `noreply@…`, `@rapp`, `@microsoft.com`, `@example.com`
- **Phone numbers, SSNs / national IDs**
- **Tokens / secrets of any kind** — including `.lineage_key`, `.copilot_token`, `.copilot_session`, `.env` / `.env.local`, API keys, OAuth tokens
- **Customer names and named-person personal data** — any data tied to an identifiable real individual

The `.lineage_key` is the **private germline (§2)** — a leak forges the whole lineage. It is the highest-severity item on this list and MUST NEVER leave the local machine.

### Enforcement: `scripts/pii_gate.py`

`scripts/pii_gate.py` is the **pre-publish gate**. It scans the egg payload, the `.html` twin, the sidecar, and any staged repo files for the patterns above. It runs:

1. At **pack time** — `lay_egg` (§9) runs the gate before emitting `.egg` / `.html` / sidecar artifacts.
2. At **hub publish time** — the `rebuild-index` workflow (§8) runs the gate first and **fails the build** if anything trips it.

Nothing that fails the gate may be published. The exclusion list (also enforced by the egg packer, §4) includes at minimum:

```
.lineage_key
.copilot_token
.copilot_session
.env
.env.local
voice.zip
.brainstem_data/private/
```

A contributor who needs private depth uses the auth-gated private companion (§5) — never inlined secrets.

---

## 13. Integrity and attestation

### Phase 1 (shipped today): sha256 content integrity

Every egg in this hub publishes its sha256 in the sidecar JSON (and the `.html` publishes `html_sha256`). The Twin agent's `hatch` action:

1. Downloads or reads the egg (or extracts it from a `.html` twin)
2. If `egg_url` matches the hub URL pattern, auto-fetches the matching sidecar
3. Computes local sha256
4. Refuses to hatch if mismatched

Or pass `expect_sha256=` to the hatch action explicitly. This is content integrity — confirms the bytes weren't tampered between hub and hatcher.

### Phase 2 (keypair binding): publisher + birth signatures

v2.0 reserves the full signing surface (§2): the record and manifest carry `pubkey`, `sig_suite`, `birth_attestation`, `key_succession[]`, and `registry_anchor`. As these fill in:

- Each publisher binds to a **public key** (`pubkey`), declaring a `sig_suite` (`ed25519` → PQC).
- Every child carries a **`birth_attestation`** — the parent signs the child at mint time, proving provenance up the chain.
- Ownership is proven by **signing a challenge** verifiable against the pubkey; the private key never moves.
- Keys rotate or inherit through **`key_succession[]`** signed entries, so a line survives the operator's death.

Crucially, **migrating the signature suite never changes the identity hash** (§2 crypto-agility). SLH-DSA / SPHINCS+ is the PQ landing spot because it shares the rappid's own hash trust root.

Until phase 2 fills in, `sig_suite: "none"` + sha256 is the baseline. It detects tampering between hub and hatcher; it doesn't yet prove who originally published.

---

## 14. Versioning and stability

This document is `rapp-rappid-spec/2.0`. **The `rappid` *string* form is frozen forever** — the Eternity `rappid:@<owner>/<slug>:<64hex>`, no version tag, ever. **The `rappid.json` RECORD is versionless and additive** — new needs become new optional fields, never new string forms. Future spec versions are additive only; old readers ignore unknown fields.

### Schemas referenced

| Schema | Purpose |
|---|---|
| `rapp-eternity/1.0` | the identity standard this document defers to (Eternity rappid form + invariants) |
| `rapp-rappid-spec/2.0` | this document |
| `rapp-rappid/2.0` | rappid.json record shape (hash-derived identity + reserved ownership fields) |
| `brainstem-egg/2.1`–`2.3` | egg cartridge format (2.1 twins · 2.2 organisms/rapplications · 2.3 sessions/neighborhoods/estates/cubbies) |
| `rapp-egg-hub-entry/2.0` | sidecar JSON in this hub |
| `rapp-egg-hub/2.0` | catalog (`index.json`) |
| `rapp-agent/1.0` | the cartridge manifest format (Twin, Estate, etc.) |
| `rapp-peers/1.1` | local peer registry (rappterbox console) |

Cartridges, eggs, and twins authored against any 1.x or 2.x version of these schemas remain hatchable. v1.0 UUID identities re-anchor losslessly on first hatch (§2); the prior id is preserved in `_migrated_from` and chains stay walkable.

### 14.1 The Compatibility & Migration Contract (NORMATIVE)

This is the law that lets the ecosystem evolve without rotting. The old mess came from
**versioned identity strings** (`rappid:v2:…`, `rappid:v3:…` — legacy forms, read-forever but never written) — producers kept inventing formats
and consumers couldn't read them all. The contract makes that impossible by separating who reads
from who writes. Every RAPP component — the brainstem, hatchers, `rapp-god`, lineage walkers,
egg packers, the `.html` baker — MUST obey it.

1. **Liberal in, strict out (Postel's Law).**
   - **Consumers** (anything that PARSES a rappid: validators, drift detectors, hatchers,
     lineage-walkers, registries) **MUST accept every form**: legacy UUIDv4, `rappid:v2:<…>@host`,
     bare `rappid:<hex>`, the location-less `rappid:<birth-slug>:<64hex>`, and the canonical Eternity
     `rappid:@<owner>/<slug>:<64hex>`.
   - **Producers** (anything that EMITS a rappid: mint, egg-pack, file-rename, `.html` bake,
     sidecars, index) **MUST emit ONLY the canonical Eternity form** `rappid:@<owner>/<slug>:<64hex>`.
   - New string forms therefore cannot proliferate — nothing is permitted to write a non-canonical
     rappid. Drift detectors MUST NOT flag a legacy form as invalid; legacy is *expected*, not drift.

2. **The bare hash is the universal join key.** Equality, dedup, and lineage-walk operate on the
   `<hex>` digest — **never the string shape**. A legacy UUID twin and its canonicalized form are
   provably the same entity because they share the same hash. This single rule eliminates
   "two strings, one twin."

3. **Never rewrite identity in place.** Canonicalizing a legacy artifact changes only the *string*
   and records `_migrated_from` + `hash_bits` (`128` grandfathered / `256` native). The underlying
   bits never change — so "minted once, never regenerated" (§2) holds and lineage chains stay walkable.

4. **One migration moment, recorded.** An artifact canonicalizes the first time a tool touches it,
   leaves the `_migrated_from` trail, and never churns again. Re-running a tool is idempotent.

5. **Legacy acceptance is PERMANENT — never sunsetted.** There is no cutoff date after which old
   forms are rejected. A twin minted in 2026 MUST still hatch in 2050. An "accept-then-reject"
   window would re-break old twins, which defeats the purpose of permanent identity. Consumers read
   legacy forms forever.

> In one line: **producers converge on one canonical form; consumers tolerate every form, forever;
> the hash is identity.** That is how the ecosystem grows without becoming a mess.

---

## 15. Compliance checklist

A twin egg ships hub-compliant when ALL of the following are true:

### Identity
- [ ] `rappid.json` has a valid canonical Eternity `rappid` (`rappid:@<owner>/<slug>:<64hex>`, full untruncated 64 lowercase hex)
- [ ] `<64hex>` is a keyless identity hash (SHA-256 of the record's canonical content / a UUID-derived mint per `rapp-eternity/1.0`), **independent of the slug** — NOT `sha256('<owner>/<slug>')`; `<slug>` equals the record `name`
- [ ] `parent_rappid` set as a full canonical rappid; chain walks back to the rapp species root
- [ ] Single-parent rule honored — `parent_rappid` is the actual code-ancestor
- [ ] NO version tag in the rappid string (no `rappid:v4:…`)
- [ ] Reserved record fields present (empty allowed): `pubkey`, `sig_suite`, `birth_attestation`, `key_succession`, `registry_anchor`
- [ ] If migrated from v1.0: old id preserved in `_migrated_from`
- [ ] `name` is a valid slug (lowercase, hyphens/underscores OK)
- [ ] `display_name` set if slug doesn't de-slug cleanly

### Voice
- [ ] `soul.md` exists, non-empty
- [ ] Includes the `## Identity — read this every turn` block (§3)
- [ ] Includes the impersonation hard rule (§10)
- [ ] No hidden prompts that bypass the hard rules

### Memory
- [ ] `agents/manage_memory_agent.py` bundled (recommended)
- [ ] `agents/context_memory_agent.py` bundled (recommended)
- [ ] `.brainstem_data/memory.json` is public-facing only — no secrets
- [ ] `private/` excluded from the egg payload

### Egg
- [ ] Schema is `brainstem-egg/2.x`
- [ ] Manifest valid; `source.rappid` / `source.parent_rappid` are canonical strings
- [ ] Exclusion list honored — **no `.lineage_key`**, no .env, no __pycache__, no auth tokens
- [ ] Egg viable per §7 (parses, has canonical rappid + soul)

### Share artifact (§11)
- [ ] `eggs/<slug>.html` single-file twin present
- [ ] Egg + hatch `agent.py` downloadable JS-FREE via `data:` URI anchors
- [ ] Holo card renders deterministically from `seed_hash(name)`

### PII / secrets (§12)
- [ ] `scripts/pii_gate.py` passes on the egg, `.html`, sidecar, and staged files
- [ ] No emails (except allowed forms), phones, SSNs, tokens, customer/named-person data
- [ ] `.lineage_key` is NOT present anywhere in any published artifact

### Hub
- [ ] Sidecar JSON at `eggs/<slug>.json` matches `rapp-egg-hub-entry/2.0`
- [ ] sha256 in sidecar matches actual file hash; `html_sha256` matches the `.html`
- [ ] PR open against the hub repo (`rebuild_index.py` regenerates `index.json`; PII gate must pass)

### Lineage & private layer (optional)
- [ ] If `private_companion` declared: URL templates valid, auth scheme documented
- [ ] If publisher-signed (phase 2): `birth_attestation` / `key_succession` verify against the bound `pubkey`

---

## 16. References

- [`README.md`](./README.md) — install + hatch + contribution guide
- [`agents/twin_agent.py`](./agents/twin_agent.py) — full lifecycle implementation
- [`agents/estate_agent.py`](./agents/estate_agent.py) — read-only inspection
- [`scripts/rebuild_index.py`](./scripts/rebuild_index.py) — hub catalog regenerator
- [`scripts/pii_gate.py`](./scripts/pii_gate.py) — pre-publish PII / secrets gate (§12)
- [Constitution Articles XXXII–XXXV](https://github.com/kody-w/RAPP/blob/main/CONSTITUTION.md) — kernel sacredness, lineage protocol, license stability
- [rappterbox SPEC](https://github.com/kody-w/rappterbox/blob/main/SPEC.md) — the runtime spec; this document is its companion
- [RAR](https://github.com/kody-w/RAR) — public catalog of cartridges (`twin_agent`, `estate_agent`, `rapp-card`, etc.)
- [`Twin-Patterns.md`](https://github.com/kody-w/RAPP/blob/main/pages/vault/Architecture/Twin-Patterns.md) — solo / parallel-omniscience / twin-squared / cross-twin patterns

---

## 17. Conformance notice

A twin authored against `rapp-rappid-spec/2.0` will hatch and run on every rappterbox console install today and forever. The `rappid` string form is frozen; the record is versionless and additive; the impersonation hard rule is non-negotiable; the NO-PII rule is mechanically enforced. Legacy UUID twins re-anchor losslessly on first hatch and their chains stay walkable. The hub will not accept eggs that fail §15 — that's the compact between contributors and downstream hatchers.
