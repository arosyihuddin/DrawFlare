import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword, verifyHashedPassword } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, platform, locals }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  if (!locals.user?.id || locals.user.legacy) return json({ error: 'Change password is available only for an individual account.' }, { status: 403 });
  const body = await request.json().catch(() => null) as { currentPassword?: unknown; newPassword?: unknown } | null;
  const currentPassword = typeof body?.currentPassword === 'string' ? body.currentPassword : '';
  const newPassword = typeof body?.newPassword === 'string' ? body.newPassword : '';
  if (newPassword.length < 8 || newPassword.length > 256) return json({ error: 'New password must be between 8 and 256 characters.' }, { status: 400 });
  const user = await db.prepare('SELECT password_hash FROM app_users WHERE id = ?').bind(locals.user.id).first<{ password_hash: string }>();
  if (!user || !(await verifyHashedPassword(currentPassword, user.password_hash))) return json({ error: 'Current password is incorrect.' }, { status: 401 });
  await db.prepare('UPDATE app_users SET password_hash = ?, must_reset_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .bind(await hashPassword(newPassword), locals.user.id).run();
  await db.prepare('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL').bind(locals.user.id).run();
  return json({ ok: true });
};
