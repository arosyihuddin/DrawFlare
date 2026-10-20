<script lang="ts">
  import { onMount } from 'svelte';
  import { page } from '$app/state';
  type AuthModes = { sharedPasswordEnabled: boolean; userAccountsEnabled: boolean; registrationEnabled: boolean; userCount: number; initialSetup?: boolean };
  let email = $state('');
  let password = $state('');
  let showPassword = $state(false);
  let error = $state('');
  let loading = $state(false);
  let modes = $state<AuthModes>({ sharedPasswordEnabled: true, userAccountsEnabled: false, registrationEnabled: false, userCount: 0 });
  onMount(async () => {
    try { const response = await fetch('/api/auth/modes'); if (response.ok) modes = { ...modes, ...await response.json() as AuthModes }; } catch { /* Keep shared-password fallback. */ }
  });
  async function login() {
    loading = true; error = '';
    try {
      const payload: { password: string; email?: string } = { password };
      if (email.trim()) payload.email = email.trim();
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await response.json().catch(() => ({})) as { error?: string; mustResetPassword?: boolean };
      if (!response.ok) throw new Error(data.error || 'Login failed. Check server configuration.');
      if (data.mustResetPassword) { location.href = '/profile?forcePassword=1'; return; }
      const next = page.url.searchParams.get('next') || '/';
      location.href = next.startsWith('/') && !next.startsWith('//') ? next : '/';
    } catch (e) { error = e instanceof Error ? e.message : 'Login failed'; }
    finally { loading = false; }
  }
</script>
<svelte:head><title>Sign in · DrawFlare</title><meta name="description" content="Sign in to your DrawFlare workspace." /></svelte:head>
<main>
  <div class="login-card">
    <a href="/" class="brand" aria-label="DrawFlare"><img src="/drawflare-logo.svg" alt="" /></a>
    <p class="eyebrow">YOUR DRAWING WORKSPACE</p>
    <h1>Welcome back</h1>
    <p class="description">Sign in to pick up where your ideas left off.</p>
    <form onsubmit={(event) => { event.preventDefault(); void login(); }}>
      {#if modes.userAccountsEnabled}<label for="email">Email address</label><input class="email" id="email" type="email" bind:value={email} autocomplete="username" placeholder="you@example.com" />{/if}
      <label for="password">{email.trim() ? 'Account password' : 'Password'}</label>
      <div class="password-field"><input id="password" type={showPassword ? 'text' : 'password'} bind:value={password} autocomplete="current-password" required /><button type="button" class="eye" aria-label={showPassword ? 'Hide password' : 'Show password'} onclick={() => showPassword = !showPassword}>{showPassword ? 'Hide' : 'Show'}</button></div>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <button class="submit" type="submit" disabled={loading || !password}>{loading ? 'Signing in…' : 'Sign in'} <span aria-hidden="true">→</span></button>
    </form>
    <div class="links">
      {#if modes.userAccountsEnabled && (modes.initialSetup || modes.registrationEnabled)}<a href="/register">{modes.initialSetup ? 'Set up the first administrator account' : 'Create an account'}</a>{/if}
      {#if modes.userAccountsEnabled}<a href="/forgot-password">Forgot your password?</a>{/if}
    </div>
    {#if modes.sharedPasswordEnabled && !modes.userAccountsEnabled}<p class="footnote">This workspace uses a shared password managed by its administrator.</p>{:else if modes.sharedPasswordEnabled}<p class="footnote">You can sign in with an individual account or use the legacy workspace password.</p>{/if}
  </div>
</main>
<style>
  :global(body){margin:0;min-height:100%;background-color:#f3f4f6;background-image:radial-gradient(#cbd5e1 1px,transparent 1px);background-size:24px 24px;color:#1e293b;font-family:Inter,ui-sans-serif,system-ui,sans-serif}
  main{min-height:100dvh;display:grid;place-items:center;padding:24px;box-sizing:border-box}
  .login-card{box-sizing:border-box;width:min(100%,410px);padding:34px;border:2px solid #1e293b;border-radius:20px;background:#fff;box-shadow:5px 5px 0 #1e293b}
  .brand{display:grid;place-items:center;width:48px;height:48px;border:2px solid #1e293b;border-radius:14px;background:#eef2ff;box-shadow:2px 2px 0 #1e293b}.brand img{width:42px;height:42px;object-fit:contain}
  .eyebrow{margin:24px 0 8px;color:#6366f1;font-size:10px;font-weight:850;letter-spacing:.13em}
  h1{margin:0 0 8px;color:#0f172a;font:400 35px 'Excalifont',sans-serif}
  .description{margin:0 0 26px;color:#64748b;font-size:13px;line-height:1.55}
  label{display:block;margin:14px 0 8px;color:#334155;font-size:12px;font-weight:800}
  .email{box-sizing:border-box;width:100%;padding:11px;border:2px solid #e2e8f0;border-radius:11px;background:white;color:#1e293b;font:14px system-ui}
  .password-field{display:flex;gap:5px;padding:4px;border:2px solid #e2e8f0;border-radius:11px;background:#fff}.password-field:focus-within{border-color:#6366f1;box-shadow:0 0 0 3px #6366f126}
  .password-field input{box-sizing:border-box;width:100%;min-width:0;padding:8px;border:0;background:transparent;color:#1e293b;font:14px system-ui;outline:none}
  .eye{padding:0 8px;border:0;border-radius:7px;background:#f1f5f9;color:#475569;font:750 10px system-ui;cursor:pointer}
  .submit{display:flex;align-items:center;justify-content:space-between;width:100%;margin-top:16px;padding:12px 14px;border:2px solid #1e293b;border-radius:11px;background:#4f46e5;color:#fff;font:800 13px system-ui;cursor:pointer;box-shadow:2px 2px 0 #1e293b}.submit:hover:not(:disabled){background:#6366f1;transform:translateY(-1px)}.submit:disabled{opacity:.6;cursor:wait}
  .error{margin:10px 0 0;color:#be123c;font-size:12px}.footnote{margin:22px 0 0;padding-top:15px;border-top:1px solid #e2e8f0;color:#94a3b8;font-size:11px;line-height:1.5}
  .links{display:grid;gap:10px;margin-top:16px}.links a{color:#4f46e5;font-size:12px;font-weight:750;text-decoration:none}.links a:hover{text-decoration:underline}
  @media(max-width:480px){.login-card{padding:26px}.login-card h1{font-size:31px}}
</style>
