import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { readScene, removeSceneAsset, storeScene } from '$lib/server/scenes';

export const GET: RequestHandler = async ({ params, platform, locals }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  const drawing = locals.user?.id
    ? await db.prepare('SELECT id FROM whiteboards WHERE id = ? AND owner_id = ?').bind(params.id, locals.user.id).first()
    : await db.prepare('SELECT id FROM whiteboards WHERE id = ?').bind(params.id).first();
  if (!drawing) return json({ error: 'Drawing not found' }, { status: 404 });
  const result = await db.prepare('SELECT id, title, created_at FROM drawing_history WHERE whiteboard_id = ? ORDER BY created_at DESC LIMIT 50').bind(params.id).all();
  return json(result.results ?? []);
};

export const POST: RequestHandler = async ({ params, platform, request, locals }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  const body = await request.json().catch(() => null) as { historyId?: unknown; expectedRevision?: unknown } | null;
  if (!body || typeof body.historyId !== 'string' || !body.historyId) return json({ error: 'historyId is required' }, { status: 400 });
  if (!Number.isInteger(body.expectedRevision) || Number(body.expectedRevision) < 1) return json({ error: 'expectedRevision must be a positive integer' }, { status: 400 });
  try {
    const current = locals.user?.id
      ? await db.prepare('SELECT scene_json, revision, title FROM whiteboards WHERE id = ? AND owner_id = ?').bind(params.id, locals.user.id).first<{ scene_json: string; revision: number; title: string }>()
      : await db.prepare('SELECT scene_json, revision, title FROM whiteboards WHERE id = ?').bind(params.id).first<{ scene_json: string; revision: number; title: string }>();
    if (!current) return json({ error: 'Drawing not found' }, { status: 404 });
    if (current.revision !== Number(body.expectedRevision)) return json({ error: 'Drawing changed since it was opened. Reload before restoring history.', conflict: true, currentRevision: current.revision }, { status: 409 });
    const snapshot = await db.prepare('SELECT title, scene_json FROM drawing_history WHERE id = ? AND whiteboard_id = ?').bind(body.historyId, params.id).first<{ title: string; scene_json: string }>();
    if (!snapshot) return json({ error: 'History snapshot not found' }, { status: 404 });
    const currentScene = await readScene(current.scene_json, params.id, platform?.env);
    const currentPayload = JSON.stringify(currentScene);
    if (new TextEncoder().encode(currentPayload).byteLength <= 450_000) {
      await db.prepare('INSERT INTO drawing_history (id, whiteboard_id, title, scene_json) VALUES (?, ?, ?, ?)').bind(crypto.randomUUID(), params.id, current.title, currentPayload).run();
    }
    const scene = JSON.parse(snapshot.scene_json) as unknown;
    const stored = await storeScene(scene, params.id, platform?.env);
    const update = locals.user?.id
      ? await db.prepare('UPDATE whiteboards SET title = ?, scene_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ? AND owner_id = ?').bind(snapshot.title, stored.stored, params.id, current.revision, locals.user.id).run()
      : await db.prepare('UPDATE whiteboards SET title = ?, scene_json = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND revision = ?').bind(snapshot.title, stored.stored, params.id, current.revision).run();
    if (!update.meta.changes) {
      if (stored.inR2) await removeSceneAsset(stored.stored, params.id, platform?.env);
      return json({ error: 'Drawing changed while restoring history.', conflict: true }, { status: 409 });
    }
    await removeSceneAsset(current.scene_json, params.id, platform?.env);
    const updated = locals.user?.id
      ? await db.prepare('SELECT revision FROM whiteboards WHERE id = ? AND owner_id = ?').bind(params.id, locals.user.id).first<{ revision: number }>()
      : await db.prepare('SELECT revision FROM whiteboards WHERE id = ?').bind(params.id).first<{ revision: number }>();
    return json({ ok: true, revision: updated?.revision });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Could not restore history' }, { status: 500 });
  }
};
