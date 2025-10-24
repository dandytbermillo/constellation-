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
import { ConstellationErrorBoundary } from '@/components/ConstellationErrorBoundary';
import { ErrorBoundary } from '@/components/ErrorBoundary';

export default function ConstellationPage() {
  const {
    state,
    constellations,
    allItems,
    connections,
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

  const handleConnectionHover = (connectionInfo: any) => {
    setConnectionTooltip(connectionInfo);
  };

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

  // Show welcome notification and auto-dismiss welcome panel
  useEffect(() => {
    setTimeout(() => {
      showNotification('🌌 Welcome to your Depth-Layered Data Constellation! Click constellation centers to expand into 3D layers.', 'info');
    }, 1000);
    setTimeout(() => {
      showNotification('⇧ Hold Shift and click items to bring them to the foreground!', 'success');
    }, 3000);
    setTimeout(() => {
      showNotification('🗺️ Use the minimap in the bottom-right corner to navigate your constellation!', 'info');
    }, 5000);
    
    // Auto-dismiss welcome panel after 7 seconds
    setTimeout(() => {
      if (state.showWelcomePanel) {
        console.log('⏰ Auto-dismissing welcome panel after 7 seconds');
        closeWelcomePanel();
      }
    }, 7000);
  }, [showNotification, closeWelcomePanel, state.showWelcomePanel]);

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
          onItemClick={handleItemClickWithDepth}
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
      <div className="absolute top-32 right-5 bg-slate-800/90 backdrop-blur-sm border border-slate-600/50 rounded-lg p-3 z-40 space-y-2">
        <div className="text-xs text-slate-400 mb-2">Panel Controls</div>
        <div className="space-y-1">
          <button
            onClick={toggleWelcomePanel}
            className={`w-full text-left px-2 py-1 rounded text-xs transition-colors ${
              state.showWelcomePanel 
                ? 'bg-blue-500/20 text-blue-300' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            ✨ Welcome Panel
          </button>
          <button
            onClick={toggleSidebar}
            className={`w-full text-left px-2 py-1 rounded text-xs transition-colors ${
              state.showSidebar 
                ? 'bg-blue-500/20 text-blue-300' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            📋 Sidebar
          </button>
          <button
            onClick={toggleStatusPanel}
            className={`w-full text-left px-2 py-1 rounded text-xs transition-colors ${
              state.showStatusPanel 
                ? 'bg-blue-500/20 text-blue-300' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            📊 Status Panel
          </button>
          <button
            onClick={toggleDebugPanel}
            className={`w-full text-left px-2 py-1 rounded text-xs transition-colors ${
              state.showDebugPanel 
                ? 'bg-blue-500/20 text-blue-300' 
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            🐛 Debug Panel
          </button>
          <button
            onClick={() => setShowMinimap(!showMinimap)}
            className={`w-full text-left px-2 py-1 rounded text-xs transition-colors ${
              showMinimap
                ? 'bg-blue-500/20 text-blue-300'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            🗺️ Minimap
          </button>
        </div>
      </div>
      
      {/* Search and filter controls */}
      <SearchControls
        searchQuery={state.searchQuery}
        filterType={state.filterType}
        onSearchChange={handleSearch}
        onFilterChange={handleTypeFilter}
      />
      
      {/* Sidebar with constellation navigation */}
      {state.showSidebar && (
        <ConstellationSidebar
          constellations={constellations}
          allItems={allItems}
          selectedItem={state.selectedItem}
          highlightedConstellation={state.highlightedConstellation}
          onConstellationClick={handleConstellationClick}
          onItemClick={handleItemClickWithDepth}
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
            handleItemClickWithDepth(item);
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
    </div>
    </ErrorBoundary>
  );
} 