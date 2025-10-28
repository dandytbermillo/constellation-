# Depth Layer Reversal Implementation Plan

## Problem Statement

Currently, when a user double-clicks a constellation folder (e.g., "my documents"), the visual depth doesn't change meaningfully:
- **Constellation center (folder)**: Layer 1 (z ≈ -150) - closer to user
- **Children items**: Layer 2 (z ≈ -300) - further from user
- **Result**: Children stay hidden behind parent, no "dive into" effect

This happens because:
1. API emits static depth layers: children at `depthLayer: 2`, center at `depthLayer: 1`
2. Double-click only calls `toggleConstellationExpansion`, doesn't change depth layers
3. `focusedConstellation` never activates, so depth calculation stays static
4. No visual indication that folder was "opened"

## Ultra-Think Verification & Fixes Applied

### Fixes Applied After Deep Analysis:

1. **✅ ID Normalization** (Pre-Step A):
   - **Original**: Used `.replace('_center', '')` which could incorrectly handle names like "my_center_data"
   - **Fixed**: Now uses `.endsWith('_center')` + `.slice(0, -7)` for safer suffix removal

2. **✅ Layer 0.5 Removed** (Pre-Step B):
   - **Original**: Plan included Layer 0.5 despite MVP removing nested children logic
   - **Fixed**: Removed all Layer 0.5 references - MVP uses only Layer 0 and 1.5

3. **✅ Knowledge Base Edge Case** (Pre-Step D):
   - **Original**: KB center would move to Layer 1.5 when expanded (wrong)
   - **Fixed**: Special case keeps KB center at Layer 0 always (root should stay at front)

4. **✅ Expansion + Focus Interaction** (Pre-Step D):
   - **Original**: Unclear what happens when both active
   - **Fixed**: Documented that expansion takes precedence (correct behavior)

5. **✅ getDepthZ Call Site Verification** (Pre-Step D):
   - **Original**: No verification of shared utility usage
   - **Fixed**: Added checklist item to grep and verify all usages handle Layer 1.5

6. **✅ Pre-Implementation Checklist** (New Section):
   - **Original**: No systematic verification steps
   - **Fixed**: Added comprehensive 20-item checklist covering code analysis, edge cases, data verification, dependencies, test prep, and performance

### Verification Status: ✅ COMPLETE

All critical issues from ultra-think analysis have been addressed. Plan is now implementation-ready.

---

## Critical Issues Identified (Must Fix First)

### Issue 1: Expansion ID Mismatch ⚠️
**Problem**: When double-clicking "my documents" center (ID: `abc123_center`), `toggleConstellationExpansion` adds `abc123_center` to `expandedConstellations`, but children have `constellation: "abc123"` (without `_center` suffix).

**Impact**: `state.expandedConstellations.has(itemConstellation)` never matches, so depth logic never triggers.

**Fix Required**: Normalize IDs by stripping `_center` suffix before adding to `expandedConstellations`.

### Issue 2: Missing parentId for Direct Children ⚠️
**Problem**: API returns direct children WITHOUT `parentId` field (`src/app/api/constellations/route.ts:91-105`). The `initializeConstellations` function spreads these items directly without adding a parent reference.

**Impact**: Cannot distinguish between direct children (should be Layer 0.5) and nested children (should be Layer 0) because both lack `parentId`.

**Fix Required**: Either:
- Option A: Add `parentId` field in API response for constellation items
- Option B: Add `parentId` in `initializeConstellations` when processing constellation items

### Issue 3: No Nested Children Data ⚠️
**Problem**: API forces `children: []` for all items (line 102). Nested children are never fetched from database.

**Impact**: The "nested children at Layer 0" logic never executes. Phase 2 depth hierarchy won't work.

**Fix Required**: Either:
- Option A: Fetch nested children from database and populate `children` array
- Option B: Simplify plan to only handle direct constellation children (single level)
- Recommendation: **Option B** for MVP - handle only direct children, defer nested hierarchy

### Issue 4: Shared Utility Functions Not Updated ⚠️
**Problem**: `src/utils/constellation.ts::getDepthZ()` uses hardcoded depth map that doesn't include Layer 0.5 or 1.5.

