'use client';

import { useState, useCallback, useEffect, useRef, useReducer, useMemo } from 'react';
import { AppState, ConstellationItem, ItemType, Position, Constellation } from '@/types/constellation';
import { initializeConstellations, getNodeAtPosition, getDepthZ, getItemDepthLayer as getItemDepthLayerUtil, calculateHierarchyLevel, areAllAncestorsExpanded, getNodePosition as getNodePositionUtil, inverseTransformPoint } from '@/utils/constellation';
import { getWheelZoomMultiplier } from '@/utils/zoom-utils';
import { logConstellationFocus, logDepthCalculation, logDoubleClick } from '@/utils/debugLog';

// State machine types
type SelectionState = 
  | { type: 'IDLE' }
  | { type: 'GROUP_SELECTED'; groupItems: Set<string>; parentId: string }
  | { type: 'DRAGGING_GROUP'; groupItems: Set<string>; draggedItem: string };

type SelectionAction = 
  | { type: 'SELECT_GROUP'; folderId: string; groupItems: Set<string> }
  | { type: 'START_GROUP_DRAG'; itemId: string }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'COMPLETE_DRAG' };

// State machine reducer
const selectionReducer = (state: SelectionState, action: SelectionAction): SelectionState => {
  switch (action.type) {
    case 'SELECT_GROUP':
      return { 
        type: 'GROUP_SELECTED', 
        groupItems: action.groupItems,
        parentId: action.folderId 
      };
    
    case 'START_GROUP_DRAG':
      if (state.type === 'GROUP_SELECTED' && state.groupItems.has(action.itemId)) {
        return {
          type: 'DRAGGING_GROUP',
          groupItems: state.groupItems,
          draggedItem: action.itemId
        };
      }
      return state;
    
    case 'CLEAR_SELECTION':
      return { type: 'IDLE' };
    
    case 'COMPLETE_DRAG':
      if (state.type === 'DRAGGING_GROUP') {
        return { type: 'GROUP_SELECTED', groupItems: state.groupItems, parentId: '' };
      }
      return state;
    
    default:
      return state;
  }
};

const normalizeId = (id: string): string =>
  id.endsWith('_center') ? id.slice(0, -7) : id;

const MAX_PINNED_SPOTLIGHTS = 3;

// Initial state
const initialState: AppState = {
  // View state
  rotation: { x: 0, y: 0 },
  // Pan to center view on Knowledge Base (650, 350)
  // Formula: pan = screenCenter - worldCenter
  pan: {
    x: (typeof window !== 'undefined' ? window.innerWidth / 2 : 960) - 650,
    y: (typeof window !== 'undefined' ? window.innerHeight / 2 : 540) - 350
  },
  zoom: 1,
  centerX: typeof window !== 'undefined' ? window.innerWidth / 2 : 960,
  centerY: typeof window !== 'undefined' ? window.innerHeight / 2 : 540,
  
  // Interaction state
  isDragging: false,
  dragMode: 'rotate',
  draggedNode: null,
  lastMousePos: { x: 0, y: 0 },
  clickedNodeForExpansion: null,
  
  // UI state
  showConnections: true,
  showLabels: true,
  showHint: false,
  hintText: '',
  isShiftPressed: false,
  depthAnimationActive: false,
  maxDepthLayers: 3,
  
  // Panel visibility state
  showWelcomePanel: true,
  showSidebar: false, // Hidden by default per user request
  showStatusPanel: true,
  showDebugPanel: false,
  showSearchControls: false, // Hidden by default per user request
  
  // Selection and filtering
  selectedItem: null,
  hoveredItem: null,
  highlightedConstellation: null,
  searchQuery: '',
  filterType: 'all',
  
  // Group selection for folders (UI state only, logic handled by state machine)
  selectedGroupItems: new Set<string>(),
  groupParentId: null,
  
  // Node positioning
  nodePositions: {},
  
  // Depth system
  expandedConstellations: new Set<string>(),
  inlineExpandedConstellations: new Set<string>(),
  knowledgeBaseId: null,
  activeSpotlight: null,
  pinnedSpotlights: [],
  focusedItems: new Set<string>(),
  
  // Constellation focus system - enhanced for progressive focusing
  focusedConstellation: null,
  constellationDepthOffsets: {},
  constellationFocusLevels: {},
  focusTransitionActive: false,
  maxFocusLevel: 3,  // Allow up to 3 levels of focus
  
  // Gravity Core Control System
  globalDepthOffset: 0,
  gravityCorePosition: { x: 0, y: 0 }, // Will be set to center
  isDraggingGravityCore: false,
  gravityCoreVisible: false,
  gravityCoreLocked: false,
  
  // Smart Connection Controls
  connectionFocusMode: false,
  hiddenConnectionTypes: new Set<string>(),
  minConnectionStrength: 1,
  enableConnectionBundling: false,
  
  // Edge scrolling
  isEdgeScrolling: false,
  edgeScrollDirection: { x: 0, y: 0 },
  edgeScrollSpeed: 0,
  edgeScrollAcceleration: 0,

  // Spotlight cascade memory
  cascadeSnapshots: {},
};

