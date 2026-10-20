import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ platform }) => {
  const env = platform?.env;
  const db = env?.DB;
  if (!db) return json({ authEnabled: false, sharedPasswordEnabled: Boolean(env?.AUTH_SECRET && env?.APP_PASSWORD), userAccountsEnabled: false, registrationEnabled: false, userCount: 0, initialSetup: false });
  try {
    const [users, settings] = await Promise.all([
      db.prepare('SELECT COUNT(*) AS count FROM app_users').first<{ count: number }>(),
      db.prepare('SELECT registration_enabled FROM app_settings WHERE id = 1').first<{ registration_enabled: number }>()
    ]);
    return json({
      authEnabled: Boolean(env?.AUTH_SECRET && (env?.APP_PASSWORD || env?.DB)),
      sharedPasswordEnabled: Boolean(env?.AUTH_SECRET && env?.APP_PASSWORD),
      userAccountsEnabled: Boolean(env?.AUTH_SECRET),
      registrationEnabled: settings?.registration_enabled === 1 && Boolean(env?.AUTH_SECRET),
      userCount: users?.count ?? 0,
      initialSetup: Boolean(env?.AUTH_SECRET) && (users?.count ?? 0) === 0
    });
  } catch {
    return json({ authEnabled: Boolean(env?.APP_PASSWORD && env?.AUTH_SECRET), sharedPasswordEnabled: Boolean(env?.APP_PASSWORD), userAccountsEnabled: false, registrationEnabled: false, userCount: 0 });
  }
};
