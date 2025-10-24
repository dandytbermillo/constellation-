'use client';

import React from 'react';
import { Constellation, ConstellationItem } from '@/types/constellation';
import { getItemIcon } from '@/utils/constellation';

interface ConstellationSidebarProps {
  constellations: Constellation[];
  allItems: ConstellationItem[];
  selectedItem: ConstellationItem | null;
  highlightedConstellation: string | null;
  onConstellationClick: (constellationId: string) => void;
  onItemClick: (item: ConstellationItem) => void;
  onClose?: () => void;
}

export default function ConstellationSidebar({
  constellations,
  allItems,
  selectedItem,
  highlightedConstellation,
  onConstellationClick,
  onItemClick,
  onClose,
}: ConstellationSidebarProps) {
  return (
    <div className="absolute left-5 top-5 bottom-5 w-80 bg-slate-800/90 backdrop-blur-sm border border-slate-600/50 rounded-lg shadow-2xl overflow-hidden z-20">
      {/* Header */}
      <div className="p-4 border-b border-slate-600/50 relative">
        {onClose && (
          <button
            onClick={onClose}
            className="absolute top-3 right-3 text-slate-400 hover:text-white transition-colors text-xl leading-none w-6 h-6 flex items-center justify-center"
          >
            ×
          </button>
        )}
        <h2 className="text-xl font-semibold text-blue-400 mb-1">
          Universal Data Constellation
        </h2>
        <p className="text-sm text-slate-400">
          Your personal data universe organized by context
        </p>
        
        {/* Stats */}
        <div className="flex gap-4 mt-3 text-xs text-slate-500">
          <span>Items: {allItems.length}</span>
          <span>Groups: {constellations.length}</span>
          <span>Connections: {allItems.length - 1 + 5}</span>
        </div>
      </div>
      
      {/* Constellations */}
      <div className="flex-1 overflow-y-auto">
        {constellations.map((constellation) => (
          <div key={constellation.id} className="border-b border-slate-700/50 last:border-b-0">
            {/* Constellation header */}
            <button
              className={`w-full p-4 text-left hover:bg-slate-700/50 transition-all duration-200 ${
                highlightedConstellation === constellation.id ? 'bg-slate-700/50' : ''
              }`}
              onClick={() => onConstellationClick(constellation.id)}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-lg">{constellation.icon}</span>
                  <span className="font-medium text-slate-200">{constellation.name}</span>
                </div>
                <span className="text-xs text-slate-400 bg-slate-700/50 px-2 py-1 rounded">
                  {constellation.items.length}
                </span>
              </div>
            </button>
            
            {/* Constellation items */}
            <div className="pl-4">
              {constellation.items.map((item) => {
                const fullItem = allItems.find(i => i.id === item.id);
                if (!fullItem) return null;
                
                const isSelected = selectedItem?.id === item.id;
                
                return (
                  <button
                    key={item.id}
                    className={`w-full p-3 text-left hover:bg-slate-700/30 transition-all duration-200 border-l-2 ${
                      isSelected 
                        ? 'border-blue-400 bg-slate-700/30' 
                        : 'border-transparent'
                    }`}
                    onClick={() => onItemClick(fullItem)}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-sm">{getItemIcon(fullItem)}</span>
                      <div className="flex-1 min-w-0">
                        <div className={`text-sm ${isSelected ? 'text-blue-400' : 'text-slate-300'} truncate`}>
                          {item.title}
                        </div>
                        <div className="text-xs text-slate-500 flex items-center gap-2">
                          <span>{item.type}</span>
                          <span>•</span>
                          <span>Importance: {item.importance}/5</span>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
} 