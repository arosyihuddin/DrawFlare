import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, locals }) => {
  if (locals.user && locals.user.role !== 'ADMIN') return json({ error: 'Administrator access required.' }, { status: 403 });
  const env = platform?.env;
  const db = env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  try {
    const [drawings, trash, collections, shares, history] = await Promise.all([
      db.prepare('SELECT COUNT(*) AS count FROM whiteboards WHERE deleted_at IS NULL').first<{ count: number }>(),
      db.prepare('SELECT COUNT(*) AS count FROM whiteboards WHERE deleted_at IS NOT NULL').first<{ count: number }>(),
      db.prepare('SELECT COUNT(*) AS count FROM collections').first<{ count: number }>(),
      db.prepare('SELECT COUNT(*) AS count FROM share_links').first<{ count: number }>(),
      db.prepare('SELECT COUNT(*) AS count FROM drawing_history').first<{ count: number }>()
    ]);
    return json({
      storage: { d1: true, r2: Boolean(env?.FILES) },
      security: { sharedPasswordConfigured: Boolean(env?.APP_PASSWORD && env?.AUTH_SECRET), mcpTokenConfigured: Boolean(env?.MCP_AUTH_TOKEN) },
      counts: { drawings: drawings?.count ?? 0, trash: trash?.count ?? 0, collections: collections?.count ?? 0, shares: shares?.count ?? 0, history: history?.count ?? 0 },
      authModel: 'shared-password'
    });
  } catch {
    return json({ error: 'Could not load workspace diagnostics. Apply all D1 migrations first.' }, { status: 500 });
  }
};
