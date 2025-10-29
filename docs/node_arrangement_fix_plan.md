# Node Arrangement Fix - Implementation Plan

## Problem Statement

When a folder is expanded (e.g., "Uncategorized"), its children nodes cluster together in a tight space instead of being evenly distributed around the parent folder. The parent folder should be at the center of its children, with children arranged in a circular/radial pattern.

**Current Issues:**
1. Children nodes overlap and cluster in one area
2. Parent folder is not centered among its children
3. No proper radial distribution of children around parent
4. Angle calculation doesn't ensure even spacing

## Root Cause Analysis

### Where Angles Are Calculated

**1. API Level** (`src/app/api/constellations/route.ts:14-86`)
- `fetchChildrenRecursive` function assigns angles during database fetch
- Uses: `const angle = (360 / minSectors) * index;`
- Problem: Angles are calculated once at API response time, not considering parent's actual position

**2. Client Processing** (`src/utils/constellation.ts:17-94`)
- `processChildrenRecursively` function positions children
- Calculates: `childX = parentPos.x + Math.cos(childRadian) * child.distance`
- Problem: Uses the angle from API directly without recalculating based on parent's actual screen position

### Why It's Not Working

1. **Angles from API are static** - calculated at fetch time, not relative to parent's actual position
2. **Distance is randomized** - `distance = 70 + Math.random() * 30` causes uneven spacing
3. **No re-layout on expansion** - when folder expands, children use pre-calculated positions that don't account for parent's current location
4. **Overlapping prevention missing** - no collision detection or force-directed layout

## Solution Design

### Approach: Dynamic Radial Layout on Expansion

When a folder is expanded:
1. Calculate parent's current position
2. Count visible children
3. Distribute children evenly in a circle around parent
4. Use consistent radius (no randomization)
5. Apply the layout immediately

### Key Principles

- **Parent-Centered**: Parent folder at (0,0) relative to children
- **Even Distribution**: `angle = (360 / childCount) * index`
- **Consistent Radius**: Fixed distance (e.g., 150px) for all children at same depth
- **Dynamic Calculation**: Recalculate on each expansion, not at API fetch time

## Implementation Steps

### Step 1: Remove Random Distance from API

**File:** `src/app/api/constellations/route.ts`

**Current Code (lines 53-56):**
```typescript
const totalSiblings = children.length;
const minSectors = Math.max(totalSiblings, CONFIG.MIN_ANGLE_SECTORS);
const angle = (360 / minSectors) * index;
const distance = 70 + Math.random() * 30; // ❌ Random causes uneven spacing
```

**New Code:**
```typescript
const totalSiblings = children.length;
const minSectors = Math.max(totalSiblings, CONFIG.MIN_ANGLE_SECTORS);
const angle = (360 / minSectors) * index;
const distance = 150; // ✅ Fixed distance for even distribution
```

**Why:** Consistent radius ensures all children are equidistant from parent.

---

### Step 2: Add Layout Recalculation Function

**File:** `src/utils/constellation.ts`

**Add new function after imports:**
```typescript
/**
 * Recalculates positions for children of an expanded folder
 * Places parent at center, distributes children evenly in a circle
 */
export function calculateRadialLayout(
  parentItem: ConstellationItem,
  parentPos: { x: number; y: number },
  children: ConstellationItem[],
  radius: number = 150
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  // Parent stays at its current position
  positions.set(parentItem.id, parentPos);

  // Distribute children evenly in a circle
  const angleStep = 360 / children.length;

  children.forEach((child, index) => {
    const angle = angleStep * index;
    const radian = (angle * Math.PI) / 180;

    const x = parentPos.x + Math.cos(radian) * radius;
    const y = parentPos.y + Math.sin(radian) * radius;

    positions.set(child.id, { x, y });
  });

  return positions;
}
```

**Why:** Centralizes the radial layout logic, making it reusable.

---

### Step 3: Update Expansion Logic in useConstellation Hook

**File:** `src/hooks/useConstellation.ts`

**Find the folder expansion handler** (search for `toggleConstellationExpansion` or folder double-click logic)

**Add layout recalculation after expansion:**
```typescript
// When folder is expanded
const handleFolderExpansion = useCallback((folderId: string) => {
  const folder = allItems.find(item => item.id === folderId);
  if (!folder) return;

  // Get current position
  const folderPos = state.nodePositions.get(folderId) || { x: folder.x || 0, y: folder.y || 0 };

  // Get children items
  const children = allItems.filter(item => item.parentId === folderId);

  if (children.length === 0) return;

  // Calculate new radial layout
  const newPositions = calculateRadialLayout(folder, folderPos, children, 150);

  // Update state with new positions
  updateState(prev => ({
    ...prev,
    expandedConstellations: new Set([...prev.expandedConstellations, folderId]),
    nodePositions: new Map([...prev.nodePositions, ...newPositions])
  }));
}, [allItems, state.nodePositions, updateState]);
```

**Why:** Recalculates positions dynamically when folder expands, ensuring proper distribution.

---

### Step 4: Add Transition Animation (Optional Enhancement)

**File:** `src/components/ConstellationVisualization.tsx`

**In the node rendering logic, add position transitions:**

```typescript
// When rendering nodes, check if position changed
const currentPos = getNodePosition(item, state.nodePositions, allItems);
const element = nodeElementsRef.current.get(item.id);

if (element) {
  // Animate position change
  element.style.transition = 'transform 0.5s ease-out';
  element.setAttribute('transform', `translate(${currentPos.x}, ${currentPos.y})`);
}
```

