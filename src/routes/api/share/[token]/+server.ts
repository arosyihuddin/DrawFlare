import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readScene, removeSceneAsset, storeScene } from '$lib/server/scenes';

type ShareRow = { token: string; whiteboard_id: string; permission: 'view' | 'edit'; expires_at: string | null };

async function findShare(db: NonNullable<App.Platform['env']['DB']>, token: string) {
  const row = await db.prepare('SELECT token, whiteboard_id, permission, expires_at FROM share_links WHERE token = ?').bind(token).first<ShareRow>();
  if (!row || (row.expires_at && new Date(row.expires_at).getTime() <= Date.now())) return null;
  return row;
}

export const GET: RequestHandler = async ({ params, platform }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  try {
    const share = await findShare(db, params.token);
    if (!share) return json({ error: 'Share link is invalid or expired' }, { status: 404 });
    const board = await db.prepare('SELECT id, title, scene_json, revision, updated_at FROM whiteboards WHERE id = ?').bind(share.whiteboard_id).first<{ id: string; title: string; scene_json: string; revision: number; updated_at: string }>();
    if (!board) return json({ error: 'Whiteboard not found' }, { status: 404 });
    const scene = await readScene(board.scene_json, board.id, platform?.env);
    return json({ id: board.id, title: board.title, scene, revision: board.revision, permission: share.permission, updated_at: board.updated_at });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not load shared whiteboard' }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ params, platform, request }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  try {
    const share = await findShare(db, params.token);
    if (!share) return json({ error: 'Share link is invalid or expired' }, { status: 404 });
    if (share.permission !== 'edit') return json({ error: 'This share link is view-only' }, { status: 403 });
    const body = await request.json().catch(() => null) as { scene?: unknown; title?: unknown; expectedRevision?: unknown } | null;
    if (!body || body.scene === undefined || typeof body.scene !== 'object' || body.scene === null || Array.isArray(body.scene)) {
      return json({ error: 'Expected scene to be a JSON object' }, { status: 400 });
    }
    if (!Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) {
      return json({ error: 'expectedRevision is required; reload the shared whiteboard before saving' }, { status: 428 });
    }
    const existing = await db.prepare('SELECT scene_json, revision FROM whiteboards WHERE id = ?').bind(share.whiteboard_id).first<{ scene_json: string; revision: number }>();
    if (!existing) return json({ error: 'Whiteboard not found' }, { status: 404 });
    const expectedRevision = Number(body.expectedRevision);
    if (existing.revision !== expectedRevision) {
      return json({ error: 'This whiteboard changed since you opened it. Reload before saving to avoid overwriting newer edits.', conflict: true, currentRevision: existing.revision }, { status: 409 });
    }
    const stored = await storeScene(body.scene, share.whiteboard_id, platform?.env);
    const title = typeof body.title === 'string' ? body.title.trim().slice(0, 160) : undefined;
    const result = title === undefined
      ? await db.prepare('UPDATE whiteboards SET scene_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ?').bind(stored.stored, share.whiteboard_id, expectedRevision).run()
      : await db.prepare('UPDATE whiteboards SET title = ?, scene_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ?').bind(title || 'Untitled whiteboard', stored.stored, share.whiteboard_id, expectedRevision).run();
    if (!result.meta.changes) {
      if (stored.inR2) await removeSceneAsset(stored.stored, share.whiteboard_id, platform?.env);
      const current = await db.prepare('SELECT revision FROM whiteboards WHERE id = ?').bind(share.whiteboard_id).first<{ revision: number }>();
      return json({ error: 'This whiteboard changed while you were saving. Reload before continuing.', conflict: true, currentRevision: current?.revision }, { status: 409 });
    }
    await removeSceneAsset(existing.scene_json, share.whiteboard_id, platform?.env);
    const current = await db.prepare('SELECT revision FROM whiteboards WHERE id = ?').bind(share.whiteboard_id).first<{ revision: number }>();
    return json({ ok: true, id: share.whiteboard_id, revision: current?.revision, storage: stored.inR2 ? 'r2' : 'd1' });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not save shared whiteboard';
    return json({ error: message }, { status: message.includes('limit') || message.includes('exceeds') ? 413 : 500 });
  }
};
