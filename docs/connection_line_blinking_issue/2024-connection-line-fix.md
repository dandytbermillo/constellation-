# Connection Line Blinking Issue

## Summary
- **Cause**: Background constellation connections still carried CSS animations (`connectionGlow`, `connectionPulse`) because the SVG lines always received animation-bearing classes/styles, regardless of focus state. The existing `.connection-no-transition` helper only disabled transitions, so the glow/pulse continued.
- **Fix**: Extend `.connection-no-transition` to cancel animations and apply that class (plus explicit `animation: none`) whenever a rendered connection does not belong to the focused constellation. Also ensure bundled connections respect the same rule and only keep the pulse animation for focused or highlighted lines.

## Affected Files
- `src/app/globals.css`
- `src/components/ConstellationVisualization.tsx`

## Details
1. **CSS update** (`src/app/globals.css:273`): `connection-no-transition` now forces both `transition: none` and `animation: none` (paused) so any line flagged as background stops animating.
2. **Bundled connection handling** (`src/components/ConstellationVisualization.tsx:470-509`): When bundling, we reuse the stored constellation metadata to detect bundles outside the focused constellation and add `connection-no-transition` while explicitly clearing any animation.
3. **Individual connection handling** (`src/components/ConstellationVisualization.tsx:512-598`): We capture `item1Constellation`/`item2Constellation`, skip applying animations to non-focused lines, and only keep `connectionPulse` for focused/highlighted connections.

These changes prevent non-focused constellation connections from glowing or pulsing after a folder is brought to the front, eliminating the blinking effect.
