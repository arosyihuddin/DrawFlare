import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

async function digest(value: string) {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function token() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export const POST: RequestHandler = async ({ request, platform }) => {
  const db = platform?.env?.DB;
  const env = platform?.env;
  if (!db || !env?.RESEND_API_KEY || !env.RESEND_FROM_EMAIL) {
    return json({ error: 'Password reset email is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL on the Worker.' }, { status: 503 });
  }
  const body = await request.json().catch(() => null) as { email?: unknown } | null;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return json({ error: 'Enter a valid email address.' }, { status: 400 });
  try {
    const user = await db.prepare('SELECT id, email, name, is_active FROM app_users WHERE email = ? COLLATE NOCASE').bind(email)
      .first<{ id: string; email: string; name: string; is_active: number }>();
    if (user && user.is_active === 1) {
      const rawToken = token();
      const tokenHash = await digest(rawToken);
      const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
      await db.prepare('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL').bind(user.id).run();
      await db.prepare('INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
        .bind(crypto.randomUUID(), user.id, tokenHash, expiresAt).run();
      const resetUrl = new URL('/reset-password/' + rawToken, request.url).toString();
      const sent = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
        body: JSON.stringify({
          from: env.RESEND_FROM_EMAIL,
          to: [user.email],
          subject: 'Reset your DrawFlare password',
          html: '<p>Hello ' + user.name.replace(/[&<>"]/g, '') + ',</p><p>Use the link below to reset your DrawFlare password. It expires in 30 minutes.</p><p><a href="' + resetUrl + '">Reset password</a></p><p>If you did not request this, you can ignore this email.</p>'
        })
      });
      if (!sent.ok) {
        await db.prepare('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE token_hash = ?').bind(tokenHash).run();
        return json({ error: 'Could not send reset email. Check the Resend configuration.' }, { status: 502 });
      }
    }
    return json({ ok: true, message: 'If an active account exists for that email, a reset link has been sent.' });
  } catch {
    return json({ error: 'Password reset is not ready. Apply the latest D1 migrations.' }, { status: 503 });
  }
};
