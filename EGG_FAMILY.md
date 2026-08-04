# The `.egg` Cartridge Family & Multi-Scale Hatch Contract

> **Schema: `brainstem-egg/2.3`** &nbsp;·&nbsp; First published: 2026-06-28 &nbsp;·&nbsp; Status: NORMATIVE
>
> Home: [`kody-w/rapp-egg-hub/EGG_FAMILY.md`](https://github.com/kody-w/rapp-egg-hub/blob/main/EGG_FAMILY.md)
>
> This document is the canonical, self-contained specification for the **`.egg` cartridge format family** and the **multi-scale `hatch` contract**. It **supersedes and replaces** §7 ("The egg cartridge format") of the Digital Twin Specification ([`rapp-egg-hub/SPEC.md`, `rapp-rappid-spec/2.0`](./SPEC.md)). `SPEC.md` §7 **should** bump its egg-schema reference from `brainstem-egg/2.1` to `brainstem-egg/2.3` and point here for the full family — this document **proposes** that bump; `SPEC.md` has **not yet** been amended. `SPEC.md` remains authoritative for what a *twin organism* is (identity, soul, memory, lineage, impersonation, PII gate); this document is authoritative for how *any* RAPP thing is **packed, transported, and hatched** as a single file.

---

## 0. Why this spec exists

The estate already ships eggs at **six different scales** — twins, brainstem organisms, rapplications, sessions, cubbies, and (in precursor form) neighborhoods. Each was minted by a different tool at a different time, and the format drifted: some carry `manifest.json`, one (`neighborhood-egg/1.0`) does not; some hold 256-bit identities, the live hub still holds 128-bit ones; the discriminator that tells a hatcher *which shape it is looking at* was never written down in one place.

`brainstem-egg/2.3` writes it down. It does **not** invent a new wire — `.egg` was always "a zip with a typed `manifest.json` at the root." It **enumerates every shipped variant**, fixes a single **manifest discriminator** (`schema` + `type`), and defines **one `hatch` contract** that every variant obeys. An LLM training on this corpus, or a fresh hatcher written from scratch, can read this file and correctly hatch every egg the estate has ever produced — and refuse to silently mishatch the ones it cannot.

`.egg` is the estate's **sneakernet primitive**: the single offline-capable unit of transport that works across all scales. One human hands another a file (or a `data:`-URI `.html` wrapping that file — see `SPEC.md` §11); a brainstem reads it; the thing comes alive on the receiver's hardware. That is the north star — *use everyone else's hardware* — at the granularity of a single double-click.

---

## 1. Definition

An **`.egg`** is a **zip archive** carrying:

1. a typed **`manifest.json` at the zip root**, whose `schema` field names a member of the `brainstem-egg/*` family and whose `type` field names the payload kind; and
2. a **payload tree** whose root layout is fixed *by the variant* (§3).

An egg is **content-addressed and identity-bearing**: it carries the `rappid` of the organism it packs (§4), and its bytes are integrity-checked by `sha256` (§6). An egg is **inert** on disk — double-clicking does nothing useful, by design (`SPEC.md` §11) — until a brainstem **hatches** it.

To **hatch** an egg is to materialize its payload into a live, runnable RAPP thing on the receiving brainstem, **verifying viability before reporting success** and **never rewriting the organism's ancestry in transit** (§5).

A `.egg` is **not**:

- not a chat session transcript (a *session egg* packs a session, but the egg is the cartridge, not the chat);
- not an installer (it carries an organism, optionally pinning a kernel; it is not the kernel);
- not a registry record (the registry — `rapp-god` — *observes* eggs; eggs do not depend on it to hatch).

---

## 2. The manifest discriminator (NORMATIVE)

Every egg in the family **MUST** contain `manifest.json` at the zip root with **at minimum** these keys:

```json
{
  "schema": "brainstem-egg/2.3-<variant>",
  "type":   "<payload-kind>",
  "exported_at": "<ISO-8601 UTC, Z-suffixed>",
  "exported_by": "@<github-handle>/<tool>",

  "source": {
    "rappid":        "rappid:@owner/slug:<64hex>",
    "parent_rappid": "rappid:@owner/parent-slug:<64hex>",
    "repo":          "https://github.com/<owner>/<repo>.git | null",
    "commit":        "<git SHA at pack time | null>",
    "name":          "<slug>"
  },

  "brainstem": {
    "version":       "<kernel version the egg was packed against>",
    "source_repo":   "https://github.com/kody-w/RAPP.git",
    "source_commit": "<sha | null>"
  },

  "bundled_repo":   true,
  "bundled_state":  true,
  "repo_file_count":  0,
  "data_file_count":  0,

  "pubkey":            "",
  "sig_suite":         "none",
  "birth_attestation": null,
  "registry_anchor":   null,
  "attestation":       null
}
```

### 2.1 The discriminator pair

- **`schema`** is the **primary discriminator**. Its value is exactly one of the family members in §3. A hatcher dispatches on `schema` to select the payload-tree reader. An unknown `schema` outside the `brainstem-egg/*` namespace **MUST NOT** be hatched (the hatcher reports "unrecognized cartridge family," it does not guess).
- **`type`** is the **payload-kind tag**: `twin`, `organism`, `rapplication`, `session`, `cubby`, `neighborhood`, `estate`, `snapshot`, `swarm`. `type` is a human/registry hint and a coarse router; `schema` is the authority. When the two disagree, `schema` wins.

### 2.2 Required-key rules

- `source.rappid` and `source.parent_rappid` carry **full canonical rappid strings** (§4), never bare hashes, never legacy `rappid_uuid`.
- The reserved ownership fields (`pubkey`, `sig_suite`, `birth_attestation`, `registry_anchor`, `attestation`) **mirror the `rappid.json` record** (`SPEC.md` §2) and **MAY be empty** (`sig_suite: "none"` is fully conformant). They are **additive and versionless** — new ownership needs become new optional keys, **never** a new `schema` minor.
- The **`.lineage_key` private germline is NEVER present** in a manifest or anywhere in an egg (`SPEC.md` §2/§12). This is the highest-severity item on the PII gate.
- Counts (`repo_file_count`, `data_file_count`) are advisory integrity hints; a hatcher MAY warn on mismatch but MUST verify the actual tree (§5), not trust the counts.

### 2.3 The single legacy exception

Exactly one shipped egg predates the manifest contract: `neighborhood-egg/1.0` (`rappterbook-cohesive.egg`) has **no `manifest.json`** and uses a sidecar field `rappid_uuid`. It is **read-accepted** under the compatibility contract (§7) and is classed **planned-not-yet-conformant** (§3). New neighborhood/estate eggs **MUST** carry a root `manifest.json` per this section.

---

## 3. EGG_FAMILY — the shipped variants

The family is a **single format** parameterized by `schema`. Below, every variant the estate has minted, its discriminator, its payload-tree root shape, and its conformance status.

| `schema` | `type` | Scale | Status | Payload-tree root |
|---|---|---|---|---|
| `brainstem-egg/2.0` | `twin`·`rapplication`·`snapshot`·`swarm` | RAPP-instance | **Conformant (legacy default)** | generic RAPP-instance shape |
| `brainstem-egg/2.1` | `twin` | organism (twin) | **Conformant (current twin default)** | `manifest.json` + `repo/` (`rappid.json` + `brainstem.py` co-rooted) + `data/` |
| `brainstem-egg/2.2-organism` | `organism` | brainstem instance | **Conformant** | `rappid.json` **above** `src/rapp_brainstem/` |
| `brainstem-egg/2.2-rapplication` | `rapplication` | rapplication + state | **Conformant** | rapplication bundle + state cartridge (runtime contract → RAPP_Store `rapp-application/1.0` §13) |
| `brainstem-egg/2.3-session` | `session` | session snapshot | **Conformant (new in 2.3)** | `manifest.json` + `session/` + `data/` |
| `brainstem-egg/2.3-cubby` | `cubby` | per-owner holding area | **Conformant (new in 2.3)** | `manifest.json` + `cubby.json` + `cubby/` (cross-link `rapp-cubby/1.0`) |
| `brainstem-egg/2.3-neighborhood` | `neighborhood` | multi-organism set | **Planned — NOT YET CONFORMANT** | precursor: `neighborhood-egg/1.0` (no manifest) |
| `brainstem-egg/2.3-estate` | `estate` | neighborhood set | **Planned — NOT YET CONFORMANT** | (composes neighborhood eggs; see §8) |

> **Scale ladder.** The variants are deliberately ordered by enclosing scope: `session` ⊂ `cubby` ⊂ `organism`/`twin`/`rapplication` ⊂ `neighborhood` ⊂ `estate` ⊂ **metropolis**. Metropolis is not an egg — it is the *mesh* the estate eggs compose into (the [metropolis mesh-composition spec], a sibling document). An egg is the unit you can hand to one person; the metropolis is what emerges when many people hold many eggs and link them over GitHub (§8).

### 3.1 `brainstem-egg/2.1` — the twin organism (current default)

The canonical, most-shipped shape. Verified tree (from `eggs/kody-w.egg`):

```
<slug>.egg                              (zip)
├── manifest.json                       ← required, type:"twin"
├── repo/                               ← public repo tree (bundled_repo)
│   ├── rappid.json                     ← required, canonical rappid
│   ├── brainstem.py                    ← kernel co-rooted with rappid.json (the 2.1 signature)
│   ├── soul.md                         ← required, non-empty
│   ├── MANIFEST.md · README.md · LICENSE
│   ├── agents/                         ← bundled cartridges (memory pair recommended)
│   ├── utils/                          ← optional helpers (e.g. lineage_check.py)
│   └── installer/                      ← optional kernel pin (VERSION)
└── data/                               ← .brainstem_data tree (bundled_state)
    ├── memory.json                     ← persistent facts
    ├── identity.json                   ← local identity cache (canonical rappid)
    └── conversations/                  ← optional
```

`soul_history/`, `.lineage_key`, `private/`, and all auth secrets are **excluded** (`SPEC.md` §2/§4/§12).

### 3.2 `brainstem-egg/2.2-organism` — a whole brainstem instance

The discriminating root-layout fact: **`rappid.json` sits *above* `src/rapp_brainstem/`**, because the payload is a *brainstem checkout* (the engine in `src/`), not a twin workspace. The identity belongs to the organism, so it anchors the repository root, one level up from the engine package.

```
<slug>.egg
├── manifest.json                       ← type:"organism"
├── rappid.json                         ← ABOVE src/  (the 2.2-organism signature)
├── src/
│   └── rapp_brainstem/                 ← the kernel checkout
│       ├── brainstem.py
│       ├── agents/
│       └── ...
└── data/                               ← .brainstem_data tree
```

### 3.3 `brainstem-egg/2.2-rapplication` — a rapplication with a state cartridge

A rapplication egg packs a `rapp-application/1.0` bundle (one singleton agent + optional UI/service/state). Its **runtime contract is NOT duplicated here** — it lives in **RAPP_Store `rapp-application/1.0` §13** and is referenced, not copied, to keep the two specs from drifting. Salient root keys (per RAPP_Store): `manifest.json` (with `id`, `agent`, `ui`, `runtime`, `service`), `singleton/<id>_agent.py`, optional `ui/index.html`, optional `service/<id>_service.py`, and the state cartridge under `eggs/` or `data/`. When `runtime: "twin"`, hatching allocates a free port and materializes an isolated root at `${BRAINSTEM_ROOT}/.brainstem_data/twins/<id>/` (the rapp-zoo shape).

> **Boundary rule.** This document owns the *transport envelope* (manifest discriminator, payload-tree root, hatch contract, identity, integrity). RAPP_Store `rapp-application/1.0` owns the *rapplication runtime* (how the singleton boots, the iframe UI, the service module, twin-port allocation). A rapplication egg conforms to **both**: this spec for the outer `.egg`, RAPP_Store §13 for the inner runtime.

### 3.4 `brainstem-egg/2.3-session` — a session snapshot

A session egg captures a single conversation/working session so it can be replayed or resumed on another brainstem. It is the smallest durable scale — a frozen *moment of work* rather than a persistent organism.

```
<slug>.egg
├── manifest.json                       ← type:"session"
├── session/
│   ├── session.json                    ← session metadata (started_at, model, agent set)
│   ├── transcript.json                 ← the chat turns (ordered, UTC-stamped)
│   └── soul.md                         ← the soul active during the session (snapshot)
└── data/                               ← optional .brainstem_data delta produced in-session
    └── memory.json
```

A session egg's `source.rappid` is the rappid of the **organism whose session this was** (a session is not its own lineage root); `parent_rappid` is that organism's parent, preserved unchanged. Hatching a session egg **resumes** under the host organism's identity — it does not mint a new one.

### 3.5 `brainstem-egg/2.3-cubby` — a per-owner holding area

A cubby is a **per-GitHub-handle holding area** for loose, owned files that are not (yet) a full organism — the durable home for "stash my N loose files under `cubbies/<owner>/`." The cubby egg carries a **`cubby.json`** descriptor at the root. Full cubby semantics are defined in the sibling spec **`rapp-cubby/1.0`**; this variant defines only its transport envelope.

```
<slug>.egg
├── manifest.json                       ← type:"cubby"
├── cubby.json                          ← cubby descriptor (owner, created_at, file index) — see rapp-cubby/1.0
└── cubby/
    └── <owner>/                        ← the owned loose files
        └── ...
```

`cubby.json` **MUST** declare `owner: "@<github-handle>"`. A cubby's authority is **gh-collaborator** on the owning namespace (§6 trust model) — there is no organism soul and no impersonation surface, so the twin compliance items of `SPEC.md` §10/§15 do **not** apply; only the **PII/secrets gate** (`SPEC.md` §12) and the **manifest contract** (§2) do.

### 3.6 Planned: `2.3-neighborhood` and `2.3-estate`

A **neighborhood** egg packs *several organisms that are meant to live together* (e.g. the rappterbook outside-judge twin set + its fleet stack). An **estate** egg composes neighborhoods. Both are **planned, not yet conformant**: the only shipped instance, `neighborhood-egg/1.0`, predates the manifest contract (§2.3) and uses `rappid_uuid`. The conformant `2.3-neighborhood` shape (root `manifest.json`, `type:"neighborhood"`, a `members[]` array of contained organism rappids, each member as a sub-egg or co-rooted tree) is reserved here so that (a) the discriminator namespace is claimed and (b) hatchers know to read `neighborhood-egg/1.0` leniently while refusing to *emit* it. Until the conformant shape ships, a producer **MUST NOT** stamp `brainstem-egg/2.3-neighborhood`/`-estate` on an egg.

---

## 4. Identity on eggs

An egg carries identity; it does not own it. The organism's `rappid` (minted once, at first hatch, by `SPEC.md` §2) rides in `manifest.json.source.rappid` and again in the payload (`repo/rappid.json`, `rappid.json`, `cubby.json`, etc.).

### 4.1 Canonical form

```
rappid:@owner/slug:<64hex>
```

- The **`<64hex>` SHA-256 digest is the identity** — the universal join key for equality, dedup, and lineage-walk. Never truncated, never the slug.
- **PKI-free.** Identity is a content-address (a hash), not a signature. Possession of the egg is *not* a claim of ownership; ownership is a **separate, OPTIONAL** layer.
- **Keypair binding is RESERVED and OPTIONAL.** The manifest's `pubkey`/`sig_suite`/`birth_attestation` may stay empty forever and the egg is still fully conformant. No hatcher, packer, registry, or hub gate may **require** a keypair to accept or hatch an egg. (This is the resolved eternity ground truth — sha256 identity is mandatory and PKI-free; keypair sovereignty is opt-in, never required.)
- The owner-qualified form `rappid:@owner/slug:<64hex>` is the **sole canonical identity**, and a packer **emits only** that form. (This form is one of the few things unchanged across the estate's identity transition: it was defined by the former `rapp-eternity/1.0` — **retired to a non-normative tombstone on 2026-07-17** — and RAPP/1 §6.1 preserves the same string shape. See the conflict note in §4.2 for what did *not* survive that transition.) The legacy owner-less form `rappid:<slug>:<64hex>` is **read-accepted but never emitted** — a hatcher accepts both (Postel, §7) and **the hash is the join key either way**, never rewriting one into the other in transit.

### 4.2 The 128-bit → 64hex migration debt (LIVE)

> **This is a real, currently-unpaid debt, recorded here so it is not lost.** As of 2026-06-28 the shipped hub twin eggs still carry **128-bit (32-hex)** identities — e.g. `rappid:grandma-rose:0d51f2b37c2c4f9a8e5b7f0c92ab4d7e` (32 hex), `rappid:kody-w:1b5e7aa92c464cd89f1f0e3b62fc5e8f` (32 hex). The `rappid.json` record spec (`SPEC.md` §2) mints **256-bit (64-hex)** for all *new* twins from v2.0 onward, but the on-disk hub eggs predate that and are **grandfathered at 128 bits**.

The contract for this debt (consistent with `SPEC.md` §2 "lossless one-time re-anchor"):

1. **Never re-mint.** Fabricating 64 hex from a 128-bit UUID would invent a *new* identity and break "minted once, never regenerated." Grandfathered eggs keep their 128-bit hash; the record stamps `hash_bits: 128` and `_migrated_from`.
2. **New eggs mint 64hex/256-bit.** Any egg packed under `brainstem-egg/2.3` for a *newly born* organism carries a full 64-hex rappid and `hash_bits: 256`.
3. **The hatcher re-anchors string shape once, in place.** On hatching a legacy egg, the hatcher canonicalizes the *string* (strip dashes, prefix the slug) around the **same underlying hash**, records `_migrated_from`, and never churns again (§5, §7). Bits unchanged → lineage stays walkable.
4. **Debt is discharged by re-packing, not by editing.** When a grandfathered twin is next *born again* (a fresh `summon`, not a `hatch`), it mints 256-bit. There is no flag day; the hub converges as organisms are re-minted.

> **⚠ NON-NORMATIVE CONFLICT NOTE (recorded 2026-08-04 — this note changes none of the four rules above).**
>
> The authority this contract was written against, `rapp-eternity/1.0`, was **retired to a non-normative tombstone on 2026-07-17** ("normative words in the historical version have no present authority"). Identity now lives in **RAPP/1 §6** at [`kody-w/rapp-1@6723c7a`](https://github.com/kody-w/rapp-1/blob/6723c7add2aed36bb68992fc71a56b0a4bd5ad81/SPEC.md), SHA-256 `6d06daba65d7c045716f3d6e95db8401ab58e727820e4114466d847f62cae49b` (verified byte-for-byte, 41880 bytes).
>
> **RAPP §6.3 reaches the opposite conclusion on three of the four rules above** — so discharging this debt exactly as written would not resolve it under RAPP:
>
> | This §4.2 | RAPP/1 §6.3 (and §12) |
> |---|---|
> | **1.** "Never re-mint … Grandfathered eggs keep their 128-bit hash" | "The one-time owner-authorized 128→256-bit re-anchor **mints a fresh 64-hex**, records the old id in `_migrated_from`, and is **the only way** a provisional identity becomes usable." |
> | **3.** canonicalize the *string* only; "Bits unchanged" | A tail "not exactly 64 lowercase hex (e.g. a legacy 32-hex tail) is **provisional**: it exists only inside the reading process and **MUST NOT** appear in any emitted frame, `stream_id`, **egg**, or registry entry." |
> | **1./3.** "the record stamps `hash_bits: 128` and `_migrated_from`" | "**A re-anchor is valid only with a verifiable authorization** — a self-asserted `_migrated_from` is insufficient (it would let anyone hijack an identity)." It **MUST** be an owner-signed §13.3 record `{old_rappid, new_rappid, case, utc, sig, old_key_sig?}`, here `case:"upgrade"`. |
> | **4.** "There is no flag day; the hub converges as organisms are re-minted" | §12: "there is **no perpetual backward compatibility** (Art. III): a change to a canonical form is a **total migration** of every instance + **deletion** of the old form." |
>
> Rule **2** is the one that survives unchanged — new eggs minting at 256-bit is compatible with RAPP §6.2.
>
> RAPP §6.3 is not simply stricter; it resolves the same tension differently. §4.2's reasoning — that fabricating 64 hex from a 128-bit UUID invents a *new* identity and breaks "minted once, never regenerated" — is sound, and under `rapp-eternity/1.0` it was the right call. RAPP §6.3 instead makes the fresh mint **authorized and recorded**, so continuity comes from the signed re-anchor record rather than from hash preservation.
>
> **This repo has never declared RAPP/1 conformance**, so §6.3 does not govern it automatically, and the choice is a deliberate design decision rather than an inherited one: **(a)** migrate the affected identities under RAPP §6.3(a) with signed §13.3 `case:"upgrade"` records, or **(b)** declare `rapp-rappid-spec/2.0` deliberately divergent from RAPP §6 and state that here. Both are defensible. **The decision is open and tracked in [#15](https://github.com/kody-w/rapp-egg-hub/issues/15); until it is made, the four rules above remain in force for this repository.**
>
> **Live status (verified 2026-08-04):** 5 of 7 identities in `index.json` are not 64-hex — `@kody-w/generic-twin` (32-hex), `@rapp/origin` (32-hex, as `parent_rappid`), and the bare-slug `grandma-rose`, `kody-w`, `wildhaven-ceo`. Two conform fully: `@kody-w/rappterbook-cohesive-twin-set` and `@kody-w/rock-tumbler`. The debt recorded above is therefore still live, 37 days after it was written down.

---

## 5. The multi-scale hatch contract (NORMATIVE)

`hatch` is the single verb that brings any egg to life. One contract, dispatched by `schema` (§2). A conformant `hatch` implementation (the Twin agent's `hatch` action, `@kody-w/twin_agent`, and any equivalent) **MUST**:

1. **Read the discriminator first.** Open the zip, read `manifest.json`, dispatch on `schema`. If `schema` is outside `brainstem-egg/*`, refuse (do not guess). If `schema` is a `*-neighborhood`/`*-estate` planned variant with no conformant reader yet, refuse to *emit* but read `neighborhood-egg/1.0` leniently (§2.3, §7).
2. **Verify integrity before trusting bytes.** If an expected `sha256` is known (passed as `expect_sha256=`, or auto-fetched from the matching hub sidecar when `egg_url` matches the hub pattern), compute the local sha256 and **refuse to hatch on mismatch** (§6).
3. **Verify viability before reporting success.** Per the variant's payload-tree (§3), confirm the required files parse and exist *before* any "hatched" result is returned. Minimum, per variant:
   - **twin / organism**: `rappid.json` (or co-rooted equivalent) exists with a valid canonical rappid; `soul.md` exists and is non-empty; `parent_rappid` is canonical and the single-parent rule (`SPEC.md` §2) holds.
   - **rapplication**: the `rapp-application/1.0` manifest parses and `singleton/<id>_agent.py` is present (runtime viability per RAPP_Store §13).
   - **session**: `session/session.json` + `session/transcript.json` parse; `source.rappid` resolves to a known or hatchable host organism.
   - **cubby**: `cubby.json` parses and declares `owner`.
   An egg failing its viability check is **NOT hatchable** and the hatcher says so explicitly — it never reports a partial hatch as success.
4. **Re-anchor legacy identity once.** If the egg carries a legacy form — UUIDv4, 128-bit hex, `rappid:v2:…@host`, or bare `rappid:<hex>` — canonicalize the *string* on hatch, write `_migrated_from` + `hash_bits`, and never churn again (idempotent). The **hash never changes** (§4.2, §7).
5. **Never rewrite ancestry on transport.** `hatch` preserves whatever `parent_rappid` lineage the egg carried. Importing an egg is *transport*, not *birth* — it does not reparent the organism to the hatching brainstem, does not invent a new `parent_rappid`, does not re-mint identity. (Contrast `summon`, which *does* mint, and sets `parent_rappid` from the soul template.) This is `SPEC.md` §2's single-parent rule applied to transport: "transport never rewrites ancestry."
6. **Materialize into the right home.** twin/organism → a workspace (or its own port on `boot`, 7081–7200); rapplication → in-process or twin-port per `runtime` (RAPP_Store §13); session → resume under the host organism; cubby → `cubbies/<owner>/`.
7. **Honor the PII/secrets gate on the way out too.** A hatcher MUST NOT write a `.lineage_key`, `.copilot_token`, `.env`, or `private/` payload to disk from an egg — those are excluded at pack time (`SPEC.md` §12) and a present one signals a tampered or malformed egg; the hatcher quarantines rather than installs it.

> **One-line contract:** *dispatch on `schema`; verify integrity, then viability, then hatch; re-anchor legacy strings once around the same hash; never reparent on transport.*

---

## 6. Trust model

Eggs inherit the estate's trust model verbatim. Three layers, in dependency order:

1. **Content integrity — `sha256` (MANDATORY, shipped today).** Every egg publishes its `sha256` in its hub sidecar (`rapp-egg-hub-entry/2.0`); the `.html` twin publishes `html_sha256`. `hatch` refuses on mismatch (§5.2). This proves the *bytes* weren't tampered between producer and hatcher. It does **not** prove who produced them.
2. **Authorship/consent — GitHub-native (MANDATORY substrate).** An egg enters a public hub by **opening a PR** against that hub; merge is a **gh-collaborator consent** decision; the `rebuild-index` workflow runs `scripts/pii_gate.py` and **fails the build** on any PII/secret (`SPEC.md` §8/§12). For cubbies, authority is **gh-collaborator on the owning namespace**. GitHub *is* the substrate: raw CDN distributes the bytes, Issues are the mailbox, PRs are the consent gate, Pages is the edge. No bespoke server is in the trust path.
3. **Ownership/sovereignty — keypair (OPTIONAL, reserved).** `pubkey`/`sig_suite`/`birth_attestation`/`key_succession[]` let a line *prove* ownership and *survive its operator's death* via signed succession (`SPEC.md` §2/§13). This layer is **opt-in and never required** by any component to accept or hatch an egg (§4.1). `sig_suite: "none"` is conformant. Migrating the suite (`none` → `ed25519` → `slh-dsa`/`ml-dsa-65`) **never changes the identity hash** — crypto-agility on a fixed content-address.

The three layers compose without conflicting: sha256 secures the bytes; gh-collaborator + PR-consent secure publication; the optional keypair secures sovereignty against takedown or death. This is exactly how `MASTER_PLAN` §3 ("no mandatory PKI") and §4 ("un-shutdownable") coexist — un-shutdownability comes from the GitHub-mesh + content-address, not from required cryptography.

---

## 7. Compatibility & migration contract (inherited, NORMATIVE)

Eggs obey the estate-wide compatibility law (`SPEC.md` §14.1), applied to the cartridge envelope:

1. **Liberal in, strict out (Postel).** A **hatcher (consumer)** MUST read **every** egg shape ever shipped: `brainstem-egg/2.0`/`2.1`/`2.2-*`/`2.3-*` *and* the manifest-less `neighborhood-egg/1.0`, with 128-bit *or* 256-bit identities, with `@owner/slug` *or* bare-slug rappids. A **packer (producer)** MUST emit **only** the current canonical shape: a `brainstem-egg/2.3-<variant>` manifest with a canonical owner-qualified 64-hex rappid (`rappid:@owner/slug:<64hex>`, for newly minted organisms) and the variant's fixed payload-tree.
2. **The hash is the join key.** Two eggs of the same organism — one 128-bit legacy, one canonicalized — are provably one entity because they share the `<hex>` digest. Never the string shape.
3. **Never rewrite identity in place.** Canonicalizing an egg changes only the *string* and records `_migrated_from` + `hash_bits`; bits never change.
4. **One migration moment, recorded; idempotent thereafter.**
5. **Legacy acceptance is PERMANENT.** An egg minted in 2026 MUST still hatch in 2050. No sunset, no flag day. New `schema` variants are **additive**; old hatchers ignore variants they don't recognize by refusing politely (§5.1), never by corrupting.

---

## 8. How eggs compose with the estate

The egg is the **atom of transport**; the estate is what atoms build when linked over GitHub. Composition is **purely by reference over the GitHub substrate** — no central server, offline-degrading, UTC-first.

- **Distribution (raw CDN).** An egg lives at a stable `raw.githubusercontent.com/.../<slug>.egg` URL (recorded as `raw_url` in its sidecar). Anyone with the URL can fetch and hatch — no auth for public eggs, no live service.
- **Discovery (hub index → registry).** A hub's `scripts/rebuild_index.py` aggregates sidecars into `index.json` (`rapp-egg-hub/2.0`). `rapp-god` — the content-addressed registry/observatory — indexes the hub by `rappid` hash and **MUST register the `brainstem-egg/2.3` line** (its archive currently knows the family only through `2.2`). Registration is observation, not a gate: an egg hatches whether or not `rapp-god` has seen it.
- **Consent (PR + Issues).** Adding an egg to a public hub is a PR (collaborator merge = consent); the PII gate runs in CI. Cross-organism requests ride **Issues-as-mailbox**. There is no privileged write path.
- **Scale composition.** A **neighborhood** egg references its member organisms by `rappid` (`members[]`); an **estate** egg references neighborhoods; a **metropolis** is the *mesh* of estates linked over Issues-mailbox / PR-consent / Pages-edge, **not an egg** (it has no single owner to pack it). The egg ladder bottoms out at `session`/`cubby` (one moment / one owner's loose files) and tops out at `estate`; above that, composition is mesh, not file. This is the seam where this spec hands off to the **metropolis mesh-composition spec** (sibling): *eggs are how a thing travels; the mesh is how travelled things find each other.*
- **Offline-degrade & UTC-first.** Every egg is fully hatchable with **zero network** once the bytes are in hand (the sneakernet guarantee). Every timestamp in a manifest, sidecar, and session payload is **ISO-8601 UTC, `Z`-suffixed**, so eggs packed on different machines in different zones sort and merge deterministically.

```
session ─┐
cubby  ──┤ (smallest scale: one moment / one owner)
         ▼
   .egg  ──hatch──►  organism / twin / rapplication   (one brainstem)
         ▼
   neighborhood-egg  ──►  N organisms living together  (one hub)
         ▼
   estate-egg        ──►  N neighborhoods               (one owner's world)
         ▼
   ✦ METROPOLIS ✦  = the GitHub mesh of estates         (no owner — emergent)
        (Issues-mailbox · PR-consent · Pages-edge · raw-CDN · offline-degrade · UTC-first)
```

---

## 9. Conformance & hatchability test vectors

An implementation is **`brainstem-egg/2.3`-conformant** when it (a) reads every variant in §3 including the `neighborhood-egg/1.0` legacy exception, (b) dispatches `hatch` on `schema` per §5, (c) verifies integrity-then-viability and refuses on either failure, (d) re-anchors legacy strings once without changing the hash, and (e) never reparents on transport.

A **packer** is conformant when it emits only canonical `2.3-<variant>` manifests with a root `manifest.json` (§2), a canonical owner-qualified 64-hex rappid for newly minted organisms (§4), and the variant's exact payload-tree root (§3), with the PII gate passing (`SPEC.md` §12).

### 9.1 Hatchability test vectors (one per variant)

| Variant | A conformant hatcher MUST… | …and MUST refuse when |
|---|---|---|
| `2.1` twin | hatch `repo/` + `data/`; confirm `repo/rappid.json` canonical + `repo/soul.md` non-empty before success | `repo/soul.md` missing/empty, or `rappid` non-canonical |
| `2.2-organism` | find `rappid.json` **above** `src/rapp_brainstem/`; boot the contained kernel | `rappid.json` is *inside* `src/` (that's a 2.1, not a 2.2-organism) |
| `2.2-rapplication` | parse the `rapp-application/1.0` manifest; place per `runtime` (RAPP_Store §13) | `singleton/<id>_agent.py` absent |
| `2.3-session` | resume under `source.rappid`'s host organism using `session/transcript.json` | `source.rappid` resolves to no hatchable host |
| `2.3-cubby` | write `cubby/<owner>/` after confirming `cubby.json.owner` set | `cubby.json` missing `owner` |
| `neighborhood-egg/1.0` (legacy) | read leniently (no root manifest; `rappid_uuid` accepted), hatch members | — (read-only acceptance; MUST NOT re-emit under this schema) |
| `2.3-neighborhood`/`-estate` (planned) | — | always refuse to *emit*; reader stub may exist but no conformant producer until the shape ships |

### 9.2 Identity test vectors

- **Legacy 128-bit (live hub):** `rappid:grandma-rose:0d51f2b37c2c4f9a8e5b7f0c92ab4d7e` → hatch accepts, canonicalizes string only, stamps `hash_bits:128` + `_migrated_from`, **never** pads to 64 hex.
- **Native 256-bit (new):** `rappid:@kody-w/wildhaven-ai-homes:37ad22f5…<64hex>` → hatch accepts as-is, `hash_bits:256`.
- **Eternity owner-qualified:** `rappid:@kody-w/generic-twin:<64hex>` → hatch accepts; join on `<64hex>`, do not rewrite to bare-slug.
- **Forbidden:** any `rappid:v4:…` (versioned string) → packer MUST NOT emit; hatcher reads it but canonicalizes (strips the version decoration) on touch.

---

## 10. Worked example — packing and hatching a session egg

**Scenario.** Rose's twin (`rappid:grandma-rose:0d51f2b3…` — a *grandfathered 128-bit* organism) has a working session a family member wants to continue on another laptop. The twin's `lay_egg`-style packer produces a **session egg**.

**1 — Pack.** The packer runs the PII gate (`SPEC.md` §12 — no emails/phones/secrets, **no `.lineage_key`**), then writes `grandma-rose-session-2026-06-28.egg`:

```
grandma-rose-session-2026-06-28.egg
├── manifest.json
├── session/
│   ├── session.json        { "started_at": "2026-06-28T15:02:11Z", "model": "auto" }
│   ├── transcript.json     [ {turn…}, {turn…} ]   (UTC-stamped, ordered)
│   └── soul.md             (the soul active during the session)
└── data/
    └── memory.json         (the facts added this session)
```

`manifest.json`:

```json
{
  "schema": "brainstem-egg/2.3-session",
  "type": "session",
  "exported_at": "2026-06-28T15:40:00Z",
  "exported_by": "@kody-w/twin_agent",
  "source": {
    "rappid": "rappid:grandma-rose:0d51f2b37c2c4f9a8e5b7f0c92ab4d7e",
    "parent_rappid": "rappid:@kody-w/wildhaven-ai-homes:37ad22f5...<64hex>",
    "repo": "https://github.com/kody-w/rapp-egg-hub.git",
    "commit": "a1b2c3d",
    "name": "grandma-rose"
  },
  "brainstem": { "version": "0.12.2", "source_repo": "https://github.com/kody-w/RAPP.git", "source_commit": null },
  "bundled_repo": false,
  "bundled_state": true,
  "repo_file_count": 0,
  "data_file_count": 1,
  "pubkey": "", "sig_suite": "none", "birth_attestation": null, "registry_anchor": null, "attestation": null
}
```

Note: `source.rappid` is **32-hex (128-bit)** — packed faithfully (a grandfathered organism, read-accepted under §7), **not padded** to 64. `bundled_repo:false` because a session ships no kernel; it resumes on the receiver's existing twin.

**2 — Sneakernet.** The packer also bakes the egg into a single-file `.html` (`SPEC.md` §11) with a JS-free `data:` download anchor, and the family member sends it over Teams. The recipient downloads the `.egg` with JavaScript disabled — it just works.

**3 — Hatch.** The recipient's Twin agent runs `hatch`:

1. Opens the zip, reads `manifest.json`, sees `schema: brainstem-egg/2.3-session` → dispatches to the **session reader**.
2. Computes local `sha256`, matches the sidecar/`expect_sha256` → integrity OK.
3. **Viability:** `session/session.json` and `session/transcript.json` parse; `source.rappid` resolves — the recipient already has `grandma-rose` hatched. ✓
4. **Legacy re-anchor:** the 128-bit `source.rappid` is canonicalized *as a string only* (already in `rappid:<slug>:<hex>` shape, so a no-op beyond stamping `hash_bits:128`); the hash is **unchanged**, `_migrated_from` recorded once.
5. **No reparent:** `parent_rappid` (`wildhaven-ai-homes`) is preserved untouched — transport, not birth.
6. **Materialize:** the transcript and `data/memory.json` delta resume **under the existing `grandma-rose` organism**; no new identity is minted. The session continues on the second laptop, in Rose's voice, with her memory intact.

**Result.** One file, handed person-to-person, brought a unit of work alive on someone else's hardware — verified, identity-faithful, ancestry-preserving, with zero server in the path. That is the `.egg` family doing its one job at the session scale; the same contract, dispatched on `schema`, does it at every other scale.

---

## 11. Versioning & stability

- `brainstem-egg` is a **family keyed by `schema`**. New scales arrive as **new `2.3-<variant>` members** (or a later minor), **never** as a new top-level wire. The zip+root-`manifest.json` envelope is frozen.
- The **manifest is additive and versionless in spirit** — new needs become new optional keys (mirroring `SPEC.md` §2/§14), never a breaking rename. The one rename already absorbed (`rappid_uuid` → `rappid`, v2.0) is the last; legacy `rappid_uuid` is read forever (§7).
- **Legacy acceptance is permanent** (§7.5). Every shipped variant — including the manifest-less `neighborhood-egg/1.0` — hatches forever.
- This document is registered in **`rapp-god`** as the authority for the `brainstem-egg/2.3` line and supersedes `SPEC.md` §7.

---

## 12. References

- [`SPEC.md`](./SPEC.md) — Digital Twin Specification (`rapp-rappid-spec/2.0`); §2 identity, §7 (superseded by this doc), §8 hub, §11 `.html` twin, §12 PII gate, §14.1 compatibility contract.
- [RAPP_Store `rapp-application/1.0`](https://github.com/kody-w/RAPP_Store/blob/main/SPEC.md) §13 — the rapplication runtime contract (referenced by `2.2-rapplication`, not duplicated).
- `rapp-cubby/1.0` — cubby semantics (referenced by `2.3-cubby`).
- [`rapp-moment/1.0` / `rapp-eternity/1.0`](https://github.com/kody-w/rapp-moment) — content-addressed eternity identity (`rappid:@owner/slug:<64hex>`, PKI-free, keypair optional).
- [`rapp-god`](https://github.com/kody-w/rapp-god) — content-addressed registry / drift observatory; registers this `2.3` line.
- [`agents/twin_agent.py`](./agents/twin_agent.py) — reference `hatch`/`lay_egg`/`summon`/`boot` lifecycle.
- [Constitution Articles XXXII–XXXV](https://github.com/kody-w/RAPP/blob/main/CONSTITUTION.md) — kernel sacredness, single-parent lineage, license stability.
- *Metropolis mesh-composition spec* (sibling) — how estates compose into a metropolis over the GitHub mesh (the scale above the egg ladder).

---

## 13. Conformance notice

An egg packed against `brainstem-egg/2.3` will hatch on every rapp-installer'd brainstem today and forever. The envelope (zip + root `manifest.json`) is frozen; the family grows only by additive variants; identity is a PKI-free sha256 content-address with keypair sovereignty strictly optional; legacy 128-bit and manifest-less eggs hatch permanently; and `hatch` verifies integrity-then-viability and never rewrites ancestry on transport. The hub will not accept eggs that fail the manifest contract (§2) or the PII gate (`SPEC.md` §12) — that is the compact between contributors and downstream hatchers.