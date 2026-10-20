import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveOwnerId } from '$lib/server/auth';

export const GET: RequestHandler = async ({ platform, locals }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  try {
    const result = locals.user?.id
      ? await db.prepare('SELECT id, name, created_at, updated_at FROM collections WHERE owner_id = ? ORDER BY name COLLATE NOCASE').bind(locals.user.id).all()
      : await db.prepare('SELECT id, name, created_at, updated_at FROM collections ORDER BY name COLLATE NOCASE').all();
    return json(result.results ?? []);
  } catch {
    return json({ error: 'Could not load collections' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ platform, request, locals }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  const body = await request.json().catch(() => null) as { name?: unknown } | null;
  if (!body || typeof body.name !== 'string' || !body.name.trim()) return json({ error: 'Collection name is required' }, { status: 400 });
  const name = body.name.trim().slice(0, 80);
  const id = crypto.randomUUID();
  const ownerId = await resolveOwnerId(db, locals.user);
  try {
    await db.prepare('INSERT INTO collections (id, name, owner_id) VALUES (?, ?, ?)').bind(id, name, ownerId).run();
    return json({ id, name, drawing_count: 0 }, { status: 201 });
  } catch {
    return json({ error: 'Could not create collection' }, { status: 500 });
  }
};
