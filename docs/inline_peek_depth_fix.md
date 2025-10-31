# Inline Peek Depth Fix

## Background

When we introduced the folder hover toolbar, the intent was to let users **peek** into a folder—show or hide its children—without disturbing the spotlight handoff controlled by double‑click.  
Initially we attempted to reuse the existing depth override that powers multi‑spotlight. The inline toggle simply added the folder (and its ancestors) to the same branch list used by the spotlight stack.

## Symptoms

Because the spotlight override always brings the active branch **forward**:

- Draft’s children dropped to layer 0 (the foreground) instead of sliding back.
- Ancestors such as _my documents_ and even Knowledge Base were reprocessed, so they appeared on the same layer as the inline folder’s children
  – effectively mimicking a spotlight handoff.
- The toolbar still promised “Hide contents,” but visually everything looked like a full spotlight.

## Fix

1. **Separate state** – Added `inlineExpandedConstellations` to the app state so inline peeks are tracked separately from `expandedConstellations` (spotlight/explicit expansions).
2. **Inline-specific traversal** – The depth override now branches:
   - Spotlight branches keep the original behavior (children get `layer - 1`, ancestors stair-step forward).
   - Inline branches use their **base depth** (`getBaseDepthLayer`) and push their children **back** (`layer + 1`) without walking the ancestor chain.
3. **Cleaned toggle** – The hover toolbar now only toggles entries in `inlineExpandedConstellations`. The spotlight stack remains untouched, so double-click continues to control focus.

## Result

- Clicking the toolbar’s folder icon reveals or hides descendants one layer **behind** the folder, leaving the rest of the constellation unchanged.
- Double-click still hands the branch to the spotlight (no regression).
- My documents (and other hubs) remain at their original depths while Draft’s children display in the background.

## Files Touched

- `src/types/constellation.ts` – added `inlineExpandedConstellations` to `AppState`.
- `src/hooks/useConstellation.ts`
  - Inline toggle state management.
  - Depth override now distinguishes spotlight vs. inline branches.
- `src/app/page.tsx` / `src/components/ConstellationVisualization.tsx`
  - Hover toolbar reporting & overlay (unchanged by the depth fix but part of the inline workflow).

With this separation, the inline peek behaves as intended: it shows a folder’s contents in-place without triggering a spotlight handoff or dragging other branches to the front.
