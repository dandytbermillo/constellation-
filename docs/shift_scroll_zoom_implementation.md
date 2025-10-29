# Shift + Scroll Zoom Implementation

## How the Annotation Project Handles It

Based on analysis of `/Users/dandy/Downloads/annotation_project/annotation-backup/`

### Architecture

**Two Main Components:**

1. **Zoom Utility Helper** (`lib/canvas/zoom-utils.ts`)
   - Normalizes wheel input across devices (trackpad vs mouse)
   - Provides smooth, exponential zoom scaling

2. **Canvas Wheel Handler** (`components/annotation-canvas-modern.tsx`)
   - Checks for Shift key
   - Applies zoom around cursor focal point
   - Prevents default scroll behavior when zooming

---

## Implementation Details

### 1. Zoom Utility Helper (`zoom-utils.ts`)

**Purpose:** Normalize wheel deltas so trackpads and mice feel consistent

```typescript
/**
 * Zoom utility helpers for wheel-based zooming.
 * Normalizes wheel input so trackpads and mice feel consistent.
 */

export interface WheelZoomEventLike {
  deltaX: number
  deltaY: number
  deltaMode?: number
}

const DOM_DELTA_LINE = 1      // Scrolling by lines (keyboard/some mice)
const DOM_DELTA_PAGE = 2      // Scrolling by pages
const LINE_HEIGHT_PX = 16     // Pixels per line
const PAGE_HEIGHT_PX = 800    // Pixels per page

function normalizeWheelDelta({ deltaX, deltaY, deltaMode = 0 }: WheelZoomEventLike): number {
  // Use dominant axis (Y for vertical scroll, X for horizontal)
  const dominant = Math.abs(deltaY) >= Math.abs(deltaX) ? deltaY : deltaX

  // Convert different delta modes to pixels
  switch (deltaMode) {
    case DOM_DELTA_LINE:
      return dominant * LINE_HEIGHT_PX
    case DOM_DELTA_PAGE:
      return dominant * PAGE_HEIGHT_PX
    default:
      return dominant  // Already in pixels
  }
}

export interface ZoomMultiplierOptions {
  intensity?: number      // How fast to zoom (default: 0.0006)
  maxMagnitude?: number   // Max delta to prevent extreme jumps (default: 600)
}

export function getWheelZoomMultiplier(
  event: WheelZoomEventLike,
  { intensity = 0.0006, maxMagnitude = 600 }: ZoomMultiplierOptions = {}
): number {
  // Clamp normalized delta to prevent extreme values
  const normalized = Math.max(
    -maxMagnitude,
    Math.min(maxMagnitude, normalizeWheelDelta(event))
  )

  // Exponential scaling for smooth zoom
  // e^(-normalized * intensity) = multiplier
  // Positive delta (scroll down) = zoom out (multiplier < 1)
  // Negative delta (scroll up) = zoom in (multiplier > 1)
  return Math.exp(-normalized * intensity)
}
```

**Key Insights:**

- **`Math.exp(-normalized * intensity)`**: Exponential scaling feels more natural than linear
- **Intensity = 0.0006**: Lower = slower/smoother zoom, higher = faster zoom
- **MaxMagnitude = 600**: Prevents extreme jumps from fast wheel spins
- **deltaMode handling**: Ensures consistency across different input devices

---

### 2. Canvas Wheel Handler (`annotation-canvas-modern.tsx`)

**Location:** Line 2368-2400

```typescript
const handleWheel = (e: React.WheelEvent) => {
  // Only zoom if Shift key is held down
  if (!e.shiftKey) {
    // Allow normal scrolling when Shift is not pressed
    return
  }

  e.preventDefault()  // Prevent page scroll while zooming

  // Get smooth zoom multiplier from helper
  const multiplier = getWheelZoomMultiplier(e.nativeEvent)

  // Apply multiplier and clamp to min/max zoom levels
  const newZoom = Math.max(0.3, Math.min(2, canvasState.zoom * multiplier))

  // Get mouse position relative to canvas for focal-point zoom
  const rect = e.currentTarget.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top

  // Calculate world coordinates before zoom
  const worldX = (mouseX - canvasState.translateX) / canvasState.zoom
  const worldY = (mouseY - canvasState.translateY) / canvasState.zoom

  // Adjust translation to keep mouse position fixed
  const newTranslateX = mouseX - worldX * newZoom
  const newTranslateY = mouseY - worldY * newZoom

  setCanvasState(prev => ({
    ...prev,
    zoom: newZoom,
    translateX: newTranslateX,
    translateY: newTranslateY
  }))
}
```

