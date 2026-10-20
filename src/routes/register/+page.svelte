<script lang="ts">
  import { onMount } from 'svelte';
  type Modes = { userAccountsEnabled: boolean; registrationEnabled: boolean; initialSetup?: boolean };
  let modes = $state<Modes>({ userAccountsEnabled: false, registrationEnabled: false });
  let name = $state('');
  let email = $state('');
  let password = $state('');
  let confirmPassword = $state('');
  let showPassword = $state(false);
  let error = $state('');
  let loading = $state(false);
  onMount(async () => { try { const r = await fetch('/api/auth/modes'); if (r.ok) modes = { ...modes, ...await r.json() as Modes }; } catch { /* Show setup unavailable. */ } });
  async function register() {
    error = '';
    if (password !== confirmPassword) { error = 'Passwords do not match.'; return; }
    loading = true;
    try {
      const response = await fetch('/api/auth/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, email, password }) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not create account');
      location.href = '/';
    } catch (e) { error = e instanceof Error ? e.message : 'Could not create account'; }
    finally { loading = false; }
  }
</script>
<svelte:head><title>{modes.userAccountsEnabled ? 'Create account' : 'Authentication disabled'} · DrawFlare</title></svelte:head>
<main><section class="card"><a href="/login" class="brand"><img src="/drawflare-logo.svg" alt="" /></a><p class="eyebrow">{modes.initialSetup ? 'FIRST-TIME SETUP' : modes.userAccountsEnabled ? 'WORKSPACE ACCOUNT' : 'AUTHENTICATION'}</p><h1>{modes.initialSetup ? 'Create administrator' : modes.userAccountsEnabled ? 'Create your account' : 'Authentication is disabled'}</h1><p class="intro">{modes.initialSetup ? 'The first account becomes the workspace administrator.' : modes.userAccountsEnabled ? 'Register to access your personal drawing workspace.' : 'This workspace is running without authentication. Accounts are unavailable until AUTH_SECRET and D1 user accounts are configured.'}</p>
  {#if !modes.userAccountsEnabled}<p class="message error">Individual accounts are not configured. This page is informational while authentication is disabled.</p>
  {:else if !modes.initialSetup && !modes.registrationEnabled}<p class="message error">Self-registration is disabled. Ask an administrator to create your account.</p>
  {:else}
    <form onsubmit={(event) => { event.preventDefault(); void register(); }}>
      <label for="name">Display name</label><input id="name" bind:value={name} maxlength="80" autocomplete="name" required />
      <label for="email">Email address</label><input id="email" type="email" bind:value={email} autocomplete="email" required />
      <label for="password">Password</label><div class="password-field"><input id="password" type={showPassword ? 'text' : 'password'} bind:value={password} minlength="8" maxlength="256" autocomplete="new-password" required /><button type="button" class="eye" onclick={() => showPassword = !showPassword}>{showPassword ? 'Hide' : 'Show'}</button></div>
      <label for="confirm">Confirm password</label><input id="confirm" type={showPassword ? 'text' : 'password'} bind:value={confirmPassword} minlength="8" maxlength="256" autocomplete="new-password" required />
      {#if error}<p class="message error" role="alert">{error}</p>{/if}
      <button class="submit" disabled={loading}>{loading ? 'Creating account…' : 'Create account'} <span>→</span></button>
    </form>
  {/if}
  <p class="bottom"><a href="/login">Back to sign in</a></p>
</section></main>
<style>
  :global(body){margin:0;min-height:100%;background-color:#f3f4f6;background-image:radial-gradient(#cbd5e1 1px,transparent 1px);background-size:24px 24px;color:#1e293b;font-family:Inter,ui-sans-serif,system-ui,sans-serif}main{min-height:100dvh;display:grid;place-items:center;padding:24px}.card{box-sizing:border-box;width:min(100%,430px);padding:32px;border:2px solid #1e293b;border-radius:20px;background:white;box-shadow:5px 5px 0 #1e293b}.brand{display:grid;place-items:center;width:48px;height:48px;border:2px solid #1e293b;border-radius:14px;background:#eef2ff;box-shadow:2px 2px 0 #1e293b}.brand img{width:42px;height:42px;object-fit:contain}.eyebrow{margin:22px 0 8px;color:#6366f1;font-size:10px;font-weight:850;letter-spacing:.13em}h1{margin:0 0 8px;font:400 32px Excalifont,sans-serif}.intro{margin:0 0 20px;color:#64748b;font-size:13px;line-height:1.55}label{display:block;margin:13px 0 7px;font-size:12px;font-weight:800}input{box-sizing:border-box;width:100%;padding:10px;border:2px solid #e2e8f0;border-radius:10px;background:white;color:#1e293b;font:14px system-ui}.password-field{display:flex;gap:5px;padding:3px;border:2px solid #e2e8f0;border-radius:11px}.password-field input{border:0;outline:0}.eye{padding:0 9px;border:0;border-radius:7px;background:#f1f5f9;color:#475569;font-size:10px;font-weight:800}.submit{display:flex;justify-content:space-between;width:100%;margin-top:18px;padding:12px 14px;border:2px solid #1e293b;border-radius:11px;background:#4f46e5;color:white;font-size:13px;font-weight:800;box-shadow:2px 2px 0 #1e293b;cursor:pointer}.submit:disabled{opacity:.6}.message{padding:10px;border:1px solid;border-radius:9px;font-size:12px;line-height:1.5}.error{border-color:#fecdd3;background:#fff1f2;color:#9f1239}.bottom{margin:20px 0 0;text-align:center;font-size:12px}.bottom a{color:#4f46e5;font-weight:750;text-decoration:none}
</style>