**Why:** Smooth transition makes the re-layout visually appealing instead of jarring.

---

### Step 5: Fix Initial Layout in processChildrenRecursively

**File:** `src/utils/constellation.ts`

**Update the position calculation (lines 34-36):**

**Current Code:**
```typescript
const childRadian = (child.angle * Math.PI) / 180;
const childX = parentPos.x + Math.cos(childRadian) * child.distance;
const childY = parentPos.y + Math.sin(childRadian) * child.distance;
```

**New Code:**
```typescript
// Use consistent radius and ensure even distribution
const angleStep = 360 / childrenToShow.length;
const angle = angleStep * index;
const radian = (angle * Math.PI) / 180;
const radius = 150; // Consistent radius

const childX = parentPos.x + Math.cos(radian) * radius;
const childY = parentPos.y + Math.sin(radian) * radius;
```

**Why:** Ensures initial layout (before expansion) also has proper spacing.

---

### Step 6: Update Overflow Node Position

**File:** `src/utils/constellation.ts` (lines 62-70)

**Current Code:**
```typescript
const moreNodeAngle = 360;
const moreNodeRadian = (moreNodeAngle * Math.PI) / 180;
const moreNodeX = parentPos.x + Math.cos(moreNodeRadian) * parentItem.distance;
```

**New Code:**
```typescript
// Place overflow node at the last position in the circle
const lastAngle = (360 / (MAX_VISIBLE_CHILDREN + 1)) * MAX_VISIBLE_CHILDREN;
const moreNodeRadian = (lastAngle * Math.PI) / 180;
const moreNodeX = parentPos.x + Math.cos(moreNodeRadian) * 150;
```

**Why:** Keeps overflow node in the circular pattern instead of arbitrary position.

---

## Testing Checklist

### Visual Tests
- [ ] Parent folder appears at center of children when expanded
- [ ] Children are evenly distributed in a circle around parent
- [ ] No overlapping nodes (all children visible and separated)
- [ ] Consistent spacing between all children
- [ ] Works for folders with 2-10 children
- [ ] Overflow node (+X more) positioned correctly in circle

### Functional Tests
- [ ] Double-click folder to expand
- [ ] Children appear with animation (if implemented)
- [ ] Re-expanding same folder maintains layout
- [ ] Collapsing and re-expanding recalculates correctly
- [ ] Works at different zoom levels
- [ ] Works when parent folder is at different positions (edges, center)

### Edge Cases
- [ ] Folder with 1 child (should appear directly to the right)
- [ ] Folder with 2 children (should appear opposite each other)
- [ ] Folder with 12+ children (should show 10 + overflow node)
- [ ] Nested folders (expanding child folder inside expanded parent)
- [ ] Multiple expanded folders on screen simultaneously

## Configuration

Add to CONFIG object in `route.ts`:

```typescript
const CONFIG = {
  MAX_VISIBLE_CHILDREN: 10,
  MAX_CHILDREN_PER_FOLDER: 50,
  MAX_NESTING_DEPTH: 5,
  ENABLE_NESTED_CHILDREN: true,
  MIN_ANGLE_SECTORS: 6,
  CHILD_LAYOUT_RADIUS: 150,        // ✅ NEW: Fixed radius for children
  ENABLE_LAYOUT_ANIMATION: true,   // ✅ NEW: Toggle animations
};
```

## Rollback Plan

If issues arise:
1. Revert `calculateRadialLayout` function addition
2. Restore original `distance = 70 + Math.random() * 30` in API
3. Remove position recalculation from expansion handler
4. Test to ensure basic expansion still works

## Success Criteria

✅ **Visual:** Children form a clear circle around parent folder
✅ **Spacing:** All children equidistant from parent (150px radius)
✅ **Distribution:** Even angular distribution (no clustering)
✅ **Parent:** Parent folder visually at center of children
✅ **Performance:** Layout calculation < 16ms (60fps)

## Additional Improvements (Future)

1. **Adaptive Radius:** Increase radius if children have many nodes to prevent outer circle overlap
2. **Force-Directed Layout:** Use d3-force for automatic collision avoidance
3. **Zoom-to-Fit:** Auto-zoom to show all children when folder expands
4. **Sector Highlighting:** Visual indicator showing which sector each child occupies
5. **Collision Detection:** Prevent children from overlapping with other constellations

## Files to Modify

1. ✅ `src/app/api/constellations/route.ts` - Remove random distance
2. ✅ `src/utils/constellation.ts` - Add calculateRadialLayout, fix initial layout
3. ✅ `src/hooks/useConstellation.ts` - Add dynamic recalculation on expansion
4. ⚠️ `src/components/ConstellationVisualization.tsx` - Optional: Add animations

## Estimated Effort

- **Step 1-3**: 30 minutes (core fix)
- **Step 4**: 15 minutes (animation enhancement)
- **Step 5-6**: 20 minutes (cleanup and overflow node)
- **Testing**: 30 minutes
- **Total**: ~1.5-2 hours

---

## Notes

- The key insight is that **angles should be calculated dynamically based on the number of visible children**, not statically at API fetch time
- **Consistent radius** is critical - randomization creates uneven layouts
- **Parent-centered layout** requires recalculating positions relative to parent's current screen coordinates
- This approach works well for up to ~12 children; beyond that, consider multi-ring layouts or hierarchical layouts
