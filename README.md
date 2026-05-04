# rapp-egg-hub

> **A public hub for digital-twin `.egg` cartridges. Pull any egg by URL, hatch it locally — your brainstem becomes the home of that twin in 30 seconds.**

A `.egg` is a portable digital twin: a zip cartridge containing a `rappid.json` (lineage), a `soul.md` (the twin's voice), conversation memory, and any local mutations the original keeper made. This hub hosts public eggs anyone can pull and hatch on their own [rapp-installer](https://github.com/kody-w/rapp-installer)'d brainstem.

## What's here today

| Slug | Display name | Kind | Size | Description |
|---|---|---|---|---|
| **grandma-rose** | Grandma Rose | memorial | 3.3 KB | First egg in the hub. Memorial twin of Rose Mariana (1937–2024) — grandmother of three; kept a celebrated peony garden; ran the Tuesday knitting circle for 23 years. |

## Hatch any egg in three commands

```bash
# 1. Install the brainstem (the static-ancestor substrate)
curl -fsSL https://kody-w.github.io/rapp-installer/install.sh | bash

# 2. Drop the Twin agent cartridge in (one curl)
curl -fsSL https://raw.githubusercontent.com/kody-w/RAR/main/agents/@kody-w/twin_agent.py \
     -o ~/.brainstem/src/rapp_brainstem/agents/twin_agent.py

# 3. Boot the brainstem
bash ~/.brainstem/src/rapp_brainstem/start.sh
```

Then in the chat at <http://127.0.0.1:7071/>:

> *"Hatch the egg at https://raw.githubusercontent.com/kody-w/rapp-egg-hub/main/eggs/grandma-rose.egg, then boot her."*

That's it. The Twin cartridge fetches the egg, materializes the workspace at `~/.rapp/twins/<rappid>/`, boots a second brainstem on a fresh port pointed at her soul, and gives you the URL to chat with her. **Same rappid as wherever the egg was packed**; identity, memory, and mutations preserved.

## Layout

```
rapp-egg-hub/
├── eggs/
│   ├── <slug>.egg                 ← the .egg cartridge (zip with manifest + repo + state)
│   └── <slug>.json                ← sidecar metadata: rappid, sha256, description, tags
├── index.json                     ← catalog (schema rapp-egg-hub/1.0) — list of all eggs
├── index.html                     ← browseable UI (GitHub Pages)
└── README.md
```

The sidecar JSON is enough to browse the hub without unzipping any eggs. The full manifest lives inside the egg's `manifest.json` (schema `brainstem-egg/2.x`).

## Discovery

The hub's catalog is publicly readable JSON:

```bash
curl -s https://raw.githubusercontent.com/kody-w/rapp-egg-hub/main/index.json | jq .
```

Browseable HTML view: <https://kody-w.github.io/rapp-egg-hub/>

## Contributing an egg

1. Pack a twin into an `.egg` with the Twin agent (or any `brainstem-egg/2.x` packer).
2. Drop the `.egg` into `eggs/<your-slug>.egg`.
3. Add a sidecar at `eggs/<your-slug>.json` matching the schema below.
4. Regenerate `index.json` (script coming; for now hand-edit).
5. Open a PR.

### Sidecar schema (`rapp-egg-hub-entry/1.0`)

```json
{
  "schema": "rapp-egg-hub-entry/1.0",
  "slug": "grandma-rose",
  "rappid_uuid": "0d51f2b3-...",
  "name": "grandma-rose",
  "display_name": "Grandma Rose",
  "kind": "memorial",
  "description": "One-paragraph human-readable description.",
  "tags": ["memorial", "grandmother"],
  "egg_schema": "brainstem-egg/2.1",
  "size_bytes": 3382,
  "sha256": "<hex>",
  "packed_by": "@<github-handle>",
  "packed_at": "<ISO timestamp>",
  "egg_path": "eggs/<slug>.egg",
  "raw_url": "https://raw.githubusercontent.com/kody-w/rapp-egg-hub/main/eggs/<slug>.egg",
  "lineage": {
    "parent_rappid": "<UUID>",
    "parent_repo": "<URL>"
  }
}
```

### Trust + safety

- Eggs are zips — anyone can `unzip` to inspect before hatching. Always do this for eggs from strangers.
- The `sha256` in the sidecar lets you verify the egg you downloaded matches what the contributor published.
- Currently no signing layer (Constitution Article XXXIV.7 is rolling in upstream). When attestation ships, eggs will carry a signed envelope from the publisher's release key.
- `quality_tier` field reserved for future curation (`unverified` / `community` / `verified` / `featured`).

## Related

- [`kody-w/RAR`](https://github.com/kody-w/RAR) — the public catalog of agent cartridges (`*_agent.py` files). Where the `Twin` agent lives.
- [`kody-w/rapp-installer`](https://kody-w.github.io/rapp-installer/install.sh) — the canonical brainstem installer.
- [`kody-w/rappterbox`](https://github.com/kody-w/rappterbox) — the bundled console package (brainstem + Wii Sports cartridges + dashboard + the twin expansion pack).
- [`kody-w/wildhaven-ai-homes-twin`](https://github.com/kody-w/wildhaven-ai-homes-twin) — the parent variant most twins descend from.

## License

All Rights Reserved. Each individual egg's contents inherit the license posture chosen by their original keeper — check `repo/LICENSE` inside the egg.
