# Spotlight Toolbar Cascade – Implementation Plan

## Goal
Give every folder’s hover toolbar an explicit control to “move entire branch into the spotlight” and another to “return entire branch back out of the spotlight.” The control should:
- Promote the selected folder to the spotlight and ensure all visible descendants (including inline-peeked or pinned ones) follow it.
- Demote the branch, collapsing the spotlight view and restoring any prior inline visibility.

This avoids overloading the double-click gesture and makes the bulk action discoverable.

## Current Context
- The hover toolbar is driven from `src/app/page.tsx` (`FolderToolbarState`) and rendered via `ConstellationVisualization` interactions.
- Spotlight state lives in `src/hooks/useConstellation.ts`:
  - `state.activeSpotlight`, `state.pinnedSpotlights`
  - `state.expandedConstellations` (spotlight-expanded folders)
  - `state.inlineExpandedConstellations` (inline hover expansions)
- Depth overrides already traverse spotlight branches (`branchDepthOverrides`), so utilities for walking the visible tree are available.

## High-Level Behaviour
1. **Promote button (icon #1)**
   - Add to the hover toolbar whenever the item is a folder.
   - On press:
     - If the folder is not spotlighted, promote it to `activeSpotlight` (reusing existing `toggleConstellationExpansion` / pin logic).
     - Gather every descendant currently visible via spotlight *or* inline peek; migrate them into `expandedConstellations` and clear inline flags so halo/depth stay consistent.
     - Optional: persist the previous inline set so demote can restore it.
     - Show a hint (e.g., “Branch spotlighted”).

2. **Demote button (icon #2)**
   - Available when the folder is in the spotlight path (active or pinned).
   - On press:
     - Collapse the branch: demote the root (fall back to previous pinned or knowledge-base root) and remove all descendants from `expandedConstellations`.
     - Restore inline peeks using the stored snapshot (bringing non-spotlight folders back to inline state).
     - Show a hint (e.g., “Branch returned to background”).

## Implementation Steps

### 1. Data Helpers in `useConstellation`
- Introduce a memoized traversal helper (similar to `branchDepthOverrides`) that returns:
  - `spotlightNodes`: normalized ids under the current spotlight root (active + pinned).
  - `inlineNodes`: any nodes currently inline-peeked beneath the root.
- Add snapshot bookkeeping (e.g., `cascadeSnapshots` keyed by root id) to remember inline/expanded ids when demoting.
- Expose two new callbacks via the hook:
  - `promoteBranchToSpotlight(folderId: string)`
  - `demoteBranchFromSpotlight(folderId: string)`
  Each should perform a single `setState` that updates spotlight ordering, expansion sets, inline sets, and snapshots.

### 2. Toolbar UI
- Extend `FolderToolbarState` in `src/app/page.tsx` to include the folder’s spotlight status (active, pinned, neither) so the component can decide which buttons to show.
- Update the toolbar rendering (where the eye/toggle icons are drawn) to include two new icon buttons:
  - Promote: visible when the folder is not already spotlighted.
  - Demote: visible when the folder is active or pinned.
- Hook each button to the new callbacks from `useConstellation`.
- Add tooltips/aria labels for clarity (“Spotlight branch”, “Send branch back”).

### 3. State Flow Details
- **Promote flow**
  1. Capture current inline-set snapshot for descendants (store in `cascadeSnapshots`).
  2. Promote root to active spotlight (reuse existing logic for pinned adjustments).
  3. Merge descendant ids into `expandedConstellations`, clearing them from `inlineExpandedConstellations`.
  4. Emit hint/log (optional).
- **Demote flow**
  1. Retrieve snapshot for this root (if absent, derive descendants on the fly).
  2. Remove descendant ids from `expandedConstellations`.
  3. Restore inline ids (re-adding them to `inlineExpandedConstellations`).
  4. Demote root/pinned spotlight states (existing `toggleConstellationExpansion` logic may need a branch to avoid re-promoting).
  5. Emit hint/log.

### 4. Styling & Icons
- Reuse existing icon set (e.g., heroicons or lucide icons already used in the project). Suggested:
  - Promote: upward arrow within circle or “upload” icon (`ArrowUpRightCircle`).
  - Demote: downward arrow within circle or `CornerDownLeft`.
- Keep consistent sizing/spacing with current toolbar icons (check tailwind classes already applied).

### 5. Testing Checklist
1. Hover a spotlighted folder → toolbar shows demote button; click demote → branch collapses, halo removed, inline peeks restored.
2. Hover a non-spotlight folder that has inline-open children → toolbar shows promote button; click promote → folder becomes active spotlight, children inherit halos, inline flags clear.
3. Promote a branch, then demote it immediately → state returns to prior inline arrangement (snapshot restored).
4. Promote multiple branches (one pinned, one active) → pin logic maintains order and the new buttons appear correctly.
5. Ensure single-click/drag/inline toggle behaviours remain unaffected.

### 6. Future Enhancements (Optional)
- Keyboard shortcut surfaces (tooltip copy or onboarding doc).
- Visual feedback (temporary highlight) after clicking the icons.
- Allow the same helper to be invoked from list-side UI (sidebar/panel) for parity.

Follow this plan to add the toolbar controls while reusing the spotlight traversal you already maintain in `useConstellation`.
