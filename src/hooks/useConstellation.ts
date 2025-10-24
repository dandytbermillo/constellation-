'use client';

import { useState, useCallback, useEffect, useRef, useReducer } from 'react';
import { AppState, ConstellationItem, ItemType, Position, Constellation } from '@/types/constellation';
import { initialConstellations, crossConstellationConnections } from '@/data/constellations';
import { initializeConstellations, getNodeAtPosition, getDepthZ, getItemDepthLayer as getItemDepthLayerUtil, calculateHierarchyLevel, areAllAncestorsExpanded, getNodePosition as getNodePositionUtil, inverseTransformPoint } from '@/utils/constellation';

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

// Initial state
const initialState: AppState = {
  // View state
  rotation: { x: 0, y: 0 },
  pan: { x: 0, y: 0 },
  zoom: 1,
  centerX: typeof window !== 'undefined' ? window.innerWidth / 2 : 400,
  centerY: typeof window !== 'undefined' ? window.innerHeight / 2 : 300,
  
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
  showSidebar: true,
  showStatusPanel: true,
  showDebugPanel: false,
  
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
  gravityCoreVisible: true,
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
};

export function useConstellation() {
  const [selectionState, selectionDispatch] = useReducer(selectionReducer, { type: 'IDLE' });
  const [state, setState] = useState<AppState>(initialState);
  const [constellations] = useState<Constellation[]>(initialConstellations);
  const [allItems, setAllItems] = useState<ConstellationItem[]>([]);
  const [connections, setConnections] = useState<Array<[string, string]>>([]);

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

  // Define showHint early so it can be used in other effects
  const showHint = useCallback((text: string, duration = 2000) => {
    setState(prev => ({ ...prev, showHint: true, hintText: text }));
    setTimeout(() => {
      setState(prev => ({ ...prev, showHint: false }));
    }, duration);
  }, []);



  // Initialize data - exact copy from original
  useEffect(() => {
    const items = initializeConstellations(constellations);
    console.log('🌌 Initialized constellation items:', items.length);
    console.log('📁 Folders found:', items.filter(item => item.type === 'folder' || item.isFolder));
    console.log('👶 Children found:', items.filter(item => item.parentId));
    setAllItems(items);

    // Create connections - each item connects to its constellation center, plus cross-constellation connections
    const newConnections: Array<[string, string]> = [];
    
    constellations.forEach(constellation => {
      const centerNodeId = constellation.id + '_center';
      constellation.items.forEach(item => {
        newConnections.push([item.id, centerNodeId]);
        
        // Add connections between folders and their children
        if ((item.type === 'folder' || item.isFolder) && item.children) {
          item.children.forEach(child => {
            newConnections.push([item.id, child.id]);
            console.log('🔗 Added folder-child connection:', item.title, '->', child.title);
          });
        }
      });
    });
    
    newConnections.push(...crossConstellationConnections);
    
    // Log connection initialization for debugging
    console.log('🔗 Connections initialized:', {
      totalConnections: newConnections.length,
      crossConstellationConnections: crossConstellationConnections.length
    });
    
    setConnections(newConnections);
  }, [constellations]);

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
    if (!state.isDragging && !state.isDraggingGravityCore) return;
    
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

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
    const newZoom = Math.max(0.3, Math.min(3, state.zoom * zoomFactor));
    updateState({ zoom: newZoom });
  }, [state.zoom, updateState]);

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
    // Focused items always in foreground
    if (state.focusedItems.has(item.id)) {
      // console.log('🎯 Item in focus:', item.title, '-> depth 0');
      return 0;
    }
    
    // Constellation centers always at layer 0
    if (item.isCenter) {
      return 0;
    }
    
    // Calculate hierarchy level
    const hierarchyLevel = calculateHierarchyLevel(item, allItems);
    // console.log('📊 Hierarchy level for', item.title, ':', hierarchyLevel);
    
    // For items with parents, check if they should be visible
    if (item.parentId) {
      // Check if all ancestors are expanded
      if (!areAllAncestorsExpanded(item, state.expandedConstellations, allItems)) {
        // console.log('❌ Item hidden (ancestors not expanded):', item.title, '-> depth 999');
        return 999; // Hidden layer
      }
      
      // FIXED: Push children AWAY from user based on hierarchy
      // Hierarchy level 2 → depth 2, level 3 → depth 3, etc.
      // console.log('✅ Child item visible:', item.title, '-> depth', hierarchyLevel);
      return hierarchyLevel;
    }
    
    // Root folders and regular items stay at layer 1
    if ((item.type === 'folder' || item.isFolder) && hierarchyLevel === 1) {
      // console.log('📁 Root folder:', item.title, '-> depth 1');
      return 1;
    }
    
    // Regular constellation items at layer 1
    // console.log('📄 Regular item:', item.title, '-> depth 1');
    return 1;
  }, [state.expandedConstellations, state.focusedItems, allItems]);

  const getDepthScale = useCallback((depthLayer: number): number => {
    if (depthLayer === 0) return 1.0;      // Constellation centers - full size
    if (depthLayer === 1) return 0.95;     // Root items - nearly full size
    if (depthLayer >= 999) return 0.0;     // Hidden items
    
    // More aggressive scaling for deeper layers
    // Each layer is 80% of the previous (more noticeable)
    const scaleFactor = 0.8;
    return Math.pow(scaleFactor, depthLayer - 1);
  }, []);

  const getDepthOpacity = useCallback((depthLayer: number): number => {
    if (depthLayer === 0) return 1.0;      // Full opacity
    if (depthLayer === 1) return 0.95;     // Root items - nearly full opacity
    if (depthLayer >= 999) return 0.0;     // Hidden
    
    // More noticeable opacity reduction
    const opacityFactor = 0.85; // Each layer is 85% opacity of previous
    return Math.pow(opacityFactor, depthLayer - 1);
  }, []);

  const getDepthBlur = useCallback((depthLayer: number): string => {
    if (depthLayer === 0) return 'none';    // No blur for centers
    if (depthLayer === 1) return 'none';    // No blur for root items
    if (depthLayer >= 999) return 'blur(20px)'; // Heavy blur for hidden
    
    // Progressive blur starting from layer 2
    const blurAmount = (depthLayer - 1) * 0.5; // 0.5px blur per layer
    return `blur(${Math.min(blurAmount, 6)}px)`; // Max 6px blur
  }, []);

  const getDepthZ = useCallback((depthLayer: number): number => {
    if (depthLayer >= 999) return -2000;   // Far back for hidden
    
    // Each layer is 100 units back in Z-space (more separation)
    return -depthLayer * 100;
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

  // Enhanced folder expansion logic for nested folders
  const toggleConstellationExpansion = useCallback((folderId: string) => {
    console.log('🔄 toggleConstellationExpansion called with ID:', folderId);
    
    // Add immediate visual feedback
    const folderItem = allItems.find(item => item.id === folderId);
    if (folderItem) {
      const isCurrentlyExpanded = state.expandedConstellations.has(folderId);
      showHint(`${folderItem.title}: ${isCurrentlyExpanded ? 'Collapsing...' : 'Expanding...'}`, 1000);
    }
    
    setState((prevState: AppState) => {
      const newExpanded = new Set(prevState.expandedConstellations);
      const wasExpanded = newExpanded.has(folderId);
      
      if (wasExpanded) {
        // Collapsing: also collapse all descendant folders
        newExpanded.delete(folderId);
        console.log('📁 Collapsing folder:', folderId);
        
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
        // Expanding: just expand this folder
        newExpanded.add(folderId);
        console.log('📂 Expanding folder:', folderId);
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
    
    // Handle folder expansion
    if (item.type === 'folder' || item.isFolder) {
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
      
      // Handle folder double-click
      if ((item.type === 'folder' || item.isFolder) && e.detail === 2) {
        console.log('📁 Double-click folder expansion');
        e.preventDefault();
        toggleConstellationExpansion(itemId);
        return;
      }
      
      // Start individual drag
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
      
      const hint = (item.type === 'folder' || item.isFolder)
        ? `Dragging: ${item.title} (Shift+click to select group)`
        : `Dragging: ${item.title}`;
      showHint(hint, 2000);
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
  }, [showHint, toggleConstellationExpansion]);

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
        } else if (state.focusedConstellation || Object.keys(state.constellationDepthOffsets).length > 0) {
        setState(prevState => ({
          ...prevState,
          focusedConstellation: null,
          constellationDepthOffsets: {},
          constellationFocusLevels: {},
          focusTransitionActive: true
        }));
        showHint('All constellations returned to normal view', 1500);
        
        setTimeout(() => {
          setState(prevState => ({
            ...prevState,
            focusTransitionActive: false
          }));
        }, 800);
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
    closeWelcomePanel,
    closeSidebar,
    closeStatusPanel,
    closeDebugPanel,
    // Gravity Core Control functions
    toggleGravityCore,
    toggleGravityCoreLock,
    handleGravityCoreDragStart,
    resetGravityCore,
    // Group selection functions
    handleGroupSelection,
    clearGroupSelection,
    getAllDescendants,
  };
} 