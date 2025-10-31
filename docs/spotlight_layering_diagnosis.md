# Spotlight Layering – Diagnosis & Fix Record

## Symptoms Observed
- **Grandchildren popping forward**: Double-clicking `my documents` pushed the folder itself to layer 1, but deeper descendants such as `Draft → Proposal` remained at layer 0 and displayed in front of their ancestors.
- **Missing spotlight halo on deep nodes**: After the inline peek state cleared, spotlighted grandchildren like `proposal` rendered without the expected glowing circle, signaling they never received spotlight depth metadata.
- **Branch inversion after spotlight swap**: When `test 4` became the active spotlight, the previously spotlighted `draft` branch flipped—its children jumped to the foreground while `proposal` slid backward, reversing the prior layering.
- **Inactive branch children jumping forward**: Even without peeking `proposal`, promoting `test 4` to the spotlight caused `draft`’s children to leap to layer 0 despite no direct interaction with that branch.

## Root Cause
- **Alternating depth rule**: `visitDescendants` in `src/hooks/useConstellation.ts` used `layer >= 1 ? layer - 1 : layer + 1`. Every traversal step toggled layers between 0 and 1, so any change to the branch root layer swapped which generation appeared in front.
- **Shallow traversal state**: Because the alternating rule surfaced only immediate descendants, grandchildren never accumulated additional depth and failed to receive spotlight styling.
- **Shared traversal for all branches**: Recomputing `branchDepthOverrides` after a spotlight change replayed the same alternating logic for active, pinned, and inline branches alike, so unrelated branches flipped whenever the root offset shifted.

## Fix Implemented
- **Depth-index traversal**: Replaced the toggle with a depth-index calculation that maps `layer = rootLayer + (depthIndex - 1)` (clamped for the foreground baseline). Descendants now gain monotonically increasing layer values, preventing parity flips.
- **Branch context threading**: Introduced an explicit traversal context (`spotlight-active`, `spotlight-pinned`, `knowledge-base`, `inline`) so inline peeks keep using `parentLayer + 1` while spotlight branches honor the depth-index layering.
- **Spotlight set lookup**: Cached spotlight branch ids to ensure expanded children of spotlighted folders continue to receive depth overrides and styling cues even after inline state clears.

## Verification Scenarios
- Double-click `my documents`, expand `Draft → Proposal`, and confirm each generation steps one layer farther back (layers 0, 1, 2…) with spotlight halos intact.
- Inline peek a sibling branch, then spotlight `my documents`; the inline branch stays behind the spotlighted branch without pulling to the foreground.
- Promote `test 4` to the spotlight and observe that `draft`, `proposal`, and their children retain their relative layering; no nodes flip unexpectedly.
- Collapse inline peeks, swap between pinned spotlights, and verify that previously spotlighted branches hold their stepped layering without glow loss.

Use this record when auditing future changes to `branchDepthOverrides` or the spotlight traversal; the depth-index approach must remain intact to avoid reintroducing the oscillation bugs above.
