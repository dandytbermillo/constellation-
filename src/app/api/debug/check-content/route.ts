import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    // Check what's actually in the content field
    const query = `
      SELECT
        id,
        name,
        type,
        CASE
          WHEN content IS NULL THEN 'NULL'
          WHEN content = '' THEN 'EMPTY STRING'
          ELSE LEFT(content, 200)
        END as content_preview,
        LENGTH(content) as content_length
      FROM items
      WHERE type != 'folder'
      ORDER BY id
      LIMIT 10
    `;

    const result = await pool.query(query);

    return NextResponse.json({
      success: true,
      items: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error checking content:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
