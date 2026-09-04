# Biohub – Cell Tracking During Development: Plan

Competition: https://kaggle.com/competitions/biohub-cell-tracking-during-development
Deadline: Sep 29, 2026 (final submission) · Sep 22, 2026 (entry/merger)
Prize pool: $60,000 (top 7 places)

## Status log

- [x] Project scaffold + `requirements.txt` created.
- [x] Kaggle CLI installed in `.venv`; API token stored at
      `~/.kaggle/access_token` (new-style `KGAT_...` token, not the legacy
      `kaggle.json` username/key format).
- [x] Confirmed dataset size via `GetCompetitionDataFilesSummary` API:
      **~87.6 GB total, 24,886 files** (mostly extensionless zarr chunk
      shards, ~4.5MB each, chunked as `<dataset>.zarr/0/c/<chunk>/0/0/0`).
      861GB free locally — plenty of room for a full download later.
- [ ] **BLOCKED**: competition requires phone/identity verification before
      the API will serve data (403 on download even after accepting rules —
      `userHasEntered` stays `False` until verification completes). Must be
      done by the user on kaggle.com; not automatable. Waiting on this.
- [ ] Pull a small sample (not the full 88GB) for EDA once unblocked.
- [ ] EDA: inspect zarr structure, dims, voxel scale, label sparsity.
- [ ] Stand up offline scoring harness (edge Jaccard + division Jaccard).
- [ ] Phase 1 baseline (see below) → first submission.

## Task recap

- Input: 3D+time zebrafish microscopy volumes (`.zarr`), per-dataset.
- Output: a graph per dataset — detected cell nodes (t, z, y, x) + edges linking
  cells across consecutive frames, with divisions represented as one node having
  2+ outgoing edges.
- Scored on a combined **edge Jaccard** (linking accuracy, node-count-penalized)
  and **division Jaccard** (mitosis detection accuracy), weight-averaged across
  test datasets.
- Submission is a single `submission.csv` produced by a Kaggle Notebook
  (≤12h runtime, no internet at submit time — pretrained weights must be
  bundled as a Kaggle Dataset input, not fetched live).

## Why this shape of problem

It decomposes cleanly into two stages, and scores each semi-independently:

1. **Detection** — find cell centroids per frame per volume.
2. **Linking / tracking** — connect centroids across time, including divisions.

A strong baseline can get real signal from stage 2 alone if stage 1 is only
decent — the edge metric is forgiving of extra/missed nodes via the penalty
term but rewards structurally correct linking.

## Baseline strategy (Phase 1 — get a valid, scored submission fast)

- **Detection**: pretrained **StarDist 3D** (or Cellpose 3D as fallback) run
  out-of-the-box on each frame. No custom training required to start — just
  correct preprocessing/normalization for this imaging modality. Bundle the
  pretrained weights as a Kaggle Dataset so the no-internet submission notebook
  can load them locally.
- **Linking**: **laptrack** (LAP-based frame-to-frame assignment with native
  division support) or **ultrack** — notably, ultrack is authored by
  Jordão Bragantini, one of this competition's hosts, so it's a natural fit
  for this exact data/metric shape. Gate matches using the metric's own
  distance threshold (7.0 µm scaled) so we're optimizing toward how we're scored.
- **Output**: assemble the `submission.csv` per the spec (`node`/`edge` rows,
  `-1` sentinels, dataset folder name without `.zarr`).
- **Validate offline** against the public evaluation script referenced in the
  competition (edge Jaccard + division Jaccard) using a held-out split of
  training data before ever spending a submission.

## Phase 2 — push past baseline

Once Phase 1 produces a valid, scored submission, iterate in priority order:

1. **Fine-tune the detector** on this competition's labeled training data
   (StarDist3D/Cellpose fine-tuning is well-supported) — likely the single
   biggest score lever given dense/noisy cells are called out as the main
   failure mode.
2. **Tune linking parameters** (distance gating, division cost, gap-closing
   for missed detections across a frame) against the offline metric.
3. **Consider a learned tracker** (e.g. Trackastra-style transformer linker)
   if classical LAP linking plateaus — higher effort, higher ceiling.
4. **Ensembling / post-processing**: lineage-consistency cleanup, removing
   biologically implausible edges (e.g. large jumps, >2-way divisions).

## Immediate next steps

1. ~~Set up Kaggle API credentials on this machine.~~ Done.
2. **Waiting on user**: complete phone/identity verification on kaggle.com
   for this competition (required before any API download works).
3. Once unblocked: pull a small sample first (not the full 88GB) to do EDA
   on `.zarr` structure/scale/sparsity, then decide full-download strategy.
4. Stand up the offline scoring harness so every local experiment is measured
   the same way the leaderboard measures it.
5. Ship the Phase 1 baseline notebook and get a first submission on the board.

## Environment

- Local/cloud GPU for dev; final solution ported into a Kaggle Notebook for
  actual submission (12h runtime cap, GPU, no internet).
- `requirements.txt` in this folder covers the baseline stack.
- Kaggle CLI lives in this project's `.venv` (`.venv/Scripts/kaggle.exe`).
