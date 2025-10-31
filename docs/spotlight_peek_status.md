# Spotlight & Inline Peek – Current Status

## Summary Of Implemented Work
- Added a **persistent hover toolbar** that supplies two actions for folders: preview (eye) and an inline “show/hide contents” toggle. The toolbar now lives in `page.tsx`, so it doesn’t disappear while you move from the node to the controls.
- Introduced `inlineExpandedConstellations` in app state so inline peeks don’t interfere with the spotlight stack. The hover toggle only touches this set, while double‑click still governs the spotlight (`activeSpotlight + pinnedSpotlights`).
- Updated the depth override to consider inline branches. Inline peeks show children in the background by reusing base layers, whereas spotlight branches continue to use the stepped layering (leaf children at layer 0, parent layer 1, etc.).
- Overflow “+N more” nodes now inherit the parent folder id, so they follow the same depth transitions.

## Current Issue
When a folder like **“my documents”** is double-clicked, its immediate children correctly occupy layer 0 and the folder itself slides back to layer 1.  
However, deeper descendants (e.g. Draft → Proposal → …) still share layer 0 instead of stepping back to layers 1, 2, … . The depth override isn’t walking the descendant chain with the one-step rule, so grandchildren remain up front.

## Attempts That Didn’t Work
- **Reversing the descendant delta** (`layer - 1` → `layer + 1`): This pushed ancestors forward instead of back, causing the entire branch to flatten at layer 0.
- **Conditional delta `layer > 0 ? layer - 1 : layer + 1`**: Brought grandparents forward whenever the parent sat at layer 0, so we oscillated around layer 0 rather than stepping away.
- **Inline-only adjustments** didn’t help because the issue occurs once the branch becomes the active spotlight; inline state is cleared.

Each attempt produced either a flattened branch or reintroduced the earlier “inline and spotlight share the same depth” bug. Those changes were reverted.

## Next Steps
1. **Rework spotlight traversal** so descendant layers are derived from the branch depth (depth index 0 → layer 0, index 1 → layer 1, etc.). Use a BFS/DFS across the active branch instead of subtracting 1 repeatedly.
2. **Ensure inline extrusions coexist** with spotlight layering: when the same branch is both peeked and spotlighted, inline data should be ignored or merged safely.
3. **Regression check** after the new traversal:  
   - Double-click `my documents` → Draft children step back, Draft stays layer 1.  
   - Inline peek a sibling branch → stays in background.  
   - Pinned spotlight logic still works (older branches hold their stepped positions).

This document tracks the state as of the latest work; use it as a reference before attempting the new depth traversal.
