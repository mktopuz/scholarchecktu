# Scholarly Creator (v3)

A guided, beginner-friendly builder that creates a thesis, dissertation, or journal
paper as an Overleaf project. The user fills in boxes — title, author, abstract,
chapters, figures, tables, equations, references — and the app writes the LaTeX
and downloads a `.zip` to open in Overleaf (New Project → Upload Project →
Recompile). Everything runs in the browser tab; nothing is uploaded anywhere.

## Templates shipped

- **University of Tulsa — Graduate School** (theses/dissertations): uses the
  official TU LaTeX package. The TU style file (`TUthesis_2026.sty`) is bundled
  inside the generated `.zip`, so it compiles in Overleaf as-is. Thesis/dissertation
  toggle, committee size, abstract word count (150 thesis / 350 dissertation),
  and figure/table page switches are set from the user's input.
- **MIT Thesis Template** (official, via Overleaf's gallery / TeX Live): uses the
  documented `mitthesis` class commands. The class is part of Overleaf's TeX Live.
- **Generic thesis** (plain LaTeX): report class, Letter paper, 1-inch margins,
  double spacing. Works anywhere.
- **IEEE (IEEEtran), ACM (acmart), Elsevier (elsarticle)** journal templates:
  official classes, all part of Overleaf's TeX Live.

## What's in the builder

- 7 guided steps: document kind + template → details → front matter (with live
  abstract word count) → chapters/sections → figures (image upload, bundled in
  the zip), tables (grid editor → booktabs), equations (snippet buttons) →
  references (BibTeX builder) → review, live `.tex` preview, and `.zip` download.
- Chapter text supports plain paragraphs, `**bold**`, `*italic*`, `$math$`, and
  `\cite{key}` citations.
- A "How to open in Overleaf" 3-step guide ships in the app and in every zip
  (`README-OVERLEAF.txt`).

## Files

- `index.html`, `styles.css` (Scholarly royal blue & gold theme)
- `js/templates.js` (template registry; TU style file injected at build time)
- `js/latex.js` (escaping, markup conversion, per-template builders, BibTeX)
- `js/app.js` (wizard state, editors, JSZip export)
- `build.py` — injects the TU style file and assembles single-file `preview.html`

## Build

```
python3 build.py   # writes preview.html (single file, JSZip still via CDN)
```

## Honest limits

- The MIT/Journal outputs assume the official class files in Overleaf's TeX Live;
  they are standard, but always compile once in Overleaf before submitting.
- Generated LaTeX is a starting point: schools' guidelines change, so confirm the
  current requirements before submission.
- The app does not run LaTeX itself — the PDF is built by Overleaf after upload.