export function useConstellation() {
  const [selectionState, selectionDispatch] = useReducer(selectionReducer, { type: 'IDLE' });
  const [state, setState] = useState<AppState>(initialState);
  const [constellations, setConstellations] = useState<Constellation[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [crossConstellationConnections, setCrossConstellationConnections] = useState<Array<[string, string]>>([]);
  const [allItems, setAllItems] = useState<ConstellationItem[]>([]);
  const [connections, setConnections] = useState<Array<[string, string]>>([]);

  const itemsById = useMemo(() => {
    return new Map(allItems.map(item => [item.id, item]));
  }, [allItems]);

  const constellationIdSet = useMemo(() => {
    return new Set(constellations.map(constellation => constellation.id));
  }, [constellations]);

  const itemsByNormalizedId = useMemo(() => {
    const map = new Map<string, ConstellationItem>();
    allItems.forEach(item => {
      const normalized = normalizeId(item.id);
      const existing = map.get(normalized);
      if (!existing || existing.isCenter) {
        map.set(normalized, item);
      }
    });
    return map;
  }, [allItems]);

  const childrenByParentId = useMemo(() => {
    const map = new Map<string, ConstellationItem[]>();
    allItems.forEach(item => {
      if (!item.parentId) return;
      const parentKey = normalizeId(item.parentId);
      if (!map.has(parentKey)) {
        map.set(parentKey, []);
      }
      map.get(parentKey)!.push(item);
    });
    return map;
  }, [allItems]);

  const topLevelConstellationIds = useMemo(() => {
    const knowledgeBaseId = state.knowledgeBaseId;
    return constellations
      .map(constellation => constellation.id)
      .filter(id => !knowledgeBaseId || id !== knowledgeBaseId);
  }, [constellations, state.knowledgeBaseId]);

  const itemsByConstellation = useMemo(() => {
    const map = new Map<string, ConstellationItem[]>();
    allItems.forEach(item => {
      if (!item.constellation) return;
      if (!map.has(item.constellation)) {
        map.set(item.constellation, []);
      }
      map.get(item.constellation)!.push(item);
    });
    return map;
  }, [allItems]);

  const getParentNormalized = useCallback((id: string): string | null => {
    const knowledgeBaseId = state.knowledgeBaseId;
    if (!knowledgeBaseId) return null;
    if (!id || id === knowledgeBaseId) return null;

    const directItem = itemsById.get(id);
    if (directItem && directItem.parentId) {
      return directItem.parentId;
    }

    if (constellationIdSet.has(id)) {
      return knowledgeBaseId;
    }

    return null;
  }, [itemsById, constellationIdSet, state.knowledgeBaseId]);

  const spotlightBranches = useMemo(() => {
    const branches: Array<{ branchId: string; offset: number }> = [];
    const knowledgeBaseId = state.knowledgeBaseId;

    if (!knowledgeBaseId) {
      return branches;
    }

    const seen = new Set<string>();
    const addBranch = (branchId: string | null | undefined, offset: number) => {
      if (!branchId) return;
      const normalized = normalizeId(branchId);
      if (seen.has(normalized)) return;
      seen.add(normalized);
      branches.push({ branchId: normalized, offset });
    };

    let offset = 0;

    if (state.activeSpotlight) {
      addBranch(state.activeSpotlight, offset);
      offset += 1;
    }

    for (let i = state.pinnedSpotlights.length - 1; i >= 0; i--) {
      addBranch(state.pinnedSpotlights[i], offset);
      offset += 1;
    }

    addBranch(knowledgeBaseId, offset);

    if (branches.length === 0) {
      addBranch(knowledgeBaseId, 0);
    }

    return branches;
  }, [state.activeSpotlight, state.pinnedSpotlights, state.knowledgeBaseId]);

  const getBaseDepthLayer = useCallback((item: ConstellationItem): number => {
    if (item.isCenter) {
      return item.depthLayer !== undefined ? item.depthLayer : 0;
    }

    if (item.depthLayer !== undefined) {
      if (item.depthLayer === 2) {
        return 2;
      }

      if (item.parentId && item.depthLayer > 2) {
        if (!areAllAncestorsExpanded(item, state.expandedConstellations, allItems)) {
          return 999;
        }
      }

      return item.depthLayer;
    }

    const hierarchyLevel = calculateHierarchyLevel(item, allItems);

    if (item.parentId) {
      return hierarchyLevel;
    }

    const itemConstellation = item.constellation;
    if (itemConstellation && !state.expandedConstellations.has(itemConstellation)) {
      return 999;
    }

    if ((item.type === 'folder' || item.isFolder) && hierarchyLevel === 1) {
      return 1;
    }

    return 1;
  }, [allItems, state.expandedConstellations]);

  const collectCascadeTargets = useCallback((
    rootId: string,
    expandedSet: Set<string>,
    inlineSet: Set<string>,
    activeSpotlightId: string | null,
    pinnedSpotlightIds: string[]
  ): { expanded: string[]; inline: string[] } => {
    const expandedOut = new Set<string>();
    const inlineOut = new Set<string>();
    const visited = new Set<string>();
    const queue: Array<{ id: string; force: boolean }> = [{ id: rootId, force: true }];

    const activeNormalized = activeSpotlightId ? normalizeId(activeSpotlightId) : null;
    const pinnedNormalized = new Set(pinnedSpotlightIds.map(id => normalizeId(id)));

    const includeIdVariants = (target: Set<string>, candidateId: string) => {
      if (!candidateId) return;
      const normalizedVariant = normalizeId(candidateId);
      target.add(candidateId);
      target.add(normalizedVariant);
      const centerVariant = `${normalizedVariant}_center`;
      if (itemsById.has(centerVariant)) {
        target.add(centerVariant);
      }
    };

    console.log('📌 collectCascadeTargets:start', {
      rootId,
      initialQueue: queue.map(entry => entry.id)
    });

    while (queue.length > 0) {
      const { id: actualId, force } = queue.shift()!;
      const normalized = normalizeId(actualId);
      if (visited.has(normalized)) {
        continue;
      }
      visited.add(normalized);

      const item =
        itemsByNormalizedId.get(normalized) ||
        itemsById.get(actualId);

      if (!item) {
        console.log('⚠️ collectCascadeTargets:missingItem', {
          actualId,
          normalizedId: normalized,
          action: 'Confirm this normalized id exists in itemsById/itemsByNormalizedId before cascade runs'
        });
        continue;
      }

      if (actualId !== normalized) {
        console.log('🪪 collectCascadeTargets:normalizedMismatch', {
          actualId,
          normalizedId: normalized,
          resolvedId: item.id,
          isCenter: item.isCenter,
          action: 'Inline snapshots should include normalizeId(id) so downstream lookups resolve this folder'
        });
      }

      const isFolderLike = item.type === 'folder' || item.isFolder || item.isCenter;
      const isSpotlight =
        (activeNormalized !== null && activeNormalized === normalized) ||
        pinnedNormalized.has(normalized);
      const isExpanded = force || expandedSet.has(normalized) || isSpotlight;
      const isInline = inlineSet.has(normalized);

      if (isFolderLike) {
        if (isExpanded) {
          includeIdVariants(expandedOut, item.id);
        }
        if (isInline) {
          includeIdVariants(inlineOut, item.id);
        }
      }

      const shouldTraverse =
        isFolderLike &&
        (force || isExpanded || isInline);

      if (!shouldTraverse) {
        if (isInline) {
          console.log('🚫 collectCascadeTargets:inlineNotTraversed', {
            actualId,
            normalizedId: normalized,
            isFolderLike,
            isInline,
            isExpanded,
            isSpotlight,
            action: 'Ensure expandedSet or spotlightBranch includes this normalized id to descend inline children'
          });
        }
        continue;
      }

      const children =
        childrenByParentId.get(normalized) ||
        childrenByParentId.get(actualId);
      if (children) {
        children.forEach(child => {
          if (child.type === 'folder' || child.isFolder || child.isCenter) {
            if (child.id !== normalizeId(child.id)) {
              console.log('🌿 collectCascadeTargets:queueCenterChild', {
                parentId: actualId,
                childId: child.id,
                childNormalized: normalizeId(child.id),
                action: 'Verify normalized child id is recorded in cascadeSnapshots for inline promotion'
              });
            }
            queue.push({ id: child.id, force: false });
          }
        });
      }

      if (item.isCenter) {
        const constellationCandidates = new Set<string>();
        if (item.constellation) {
          constellationCandidates.add(item.constellation);
          constellationCandidates.add(normalizeId(item.constellation));
        }
        constellationCandidates.add(item.id);
        constellationCandidates.add(normalized);

        constellationCandidates.forEach(constellationId => {
          const relatedItems = itemsByConstellation.get(constellationId);
          if (!relatedItems) return;
          relatedItems.forEach(child => {
            const childNormalized = normalizeId(child.id);
            if (visited.has(childNormalized)) return;
            const childParentNormalized = child.parentId ? normalizeId(child.parentId) : null;
            if (childParentNormalized && childParentNormalized !== normalized) {
              // This child belongs to a different parent in the hierarchy; skip to avoid cross-links.
              return;
            }
            if (child.type === 'folder' || child.isFolder || child.isCenter) {
              if (child.id !== childNormalized) {
                console.log('🌌 collectCascadeTargets:queueConstellationCenter', {
                  parentId: actualId,
                  constellationId: constellationId,
                  childId: child.id,
                  childNormalized,
                  action: 'Ensure constellation cascade stores both center id and normalized id so depth traversal can resolve'
                });
              }
              queue.push({ id: child.id, force: false });
            }
          });
        });
      }
    }

    const expandedResult = Array.from(expandedOut);
    const inlineResult = Array.from(inlineOut);

    console.log('📋 collectCascadeTargets', {
      rootId,
      expandedResult,
      inlineResult
    });

    return {
      expanded: expandedResult,
      inline: inlineResult
    };
  }, [childrenByParentId, itemsById, itemsByNormalizedId, itemsByConstellation]);

  const branchDepthOverrides = useMemo(() => {
    const overrides = new Map<string, number>();
    const haveInline = state.inlineExpandedConstellations.size > 0;
    if (!state.knowledgeBaseId || (spotlightBranches.length === 0 && !haveInline)) {
      return overrides;
    }

    const assignLayer = (key: string | undefined, layer: number) => {
      if (!key) return;
      const current = overrides.get(key);
      if (current === undefined || layer < current) {
        overrides.set(key, layer);
      }
    };

    const assignItem = (item: ConstellationItem | undefined, layer: number) => {
      if (!item) return;
      assignLayer(item.id, layer);
      assignLayer(normalizeId(item.id), layer);

      if (!item.isCenter) {
        const maybeCenterId = `${normalizeId(item.id)}_center`;
        if (itemsById.has(maybeCenterId)) {
          assignLayer(maybeCenterId, layer);
        }
      }
    };

    type BranchTraversalMode =
      | 'spotlight-active'
      | 'spotlight-pinned'
      | 'spotlight-secondary'
      | 'knowledge-base'
      | 'inline';

    type BranchTraversalContext = {
      mode: BranchTraversalMode;
      rootLayer: number;
    };

    const spotlightBranchIdSet = new Set<string>(spotlightBranches.map(branch => branch.branchId));

    const computeChildLayer = (
      context: BranchTraversalContext,
      parentLayer: number,
      depthIndex: number
    ) => {
      if (context.mode === 'inline') {
        return parentLayer + 1;
      }

      const baseFrontLayer = Math.max(0, context.rootLayer - 1);
      if (depthIndex <= 0) {
        return context.rootLayer;
      }

      return baseFrontLayer + (depthIndex - 1);
    };

    const visitDescendants = (
      item: ConstellationItem,
      context: BranchTraversalContext,
      parentLayer: number,
      depthIndex: number
    ) => {
      const normalizedKey = normalizeId(item.id);
      const seenChildren = new Set<string>();
      const childCandidates: ConstellationItem[] = [];

      const addChildCandidate = (candidate: ConstellationItem | undefined | null) => {
        if (!candidate) return;
        const normalizedCandidate = normalizeId(candidate.id);
        const resolvedCandidate =
          itemsByNormalizedId.get(normalizedCandidate) ||
          itemsById.get(candidate.id) ||
          candidate;
        const resolvedNormalized = normalizeId(resolvedCandidate.id);
        if (seenChildren.has(resolvedNormalized)) return;
        if (resolvedNormalized === normalizedKey) return;
        seenChildren.add(resolvedNormalized);
        childCandidates.push(resolvedCandidate);
      };

      const normalizedParentItem = itemsByNormalizedId.get(normalizedKey);
      const directChildren =
        childrenByParentId.get(normalizedKey) ||
        childrenByParentId.get(item.id) ||
        (normalizedParentItem ? childrenByParentId.get(normalizedParentItem.id) : undefined);
      if (directChildren) {
        directChildren.forEach(addChildCandidate);
      }

      if (item.isCenter) {
        const constellationCandidates = new Set<string>();
        constellationCandidates.add(normalizedKey);
        constellationCandidates.add(item.id);
        if (item.constellation) {
          constellationCandidates.add(item.constellation);
          constellationCandidates.add(normalizeId(item.constellation));
        }

        constellationCandidates.forEach(constellationId => {
          const relatedItems = itemsByConstellation.get(constellationId);
          if (!relatedItems) return;
          relatedItems.forEach(child => {
            if (!child) return;
            const childNormalized = normalizeId(child.id);
            if (seenChildren.has(childNormalized)) return;
            if (childNormalized === normalizedKey) return;
            const parentNormalized = child.parentId ? normalizeId(child.parentId) : null;
            if (parentNormalized && parentNormalized !== normalizedKey) return;
            addChildCandidate(child);
          });
        });
      }

      childCandidates.forEach(child => {
        const childDepthIndex = depthIndex + 1;
        const childLayer = computeChildLayer(context, parentLayer, childDepthIndex);
        assignItem(child, childLayer);
        assignLayer(normalizeId(child.id), childLayer);

        const normalizedChild = normalizeId(child.id);
        const isChildFolderLike = child.type === 'folder' || child.isFolder || child.isCenter;
        const inlineExpanded = state.inlineExpandedConstellations.has(normalizedChild);
        const spotlightExpanded = spotlightBranchIdSet.has(normalizedChild);
        const shouldVisit = isChildFolderLike && (
          context.mode === 'inline'
            ? inlineExpanded
            : state.expandedConstellations.has(normalizedChild) || inlineExpanded || spotlightExpanded
        );

        if (inlineExpanded && !shouldVisit) {
          console.log('🚧 visitDescendants:inlineSkipped', {
            parentId: item.id,
            childId: child.id,
            normalizedChild,
            contextMode: context.mode,
            inlineExpanded,
            spotlightExpanded,
            isChildFolderLike,
            action: 'Check inlineSnapshots/expandedConstellations for normalizedChild; it must be marked expanded to propagate depth'
          });
        }

        if (shouldVisit) {
          visitDescendants(child, context, childLayer, childDepthIndex);
        }
      });
    };

    const processedBranches = new Set<string>();
    const activeSpotlightId = state.activeSpotlight ? normalizeId(state.activeSpotlight) : null;
    const pinnedNormalizedIds = new Set(state.pinnedSpotlights.map(id => normalizeId(id)));
    let knowledgeBaseRootLayer: number | null = null;

    const processBranch = (branchId: string, offset: number, options?: { inline?: boolean }) => {
      if (!branchId || processedBranches.has(branchId)) return;
      processedBranches.add(branchId);

      const branchRootItem = itemsByNormalizedId.get(branchId) || itemsById.get(branchId);
      const isKnowledgeBaseBranch = branchId === state.knowledgeBaseId;
      const isInlineMode = !!options?.inline;
      let rootLayer = isKnowledgeBaseBranch
        ? (offset === 0 ? 0 : offset)
        : (isInlineMode ? Math.max(1, branchRootItem ? getBaseDepthLayer(branchRootItem) : 1) : offset + 1);

      if (!branchRootItem) {
        assignLayer(branchId, rootLayer);
        return;
      }

      assignItem(branchRootItem, rootLayer);
      assignLayer(branchId, rootLayer);

      const branchMode: BranchTraversalMode = (() => {
        if (isInlineMode) return 'inline';
        if (isKnowledgeBaseBranch) return 'knowledge-base';
        if (activeSpotlightId && branchId === activeSpotlightId) return 'spotlight-active';
        if (pinnedNormalizedIds.has(branchId)) return 'spotlight-pinned';
        return 'spotlight-secondary';
      })();

      const traversalContext: BranchTraversalContext = {
        mode: branchMode,
        rootLayer
      };

      const branchIsFolder = branchRootItem.type === 'folder' || branchRootItem.isFolder;
      const rootExpanded =
        !branchIsFolder ||
        state.expandedConstellations.has(branchId) ||
        state.inlineExpandedConstellations.has(branchId);
      if (rootExpanded) {
        visitDescendants(branchRootItem, traversalContext, rootLayer, 0);
      }

      if (isKnowledgeBaseBranch && !isInlineMode) {
        knowledgeBaseRootLayer = rootLayer;
      }

      if (!isInlineMode) {
        let parentId = getParentNormalized(branchId);
        let distanceUp = 1;

        while (parentId) {
          const parentItem = itemsByNormalizedId.get(parentId) || itemsById.get(parentId);
          assignItem(parentItem, rootLayer + distanceUp);
          assignLayer(parentId, rootLayer + distanceUp);

          if (parentId === state.knowledgeBaseId) {
            break;
          }

          parentId = getParentNormalized(parentId);
          distanceUp += 1;
        }
      }
    };

    spotlightBranches.forEach(({ branchId, offset }) => processBranch(branchId, offset));

    if (haveInline) {
      state.inlineExpandedConstellations.forEach(branchId => {
        const isInSpotlight = spotlightBranches.some(branch => branch.branchId === branchId);
        if (!isInSpotlight) {
          processBranch(branchId, 0, { inline: true });
        }
      });
    }

    if (knowledgeBaseRootLayer !== null) {
      const centerLayer = knowledgeBaseRootLayer + 1;
      const directChildLayer = centerLayer + 1;

      topLevelConstellationIds.forEach(constellationId => {
        const normalizedId = normalizeId(constellationId);
        if (normalizedId === activeSpotlightId) return;
        if (pinnedNormalizedIds.has(normalizedId)) return;

        const centerId = `${constellationId}_center`;
        assignLayer(centerId, centerLayer);
        assignLayer(normalizedId, centerLayer);

        const constellationItems = itemsByConstellation.get(constellationId);
        if (!constellationItems) return;

        constellationItems.forEach(item => {
          const itemNormalized = normalizeId(item.id);
          if (itemNormalized === activeSpotlightId) return;
          if (pinnedNormalizedIds.has(itemNormalized)) return;

          const isDirectChild =
            normalizeId(item.parentId || '') === normalizedId ||
            item.parentId === constellationId;

          if (!isDirectChild) {
            return;
          }

          assignLayer(item.id, directChildLayer);
          assignLayer(itemNormalized, directChildLayer);
        });
      });
    }

    return overrides;
  }, [
    spotlightBranches,
    itemsByNormalizedId,
    itemsById,
    childrenByParentId,
    getParentNormalized,
    state.expandedConstellations,
    state.inlineExpandedConstellations,
    state.knowledgeBaseId,
    state.activeSpotlight,
    state.pinnedSpotlights,
    topLevelConstellationIds,
    itemsByConstellation
  ]);

  // Synchronous group selection state using refs
  const groupSelectionRef = useRef<{
    isGroupSelected: boolean;
    groupItems: Set<string>;
    parentId: string | null;
    isDraggingGroup: boolean;
  }>({
    isGroupSelected: false,
    groupItems: new Set(),
    parentId: null,
    isDraggingGroup: false
  });

  // Double-click detection ref
  const lastClickRef = useRef<{
    itemId: string | null;
    timestamp: number;
  }>({
    itemId: null,
    timestamp: 0
  });

  // Single-click timeout ref for folders
  const singleClickTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Track if mouse has moved (to distinguish click from drag)
  const mouseMovedRef = useRef<boolean>(false);

  // Define showHint early so it can be used in other effects
  // DISABLED: All notifications disabled per user request
  const showHint = useCallback((_text: string, _duration = 2000) => {
    // Do nothing - notifications disabled
    return;
  }, []);



  // Fetch constellations from API
  useEffect(() => {
    async function fetchConstellations() {
      try {
        setIsLoading(true);
        const response = await fetch('/api/constellations');
        const data = await response.json();

        if (data.success && data.constellations) {
          console.log('✅ Fetched constellations from database:', data.constellations.length);
          console.log('🔗 Cross-constellation connections:', data.crossConstellationConnections?.length || 0);
          setConstellations(data.constellations);
          const knowledgeBaseConstellation = data.constellations.find(
            (constellation: Constellation) => constellation.name === 'Knowledge Base'
          );
          if (knowledgeBaseConstellation) {
            setState(prev => {
              if (
                prev.knowledgeBaseId === knowledgeBaseConstellation.id &&
                prev.activeSpotlight
              ) {
                return prev;
              }
              return {
                ...prev,
                knowledgeBaseId: knowledgeBaseConstellation.id,
                activeSpotlight: prev.activeSpotlight ?? knowledgeBaseConstellation.id
              };
            });
          }
          setCrossConstellationConnections(data.crossConstellationConnections || []);
        } else {
          console.error('❌ Failed to fetch constellations:', data.error);
        }
      } catch (error) {
        console.error('❌ Error fetching constellations:', error);
      } finally {
        setIsLoading(false);
      }
    }

    fetchConstellations();
  }, []);

  // Initialize data - exact copy from original
  useEffect(() => {
    if (constellations.length === 0) return; // Wait for data to be fetched

    const items = initializeConstellations(constellations);
    console.log('🌌 Initialized constellation items:', items.length);
    console.log('📁 Folders found:', items.filter(item => item.type === 'folder' || item.isFolder));
    console.log('👶 Children found:', items.filter(item => item.parentId));
    setAllItems(items);

    // Create connections from fully populated items
    const connectionAccumulator: Array<[string, string]> = [];
    const seenConnections = new Set<string>();
    const addConnection = (from: string | undefined | null, to: string | undefined | null) => {
      if (!from || !to) return;
      const key = `${from}::${to}`;
      if (!seenConnections.has(key)) {
        seenConnections.add(key);
        connectionAccumulator.push([from, to]);
      }
    };

    items.forEach(item => {
      // Link direct constellation children (no parent) to their constellation center
      if (
        !item.isCenter &&
        item.constellation &&
        (!item.parentId || item.parentId === item.constellation)
      ) {
        addConnection(item.id, `${item.constellation}_center`);
      }

      // Link nested items to their direct parent
      if (item.parentId) {
        addConnection(item.parentId, item.id);
      }
    });

    crossConstellationConnections.forEach(([from, to]) => addConnection(from, to));

    console.log('🔗 Connections initialized:', {
      totalConnections: connectionAccumulator.length,
      crossConstellationConnections: crossConstellationConnections.length,
      constellationCenters: constellations.map(c => c.name)
    });

    setConnections(connectionAccumulator);
  }, [constellations, crossConstellationConnections]);

  // Update center position on window resize
  useEffect(() => {
    const updateCenterPosition = () => {
      setState(prev => ({
        ...prev,
        centerX: window.innerWidth / 2,
        centerY: window.innerHeight / 2,
        // Update gravity core position to be above center
        gravityCorePosition: {
          x: window.innerWidth / 2,
          y: window.innerHeight / 2 - 100
        }
      }));
    };

    updateCenterPosition();
    window.addEventListener('resize', updateCenterPosition);
    return () => window.removeEventListener('resize', updateCenterPosition);
  }, []);

  const updateState = useCallback((updates: Partial<AppState>) => {
    setState(prev => ({ ...prev, ...updates }));
  }, []);

  const getNodePosition = useCallback((item: ConstellationItem): Position => {
    // First check if we have a stored position
    if (state.nodePositions[item.id]) {
      return state.nodePositions[item.id];
    }
    
    // If no stored position, calculate it based on parent if it's a child
    if (item.parentId) {
      const parent = allItems.find(i => i.id === item.parentId);
      if (parent) {
        const parentPos = getNodePosition(parent);
        const angleRad = (item.angle * Math.PI) / 180;
        return {
          x: parentPos.x + Math.cos(angleRad) * item.distance,
          y: parentPos.y + Math.sin(angleRad) * item.distance
        };
      }
    }
    
    // Fall back to item's stored position or center
    return { 
      x: item.x || state.centerX, 
      y: item.y || state.centerY 
    };
  }, [state.nodePositions, state.centerX, state.centerY, allItems]);

  const updateNodePosition = useCallback((nodeId: string, newX: number, newY: number) => {
    // Log individual position updates when debugging
    if (state.showDebugPanel) {
      console.log('📍 Individual position update:', {
        nodeId,
        oldPos: state.nodePositions[nodeId],
        newPos: { x: newX, y: newY },
        totalCustomPositions: Object.keys(state.nodePositions).length
      });
    }
    
    setState(prev => ({
      ...prev,
      nodePositions: {
        ...prev.nodePositions,
        [nodeId]: { x: newX, y: newY }
      }
    }));
  }, [state.nodePositions, state.showDebugPanel]);

  const handleSearch = useCallback((query: string) => {
    updateState({ searchQuery: query });
  }, [updateState]);

  const handleTypeFilter = useCallback((type: ItemType | 'all') => {
    updateState({ filterType: type });
  }, [updateState]);

  const handleConstellationHighlight = useCallback((constellationId: string | null) => {
    updateState({ highlightedConstellation: constellationId });
  }, [updateState]);

  const handleItemClick = useCallback((item: ConstellationItem) => {
    updateState({ selectedItem: item });
  }, [updateState]);

  const handleItemHover = useCallback((item: ConstellationItem | null) => {
    updateState({ hoveredItem: item });
  }, [updateState]);

  // Get all descendants of a folder or constellation center (recursive)
  const getAllDescendants = useCallback((parentId: string): string[] => {
    const descendants: string[] = [];
    const parentItem = allItems.find(item => item.id === parentId);
    
    if (!parentItem) return descendants;
    
    // Handle constellation centers - get all items in that constellation
    if (parentItem.isCenter && parentItem.type === 'constellation') {
      const constellationId = parentItem.constellation;
      allItems.forEach(item => {
        // Include all items in the constellation except the center itself
        if (item.constellation === constellationId && !item.isCenter) {
          descendants.push(item.id);
        }
      });
      console.log('⭐ Constellation center descendants:', descendants.length, 'items');
      return descendants;
    }
    
    // Handle regular folders - recursive children search
    const findChildren = (currentParentId: string) => {
      allItems.forEach(item => {
        if (item.parentId === currentParentId) {
          descendants.push(item.id);
          // If this child is also a folder, get its children recursively
          if (item.type === 'folder' || item.isFolder) {
            findChildren(item.id);
          }
        }
      });
    };
    
    findChildren(parentId);
    console.log('📁 Folder descendants:', descendants.length, 'items');
    return descendants;
  }, [allItems]);

  // Synchronous group selection handler using refs with error handling
  const handleGroupSelection = useCallback((folderId: string) => {
    try {
      // Validate inputs
      if (!folderId || typeof folderId !== 'string') {
        console.error('📁 Invalid folderId provided to handleGroupSelection:', folderId);
        return;
      }

      if (!allItems || allItems.length === 0) {
        console.error('📁 No items available for group selection');
        showHint('Error: No items available for selection', 2000);
        return;
      }

      // Verify the folder exists
      const folder = allItems.find(i => i.id === folderId);
      if (!folder) {
        console.error('📁 Folder not found for group selection:', folderId);
        showHint('Error: Selected folder no longer exists', 2000);
        return;
      }

      const descendants = getAllDescendants(folderId);
      const groupItems = new Set([folderId, ...descendants]);
      
      // Validate that we have valid items
      if (groupItems.size === 0) {
        console.warn('📁 No items found for group selection');
        showHint('Warning: No items to select in this group', 2000);
        return;
      }

      console.log('📁 Starting group selection for:', folderId, 'with', groupItems.size, 'items');
      console.log('📁 Group items:', Array.from(groupItems));
      
      // Defensive ref update
      if (!groupSelectionRef.current) {
        console.error('📁 groupSelectionRef is null, reinitializing');
        groupSelectionRef.current = {
          isGroupSelected: false,
          groupItems: new Set(),
          parentId: null,
          isDraggingGroup: false
        };
      }

      // Immediate synchronous update via ref
      groupSelectionRef.current = {
        isGroupSelected: true,
        groupItems,
        parentId: folderId,
        isDraggingGroup: false
      };
      
      console.log('📁 Ref state updated immediately (synchronous)');
      
      // Update state machine for consistency (but we don't rely on it for drag detection)
      selectionDispatch({ 
        type: 'SELECT_GROUP', 
        folderId, 
        groupItems 
      });
      
      // Update UI state for visual indicators
      setState(prev => ({
        ...prev,
        selectedGroupItems: groupItems,
        groupParentId: folderId
      }));
      
      console.log('📁 UI state updated with group selection');
      
      const folderTitle = folder.title || 'Unnamed Folder';
      showHint(`Selected group: ${groupItems.size} items (${folderTitle} + ${descendants.length} children). Now drag to move group.`, 3000);
      
    } catch (error) {
      console.error('📁 Error in handleGroupSelection:', error);
      showHint('Error: Group selection failed. Please try again.', 3000);
      
      // Reset to safe state
      groupSelectionRef.current = {
        isGroupSelected: false,
        groupItems: new Set(),
        parentId: null,
        isDraggingGroup: false
      };
    }
  }, [getAllDescendants, allItems, showHint]);

  // Clear group selection using refs
  const clearGroupSelection = useCallback(() => {
    // Immediate synchronous clear via ref
    groupSelectionRef.current = {
      isGroupSelected: false,
      groupItems: new Set(),
      parentId: null,
      isDraggingGroup: false
    };
    
    console.log('📁 Group selection cleared (synchronous)');
    
    // Update state machine for consistency
    selectionDispatch({ type: 'CLEAR_SELECTION' });
    
    // Update UI state for visual indicators
    setState(prev => ({
      ...prev,
      selectedGroupItems: new Set<string>(),
      groupParentId: null
    }));
  }, []);

  // Remove old startGroupDrag function as it's replaced by state machine logic

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Check if user clicked a folder but hasn't started dragging yet
    if (!state.isDragging && !state.isDraggingGravityCore && state.clickedNodeForExpansion) {
      // User is trying to drag a folder - start the drag now
      const deltaX = Math.abs(e.clientX - state.lastMousePos.x);
      const deltaY = Math.abs(e.clientY - state.lastMousePos.y);

      // Only start drag if moved more than 3px (avoid accidental drags)
      if (deltaX > 3 || deltaY > 3) {
        console.log('🎯 Starting folder drag on mouse move');
        mouseMovedRef.current = true;
        setState(prev => ({
          ...prev,
          isDragging: true,
          dragMode: 'node',
          draggedNode: prev.clickedNodeForExpansion
        }));
      }
      return;
    }

    if (!state.isDragging && !state.isDraggingGravityCore) return;

    // Track that mouse has moved (for click vs drag detection)
    mouseMovedRef.current = true;

    // console.log('🖱️ Mouse move - dragging:', state.isDragging, 'gravity core:', state.isDraggingGravityCore, 'selection state:', selectionState.type);

    const deltaX = e.clientX - state.lastMousePos.x;
    const deltaY = e.clientY - state.lastMousePos.y;
    
    // Edge scrolling detection (only during node dragging)
    if (state.dragMode === 'node' && state.draggedNode) {
      const edgeThreshold = 60; // Distance from edge to start scrolling
      const accelerationZone = 40; // Inner zone for acceleration
      const maxScrollSpeed = 20; // Maximum pan speed
      
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      
      // Calculate distances from edges
      const distFromLeft = e.clientX;
      const distFromRight = viewportWidth - e.clientX;
      const distFromTop = e.clientY;
      const distFromBottom = viewportHeight - e.clientY;
      
      let scrollX = 0;
      let scrollY = 0;
      let isNearEdge = false;
      
      // Horizontal edge scrolling
      if (distFromLeft < edgeThreshold) {
        isNearEdge = true;
        const normalizedDist = Math.max(0, Math.min(1, (edgeThreshold - distFromLeft) / accelerationZone));
        scrollX = normalizedDist * maxScrollSpeed; // Scroll right (positive pan)
      } else if (distFromRight < edgeThreshold) {
        isNearEdge = true;
        const normalizedDist = Math.max(0, Math.min(1, (edgeThreshold - distFromRight) / accelerationZone));
        scrollX = -normalizedDist * maxScrollSpeed; // Scroll left (negative pan)
      }
      
      // Vertical edge scrolling
      if (distFromTop < edgeThreshold) {
        isNearEdge = true;
        const normalizedDist = Math.max(0, Math.min(1, (edgeThreshold - distFromTop) / accelerationZone));
        scrollY = normalizedDist * maxScrollSpeed; // Scroll down (positive pan)
      } else if (distFromBottom < edgeThreshold) {
        isNearEdge = true;
        const normalizedDist = Math.max(0, Math.min(1, (edgeThreshold - distFromBottom) / accelerationZone));
        scrollY = -normalizedDist * maxScrollSpeed; // Scroll up (negative pan)
      }
      
      // Update edge scrolling state
      setState(prev => ({
        ...prev,
        isEdgeScrolling: isNearEdge,
        edgeScrollDirection: { x: scrollX, y: scrollY },
        edgeScrollSpeed: Math.sqrt(scrollX * scrollX + scrollY * scrollY),
        edgeScrollAcceleration: isNearEdge ? 0.1 : -0.2 // Smooth acceleration/deceleration
      }));
    }
    
    if (state.isDraggingGravityCore) {
      // Vertical movement controls depth
      const depthDelta = deltaY * 5; // Sensitivity factor
      const newDepthOffset = Math.max(-2000, Math.min(2000, state.globalDepthOffset - depthDelta));
      
      setState(prev => ({
        ...prev,
        globalDepthOffset: newDepthOffset,
        gravityCorePosition: {
          x: prev.gravityCorePosition.x,
          y: prev.gravityCorePosition.y + deltaY
        },
        lastMousePos: { x: e.clientX, y: e.clientY }
      }));
      
      // Show depth indicator
      const depthPercent = Math.round((newDepthOffset + 2000) / 40);
      const depthDirection = newDepthOffset > 0 ? 'Forward' : newDepthOffset < 0 ? 'Backward' : 'Center';
      showHint(`Global Depth: ${depthPercent}% (${depthDirection}) - Offset: ${newDepthOffset}z`, 100);
    }
    else if (state.dragMode === 'node' && state.draggedNode) {
      // FIXED: Proper world coordinate calculation for node dragging
      
      // Get current and previous mouse positions in screen space
      const currentScreenPos = { x: e.clientX, y: e.clientY };
      const lastScreenPos = state.lastMousePos;
      
      // Convert screen positions to world coordinates
      // We need to get the Z position of the dragged item for accurate inverse transform
      const draggedItem = allItems.find(item => item.id === state.draggedNode);
      if (!draggedItem) return;
      
      const depthLayer = getItemDepthLayerUtil(draggedItem);
      const zPosition = getConstellationDepthZ(draggedItem, depthLayer);
      
      // Transform current and last mouse positions to world space
      const currentWorldPos = inverseTransformPoint(currentScreenPos.x, currentScreenPos.y, zPosition, state);
      const lastWorldPos = inverseTransformPoint(lastScreenPos.x, lastScreenPos.y, zPosition, state);
      
      // Calculate world space delta
      const worldDeltaX = currentWorldPos.x - lastWorldPos.x;
      const worldDeltaY = currentWorldPos.y - lastWorldPos.y;
      
      if (groupSelectionRef.current.isDraggingGroup) {
        // Group dragging with proper world coordinates
        const newPositions = { ...state.nodePositions };
        
        groupSelectionRef.current.groupItems.forEach(itemId => {
          try {
            const item = allItems.find(i => i.id === itemId);
            if (item) {
              const currentPos = getNodePositionUtil(item, state.nodePositions, allItems);
              if (currentPos && typeof currentPos.x === 'number' && typeof currentPos.y === 'number') {
                newPositions[itemId] = {
                  x: currentPos.x + worldDeltaX,
                  y: currentPos.y + worldDeltaY
                };
              }
            }
          } catch (error) {
            console.error('Error moving group item:', itemId, error);
          }
        });
        
        setState(prev => ({
          ...prev,
          nodePositions: newPositions,
          lastMousePos: { x: e.clientX, y: e.clientY }
        }));
        
        showHint(`Moving group: ${groupSelectionRef.current.groupItems.size} items`, 100);
      } else {
        // Single node dragging with proper world coordinates
        const currentPos = getNodePositionUtil(draggedItem, state.nodePositions, allItems);
        
        updateNodePosition(
          state.draggedNode, 
          currentPos.x + worldDeltaX, 
          currentPos.y + worldDeltaY
        );
      }
    } else if (state.dragMode === 'rotate') {
      updateState({
        rotation: {
          x: Math.max(-45, Math.min(45, state.rotation.x + deltaY * 0.2)),
          y: (state.rotation.y + deltaX * 0.3) % 360
        }
      });
    } else if (state.dragMode === 'pan') {
      updateState({
        pan: {
          x: state.pan.x + deltaX,
          y: state.pan.y + deltaY
        }
      });
    }
    
    updateState({ lastMousePos: { x: e.clientX, y: e.clientY } });
  }, [state, allItems, getNodePosition, updateNodePosition, updateState, showHint]);

  const handleMouseUp = useCallback(() => {
    console.log('🖱️ Mouse up - was dragging:', state.isDragging, 'was gravity core:', state.isDraggingGravityCore, 'was group drag:', groupSelectionRef.current.isDraggingGroup);

    // Complete group drag if we were dragging a group
    if (groupSelectionRef.current.isDraggingGroup) {
      groupSelectionRef.current.isDraggingGroup = false;
      console.log('📁 Group drag completed (ref updated)');
      selectionDispatch({ type: 'COMPLETE_DRAG' });
    }

    updateState({
      isDragging: false,
      isDraggingGravityCore: false,
      draggedNode: null,
      clickedNodeForExpansion: null,
      showHint: false,
      // Reset edge scrolling state
      isEdgeScrolling: false,
      edgeScrollDirection: { x: 0, y: 0 },
      edgeScrollSpeed: 0,
      edgeScrollAcceleration: 0,
    });
  }, [updateState, state.isDragging, state.isDraggingGravityCore]);

  const handleWheel = useCallback((e: React.WheelEvent<SVGSVGElement>) => {
    if (!e.shiftKey) {
      return;
    }

    e.preventDefault();

    const multiplier = getWheelZoomMultiplier(e.nativeEvent);
    const currentZoom = state.zoom || 1;
    const newZoom = Math.max(0.3, Math.min(3, currentZoom * multiplier));

    if (!Number.isFinite(newZoom) || Math.abs(newZoom - currentZoom) < 1e-6) {
      return;
    }

    const svgElement = e.currentTarget;
    const rect = svgElement.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldBefore = inverseTransformPoint(mouseX, mouseY, 0, state);
    const worldAfter = inverseTransformPoint(mouseX, mouseY, 0, { ...state, zoom: newZoom });

    const currentPan = state.pan || { x: 0, y: 0 };
    const panAdjustment = {
      x: currentPan.x + (worldAfter.x - worldBefore.x),
      y: currentPan.y + (worldAfter.y - worldBefore.y)
    };

    if (!Number.isFinite(panAdjustment.x) || !Number.isFinite(panAdjustment.y)) {
      updateState({ zoom: newZoom });
      return;
    }

    updateState({
      zoom: newZoom,
      pan: panAdjustment
    });
  }, [state, updateState]);

  // Enhanced Shift+Click handler for progressive constellation focusing
  const handleShiftClick = useCallback((item: ConstellationItem, event: React.MouseEvent) => {
    console.log('🎯 handleShiftClick called:', {
      item: item.title,
      shiftKey: event.shiftKey,
      constellation: item.constellation,
      isCenter: item.isCenter
    });
    
    if (!event.shiftKey) {
      console.log('❌ Shift key not pressed, returning false');
      return false;
    }
    
    event.preventDefault();
    event.stopPropagation();
    
    // Find which constellation this item belongs to
    const itemConstellation = item.constellation || (item.isCenter ? item.id.replace('_center', '') : null);
    
    if (!itemConstellation) {
      console.warn('No constellation found for item:', item.title);
      return false;
    }
    
    setState((prevState) => {
      const { 
        focusedConstellation, 
        constellationDepthOffsets, 
        constellationFocusLevels,
        maxFocusLevel 
      } = prevState;
      
      const newDepthOffsets = { ...constellationDepthOffsets };
      const newFocusLevels = { ...constellationFocusLevels };
      
      // Get current focus level for this constellation (default 0)
      const currentLevel = newFocusLevels[itemConstellation] || 0;
      const nextLevel = currentLevel + 1;
      
      // If already at max focus level, cycle back to normal
      if (nextLevel > maxFocusLevel) {
        delete newDepthOffsets[itemConstellation];
        delete newFocusLevels[itemConstellation];
        
        // If this was the focused constellation, unfocus it
        const newFocusedConstellation = focusedConstellation === itemConstellation ? null : focusedConstellation;
        
        showHint(`${item.constellation || 'Constellation'} returned to normal depth`, 2000);
        
        return {
          ...prevState,
          focusedConstellation: newFocusedConstellation,
          constellationDepthOffsets: newDepthOffsets,
          constellationFocusLevels: newFocusLevels,
          focusTransitionActive: true
        };
      }
      
      // Calculate VERY dramatic progressive depth offset
      const baseOffset = 1500; // Increased from 1200 to 1500
      const exponentialOffset = baseOffset * Math.pow(1.8, nextLevel - 1); // More aggressive exponential
      const newOffset = exponentialOffset;

      console.log('🚀 Constellation focus offset:', {
        constellation: itemConstellation,
        level: nextLevel,
        offset: newOffset,
        formula: `${baseOffset} * 1.8^${nextLevel-1}`
      });
      
      // Update this constellation's focus
      newFocusLevels[itemConstellation] = nextLevel;
      newDepthOffsets[itemConstellation] = newOffset;
      
      // Push other constellations back MUCH more dramatically
      constellations.forEach(constellation => {
        if (constellation.id !== itemConstellation) {
          const otherLevel = newFocusLevels[constellation.id] || 0;
          if (otherLevel === 0) {
            // Push back constellations MUCH more dramatically
            newDepthOffsets[constellation.id] = -600; // Was -400, now -600
          }
        }
      });
      
      // Get constellation name for hint
      const constellationName = constellations.find(c => c.id === itemConstellation)?.name || 'Constellation';
      const levelText = nextLevel === 1 ? 'focused' : 
                       nextLevel === 2 ? 'brought closer' : 
                       'brought to foreground';
      showHint(`${constellationName} ${levelText} (level ${nextLevel}/${maxFocusLevel})`, 2000);
      
      return {
        ...prevState,
        focusedConstellation: itemConstellation,
        constellationDepthOffsets: newDepthOffsets,
        constellationFocusLevels: newFocusLevels,
        focusTransitionActive: true
      };
    });
    
    // End animation after transition
    setTimeout(() => {
      setState(prevState => ({
        ...prevState,
        focusTransitionActive: false
      }));
    }, 800);
    
    return true;
  }, [constellations, showHint]);

  const getItemDepthLayer = useCallback((item: ConstellationItem): number => {
    if (state.focusedItems.has(item.id)) {
      return 0;
    }

    const normalizedId = normalizeId(item.id);
    const overrideLayer =
      branchDepthOverrides.get(item.id) ??
      branchDepthOverrides.get(normalizedId);

    let layer = overrideLayer !== undefined ? overrideLayer : getBaseDepthLayer(item);
    const itemConstellation = item.constellation || (item.isCenter ? normalizedId : null);

    if (state.focusedConstellation && itemConstellation) {
      const isFocusedConstellation = itemConstellation === state.focusedConstellation;

      if (isFocusedConstellation) {
        if (item.isCenter) {
          return 0;
        }

        if (item.depthLayer !== undefined) {
          return item.depthLayer;
        }

        const hierarchyLevel = calculateHierarchyLevel(item, allItems);

        if (item.parentId) {
          if (!areAllAncestorsExpanded(item, state.expandedConstellations, allItems)) {
            return 999;
          }
        }

        return hierarchyLevel;
      }

      if (layer >= 999) {
        return layer;
      }

      return layer + 2;
    }

    return layer;
  }, [
    allItems,
    branchDepthOverrides,
    getBaseDepthLayer,
    state.expandedConstellations,
    state.focusedConstellation,
    state.focusedItems
  ]);

  const getDepthScale = useCallback((depthLayer: number, isCenter: boolean = false): number => {
    if (depthLayer === 0) return 1.0;      // Constellation centers - full size
    if (depthLayer === 1) return 0.95;     // Root items - nearly full size
    if (depthLayer === 1.5) return 1.0;    // Children FORWARD - full size (prominent)
    if (depthLayer >= 999) return 0.0;     // Hidden items

    // Constellation centers should stay larger even when pushed back (for labels)
    if (isCenter) {
      // Less aggressive scaling for constellation centers
      const scaleFactor = 0.9; // 90% per layer instead of 80%
      return Math.max(0.75, Math.pow(scaleFactor, depthLayer - 1)); // Minimum 75% size
    }

    // More aggressive scaling for regular items
    const scaleFactor = 0.8;
    return Math.pow(scaleFactor, depthLayer - 1);
  }, []);

  const getDepthOpacity = useCallback((depthLayer: number, isCenter: boolean = false): number => {
    if (depthLayer === 0) return 1.0;      // Full opacity
    if (depthLayer === 1) return 0.95;     // Root items - nearly full opacity
    if (depthLayer === 1.5) return 1.0;    // Children FORWARD - full opacity (no dimming of parent)
    if (depthLayer >= 999) return 0.0;     // Hidden

    // Constellation centers should stay more visible (for labels)
    if (isCenter) {
      const opacityFactor = 0.9; // Less opacity reduction for centers
      return Math.max(0.6, Math.pow(opacityFactor, depthLayer - 1)); // Minimum 60% opacity
    }

    // More noticeable opacity reduction for regular items
    const opacityFactor = 0.85; // Each layer is 85% opacity of previous
    return Math.pow(opacityFactor, depthLayer - 1);
  }, []);

  const getDepthBlur = useCallback((depthLayer: number): string => {
    if (depthLayer === 0) return 'none';    // No blur for centers
    if (depthLayer === 1) return 'none';    // No blur for root items
    if (depthLayer === 1.5) return 'none';  // Children FORWARD - no blur (crisp and clear)
    if (depthLayer >= 999) return 'blur(20px)'; // Heavy blur for hidden

    // Progressive blur starting from layer 2
    const blurAmount = (depthLayer - 1) * 0.5; // 0.5px blur per layer
    return `blur(${Math.min(blurAmount, 6)}px)`; // Max 6px blur
  }, []);

  const getDepthZ = useCallback((depthLayer: number): number => {
    if (depthLayer >= 999) return -2000;   // Far back for hidden
    if (depthLayer === 1.5) return -100;   // Children FORWARD - closer than layer 1 (-150)

    // Each layer is 150 units back in Z-space (dramatic separation)
    // Layer 0: 0, Layer 1: -150, Layer 1.5: -100 (FORWARD!), Layer 2: -300, etc.
    return -depthLayer * 150;
  }, []);

  // New function to get constellation-adjusted Z position with global depth offset
  const getConstellationDepthZ = useCallback((item: ConstellationItem, baseDepthLayer: number): number => {
    // Get base Z position
    let z = getDepthZ(baseDepthLayer);
    
    // Apply global depth offset FIRST
    z += state.globalDepthOffset;
    
    // Then apply constellation-specific offset
    const itemConstellation = item.constellation || (item.isCenter ? item.id.replace('_center', '') : null);
    
    if (itemConstellation && state.constellationDepthOffsets[itemConstellation] !== undefined) {
      const offset = state.constellationDepthOffsets[itemConstellation];
      // Apply constellation offset
      z += offset;
      
      // Log significant offsets
      if (Math.abs(offset) > 100) {
        console.log('🌟 Constellation offset applied:', {
          item: item.title,
          constellation: itemConstellation,
          baseZ: getDepthZ(baseDepthLayer),
          globalOffset: state.globalDepthOffset,
          constellationOffset: offset,
          finalZ: z
        });
      }
    }
    
    return z;
  }, [state.constellationDepthOffsets, state.globalDepthOffset, getDepthZ]);

  // Bring constellation to front (Focus Mode)
  const bringConstellationToFront = useCallback((folderId: string) => {
    const folderItem = allItems.find(item => item.id === folderId);
    if (!folderItem) {
      return;
    }

    // Find which constellation this folder belongs to
    // First try the constellation property
    let itemConstellation = folderItem.constellation;

    // If constellation property is not set, check if this folder IS a constellation
    if (!itemConstellation) {
      const matchingConstellation = constellations.find(c => c.id === folderId);
      if (matchingConstellation) {
        itemConstellation = matchingConstellation.id;
      }
    }

    // For constellation centers
    if (!itemConstellation && folderItem.isCenter) {
      itemConstellation = folderItem.id.replace('_center', '');
    }

    if (!itemConstellation) {
      return;
    }

    setState((prevState: AppState) => {
      // If clicking the same constellation, unfocus it
      if (prevState.focusedConstellation === itemConstellation) {
        logConstellationFocus(folderId, folderItem.title, itemConstellation, 'unfocus');
        showHint(`${folderItem.title} returned to normal view`, 2000);
        return {
          ...prevState,
          focusedConstellation: null,
          focusTransitionActive: true,
          depthAnimationActive: true
        };
      }

      // Focus the new constellation
      logConstellationFocus(folderId, folderItem.title, itemConstellation, 'focus');
      showHint(`${folderItem.title} brought to front`, 2000);
      return {
        ...prevState,
        focusedConstellation: itemConstellation,
        focusTransitionActive: true,
        depthAnimationActive: true
      };
    });

    // Turn off animation after transition
    setTimeout(() => {
      setState(prevState => ({
        ...prevState,
        focusTransitionActive: false,
        depthAnimationActive: false
      }));
    }, 600);
  }, [allItems, constellations, showHint]);

  // Enhanced folder expansion logic for nested folders
  const toggleConstellationExpansion = useCallback((folderId: string) => {
    console.log('🔄 toggleConstellationExpansion called with ID:', folderId);

    const normalizedId = normalizeId(folderId);
    console.log('🔄 Normalized ID:', normalizedId, 'from:', folderId);

    const folderItem = allItems.find(item => item.id === folderId);
    const isCurrentlyExpanded = state.expandedConstellations.has(normalizedId);

    if (folderItem) {
      showHint(`${folderItem.title}: ${isCurrentlyExpanded ? 'Collapsing...' : 'Expanding...'}`, 1000);
    }

    const updatedExpanded = new Set(state.expandedConstellations);

    if (isCurrentlyExpanded) {
      updatedExpanded.delete(normalizedId);
      console.log('📁 Collapsing folder:', normalizedId);

      const collapseDescendants = (parentActualId: string) => {
        allItems.forEach(item => {
          if (item.parentId === parentActualId && (item.type === 'folder' || item.isFolder)) {
            const normalizedChild = normalizeId(item.id);
            updatedExpanded.delete(normalizedChild);
            console.log('📁 Also collapsing descendant folder:', item.title);
            collapseDescendants(item.id);
          }
        });
      };
      collapseDescendants(folderId);
    } else {
      updatedExpanded.add(normalizedId);
      console.log('📂 Expanding folder:', normalizedId);
    }

    console.log('📋 Current expanded folders:', Array.from(updatedExpanded));

    setState(prevState => {
      const knowledgeBaseNormalized = prevState.knowledgeBaseId
        ? normalizeId(prevState.knowledgeBaseId)
        : null;
      const nextPinned = prevState.pinnedSpotlights
        .map(id => normalizeId(id))
        .filter(id => !knowledgeBaseNormalized || id !== knowledgeBaseNormalized);
      let nextActive = prevState.activeSpotlight
        ? normalizeId(prevState.activeSpotlight)
        : null;

      if (isCurrentlyExpanded) {
        if (nextActive === normalizedId) {
          if (nextPinned.length > 0) {
            nextActive = nextPinned[nextPinned.length - 1];
            nextPinned.pop();
          } else {
            nextActive = knowledgeBaseNormalized ?? null;
          }
        } else {
          const pinnedIndex = nextPinned.indexOf(normalizedId);
          if (pinnedIndex >= 0) {
            nextPinned.splice(pinnedIndex, 1);
          }
        }
      } else {
        const pinnedIndex = nextPinned.indexOf(normalizedId);

        if (pinnedIndex >= 0) {
          nextPinned.splice(pinnedIndex, 1);
          if (nextActive && nextActive !== normalizedId) {
            if (!knowledgeBaseNormalized || nextActive !== knowledgeBaseNormalized) {
              if (!nextPinned.includes(nextActive)) {
                nextPinned.push(nextActive);
              }
            }
          }
          nextActive = normalizedId;
        } else {
          if (nextActive && nextActive !== normalizedId) {
            if (!knowledgeBaseNormalized || nextActive !== knowledgeBaseNormalized) {
              if (!nextPinned.includes(nextActive)) {
                nextPinned.push(nextActive);
              }
            }
          }
          nextActive = normalizedId;
        }
      }

      while (nextPinned.length > MAX_PINNED_SPOTLIGHTS) {
        nextPinned.shift();
      }

      if (!nextActive && knowledgeBaseNormalized) {
        nextActive = knowledgeBaseNormalized;
      }

      console.log('🔆 Active spotlight:', nextActive, '| Pinned spotlights:', nextPinned);

      return {
        ...prevState,
        expandedConstellations: new Set(updatedExpanded),
        activeSpotlight: nextActive,
        pinnedSpotlights: nextPinned,
        depthAnimationActive: true
      };
    });

    setTimeout(() => {
      setState(prevState => ({
        ...prevState,
        depthAnimationActive: false
      }));
    }, 600);

  }, [allItems, showHint, state.expandedConstellations]);

  const toggleFolderVisibilityInline = useCallback((folderId: string) => {
    const normalizedId = normalizeId(folderId);
    const folderItem = allItems.find(item => item.id === folderId);
    const isCurrentlyExpanded = state.expandedConstellations.has(normalizedId);

    if (folderItem) {
      showHint(
        `${folderItem.title}: ${isCurrentlyExpanded ? 'Hiding contents' : 'Showing contents'}`,
        900
      );
    }

    const collapseDescendants = (parentActualId: string, targetSet: Set<string>) => {
      allItems.forEach(item => {
        if (item.parentId === parentActualId && (item.type === 'folder' || item.isFolder)) {
          const childNormalized = normalizeId(item.id);
          targetSet.delete(childNormalized);
          collapseDescendants(item.id, targetSet);
        }
      });
    };

    const buildAncestorPath = (targetId: string): string[] => {
      const path: string[] = [];
      let current: string | null = normalizeId(targetId);

      while (current) {
        if (path.includes(current)) break;
        path.unshift(current);
        if (current === state.knowledgeBaseId) break;
        const parent = getParentNormalized(current);
        if (!parent) break;
        current = normalizeId(parent);
      }
      return path;
    };

    setState(prevState => {
      const nextInline = new Set(prevState.inlineExpandedConstellations);

      if (nextInline.has(normalizedId)) {
        const removePath = buildAncestorPath(normalizedId);
        removePath.forEach(id => {
          if (!prevState.expandedConstellations.has(id)) {
            nextInline.delete(id);
          }
        });
        collapseDescendants(folderId, nextInline);
      } else {
        const addPath = buildAncestorPath(normalizedId);
        addPath.forEach(id => {
          if (!prevState.expandedConstellations.has(id)) {
            nextInline.add(id);
          }
        });
      }

      return {
        ...prevState,
        inlineExpandedConstellations: nextInline
      };
    });
  }, [allItems, showHint, state.expandedConstellations, state.inlineExpandedConstellations, state.knowledgeBaseId, getParentNormalized]);

  const promoteBranchToSpotlight = useCallback((folderId: string) => {
    const folderItem = itemsById.get(folderId) || itemsByNormalizedId.get(normalizeId(folderId));

    setState(prevState => {
      const normalizedRoot = normalizeId(folderId);
      const activeNormalized = prevState.activeSpotlight ? normalizeId(prevState.activeSpotlight) : null;
      const branchSnapshot = collectCascadeTargets(
        folderId,
        prevState.expandedConstellations,
        prevState.inlineExpandedConstellations,
        prevState.activeSpotlight,
        prevState.pinnedSpotlights
      );

      console.log('🚀 Promote branch snapshot', {
        rootId: folderId,
        normalizedRoot,
        activeSpotlight: prevState.activeSpotlight,
        pinnedSpotlights: prevState.pinnedSpotlights,
        expandedSnapshot: branchSnapshot.expanded,
        inlineSnapshot: branchSnapshot.inline
      });

      const addExpandedVariants = (target: Set<string>, candidateId: string) => {
        const normalizedCandidate = normalizeId(candidateId);
        target.add(normalizedCandidate);
        target.add(candidateId);
        const centerVariant = `${normalizedCandidate}_center`;
        if (itemsById.has(centerVariant)) {
          target.add(centerVariant);
        }
      };

      const knowledgeBaseNormalized = prevState.knowledgeBaseId ? normalizeId(prevState.knowledgeBaseId) : null;
      const nextExpanded = new Set(prevState.expandedConstellations);
      branchSnapshot.expanded.forEach(id => addExpandedVariants(nextExpanded, id));
      branchSnapshot.inline.forEach(id => addExpandedVariants(nextExpanded, id));
      addExpandedVariants(nextExpanded, folderId);
      addExpandedVariants(nextExpanded, normalizedRoot);

      const nextInline = new Set(prevState.inlineExpandedConstellations);
      branchSnapshot.inline.forEach(id => {
        const normalizedId = normalizeId(id);
        nextInline.delete(id);
        nextInline.delete(normalizedId);
        nextInline.delete(`${normalizedId}_center`);
      });

      let nextActive = normalizedRoot;
      const nextPinned = prevState.pinnedSpotlights
        .map(id => normalizeId(id))
        .filter(id => id !== normalizedRoot);

      if (activeNormalized && activeNormalized !== normalizedRoot) {
        if (!knowledgeBaseNormalized || activeNormalized !== knowledgeBaseNormalized) {
          if (!nextPinned.includes(activeNormalized)) {
            nextPinned.push(activeNormalized);
          }
        }
      }

      while (nextPinned.length > MAX_PINNED_SPOTLIGHTS) {
        nextPinned.shift();
      }

      const nextSnapshots = { ...prevState.cascadeSnapshots };
      const expandedSnapshotSet = new Set<string>(branchSnapshot.expanded);
      expandedSnapshotSet.add(normalizedRoot);
      expandedSnapshotSet.add(folderId);
      const inlineSnapshotSet = new Set<string>(branchSnapshot.inline);
      nextSnapshots[normalizedRoot] = {
        expanded: Array.from(expandedSnapshotSet),
        inline: Array.from(inlineSnapshotSet)
      };

      return {
        ...prevState,
        expandedConstellations: nextExpanded,
        inlineExpandedConstellations: nextInline,
        activeSpotlight: nextActive,
        pinnedSpotlights: nextPinned,
        cascadeSnapshots: nextSnapshots,
        depthAnimationActive: false
      };
    });

    if (folderItem) {
      showHint(`${folderItem.title} spotlighted`, 1200);
    } else {
      showHint('Branch spotlighted', 1200);
    }
  }, [collectCascadeTargets, itemsById, itemsByNormalizedId, showHint]);

  const demoteBranchFromSpotlight = useCallback((folderId: string) => {
    const folderItem = itemsById.get(folderId) || itemsByNormalizedId.get(normalizeId(folderId));

    setState(prevState => {
      const normalizedRoot = normalizeId(folderId);
      const activeNormalized = prevState.activeSpotlight ? normalizeId(prevState.activeSpotlight) : null;
      const knowledgeBaseNormalized = prevState.knowledgeBaseId ? normalizeId(prevState.knowledgeBaseId) : null;

      const snapshot = prevState.cascadeSnapshots[normalizedRoot] ?? collectCascadeTargets(
        folderId,
        prevState.expandedConstellations,
        prevState.inlineExpandedConstellations,
        prevState.activeSpotlight,
        prevState.pinnedSpotlights
      );

      console.log('🔄 Demote branch snapshot', {
        rootId: folderId,
        normalizedRoot,
        activeSpotlight: prevState.activeSpotlight,
        pinnedSpotlights: prevState.pinnedSpotlights,
        cached: !!prevState.cascadeSnapshots[normalizedRoot],
        expandedSnapshot: snapshot.expanded,
        inlineSnapshot: snapshot.inline
      });

      const nextExpanded = new Set(prevState.expandedConstellations);
      const removeExpandedVariants = (target: Set<string>, candidateId: string) => {
        const normalizedCandidate = normalizeId(candidateId);
        target.delete(candidateId);
        target.delete(normalizedCandidate);
        target.delete(`${normalizedCandidate}_center`);
      };

      const expandedSet = new Set(snapshot.expanded);
      expandedSet.add(normalizedRoot);
      expandedSet.add(folderId);
      expandedSet.forEach(id => removeExpandedVariants(nextExpanded, id));
      snapshot.inline.forEach(id => removeExpandedVariants(nextExpanded, id));

      const nextInline = new Set(prevState.inlineExpandedConstellations);
      snapshot.inline.forEach(id => nextInline.add(normalizeId(id)));

      let nextActive = activeNormalized;
      let nextPinned = prevState.pinnedSpotlights
        .map(id => normalizeId(id))
        .filter(id => id !== normalizedRoot);

      if (nextActive === normalizedRoot) {
        if (nextPinned.length > 0) {
          nextActive = nextPinned[nextPinned.length - 1];
          nextPinned = nextPinned.slice(0, -1);
        } else {
          nextActive = knowledgeBaseNormalized;
        }
      }

      if (!nextActive && knowledgeBaseNormalized) {
        nextActive = knowledgeBaseNormalized;
      }

      const nextSnapshots = { ...prevState.cascadeSnapshots };
      delete nextSnapshots[normalizedRoot];

      return {
        ...prevState,
        expandedConstellations: nextExpanded,
        inlineExpandedConstellations: nextInline,
        activeSpotlight: nextActive,
        pinnedSpotlights: nextPinned,
        cascadeSnapshots: nextSnapshots,
        depthAnimationActive: false
      };
    });

    if (folderItem) {
      showHint(`${folderItem.title} returned to background`, 1200);
    } else {
      showHint('Branch returned to background', 1200);
    }
  }, [collectCascadeTargets, itemsById, itemsByNormalizedId, showHint]);

  // Enhanced item click handler that supports depth interaction and group selection
  const handleItemClickWithDepth = useCallback((item: ConstellationItem, event?: React.MouseEvent) => {
    console.log('🖱️ Item clicked:', item.title, 'Type:', item.type, 'IsFolder:', item.isFolder, 'Shift:', event?.shiftKey, 'Event:', event);
    
    // Handle Shift+Click for folders AND constellation centers - Group Selection
    // Also check the global shift state as backup
    const isShiftPressed = event?.shiftKey || state.isShiftPressed;
    const isGroupable = (item.type === 'folder' || item.isFolder) || (item.isCenter && item.type === 'constellation');
    
    if (isShiftPressed && isGroupable) {
      console.log('📁 Group selecting', item.isCenter ? 'constellation' : 'folder', 'and contents:', item.title, 'shiftKey:', event?.shiftKey, 'globalShift:', state.isShiftPressed);
      
      // Prevent event from bubbling to mousedown handler
      event?.preventDefault();
      event?.stopPropagation();
      
      handleGroupSelection(item.id);
      return;
    }
    
    // Handle Shift+Click for depth interaction (constellation centers)
    if (event && handleShiftClick(item, event)) {
      return;
    }
    
    // Clear group selection if clicking normally (not shift)
    if (!event?.shiftKey && selectionState.type !== 'IDLE') {
      clearGroupSelection();
    }

    // Overflow nodes should not reach here - they should be handled by page.tsx wrapper
    // If they do reach here, just return to avoid any unwanted behavior
    if (item.isOverflowNode) {
      console.log('⚠️ Overflow node reached handleItemClickWithDepth - this should be handled by page.tsx wrapper');
      return;
    }

    if (item.type === 'folder' || item.isFolder) {
      // Handle folder expansion (only for non-overflow folders)
      console.log('📁 Expanding folder:', item.title, 'ID:', item.id);
      toggleConstellationExpansion(item.id);
      return;
    }
    
    // Handle constellation expansion
    if (item.isCenter && item.constellation) {
      console.log('⭐ Expanding constellation:', item.constellation);
      toggleConstellationExpansion(item.constellation);
      return;
    }
    
    // Regular item selection
    console.log('📄 Selecting item:', item.title);
    handleItemClick(item);
  }, [handleShiftClick, toggleConstellationExpansion, handleItemClick, handleGroupSelection, clearGroupSelection, selectionState, state.isShiftPressed]);

  // Enhanced mouse down handler using refs for synchronous state
  const handleMouseDown = useCallback((e: React.MouseEvent & { nodeId?: string; nodeItem?: ConstellationItem }, svgElement: SVGElement | null) => {
    console.log('🖱️ handleMouseDown called - checking ref state:', {
      isGroupSelected: groupSelectionRef.current.isGroupSelected,
      groupSize: groupSelectionRef.current.groupItems.size,
      parentId: groupSelectionRef.current.parentId
    });
    
    if (e.nodeId && e.nodeItem) {
      const itemId = e.nodeId;
      const item = e.nodeItem;

      // Detect double-click using time-based approach
      const now = Date.now();
      const timeSinceLastClick = now - lastClickRef.current.timestamp;
      const isDoubleClick = lastClickRef.current.itemId === itemId && timeSinceLastClick < 300; // 300ms threshold

      // Log double-click detection
      logDoubleClick(itemId, item.title, timeSinceLastClick, isDoubleClick);

      if (isDoubleClick) {
        // This is a double-click!

        // Clear any pending single-click timeout
        if (singleClickTimeoutRef.current) {
          clearTimeout(singleClickTimeoutRef.current);
          singleClickTimeoutRef.current = null;
        }

        // Reset the click tracker
        lastClickRef.current = { itemId: null, timestamp: 0 };

        // Handle folder/constellation center double-click
        // BUT NOT for overflow nodes - they should only respond to single clicks
        if ((item.type === 'folder' || item.isFolder || item.isCenter) && !item.isOverflowNode) {
          e.preventDefault();

          // Double-click on folder/constellation: just expand/collapse (no "bring to front")
          // Children will appear at Layer 1.5 (forward) when expanded
          toggleConstellationExpansion(itemId);
          return;
        }
      }

      // Update last click tracker
      lastClickRef.current = { itemId, timestamp: now };

      // For folders (including overflow nodes), we need to handle both clicking and dragging
      // Note: Overflow nodes will be handled differently in handleItemClickWithDepth
      if (item.type === 'folder' || item.isFolder) {
        // Clear any existing timeout
        if (singleClickTimeoutRef.current) {
          clearTimeout(singleClickTimeoutRef.current);
        }

        e.preventDefault();

        // Store initial position for drag detection
        const initialX = e.clientX;
        const initialY = e.clientY;

        // Reset mouse moved flag
        mouseMovedRef.current = false;

        // Set a timeout to handle single-click (expand/collapse) after double-click window
        singleClickTimeoutRef.current = setTimeout(() => {
          // Only expand if mouse hasn't moved (not a drag)
          if (!mouseMovedRef.current) {
            console.log('📁 Single-click timeout expired - expanding folder:', item.title);
            toggleConstellationExpansion(itemId);
          } else {
            console.log('📁 Single-click timeout expired - but user dragged, skipping expansion');
          }
          singleClickTimeoutRef.current = null;
        }, 310); // Slightly longer than double-click threshold

        // Store position for potential drag, but don't start dragging yet
        setState(prev => ({
          ...prev,
          lastMousePos: { x: initialX, y: initialY },
          clickedNodeForExpansion: itemId
        }));

        return;
      }

      // Check if this is an overflow node - don't handle in mousedown at all
      // Let it fall through to the regular SVG onClick handler
      if (item.isOverflowNode) {
        console.log('📋 Overflow node mousedown - skipping drag, preventing bubbling to canvas');
        // Prevent the event from reaching the canvas drag handler
        e.preventDefault();
        e.stopPropagation();
        // The SVG onClick will still fire and call onItemClick which goes to page.tsx wrapper
        return;
      }

      // Check ref state directly (synchronous, no race condition)
      if (groupSelectionRef.current.isGroupSelected &&
          groupSelectionRef.current.groupItems.has(itemId)) {

        console.log('✅ Starting group drag for', groupSelectionRef.current.groupItems.size, 'items (ref-based detection)');

        // Update ref to indicate we're now dragging
        groupSelectionRef.current.isDraggingGroup = true;

        // Update state machine for consistency
        selectionDispatch({ type: 'START_GROUP_DRAG', itemId });

          e.preventDefault();
        setState(prev => ({
          ...prev,
          dragMode: 'node',
          draggedNode: itemId,
          isDragging: true,
          lastMousePos: { x: e.clientX, y: e.clientY },
          clickedNodeForExpansion: null
        }));

        showHint(`Dragging group: ${groupSelectionRef.current.groupItems.size} items`, 3000);
          return;
        }

      // Start individual drag for non-folders
      console.log('🎯 Starting individual drag for:', item.title);
      e.preventDefault();
      setState(prev => ({
        ...prev,
        dragMode: 'node',
        draggedNode: itemId,
        isDragging: true,
        lastMousePos: { x: e.clientX, y: e.clientY },
        clickedNodeForExpansion: null
      }));

      showHint(`Dragging: ${item.title}`, 2000);
      return;
    }
    
    // Canvas drag - SWAPPED: Left-click = Pan, Right-click = Rotate
      e.preventDefault();
    const dragMode = e.button === 0 || (e.button === 2 && e.shiftKey) ? 'pan' : 'rotate';
    setState(prev => ({
      ...prev,
        dragMode,
        isDragging: true,
      lastMousePos: { x: e.clientX, y: e.clientY },
      clickedNodeForExpansion: null,
      draggedNode: null
    }));
    showHint(dragMode === 'pan' ? 'Panning view' : 'Rotating constellation', 1500);
  }, [showHint, toggleConstellationExpansion, bringConstellationToFront]);

  // Gravity Core Control Handlers
  const toggleGravityCore = useCallback(() => {
    setState(prev => ({
      ...prev,
      gravityCoreVisible: !prev.gravityCoreVisible
    }));
  }, []);

  const toggleGravityCoreLock = useCallback(() => {
    setState(prev => ({
      ...prev,
      gravityCoreLocked: !prev.gravityCoreLocked
    }));
  }, []);

  const handleGravityCoreDragStart = useCallback((e: React.MouseEvent) => {
    if (state.gravityCoreLocked) {
      showHint('Gravity Core is locked. Press L to unlock.', 2000);
      return;
    }
    
    e.preventDefault();
    e.stopPropagation();
    
    setState(prev => ({
      ...prev,
      isDraggingGravityCore: true,
      lastMousePos: { x: e.clientX, y: e.clientY }
    }));
    
    showHint('Drag up/down to move constellation forward/backward in space', 3000);
  }, [state.gravityCoreLocked, showHint]);

  const resetGravityCore = useCallback(() => {
    setState(prev => ({
      ...prev,
      globalDepthOffset: 0,
      gravityCorePosition: {
        x: prev.centerX,
        y: prev.centerY - 100 // Position above center
      }
    }));
    showHint('Gravity Core reset to center position', 1500);
  }, []);

  // Add keyboard event handling for shift key tracking and constellation focus reset
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && !state.isShiftPressed) {
        updateState({ isShiftPressed: true });
        showHint('Shift+Click constellations for progressive focus', 2000);
      }
      
      // Press Escape to reset all constellation focus or clear group selection
      if (e.key === 'Escape') {
        // Clear group selection first, then constellation focus
        if (groupSelectionRef.current.isGroupSelected) {
          clearGroupSelection();
          showHint('Group selection cleared', 1500);
        } else if (state.focusedConstellation) {
          setState(prevState => ({
            ...prevState,
            focusedConstellation: null,
            focusTransitionActive: true
          }));
          showHint('Constellation focus cleared - all returned to normal view', 2000);

          setTimeout(() => {
            setState(prevState => ({
              ...prevState,
              focusTransitionActive: false
            }));
          }, 600);
        }
      }
      
      // Toggle gravity core visibility with 'G' key
      if (e.key === 'g' || e.key === 'G') {
        toggleGravityCore();
        showHint(state.gravityCoreVisible ? 'Gravity Core hidden' : 'Gravity Core shown', 1500);
      }
      
      // Lock/unlock gravity core with 'L' key
      if (e.key === 'l' || e.key === 'L') {
        toggleGravityCoreLock();
        showHint(state.gravityCoreLocked ? 'Gravity Core unlocked' : 'Gravity Core locked', 1500);
      }
      
      // Reset global depth with 'R' key
      if (e.key === 'r' || e.key === 'R') {
        resetGravityCore();
      }
    };
    
    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'Shift' && state.isShiftPressed) {
        updateState({ isShiftPressed: false });
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [state.isShiftPressed, state.focusedConstellation, state.constellationDepthOffsets, state.gravityCoreVisible, state.gravityCoreLocked, selectionState, updateState, showHint, toggleGravityCore, toggleGravityCoreLock, resetGravityCore, clearGroupSelection]);

  // Panel visibility functions
  const toggleWelcomePanel = useCallback(() => {
    setState(prevState => ({
      ...prevState,
      showWelcomePanel: !prevState.showWelcomePanel
    }));
  }, []);

  const toggleSidebar = useCallback(() => {
    setState(prevState => ({
      ...prevState,
      showSidebar: !prevState.showSidebar
    }));
  }, []);

  const toggleStatusPanel = useCallback(() => {
    setState(prevState => ({
      ...prevState,
      showStatusPanel: !prevState.showStatusPanel
    }));
  }, []);

  const toggleDebugPanel = useCallback(() => {
    setState(prevState => ({
      ...prevState,
      showDebugPanel: !prevState.showDebugPanel
    }));
  }, []);

  const toggleSearchControls = useCallback(() => {
    setState(prevState => ({
      ...prevState,
      showSearchControls: !prevState.showSearchControls
    }));
  }, []);

  const closeWelcomePanel = useCallback(() => {
    setState(prevState => ({
      ...prevState,
      showWelcomePanel: false
    }));
  }, []);

  const closeSidebar = useCallback(() => {
    setState(prevState => ({
      ...prevState,
      showSidebar: false
    }));
  }, []);

  const closeStatusPanel = useCallback(() => {
    setState(prevState => ({
      ...prevState,
      showStatusPanel: false
    }));
  }, []);

  const closeDebugPanel = useCallback(() => {
    setState(prevState => ({
      ...prevState,
      showDebugPanel: false
    }));
  }, []);

  const closeSearchControls = useCallback(() => {
    setState(prevState => ({
      ...prevState,
      showSearchControls: false
    }));
  }, []);

  // Edge scrolling animation loop
  useEffect(() => {
    if (!state.isEdgeScrolling || !state.isDragging || state.dragMode !== 'node') {
      return;
    }
    
    let animationFrameId: number;
    let lastTimestamp: number | null = null;
    
    const animateEdgeScroll = (timestamp: number) => {
      if (!lastTimestamp) lastTimestamp = timestamp;
      const deltaTime = Math.min((timestamp - lastTimestamp) / 16.67, 2); // Cap at 2x for stability
      lastTimestamp = timestamp;
      
      // Apply edge scrolling with smooth acceleration
      const currentSpeed = state.edgeScrollSpeed * deltaTime;
      
      if (currentSpeed > 0.1) {
        setState(prev => {
          // Calculate new pan based on scroll direction and speed
          const newPanX = prev.pan.x + prev.edgeScrollDirection.x * deltaTime;
          const newPanY = prev.pan.y + prev.edgeScrollDirection.y * deltaTime;
          
          // Optional: Add bounds to prevent infinite scrolling
          const maxPan = 5000; // Adjust based on your world size
          const clampedPanX = Math.max(-maxPan, Math.min(maxPan, newPanX));
          const clampedPanY = Math.max(-maxPan, Math.min(maxPan, newPanY));
          
          return {
            ...prev,
            pan: { x: clampedPanX, y: clampedPanY }
          };
        });
      }
      
      animationFrameId = requestAnimationFrame(animateEdgeScroll);
    };
    
    animationFrameId = requestAnimationFrame(animateEdgeScroll);
    
    return () => {
      if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
      }
    };
  }, [state.isEdgeScrolling, state.isDragging, state.dragMode, state.edgeScrollDirection, state.edgeScrollSpeed]);

  return {
    state,
    selectionState,
    selectionDispatch,
    constellations,
    allItems,
    connections,
    isLoading,
    updateState,
    getNodePosition,
    updateNodePosition,
    handleSearch,
    handleTypeFilter,
    handleConstellationHighlight,
    handleItemClick,
    handleItemHover,
    showHint,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    // New depth-layered expansion functions
    toggleConstellationExpansion,
    toggleFolderVisibilityInline,
    promoteBranchToSpotlight,
    demoteBranchFromSpotlight,
    handleShiftClick,
    getItemDepthLayer,
    getDepthScale,
    getDepthOpacity,
    getDepthBlur,
    getDepthZ,
    getConstellationDepthZ,
    handleItemClickWithDepth,
    // Panel visibility functions
    toggleWelcomePanel,
    toggleSidebar,
    toggleStatusPanel,
    toggleDebugPanel,
    toggleSearchControls,
    closeWelcomePanel,
    closeSidebar,
    closeStatusPanel,
    closeDebugPanel,
    closeSearchControls,
    // Gravity Core Control functions
    toggleGravityCore,
    toggleGravityCoreLock,
    handleGravityCoreDragStart,
    resetGravityCore,
    // Group selection functions
    handleGroupSelection,
    clearGroupSelection,
    getAllDescendants,
    // Constellation focus function
    bringConstellationToFront,
  };
} 
