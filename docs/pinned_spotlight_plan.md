# Pinned Spotlight Implementation Plan

## Goal
Let users keep more than one constellation branch expanded without losing the “single spotlight” feel:
* The most recently activated folder (via double-click) keeps the spotlight (layer 0).
* Previously spotlighted branches can be “pinned” so they stay open in the background instead of collapsing.
* Pinned branches step back predictably (layer 1.5, 2.5, …) and remain readable.
* Users can unpin manually or by collapsing the folder.

## Behaviour Summary
| Action | Result |
| --- | --- |
| Double-click an unpinned folder | It becomes the active spotlight (layer 0). Existing spotlight, if any, becomes pinned automatically. |
| Pin command (context menu, Shift+double-click, or explicit button) | Marks the current spotlight branch as pinned and lets users bring another branch forward. |
| Unpin command | Removes the branch from pinned list; if it was also expanded, the default collapse logic applies. |
| Collapse pinned branch | Removes it from pinned state and resets depth to baseline. |

## Data Model Additions
* `state.pinnedBranches: string[]` ordered list of folder IDs (normalized IDs) representing pinned spotlight branches (from Knowledge Base child downward). Most recent pin sits closest to the active spotlight.
* `state.activeSpotlight: string | null` current leaf folder in the spotlight.

## High-Level Steps
1. **State Setup**
   * Extend `AppState` with `pinnedBranches` (array) and `activeSpotlight`.
   * Initialize from Knowledge Base default, keeping empty arrays when nothing is pinned.

2. **Spotlight Manager Helpers**
   * `normalizeSpotlight(id: string)`: existing helper used for `_center` suffix removal.
   * `getSpotlightBranch(id: string)`: climb to Knowledge Base root to produce `[KB, constellation, …, id]` chain.
   * `applySpotlightLayering(active: string | null, pinned: string[])`: calculate depth offsets for spotlight/pins:
     - Active branch leaf = layer 0, ancestors = 1.5, 2.5, …
     - Pinned branches get layer 2.5, 3.5, … respectively (ordered oldest to newest).
     - Knowledge Base steps back depending on total spotlight depth (`baseLayer + pinnedCount`).

3. **Toggle Logic Updates (`toggleConstellationExpansion`)**
   * When expanding a folder that is not the active spotlight:
     - Normalize ID.
     - If there is an existing `activeSpotlight`, push it onto `pinnedBranches` (if not already pinned).
     - Set new `activeSpotlight` to the newly expanded folder.
     - Derive new spotlight layered offsets via `applySpotlightLayering`.
   * When collapsing the active folder:
     - Pop the last pinned branch (if any) and make it the new active spotlight.
     - If no pinned branches remain, active spotlight becomes null.
   * When collapsing a pinned branch:
     - Remove it from `pinnedBranches` and recompute layering.

4. **Pin/Unpin Actions**
   * Provide command(s) in UI (e.g., context menu or keybinding) that call new hook handlers `pinSpotlight(folderId)` and `unpinSpotlight(folderId)`:
     - `pinSpotlight`: ensure the normalized ID is in `pinnedBranches`, remove it from `activeSpotlight` if necessary, and recompute layering.
     - `unpinSpotlight`: remove from pinned array, leave active spotlight unchanged unless we’re unpinning the current active (in which case the previous pinned branch becomes active).

5. **Depth Calculation Adjustments (`getItemDepthLayer`)**
   * Use the updated spotlight/pinned arrays to assign layers:
     - Active branch items: same logic as current `spotlightStack` (layer 0 for leaf children, parent at 1.5, etc.).
     - Pinned branches: start after the active chain (e.g., 2.5, 3.5, …) and cascade for each pinned branch.
     - Everything else uses baseline depth with global push offset.

6. **Label & Connection Considerations**
   * Keep existing highlight overrides to ensure pinned branches remain legible.
   * Optionally adjust label opacity for older pinned branches to distinguish them from the active spotlight.

7. **UI Indicator**
   * Add subtle pin icon or ring to nodes belonging to a pinned branch to distinguish them from the active spotlight.
   * Provide tooltip or status panel entry listing pinned branches for quick navigation.

## File Touch List
* `src/types/constellation.ts` – extend `AppState` with `pinnedBranches` and `activeSpotlight`.
* `src/hooks/useConstellation.ts`
  - Modify initial state.
  - Add helpers for managing spotlight/pinned chains.
  - Update `toggleConstellationExpansion` collapse/expand flows.
  - Implement `pinSpotlight`, `unpinSpotlight`, and integrate into hook return values.
  - Rework `getItemDepthLayer` to leverage the new layering rules.
* `src/components/ConstellationVisualization.tsx`
  - Optionally add visual cues (pin icon, halo) for pinned nodes.
  - Ensure labels/opacity align with depth updates.
* `docs/pinned_spotlight_plan.md` (this file).

## Testing Plan
1. **Basic Flow**
   * Expand a folder -> becomes active spotlight.
   * Expand a different folder -> previous one gets pinned (still expanded, stepped back), new folder takes spotlight.
2. **Pin Command**
   * While on a spotlighted branch, trigger pin manually -> branch should stay open with a pin indicator; spotlight waits for next double-click.
3. **Unpin/Collapse**
   * Collapse a pinned branch -> it disappears from pinned list, depth simplifies.
   * Unpin via command -> branch stays expanded but returns to baseline depth or collapses per existing logic.
4. **Edge Cases**
   * Rapidly switching spotlight between multiple folders.
   * Pinning/unpinning Knowledge Base child constellations vs nested folders.
   * Ensuring pinned branches in the background stay readable (labels, connections) thanks to current hover overrides.
5. **Regression**
   * Existing hover highlights and drag behavior should still work for spotlight/pinned nodes.
   * Check minimap and status panel updates.

## Risks & Mitigations
* **Layer explosion**: With many pinned branches, depth layering might push nodes too far back. Mitigate by capping pinned count or reusing layers after a certain depth.
* **State desynchronization**: If expansion state and pinned arrays diverge, layering could break. Ensure pinned arrays only contain currently expanded folders; remove pinned status if a folder gets collapsed externally.
* **UI clutter**: Multiple pinned branches might overwhelm the view. Consider dimming older pins or providing a quick “clear pinned” command.

## Suggested Order of Work
1. Update state definitions and helper functions (`normalize`, `buildBranch`, `applySpotlightLayering`). **(~1 hr)**
2. Modify expansion/collapse logic in `toggleConstellationExpansion` to maintain pinned arrays. **(~1 hr)**
3. Implement pin/unpin handlers and expose them to the UI layer. **(~1 hr)**
4. Rework `getItemDepthLayer` to incorporate active & pinned layers. **(~1.5 hr)**
5. Add optional UI cues for pinned branches. **(~45 min)**
6. Manual test + regression pass. **(~1 hr)**
