# The Cursed Cemetery — first playable stage

## Implemented route

Safe arrival → lone emerging zombie → mausoleum roof and optional lance chest → lower burial chamber and crypt key → locked cemetery gate → traversal and the cursed tree → interior crypt with a low crouching passage → chapel courtyard defence → gravedigger rescue → chapel checkpoint → **Grave Guardian** → destroy the cursed bell → unlocked exit and score screen.

The first stage no longer uses endless random spawning or timed bosses. Authored encounters fire once, cleared enemies stay cleared, ground enemies use a shared placement validator, and the bell stops further undead spawning. The guardian has a warning, charge and recovery cycle and becomes faster below half health.

Three ground enemy variants: shambler, grave-burster and armored zombie. Bats supply the airborne threat. Slimes and frogs are excluded from the production stage. All emerging enemies have a short harmless emergence period and soil debris.

One armor charge absorbs the first contact hit; the next unprotected hit is lethal. The optional lance deals two projectile damage instead of one. The chapel checkpoint restores health and armor while retaining the key, rescued prisoner and weapon. It lasts for the current run; the best score and opt-in setting remain persisted separately.

The view covers about 260 logical pixels vertically (462 horizontally at 1672×940), replacing the previous close zoom. Native-aspect masonry is used for stairs, while flat bridge segments retain gothic arches. Foreground mist and gravestones are drawn after the terrain and actors, with reduced opacity near the player. The background is a continuous joined panorama; entering the internal crypt is a bounded, doorway-framed section rather than a whole-biome swap.

## Owning files

- `HubGame.tsx`: S/D/Down controls, HUD, checkpoint restart, completion/results screen.
- `hubRunStages.ts`: stage geometry, encounters, objectives and landmarks.
- `hubRunCemetery.ts`: encounter/objective progression, courtyard defence, checkpoint, guardian/bell/exit sequence and rewards.
- `hubRunPlacement.ts`: shared placement and physics-derived reachability graph.
- `hubRunModel.ts`, `hubRunRules.ts`, `hubRunEnemies.ts`: crouching hurtbox, enemy variants, lance damage and guardian behavior.
- `hubGothicArt.ts`, `hubCemeteryArt.ts`, `hubGothicGame.css`: local images, wider camera scale, scenery, interior crypt, soil and foreground layers.

## Verification

- Game tests cover placement/safe radius, reachable mandatory objectives and optional roof, no encounter respawn, key/gate ordering, lance pickup/damage, checkpoint restoration, guardian-before-bell ordering, bell-before-exit completion, crouching collision and the inner crypt.
- A deterministic walkthrough completes the entire stage using only movement, jump and weapon inputs. It does not teleport, alter health, remove enemies or directly complete objectives.
- Chromium checks exercise S and D separately (D does not move the knight), crouching and low attack poses, pause/resume, narrow HUD layout, scene rendering and the completion screen. Section screenshots use test-only starting positions; those hooks are not present in production files.
- TypeScript and frontend production build pass. Scoped game lint is clean. The full frontend lint exits successfully with warnings in unrelated existing Code Studio/TOML files.

## Remaining limits

Native Wails/WebView acceptance, first-time-player pacing and difficulty balancing remain manual. Equipment loss now emits physical helmet/plate debris and switches to a separately painted bare-headed character atlas. Synthesized sound is included; dedicated music, a camp/shop, cross-session stage saves and stages 2–5 are outside this first-stage slice. The user-provided 5–10-minute pacing target has not been established by playtesting.

Generated art and prompt specifications are recorded in `README.md` beside these assets. No upstream game code or Capcom asset files were imported.

## Bridge reference pass

Authored cemetery terrain now uses `hubBridgeArt.ts`: broad open arches on level spans, continuous masonry behind stairs, matching elevated arches, extended foundations, and red banners/shields bearing the original adOmnia logo. The camera composition exposes more structure below the walking surface. Stairs are clipped against the existing collision profile and anchored to world coordinates so they do not change shape with camera movement. Checked in Chromium at the entry bridge and mausoleum rise/descent. Native WebView validation remains open.

## Latest user corrections

E or S opens a nearby chest and displays a real equipment reward, an open lid and rising item. Rewards cannot repeat. F and its water projectile were removed entirely. The monk now awards coins. The optional platforms are reduced to four purposeful reachable ledges with masonry supports. Heraldry is limited to two authored banners across the level and the menu emblem. Verification: 110 game tests pass, TypeScript/scoped lint/build pass; browser keyboard E opening and resulting lance count checked, chest and tree-layout screenshots inspected.

Bone throwers (2026-11-10): three authored ranged zombies at the mausoleum, beyond the locked gate and in the inner crypt replace existing walkers without increasing encounter counts. Each has two hit points, a 0.6-second raised-arm tell and a 1.8-second recovery. They only throw while visible and between 42–210 logical pixels away. Bones travel at 135 px/s on a shallow ballistic arc aimed at the standing ground-level torso/head position at release, never homing on a jump. Standing is hit; a timed jump or crouch avoids the same projectile. Bone simulation is isolated in `hubRunBones.ts`; 113 game tests pass, including wind-up, direction, no offscreen/pointblank firing and actual jump/crouch avoidance. Production build/type check and scoped lint pass.

## Original cartoon action direction — 2026-11-11

The first level now adds the hammer (heavy, short reach, 4 damage, 0.7-second cycle) and daggers (eight directions, 0.13-second interval), retaining the sword and limited lance. Acquire weapons from chests, then use 1–4 to select. Armor progresses steel → green (two plates, +12% running speed) → purple (two plates, faster/piercing throws) → gold (three plates, +1 damage). Painted armor-specific attack/locomotion sheets preserve the red-caped knight's identity. Zombies have exaggerated shuffles, hit reactions and tumble/death poses; heavy hammer kills throw the body through a short ballistic arc.

Environment additions are animated flames, gust-driven leaves, triggered crows/crypt debris and two smashable urns with coin rewards. Prior corrections are integrated: four full-sized prisoners escape left until off-screen, the gate opens visibly when the key is used, secrets are environmental discoveries, and bursters no longer show an orange floor ring. The underground ravine remains deferred. Exact numbers, pickup sources and native validation limits are recorded in `ACTION-DESIGN.md` in the user's game-design folder.

## Current opening sequence and green-only rule

The initial encounter now combines a visible rising hand and tipping grave, recoverable arm loss and enemy knockback collisions, one waking gargoyle with fixed-target dive and scenery crash, a usable falling gravestone, a fifth prisoner, a hinted cracked-wall treasure and a bell/ranged-threat transition. Events follow player actions rather than a non-interactive thirty-second timer. A fourth optional secret is added near the first rescued gatekeeper. The monk's cage and potion chest are separated to avoid overlapping interactions.

Up jump is restored; Shift + arrows + D provides stationary dagger aiming. The only first-level armor pickup is restoring green: acquisition restores two hearts; six seconds free of damage restores a missing heart. The old +12% green movement bonus is removed. Repeated armor rewards refill green and never unlock purple/gold in level one. Higher-tier art and distinct mechanics are retained for later stages only.