**Usage in JSX:**
```typescript
<div
  onWheel={handleWheel}
  onMouseDown={handleCanvasMouseDown}
  // ... other props
>
  {/* Canvas content */}
</div>
```

---

## Key Features

### 1. Shift Key Requirement
```typescript
if (!e.shiftKey) {
  return  // Normal scroll behavior continues
}
```
- **Without Shift**: Normal page scrolling/panning
- **With Shift**: Zoom in/out

### 2. Smooth, Device-Independent Zooming
```typescript
const multiplier = getWheelZoomMultiplier(e.nativeEvent)
const newZoom = canvasState.zoom * multiplier
```
- Trackpads and mice feel consistent
- Exponential scaling feels natural
- No jumpy zoom steps

### 3. Zoom Limits
```typescript
const newZoom = Math.max(0.3, Math.min(2, canvasState.zoom * multiplier))
```
- **Min zoom**: 0.3 (30% - zoomed out)
- **Max zoom**: 2.0 (200% - zoomed in)
- Prevents extreme zoom levels

### 4. Focal-Point Zoom (Zoom to Cursor)
```typescript
// World coords before zoom
const worldX = (mouseX - canvasState.translateX) / canvasState.zoom
const worldY = (mouseY - canvasState.translateY) / canvasState.zoom

// Adjust translation after zoom to keep cursor position fixed
const newTranslateX = mouseX - worldX * newZoom
const newTranslateY = mouseY - worldY * newZoom
```
- Zooms toward/away from cursor position
- Keeps the point under the cursor stationary
- Much better UX than zooming to canvas center

---

## How It Works Mathematically

### Zoom Multiplier Calculation

1. **Normalize wheel delta:**
   ```
   normalized = normalizeWheelDelta(event)
   // Example: deltaY = 100 (scroll down)
   // normalized = 100 pixels
   ```

2. **Clamp to prevent extremes:**
   ```
   clamped = clamp(normalized, -600, 600)
   // Example: clamped = 100
   ```

3. **Apply exponential scaling:**
   ```
   multiplier = e^(-clamped * 0.0006)
   // Example: e^(-100 * 0.0006) = e^(-0.06) ≈ 0.9418
   // Result: zoom out to ~94% (6% reduction)
   ```

4. **Apply to current zoom:**
   ```
   newZoom = currentZoom * multiplier
   // Example: 1.0 * 0.9418 = 0.9418
   ```

### Focal-Point Math

**Problem:** When zooming, we want the point under the cursor to stay in place.

**Solution:**
1. Convert mouse position to world coordinates (before zoom)
2. Apply new zoom level
3. Adjust translation so world coordinates align with mouse position again

**Formula:**
```
Before zoom:
  worldX = (mouseX - translateX) / zoom

After zoom:
  mouseX = translateX' + worldX * zoom'

Solve for translateX':
  translateX' = mouseX - worldX * zoom'
```

**Example:**
```
Initial state:
  zoom = 1.0
  translateX = 0
  mouseX = 400px (cursor at center)

World coordinate:
  worldX = (400 - 0) / 1.0 = 400

Zoom in to 1.2:
  newTranslateX = 400 - 400 * 1.2 = 400 - 480 = -80

Result: Canvas shifts left 80px so worldX=400 stays under cursor
```

---

## Advantages of This Approach

### ✅ Smooth Zooming
- Exponential scaling feels natural (like Google Maps, Figma)
- No discrete "steps" or jumpy behavior
- Works consistently on all devices

### ✅ Device Independence
- Normalizes trackpad vs mouse wheel differences
- Handles different `deltaMode` values (pixels, lines, pages)
- Clamps extreme values to prevent jumps

### ✅ Intuitive UX
- Shift key prevents accidental zoom (clear intent)
- Zoom centers on cursor (users expect this)
- Smooth, predictable zoom speed

