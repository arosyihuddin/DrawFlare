<script lang="ts">
  let email = $state('');
  let error = $state('');
  let message = $state('');
  let loading = $state(false);
  async function requestReset() {
    loading = true; error = ''; message = '';
    try {
      const response = await fetch('/api/auth/forgot-password', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) });
      const data = await response.json().catch(() => ({})) as { error?: string; message?: string };
      if (!response.ok) throw new Error(data.error || 'Could not request password reset');
      message = data.message || 'If an active account exists for that email, a reset link has been sent.';
    } catch (e) { error = e instanceof Error ? e.message : 'Could not request password reset'; }
    finally { loading = false; }
  }
</script>
<svelte:head><title>Reset password · DrawFlare</title></svelte:head>
<main><section class="card"><a href="/login" class="brand"><img src="/drawflare-logo.svg" alt="" /></a><p class="eyebrow">ACCOUNT RECOVERY</p><h1>Forgot your password?</h1><p class="intro">Enter your account email and we’ll send a secure reset link if an active account matches.</p><form onsubmit={(event) => { event.preventDefault(); void requestReset(); }}><label for="email">Email address</label><input id="email" type="email" bind:value={email} autocomplete="email" required />{#if error}<p class="message error" role="alert">{error}</p>{/if}{#if message}<p class="message success" role="status">{message}</p>{/if}<button class="submit" disabled={loading}>{loading ? 'Sending…' : 'Send reset link'} <span>→</span></button></form><p class="bottom"><a href="/login">Back to sign in</a></p></section></main>
<style>
  :global(body){margin:0;min-height:100%;background-color:#f3f4f6;background-image:radial-gradient(#cbd5e1 1px,transparent 1px);background-size:24px 24px;color:#1e293b;font-family:Inter,ui-sans-serif,system-ui,sans-serif}main{min-height:100dvh;display:grid;place-items:center;padding:24px}.card{box-sizing:border-box;width:min(100%,420px);padding:32px;border:2px solid #1e293b;border-radius:20px;background:white;box-shadow:5px 5px 0 #1e293b}.brand{display:grid;place-items:center;width:48px;height:48px;border:2px solid #1e293b;border-radius:14px;background:#eef2ff;box-shadow:2px 2px 0 #1e293b}.brand img{width:42px;height:42px;object-fit:contain}.eyebrow{margin:22px 0 8px;color:#6366f1;font-size:10px;font-weight:850;letter-spacing:.13em}h1{margin:0 0 8px;font:400 32px Excalifont,sans-serif}.intro{margin:0 0 22px;color:#64748b;font-size:13px;line-height:1.55}label{display:block;margin:13px 0 7px;font-size:12px;font-weight:800}input{box-sizing:border-box;width:100%;padding:11px;border:2px solid #e2e8f0;border-radius:10px;font:14px system-ui}.submit{display:flex;justify-content:space-between;width:100%;margin-top:16px;padding:12px 14px;border:2px solid #1e293b;border-radius:11px;background:#4f46e5;color:white;font-size:13px;font-weight:800;box-shadow:2px 2px 0 #1e293b;cursor:pointer}.submit:disabled{opacity:.6}.message{padding:10px;border:1px solid;border-radius:9px;font-size:12px;line-height:1.5}.error{border-color:#fecdd3;background:#fff1f2;color:#9f1239}.success{border-color:#a7f3d0;background:#ecfdf5;color:#065f46}.bottom{margin:20px 0 0;text-align:center;font-size:12px}.bottom a{color:#4f46e5;font-weight:750;text-decoration:none}
</style>
