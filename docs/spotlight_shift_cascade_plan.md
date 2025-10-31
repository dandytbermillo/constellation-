# Spotlight Shift+Double-Click Cascade – Implementation Plan

## Goal
Enable a `Shift + double-click` on a folder that is being spotlighted to expand or collapse the entire visible subtree in one gesture. Any child folder that already has its contents shown should mirror the parent’s action, reducing the need to toggle each folder manually.

## Current Behavior Recap
- `handleMouseDown` in `src/hooks/useConstellation.ts` detects double-clicks (within 300 ms) and routes folders to `toggleConstellationExpansion`.
- `toggleConstellationExpansion` manages `state.expandedConstellations` (spotlight expansion) and handles pinned/active spotlight bookkeeping.
- `toggleFolderVisibilityInline` manages `inlineExpandedConstellations` for hover peeks.
- Inline and spotlight expansion states are tracked separately; spotlight expansion takes priority once the folder is the active spotlight.

## High-Level Design
1. **Gesture Detection**  
   - Extend the double-click branch in `handleMouseDown` to recognize `event.shiftKey`.  
   - When the gesture is detected, call a new helper instead of the standard `toggleConstellationExpansion`.

2. **Cascade Helper Responsibilities**  
   - Determine whether the root folder is currently expanded (spotlight or inline).  
   - Collect all descendant folder ids that are visible/expanded via spotlight or inline peek.  
   - Apply the same expand/collapse action to every folder in that set in a single state update.

3. **State Management**  
   - Clone `expandedConstellations` and `inlineExpandedConstellations` before mutating.  
   - For collapse, remove each descendant from both sets (spotlight first, inline second).  
   - For expand, add the target path + descendants to the appropriate set, respecting existing inline/spotlight rules.  
   - Preserve pinned spotlights and active spotlight ordering; only adjust the targeted subtree.

4. **Edge Cases**  
   - Ignore non-folder items (double-click shift should no-op).  
   - Skip folders outside the current spotlight branch to avoid collateral collapse.  
   - If the branch includes pinned spotlights, leave their pinned status unchanged; they will re-expand naturally as spotlight traversal reruns.  
   - Handle overflow nodes gracefully (they shouldn’t trigger the cascade).

5. **Feedback & UX**  
   - Reuse existing `showHint` messaging to acknowledge bulk expand/collapse.  
   - Consider logging the cascade for debugging (`console.log` or `logConstellationFocus`) to trace behavior during QA.

## Implementation Steps
1. **Add Helper**  
   - Create `cascadeSpotlightExpansion(rootId: string, action: 'expand' | 'collapse')` in `src/hooks/useConstellation.ts`.  
   - Build utilities inside it:
     - `collectSpotlightDescendants(rootId)` to gather normalized ids using existing `childrenByParentId` and `normalizeId`.  
     - `applyCascade(action)` to mutate cloned `expandedConstellations` / `inlineExpandedConstellations`.  
   - Ensure the helper returns the updated sets plus any updated `activeSpotlight`/`pinnedSpotlights` if needed.

2. **Wire Gesture**  
   - In the double-click block inside `handleMouseDown`, insert:
     ```ts
     if (event.shiftKey) {
       cascadeSpotlightExpansion(item.id, isCurrentlyExpanded ? 'collapse' : 'expand');
       return;
     }
     ```
   - Fall back to existing logic when Shift is not held.

3. **Update State in One Pass**  
   - Use `setState(prev => ({ ...prev, expandedConstellations: nextExpanded, inlineExpandedConstellations: nextInline, ...spotlightAdjustments }))`.  
   - Reuse existing helper functions for pinned spotlight adjustments if the root’s spotlight state changes.

4. **Testing Checklist**  
   - Double-click + Shift on a spotlight folder with multiple expanded descendants → all collapse.  
   - Re-trigger the gesture to expand them again.  
   - Ensure inline-peeked siblings outside the spotlight branch remain untouched.  
   - Verify pinned spotlights remain pinned.  
   - Confirm no unexpected animation loops or halo changes occur after the cascade.

## Follow-Up Considerations
- Optional: add a keyboard shortcut hint (`Shift+Double-click to expand/collapse subtree`) to onboarding docs or in-app tips.  
- Log the action into existing analytics/debug pipeline if bulk operations need tracking.  
- Consider extending the cascade to support `Shift+click` on the inline peek toggle for consistency.
