import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const PATCH: RequestHandler = async ({ params, platform, request, locals }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  const body = await request.json().catch(() => null) as { name?: unknown } | null;
  if (!body || typeof body.name !== 'string' || !body.name.trim()) return json({ error: 'Collection name is required' }, { status: 400 });
  const result = locals.user?.id
    ? await db.prepare('UPDATE collections SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND owner_id = ?').bind(body.name.trim().slice(0, 80), params.id, locals.user.id).run()
    : await db.prepare('UPDATE collections SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(body.name.trim().slice(0, 80), params.id).run();
  if (!result.meta.changes) return json({ error: 'Collection not found' }, { status: 404 });
  return json({ ok: true });
};

export const DELETE: RequestHandler = async ({ params, platform, locals }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  const result = locals.user?.id
    ? await db.prepare('DELETE FROM collections WHERE id = ? AND owner_id = ?').bind(params.id, locals.user.id).run()
    : await db.prepare('DELETE FROM collections WHERE id = ?').bind(params.id).run();
  if (!result.meta.changes) return json({ error: 'Collection not found' }, { status: 404 });
  await db.prepare('UPDATE whiteboards SET collection_id = NULL WHERE collection_id = ?').bind(params.id).run();
  return json({ ok: true });
};
