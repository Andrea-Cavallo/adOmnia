# First-level animation quality pass

2026-11-10. AFTER audit, per the user's session choice.

The production cemetery now uses separately painted zombie, bonecaster, Guardian and prisoner frames, rather than bending a single static image. Source rectangles preserve per-cell offsets while sharing local bounds. Browser contact-sheet inspection confirms alternating legs and arms, consistent feet placement, and a genuinely bare-headed unarmored knight.

Authored encounters exclude the shielded enemy and flyers. First contact strips armor and emits helmet/plate debris; the next unprotected contact kills. Checkpoints restore one armor charge. The bonecaster faces its target; the burster warning includes a ground danger ring. Existing prisoner escape simulation now renders painted running frames.

Evidence: 105 game tests pass, including equipment loss, lethality, prisoner escape, encounter progression and the input-only walkthrough. TypeScript, scoped lint and production build pass. Chromium screenshots: `quality-frames.png`, `quality-world.png`, `quality-bare.png` in the session visualization folder.

Open: native Wails playtest and difficulty tuning. Bursters reuse the zombie walk; prisoners share one running character. Guardian walking has two poses. Equipment debris remains geometric. No claim that all first-level art or animation is final.
