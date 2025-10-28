import { NextResponse } from 'next/server';
import pool from '@/lib/db';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const component = searchParams.get('component');
    const limit = searchParams.get('limit') || '50';

    let query = `
      SELECT id, session_id, component, action, content_preview, metadata, timestamp
      FROM constellation_debug_logs
    `;

    const params: any[] = [];

    if (component) {
      query += ` WHERE component = $1`;
      params.push(component);
    }

    query += ` ORDER BY timestamp DESC LIMIT $${params.length + 1}`;
    params.push(parseInt(limit));

    const result = await pool.query(query, params);

    return NextResponse.json({
      success: true,
      logs: result.rows,
      count: result.rows.length
    });
  } catch (error) {
    console.error('Error fetching debug logs:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
