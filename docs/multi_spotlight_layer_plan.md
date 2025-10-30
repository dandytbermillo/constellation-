# Multi-Spotlight Layer Stabilisation Plan

## Intent
Keep the previously-expanded spotlight branch visible (instead of collapsing it) when a new folder takes focus, while ensuring each branch's nodes move back only a single depth layer. This preserves parent/child connections and avoids long "spear" lines. 

The new behaviour should let users drill into a second folder without losing context from the first branch.  The first branch slides back, the new branch takes the front, and any older pinned branches continue to move one notch deeper, all while staying connected.

---

## Key Requirements
1. **No Auto-Collapse** – When a new folder is spotlighted, the old branch must stay expanded. Only user-triggered collapse should hide it.  
2. **Layer One-Step Rule** – Every spotlight branch (current or pinned) should maintain one-layer steps between ancestors and descendants.  
3. **Branch Ordering** – The newest spotlight branch owns layer 0. Each older branch shifts back exactly one extra layer (branch N at depth offset `N`).  
4. **Connections Intact** – Parent/child connections along all spotlight branches remain visible because the depth difference never exceeds two.

---

## State Additions
Augment `AppState` with:
- `activeSpotlight: string | null` – normalized ID for the branch currently owning layer 0.
- `pinnedSpotlights: string[]` – ordered list of normalized branch IDs representing previously spotlighted branches (newest at the end).  

Both store **branch roots** (the folder that was double-clicked). We derive full ancestor chains dynamically.

---

## Implementation Outline

### 1. Branch Normalisation Helpers
- `normalizeBranchId(id: string)` – use existing suffix stripping.
- `getBranchAncestors(branchId)` – climb `parentId` up to Knowledge Base (inclusive).  
- `getBranchDescendants(branchId)` – walks expanded descendants (folders) to map each node to depth offsets.

### 2. Spotlight Stack Management
- Replace the current `spotlightStack` array with `activeSpotlight + pinnedSpotlights`.  
- `setActiveSpotlight(newBranchId)` should:
  1. If `activeSpotlight` exists, push it onto `pinnedSpotlights` (avoid duplicates).
  2. Update `activeSpotlight = newBranchId`.
  3. Optionally trim `pinnedSpotlights` to a configurable maximum to avoid deep stacks.

- `collapseSpotlight(branchId)` should remove the branch from both `activeSpotlight` and `pinnedSpotlights` (and trigger a fallback pinned branch if needed).

### 3. Depth Override Map
- Build a new `Map<string, number>` inside a memo hook every time the spotlight state changes.
  - Start with depth offset `0` for the `activeSpotlight` branch (children 0, leaf 1, ancestors 2, …).
  - Loop through `pinnedSpotlights` oldest → newest, increasing the base offset by 1 for each branch. Example:
    - active branch offset = 0 (children 0, leaf 1, parent 2, …)
    - first pinned branch offset = 1 (children 1, leaf 2, parent 3, …)
    - second pinned branch offset = 2 (children 2, leaf 3, parent 4, …)
  - Propagate offsets to branch descendants only if the folder remains expanded.

### 4. `getItemDepthLayer` Changes
- Query the override map (by both item ID and normalized ID) before fallback logic.  
- If no override exists, keep the existing behaviour for non-spotlight content.

### 5. Expansion Logic (`toggleConstellationExpansion`)
- On expand:
  - Determine normalized folder ID.
  - If the folder is already pinned, bring it back to the active slot (`activeSpotlight = folder` and remove it from `pinnedSpotlights`).
  - Else call `setActiveSpotlight` to move the prior active branch into `pinnedSpotlights`.
- On collapse:
  - If collapsing the active branch, pop the most recent pinned branch to become the new active branch.  
  - If collapsing a pinned branch, remove it from the pinned array.

### 6. Rendering Enhancements
- Connections now stay because depth differences never exceed 1 across branches, but optionally:
  - Double the stroke width for edges belonging to `activeSpotlight` (and slightly dim pinned branches).
  - Add a pin indicator ring on nodes belonging to pinned branches.

### 7. Testing Checklist
1. Double-click `Folder A` (spotlight).  
2. Double-click `Folder B`. `Folder A` remains expanded, slides back, and keeps connections.  
3. Drill deeper into `Folder B`. Each ancestor remains one layer apart from its children.  
4. Collapse `Folder B`: `Folder A` automatically regains the spotlight without losing its structure.  
5. Collapse a pinned branch: it disappears cleanly without leaving stale overrides.  
6. Stress test with three or four spotlight handoffs to ensure offsets and ordering stay consistent.

### 8. Risks & Safeguards
- **Branch explosion** – limit `pinnedSpotlights` length (e.g., max 3) or allow manual clearing.
- **Performance** – branch depth maps are small; memoized computation per state change is acceptable.  
- **State drift** – ensure overrides rebuild whenever expansion state changes, so non-expanded folders do not retain obsolete overrides.

---

## Files to Touch
- `src/types/constellation.ts` – add new state properties.
- `src/hooks/useConstellation.ts` – spotlight/pin state, depth override memo, toggle logic, collapse handling.
- `src/components/ConstellationVisualization.tsx` – optional pin/visual cues.
- Documentation (this plan).

