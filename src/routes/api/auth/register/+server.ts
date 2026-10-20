import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { createSession, hashPassword, isAuthConfigured, sessionCookie } from '$lib/server/auth';

export const POST: RequestHandler = async ({ request, platform, cookies }) => {
  const env = platform?.env;
  const db = env?.DB;
  if (!db || !env?.AUTH_SECRET) return json({ error: 'User accounts require D1 and AUTH_SECRET to be configured.' }, { status: 503 });
  if (!isAuthConfigured(env)) return json({ error: 'Authentication is not configured.' }, { status: 503 });

  const body = await request.json().catch(() => null) as { email?: unknown; name?: unknown; password?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, { status: 400 });
  if (!name) return json({ error: 'Name is required.' }, { status: 400 });
  if (password.length < 8 || password.length > 256) return json({ error: 'Password must be between 8 and 256 characters.' }, { status: 400 });

  try {
    const existing = await db.prepare('SELECT COUNT(*) AS count FROM app_users').first<{ count: number }>();
    const isFirstUser = (existing?.count ?? 0) === 0;
    const settings = await db.prepare('SELECT registration_enabled FROM app_settings WHERE id = 1').first<{ registration_enabled: number }>();
    if (!isFirstUser && settings?.registration_enabled !== 1) return json({ error: 'Self-registration is disabled. Ask an administrator to create your account.' }, { status: 403 });

    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(password);
    const role = isFirstUser ? 'ADMIN' : 'USER';
    await db.prepare('INSERT INTO app_users (id, email, name, password_hash, role) VALUES (?, ?, ?, ?, ?)')
      .bind(id, email, name, passwordHash, role).run();

    if (isFirstUser) {
      await db.prepare('UPDATE whiteboards SET owner_id = ? WHERE owner_id IS NULL').bind(id).run();
      await db.prepare('UPDATE collections SET owner_id = ? WHERE owner_id IS NULL').bind(id).run();
    }

    const session = await createSession(env, { id, email, name, role, legacy: false });
    cookies.set(sessionCookie.name, session, {
      path: '/', httpOnly: true, secure: new URL(request.url).protocol === 'https:',
      sameSite: 'lax', maxAge: sessionCookie.maxAge
    });
    return json({ ok: true, user: { id, email, name, role } }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : '';
    if (message.toLowerCase().includes('unique')) return json({ error: 'An account with this email already exists.' }, { status: 409 });
    return json({ error: 'Could not create account. Apply the latest D1 migrations and try again.' }, { status: 500 });
  }
};
