/**
 * Debug Logger - Logs to PostgreSQL debug_logs table
 */

// Feature flag to disable debug logging
const DEBUG_LOGGING_ENABLED = true; // Set to true to enable debug logging

let sessionId: string | null = null;

// Generate or get session ID
function getSessionId(): string {
  if (!sessionId) {
    sessionId = `session-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }
  return sessionId;
}

export interface DebugLogData {
  component: string;
  action: string;
  content_preview?: string;
  metadata?: Record<string, any>;
}

/**
 * Log debug information to PostgreSQL
 * Supports both object format and legacy 3-parameter format
 */
export async function debugLog(
  dataOrContext: DebugLogData | string,
  event?: string,
  details?: any
): Promise<void> {
  // Early return if debug logging is disabled
  if (!DEBUG_LOGGING_ENABLED) {
    return;
  }

  try {
    let logData: DebugLogData;

    // Support both calling styles
    if (typeof dataOrContext === 'string') {
      // Legacy 3-parameter style: debugLog('Context', 'event', {...})
      logData = {
        component: dataOrContext,
        action: event || 'unknown',
        metadata: details
      };
    } else {
      // New object style: debugLog({ component: '...', action: '...', ... })
      logData = dataOrContext;
    }

    await fetch('/api/debug/log', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        ...logData,
        session_id: getSessionId(),
        timestamp: new Date().toISOString(),
      }),
    });
  } catch (error) {
    // Fallback to console if API fails
    console.log('[DEBUG]', dataOrContext, event, details);
  }
}

/**
 * Log constellation focus updates
 */
export async function logConstellationFocus(
  folderId: string,
  folderTitle: string,
  constellationId: string,
  action: 'focus' | 'unfocus'
): Promise<void> {
  await debugLog({
    component: 'ConstellationFocus',
    action: action,
    content_preview: `${action === 'focus' ? 'Focusing' : 'Unfocusing'} constellation: ${folderTitle}`,
    metadata: {
      folderId,
      folderTitle,
      constellationId,
    },
  });
}

/**
 * Log depth layer calculations
 */
export async function logDepthCalculation(
  itemTitle: string,
  itemConstellation: string | null,
  focusedConstellation: string | null,
  isFocused: boolean,
  calculatedLayer: number
): Promise<void> {
  await debugLog({
    component: 'DepthCalculation',
    action: 'calculateLayer',
    content_preview: `Depth for ${itemTitle}: Layer ${calculatedLayer}`,
    metadata: {
      itemTitle,
      itemConstellation,
      focusedConstellation,
      isFocused,
      calculatedLayer,
    },
  });
}

/**
 * Log double-click detection
 */
export async function logDoubleClick(
  itemId: string,
  itemTitle: string,
  timeSinceLastClick: number,
  isDoubleClick: boolean
): Promise<void> {
  await debugLog({
    component: 'ClickDetection',
    action: 'doubleClick',
    content_preview: `${isDoubleClick ? 'Double-click' : 'Single-click'} on ${itemTitle}`,
    metadata: {
      itemId,
      itemTitle,
      timeSinceLastClick,
      isDoubleClick,
    },
  });
}
