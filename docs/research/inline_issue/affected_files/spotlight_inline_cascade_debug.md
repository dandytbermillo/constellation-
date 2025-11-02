# Spotlight Cascade vs Inline Expansion – Debug Log Analysis

## Context
- User expectation: Promoting a top-level Knowledge Base folder (e.g. `personal info`) should pull any inline-expanded descendants (`testing`) into the spotlight so grandchildren inherit the forward depth.
- Regression observed: inline-expanded descendants stay in their inline layer even after the parent is promoted.
- Current behaviour: double-clicking `personal info` now triggers the same promotion flow as the hover-toolbar Promote button, so both actions call `promoteBranchToSpotlight`.

## Reproduction Checklist
1. Hover `personal info` ➜ use “Show contents” on `testing` to expand it inline.
2. Promote `personal info` (toolbar button or double-click).
3. Observe: `testing` retains inline depth (grandchildren don’t move forward).

### Log Collection Steps
```bash
# Tail recent spotlight events (adjust interval as needed)
node - <<'NODE'
const { Client } = require('pg');
(async () => {
  const client = new Client({ connectionString: 'postgresql://postgres:postgres@localhost:5432/annotation_dev' });
  await client.connect();
  const res = await client.query(`
    SELECT id, session_id, action, metadata, timestamp
      FROM constellation_debug_logs
     WHERE component = 'SpotlightCascade'
       AND timestamp > NOW() - INTERVAL '5 minutes'
     ORDER BY id;
  `);
  console.log(JSON.stringify(res.rows, null, 2));
  await client.end();
})();
NODE
```

Key actions to scan:
- `promote:before` / `promote:snapshot` / `promote:state`
- `depth:recompute`
- `traversal:processBranch`, `traversal:branchMode`, `traversal:rootVisit`
- `visit:evaluate`, `visit:traversing`, `visit:inlineSkipped`

## Findings

### 1. Inline set before promotion
`promote:before` shows the inline-expanded set contains:
- Knowledge Base (`5874d493…`)
- `personal info` (`6d15e715…`)
- `testing` (`5be33e6f…`)

### 2. Cascade snapshot is correct
`promote:snapshot` / `collect:complete` confirm the cascade includes both the parent and the inline-expanded child. So the snapshot pipeline isn’t losing `testing`.

### 3. Promotion clears inline flags for the branch
`promote:state` logs show:
- `nextInline: ['5874d493…']`
- `removedInline: ['6d15e715…', '5be33e6f…']`

This proves the reducer removes the promoted branch and its inline descendant from `state.inlineExpandedConstellations`. Only the Knowledge Base root stays inline.

### 4. Depth traversal re-enters via Knowledge Base inline branch
`traversal:branchMode` reveals two passes for each depth recompute:
1. The active spotlight branch (`personal info`) runs with `branchMode: 'spotlight-active'`.
2. The Knowledge Base branch still runs with `branchMode: 'knowledge-base'` and `branchHasInline: true`.

`traversal:processBranch` for the Knowledge Base shows `modeHint: 'knowledge-base'`, while `visit:evaluate` entries for `testing` appear with `contextMode: 'inline'` before the spotlight pass occurs. This inline pass assigns depth to `testing` and keeps its children back.

### 5. Root visit ordering
`traversal:rootVisit` confirms the Knowledge Base root is visited (inline) even after `personal info` is promoted. Because Knowledge Base remains inline, that branch still runs in inline mode and re-traverses `testing`.

### 6. Double-click behaviour
Double-clicking `personal info` now triggers `promoteBranchToSpotlight`, so the regression reproduces with either double-click or the toolbar button.

## Hypothesis
The promotion reducer does clear inline flags for the branch, but the Knowledge Base root remains inline, so `branchDepthOverrides` keeps executing a “knowledge-base inline” pass. That pass visits `testing` before (or in addition to) the spotlight pass, locking the subtree to inline depth.

## Next Experiments
1. During promotion, also remove the Knowledge Base (and any ancestor) from `inlineExpandedConstellations`, caching them so demotion can restore inline view. This prevents the knowledge-base inline pass from running while the child is spotlighted.
2. Alternatively, modify `branchDepthOverrides` to skip inline traversal for the promoted root’s ancestors while that spotlight is active.
3. After implementing either change, re-run the log query to verify `traversal:branchMode` no longer reports the Knowledge Base as inline when its child is the active spotlight.

## Appendix – Action Reference
- `promote:before` — Inline/expanded sets prior to cascade.
- `promote:snapshot` — Output of `collectCascadeTargets`.
- `promote:state` — New inline/expanded sets, spotlight/pinned, and inline ids removed.
- `depth:recompute` — Inputs to `branchDepthOverrides`.
- `traversal:processBranch` — Sequence of branch visits, offsets, and inferred mode.
- `traversal:branchMode` — Final traversal mode for the branch.
- `traversal:rootVisit` — Confirms the branch root actually entered traversal.
- `visit:evaluate` — Per-child evaluation context (inline vs spotlight).
- `visit:traversing` — When traversal recurses into a child.
- `visit:inlineSkipped` — Inline-expanded node that failed the `shouldVisit` check.
