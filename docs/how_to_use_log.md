# How-To: Use the Postgres `constellation_debug_logs` Table for Instrumentation

This guide explains how the Next.js app records diagnostic events in Postgres and how to rely on that pipeline instead of ad-hoc `console.log` statements. It covers schema setup, runtime wiring, and practical commands for inspecting logs during investigations.

## 1. Ensure the Database Schema Exists

The debug infrastructure uses a dedicated table for constellation debugging:

- Table: `constellation_debug_logs` (separate from existing `debug_logs` to avoid conflicts)
- Migration SQL: `/tmp/create_constellation_debug_logs.sql`

If you are setting up a fresh environment, run the SQL migration:

```bash
psql postgresql://postgres:dandy@localhost:5432/knowledgebase -f /tmp/create_constellation_debug_logs.sql
```

After running the migration, confirm the table exists:

```bash
node - <<'NODE'
const { Client } = require('pg')
;(async () => {
  const client = new Client({ connectionString: 'postgresql://postgres:dandy@localhost:5432/knowledgebase' })
  await client.connect()
  const res = await client.query(`
    SELECT table_name
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'constellation_debug_logs'
  `)
  console.log(res.rows)
  await client.end()
})().catch(err => { console.error(err); process.exit(1) })
NODE
```

If the query returns an empty array, re-run the SQL file manually.

## 2. How the Application Writes Logs

Key implementation pieces:

- `src/utils/debugLog.ts`
  - Exposes `debugLog()` (object form or legacy string form).
  - Generates a session ID and POSTs to `/api/debug/log` with `component`, `action`, `metadata`, etc.
  - Provides specialized logging functions:
    - `logConstellationFocus()` - Logs focus/unfocus actions
    - `logDepthCalculation()` - Logs depth layer calculations
    - `logDoubleClick()` - Logs double-click detection

- `src/app/api/debug/log/route.ts`
  - Accepts POST requests and inserts rows into `constellation_debug_logs`
  - Returns success/error status

### Feature Flag

Debug logging can be disabled by setting `DEBUG_LOGGING_ENABLED = false` in `src/utils/debugLog.ts`.

```typescript
// In src/utils/debugLog.ts
const DEBUG_LOGGING_ENABLED = true; // Set to false to disable
```

## 3. Querying Logs During An Investigation