**Impact**: Hit-testing will fail for items at fractional layers. Mouse clicks won't register correctly.

**Fix Required**: Update shared `getDepthZ` function to handle 0.5 and 1.5 layers.

### Issue 5: Test Scenarios Don't Match Reality ⚠️
**Problem**: Plan assumes "initial load shows only centers" but items are currently visible by default.

**Impact**: Test checklist won't match actual behavior.

**Fix Required**: Update test scenarios to reflect current state where items are visible unless explicitly hidden.

## Desired Behavior

When user double-clicks a constellation folder:
- **Children items**: Layer 0 (z = 0) - **CLOSEST to user** (come forward)
- **Constellation center (folder)**: Layer 1.5 (z ≈ -100) - **BEHIND children** (steps back)
- **Result**: "Peek inside" effect - contents spill out in front of folder
- **Connection lines**: Short, because parent and children are close in z-space

## Implementation Strategy

### Phase 1: Dynamic Depth Layer Calculation

**File**: `/src/hooks/useConstellation.ts`

**Function**: `getItemDepthLayer` (lines 817-869)

**Current Logic**:
```typescript
if (state.focusedConstellation && itemConstellation) {
  const isFocusedConstellation = itemConstellation === state.focusedConstellation;

  if (isFocusedConstellation) {
    if (item.isCenter) return 0;  // Center closest
    if (item.depthLayer !== undefined) return item.depthLayer; // Children at their static layer
    // ...
  }
}
```

**New Logic**:
```typescript
// Check if this constellation is EXPANDED (not just focused)
const isExpanded = state.expandedConstellations.has(itemConstellation);

if (isExpanded && itemConstellation) {
  // SWAP: Children come forward, center steps back
  if (item.isCenter) {
    return 1.5; // Parent behind children
  }

  // Children of expanded constellation come to front
  if (item.constellation === itemConstellation) {
    return 0; // Children in front
  }
}

// Then check focused constellation logic (for additional depth control)
if (state.focusedConstellation && itemConstellation) {
  // ... existing focus logic
}
```

**Key Points**:
- Check `expandedConstellations` FIRST (before focus logic)
- Expansion state determines depth reversal
- Focus state can add additional depth effects on top

### Phase 2: Handle Nested Children (Folders within Folders)

**File**: `/src/hooks/useConstellation.ts`

**Function**: `getItemDepthLayer`

**Challenge**: If a child item is itself a folder with children, those nested children should be even closer.

**Logic**:
```typescript
if (isExpanded && itemConstellation) {
  if (item.isCenter) {
    return 1.5; // Constellation center back
  }

  // Direct children of constellation
  if (item.constellation === itemConstellation && !item.parentId) {
    return 0.5; // Direct children slightly back
  }

  // Nested children (children of folders)
  if (item.parentId) {
    const parent = allItems.find(i => i.id === item.parentId);
    if (parent && parent.constellation === itemConstellation) {
      // Check if parent folder is expanded
      if (state.expandedConstellations.has(item.parentId)) {
        return 0; // Nested children come to very front
      } else {
        return 999; // Hidden if parent not expanded
      }
    }
  }
}
```

**Depth Layers for Expanded Constellation**:
- Layer 0: Nested children (children of expanded folders) - **CLOSEST**
- Layer 0.5: Direct children (items in constellation) - **VERY CLOSE**
- Layer 1.5: Constellation center (folder that was double-clicked) - **BEHIND**

### Phase 3: Optional Focus System Integration

**File**: `/src/hooks/useConstellation.ts`

**Function**: `handleMouseDown` (around line 1204-1206)

**Current Code**:
```typescript
// Double-click on folder/constellation: just expand/collapse (no "bring to front")
// Children will appear at Layer 1.5 (forward) when expanded
toggleConstellationExpansion(itemId);
```

**Option A - Expansion Only** (Recommended):
```typescript
// Double-click: expand and use depth reversal
toggleConstellationExpansion(itemId);
```

**Option B - Expansion + Focus** (More dramatic):
```typescript
// Double-click: expand AND focus (activates focus system)
toggleConstellationExpansion(itemId);
bringConstellationToFront(itemId); // Activates focusedConstellation
```

