# Portfolio Website

A single-file portfolio site, built from a resume. No build step, no dependencies to install — it's one `index.html` with inline CSS and JS.

**Live version:** https://claude.ai/code/artifact/297c000e-a4b9-45cd-b267-aee51e08d23b

## How it's built

- **One file.** All CSS is in a `<style>` block, all JS (the little canvas radar animation in the hero) is in a `<script>` block at the bottom. Easiest thing to copy, fork, or hand to someone else.
- **Fonts** load from Google Fonts via a single `<link>` tag: [Big Shoulders Display](https://fonts.google.com/specimen/Big+Shoulders+Display) for headings, [Source Serif 4](https://fonts.google.com/specimen/Source+Serif+4) for body copy, [IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono) for labels/data.
- **Colors** are CSS custom properties (`--bg`, `--text`, `--accent`, etc.) defined once in `:root`, then redefined inside `@media (prefers-color-scheme: dark)` so the page automatically matches the visitor's OS light/dark setting. Change the palette by editing the values at the top of the `<style>` block — nothing else needs to change.
- **Layout** uses plain CSS grid/flexbox with `gap`, no framework.
- **Theme:** a satellite/telemetry motif (the hero canvas draws an orbit + radar sweep), used because the resume this was built from centers on a satellite-based ML project — the visual idea should usually come from whatever's distinctive in the content, not be reused wholesale.

## How to reuse this for your own site

1. Copy `index.html`.
2. Replace the text in each `<section>` with your own experience/projects/skills. The structure (hero → summary → experience → projects → skills → education → contact) is a normal resume-site skeleton and works for most people.
3. Swap the color tokens at the top of `<style>` to fit you, and swap the Google Fonts link if you want a different type pairing.
4. Open `index.html` directly in a browser — that's it, there's nothing to build or install.

## Hosting it for free

Any static host works since it's one HTML file:

- **GitHub Pages** — push this folder to a GitHub repo, enable Pages in the repo settings, done.
- **Netlify / Vercel** — drag-and-drop the folder onto their dashboard.
- **Claude Artifacts** — the link above; private by default, shareable when you choose.