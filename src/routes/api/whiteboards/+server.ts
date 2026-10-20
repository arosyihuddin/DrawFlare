import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveOwnerId } from '$lib/server/auth';

function db(platform: App.Platform | undefined) {
  return platform?.env?.DB;
}

export const GET: RequestHandler = async ({ platform, url, locals }) => {
  const database = db(platform);
  if (!database) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  const search = (url.searchParams.get('q') ?? '').trim().slice(0, 160);
  const collectionId = url.searchParams.get('collectionId');
  const view = url.searchParams.get('view') ?? 'all';
  const sort = url.searchParams.get('sort') ?? 'updated';
  const direction = url.searchParams.get('direction') === 'asc' ? 'ASC' : 'DESC';
  const order = sort === 'name' ? `title COLLATE NOCASE ${direction}` : sort === 'created' ? `created_at ${direction}` : `updated_at ${direction}`;
  const where: string[] = [];
  const values: (string | number)[] = [];
  if (locals.user?.id) { where.push('owner_id = ?'); values.push(locals.user.id); }
  if (view === 'trash') where.push('deleted_at IS NOT NULL');
  else where.push('deleted_at IS NULL');
  if (view === 'favorites') where.push('is_favorite = 1');
  if (collectionId === 'unorganized') where.push('collection_id IS NULL');
  else if (collectionId && collectionId !== 'all') { where.push('collection_id = ?'); values.push(collectionId); }
  if (search) { where.push('title LIKE ?'); values.push('%' + search.replace(/[\\%_]/g, '\\$&') + '%'); }
  try {
    const result = await database.prepare(`SELECT id, title, created_at, updated_at, collection_id, deleted_at, is_favorite, revision FROM whiteboards WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 250`).bind(...values).all();
    return json(result.results ?? []);
  } catch {
    return json({ error: 'Could not list drawings' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  const database = db(platform);
  if (!database) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  const body = await request.json().catch(() => null) as { title?: unknown; collectionId?: unknown } | null;
  if (body !== null && (typeof body !== 'object' || Array.isArray(body))) return json({ error: 'Expected a JSON object' }, { status: 400 });
  if (body?.title !== undefined && typeof body.title !== 'string') return json({ error: 'title must be a string' }, { status: 400 });
  if (body?.collectionId !== undefined && body.collectionId !== null && typeof body.collectionId !== 'string') return json({ error: 'collectionId must be a string or null' }, { status: 400 });
  const id = crypto.randomUUID();
  const title = typeof body?.title === 'string' ? body.title.trim().slice(0, 160) || 'Untitled drawing' : 'Untitled drawing';
  const collectionId = typeof body?.collectionId === 'string' && body.collectionId ? body.collectionId : null;
  const scene = JSON.stringify({ elements: [], appState: {}, files: {} });
  const ownerId = await resolveOwnerId(database, locals.user);
  try {
    if (collectionId) {
      const collection = locals.user?.id
        ? await database.prepare('SELECT id FROM collections WHERE id = ? AND owner_id = ?').bind(collectionId, locals.user.id).first()
        : await database.prepare('SELECT id FROM collections WHERE id = ?').bind(collectionId).first();
      if (!collection) return json({ error: 'Collection not found' }, { status: 404 });
    }
    await database.prepare('INSERT INTO whiteboards (id, title, scene_json, collection_id, owner_id) VALUES (?, ?, ?, ?, ?)')
      .bind(id, title, scene, collectionId, ownerId).run();
    return json({ id, title, scene, collection_id: collectionId, is_favorite: 0, revision: 1 }, { status: 201 });
  } catch {
    return json({ error: 'Could not create drawing' }, { status: 500 });
  }
};
