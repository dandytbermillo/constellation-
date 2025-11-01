# Spotlight Toolbar Cascade – Outstanding Issue Report

## Scenario
Using the new hover-toolbar controls to promote “personal info” (a Knowledge Base top-level folder) into the spotlight should bring its entire subtree forward. If any descendant (e.g. `testing`) already has its contents inline-expanded, those children should advance as well. Currently the inline-expanded branch stays in place—the children remain at the inline depth even though the parent gets the spotlight halo.

## Attempted Fixes (Failed)
1. **Cascade traversal via `collectCascadeTargets`**  
   - Added constellation-aware traversal so we enqueue descendants even when they lack `parentId`.  
   - Result: `testing` appears in `inlineResult` but the array still uses the `_center` id; the normalized folder id is missing. Children remain untouched.

2. **Promote inline nodes into the expanded set**  
   - During `promoteBranchToSpotlight`, merged `inlineSnapshot` into `expandedConstellations`.  
   - Effect: the parent folder (`testing`) gains a halo, but because the spotlight traversal never descends into constellation centers, the children stay behind.

3. **Depth traversal update in `branchDepthOverrides`**  
   - Treated `child.isCenter` as folder-like when recursing.  
   - In practice, the Knowledge Base centre still short-circuits because the normalized ids don’t match the `_center` ids coming from the cascade, so no recursion occurs and children stay at their original depth.

## Why It Still Fails
- Both `collectCascadeTargets` and the spotlight traversal operate on normalized ids (no `_center` suffix) when assigning depth layers. Inline-expanded nodes only appear in the snapshots as `_center` ids, so the traversal doesn’t recognize them.  
- Even after including `isCenter` in the recursion check, the traversal still can’t find the actual folder node because the `_center` id never resolves to a normalized id inside `itemsByNormalizedId`.
- As a result, only the parent receives spotlight depth; the inline-expanded subtree is untouched.

## Next Steps
1. **Normalize inline ids during cascade**  
   - When collecting inline descendants, push both the raw id and `normalizeId(id)` into the snapshots so downstream logic can match the non-center node.
2. **Ensure `visitDescendants` resolves `_center` ids**  
   - When recursing, try `itemsById.get(child.id)` first, then fall back to the normalized variant so `_center` entries resolve to the actual folder object.
3. **Retest promote/demote flow**  
   - Confirm logs show normalized ids for inline nodes.  
   - Verify spotlight traversal assigns new layers to the grandchildren.

These adjustments should let the promoted spotlight walk down inline-expanded constellation centres and bring their children forward with the parent.
