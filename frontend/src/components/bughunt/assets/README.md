# Developer Desk assets

Generated with the built-in image generation tool from the three user-supplied reference boards, then copied into this repository. No image service is called by the game. The renderer loads these assets only when Bug Hunt opens.

## Production briefs

- **developer-desk.png**: a richly rendered developer desk at miniature platformer scale; warm desk lamp, blue code monitor, coffee mug, books, cables and stationery; cinematic depth and cool blue accents. Background scenery only, without characters, HUD or baked playable platforms.
- **desk-cast.png**: match the supplied white/cyan a0 robot, folded-paper SOAP Phantom, yellow spring-legged Retry Gremlin and heavy CRT Legacy Brute. Eight separated cells: four a0 poses across the first row (idle, two runs, jump), then phantom, standing gremlin, jumping gremlin, brute. Consistent side-view lighting and full visible silhouettes, solid magenta separation background.
- **desk-materials.png**: isolated miniature-platformer materials matching the desk: thick warm wood, a dark keyboard key, stacked technical books and a USB device, readable fronts and shallow visible tops. No HUD or characters. Interior texture regions are sampled rather than using the studio backdrop.

## Rendering

`deskAssets.ts` holds the measured sprite rectangles and removes magenta once at load time, preserving white/cyan artwork and soft edges. `deskVisuals.ts` maps poses to movement and clips interior material regions to actual collision platforms. These are limited pose animations, not a skeletal 3D rig. Gentle effects suppress movement-based deformation and decorative oscillation.

All three PNG files are source assets; keep them alongside their renderer. The generated background is decorative: gameplay and every combat telegraph are drawn independently.
