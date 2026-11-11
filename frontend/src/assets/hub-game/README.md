# Moonlit Keep game art

These local assets were prepared from the user-supplied visual reference on 2026-11-10 using the built-in imagegen tool. They are generated adaptations, not original files extracted from the linked Ghosts 'n Goblins repository.

- `moonlit-cemetery.png`: clean background plate; moon, castle, forest, cemetery and chapel, with HUD, menus and interactive objects removed.
- `gothic-atlas.png`: transparent 4×4 sprite atlas; four idle/running knight poses, jump/fall/attack poses, two slime poses, bat, ghost, coin, bridge module, platform and sword.
- `haunted-forest.png`: a crimson-clouded, overgrown haunted forest, with a great dead tree, ruined well and ragged scarecrows, inspired by the second reference.
- `ruined-abbey.png`: a moonlit ruined cathedral, with broken stained glass, red banners, stone arches and candlelight.
- `undead-atlas.png`: transparent 4×2 atlas; four walking/lunging zombie frames and four blue-hooded, scythe-carrying Reaper frames.
- `knight-crouch-stone.png`: three low knight poses (ready, slash, throw) and a flat masonry tile; stone is tiled at a constant aspect ratio, not stretched into stairs.
- `cemetery-stage.png`: grave-burster, armored zombie, Grave Guardian, crypt key, cursed bell, gravedigger cage, gate, chest and lance.
- `chapel-exterior.png`: the front-facing chapel from the supplied visual reference, without UI, actors or walkable terrain. The moon was removed from this plate so the joined panorama has only one moon.
- `cemetery-foreground.png`: cursed tree, crypt doorway, foreground gravestones and transparent mist.
- `crypt-interior.png`: candlelit burial niches, sarcophagi and pointed vaults, without actors or a baked-in floor.

Prompt specifications: preserve the reference's gothic blue-grey palette, moonlit castle, left chapel with red banner and candlelight; remove UI and interactive objects for the background. For the atlas, use sixteen equal cells with transparent padding and the same detailed painted pixel-art style, right-facing steel-armored knight with red cape, green slime, gothic stonework and gold coin.

`hubGothicArt.ts` determines each cell's alpha bounds at load time and renders the images directly at display resolution. Gameplay collision coordinates remain independent of sprite resolution.

The additional prompts preserve reference 1's detailed painted gothic pixel-art treatment. The forest uses reference 2's tree, well, reeds and scarecrows; the abbey uses broken pointed arches, stained glass and dim amber/crimson lighting. Both prompts exclude HUD, characters and walkable foreground terrain. The undead prompt specifies an eight-cell transparent atlas, left-facing wine-red-clothed zombies and blue-robed skeletal Reapers holding attached scythes, each in four consistent full-body poses.

The production game now uses the finite Cursed Cemetery stage. It pans across one joined cemetery/chapel panorama, includes a separate interior crypt, and ends after the Grave Guardian, bell and exit objectives. Forest/abbey cycling remains only in the legacy simulation used by the existing isolated tests.

Controls: arrows move, Down crouches, Space jumps, S slashes, D throws and C casts charged lightning. S and D can be held for repeated attacks within their cooldowns. Escape pauses. Existing J/X aliases remain available. D no longer moves the player. All assets remain local; the Hub game is still opt-in from Settings.

Additional prompt specifications: match the existing knight and gothic painted pixel art; generate three genuinely crouched knight poses and a rectangular seamless stone wall without arches. Generate a 3×3 transparent sheet of the cemetery enemies and interactables, including an original hooded stone/brass guardian with an iron hammer. Generate a 2×2 transparent sheet containing a complete cursed tree, crypt archway, gravestones and mist. The interior plate describes a dark medieval burial chamber with niches, sarcophagi, roots and candlelight, with no characters/UI/floor. The chapel edit preserves the supplied architecture while removing actors/UI/floor; its subsequent edit removes only the moon.

See `STAGE1.md` for the playable route, verification and remaining limits.

Quality pass (2026-11-10):
- `quality-animation.png`: transparent 4×4 painted frame sheet. Zombie walk 0–3, bonecaster idle/wind-up/release/recover 4–7, Grave Guardian idle/two steps/hammer strike 8–11, fleeing villager run 12–15. Prompt: original gothic characters matching the reference palette, complete limbs and attached weapons, distinct alternating leg/arm poses, consistent cell scale and feet baseline; no floating equipment.
- `knight-unarmored.png`: transparent 4×2 sheet. Standing, two runs, jump, fall, slash, throw, crouch. Prompt: preserve the original knight's red cape, body proportions and identity; remove all steel armor and helmet, show brown hair, cream padded shirt, brown trousers and boots, retain the steel sword.
- `arcade-props.png`: generated supplemental 2×2 prop sheet (water flask, sacred relic, cracked grave, bonecaster); reserved, not loaded by the production renderer.

`hubQualityArt.ts` renders the new painted frames. Production cemetery encounters omit the armored enemy and flyers while the smaller cast is polished. The legacy renderer remains for isolated endless-mode archetypes. `shareRect` aligns local cell bounds while preserving each frame's own atlas offset. Browser contact sheets verified actual leg changes and the unarmored sprite; native WebView playtesting remains open.

