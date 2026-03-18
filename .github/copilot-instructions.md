# Copilot Instructions — Analyse Résultats Gatling

## Project overview

Static single-page application (HTML + vanilla JS) that loads a Gatling `stats.json` file from a user-supplied URL and visualises request-group performance statistics.
No build step, no npm, no framework. The "Python project" metadata (`pyproject.toml`) exists only to declare the project; it is **not** used at runtime.

## Key files

| File | Role |
|------|------|
| `index.html` | Markup and CSS only — no inline JS |
| `app.js` | All application JavaScript (loaded via `<script src="app.js">`) |
| `README.md` | Usage guide + Gatling JSON shape documentation |
| `pyproject.toml` | Project metadata (no Python runtime code) |

## Gatling `stats.json` structure

Gatling produces a **tree** of nodes. Each node has:
- **`type`** — `"GROUP"` or `"REQUEST"`
- **`name`** — display name
- **`stats`** — performance metrics object (what we display)
- **`contents`** — child nodes keyed by `pathFormatted` (what we **recurse into but do not display**)

The `stats` object fields:
```
numberOfRequests, minResponseTime, maxResponseTime, meanResponseTime,
standardDeviation, percentiles1 (P50), percentiles2 (P75),
percentiles3 (P95), percentiles4 (P99),
meanNumberOfRequestsPerSecond, group1, group2, group3, group4
```
Each field is `{ total, ok, ko }` (except `group*` which is `{ name, htmlName, count, percentage }`).

## Core data flow (`index.html`)

1. User enters URL → `loadStats()` → `fetch(url)` → JSON
2. `walkNode(node, groupPath[])` recursively flattens the tree into `allRequests[]`
   - Each entry: `{ groupPath, groupParts, name, type, stats }`
   - Group path = breadcrumb of ancestor `name` values joined with ` › `
   - Root node group path = `'(Racine)'`
3. `getSortedRequests()` sorts `allRequests` per `#sort-select`
4. `renderAll()` groups by `groupPath` and emits HTML; card details are collapsible

## Conventions

- **No dependencies**: do not introduce npm, bundlers, or external CDN scripts.
- **Single file**: all CSS, markup, and JS stay in `index.html`.
- **CORS**: the browser fetches `stats.json` directly; serve both files from the same origin (e.g. `python -m http.server 8080`) to avoid CORS errors.
- **Locale**: numbers formatted with `fr-FR` locale (`toLocaleString('fr-FR')`); durations shown as `X ms`.
- **HTML escaping**: always use `escHtml()` before inserting user-supplied or JSON-derived strings into innerHTML.
- **Dark theme**: color palette is fixed — orange accent `#ff6b35`, dark backgrounds `#0f1117` / `#1a1d2e`.

## Import validation rules

Before suggesting any import statement, verify it is real and not hallucinated:

- **JavaScript**: this project uses **no imports at all** — no `import`, no `require()`, no CDN `<script src>`. All code is inline vanilla JS. Any suggested import must be rejected.
- **Python** (scripts or `pyproject.toml` dependencies): only propose packages that exist on [PyPI](https://pypi.org) and that you can confirm by name and version. Do not invent package names or module paths. The stdlib (`http.server`, `json`, `pathlib`, etc.) is always safe; third-party packages must be verified. When in doubt, state the uncertainty rather than guessing.

## Running locally

```bash
python -m http.server 8080
# then open http://localhost:8080
```

Point the URL field to any accessible `stats.json`, e.g.:
```
http://localhost:8080/results/my-simulation/js/stats.json
```

## Test file

Always validate changes against the real Gatling output file at:
```
X:\git\tests-de-charge\target\gatling\testunitaire-20260317165913824\js\stats.json
```

To test: start the dev server from that directory and load the file via the **Fichier local** tab (drag & drop or file picker), or serve it over HTTP:

```bash
python -m http.server 8080 --directory "X:\git\tests-de-charge\target\gatling\testunitaire-20260317165913824\js"
# URL to use: http://localhost:8080/stats.json
```
