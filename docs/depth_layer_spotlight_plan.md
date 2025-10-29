# Depth Layer Spotlight Plan

## Goal
Create a predictable “spotlight” effect when drilling into constellations:

* The folder you double-click keeps its children on the front plane (layer 0)
* That folder’s node slides slightly back (layer 1.5) so the children stay visible
* Every ancestor and unrelated constellation moves back together only when the folder you clicked was already on layer 0
* Collapsing a folder restores the baseline depth arrangement

## Current Symptoms
* Any expanded folder pushes all of its children to layer 0, even nested ones
* Knowledge Base is forced to layer 0 at all times, so deeper expansions pile into the same plane
* Visual depth hierarchy becomes cluttered after a few nested expands

## Desired Behavior Summary
| Stage | Layer 0 | Layer 1.5 | Layer 1 | Layer 2 | Layer 3+ |
| --- | --- | --- | --- | --- | --- |
| Idle | Knowledge Base | – | Constellation centers | Initial child items | Remaining background |
| Expand folder not yet at Layer 0 | Folder children + Knowledge Base | Folder node | Other constellations | Existing item layers | – |
| Expand folder that was at Layer 0 | Newly active children | Active folder | Knowledge Base + other constellations (pushed back) | Ancestors (each another step back) | Additional depth for further ancestors |
| Collapse | Everything returns to idle layers | | | | |

## Implementation Overview

1. **Track spotlight depth:** Determine whether the folder being expanded was already on layer 0; this drives whether global nodes should step back.
2. **Rework depth rules:** Adjust `getItemDepthLayer` so only the active folder and its children take layers 0 / 1.5, while ancestors and unrelated nodes step back one notch only when needed.
3. **Update knowledge-base handling:** Allow the Knowledge Base to move back with other roots once the spotlight shifts, and return it to layer 0 on collapse.
4. **Provide smooth transitions (optional):** After logic works, consider short easing animations for pan/scale to help users perceive depth changes.

## File Touch List
1. `src/hooks/useConstellation.ts`
   * Rebuild expansion depth logic (spotlight, parents, unrelated nodes)
   * Ensure collapse logic resets depth state
   * Provide helpers to compute expansion stacks and layer offsets
2. `src/utils/constellation.ts`
   * Keep shared depth helpers aware of the new layer ranges (0, 1.5, 2, …)
   * Ensure `getDepthZ`, scale, opacity et al. map the new values
3. `src/components/ConstellationVisualization.tsx`
   * (Optional) Refresh animation/tween hooks if layer transitions should animate
4. `docs/` (this plan) to remain as reference

## Detailed Steps

### 1. Normalize Depth Inputs
* Introduce a single source of truth for the “spotlight level” (which folder currently occupies layer 0)
* Derive a list of ancestor IDs for that folder; these need incremental layer offsets
* Record the previous spotlight so you can snap back when collapsing

### 2. Rework `getItemDepthLayer`
* If the current item is the active folder ⇒ layer 1.5
* If the item is among the active folder’s ancestors ⇒ assign layers 2.5, 3.5, … (one per level)
* If the item is the Knowledge Base or any constellation center not in the spotlight stack:
  * stay on baseline layer 1 until the spotlight moves onto them
  * when a layer 0 folder is opened, shift them to layer 2 (or higher if the hierarchy is deeper)
* Children of the active folder ⇒ layer 0
* All other items ⇒ baseline depth or hidden layer depending on expansion state

### 3. Handle Collapse
* When a folder collapses, clear its spotlight entry
* If no spotlight folder remains at layer 0, restore Knowledge Base and fellow constellations to their baseline layers
* Ensure nested collapses pop the correct ancestor from the spotlight stack (supports multi-level navigation)

### 4. Optional Visual Polishing
* Add small transitions (200–300 ms) to depth-related CSS transforms so users perceive the shift
* Consider a light glow or breadcrumb on the active folder to reinforce which node owns layer 0

## Testing Plan
1. **Baseline sanity:** Reload the app with no expansions; confirm Knowledge Base sits at layer 0 and constellations at layer 1.
2. **Single expand:** Double-click “My Documents”; verify its children occupy layer 0, the folder node slides back, and Knowledge Base remains visible behind them.
3. **Nested expand:** Drill into “Drafts”; ensure only its children move to layer 0, parents stair-step back, and Knowledge Base shifts behind other constellations by exactly one layer.
4. **Multiple levels:** Continue to a third depth; confirm each ancestor occupies a unique layer (0, 1.5, 2.5, …) and unrelated constellations remain further back.
5. **Collapse:** Collapse the deepest folder; check the stack recovers correctly at each step until returning to the idle layout.
6. **Edge scenarios:**
   * Expanding two different constellations sequentially
   * Collapsing a parent while a child is still expanded (should auto-collapse the child)
   * Toggling the Knowledge Base constellation (if allowed) and verifying its depth

## Risks & Mitigations
* **State desync:** A partially collapsed stack might leave nodes on wrong layers. Mitigate by deriving depth strictly from the current spotlight stack rather than incremental mutations.
* **Performance:** Depth computations now involve ancestor lookups. Cache spotlight ancestry and reuse across renders.
* **Visual Pop:** Sudden layer jumps may feel jarring. Optional ease animations or short opacity fades can soften the effect.

## Suggested Timeline
| Step | Task | Estimate |
| --- | --- | --- |
| 1 | Implement spotlight tracking structure | 45 min |
| 2 | Rewrite depth-layer logic & tests | 60 min |
| 3 | Verify collapse / reset flows | 30 min |
| 4 | Optional animation polish | 30 min |
| 5 | Manual regression pass | 45 min |

Total ≈ 3.5 hours including QA. Adjust based on need for visual polish.
