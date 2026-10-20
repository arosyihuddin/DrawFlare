import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readScene, removeSceneAsset, storeScene } from '$lib/server/scenes';
import { validateDrawingScene } from '$lib/server/validateDrawingScene';

type BoardRow = { id: string; title: string; scene_json: string; created_at: string; updated_at: string; revision: number };

export const GET: RequestHandler = async ({ params, platform, locals }) => {
  const database = platform?.env?.DB;
  if (!database) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  try {
    const row = locals.user?.id
      ? await database.prepare('SELECT id, title, scene_json, created_at, updated_at, revision FROM whiteboards WHERE id = ? AND owner_id = ?').bind(params.id, locals.user.id).first<BoardRow>()
      : await database.prepare('SELECT id, title, scene_json, created_at, updated_at, revision FROM whiteboards WHERE id = ?').bind(params.id).first<BoardRow>();
    if (!row) return json({ error: 'Whiteboard not found' }, { status: 404 });
    const scene = await readScene(row.scene_json, row.id, platform?.env);
    return json({ id: row.id, title: row.title, scene, revision: row.revision, created_at: row.created_at, updated_at: row.updated_at });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : 'Could not load whiteboard' }, { status: 500 });
  }
};

export const PUT: RequestHandler = async ({ params, request, platform, locals }) => {
  const database = platform?.env?.DB;
  if (!database) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  const body = await request.json().catch(() => null) as { title?: unknown; scene?: unknown; expectedRevision?: unknown } | null;
  if (!body) return json({ error: 'Expected a JSON object containing scene' }, { status: 400 });
  const sceneError = validateDrawingScene(body.scene);
  if (sceneError) return json({ error: sceneError }, { status: 400 });
  if (body.expectedRevision !== undefined && (!Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 1)) {
    return json({ error: 'expectedRevision must be a positive integer' }, { status: 400 });
  }
  const expectedRevision = body.expectedRevision === undefined ? undefined : Number(body.expectedRevision);
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 160) : undefined;
  try {
    const existing = locals.user?.id
      ? await database.prepare('SELECT scene_json, revision, title, updated_at, created_at FROM whiteboards WHERE id = ? AND owner_id = ?').bind(params.id, locals.user.id).first<{ scene_json: string; revision: number; title: string; updated_at: string; created_at: string }>()
      : await database.prepare('SELECT scene_json, revision, title, updated_at, created_at FROM whiteboards WHERE id = ?').bind(params.id).first<{ scene_json: string; revision: number; title: string; updated_at: string; created_at: string }>();
    if (!existing) return json({ error: 'Drawing not found' }, { status: 404 });
    if (expectedRevision !== undefined && existing.revision !== expectedRevision) {
      return json({ error: 'This whiteboard changed since you opened it. Reload before saving to avoid overwriting newer edits.', conflict: true, currentRevision: existing.revision }, { status: 409 });
    }
    const latestHistory = await database.prepare('SELECT created_at FROM drawing_history WHERE whiteboard_id = ? ORDER BY created_at DESC LIMIT 1').bind(params.id).first<{ created_at: string }>();
    const historyBaseline = latestHistory?.created_at ?? existing.created_at;
    const baselineTime = Date.parse(historyBaseline.replace(' ', 'T') + 'Z');
    if (Number.isFinite(baselineTime) && Date.now() - baselineTime >= 5 * 60 * 1000) {
      const previousScene = await readScene(existing.scene_json, params.id, platform?.env);
      const snapshot = JSON.stringify(previousScene);
      if (new TextEncoder().encode(snapshot).byteLength <= 450_000) {
        await database.prepare('INSERT INTO drawing_history (id, whiteboard_id, title, scene_json) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), params.id, existing.title, snapshot).run();
      }
    }
    const stored = await storeScene(body.scene, params.id, platform?.env);
    const result = expectedRevision === undefined
      ? (title === undefined
        ? await database.prepare('UPDATE whiteboards SET scene_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(stored.stored, params.id).run()
        : await database.prepare('UPDATE whiteboards SET title = ?, scene_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').bind(title || 'Untitled whiteboard', stored.stored, params.id).run())
      : (title === undefined
        ? await database.prepare('UPDATE whiteboards SET scene_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ?').bind(stored.stored, params.id, expectedRevision).run()
        : await database.prepare('UPDATE whiteboards SET title = ?, scene_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ?').bind(title || 'Untitled whiteboard', stored.stored, params.id, expectedRevision).run());
    if (!result.meta.changes) {
      if (stored.inR2) await removeSceneAsset(stored.stored, params.id, platform?.env);
      const current = await database.prepare('SELECT revision FROM whiteboards WHERE id = ?').bind(params.id).first<{ revision: number }>();
      return json({ error: 'This whiteboard changed while you were saving. Reload before continuing.', conflict: true, currentRevision: current?.revision }, { status: 409 });
    }
    await removeSceneAsset(existing.scene_json, params.id, platform?.env);
    const current = await database.prepare('SELECT revision FROM whiteboards WHERE id = ?').bind(params.id).first<{ revision: number }>();
    return json({ ok: true, id: params.id, revision: current?.revision, storage: stored.inR2 ? 'r2' : 'd1', bytes: stored.byteLength });
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Could not save whiteboard';
    return json({ error: message }, { status: message.includes('limit') || message.includes('exceeds') ? 413 : 500 });
  }
};

export const PATCH: RequestHandler = async ({ params, platform, request, locals }) => {
  const database = platform?.env?.DB;
  if (!database) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  const body = await request.json().catch(() => null) as { title?: unknown; collectionId?: unknown; isFavorite?: unknown; deleted?: unknown } | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Expected a JSON object' }, { status: 400 });
  if (body.title !== undefined && (typeof body.title !== 'string' || !body.title.trim())) return json({ error: 'title must be a non-empty string' }, { status: 400 });
  if (body.collectionId !== undefined && body.collectionId !== null && typeof body.collectionId !== 'string') return json({ error: 'collectionId must be a string or null' }, { status: 400 });
  if (body.isFavorite !== undefined && typeof body.isFavorite !== 'boolean') return json({ error: 'isFavorite must be a boolean' }, { status: 400 });
  if (body.deleted !== undefined && typeof body.deleted !== 'boolean') return json({ error: 'deleted must be a boolean' }, { status: 400 });
  try {
    const exists = locals.user?.id
      ? await database.prepare('SELECT id FROM whiteboards WHERE id = ? AND owner_id = ?').bind(params.id, locals.user.id).first()
      : await database.prepare('SELECT id FROM whiteboards WHERE id = ?').bind(params.id).first();
    if (!exists) return json({ error: 'Drawing not found' }, { status: 404 });
    if (typeof body.collectionId === 'string' && body.collectionId) {
      const collection = locals.user?.id
        ? await database.prepare('SELECT id FROM collections WHERE id = ? AND owner_id = ?').bind(body.collectionId, locals.user.id).first()
        : await database.prepare('SELECT id FROM collections WHERE id = ?').bind(body.collectionId).first();
      if (!collection) return json({ error: 'Collection not found' }, { status: 404 });
    }
    const updates: string[] = [];
    const values: (string | number | null)[] = [];
    if (typeof body.title === 'string') { updates.push('title = ?'); values.push(body.title.trim().slice(0, 160)); }
    if (body.collectionId !== undefined) { updates.push('collection_id = ?'); values.push(typeof body.collectionId === 'string' && body.collectionId ? body.collectionId : null); }
    if (typeof body.isFavorite === 'boolean') { updates.push('is_favorite = ?'); values.push(body.isFavorite ? 1 : 0); }
    if (typeof body.deleted === 'boolean') { updates.push('deleted_at = ?'); values.push(body.deleted ? new Date().toISOString() : null); }
    if (!updates.length) return json({ error: 'No supported fields supplied' }, { status: 400 });
    updates.push('updated_at = CURRENT_TIMESTAMP');
    values.push(params.id);
    const update = locals.user?.id
      ? await database.prepare('UPDATE whiteboards SET ' + updates.join(', ') + ' WHERE id = ? AND owner_id = ?').bind(...values, locals.user.id).run()
      : await database.prepare('UPDATE whiteboards SET ' + updates.join(', ') + ' WHERE id = ?').bind(...values).run();
    if (!update.meta.changes) return json({ error: 'Drawing not found' }, { status: 404 });
    return json({ ok: true });
  } catch {
    return json({ error: 'Could not update drawing' }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ params, platform, locals }) => {
  const database = platform?.env?.DB;
  if (!database) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  try {
    const row = locals.user?.id
      ? await database.prepare('SELECT scene_json FROM whiteboards WHERE id = ? AND owner_id = ?').bind(params.id, locals.user.id).first<{ scene_json: string }>()
      : await database.prepare('SELECT scene_json FROM whiteboards WHERE id = ?').bind(params.id).first<{ scene_json: string }>();
    if (!row) return json({ error: 'Whiteboard not found' }, { status: 404 });
    const result = locals.user?.id
      ? await database.prepare('DELETE FROM whiteboards WHERE id = ? AND owner_id = ?').bind(params.id, locals.user.id).run()
      : await database.prepare('DELETE FROM whiteboards WHERE id = ?').bind(params.id).run();
    if (!result.meta.changes) return json({ error: 'Whiteboard not found' }, { status: 404 });
    await removeSceneAsset(row.scene_json, params.id, platform?.env);
    return json({ ok: true });
  } catch {
    return json({ error: 'Could not delete whiteboard' }, { status: 500 });
  }
};
