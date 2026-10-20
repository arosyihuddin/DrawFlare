import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readScene, removeSceneAsset, storeScene } from '$lib/server/scenes';

type CollectionDrawingRow = { id: string; title: string; scene_json: string; revision: number; updated_at: string };
type ShareRow = { token: string; collection_id: string; permission: 'view' | 'edit'; expires_at: string | null };
async function findShare(db: NonNullable<App.Platform['env']['DB']>, token: string) {
  const row = await db.prepare('SELECT token, collection_id, permission, expires_at FROM collection_share_links WHERE token = ?').bind(token).first<ShareRow>();
  if (!row || (row.expires_at && new Date(row.expires_at).getTime() <= Date.now())) return null;
  return row;
}

export const GET: RequestHandler = async ({ params, platform }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  try {
    const share = await findShare(db, params.token);
    if (!share) return json({ error: 'Collection share link is invalid or expired' }, { status: 404 });
    const collection = await db.prepare('SELECT id, name FROM collections WHERE id = ?').bind(share.collection_id).first<{ id: string; name: string }>();
    if (!collection) return json({ error: 'Collection not found' }, { status: 404 });
    const result = await db.prepare('SELECT id, title, scene_json, revision, updated_at FROM whiteboards WHERE collection_id = ? AND deleted_at IS NULL ORDER BY updated_at DESC').bind(collection.id).all<{
      id: string; title: string; scene_json: string; revision: number; updated_at: string;
    }>();
    const drawings = await Promise.all((result.results ?? []).map(async (row: CollectionDrawingRow) => ({
      id: row.id, title: row.title, revision: row.revision, updated_at: row.updated_at,
      scene: await readScene(row.scene_json, row.id, platform?.env)
    })));
    return json({ collection, permission: share.permission, drawings });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Could not load shared collection' }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ params, platform, request }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  try {
    const share = await findShare(db, params.token);
    if (!share) return json({ error: 'Collection share link is invalid or expired' }, { status: 404 });
    if (share.permission !== 'edit') return json({ error: 'This collection share link is view-only' }, { status: 403 });
    const body = await request.json().catch(() => null) as { drawingId?: unknown; scene?: unknown; expectedRevision?: unknown } | null;
    if (!body || typeof body.drawingId !== 'string' || !body.drawingId ||
        !body.scene || typeof body.scene !== 'object' || Array.isArray(body.scene) ||
        !Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) {
      return json({ error: 'drawingId, scene, and expectedRevision are required' }, { status: 400 });
    }
    const existing = await db.prepare('SELECT scene_json, revision FROM whiteboards WHERE id = ? AND collection_id = ? AND deleted_at IS NULL')
      .bind(body.drawingId, share.collection_id).first<{ scene_json: string; revision: number }>();
    if (!existing) return json({ error: 'Drawing is not part of this shared collection' }, { status: 404 });
    if (existing.revision !== Number(body.expectedRevision)) return json({ error: 'Drawing changed since it was opened. Reload to avoid overwriting newer edits.', conflict: true, currentRevision: existing.revision }, { status: 409 });
    const stored = await storeScene(body.scene, body.drawingId, platform?.env);
    const result = await db.prepare('UPDATE whiteboards SET scene_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND collection_id = ? AND revision = ?')
      .bind(stored.stored, body.drawingId, share.collection_id, existing.revision).run();
    if (!result.meta.changes) {
      if (stored.inR2) await removeSceneAsset(stored.stored, body.drawingId, platform?.env);
      return json({ error: 'Drawing changed while saving. Reload before continuing.', conflict: true }, { status: 409 });
    }
    await removeSceneAsset(existing.scene_json, body.drawingId, platform?.env);
    return json({ ok: true, revision: existing.revision + 1 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Could not save drawing';
    return json({ error: message }, { status: message.includes('limit') || message.includes('exceeds') ? 413 : 500 });
  }
};