### ✅ Configurable
- `intensity` parameter controls zoom speed
- `maxMagnitude` prevents extreme jumps
- Easy to adjust min/max zoom levels

---

## Comparison to Simple Approach

### Simple Approach (DON'T USE)
```typescript
const handleWheel = (e: React.WheelEvent) => {
  if (!e.shiftKey) return
  e.preventDefault()

  const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1  // ❌ Fixed steps
  const newZoom = canvasState.zoom * zoomFactor
  setCanvasState({ ...canvasState, zoom: newZoom })
}
```

**Problems:**
- ❌ Fixed 10% steps feel jumpy
- ❌ No device normalization (trackpad vs mouse feel different)
- ❌ No focal-point zoom (zooms to canvas origin)
- ❌ Doesn't handle different deltaMode values

### Enhanced Approach (RECOMMENDED)
```typescript
const handleWheel = (e: React.WheelEvent) => {
  if (!e.shiftKey) return
  e.preventDefault()

  const multiplier = getWheelZoomMultiplier(e.nativeEvent)  // ✅ Smooth
  const newZoom = Math.max(0.3, Math.min(2, canvasState.zoom * multiplier))

  // ✅ Focal-point math
  const rect = e.currentTarget.getBoundingClientRect()
  const mouseX = e.clientX - rect.left
  const mouseY = e.clientY - rect.top
  const worldX = (mouseX - canvasState.translateX) / canvasState.zoom
  const worldY = (mouseY - canvasState.translateY) / canvasState.zoom
  const newTranslateX = mouseX - worldX * newZoom
  const newTranslateY = mouseY - worldY * newZoom

  setCanvasState({
    ...canvasState,
    zoom: newZoom,
    translateX: newTranslateX,
    translateY: newTranslateY
  })
}
```

---

## Implementation Checklist

To add this to constellation app:

- [ ] Create `src/utils/zoom-utils.ts` with helper functions
- [ ] Add `onWheel` handler to canvas component
- [ ] Check for `e.shiftKey` to enable zoom
- [ ] Call `getWheelZoomMultiplier(e.nativeEvent)` for smooth scaling
- [ ] Apply focal-point math to zoom toward cursor
- [ ] Clamp zoom to min/max values (0.3 - 2.0)
- [ ] Test on both trackpad and mouse
- [ ] Verify Shift key requirement works
- [ ] Verify normal scroll still works without Shift

---

## Configuration Options

### Adjustable Parameters

**Zoom Speed:**
```typescript
getWheelZoomMultiplier(e.nativeEvent, {
  intensity: 0.0006  // Lower = slower, higher = faster
})
```

**Max Delta:**
```typescript
getWheelZoomMultiplier(e.nativeEvent, {
  maxMagnitude: 600  // Prevents extreme jumps
})
```

**Zoom Limits:**
```typescript
const newZoom = Math.max(
  0.3,   // Min zoom (30%)
  Math.min(
    2.0,  // Max zoom (200%)
    canvasState.zoom * multiplier
  )
)
```

---

## Testing Notes

From the documentation:
- ✅ Tested on both mouse and trackpad
- ✅ Confirmed smooth zoom with Shift key
- ✅ Verified plain scrolling works without Shift
- ✅ No runtime errors after helper import

---

## References

- **Documentation:** `/annotation_project/annotation-backup/docs/proposal/zoom_in_out/shift-scroll-zoom-enhancement.md`
- **Zoom Utils:** `/annotation_project/annotation-backup/lib/canvas/zoom-utils.ts`
- **Canvas Handler:** `/annotation_project/annotation-backup/components/annotation-canvas-modern.tsx:2368`
- **MDN deltaMode:** https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent/deltaMode

---

## Summary

The annotation project uses a **two-part system**:

1. **Zoom utility helper** that normalizes wheel input and provides smooth exponential scaling
2. **Canvas wheel handler** that checks for Shift key, calculates focal-point zoom, and applies the zoom

The key innovations are:
- **Exponential scaling** via `Math.exp()` for natural feel
- **Device normalization** via `deltaMode` handling
- **Focal-point zoom** to keep cursor position fixed
- **Shift key requirement** to prevent accidental zoom

This provides a smooth, predictable, device-independent zoom experience that matches user expectations from apps like Figma, Google Maps, and other modern canvas tools.