Use SQL (via `psql`, `pgcli`, or Node's `pg` module) to inspect structured output. Example queries:

### View Recent Constellation Focus Events

```bash
node - <<'NODE'
const { Client } = require('pg')
;(async () => {
  const client = new Client({ connectionString: 'postgresql://postgres:dandy@localhost:5432/knowledgebase' })
  await client.connect()
  const res = await client.query(`
    SELECT id, component, action, content_preview, metadata, timestamp
      FROM constellation_debug_logs
     WHERE component = 'ConstellationFocus'
       AND timestamp > NOW() - INTERVAL '10 minutes'
     ORDER BY id DESC
     LIMIT 40
  `)
  console.log(JSON.stringify(res.rows, null, 2))
  await client.end()
})().catch(err => { console.error(err); process.exit(1) })
NODE
```

### View Depth Layer Calculations

```bash
node - <<'NODE'
const { Client } = require('pg')
;(async () => {
  const client = new Client({ connectionString: 'postgresql://postgres:dandy@localhost:5432/knowledgebase' })
  await client.connect()
  const res = await client.query(`
    SELECT id, component, action, content_preview, metadata, timestamp
      FROM constellation_debug_logs
     WHERE component = 'DepthCalculation'
       AND timestamp > NOW() - INTERVAL '5 minutes'
     ORDER BY id DESC
     LIMIT 50
  `)
  console.log(JSON.stringify(res.rows, null, 2))
  await client.end()
})().catch(err => { console.error(err); process.exit(1) })
NODE
```

### View All Recent Debug Activity

```bash
node - <<'NODE'
const { Client } = require('pg')
;(async () => {
  const client = new Client({ connectionString: 'postgresql://postgres:dandy@localhost:5432/knowledgebase' })
  await client.connect()
  const res = await client.query(`
    SELECT id, session_id, component, action, content_preview, timestamp
      FROM constellation_debug_logs
     WHERE timestamp > NOW() - INTERVAL '10 minutes'
     ORDER BY timestamp DESC
     LIMIT 50
  `)
  console.log(JSON.stringify(res.rows, null, 2))
  await client.end()
})().catch(err => { console.error(err); process.exit(1) })
NODE
```

Tips:

- Narrow by `component` and timeframe to keep output focused.
- `metadata` is stored as JSONB; pull nested fields with `metadata -> 'fieldName'` in your SQL when you need precise values.
- Each session gets a unique `session_id` to track user activity across page reloads.
- Use `content_preview` for quick human-readable summaries.

## 4. Available Logging Functions

### logConstellationFocus
Logs when a constellation is focused or unfocused via double-click.

```typescript
import { logConstellationFocus } from '@/utils/debugLog';

await logConstellationFocus(
  folderId,           // Folder ID
  folderTitle,        // Folder title
  constellationId,    // Constellation ID
  'focus'             // 'focus' | 'unfocus'
);
```

### logDepthCalculation
Logs depth layer calculations for items during rendering.

```typescript
import { logDepthCalculation } from '@/utils/debugLog';

await logDepthCalculation(
  itemTitle,          // Item title
  itemConstellation,  // Item's constellation ID
  focusedConstellation, // Currently focused constellation
  isFocused,          // Whether this item is in focused constellation
  calculatedLayer     // The calculated depth layer
);
```

### logDoubleClick
Logs double-click detection events.

```typescript
import { logDoubleClick } from '@/utils/debugLog';

await logDoubleClick(
  itemId,             // Item ID
  itemTitle,          // Item title
  timeSinceLastClick, // Time in ms since last click
  isDoubleClick       // Whether this is a double-click
);
```

### Generic debugLog
For custom logging needs.

```typescript
import { debugLog } from '@/utils/debugLog';

// Object style (recommended)
await debugLog({
  component: 'MyFeature',
  action: 'STATE_TRANSITION',
  content_preview: 'User clicked the save button',
  metadata: {
    from: previousState,
    to: nextState,
    userId,
  },
});

// Legacy 3-parameter style
await debugLog('MyFeature', 'STATE_TRANSITION', { details: 'some data' });
```

## 5. Adding New Instrumentation

When you need more signals:

1. Import the logger: `import { debugLog } from '@/utils/debugLog'`.
2. Emit events where state changes occur. Use concise `component` names and structured `metadata` (objects, not strings) so you can filter later.
3. Consider adding a specialized logging function in `debugLog.ts` for frequently logged events.

Example inline usage:

```typescript
await debugLog({
  component: 'ConstellationDrag',
  action: 'START_DRAG',
  content_preview: `Started dragging ${itemTitle}`,
  metadata: {
    itemId,
    itemTitle,
    itemType,
    startPosition: { x, y },
  },
});
```

## 6. Why Prefer This Over `console.log`

- **Persistence**: Logs survive reloads and are visible to collaborators without screen sharing.
- **Structure**: JSON metadata allows filtering, grouping, and automated analysis (e.g., diffing snapshots during regressions).
- **Noise Control**: You can enable/disable instrumentation with the feature flag instead of rewriting code between debugging sessions.
- **Audit Trail**: The `constellation_debug_logs` table provides evidence during post-mortems; link concrete row IDs in research docs instead of copying console screenshots.
- **Session Tracking**: Each browser session gets a unique ID, making it easy to trace user journeys.
- **Fallback**: If the API fails, logs automatically fall back to `console.log`.

By leaning on the Postgres-backed logger, investigations stay reproducible and you avoid the ephemerality and noise of console output.

## 7. Table Schema

```sql
CREATE TABLE constellation_debug_logs (
  id SERIAL PRIMARY KEY,
  session_id VARCHAR(255),              -- Unique session identifier
  component VARCHAR(255) NOT NULL,      -- Component name (e.g., 'ConstellationFocus')
  action VARCHAR(255) NOT NULL,         -- Action type (e.g., 'focus', 'unfocus')
  content_preview TEXT,                 -- Human-readable summary
  metadata JSONB,                       -- Structured data about the event
  timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast queries
CREATE INDEX idx_constellation_debug_logs_session_id ON constellation_debug_logs(session_id);
CREATE INDEX idx_constellation_debug_logs_component ON constellation_debug_logs(component);
CREATE INDEX idx_constellation_debug_logs_timestamp ON constellation_debug_logs(timestamp DESC);
```
