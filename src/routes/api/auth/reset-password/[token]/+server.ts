import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword } from '$lib/server/auth';

async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const POST: RequestHandler = async ({ params, request, platform }) => {
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  const body = await request.json().catch(() => null) as { password?: unknown } | null;
  const password = typeof body?.password === 'string' ? body.password : '';
  if (password.length < 8 || password.length > 256) return json({ error: 'Password must be between 8 and 256 characters.' }, { status: 400 });
  try {
    const tokenHash = await digest(params.token);
    const reset = await db.prepare('SELECT id, user_id FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > ?')
      .bind(tokenHash, new Date().toISOString()).first<{ id: string; user_id: string }>();
    if (!reset) return json({ error: 'This reset link is invalid or expired. Request a new one.' }, { status: 400 });
    const passwordHash = await hashPassword(password);
    await db.prepare('UPDATE app_users SET password_hash = ?, must_reset_password = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .bind(passwordHash, reset.user_id).run();
    await db.prepare('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL').bind(reset.user_id).run();
    return json({ ok: true });
  } catch {
    return json({ error: 'Could not reset password. Apply the latest D1 migrations.' }, { status: 500 });
  }
};
