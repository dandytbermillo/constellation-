# One-Step Spotlight Layers – Implementation Plan

Goal: Keep the current constellation layout, but ensure that whenever a folder is expanded into the spotlight, each level of that newly-opened branch differs by only one depth layer. Existing layer‑0 items stay untouched. This keeps parent–child connections visible while retaining the layered “dive” effect.

---

## Current Behaviour Snapshot
- When a folder is spotlighted, its children drop to layer 0 (as desired) but ancestors jump multiple layers back (Knowledge Base often goes −2 or more).  
- The connection renderer skips lines whose endpoints differ by more than two layers; therefore once ancestors move too far back, their connections disappear even though the nodes remain visible.

## Desired Behaviour
1. Spotlight leaf’s immediate children remain at layer 0 (unchanged).  
2. Each ancestor of the spotlight leaf should sit exactly one layer further back (leaf parent at +1, grandparent at +2, etc.).  
3. Deeper descendants (grandchildren, great-grandchildren) revealed under the spotlight leaf inherit the same one-step rule: child at 0, its child at −1, next at −2, etc.  
4. All other branches or pinned paths stay at their current layering rules to avoid altering unrelated regions.

---

## Step-by-Step Implementation Outline

1. **Audit Depth Helpers**
   - In `src/hooks/useConstellation.ts` inspect:
     - `getItemDepthLayer`
     - `getBaseDepthLayer`
     - Spotlight/pinned stack helpers (if any remain).  
   - Confirm how the current offsets are computed for spotlight ancestors and descendants.

2. **Introduce Spotlight Branch Utility**
   - Add a helper that returns the active spotlight chain (leaf plus all ancestors up to Knowledge Base).  
   - Another helper: given a leaf ID, map every node in that branch (ancestors and descendants) to the target depth offsets:  
     * leaf children: 0, leaf: 1, parent: 2, grandparent: 3, etc.  
     * leaf grandchildren: −1, great-grandchildren: −2, etc.  
   - Store the mapping in memory (e.g., `spotlightDepthOverrides: Map<string, number>`) per render cycle to avoid repeated calculations.

3. **Rework Spotlight Case in `getItemDepthLayer`**
   - After retrieving baseline depth, check if item ID exists in the override map:  
     * If so, return the mapped depth (0, 1, 2, … or negative for deeper descendants).  
   - Ensure the helper only affects the currently expanded branch; everything else remains as before.

4. **Update Layer Application Order**
   - Make sure the override map is applied whenever spotlight state changes (`toggleConstellationExpansion`, collapse, etc.).  
   - Clear/refresh the map on every spotlight switch to avoid stale values.

5. **Preserve Connection Rendering**
   - After depth adjustments, verify `shouldShowConnection` now keeps the lines because depth differences remain ≤ 2 for parent-child pairs.  
   - No further changes expected if the one-step spacing works as intended.

6. **Manual Verification Checklist**
   - Expand a constellation folder: check leaf children still at layer 0, parent at layer 1, Knowledge Base at layer 2.  
   - Drill two levels deep: confirm each step increments by one (child 0, parent 1, grandparent 2, etc.).  
   - Collapse back to root: layering returns to baseline (no permanent overrides).  
   - Observe that connections remain for the active branch while non-focused branches stay dimmed.

7. **Optional Follow-ups**
   - Once the one-step layers behave, consider thicker strokes or subtle animation for the spotlight branch to compensate for the reduced depth separation. (Handled separately.)

---

## Files to Modify
- `src/hooks/useConstellation.ts`
  * depth helper adjustments and override map.
  * Spotlight toggle/collapse logic to rebuild overrides.
- `src/utils/constellation.ts` (if any shared depth helpers need awareness of overrides).
- Documentation updates (this plan) already captured.

---

## Risk Notes
- **State desync**: Ensure overrides are reset when spotlight changes; otherwise nodes might retain incorrect depths after collapsing.  
- **Performance**: Generating overrides per spotlight change should be lightweight (branch size typically small). Cache or memoize as needed.  
- **Visual overlap**: Verify that reducing layer separation doesn’t cause too much overlap; if it does, highlight/animation will mitigate it.