`prisoner-escape.png`: 3×2 transparent atlas generated from the original cage/prisoner reference. Closed occupied cage, open empty cage (shovel stays), the same grey-clothed bearded man terrified with mouth open, and three distinct panicked running poses. The geometric overlay prisoner is removed entirely. Captive and empty cage use this sheet; the escape uses its matching actor frames with a brief AAAH caption and synthesized trembling cry. Elevated escape actors land on their platform before running.

`adomnia-bridge.png`: 2×2 transparent modular architecture atlas generated from the user's bridge reference (e7ac3580-220e-4bdc-be1f-07744b781b64.png). Broad stone arch with lanterns, matching masonry wall, blank burgundy banner and blank gold-rimmed shield. Prompt requires a horizontal topmost deck, open transparent arch, chunky blue-grey ashlar, consistent stone coping, sparse ivy and no baked logos. `hubBridgeArt.ts` overlays the actual `/icon-white.png` brand mark, tinted ivory/gold, rather than a generated approximation. The same original logo is masked into the pause/menu ornament. The desktop view reserves 72 logical pixels below the playfield to expose bridge structure; terrain collision is unchanged.

Chest/layout correction (2026-11-10): `chest-rewards.png` is a transparent 2×2 atlas generated from the original chest: matching open chest, red restorative potion, lance and blessed sword. E or S opens nearby chests; the open chest remains and its reward rises briefly with a golden glow. The first chest equips 12 lance throws, the second restores armor and grants an 8-second ward, and the third grants 30 seconds of extended melee reach. No duplicate rewards. The former cursed chest now gives a useful potion. F/holy-water inputs, projectiles, counter and prisoner water rewards were removed at the user's request. Only four optional platforms remain, each with a reachable prize/secret, with short masonry supports rather than repeated overhead bridge arches. Bridge crests appear only on the entry and chapel banners; the pause crest remains.

## Cartoon action pass — 2026-11-11

All following sheets were generated with imagegen from this project's original knight/zombie sheets, not extracted from the reference games. The prompts require full-body original characters, transparent equal-cell atlases, the same red cape and gothic painted palette, and distinct exaggerated poses rather than translated copies.

- `cartoon-action.png` (4×4): silver knight walk/run 0–3; goofy zombie walk 4–7; stunned/tumbling/collapsed zombie 8–11; initial hammer/dagger poses 12–15. Production combat uses the more complete colored sheet below.
- `armor-action.png` (4×3): green, purple and gold rows; idle plus three expressive locomotion frames. A follow-up edit removes the swords from these locomotion hands so weapon switching does not leave a second sword painted onto the body.
- `cartoon-extras.png` (4×2): cartoon bonecaster idle/wind-up/release/recovery; bareheaded linen-clad knight idle/three locomotion poses.
- `armor-combat.png` (4×5): silver, green, purple, gold and unarmored rows; hammer wind-up/impact/ready, dagger release.
- `armor-poses.png` (4×4): silver, green, purple and gold rows; ready/slash/throw/jump.
- `hammer-walk.png` (4×5): four distinct hammer-carrying steps for silver/green/purple/gold/unarmored variants. The prompt expressly requires generous transparent gutters and complete alternating-limb poses.
- `equipment-props.png` (4×2): hammer, daggers, green plate, purple plate, gold plate, intact urn, broken urn and sword. A follow-up imagegen edit removes the original generated white backdrop while preserving the objects.

`hubActionArt.ts` loads these sheets. Atlas preprocessing removes isolated neighbouring-row scanline fragments into an in-memory display canvas before normalizing frame bounds; the source image files remain unchanged. Distinct source cell offsets are preserved. Weapon physics, hit windows, directional collision and armor bonuses live in `hubRunEquipment.ts` / `hubRunThrow.ts`; scenery and breakable urns in `hubLivingArt.ts`. The design contract is `Desktop/game design/ACTION-DESIGN.md`.

`knight-hit-colored.png` (4×4) completes the same four-stage equipment-loss sequence for silver, green, purple and gold armor rows: chest impact, plates/helmet detaching, unarmored stagger, recovery. Generated from the new cartoon knight, colored armor and original linen references, requiring consistent identity, complete bodies and wide transparent gutters. The earlier `knight-hit.png` remains as source artwork; production loads the colored replacement.

Opening sequence correction: `cemetery-sequence.png` (4×2) contains original gargoyle statue/waking/gliding/crashed poses, an emerging hand, a detached dry forearm, upright and leaning gravestones. `one-armed-zombie.png` (2×2) contains startled, two shuffling and arm-retrieval poses matching the original cartoon zombie. Follow-up imagegen edits remove the generated white backdrop and halo without altering the sprites. `hubSetPieceArt.ts`, `hubRunSetPiece.ts` and `hubRunGargoyle.ts` implement the authored opening chain and falling grave. Initial zombies have two hit points and can drop an arm; knockback can collide with a second enemy. All reactions remain original non-gory cartoon art.

LATEST controls/armor override: Up and Space jump. Shift + arrows + D aims daggers without movement/jumping. Level one only grants restoring green armor, refilling two hearts and regenerating one heart after six damage-free seconds. Green speed bonus is removed. Purple and gold data/art remain for later levels but cannot be granted by the cemetery reward path. Opening hints and loading messages are registered with the app's four supported translated UI catalogs; LET'S PLAY! stays the requested branded wording.