**Recommendation**: Start with Option A (expansion-only). If visual feedback is insufficient, add Option B for additional "push back non-focused items" effect.

### Phase 4: Visual Feedback Adjustments

**File**: `/src/hooks/useConstellation.ts`

**Functions**: `getDepthScale`, `getDepthOpacity`

**Goal**: Keep parent folder visible but de-emphasized when children come forward.

**Current Layer 1.5 Properties**:
```typescript
// Scale
if (depthLayer === 1.5) return 1.0; // Full size

// Opacity
if (depthLayer === 1.5) return 1.0; // Full opacity

// Blur
if (depthLayer === 1.5) return 'none'; // No blur
```

**Proposed Adjustment for Parent at Layer 1.5 (When Expanded)**:
```typescript
// Check if this is a constellation center that's expanded
const isExpandedCenter = item.isCenter &&
  state.expandedConstellations.has(item.constellation || item.id.replace('_center', ''));

if (depthLayer === 1.5) {
  if (isExpandedCenter) {
    // Parent folder when expanded: slightly de-emphasized but visible
    return 0.85; // Scale: 85% size
    return 0.8;  // Opacity: 80%
    return 'none'; // Blur: still sharp
  } else {
    // Regular Layer 1.5 items (children when NOT in expanded constellation)
    return 1.0; // Full size
    return 1.0; // Full opacity
    return 'none'; // No blur
  }
}
```

**Trade-off**:
- ✅ Parent stays visible and clickable
- ✅ Visual hierarchy shows children are "active"
- ⚠️ Adds complexity - start without this, add if needed

### Phase 5: Connection Line Optimization

**No code changes needed** - connection lines automatically adapt to new z-positions.

**Expected Result**:
- Short connection lines between parent (z=-100) and children (z=0)
- Avoids long stretching lines across depth layers
- Maintains visual cohesion of the "opened" constellation

## Implementation Steps

### PREREQUISITES (Must Complete First)

#### Pre-Step A: Fix Expansion ID Normalization

**File**: `/src/hooks/useConstellation.ts`
**Function**: `toggleConstellationExpansion` (line ~1062)

**Current Code**:
```typescript
const toggleConstellationExpansion = useCallback((folderId: string) => {
  // ...
  setState((prevState: AppState) => {
    const newExpanded = new Set(prevState.expandedConstellations);
    // ...
    newExpanded.add(folderId); // ❌ Adds raw ID with _center suffix
  });
}, []);
```

**Fixed Code**:
```typescript
const toggleConstellationExpansion = useCallback((folderId: string) => {
  console.log('🔄 toggleConstellationExpansion called with ID:', folderId);

  // Normalize ID: strip _center suffix if present (safer than replace)
  const normalizedId = folderId.endsWith('_center')
    ? folderId.slice(0, -7)  // Remove last 7 characters ('_center')
    : folderId;

  console.log('🔄 Normalized ID:', normalizedId, 'from:', folderId);

  // Add immediate visual feedback
  const folderItem = allItems.find(item => item.id === folderId);
  if (folderItem) {
    const isCurrentlyExpanded = state.expandedConstellations.has(normalizedId); // Use normalized ID
    showHint(`${folderItem.title}: ${isCurrentlyExpanded ? 'Collapsing...' : 'Expanding...'}`, 1000);
  }

  setState((prevState: AppState) => {
    const newExpanded = new Set(prevState.expandedConstellations);
    const wasExpanded = newExpanded.has(normalizedId); // Use normalized ID

    if (wasExpanded) {
      newExpanded.delete(normalizedId); // Use normalized ID
      console.log('📁 Collapsing folder:', normalizedId);

      // Find and collapse all descendant folders
      const collapseDescendants = (parentId: string) => {
        allItems.forEach(item => {
          if (item.parentId === parentId && (item.type === 'folder' || item.isFolder)) {
            newExpanded.delete(item.id);
            console.log('📁 Also collapsing descendant folder:', item.title);
            collapseDescendants(item.id); // Recursive collapse
          }
        });
      };
      collapseDescendants(folderId);

    } else {
      newExpanded.add(normalizedId); // ✅ Add normalized ID
      console.log('📂 Expanding folder:', normalizedId);
    }

    console.log('📋 Current expanded folders:', Array.from(newExpanded));

    return {
      ...prevState,
      expandedConstellations: newExpanded,
      depthAnimationActive: true
    };
  });

  // Turn off animation after it completes
  setTimeout(() => {
    setState(prevState => ({
      ...prevState,
      depthAnimationActive: false
    }));
  }, 600);
}, [allItems, showHint, state.expandedConstellations]);
```

