# Project documentation

The PDF files under `docs/` are the official readable project artifacts. Their editable Markdown sources live under `docs/_source/` and are converted to PDF with a small reproducible build script.

## Regenerate the PDFs

From the repository root:

```bash
python docs/build_docs.py
```

Build requirements are intentionally small: **Pandoc** and **WeasyPrint**. Graphviz (`dot`) is only required if the architecture diagram source files under `docs/_source/assets/` are changed and need to be regenerated.

The build writes temporary HTML into `docs/_build/`; that directory can be ignored in Git. The versioned PDFs and Markdown source should be committed together when a document materially changes.

## Version lifecycle

- Minor/clarifying evolution: increment `v1.0` to `v1.1`, etc.
- Material scope or architecture change: increment the major version.
- Sprint plans remain historical records after the Sprint.
- Do not silently replace a materially different versioned PDF; add the new version and preserve the prior record according to repository policy.
