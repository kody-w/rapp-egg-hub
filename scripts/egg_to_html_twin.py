#!/usr/bin/env python3
"""egg_to_html_twin.py — turn a .egg cartridge into a single-file .html twin.

The .html IS the twin (like agent.py IS the agent): it shows a RAR holo trading card,
carries the whole egg baked in as base64, and is the primary way a normal person
receives/trades a twin — because a raw .egg has no file association, but an .html opens
in any browser. JS-FREE downloads (data: URI anchors) so it survives Teams preview.

Conforms to SPEC rapp-rappid-spec/2.0 (single rappid standard, no PII).

Usage:  python3 scripts/egg_to_html_twin.py eggs/<slug>.egg [--out twins/<slug>.html]
Produces: twins/<slug>.html  (contains: holo card, the egg, and an exportable
          self-bootstrapping drag-in hatch agent .py)
"""
import argparse
import base64
import html
import io
import json
import os
import re
import sys
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)


# ── RAR holo-card mint (rapp-card protocol): the seed IS the card ──
def seed_hash(s):
    h = 0
    for c in s:
        h = ((h << 5) - h + ord(c)) & 0xFFFFFFFF
    return h


def mulberry32(seed):
    state = [seed & 0xFFFFFFFF]
    def _r():
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        z = state[0]
        z = ((z ^ (z >> 15)) * ((z | 1) & 0xFFFFFFFF)) & 0xFFFFFFFF
        z = ((z ^ (z >> 7)) * ((z | 61) & 0xFFFFFFFF)) & 0xFFFFFFFF
        z = (z ^ (z >> 14)) & 0xFFFFFFFF
        return z / 0xFFFFFFFF
    return _r