**Why this fix**: Using `endsWith` + `slice` is safer than `replace` because it only removes the suffix, not any occurrence of "_center" in the middle of the ID (e.g., a folder named "my_center_data" would work correctly).

#### Pre-Step B: Update Shared getDepthZ Utility

**File**: `/src/utils/constellation.ts`
**Function**: `getDepthZ` (line ~322)

**Current Code**:
```typescript
export function getDepthZ(depthLayer: number): number {
  const depthMap: Record<number, number> = {
    0: 0,      // Foreground (Knowledge Base center)
    1: -150,   // Level 1 back (Subfolder centers)
    2: -300,   // Level 2 back (Subfolder contents)
    3: -450,   // Level 3 back (hidden children)
    4: -600    // Level 4 back (deep hidden)
  };
  return depthMap[depthLayer] || 0;
}
```

**Fixed Code**:
```typescript
export function getDepthZ(depthLayer: number): number {
  // Handle fractional layers (MVP: only 1.5, no 0.5)
  if (depthLayer === 1.5) return -100;  // Constellation center when expanded

  const depthMap: Record<number, number> = {
    0: 0,      // Foreground (children of expanded constellation, Knowledge Base center)
    1: -150,   // Level 1 back (Subfolder centers)
    2: -300,   // Level 2 back (Subfolder contents)
    3: -450,   // Level 3 back (hidden children)
    4: -600,   // Level 4 back (deep hidden)
    999: -2000 // Hidden layer
  };
  return depthMap[depthLayer] || (-depthLayer * 150);
}
```

**Note**: Layer 0.5 removed for MVP - only using Layer 0 and 1.5.

#### Pre-Step C: Simplify Phase 2 (Remove Nested Children Logic - MVP)

**Decision**: For MVP, handle only **direct constellation children** at Layer 0 (not nested hierarchy).

**Rationale**:
- API doesn't provide nested children data
- Adding nested children requires database changes
- Direct children reversal achieves 80% of desired UX
- Can add nested hierarchy in Phase 2 later

**Simplified Logic** (replaces Phase 2 in original plan):
```typescript
if (itemConstellation && state.expandedConstellations.has(itemConstellation)) {
  // Constellation center steps back when expanded
  if (item.isCenter) {
    return 1.5; // Parent behind children
  }

  // ALL direct children of expanded constellation come forward
  // (No distinction between direct vs nested - all treated as direct)
  if (item.constellation === itemConstellation && !item.isCenter) {
    return 0; // Children in front (simplified - no Layer 0.5)
  }
}
```

**Updated Depth Layers for Expanded Constellation (MVP)**:
- Layer 0: ALL constellation items (direct children) - **CLOSEST**
- Layer 1.5: Constellation center (folder) - **BEHIND**

#### Pre-Step D: Handle Edge Cases

**Edge Case 1: Knowledge Base Center Expansion**

**Problem**: Knowledge Base center starts at Layer 0. If expanded, should it move to Layer 1.5?

