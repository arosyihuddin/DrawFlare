<script lang="ts">
  import { page } from '$app/state';
  const token = $derived(page.params.token ?? '');
  let password = $state('');
  let confirmPassword = $state('');
  let showPassword = $state(false);
  let error = $state('');
  let success = $state(false);
  let loading = $state(false);
  async function resetPassword() {
    error = '';
    if (password !== confirmPassword) { error = 'Passwords do not match.'; return; }
    loading = true;
    try {
      const response = await fetch('/api/auth/reset-password/' + encodeURIComponent(token), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
      const data = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(data.error || 'Could not reset password');
      success = true;
    } catch (e) { error = e instanceof Error ? e.message : 'Could not reset password'; }
    finally { loading = false; }
  }
</script>
<svelte:head><title>Choose a new password · DrawFlare</title></svelte:head>
<main><section class="card"><a href="/login" class="brand"><img src="/drawflare-logo.svg" alt="" /></a><p class="eyebrow">ACCOUNT RECOVERY</p><h1>Choose a new password</h1><p class="intro">Use a password with at least 8 characters. Reset links expire after 30 minutes.</p>
  {#if success}<p class="message success">Password updated. You can now sign in with your new password.</p><a class="submit" href="/login">Go to sign in <span>→</span></a>
  {:else}<form onsubmit={(event) => { event.preventDefault(); void resetPassword(); }}><label for="password">New password</label><div class="password-field"><input id="password" type={showPassword ? 'text' : 'password'} bind:value={password} minlength="8" maxlength="256" autocomplete="new-password" required /><button type="button" class="eye" onclick={() => showPassword = !showPassword}>{showPassword ? 'Hide' : 'Show'}</button></div><label for="confirm">Confirm new password</label><input id="confirm" type={showPassword ? 'text' : 'password'} bind:value={confirmPassword} minlength="8" maxlength="256" autocomplete="new-password" required />{#if error}<p class="message error" role="alert">{error}</p>{/if}<button class="submit" disabled={loading}>{loading ? 'Updating…' : 'Reset password'} <span>→</span></button></form>{/if}
  <p class="bottom"><a href="/login">Back to sign in</a></p>
</section></main>
<style>
  :global(body){margin:0;min-height:100%;background-color:#f3f4f6;background-image:radial-gradient(#cbd5e1 1px,transparent 1px);background-size:24px 24px;color:#1e293b;font-family:Inter,ui-sans-serif,system-ui,sans-serif}main{min-height:100dvh;display:grid;place-items:center;padding:24px}.card{box-sizing:border-box;width:min(100%,420px);padding:32px;border:2px solid #1e293b;border-radius:20px;background:white;box-shadow:5px 5px 0 #1e293b}.brand{display:grid;place-items:center;width:48px;height:48px;border:2px solid #1e293b;border-radius:14px;background:#eef2ff;box-shadow:2px 2px 0 #1e293b}.brand img{width:42px;height:42px;object-fit:contain}.eyebrow{margin:22px 0 8px;color:#6366f1;font-size:10px;font-weight:850;letter-spacing:.13em}h1{margin:0 0 8px;font:400 32px Excalifont,sans-serif}.intro{margin:0 0 22px;color:#64748b;font-size:13px;line-height:1.55}label{display:block;margin:13px 0 7px;font-size:12px;font-weight:800}input{box-sizing:border-box;width:100%;padding:10px;border:2px solid #e2e8f0;border-radius:10px;font:14px system-ui}.password-field{display:flex;gap:5px;padding:3px;border:2px solid #e2e8f0;border-radius:11px}.password-field input{border:0;outline:0}.eye{padding:0 9px;border:0;border-radius:7px;background:#f1f5f9;color:#475569;font-size:10px;font-weight:800}.submit{display:flex;justify-content:space-between;width:100%;box-sizing:border-box;margin-top:16px;padding:12px 14px;border:2px solid #1e293b;border-radius:11px;background:#4f46e5;color:white;font-size:13px;font-weight:800;text-decoration:none;box-shadow:2px 2px 0 #1e293b;cursor:pointer}.submit:disabled{opacity:.6}.message{padding:10px;border:1px solid;border-radius:9px;font-size:12px;line-height:1.5}.error{border-color:#fecdd3;background:#fff1f2;color:#9f1239}.success{border-color:#a7f3d0;background:#ecfdf5;color:#065f46}.bottom{margin:20px 0 0;text-align:center;font-size:12px}.bottom a{color:#4f46e5;font-weight:750;text-decoration:none}
</style>
