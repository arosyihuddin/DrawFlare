import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { hashPassword } from '$lib/server/auth';

export const GET: RequestHandler = async ({ platform, locals }) => {
  if (locals.user?.role !== 'ADMIN') return json({ error: 'Administrator access required.' }, { status: 403 });
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  try {
    const result = await db.prepare('SELECT id, email, name, role, is_active, must_reset_password, created_at, updated_at FROM app_users ORDER BY created_at ASC').all();
    return json(result.results ?? []);
  } catch {
    return json({ error: 'User management requires the latest D1 migrations.' }, { status: 503 });
  }
};

export const POST: RequestHandler = async ({ platform, locals, request }) => {
  if (locals.user?.role !== 'ADMIN') return json({ error: 'Administrator access required.' }, { status: 403 });
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  const body = await request.json().catch(() => null) as { email?: unknown; name?: unknown; password?: unknown; role?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 80) : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const role = body?.role === 'ADMIN' ? 'ADMIN' : body?.role === 'USER' ? 'USER' : null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !name || !role) return json({ error: 'A valid email, name, and role are required.' }, { status: 400 });
  if (password.length < 8 || password.length > 256) return json({ error: 'Temporary password must be between 8 and 256 characters.' }, { status: 400 });
  try {
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO app_users (id, email, name, password_hash, role, must_reset_password) VALUES (?, ?, ?, ?, ?, 1)')
      .bind(id, email, name, await hashPassword(password), role).run();
    return json({ ok: true, user: { id, email, name, role, is_active: 1, must_reset_password: 1 } }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.message.toLowerCase().includes('unique')) return json({ error: 'An account with this email already exists.' }, { status: 409 });
    return json({ error: 'Could not create user. Apply the latest D1 migrations.' }, { status: 503 });
  }
};
