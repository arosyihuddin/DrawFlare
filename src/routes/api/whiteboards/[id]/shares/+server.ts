import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

function makeToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function ownedBoard(db: NonNullable<App.Platform['env']['DB']>, id: string, ownerId?: string | null) {
  return ownerId
    ? db.prepare('SELECT id FROM whiteboards WHERE id = ? AND owner_id = ?').bind(id, ownerId).first()
    : db.prepare('SELECT id FROM whiteboards WHERE id = ?').bind(id).first();
}

export const GET: RequestHandler = async ({ params, platform, locals }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  if (!await ownedBoard(db, params.id, locals.user?.id)) return json({ error: 'Drawing not found' }, { status: 404 });
  const result = await db.prepare('SELECT token, permission, expires_at, created_at FROM share_links WHERE whiteboard_id = ? ORDER BY created_at DESC').bind(params.id).all();
  return json(result.results ?? []);
};

export const POST: RequestHandler = async ({ params, platform, request, locals }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  if (!await ownedBoard(db, params.id, locals.user?.id)) return json({ error: 'Drawing not found' }, { status: 404 });
  const body = await request.json().catch(() => null) as { permission?: unknown; expiresInDays?: unknown } | null;
  const permission = body?.permission === 'edit' ? 'edit' : body?.permission === 'view' ? 'view' : null;
  if (!permission) return json({ error: 'permission must be view or edit' }, { status: 400 });
  const days = body?.expiresInDays === undefined ? null : Number(body.expiresInDays);
  if (days !== null && (!Number.isInteger(days) || days < 1 || days > 365)) return json({ error: 'expiresInDays must be between 1 and 365' }, { status: 400 });
  const token = makeToken();
  const expiresAt = days === null ? null : new Date(Date.now() + days * 86400000).toISOString();
  await db.prepare('INSERT INTO share_links (token, whiteboard_id, permission, expires_at) VALUES (?, ?, ?, ?)').bind(token, params.id, permission, expiresAt).run();
  return json({ token, permission, expires_at: expiresAt, url: new URL('/share/' + token, request.url).toString() }, { status: 201 });
};

export const DELETE: RequestHandler = async ({ params, platform, request, locals }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  if (!await ownedBoard(db, params.id, locals.user?.id)) return json({ error: 'Drawing not found' }, { status: 404 });
  const body = await request.json().catch(() => null) as { token?: unknown } | null;
  if (typeof body?.token !== 'string' || !body.token) return json({ error: 'token is required' }, { status: 400 });
  const result = await db.prepare('DELETE FROM share_links WHERE whiteboard_id = ? AND token = ?').bind(params.id, body.token).run();
  if (!result.meta.changes) return json({ error: 'Share link not found' }, { status: 404 });
  return json({ ok: true });
};
