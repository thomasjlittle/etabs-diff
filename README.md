# etabs-diff

Visual diff for ETABS models. Point it at two exports of the same model (`.e2k` or the `.$et` ETABS writes on save) and it shows what changed: members added, removed, or modified in a 3D view, plus tables for the non-spatial stuff like materials, load cases, and combos.

Built for a 6 hour hackathon, so specs and team splits live in `docs/` once they land.

Never commit real project models. Use the synthetic fixtures in the repo, or a dummy model built for testing.
