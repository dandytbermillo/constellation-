'use client';

import React, { useEffect, useState } from 'react';
import { useConstellation } from '@/hooks/useConstellation';
import { useNotifications } from '@/hooks/useNotifications';
import ConstellationVisualization from '@/components/ConstellationVisualization';
import SearchControls from '@/components/SearchControls';
import ConstellationSidebar from '@/components/ConstellationSidebar';
import StatusPanel from '@/components/StatusPanel';
import NotificationContainer from '@/components/NotificationContainer';
import GravityCore from '@/components/GravityCore';
import ConstellationMinimap from '@/components/ConstellationMinimap';
import ConnectionTooltip from '@/components/ConnectionTooltip';
import FolderContentsModal from '@/components/FolderContentsModal';
import { ConstellationErrorBoundary } from '@/components/ConstellationErrorBoundary';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { ConstellationItem } from '@/types/constellation';

export default function ConstellationPage() {
  const {
    state,
    constellations,
    allItems,
    connections,
    isLoading,
    handleSearch,
    handleTypeFilter,
    handleConstellationHighlight,
    handleItemClick,
    handleItemHover,
    handleMouseDown,
    handleMouseMove,
    handleMouseUp,
    handleWheel,
    updateState,
    // New depth-layered expansion functions
    getItemDepthLayer,
    getDepthScale,
    getDepthOpacity,
    getDepthBlur,
    handleItemClickWithDepth,
    getDepthZ,
    getConstellationDepthZ,
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
    clearGroupSelection,
  } = useConstellation();

  const { notifications, showNotification, removeNotification } = useNotifications();

  // Connection tooltip state
  const [connectionTooltip, setConnectionTooltip] = useState<{
    item1: string;
    item2: string;
    type: string;
    importance: number;
    x: number;
    y: number;
  } | null>(null);

  // Minimap state
  const [showMinimap, setShowMinimap] = useState(true);
  const [draggedPositions, setDraggedPositions] = useState<Record<string, { x: number; y: number }>>({});

  // Panel Controls drag state
  const [panelControlsPosition, setPanelControlsPosition] = useState({
    x: typeof window !== 'undefined' ? window.innerWidth - 220 : 1100,
    y: 120
  });
  const [isDraggingPanelControls, setIsDraggingPanelControls] = useState(false);
  const [panelControlsDragStart, setPanelControlsDragStart] = useState({ x: 0, y: 0 });

  // Folder contents modal state
  const [showFolderModal, setShowFolderModal] = useState(false);
  const [modalFolderName, setModalFolderName] = useState('');
  const [modalFolderItems, setModalFolderItems] = useState<ConstellationItem[]>([]);

  // Handler for overflow node clicks
  const handleOverflowNodeClick = async (item: ConstellationItem) => {
    console.log('📋 handleOverflowNodeClick called for:', item.title);

    // Log the click attempt
    await fetch('/api/debug/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        component: 'OverflowNodeClick',
        action: 'click_detected',
        content_preview: `Clicked: ${item.title}`,
        metadata: {
          itemId: item.id,
          itemTitle: item.title,
          isOverflowNode: item.isOverflowNode,
          hasAllChildren: !!item.allChildren,
          allChildrenCount: item.allChildren?.length,
          overflowParentId: item.overflowParentId
        }
      })
    });

    if (item.isOverflowNode && item.allChildren && item.overflowParentId) {
      // Find the parent folder
      const parentFolder = allItems.find(i => i.id === item.overflowParentId);

      await fetch('/api/debug/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          component: 'OverflowNodeClick',
          action: 'opening_modal',
          content_preview: `Opening modal for: ${parentFolder?.title || 'unknown'}`,
          metadata: {
            parentFolderId: item.overflowParentId,
            parentFolderTitle: parentFolder?.title,
            itemsCount: item.allChildren.length
          }
        })
      });

      if (parentFolder) {
        setModalFolderName(parentFolder.title);
        setModalFolderItems(item.allChildren);
        setShowFolderModal(true);

        await fetch('/api/debug/log', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            component: 'OverflowNodeClick',
            action: 'modal_opened',
            content_preview: `Modal opened successfully`,
            metadata: {
              folderName: parentFolder.title,
              itemsCount: item.allChildren.length,
              showModal: true
            }
          })
        });
      }
    } else {
      await fetch('/api/debug/log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          component: 'OverflowNodeClick',
          action: 'normal_item_click',
          content_preview: `Not an overflow node: ${item.title}`,
          metadata: {
            itemType: item.type,
            isFolder: item.isFolder
          }
        })
      });

      // Normal item click - pass to original handler
      handleItemClickWithDepth(item);
    }
  };

  // Wrapper that checks for overflow nodes before calling the regular handler
  const handleItemClickWrapper = (item: ConstellationItem, event?: React.MouseEvent) => {
    console.log('🎯 handleItemClickWrapper called for:', item.title, 'isOverflowNode:', item.isOverflowNode);

    if (item.isOverflowNode) {
      handleOverflowNodeClick(item);
    } else {
      handleItemClickWithDepth(item, event);
    }
  };

  const handleConnectionHover = (connectionInfo: any) => {
    setConnectionTooltip(connectionInfo);
  };

  // Panel Controls drag handlers
  const handlePanelControlsMouseDown = (e: React.MouseEvent) => {
    // Only start dragging if clicking on the header area
    if ((e.target as HTMLElement).classList.contains('panel-controls-header')) {
      setIsDraggingPanelControls(true);
      setPanelControlsDragStart({
        x: e.clientX - panelControlsPosition.x,
        y: e.clientY - panelControlsPosition.y
      });
    }
  };

  const handlePanelControlsMouseMove = (e: MouseEvent) => {
    if (isDraggingPanelControls) {
      setPanelControlsPosition({
        x: e.clientX - panelControlsDragStart.x,
        y: e.clientY - panelControlsDragStart.y
      });
    }
  };

  const handlePanelControlsMouseUp = () => {
    setIsDraggingPanelControls(false);
  };

  // Add event listeners for panel controls dragging
  useEffect(() => {
    if (isDraggingPanelControls) {
      window.addEventListener('mousemove', handlePanelControlsMouseMove);
      window.addEventListener('mouseup', handlePanelControlsMouseUp);
      return () => {
        window.removeEventListener('mousemove', handlePanelControlsMouseMove);
        window.removeEventListener('mouseup', handlePanelControlsMouseUp);
      };
    }
  }, [isDraggingPanelControls, panelControlsDragStart]);

  // Minimap navigation handler
  const handleMinimapNavigate = (centerX: number, centerY: number, zoom?: number) => {
    // FIXED: Account for current pan offset when navigating
    // The minimap shows world coordinates, but we need to adjust for current view transform
    
    // Calculate the difference from current center
    const deltaX = centerX - state.centerX;
    const deltaY = centerY - state.centerY;
    
    // Update center position while preserving pan offset
    // This maintains the current view transform while changing the focal point
    updateState({
      centerX: centerX,
      centerY: centerY,
      // Adjust pan to compensate for center change
      pan: {
        x: state.pan.x - deltaX,
        y: state.pan.y - deltaY
      },
      ...(zoom && { zoom })
    });
  };

  // Track dragged positions for minimap
  useEffect(() => {
    if (state.draggedNode && state.dragMode === 'node') {
      const draggedItem = allItems.find(item => item.id === state.draggedNode);
      if (draggedItem) {
        const currentPos = state.nodePositions[draggedItem.id] || draggedItem;
        setDraggedPositions({
          [draggedItem.id]: { x: currentPos.x, y: currentPos.y }
        });
      }
    } else {
      setDraggedPositions({});
    }
  }, [state.draggedNode, state.dragMode, state.nodePositions, allItems]);

  // Auto-dismiss welcome panel
  useEffect(() => {
    // All notifications disabled per user request
    // setTimeout(() => {
    //   showNotification('🌌 Welcome to your Depth-Layered Data Constellation! Click constellation centers to expand into 3D layers.', 'info');
    // }, 1000);
    // setTimeout(() => {
    //   showNotification('⇧ Hold Shift and click items to bring them to the foreground!', 'success');
    // }, 3000);
    // setTimeout(() => {
    //   showNotification('🗺️ Use the minimap in the bottom-right corner to navigate your constellation!', 'info');
    // }, 5000);

    // Auto-dismiss welcome panel after 7 seconds
    setTimeout(() => {
      if (state.showWelcomePanel) {
        console.log('⏰ Auto-dismissing welcome panel after 7 seconds');
        closeWelcomePanel();
      }
    }, 7000);
  }, [closeWelcomePanel, state.showWelcomePanel]);

  const handleConstellationClick = (constellationId: string) => {
    // Toggle constellation highlighting
    const newHighlight = state.highlightedConstellation === constellationId ? null : constellationId;
    handleConstellationHighlight(newHighlight);
  };

  return (
    <ErrorBoundary
      onError={(error, errorInfo) => {
        console.error('🚨 Top-level application error:', error, errorInfo);
        // Could send to error reporting service here
      }}
    >
      <div 
        className="w-screen h-screen relative overflow-hidden bg-slate-900"
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onClick={(e) => {
          console.log('🌍 GLOBAL PAGE CLICK:', e.target);
          console.log('🌍 Click coordinates:', e.clientX, e.clientY);
        }}
      >
      {/* Loading Indicator */}
      {isLoading && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-slate-900/95">
          <div className="text-center">
            <div className="inline-block animate-spin rounded-full h-16 w-16 border-b-2 border-blue-400 mb-4"></div>
            <p className="text-blue-400 text-lg">Loading constellation from database...</p>
          </div>
        </div>
      )}

      {/* Gravity Core Control */}
      <GravityCore
        position={state.gravityCorePosition}
        globalDepthOffset={state.globalDepthOffset}
        isDragging={state.isDraggingGravityCore}
        isLocked={state.gravityCoreLocked}
        isVisible={state.gravityCoreVisible}
        onMouseDown={handleGravityCoreDragStart}
        onDoubleClick={resetGravityCore}
      />

      {/* Main constellation visualization with error boundary */}
      <ConstellationErrorBoundary
        onReset={() => {
          // Reset constellation state on error
          updateState({
            selectedItem: null,
            hoveredItem: null,
            isDragging: false,
            draggedNode: null,
            showHint: false
          });
        }}
      >
        <ConstellationVisualization
          allItems={allItems}
          connections={connections}
          state={{
            ...state,
            onConnectionHover: handleConnectionHover
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onWheel={handleWheel}
          onItemClick={handleItemClickWrapper}
          onItemHover={handleItemHover}
          getItemDepthLayer={getItemDepthLayer}
          getDepthScale={getDepthScale}
          getDepthOpacity={getDepthOpacity}
          getDepthBlur={getDepthBlur}
          getDepthZ={getDepthZ}
          getConstellationDepthZ={getConstellationDepthZ}
          onClearGroupSelection={clearGroupSelection}
          onCloseDebugPanel={closeDebugPanel}
        />
      </ConstellationErrorBoundary>
      
      {/* Floating panel controls - moved below welcome panel */}
      <div
        className="absolute bg-slate-800/90 backdrop-blur-sm border border-slate-600/50 rounded-lg p-2 z-40 w-44"
        style={{
          left: `${panelControlsPosition.x}px`,
          top: `${panelControlsPosition.y}px`,
          cursor: isDraggingPanelControls ? 'grabbing' : 'default'
        }}
        onMouseDown={handlePanelControlsMouseDown}
      >
        <div
          className="panel-controls-header text-xs text-slate-400 mb-1 cursor-grab active:cursor-grabbing select-none"
        >
          Panel Controls
        </div>
        <div className="space-y-0.5">
          <button
            onClick={toggleWelcomePanel}
            className={`w-full text-left px-1.5 py-0.5 rounded text-xs transition-colors ${
              state.showWelcomePanel
                ? 'bg-blue-500/20 text-blue-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ✨ Welcome
          </button>
          <button
            onClick={toggleSidebar}
            className={`w-full text-left px-1.5 py-0.5 rounded text-xs transition-colors ${
              state.showSidebar
                ? 'bg-blue-500/20 text-blue-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            📋 Sidebar
          </button>
          <button
            onClick={toggleStatusPanel}
            className={`w-full text-left px-1.5 py-0.5 rounded text-xs transition-colors ${
              state.showStatusPanel
                ? 'bg-blue-500/20 text-blue-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            📊 Status Panel
          </button>
          <button
            onClick={toggleDebugPanel}
            className={`w-full text-left px-1.5 py-0.5 rounded text-xs transition-colors ${
              state.showDebugPanel
                ? 'bg-blue-500/20 text-blue-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            🐛 Debug Panel
          </button>
          <button
            onClick={() => setShowMinimap(!showMinimap)}
            className={`w-full text-left px-1.5 py-0.5 rounded text-xs transition-colors ${
              showMinimap
                ? 'bg-blue-500/20 text-blue-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            🗺️ Minimap
          </button>
          <button
            onClick={toggleSearchControls}
            className={`w-full text-left px-1.5 py-0.5 rounded text-xs transition-colors ${
              state.showSearchControls
                ? 'bg-blue-500/20 text-blue-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            🔍 Search & Nav
          </button>
        </div>
      </div>
      
      {/* Search and filter controls */}
      {state.showSearchControls && (
        <SearchControls
          searchQuery={state.searchQuery}
          filterType={state.filterType}
          onSearchChange={handleSearch}
          onFilterChange={handleTypeFilter}
        />
      )}
      
      {/* Sidebar with constellation navigation */}
      {state.showSidebar && (
        <ConstellationSidebar
          constellations={constellations}
          allItems={allItems}
          selectedItem={state.selectedItem}
          highlightedConstellation={state.highlightedConstellation}
          onConstellationClick={handleConstellationClick}
          onItemClick={handleOverflowNodeClick}
          onClose={closeSidebar}
        />
      )}
      
      {/* Status panel */}
      {state.showStatusPanel && (
        <StatusPanel
          state={state}
          allItems={allItems}
          onClose={closeStatusPanel}
        />
              )}

      {/* Constellation Minimap */}
      {showMinimap && (
        <ConstellationMinimap
          allItems={allItems}
          connections={connections}
          state={state}
          onNavigate={handleMinimapNavigate}
          onItemSelect={(item) => {
            handleOverflowNodeClick(item);
            const itemPos = state.nodePositions[item.id] || item;
            handleMinimapNavigate(itemPos.x, itemPos.y, 1.5);
          }}
          onItemHover={handleItemHover}
          draggedPositions={draggedPositions}
          getItemDepthLayer={getItemDepthLayer}
          getDepthZ={getDepthZ}
          getConstellationDepthZ={getConstellationDepthZ}
        />
      )}

      {/* Connection Tooltip */}
      <ConnectionTooltip connectionInfo={connectionTooltip} />
      
      {/* Welcome message overlay - moved to upper right corner */}
      {state.showWelcomePanel && (
        <div className="absolute top-5 right-5 w-80 z-50 pointer-events-none">
          <div className="bg-slate-800/95 backdrop-blur-sm p-4 rounded-lg border border-slate-600/50 shadow-2xl relative pointer-events-auto">
            <button
              onClick={() => {
                console.log('Welcome panel close clicked');
                updateState({ showWelcomePanel: false });
              }}
              className="absolute top-2 right-2 text-slate-400 hover:text-white transition-colors text-lg leading-none w-5 h-5 flex items-center justify-center hover:bg-slate-700/50 rounded pointer-events-auto"
            >
              ×
            </button>
            <h2 className="text-lg font-bold text-blue-400 mb-2 pr-6">
              Welcome to your Data Constellation! ✨
            </h2>
            <p className="text-slate-300 text-sm mb-3">
              Explore your personal data universe with depth-layered expansion!
            </p>
            <div className="text-slate-400 text-xs space-y-1">
              <div>🖱️ Drag to rotate • Shift+Drag to pan</div>
              <div>⭐ Click constellation centers to expand</div>
              <div>⇧ Shift+Click items to bring forward</div>
              <div>🗺️ Use minimap to navigate quickly</div>
            </div>
            
            {/* Auto-dismiss indicator */}
            <div className="text-xs text-slate-500 mt-2 text-center">
              Auto-closes in 7s or click ×
            </div>
          </div>
        </div>
      )}

      {/* Notification container */}
      <NotificationContainer notifications={notifications} onRemove={removeNotification} />

      {/* Folder Contents Modal */}
      <FolderContentsModal
        isOpen={showFolderModal}
        folderName={modalFolderName}
        items={modalFolderItems}
        onClose={() => setShowFolderModal(false)}
        onItemClick={handleItemClickWrapper}
      />
    </div>
    </ErrorBoundary>
  );
} 