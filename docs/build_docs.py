#!/usr/bin/env python3
"""Build official PDF documentation from Markdown sources.

Requirements: pandoc, WeasyPrint, Graphviz only when regenerating diagrams.
Run from repository root: python docs/build_docs.py
"""
from __future__ import annotations
import subprocess
from pathlib import Path
import sys

DOCS = Path(__file__).resolve().parent
SRC = DOCS / "_source"
BUILD = DOCS / "_build"
TEMPLATE = SRC / "template.html"
STYLE = SRC / "style.css"

DOCUMENTS = {
    SRC / "00-project" / "Hotel_Reservation_Project_Handbook_v1.0.md": (DOCS / "00-project" / "Hotel_Reservation_Project_Handbook_v1.0.pdf", True),
    SRC / "01-product" / "Product_Backlog_v1.0.md": (DOCS / "01-product" / "Product_Backlog_v1.0.pdf", True),
    SRC / "02-architecture" / "System_Architecture_v1.0.md": (DOCS / "02-architecture" / "System_Architecture_v1.0.pdf", True),
    SRC / "02-architecture" / "ADR-001_Modular_Monolith.md": (DOCS / "02-architecture" / "ADR-001_Modular_Monolith.pdf", False),
    SRC / "03-sprints" / "sprint-01" / "Sprint_01_Plan_v1.0.md": (DOCS / "03-sprints" / "sprint-01" / "Sprint_01_Plan_v1.0.pdf", True),
    SRC / "04-engineering" / "Claude_Code_Engineering_Guide_v1.0.md": (DOCS / "04-engineering" / "Claude_Code_Engineering_Guide_v1.0.pdf", True),
}


def run(cmd: list[str]) -> None:
    print("+", " ".join(str(x) for x in cmd))
    subprocess.run(cmd, check=True)


def main() -> int:
    BUILD.mkdir(parents=True, exist_ok=True)
    for source, (output, include_toc) in DOCUMENTS.items():
        output.parent.mkdir(parents=True, exist_ok=True)
        html = BUILD / (source.stem + ".html")
        pandoc_cmd = [
            "pandoc", str(source),
            "--from", "markdown+raw_html",
            "--to", "html5",
            "--standalone",
            "--embed-resources",
            "--toc-depth", "2",
            "--template", str(TEMPLATE),
            "--resource-path", f"{source.parent}:{SRC}:{SRC / 'assets'}",
            "-o", str(html),
        ]
        if include_toc:
            pandoc_cmd.insert(7, "--toc")
        run(pandoc_cmd)
        run([
            "weasyprint",
            "-s", str(STYLE),
            str(html),
            str(output),
        ])
    print(f"Built {len(DOCUMENTS)} PDF documents.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
