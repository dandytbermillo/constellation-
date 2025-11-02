# Inline Spotlight Regression – Research Plan

## Problem Summary
- Promoting `personal info` (Knowledge Base branch) should pull inline-expanded descendants (e.g. `testing`) into the spotlight, so their children inherit the forward depth.
- Despite removing inline flags during promotion, `testing`'s children remain at inline depth; visual behaviour hasn’t changed.
- Logs show multiple traversal passes (knowledge-base and spotlight) and per-node depth assignments, but not the final render state of grandchildren.

## Hypotheses to Validate
1. **Depth override ordering**: Knowledge Base inline pass may still overwrite spotlight layers for `testing`'s children even after we suppress inline traversal.
2. **Render layering**: The depth value assigned via `branchDepthOverrides` may be overridden later by `getItemDepthLayerUtil` or `getBaseDepthLayer` fallback logic.
3. **State restoration**: Some asynchronous path (e.g. event handlers, other hooks) might re-add `testing` to the inline set after the promote reducer runs.

## Research Tasks
1. **Trace depth assignment end-to-end**
   - Instrument `getItemDepthLayer` to log final depth per node (via `debugLog`, not console).
   - Compare with `depth:assignItem` events to detect overrides.
   - File: `src/hooks/useConstellation.ts` (getItemDepthLayer).

2. **Verify inline state after render**
   - Add a post-layout effect (`useEffect`) to log `state.inlineExpandedConstellations` once the scene renders after promotion.
   - File: `src/hooks/useConstellation.ts`.

3. **Check Knowledge Base traversal ordering**
   - Ensure we short-circuit the knowledge-base branch entirely when `pending promotion` already ran; confirm via new log (`traversal:skipKBInline`).
   - Files: `src/hooks/useConstellation.ts`.

4. **Review base depth util**
   - Inspect `getItemDepthLayerUtil`, `getBaseDepthLayer`, `calculateHierarchyLevel` to see if they clamp or override layers to inline defaults.
   - Files: `src/utils/constellation.ts`.

5. **Visual regression capture**
   - Record a screen capture or screenshot sequence showing node positions before and after promote; attach to the research folder.
   - Store assets in `docs/research/inline_issue/visuals/`.

## Affected Files Dumped
- `src/hooks/useConstellation.ts`
- `src/utils/constellation.ts`
- `docs/debugging/spotlight_inline_cascade_debug.md`

Copies stored in `docs/research/inline_issue/affected_files/`.

## Next Steps
- Implement instrumentation tasks 1 & 2 to capture final depth/inline state.
- Analyse logs to confirm whether an override occurs post-traversal.
- Based on findings, decide whether to adjust depth util or rewrite traversal ordering.
