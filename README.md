# rapp-egg-hub

> **A public hub for digital twins you can hold in your hand.** Open a twin in your browser, click **Get**, drag the downloaded agent into your RAPP brainstem — and the twin is now yours, living locally, in about 30 seconds.

A twin is a portable being: a `rappid.json` (its identity + lineage), a `soul.md` (its voice), conversation memory, and any mutations its keeper made. This hub now ships every twin as a **single-file `.html`** — the primary way normal people get and trade twins — with the raw `.egg` cartridge kept alongside for the Twin agent.

## The single-file `.html` twin

The `.html` **is** the twin (the way `agent.py` *is* the agent). Open one in any browser and you get:

- A **holo trading card** — the twin's RAR rapp-card, with a deterministically-generated portrait and five stats (HP / ATK / DEF / SPD / INT, each 10–100) plus a tier. Same name always rolls the same card.
- The full egg **baked in as base64** — nothing else to download, nothing to host.
- **JS-free downloads** via `data:` URI links. The Get buttons work even in Teams preview with JavaScript disabled, so you can pass a twin around a chat and anyone can pull it.
- A drag-in **hatch `agent.py`** — drop it into `~/.brainstem/src/rapp_brainstem/agents/` and on first run it self-bootstraps: unpacks the baked egg, materializes the twin's workspace, and brings it home. No commands to copy.

That's the whole flow for most people: **open → Get → drag → done.**

> Power users and the Twin agent can still grab the raw `.egg` directly — it's kept in `eggs/` with no file association, on purpose, so ordinary folks reach for the `.html`.

## Identity: the rappid (a twin's DNA)

Every twin carries a permanent owner-scoped Eternity name written like `rappid:@<owner>/<slug>:<64hex>` — for example `rappid:@example-owner/example-twin:0d51f2b3…` (64 hex characters). The earlier bare-slug shape `rappid:<birth-slug>:<64hex>` is **legacy, read forever, never re-emitted**. The canonical form is **readable** (the slug is the twin's immutable gene name, so you know who it is at a glance, no lookup), **permanent** (the 64-hex full SHA-256 is the authoritative fingerprint — never truncated, never re-versioned), and built to be **ownership-provable** (the record reserves keypair-binding fields so a twin can one day prove who keeps it by signing a challenge, and a line can survive its operator through signed key succession). The identity hash never changes — new capabilities are added as optional fields in the `rappid.json` record, never baked into the string.

## The one hard rule: no PII

**Nothing in this public repo — no twin, no egg, no card — may contain personally identifiable information.** No real emails (only `noreply`/`@rapp`/`microsoft.com`/`example.com`), no phone numbers, SSNs, tokens or secrets, no `.lineage_key` / `.copilot_token` / `.env`, no customer names or named-person data. The private germline key (`~/.brainstem/.lineage_key`) is never packed into any egg — possessing it would let someone forge a whole lineage.

This is enforced, not just asked: **`scripts/pii_gate.py`** scans every twin, egg, and card before it lands. PRs that trip the gate don't merge. Run it locally before you contribute.

## Layout

```
rapp-egg-hub/
├── twins/                  ← the single-file .html twins (the share artifact — open in a browser)
│   └── <slug>.html
├── eggs/                   ← raw .egg cartridges for the Twin agent
│   └── <slug>.egg
├── scripts/
│   ├── pii_gate.py         ← scans everything for PII; gates contributions
│   └── rebuild_index.py    ← regenerates the catalog from twins/ + eggs/
├── index.json              ← machine-readable catalog
├── index.html              ← browseable gallery (GitHub Pages)
├── SPEC.md                 ← the frozen digital-twin + identity specification
└── README.md
```

## Get a twin (the normal way)

1. Browse the gallery: <https://kody-w.github.io/rapp-egg-hub/>
2. Open any twin's `.html` and click **Get** — the hatch `agent.py` downloads.
3. Drag it into `~/.brainstem/src/rapp_brainstem/agents/`.
4. Boot your brainstem — the twin bootstraps itself and comes home.

Don't have a brainstem yet? Install it first:

```bash
curl -fsSL https://kody-w.github.io/rapp-installer/install.sh | bash
```

## Contributing a twin

1. Pack a twin you own into an `.egg` and render its `.html` with the Twin agent.
2. Drop `twins/<slug>.html` and `eggs/<slug>.egg` into place.
3. Run **`python scripts/pii_gate.py`** — if it flags anything, fix it; PII never ships.
4. Run **`python scripts/rebuild_index.py`** to regenerate `index.json`.
5. Open a PR.

Read [`SPEC.md`](./SPEC.md) before authoring a twin others will hatch — it defines what a twin is, the rappid identity, the egg and `.html` formats, the impersonation rule (every twin must distinguish itself from the human or thing it represents), and the contribution checklist.

## Related

- [`kody-w/RAR`](https://github.com/kody-w/RAR) — the public catalog of agent cartridges, where the `Twin` agent lives.
- [`kody-w/rapp-installer`](https://kody-w.github.io/rapp-installer/install.sh) — the canonical brainstem installer.

## License

All Rights Reserved. Each twin's contents inherit the license posture its original keeper chose — check `repo/LICENSE` inside the egg.
