import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const DELETE: RequestHandler = async ({ params, platform, locals }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  if (!locals.user?.id || locals.user.legacy) return json({ error: 'API keys require an individual account.' }, { status: 403 });
  const result = await db.prepare('UPDATE api_keys SET revoked_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND revoked_at IS NULL').bind(params.id, locals.user.id).run();
  if (!result.meta.changes) return json({ error: 'API key not found or already revoked.' }, { status: 404 });
  return json({ ok: true });
};
