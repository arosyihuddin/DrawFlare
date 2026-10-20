import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { resolveOwnerId } from '$lib/server/auth';
import { readScene, removeSceneAsset, storeScene } from '$lib/server/scenes';

type BackupCollection = { id?: unknown; name?: unknown };
type BackupDrawing = { id?: unknown; title?: unknown; scene?: unknown; collectionId?: unknown; isFavorite?: unknown; deleted?: unknown };
type BackupPayload = { format?: unknown; version?: unknown; collections?: unknown; drawings?: unknown };
type DrawingRow = { id: string; title: string; scene_json: string; collection_id: string | null; is_favorite: number; deleted_at: string | null };

export const GET: RequestHandler = async ({ platform, locals }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  try {
    const [collectionRows, drawingRows] = await Promise.all([
      locals.user?.id
        ? db.prepare('SELECT id, name FROM collections WHERE owner_id = ? ORDER BY name COLLATE NOCASE').bind(locals.user.id).all<{ id: string; name: string }>()
        : db.prepare('SELECT id, name FROM collections ORDER BY name COLLATE NOCASE').all<{ id: string; name: string }>(),
      locals.user?.id
        ? db.prepare('SELECT id, title, scene_json, collection_id, is_favorite, deleted_at FROM whiteboards WHERE owner_id = ? ORDER BY created_at').bind(locals.user.id).all<DrawingRow>()
        : db.prepare('SELECT id, title, scene_json, collection_id, is_favorite, deleted_at FROM whiteboards ORDER BY created_at').all<DrawingRow>()
    ]);
    const drawings = await Promise.all((drawingRows.results ?? []).map(async (row: DrawingRow) => ({
      id: row.id, title: row.title, collectionId: row.collection_id,
      isFavorite: Boolean(row.is_favorite), deleted: Boolean(row.deleted_at),
      scene: await readScene(row.scene_json, row.id, platform?.env)
    })));
    return json({ format: 'drawflare-backup', version: 1, exportedAt: new Date().toISOString(), collections: collectionRows.results ?? [], drawings }, {
      headers: { 'content-type': 'application/json; charset=utf-8', 'content-disposition': 'attachment; filename="drawflare-backup.json"', 'cache-control': 'no-store' }
    });
  } catch (error) {
    return json({ error: error instanceof Error ? error.message : 'Could not export workspace backup' }, { status: 500 });
  }
};

export const POST: RequestHandler = async ({ platform, request, locals }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  const contentLength = Number(request.headers.get('content-length') ?? 0);
  if (contentLength > 50 * 1024 * 1024) return json({ error: 'Backup file is too large (maximum 50 MB).' }, { status: 413 });
  const payload = await request.json().catch(() => null) as BackupPayload | null;
  if (!payload || payload.format !== 'drawflare-backup' || payload.version !== 1 || !Array.isArray(payload.collections) || !Array.isArray(payload.drawings)) {
    return json({ error: 'Invalid backup. Choose a DrawFlare workspace backup JSON file.' }, { status: 400 });
  }
  if (payload.collections.length > 500 || payload.drawings.length > 5000) return json({ error: 'Backup exceeds the import limit (500 collections, 5,000 drawings).' }, { status: 413 });
  for (const item of payload.collections as BackupCollection[]) {
    if (typeof item.name !== 'string' || !item.name.trim()) return json({ error: 'Backup contains a collection without a name.' }, { status: 400 });
  }
  for (const item of payload.drawings as BackupDrawing[]) {
    if (typeof item.title !== 'string' || !item.scene || typeof item.scene !== 'object' || Array.isArray(item.scene) || !Array.isArray((item.scene as Record<string, unknown>).elements)) {
      return json({ error: 'Backup contains a drawing with an invalid title or scene.' }, { status: 400 });
    }
  }
  const ownerId = await resolveOwnerId(db, locals.user);

  const collectionMap: Record<string, string> = {};
  const createdAssets: { id: string; stored: string; inR2: boolean }[] = [];
  let importedCollections = 0;
  let importedDrawings = 0;
  try {
    for (const item of payload.collections as BackupCollection[]) {
      const id = crypto.randomUUID();
      await db.prepare('INSERT INTO collections (id, name, owner_id) VALUES (?, ?, ?)').bind(id, (item.name as string).trim().slice(0, 80), ownerId).run();
      if (typeof item.id === 'string') collectionMap[item.id] = id;
      importedCollections += 1;
    }
    for (const item of payload.drawings as BackupDrawing[]) {
      const scene = item.scene as Record<string, unknown>;
      const id = crypto.randomUUID();
      const collectionId = typeof item.collectionId === 'string' ? collectionMap[item.collectionId] ?? null : null;
      const stored = await storeScene(scene, id, platform?.env);
      createdAssets.push({ id, stored: stored.stored, inR2: stored.inR2 });
      await db.prepare('INSERT INTO whiteboards (id, title, scene_json, collection_id, owner_id, is_favorite, deleted_at, revision) VALUES (?, ?, ?, ?, ?, ?, ?, 1)')
        .bind(id, (item.title as string).trim().slice(0, 160) || 'Untitled drawing', stored.stored, collectionId, ownerId,
          item.isFavorite === true ? 1 : 0, item.deleted === true ? new Date().toISOString() : null).run();
      importedDrawings += 1;
    }
    return json({ ok: true, importedCollections, importedDrawings }, { status: 201 });
  } catch (error) {
    for (const asset of createdAssets) if (asset.inR2) await removeSceneAsset(asset.stored, asset.id, platform?.env).catch(() => undefined);
    return json({ error: error instanceof Error ? error.message : 'Could not import workspace backup', importedCollections, importedDrawings }, { status: 500 });
  }
};
