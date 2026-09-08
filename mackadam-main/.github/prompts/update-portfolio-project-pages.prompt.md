---
name: "Update Portfolio Project Pages"
description: "Update the Heartcore and Hunting Party project pages, then integrate both projects into the existing Works portfolio page."
argument-hint: "Optional: describe visual, content, asset, or navigation priorities"
agent: "agent"
---

Update the portfolio project pages and integrate them into the existing Works page.

## Scope

Work in the existing site structure. Start by reading:

- [Heartcore page](../../heartcxre/index.html)
- [Heartcore design bible](../../HEARTCORE%20%E2%80%94%20Design%20bible%20-%20Copy.txt)
- [Heartcore dev bible](../../HEARTCORE%20%E2%80%94%20Dev%20bible%20-%20Copy.txt)
- [Hunting Party page](../../Hunting_Party/index.html)
- [Works markup](../../works.html)
- [Works behavior](../../works.js)
- [Works styles](../../works.css)

Treat `$ARGUMENTS` as additional direction. If it is empty, infer the smallest coherent improvement from the current files and available assets.

## Workflow

1. Inspect the current markup, scripts, styles, and nearby assets before editing.
2. Update the Heartcore page so it presents the project clearly, uses workspace-relative asset paths, and remains functional on desktop and mobile. Preserve useful existing model-viewer behavior unless it is broken.
3. Update the Hunting Party page so its presentation is polished, its local assets resolve from the workspace, and its content remains readable and usable on desktop and mobile. Preserve its narrative tone and existing interactions.
4. Add both projects to the existing Works page using its current project-card, dropdown, and viewer patterns. Keep the project indexes and event behavior synchronized across `works.html` and `works.js`; do not replace the Works page with a new framework or architecture.
5. Use existing assets where possible. Do not invent filenames: search the workspace and choose real files, or use a resilient fallback when an asset is unavailable.
6. Keep edits focused. Do not rewrite unrelated portfolio entries or remove existing viewer functionality.
7. Validate every changed local link and asset path, inspect the resulting pages at desktop and narrow mobile widths when browser tooling is available, and run the cheapest relevant HTML/CSS/JavaScript validation available in the repository.

## Acceptance criteria

- Heartcore and Hunting Party each have a clear, working page entry point.
- Both projects are discoverable from the Works page and open through its existing content viewer or an appropriate existing link pattern.
- All new local paths resolve relative to the file that uses them; no machine-specific absolute paths are introduced.
- Existing Works projects and viewer behavior continue to work.
- Layouts do not overlap or become unusable at narrow widths.
- The final response names changed files, summarizes the integration, and reports validation results and any unresolved asset limitations.

Implement the changes directly; do not stop at a proposal.
