#!/usr/bin/env python3
"""Generate THIRD_PARTY_NOTICES.md from the dependencies that actually ship.

* Node: ``pnpm licenses list --json --prod`` (production dependencies of every workspace
  package, resolved from pnpm-lock.yaml / node_modules; works offline).
* Python: the requirements of services/analysis-python/requirements.txt and their transitive
  runtime requirements, read with importlib.metadata from the interpreter running this script.
  Run it with the analysis service's environment:

      /path/to/venv/bin/python scripts/generate-third-party-notices.py

The container base images (node:22.23.3-alpine3.24, python:3.13.15-slim-trixie, and the infrastructure images in
docker-compose.coolify.yml) carry their own OS package notices; the per-image CycloneDX SBOMs
produced by .github/workflows/docker.yml list them with licenses.
"""
from __future__ import annotations

import importlib.metadata as md
import json
import re
import subprocess
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "THIRD_PARTY_NOTICES.md"
REQUIREMENTS = ROOT / "services" / "analysis-python" / "requirements.txt"
COPYLEFT = re.compile(r"\b(A?GPL|LGPL|EPL|MPL|CDDL|EUPL|SSPL|CC-BY-SA)", re.I)

try:
    from packaging.requirements import Requirement
    from packaging.markers import default_environment
except ImportError:  # pragma: no cover - packaging ships with pip's environment in practice
    Requirement = None


def node_packages() -> list[dict]:
    raw = subprocess.run(["pnpm", "licenses", "list", "--json", "--prod"], cwd=ROOT,
                         capture_output=True, text=True, check=True).stdout
    data = json.loads(raw)
    out = []
    for license_id, pkgs in data.items():
        for p in pkgs:
            if p["name"].startswith("@erppreflight/"):
                continue
            out.append({"name": p["name"], "version": ", ".join(sorted(p.get("versions", []))),
                        "license": license_id, "homepage": p.get("homepage") or ""})
    return sorted(out, key=lambda p: p["name"].lower())


def _license_of(dist: md.Distribution) -> str:
    meta = dist.metadata
    expr = meta.get("License-Expression")
    if expr:
        return expr.strip()
    classifiers = [c.split("::")[-1].strip() for c in meta.get_all("Classifier") or [] if c.startswith("License ::")]
    lic = (meta.get("License") or "").strip()
    if lic and len(lic) < 60 and "\n" not in lic:
        return lic
    if classifiers:
        return " / ".join(sorted(set(classifiers)))
    return "UNKNOWN (see package metadata)"


def python_packages() -> list[dict]:
    names: list[tuple[str, set[str]]] = []
    for line in REQUIREMENTS.read_text().splitlines():
        line = line.split("#", 1)[0].strip()
        if not line:
            continue
        m = re.match(r"^([A-Za-z0-9_.\-]+)(\[([^\]]+)\])?", line)
        if m:
            names.append((m.group(1), set((m.group(3) or "").replace(" ", "").split(",")) - {""}))
    seen: dict[str, dict] = {}
    queue = list(names)
    env = default_environment() if Requirement else {}
    while queue:
        name, extras = queue.pop()
        key = re.sub(r"[-_.]+", "-", name).lower()
        try:
            dist = md.distribution(name)
        except md.PackageNotFoundError:
            seen.setdefault(key, {"name": name, "version": "not installed", "license": "UNKNOWN", "homepage": ""})
            continue
        if key in seen and not extras:
            continue
        meta = dist.metadata
        home = meta.get("Home-page") or ""
        for url in meta.get_all("Project-URL") or []:
            if not home and "," in url:
                home = url.split(",", 1)[1].strip()
        seen[key] = {"name": meta["Name"], "version": dist.version, "license": _license_of(dist), "homepage": home}
        for req in dist.requires or []:
            if Requirement is None:
                if ";" in req:
                    continue
                queue.append((re.match(r"^[A-Za-z0-9_.\-]+", req).group(0), set()))
                continue
            r = Requirement(req)
            if r.marker is not None:
                ok = any(r.marker.evaluate({**env, "extra": e}) for e in (extras or {""}))
                if not ok:
                    continue
            queue.append((r.name, set(r.extras)))
    return sorted(seen.values(), key=lambda p: p["name"].lower())


def section(title: str, pkgs: list[dict]) -> list[str]:
    by_license: dict[str, list[dict]] = defaultdict(list)
    for p in pkgs:
        by_license[p["license"]].append(p)
    lines = [f"## {title}", "", f"{len(pkgs)} packages.", "", "| License | Packages |", "|---|---|"]
    for lic in sorted(by_license, key=lambda k: (-len(by_license[k]), k)):
        lines.append(f"| {lic} | {len(by_license[lic])} |")
    lines.append("")
    for lic in sorted(by_license):
        lines.append(f"### {lic}")
        lines.append("")
        for p in by_license[lic]:
            home = f" — {p['homepage']}" if p["homepage"] else ""
            lines.append(f"- {p['name']} {p['version']}{home}")
        lines.append("")
    return lines


def main() -> int:
    node = node_packages()
    py = python_packages()
    flagged = [p for p in node + py if COPYLEFT.search(p["license"]) or "UNKNOWN" in p["license"].upper()]
    out = [
        "# Third-Party Notices",
        "",
        "> **Generated file — do not edit by hand.** Regenerate with",
        "> `<analysis-service-python> scripts/generate-third-party-notices.py` after dependency changes.",
        "",
        "ERP Preflight is built on the open-source packages listed below. Each package remains under",
        "its own license; the license identifier shown is the one declared in the package metadata.",
        "Full license texts are distributed inside each package (node_modules/<pkg>/LICENSE*, and the",
        "`*.dist-info/licenses` directory of each Python distribution). Container base images and",
        "infrastructure images (PostgreSQL/pgvector, Redis, MinIO, ClamAV) carry their own notices;",
        "the CycloneDX SBOMs produced by `.github/workflows/docker.yml` and `release.yml` list every",
        "OS and language package inside the shipped images.",
        "",
        "## Licenses that need review (copyleft, dual-licensed or undeclared)",
        "",
    ]
    if flagged:
        out += ["| Package | Version | Declared license |", "|---|---|---|"]
        out += [f"| {p['name']} | {p['version']} | {p['license']} |" for p in flagged]
        out += ["", "See SECURITY_REVIEW.md §5 for the assessment of these entries.", ""]
    else:
        out += ["None.", ""]
    out += section("Node.js production dependencies (apps/api, apps/web, apps/local-agent, packages/*)", node)
    out += section("Python runtime dependencies (services/analysis-python/requirements.txt, transitive)", py)
    OUTPUT.write_text("\n".join(out), encoding="utf-8")
    print(f"wrote {OUTPUT.relative_to(ROOT)}: {len(node)} node + {len(py)} python packages, {len(flagged)} flagged")
    return 0


if __name__ == "__main__":
    sys.exit(main())
