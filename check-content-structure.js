/**
 * Check database content structure
 */

const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://dandy@localhost:5432/annotation_dev'
})

async function checkStructure() {
  try {
    console.log('\n=== Checking Database Content Structure ===\n')

    // Check if document_saves table exists
    const tablesResult = await pool.query(`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN ('items', 'document_saves', 'notes')
      ORDER BY table_name
    `)

    console.log('📊 Available tables:')
    tablesResult.rows.forEach(row => console.log(`   - ${row.table_name}`))
    console.log('')

    // Check a sample item
    const itemResult = await pool.query(`
      SELECT id, name, type, content IS NOT NULL as has_content,
             LENGTH(content::text) as content_length
      FROM items
      WHERE type != 'folder'
        AND deleted_at IS NULL
      LIMIT 5
    `)

    console.log('📄 Sample items:')
    for (const item of itemResult.rows) {
      console.log(`   ${item.name} (${item.type})`)
      console.log(`      Has content: ${item.has_content}`)
      console.log(`      Content length: ${item.content_length || 0}`)
    }
    console.log('')

    // If document_saves exists, check it
    if (tablesResult.rows.some(r => r.table_name === 'document_saves')) {
      const savesResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM document_saves
      `)
      console.log(`💾 document_saves table has ${savesResult.rows[0].count} records`)
    }

    // If notes exists, check it
    if (tablesResult.rows.some(r => r.table_name === 'notes')) {
      const notesResult = await pool.query(`
        SELECT COUNT(*) as count
        FROM notes
        WHERE content_text IS NOT NULL
      `)
      console.log(`📝 notes table has ${notesResult.rows[0].count} records with content`)
    }

  } catch (error) {
    console.error('Error:', error.message)
  } finally {
    await pool.end()
  }
}

checkStructure()
