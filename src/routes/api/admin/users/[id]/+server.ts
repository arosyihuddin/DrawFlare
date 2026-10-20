import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword } from '$lib/server/auth';

export const PATCH: RequestHandler = async ({ params, platform, locals, request }) => {
  if (locals.user?.role !== 'ADMIN') return json({ error: 'Administrator access required.' }, { status: 403 });
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  const body = await request.json().catch(() => null) as { name?: unknown; role?: unknown; isActive?: unknown; mustResetPassword?: unknown; password?: unknown } | null;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'Expected a JSON object.' }, { status: 400 });
  if (params.id === locals.user.id && ((body.role !== undefined && body.role !== 'ADMIN') || body.isActive === false)) {
    return json({ error: 'You cannot remove your own administrator access or deactivate your account.' }, { status: 400 });
  }
  const existing = await db.prepare('SELECT id, role, is_active FROM app_users WHERE id = ?').bind(params.id).first<{ id: string; role: string; is_active: number }>();
  if (!existing) return json({ error: 'User not found.' }, { status: 404 });
  if (existing.role === 'ADMIN' && body.role === 'USER') {
    const admins = await db.prepare("SELECT COUNT(*) AS count FROM app_users WHERE role = 'ADMIN' AND is_active = 1").first<{ count: number }>();
    if ((admins?.count ?? 0) <= 1) return json({ error: 'The workspace must keep at least one active administrator.' }, { status: 400 });
  }
  if (existing.role === 'ADMIN' && existing.is_active === 1 && body.isActive === false) {
    const admins = await db.prepare("SELECT COUNT(*) AS count FROM app_users WHERE role = 'ADMIN' AND is_active = 1").first<{ count: number }>();
    if ((admins?.count ?? 0) <= 1) return json({ error: 'The workspace must keep at least one active administrator.' }, { status: 400 });
  }
  const updates: string[] = [];
  const values: (string | number)[] = [];
  if (body.name !== undefined) {
    if (typeof body.name !== 'string' || !body.name.trim()) return json({ error: 'Name cannot be empty.' }, { status: 400 });
    updates.push('name = ?'); values.push(body.name.trim().slice(0, 80));
  }
  if (body.role !== undefined) {
    if (body.role !== 'ADMIN' && body.role !== 'USER') return json({ error: 'Role must be ADMIN or USER.' }, { status: 400 });
    updates.push('role = ?'); values.push(body.role);
  }
  if (body.isActive !== undefined) {
    if (typeof body.isActive !== 'boolean') return json({ error: 'isActive must be a boolean.' }, { status: 400 });
    updates.push('is_active = ?'); values.push(body.isActive ? 1 : 0);
  }
  if (body.mustResetPassword !== undefined) {
    if (typeof body.mustResetPassword !== 'boolean') return json({ error: 'mustResetPassword must be a boolean.' }, { status: 400 });
    updates.push('must_reset_password = ?'); values.push(body.mustResetPassword ? 1 : 0);
  }
  if (body.password !== undefined) {
    if (typeof body.password !== 'string' || body.password.length < 8 || body.password.length > 256) return json({ error: 'Temporary password must be between 8 and 256 characters.' }, { status: 400 });
    updates.push('password_hash = ?'); values.push(await hashPassword(body.password));
    updates.push('must_reset_password = 1'); 
  }
  if (!updates.length) return json({ error: 'No supported user fields were provided.' }, { status: 400 });
  updates.push('updated_at = CURRENT_TIMESTAMP');
  try {
    await db.prepare('UPDATE app_users SET ' + updates.join(', ') + ' WHERE id = ?').bind(...values, params.id).run();
    return json({ ok: true });
  } catch {
    return json({ error: 'Could not update user.' }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ params, platform, locals }) => {
  if (locals.user?.role !== 'ADMIN') return json({ error: 'Administrator access required.' }, { status: 403 });
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  if (params.id === locals.user.id) return json({ error: 'You cannot delete your own account.' }, { status: 400 });
  const user = await db.prepare('SELECT id, role FROM app_users WHERE id = ?').bind(params.id).first<{ id: string; role: string }>();
  if (!user) return json({ error: 'User not found.' }, { status: 404 });
  if (user.role === 'ADMIN') {
    const admins = await db.prepare("SELECT COUNT(*) AS count FROM app_users WHERE role = 'ADMIN' AND is_active = 1").first<{ count: number }>();
    if ((admins?.count ?? 0) <= 1) return json({ error: 'The workspace must keep at least one active administrator.' }, { status: 400 });
  }
  try {
    await db.prepare('UPDATE whiteboards SET owner_id = ? WHERE owner_id = ?').bind(locals.user.id, params.id).run();
    await db.prepare('UPDATE collections SET owner_id = ? WHERE owner_id = ?').bind(locals.user.id, params.id).run();
    await db.prepare('DELETE FROM app_users WHERE id = ?').bind(params.id).run();
    return json({ ok: true });
  } catch {
    return json({ error: 'Could not delete user.' }, { status: 500 });
  }
};
