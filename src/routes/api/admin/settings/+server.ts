import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform, locals }) => {
  if (locals.user?.role !== 'ADMIN') return json({ error: 'Administrator access required.' }, { status: 403 });
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  try {
    const [settings, users] = await Promise.all([
      db.prepare('SELECT registration_enabled FROM app_settings WHERE id = 1').first<{ registration_enabled: number }>(),
      db.prepare('SELECT COUNT(*) AS count FROM app_users').first<{ count: number }>()
    ]);
    return json({ registrationEnabled: settings?.registration_enabled === 1, userCount: users?.count ?? 0 });
  } catch {
    return json({ error: 'Administration settings require the latest D1 migrations.' }, { status: 503 });
  }
};

export const PATCH: RequestHandler = async ({ platform, locals, request }) => {
  if (locals.user?.role !== 'ADMIN') return json({ error: 'Administrator access required.' }, { status: 403 });
  const db = platform?.env?.DB;
  if (!db) return json({ error: 'D1 binding DB is not configured' }, { status: 503 });
  const body = await request.json().catch(() => null) as { registrationEnabled?: unknown } | null;
  if (typeof body?.registrationEnabled !== 'boolean') return json({ error: 'registrationEnabled must be a boolean.' }, { status: 400 });
  try {
    await db.prepare('UPDATE app_settings SET registration_enabled = ? WHERE id = 1').bind(body.registrationEnabled ? 1 : 0).run();
    return json({ ok: true, registrationEnabled: body.registrationEnabled });
  } catch {
    return json({ error: 'Could not save administration settings. Apply the latest D1 migrations.' }, { status: 503 });
  }
};
