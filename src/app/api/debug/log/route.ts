import { NextRequest, NextResponse } from 'next/server';
import pool from '@/lib/db';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { component, action, content_preview, metadata, session_id, timestamp } = body;

    // Insert into constellation_debug_logs table (separate from existing debug_logs)
    const query = `
      INSERT INTO constellation_debug_logs (session_id, component, action, content_preview, metadata, timestamp)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING id
    `;

    const values = [
      session_id || null,
      component,
      action,
      content_preview || null,
      metadata ? JSON.stringify(metadata) : null,
      timestamp || new Date().toISOString()
    ];

    const result = await pool.query(query, values);

    return NextResponse.json({
      success: true,
      id: result.rows[0].id
    });
  } catch (error) {
    console.error('Error logging debug data:', error);
    return NextResponse.json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }, { status: 500 });
  }
}