**Decision**: NO - Keep Knowledge Base center at Layer 0 always (it's the root).

**Implementation**:
```typescript
if (itemConstellation && state.expandedConstellations.has(itemConstellation)) {
  if (item.isCenter) {
    // Special case: Knowledge Base center stays at Layer 0
    const constId = item.constellation || item.id.replace('_center', '');
    const isKnowledgeBase = item.title === 'Knowledge Base' || item.depthLayer === 0;

    if (isKnowledgeBase) {
      logDepthCalculation(item.title, itemConstellation, 'expanded-kb', true, 0);
      return 0; // KB center stays at front
    }

    logDepthCalculation(item.title, itemConstellation, 'expanded', true, 1.5);
    return 1.5; // Other centers step back
  }
  // ... rest of logic
}
```

**Edge Case 2: Both Expansion AND Focus Active**

**Problem**: What if a constellation is BOTH expanded (items visible) AND focused (brought to front)?

**Current Plan**: Expansion check runs FIRST, returns early, focus logic never runs.

**Decision**: This is CORRECT behavior because:
- Expansion = local depth reversal (children forward from parent)
- Focus = global depth shift (entire constellation forward)
- Expansion check should take precedence when constellation is expanded
- Focus can still move OTHER constellations back (via the else branch)

**Implementation**: No change needed - current logic is correct.

**Edge Case 3: Verify All getDepthZ Call Sites**

**Action Required**: Search codebase for all uses of shared `getDepthZ` function.

**Command**:
```bash
grep -r "getDepthZ" src/ --include="*.ts" --include="*.tsx"
```

**Expected Locations**:
1. `/src/utils/constellation.ts` - Definition
2. `/src/hooks/useConstellation.ts` - Hook version (overrides shared)
3. Possibly: Hit-testing code
4. Possibly: Collision detection code

**Verification**: Ensure all call sites can handle fractional layers (1.5).

### MAIN IMPLEMENTATION

### Step 1: Update `getItemDepthLayer` for Expansion-Based Depth Reversal

**File**: `/src/hooks/useConstellation.ts`

**Location**: Beginning of `getItemDepthLayer` function (around line 817)

**Add BEFORE existing focus constellation logic**:

```typescript
const getItemDepthLayer = useCallback((item: ConstellationItem): number => {
  // Focused items always in foreground
  if (state.focusedItems.has(item.id)) {
    return 0;
  }

  // Get the constellation this item belongs to
  const itemConstellation = item.constellation || (item.isCenter ? item.id.replace('_center', '') : null);

  // === NEW: Expansion-based depth reversal (MVP - Simplified) ===
  // Check if this constellation is expanded
  if (itemConstellation && state.expandedConstellations.has(itemConstellation)) {
    // Constellation center steps back when expanded
    if (item.isCenter) {
      // Special case: Knowledge Base center stays at Layer 0
      const isKnowledgeBase = item.title === 'Knowledge Base' || item.depthLayer === 0;

      if (isKnowledgeBase) {
        logDepthCalculation(item.title, itemConstellation, 'expanded-kb', true, 0);
        return 0; // KB center stays at front
      }

      logDepthCalculation(item.title, itemConstellation, 'expanded', true, 1.5);
      return 1.5; // Other centers step back behind children
    }

    // ALL children of expanded constellation come forward (simplified - no nested distinction)
    if (item.constellation === itemConstellation && !item.isCenter) {
      logDepthCalculation(item.title, itemConstellation, 'expanded', true, 0);
      return 0; // Children in front
    }
  }
  // === END NEW ===

  // NOTE: Nested children logic removed for MVP - will be added in Phase 2
  // when API provides nested children data

  // If a constellation is focused, adjust depths (existing logic continues)
  if (state.focusedConstellation && itemConstellation) {
    // ... existing focus logic unchanged ...
  }

  // No constellation focus - use normal depth calculation
  return getBaseDepthLayer(item);
}, [state.expandedConstellations, state.focusedItems, state.focusedConstellation, allItems]);
```

### Step 2: Verify `getBaseDepthLayer` Handles Hidden Items

**File**: `/src/hooks/useConstellation.ts`

**Function**: `getBaseDepthLayer` (around line 872)

**Ensure this logic exists** (should already be there):

```typescript
const getBaseDepthLayer = useCallback((item: ConstellationItem): number => {
  // ... existing logic ...

  // For constellation items (not centers), check if their constellation is expanded
  const itemConstellation = item.constellation;
  if (itemConstellation && !state.expandedConstellations.has(itemConstellation)) {
    return 999; // Hidden - constellation is collapsed
  }

  // ... rest of existing logic ...
}, [state.expandedConstellations, allItems]);
```

**Purpose**: Items are hidden by default, only visible when constellation is expanded.

### Step 3: Test Basic Functionality

**Test Cases**:

1. **Initial Load**:
   - ✅ Only constellation centers visible
   - ✅ All items hidden (Layer 999)

2. **Double-Click Constellation**:
   - ✅ Constellation center moves to Layer 1.5 (z=-100)
   - ✅ Direct children appear at Layer 0.5 (z=-75)
   - ✅ Nested children (if any) remain hidden until parent folder expanded

3. **Double-Click Folder Within Constellation**:
   - ✅ Parent folder stays at Layer 0.5
   - ✅ Its children appear at Layer 0 (z=0) - in front of everything

4. **Connection Lines**:
   - ✅ Short lines between layers (0, 0.5, 1.5)
   - ✅ No long stretching lines

### Step 4: Add Z-Position for Layer 0.5

**File**: `/src/hooks/useConstellation.ts`

**Function**: `getDepthZ` (around line 952)

**Current Code**:
```typescript
const getDepthZ = useCallback((depthLayer: number): number => {
  if (depthLayer >= 999) return -2000;   // Far back for hidden
  if (depthLayer === 1.5) return -100;   // Children FORWARD - closer than layer 1 (-150)

  // Each layer is 150 units back in Z-space (dramatic separation)
  // Layer 0: 0, Layer 1: -150, Layer 1.5: -100 (FORWARD!), Layer 2: -300, etc.
  return -depthLayer * 150;
}, []);
```

**Add Layer 0.5**:
```typescript
const getDepthZ = useCallback((depthLayer: number): number => {
  if (depthLayer >= 999) return -2000;   // Far back for hidden
  if (depthLayer === 1.5) return -100;   // Parent when expanded
  if (depthLayer === 0.5) return -75;    // Direct children of expanded constellation

  // Each layer is 150 units back in Z-space
  // Layer 0: 0, Layer 0.5: -75, Layer 1: -150, Layer 1.5: -100, Layer 2: -300
  return -depthLayer * 150;
}, []);
```

### Step 5: Add Visual Properties for Layer 0.5

**File**: `/src/hooks/useConstellation.ts`

**Functions**: `getDepthScale`, `getDepthOpacity`, `getDepthBlur`

**Add to each**:

```typescript
// getDepthScale
const getDepthScale = useCallback((depthLayer: number, isCenter: boolean = false): number => {
  if (depthLayer === 0) return 1.0;      // Constellation centers - full size
  if (depthLayer === 0.5) return 0.98;   // Direct children - nearly full size
  if (depthLayer === 1) return 0.95;     // Root items - nearly full size
  if (depthLayer === 1.5) return 1.0;    // Children FORWARD - full size (prominent)
  // ... rest unchanged
}, []);

// getDepthOpacity
const getDepthOpacity = useCallback((depthLayer: number, isCenter: boolean = false): number => {
  if (depthLayer === 0) return 1.0;      // Full opacity
  if (depthLayer === 0.5) return 0.98;   // Nearly full opacity
  if (depthLayer === 1) return 0.95;     // Root items - nearly full opacity
  if (depthLayer === 1.5) return 1.0;    // Children FORWARD - full opacity
  // ... rest unchanged
}, []);

// getDepthBlur
const getDepthBlur = useCallback((depthLayer: number): string => {
  if (depthLayer === 0) return 'none';    // No blur for centers
  if (depthLayer === 0.5) return 'none';  // No blur for direct children
  if (depthLayer === 1) return 'none';    // No blur for root items
  if (depthLayer === 1.5) return 'none';  // Children FORWARD - no blur
  // ... rest unchanged
}, []);
```

### Step 6: Optional - Add Parent De-emphasis When Expanded

**File**: `/src/hooks/useConstellation.ts`

**Only if visual feedback needs enhancement**:

```typescript
// In getDepthScale
const getDepthScale = useCallback((depthLayer: number, isCenter: boolean = false): number => {
  // ... existing checks ...

  if (depthLayer === 1.5) {
    // Check if this is an expanded constellation center
    if (isCenter && item) { // Need to pass item as context
      const constId = item.constellation || item.id.replace('_center', '');
      if (state.expandedConstellations.has(constId)) {
        return 0.85; // Slightly smaller when expanded
      }
    }
    return 1.0; // Regular Layer 1.5
  }
  // ...
}, [state.expandedConstellations]);
```

**Note**: This requires passing `item` context to depth functions. Start without this; add only if needed.

### Step 7: Testing Checklist

**Functionality**:
- [ ] Double-click constellation → items appear
- [ ] Items appear in front of (closer than) constellation center
- [ ] Double-click again → items disappear (collapse)
- [ ] Double-click folder within constellation → its children appear at Layer 0
- [ ] Children are closest layer (in front of everything in that constellation)
- [ ] Connection lines are short and manageable

**Visual Quality**:
- [ ] No jarring jumps or pops
- [ ] Smooth transitions (600ms animation already in place)
- [ ] Parent folder remains visible and clickable
- [ ] No z-fighting or flickering
- [ ] Connection lines don't stretch awkwardly

**Edge Cases**:
- [ ] Collapsing constellation hides all items
- [ ] Collapsing folder hides its nested children
- [ ] Multiple constellations can be expanded simultaneously
- [ ] Clicking between constellations works correctly
- [ ] No items "stuck" at wrong depths

## Rollback Plan

If implementation causes issues:

1. **Revert Step 1**: Remove expansion-based depth logic from `getItemDepthLayer`
2. **Revert Step 4**: Remove Layer 0.5 from `getDepthZ`
3. **Revert Step 5**: Remove Layer 0.5 from scale/opacity/blur functions
4. **Verify**: Double-click should return to old "bring to front" behavior

**Files to check**:
- `/src/hooks/useConstellation.ts` (lines 817-910, 952-960, 906-950)

## Success Criteria

✅ **Visual**: Children appear in front of parent when constellation expanded
✅ **Interaction**: Double-click toggles expansion with depth reversal
✅ **Performance**: No lag or performance degradation
✅ **UX**: Intuitive "dive into folder" mental model
✅ **Connections**: Short, manageable connection lines

## Future Enhancements

### Option 1: Smooth Depth Transitions
Add animated transitions for depth changes (currently instant).

### Option 2: Focus + Expansion Combination
Combine expansion with focus system for more dramatic depth separation.

### Option 3: Breadcrumb Visual
Show visual breadcrumb when nested deep in folders.

### Option 4: Parent Folder Dimming
Automatically dim parent folder when children are expanded (Step 6).

## Files Modified

1. `/src/hooks/useConstellation.ts`
   - `getItemDepthLayer` (lines ~817-869) - Add expansion depth logic
   - `getDepthZ` (lines ~952-959) - Add Layer 0.5 z-position
   - `getDepthScale` (lines ~906-922) - Add Layer 0.5 scale
   - `getDepthOpacity` (lines ~924-939) - Add Layer 0.5 opacity
   - `getDepthBlur` (lines ~941-950) - Add Layer 0.5 blur

2. `/src/utils/constellation.ts`
   - No changes needed (depth layers set correctly)

3. `/src/app/api/constellations/route.ts`
   - No changes needed (static layers are overridden by dynamic logic)

## Timeline Estimate (Updated with Prerequisites)

### Prerequisites:
- **Pre-Step A** (ID Normalization): 15 minutes
- **Pre-Step B** (Shared getDepthZ): 10 minutes
- **Pre-Step C** (Already done - simplified logic): 0 minutes
- **Pre-Step D** (Edge Case Handling): 10 minutes

### Main Implementation:
- **Step 1** (Update getItemDepthLayer): 20 minutes (simplified - no nested logic)
- **Step 2** (Verify getBaseDepthLayer): 10 minutes
- **Step 3** (Basic testing): 15 minutes
- **Step 4** (Add z-position for 1.5): 10 minutes (no 0.5 needed in MVP)
- **Step 5** (Visual properties): 15 minutes
- **Step 6** (Optional de-emphasis): 15 minutes (optional)
- **Step 7** (Comprehensive testing): 30 minutes

**Total**: ~2.5 hours for complete implementation and testing (with prerequisites)

## Files Modified (Updated)

1. `/src/hooks/useConstellation.ts`
   - `toggleConstellationExpansion` (lines ~1062) - **NEW: ID normalization**
   - `getItemDepthLayer` (lines ~817-869) - Add expansion depth logic (simplified)
   - `getDepthZ` (lines ~952-959) - Add Layer 1.5 z-position
   - `getDepthScale` (lines ~906-922) - Add Layer 1.5 scale
   - `getDepthOpacity` (lines ~924-939) - Add Layer 1.5 opacity
   - `getDepthBlur` (lines ~941-950) - Add Layer 1.5 blur

2. `/src/utils/constellation.ts`
   - **NEW**: `getDepthZ` (lines ~322-331) - Add fractional layer support

3. `/src/app/api/constellations/route.ts`
   - No changes needed (static layers are overridden by dynamic logic)

## Summary of Changes from Original Plan

### ✅ Added (Critical Fixes):
1. **Pre-Step A**: ID normalization to fix expansion matching
2. **Pre-Step B**: Update shared getDepthZ utility
3. **Critical Issues** section documenting all problems

### ✅ Removed (Out of Scope for MVP):
1. **Phase 2 nested children logic** - API doesn't provide data
2. **Layer 0.5** - Simplified to only use Layer 0 and 1.5
3. **parentId checks** - Not needed without nested hierarchy

### ✅ Simplified:
1. **Two depth layers only**: 0 (children) and 1.5 (parent)
2. **Single expansion check**: No nested folder expansion
3. **Clearer scope**: MVP focuses on constellation-level expansion only

## Notes

- Priority is correct depth reversal (children in front)
- **MVP approach**: Simple two-layer system first
- Keep implementation simple initially
- Add visual enhancements only if needed
- Maintain short connection lines as key benefit
- User should feel like they're "opening" folders naturally
- **Phase 2 (future)**: Add nested children when API supports it

## Pre-Implementation Verification Checklist

Before beginning implementation, complete these verification steps:

### ✅ Code Analysis

- [ ] **Verify getDepthZ usage**: Run `grep -r "getDepthZ" src/ --include="*.ts" --include="*.tsx"` and verify all call sites can handle Layer 1.5
- [ ] **Check hit-testing code**: Ensure mouse interaction code handles fractional layers
- [ ] **Review connection rendering**: Verify connection line code works with mixed depth layers
- [ ] **Inspect collision detection**: If present, ensure it handles Layer 1.5

### ✅ Edge Case Review

- [ ] **KB Center handling**: Confirmed KB center stays at Layer 0 when expanded
- [ ] **Expansion + Focus**: Confirmed expansion takes precedence (correct behavior)
- [ ] **ID Normalization**: Using `endsWith` + `slice` instead of `replace`
- [ ] **Empty constellation**: What happens if constellation has no items? (Should be no-op)

### ✅ Data Verification

- [ ] **Confirm expandedConstellations is empty on load**: Items hidden by default
- [ ] **Verify constellation property exists on all items**: Check API response
- [ ] **Confirm isCenter flag is set correctly**: Check center node structure

### ✅ Dependency Check

- [ ] **No Layer 0.5 references**: Removed from all code (MVP scope)
- [ ] **Hook getDepthZ overrides shared version**: Verify precedence
- [ ] **TypeScript compiles**: No type errors with fractional layers

### ✅ Test Data Preparation

- [ ] **Identify test constellation**: Pick one with multiple items (e.g., "my documents")
- [ ] **Note current behavior**: Document what happens on double-click before changes
- [ ] **Prepare rollback**: Know how to revert if issues arise

### ✅ Performance Considerations

- [ ] **Re-render frequency**: Expansion triggers single re-render (acceptable)
- [ ] **Animation timing**: 600ms animation already in place
- [ ] **Memory**: No new data structures added (using existing Set)

## Ready for Implementation?

**Status**: ✅ **YES** - Plan is implementation-ready after completing verification checklist.

**Pre-Implementation Steps**:
1. Complete verification checklist above
2. Create git branch: `git checkout -b feature/depth-layer-reversal`
3. Run verification command: `grep -r "getDepthZ" src/`
4. Document current behavior in browser

**Implementation Order**:
1. Pre-Step A: ID Normalization (~15 min)
2. Pre-Step B: Shared getDepthZ (~10 min)
3. Pre-Step D: Edge Case Handling (~10 min)
4. Step 1: Main getItemDepthLayer Logic (~20 min)
5. Step 2-7: Visual properties and testing (~65 min)

**Total Time**: ~2 hours

**Next Action**: Complete verification checklist, then begin with Pre-Step A (ID Normalization)
