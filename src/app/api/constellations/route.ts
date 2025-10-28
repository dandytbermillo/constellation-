import { NextResponse } from 'next/server';
import pool from '@/lib/db';
import { Constellation, ConstellationItem, ItemType } from '@/types/constellation';

export async function GET() {
  try {
    // First, fetch the knowledge-base root folder
    const knowledgeBaseQuery = `
      SELECT id, type, name, path, color, icon, metadata
      FROM items
      WHERE path = '/knowledge-base'
        AND deleted_at IS NULL
        AND type = 'folder'
    `;

    const knowledgeBaseResult = await pool.query(knowledgeBaseQuery);
    let knowledgeBaseId = null;

    // If knowledge-base doesn't exist in DB, we'll create a virtual one
    if (knowledgeBaseResult.rows.length === 0) {
      console.log('ℹ️ No knowledge-base root found in database, creating virtual root');
      knowledgeBaseId = 'virtual-knowledge-base-root';
    } else {
      knowledgeBaseId = knowledgeBaseResult.rows[0].id;
    }

    // Fetch root folders (constellation centers)
    const rootFoldersQuery = `
      SELECT id, type, name, path, color, icon, metadata
      FROM items
      WHERE path LIKE '/knowledge-base/%'
        AND path NOT LIKE '/knowledge-base/%/%'
        AND deleted_at IS NULL
        AND type = 'folder'
      ORDER BY position, name
    `;

    const rootFoldersResult = await pool.query(rootFoldersQuery);
    const rootFolders = rootFoldersResult.rows;

    // Fetch all items (files and subfolders) for each root folder
    const constellations: Constellation[] = [];

    // Add knowledge-base as the central constellation
    // The 5 subfolders will appear as items around it
    const knowledgeBaseItems: ConstellationItem[] = rootFolders.map((folder: any, index: number) => {
      const angle = (360 / rootFolders.length) * index;
      return {
        id: folder.id,
        title: folder.name,
        type: 'folder',
        importance: 5,
        angle,
        distance: 150, // Distance from center
        icon: '📁',
        content: folder.path,
        tags: ['knowledge-base', folder.name],
        isFolder: true,
        children: [],
        depthLayer: 1 // Subfolders pushed back behind Knowledge Base center
      };
    });

    const knowledgeBaseConstellation: Constellation = {
      id: knowledgeBaseId,
      name: 'Knowledge Base',
      icon: '🗄️',
      color: '#6366f1', // Indigo color for root
      centerX: 650, // Center position
      centerY: 350,
      items: knowledgeBaseItems,
      depthLayer: 0 // Root is at foreground
    };

    constellations.push(knowledgeBaseConstellation);

    // Now create constellations for each subfolder
    for (const folder of rootFolders) {
      const MAX_VISIBLE_CHILDREN = 10;

      // First, count total children
      const countQuery = `
        SELECT COUNT(*) as total
        FROM items
        WHERE parent_id = $1
          AND deleted_at IS NULL
      `;
      const countResult = await pool.query(countQuery, [folder.id]);
      const totalChildren = parseInt(countResult.rows[0].total);

      // Fetch direct children of this folder (limited to 10)
      const childrenQuery = `
        SELECT id, type, name, path, color, icon, parent_id, metadata, content
        FROM items
        WHERE parent_id = $1
          AND deleted_at IS NULL
        ORDER BY position, name
        LIMIT $2
      `;

      const childrenResult = await pool.query(childrenQuery, [folder.id, MAX_VISIBLE_CHILDREN]);
      const children = childrenResult.rows;

      // Convert children to constellation items
      const items: ConstellationItem[] = children.map((child: any, index: number) => {
        const angle = (360 / Math.max(Math.min(totalChildren, MAX_VISIBLE_CHILDREN + 1), 6)) * index;
        const distance = 70 + Math.random() * 30; // Random distance between 70-100

        return {
          id: child.id,
          title: child.name,
          type: (child.type === 'folder' ? 'folder' : getItemType(child)) as ItemType,
          importance: 3,
          angle,
          distance,
          icon: child.icon || getDefaultIcon(child.type),
          content: child.content, // Use actual content from database
          tags: extractTags(child),
          isFolder: child.type === 'folder',
          children: [], // We can add nested children later if needed
          depthLayer: 2 // Subfolder contents pushed behind their parent constellation center
        };
      });

      // Add overflow node if there are more children than the limit
      if (totalChildren > MAX_VISIBLE_CHILDREN) {
        const remainingCount = totalChildren - MAX_VISIBLE_CHILDREN;
        const overflowAngle = (360 / Math.max(Math.min(totalChildren, MAX_VISIBLE_CHILDREN + 1), 6)) * MAX_VISIBLE_CHILDREN;

        // Fetch ALL children for the overflow node
        const allChildrenQuery = `
          SELECT id, type, name, path, color, icon, parent_id, metadata, content
          FROM items
          WHERE parent_id = $1
            AND deleted_at IS NULL
          ORDER BY position, name
        `;
        const allChildrenResult = await pool.query(allChildrenQuery, [folder.id]);
        const allChildren = allChildrenResult.rows.map((child: any) => ({
          id: child.id,
          title: child.name,
          type: (child.type === 'folder' ? 'folder' : getItemType(child)) as ItemType,
          importance: 3,
          angle: 0,
          distance: 70,
          icon: child.icon || getDefaultIcon(child.type),
          content: child.content, // Use actual content from database
          tags: extractTags(child),
          isFolder: child.type === 'folder'
        }));

        const overflowNode: ConstellationItem = {
          id: `${folder.id}_more`,
          title: `+${remainingCount} more`,
          type: 'document', // Changed from 'folder' to avoid folder expansion logic
          importance: 3,
          angle: overflowAngle,
          distance: 85,
          icon: '📋',
          content: `View all ${totalChildren} items in ${folder.name}`,
          tags: ['overflow', 'more'],
          isFolder: false,
          isOverflowNode: true,
          overflowParentId: folder.id,
          allChildren: allChildren,
          depthLayer: 2
        };

        items.push(overflowNode);
      }

      // Map database colors to constellation colors
      const colorMap: Record<string, string> = {
        'emerald': '#10b981',
        'red': '#ef4444',
        'amber': '#f59e0b',
        'blue': '#3b82f6',
        'purple': '#8b5cf6',
        'pink': '#ec4899',
      };

      // Position subfolders in an ellipse around knowledge-base
      // Knowledge-base is at (650, 350), spread subfolders wider horizontally
      const folderIndex = constellations.length - 1; // -1 because knowledge-base is already added
      const angle = (360 / rootFolders.length) * folderIndex;
      const angleRad = (angle * Math.PI) / 180;
      const radiusX = 550; // Wider horizontal spread
      const radiusY = 250; // Narrower vertical spread

      const centerX = 650 + Math.cos(angleRad) * radiusX;
      const centerY = 350 + Math.sin(angleRad) * radiusY;

      // Create constellation
      const constellation: Constellation = {
        id: folder.id,
        name: folder.name,
        icon: folder.icon || '📁',
        color: colorMap[folder.color] || '#3b82f6',
        centerX,
        centerY,
        items,
        depthLayer: 1 // Subfolders are pushed back behind Knowledge Base
      };

      constellations.push(constellation);
    }

    // Create cross-constellation connections
    // Connect each subfolder constellation to the knowledge-base root ONLY
    const crossConstellationConnections: Array<[string, string]> = [];
    const knowledgeBaseCenterId = knowledgeBaseId + '_center';

    // Connect knowledge-base center to each subfolder (which are items in knowledge-base constellation)
    // These connections are already handled by the item-to-center connections
    // But we also need to connect the subfolder constellations to knowledge-base
    for (const folder of rootFolders) {
      const subfolderCenterId = folder.id + '_center';
      // Connect the subfolder constellation center to knowledge-base center
      crossConstellationConnections.push([subfolderCenterId, knowledgeBaseCenterId]);
    }

    return NextResponse.json({
      success: true,
      constellations,
      crossConstellationConnections,
      count: constellations.length
    });

  } catch (error) {
    console.error('Error fetching constellations:', error);
    return NextResponse.json(
      {
        success: false,
        error: 'Failed to fetch constellations',
        message: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Helper function to determine item type based on file extension or type
function getItemType(item: any): string {
  if (item.type === 'note') return 'note';
  if (item.type === 'folder') return 'folder';

  const name = item.name.toLowerCase();
  if (name.endsWith('.pdf')) return 'document';
  if (name.endsWith('.md') || name.endsWith('.txt')) return 'note';
  if (name.endsWith('.png') || name.endsWith('.jpg') || name.endsWith('.jpeg')) return 'media';
  if (name.endsWith('.xlsx') || name.endsWith('.csv')) return 'spreadsheet';

  return 'document';
}

// Helper function to get default icon based on type
function getDefaultIcon(type: string): string {
  const iconMap: Record<string, string> = {
    'note': '📝',
    'folder': '📁',
    'document': '📄',
    'media': '🖼️',
  };
  return iconMap[type] || '📄';
}

// Helper function to extract tags from metadata
function extractTags(item: any): string[] {
  const tags: string[] = [];

  // Add type as a tag
  if (item.type) tags.push(item.type);

  // Extract tags from metadata if available
  if (item.metadata && item.metadata.tags) {
    tags.push(...item.metadata.tags);
  }

  // Add parent folder name as a tag
  const pathParts = item.path.split('/').filter(Boolean);
  if (pathParts.length > 2) {
    tags.push(pathParts[1]); // knowledge-base folder name
  }

  return tags;
}
