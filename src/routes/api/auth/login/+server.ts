import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSession, isAuthConfigured, sessionCookie, verifyHashedPassword, verifyPassword } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
  const env = platform?.env;
  if (!isAuthConfigured(env)) return json({ error: 'Set AUTH_SECRET and either APP_PASSWORD or D1 user accounts to enable authentication.' }, { status: 503 });
  const body = await request.json().catch(() => null) as { email?: unknown; password?: unknown } | null;
  if (!body || typeof body.password !== 'string') return json({ error: 'Password is required.' }, { status: 400 });

  let identity: { id: string | null; email: string | null; name: string; role: 'ADMIN' | 'USER'; legacy: boolean } | undefined;
  let mustResetPassword = false;
  if (typeof body.email === 'string' && body.email.trim()) {
    const db = env?.DB;
    if (!db) return json({ error: 'User accounts are not enabled on this workspace.' }, { status: 503 });
    try {
      const user = await db.prepare('SELECT id, email, name, password_hash, role, is_active, must_reset_password FROM app_users WHERE email = ? COLLATE NOCASE')
        .bind(body.email.trim()).first<{ id: string; email: string; name: string; password_hash: string; role: 'ADMIN' | 'USER'; is_active: number; must_reset_password: number }>();
      if (!user || user.is_active !== 1 || !(await verifyHashedPassword(body.password, user.password_hash))) {
        return json({ error: 'Email or password is incorrect.' }, { status: 401 });
      }
      identity = { id: user.id, email: user.email, name: user.name, role: user.role, legacy: false };
      mustResetPassword = user.must_reset_password === 1;
    } catch {
      return json({ error: 'User account storage is not ready. Apply the latest D1 migrations.' }, { status: 503 });
    }
  } else {
    if (!verifyPassword(body.password, env)) return json({ error: 'Password is incorrect. Enter your email to sign in with an individual account.' }, { status: 401 });
  }

  cookies.set(sessionCookie.name, await createSession(env, identity), {
    path: '/', httpOnly: true, secure: new URL(request.url).protocol === 'https:',
    sameSite: 'lax', maxAge: sessionCookie.maxAge
  });
  return json({ ok: true, mustResetPassword, user: identity ? { id: identity.id, email: identity.email, name: identity.name, role: identity.role } : { name: 'Workspace', role: 'ADMIN' } });
};
