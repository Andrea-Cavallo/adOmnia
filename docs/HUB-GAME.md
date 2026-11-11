# Hub game: Cursed Cemetery

The game is opt-in in Settings and opens across the adOmnia window from the Hub's **LET'S PLAY!** button. It is frontend-only, uses local artwork, and does not contact a game service.

## Controls

| Control | Action |
|---|---|
| ← / → | Move |
| ↑ or Space | Jump; hold for the full arc |
| ↓ | Crouch |
| S | Melee attack |
| D | Throw, or swing the equipped hammer |
| Shift + arrows + D | Aim daggers in eight directions while stationary |
| E | Open nearby chests/cages or topple the leaning grave |
| 1 / 2 / 3 / 4 | Select an acquired sword / hammer / daggers / lance |
| Esc / M | Pause / toggle sound |

F and the former holy-water projectile are removed. Up must continue to jump; the aim modifier must not consume Space.

## Equipment

- Sword: balanced melee and an unlimited horizontal projectile.
- Hammer: four base damage, short reach, visible preparation and recovery; never thrown. Killed enemies tumble with a short physical arc.
- Daggers: rapid throws at a normalized speed in eight directions, including vertical and diagonal shots. Collision sweeps both axes.
- Lance: two base damage, a faster horizontal projectile and twelve charges; exhaustion restores the sword. Acquired weapons can be selected again while ammunition remains.

**Only restoring green armor is obtainable in level one**, in addition to the initial steel. Acquisition restores two hearts and two armor charges. After six seconds without damage it recovers one missing heart. Additional armor rewards refill green rather than upgrading further. The earlier green speed bonus is removed.

Purple and gold have separate data and artwork for later levels: purple accelerates throws and pierces a first defeated enemy; gold increases damage and emphasizes heavy impacts. Neither is granted by the cemetery reward path. No legendary armor is introduced in level one.

Losing the final armor charge plays impact, equipment detachment, unarmored stagger and recovery poses. Physical helmet and plate debris accompany the sequence. Reinforced armor retains its appearance until its last charge is lost.

## Authored opening

The opening follows player actions rather than freezing input to enforce a thirty-second cutscene:

1. A hand rises beside a tipping grave before a zombie emerges.
2. A surviving zombie can lose an arm, try to recover it and collide with a second enemy after knockback.
3. A gargoyle wakes from its statue, gives an audible/visual warning and dives toward a fixed target. A dodge can cause a scenery crash.
4. The nearby gravestone can be toppled to crush enemies.
5. A freed gatekeeper hints at the cracked wall to the right, then flees left.
6. The wall conceals treasure. Its discovery triggers a distant bell and a new bone-throwing threat.

The rest of the finite route continues through the cursed tree, key/gate, chapel courtyard, internal crypt, Grave Guardian, bell and exit. Bone throwers use a readable wind-up and shallow ballistic throws that can be jumped or ducked. The boss has distinct phases and ground shockwaves.

## Discoveries and rewards

Five prisoners give immediate rewards and use a react/exit/run sequence. They match the knight's human scale and run beyond the left viewport without a visible timeout/fade. A buried prisoner is only revealed after the cracked grave is broken.

Four optional secrets use scenery cues rather than suspended crosses: a root cache, a cracked grave, a sealed crypt niche and the gatekeeper's hinted wall. The mausoleum key opens the existing gate with animated leaves and breaking chains, then disappears from the visible inventory. The separate secret underground area reached through a cross-marked ravine remains deferred.

Chests accept E or nearby melee input, remain visibly open and briefly raise their reward. The potion, ammunition and weapon upgrades alter real state and cannot be collected repeatedly. Urns can be smashed for coins. Foliage gusts, flames, crows and crypt debris animate the environment without adding hidden damage.

## Source and validation

The simulation and renderer live in the `frontend/src/components/layout/hub*` modules. Original generated artwork, atlas layouts and reference provenance are documented in `frontend/src/assets/hub-game/README.md`. Runtime sprite preprocessing isolates neighbouring-cell fragments before normalizing bounds.

Focused tests cover weapon timing/damage, projectile collision, armor recovery, the opening interactions, secret/key progression, placement, escape and a full input-driven walkthrough. Chromium checks exercise the actual component's keys, short weapon selections, Up jump, modified directional aim and pause. Native Wails playtesting and first-time-player pacing remain separate acceptance work; automated checks do not establish a fixed thirty-second experience or final difficulty balance.