def mint_card(name, tier, tags, deps, version_str, description, env_vars=()):
    rng = mulberry32(seed_hash(name + ":stats"))
    base = {"experimental": 15, "community": 30, "verified": 50, "official": 70}.get(tier, 30)
    try:
        vp = [int(x) for x in str(version_str).split(".")]
        v_bonus = min(15, vp[0] * 3 + (vp[1] if len(vp) > 1 else 0))
    except Exception:
        v_bonus = 0
    tag_bonus = min(20, len(tags) * 3)
    dep_pen = min(20, len(deps) * 5)
    env_bonus = min(15, len(env_vars) * 5)
    desc_bonus = min(10, len((description or "").split()) // 5)
    clamp = lambda v: max(10, min(100, int(v)))
    stats = {
        "HP":  clamp(base + v_bonus + tag_bonus + rng() * 25),
        "ATK": clamp(base + tag_bonus + desc_bonus + rng() * 30),
        "DEF": clamp(base + env_bonus + v_bonus + rng() * 20),
        "SPD": clamp(base + 20 - dep_pen + rng() * 25),
        "INT": clamp(base + desc_bonus + tag_bonus + rng() * 20),
    }
    return stats, (seed_hash(name) & 0xFFFFFFFF)


# ── the drag-in hatch agent template (baked into each .html; self-bootstrapping) ──
HATCH_AGENT_TEMPLATE = r'''"""hatch_<SLUG>_agent.py — self-contained twin hatcher.

Drag this single file into your locally running RAPP brainstem's agents/ directory.
The brainstem reloads agents every request, so no restart is needed — just invoke it.
It carries an entire RAPP twin baked in as a base64 .egg; on invoke it self-bootstraps:
unpacks the twin into ~/.rapp/twins/, ready to boot. No .egg file, no viewer, no extra
downloads. Conforms to SPEC rapp-rappid-spec/2.0.

Actions: hatch (default) | info | boot
"""
import base64, io, json, os, re, socket, subprocess, sys, time, zipfile
from agents.basic_agent import BasicAgent

EGG_B64 = "__EGG_B64__"
TWINS_DIR = os.path.expanduser("~/.rapp/twins")


def _hash_from_rappid(rappid):
    if not rappid:
        return rappid
    if rappid.startswith("rappid:"):
        body = rappid[len("rappid:"):]
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
    return bare if re.match(r"^[a-f0-9]{32}$", bare) else (rappid or "twin")


def _sluggify(name):
    s = re.sub(r"[^a-z0-9_-]+", "-", (name or "").lower()).strip("-")
    return s or "twin"


def _unpack(blob, twins_dir):
    if blob[:4] != b"PK\x03\x04":
        raise ValueError("embedded egg is not a valid zip cartridge")
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        manifest = json.loads(z.read("manifest.json"))
        src = manifest.get("source") or {}
        rappid = src.get("rappid") or manifest.get("rappid")
        if not rappid:
            raise ValueError("egg manifest missing rappid")
        name = src.get("name") or "twin"
        ws = os.path.join(twins_dir, f"{_sluggify(name)}__{_hash_from_rappid(rappid)}")
        os.makedirs(ws, exist_ok=True)
        for entry in z.namelist():
            if entry.endswith("/") or entry == "manifest.json":
                continue
            if ".." in entry.split("/") or entry.startswith("/"):
                continue
            if entry.startswith("repo/"):
                target = os.path.join(ws, entry[5:])
            elif entry.startswith("data/"):
                target = os.path.join(ws, ".brainstem_data", entry[5:])
            else:
                target = os.path.join(ws, entry)
            os.makedirs(os.path.dirname(target), exist_ok=True)
            with z.open(entry) as s, open(target, "wb") as d:
                d.write(s.read())
        return ws, rappid, manifest


def _free_port(a=7100, b=7200):
    for p in range(a, b):
        with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
            if s.connect_ex(("127.0.0.1", p)) != 0:
                return p
    return a


class HatchTwinAgent(BasicAgent):
    def __init__(self):
        self.name = "__AGENT_NAME__"
        self.metadata = {
            "name": self.name,
            "description": (
                "Hatch the bundled RAPP twin '__DISPLAY__' baked into this agent file. "
                "action='hatch' unpacks it into ~/.rapp/twins/ (self-bootstrapping, no .egg needed); "
                "action='info' shows what's inside without unpacking; action='boot' hatches then "
                "starts it on its own port."
            ),
            "parameters": {
                "type": "object",
                "properties": {
                    "action": {"type": "string", "enum": ["hatch", "info", "boot"],
                               "description": "hatch | info | boot"},
                },
                "required": [],
            },
        }
        super().__init__(name=self.name, metadata=self.metadata)

    def perform(self, **kwargs):
        action = (kwargs.get("action") or "hatch").strip()
        try:
            blob = base64.b64decode(EGG_B64)
        except Exception as e:
            return "Error decoding embedded egg: %s" % e
        if action == "info":
            with zipfile.ZipFile(io.BytesIO(blob)) as z:
                man = json.loads(z.read("manifest.json"))
                src = man.get("source") or {}
                ags = sorted(n[len("repo/agents/"):] for n in z.namelist()
                             if n.startswith("repo/agents/") and n.endswith(".py")
                             and "/" not in n[len("repo/agents/"):])
            return json.dumps({"name": src.get("name"), "kind": src.get("kind"),
                               "haiku": src.get("haiku"), "rappid": src.get("rappid"),
                               "agents": ags, "egg_bytes": len(blob)}, indent=2)
        try:
            ws, rappid, man = _unpack(blob, TWINS_DIR)
        except Exception as e:
            return "Hatch failed: %s" % e
        name = (man.get("source") or {}).get("name") or "twin"
        out = ["Hatched '%s' into:" % name, "  %s" % ws, "  rappid: %s" % rappid]
        if action == "boot":
            bs = os.path.join(ws, "brainstem.py")
            if os.path.exists(bs):
                port = _free_port()
                try:
                    log = open(os.path.join(ws, ".hatch_boot.log"), "a")
                    subprocess.Popen([sys.executable, bs], cwd=ws,
                                     env=dict(os.environ, PORT=str(port)),
                                     stdout=log, stderr=log, start_new_session=True)
                    out.append("  Booting on http://127.0.0.1:%d/ (give it a few seconds)" % port)
                except Exception as e:
                    out.append("  Boot failed: %s — run: cd %s && PORT=%d python brainstem.py" % (e, ws, port))
            else:
                out.append("  (no brainstem.py — load its agents into your brainstem instead)")
        else:
            out.append("  To boot: re-invoke with action='boot', or `cd` in and run `PORT=7100 python brainstem.py`.")
        return "\n".join(out)
'''


def esc(s):
    return html.escape(str(s) if s is not None else "")


def build(egg_path, out_path=None):
    blob = open(egg_path, "rb").read()
    b64 = base64.b64encode(blob).decode()
    with zipfile.ZipFile(io.BytesIO(blob)) as z:
        manifest = json.loads(z.read("manifest.json"))
        names = z.namelist()
        agents = sorted(n[len("repo/agents/"):] for n in names
                        if n.startswith("repo/agents/") and n.endswith(".py")
                        and "/" not in n[len("repo/agents/"):])
        # discover tier/tags/version from a lead non-memory agent manifest, if any
        tier, ctags, cver = "verified", [], "1.0.0"
        for n in names:
            if n.startswith("repo/agents/") and n.endswith(".py") and "memory" not in n and "basic_agent" not in n:
                body = z.read(n).decode("utf-8", "ignore")
                mm = re.search(r'"quality_tier"\s*:\s*"([^"]+)"', body)
                if mm:
                    tier = mm.group(1)
                tg = re.findall(r'"tags"\s*:\s*\[([^\]]*)\]', body)
                if tg:
                    ctags = [t.strip().strip('"\'') for t in tg[0].split(",") if t.strip()]
                vv = re.search(r'"version"\s*:\s*"([^"]+)"', body)
                if vv:
                    cver = vv.group(1)
                break

    src = manifest.get("source") or {}
    name = src.get("name") or "twin"
    haiku = src.get("haiku") or manifest.get("haiku") or ""
    kind = src.get("kind") or manifest.get("type") or "twin"
    desc = src.get("description") or ""
    slug = re.sub(r"[^a-z0-9_-]+", "-", name.lower()).strip("-") or "twin"
    ctags = ctags or [kind]

    stats, name_seed = mint_card(name, tier, ctags, [], cver, desc or haiku)
    hue = name_seed % 360
    TIER_RANK = {"experimental": "◆ Seed", "community": "◆◆ Common",
                 "verified": "◆◆◆ Verified", "official": "◆◆◆◆ Official"}

    # drag-in agent (template + baked egg), base64'd for a JS-free data: download
    agent_name = "Hatch" + re.sub(r"[^A-Za-z0-9]", "", name.title()) or "HatchTwin"
    agent_src = (HATCH_AGENT_TEMPLATE.replace("__EGG_B64__", b64)
                 .replace("__AGENT_NAME__", agent_name)
                 .replace("__DISPLAY__", name))
    agent_fn = f"hatch_{slug}_agent.py"
    agent_b64 = base64.b64encode(agent_src.encode()).decode()

    haiku_html = "<br>".join(esc(l.strip()) for l in haiku.splitlines() if l.strip()) or "<span class='dim'>(twin)</span>"
    stat_cells = "".join(
        f"<div class='stat'><div class='v'>{v}</div><div class='k'>{k}</div>"
        f"<div class='bar'><i style='width:{v}%'></i></div></div>" for k, v in stats.items())

    h1, h2, h3 = hue, (hue + 60) % 360, (hue + 120) % 360
    css = ("""*{box-sizing:border-box}html,body{margin:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif;color:#f5f6fa;
 background:radial-gradient(120% 80% at 50% 0%,#1a1f3a 0%,#0b0e1a 60%);min-height:100vh;
 display:flex;align-items:flex-start;justify-content:center;padding:3rem 1.2rem}
.stage{width:100%;max-width:440px;text-align:center}
.holo{position:relative;border-radius:24px;padding:1.7rem 1.5rem 1.4rem;color:#fff;overflow:hidden;
 background:linear-gradient(155deg,hsl(%H1%,72%%,46%%) 0%%,hsl(%H2%,70%%,40%%) 100%%);
 border:1.5px solid hsla(%H1%,90%%,80%%,.55);box-shadow:0 24px 70px hsla(%H1%,65%%,12%%,.7),0 0 0 1px rgba(255,255,255,.06) inset}
.holo::before{content:"";position:absolute;inset:0;background:linear-gradient(115deg,
 transparent 28%%,hsla(%H1%,100%%,88%%,.4) 44%%,transparent 58%%,hsla(%H3%,100%%,88%%,.28) 76%%,transparent 92%%);
 background-size:250%% 250%%;animation:holo 7s linear infinite;pointer-events:none;mix-blend-mode:overlay}
@keyframes holo{0%%{background-position:0%% 0%%}100%%{background-position:250%% 250%%}}
.holo *{position:relative;z-index:1}
.cardtop{display:flex;justify-content:space-between;font-size:.7rem;letter-spacing:.04em;text-transform:uppercase;opacity:.9}
.egg-emoji{font-size:3.1rem;line-height:1;margin:.5rem 0 .2rem;filter:drop-shadow(0 4px 14px rgba(0,0,0,.4))}
.haiku{font-size:1.1rem;font-style:italic;line-height:1.6;margin:.4rem 0 .6rem;text-shadow:0 1px 10px hsla(%H1%,60%%,12%%,.7)}
.cardname{font-size:1.5rem;font-weight:800;letter-spacing:-.01em;margin:.1rem 0 .2rem}
.kindpill{display:inline-block;background:rgba(255,255,255,.22);border:1px solid rgba(255,255,255,.45);
 border-radius:999px;padding:.2rem .8rem;font-size:.8rem}
.stats{display:grid;grid-template-columns:repeat(5,1fr);gap:.4rem;margin:.9rem 0 .2rem}
.stat{background:rgba(0,0,0,.24);border-radius:9px;padding:.4rem .2rem}
.stat .v{font-size:1.1rem;font-weight:800}.stat .k{font-size:.56rem;letter-spacing:.06em;opacity:.8}
.bar{height:3px;border-radius:3px;background:rgba(255,255,255,.25);margin-top:.28rem;overflow:hidden}
.bar i{display:block;height:100%%;background:#fff}
.lede{font-size:1.35rem;font-weight:600;line-height:1.4;margin:2rem 0 1.4rem;color:#fff}
.cta{display:inline-block;background:#fff;color:#11142a;border:none;border-radius:999px;padding:1rem 2.4rem;
 font-size:1.1rem;font-weight:700;cursor:pointer;text-decoration:none;box-shadow:0 10px 30px rgba(0,0,0,.45);transition:transform .12s ease}
.cta:hover{transform:translateY(-2px)}
.three{list-style:none;padding:0;margin:1.8rem auto 0;max-width:300px;text-align:left}
.three li{display:flex;align-items:center;gap:.7rem;margin:.55rem 0;font-size:1.02rem;color:#dfe3f2}
.three li span{flex:none;width:1.7rem;height:1.7rem;border-radius:50%%;background:hsla(%H1%,70%%,55%%,.25);
 border:1px solid hsla(%H1%,80%%,70%%,.5);color:#fff;font-weight:700;font-size:.85rem;display:flex;align-items:center;justify-content:center}
.needrapp{margin-top:2rem;font-size:.95rem;color:#aab0cc}
a{color:hsl(%H1%,90%%,78%%);text-decoration:none;font-weight:600}a:hover{text-decoration:underline}
.dim{color:#7f87a8}
.more{margin-top:2.5rem;text-align:left;font-size:.85rem}
.more summary{cursor:pointer;color:#7f87a8;text-align:center;list-style:none}
.more summary::-webkit-details-marker{display:none}
.morebody{color:#aab0cc;margin-top:1rem;background:rgba(255,255,255,.04);border-radius:12px;padding:1rem 1.1rem}
pre{background:#05070f;border:1px solid #232a45;border-radius:8px;padding:.7rem .8rem;font-size:.72rem;overflow:auto;white-space:pre-wrap;color:#c8cee6}
.link{color:hsl(%H1%,90%%,78%%);font-weight:600;text-decoration:underline}
"""
           .replace("%H1%", str(h1)).replace("%H2%", str(h2)).replace("%H3%", str(h3)))

    doc = f"""<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>{esc(name)} — a digital twin</title><style>{css}</style></head><body>
<div class="stage">
  <div class="holo">
    <div class="cardtop"><span>RAPP&nbsp;&middot;&nbsp;digital twin</span><span>{esc(TIER_RANK.get(tier, tier))}</span></div>
    <div class="egg-emoji">\U0001F95A</div>
    <div class="haiku">{haiku_html}</div>
    <h1 class="cardname">{esc(name)}</h1>
    <div class="stats">{stat_cells}</div>
  </div>
  <p class="lede">Someone made you a digital twin.<br>Bring it to life in three taps.</p>
  <a class="cta" href="data:text/x-python;base64,{agent_b64}" download="{esc(agent_fn)}">Get {esc(name)}</a>
  <ol class="three">
    <li><span>1</span>Download it above.</li>
    <li><span>2</span>Drop it into your RAPP brainstem.</li>
    <li><span>3</span>Say hello.</li>
  </ol>
  <p class="needrapp">Don't have a RAPP brainstem yet?
    <a href="https://kody-w.github.io/rapp-installer/" target="_blank" rel="noopener">Set it up in a minute &rarr;</a></p>
  <details class="more"><summary>Other ways to open it</summary>
    <div class="morebody">
      <p>No brainstem, comfortable with a terminal? Paste this one line to install RAPP:</p>
      <pre>curl -fsSL https://microsoft.github.io/aibast-agents-library/install.sh | bash</pre>
      <p style="margin-top:.8rem">Prefer the raw file for the rapp twin agent?
        <a class="link" href="data:application/octet-stream;base64,{b64}" download="{esc(slug)}.egg">Download the .egg</a></p>
    </div>
  </details>
</div>
</body></html>"""

    out_path = out_path or os.path.join(REPO, "twins", f"{slug}.html")
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        f.write(doc)
    return out_path, {"name": name, "kind": kind, "tier": tier, "agents": len(agents),
                      "egg_bytes": len(blob), "stats": stats, "haiku": bool(haiku)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("egg")
    ap.add_argument("--out", default=None)
    a = ap.parse_args()
    if not os.path.exists(a.egg):
        print("egg not found:", a.egg); sys.exit(1)
    out, info = build(a.egg, a.out)
    print(f"Wrote {out}")
    print(f"  {info['name']} | {info['kind']} | tier {info['tier']} | "
          f"{info['agents']} agents | {info['egg_bytes']:,} bytes | stats {info['stats']}")


if __name__ == "__main__":
    main()
