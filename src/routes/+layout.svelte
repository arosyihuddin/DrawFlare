<script lang="ts">
  import '@excalidraw/excalidraw/index.css';
  import { onMount } from 'svelte';
  let { children } = $props();
  type ConfirmRequest = { message: string; title: string; confirmLabel: string; destructive: boolean; resolve: (value: boolean) => void };
  type PromptRequest = { message: string; title: string; confirmLabel: string; defaultValue: string; placeholder: string; inputType: 'text' | 'password'; minLength: number; resolve: (value: string | null) => void };
  let confirmRequest = $state<ConfirmRequest | null>(null);
  let promptRequest = $state<PromptRequest | null>(null);
  let promptValue = $state('');
  let promptError = $state('');
  function handleConfirm(event: Event) { confirmRequest = (event as CustomEvent<ConfirmRequest>).detail; }
  function handlePrompt(event: Event) { promptRequest = (event as CustomEvent<PromptRequest>).detail; promptValue = promptRequest.defaultValue; promptError = ''; }
  function finishConfirm(result: boolean) { const request = confirmRequest; confirmRequest = null; request?.resolve(result); }
  function finishPrompt(submit: boolean) {
    const request = promptRequest;
    if (!request) return;
    if (submit && promptValue.length < request.minLength) { promptError = `Enter at least ${request.minLength} characters.`; return; }
    promptRequest = null;
    promptError = '';
    request.resolve(submit ? promptValue : null);
  }
  onMount(() => {
    window.addEventListener('drawflare:confirm', handleConfirm);
    window.addEventListener('drawflare:prompt', handlePrompt);
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const syncSystemTheme = () => {
      try {
        const raw = localStorage.getItem('excali_preferences');
        const preferences = raw ? JSON.parse(raw) as { uiTheme?: string } : {};
        if (preferences.uiTheme === 'system') {
          const dark = media.matches;
          document.documentElement.dataset.theme = dark ? 'dark' : 'light';
          document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0a0a0a' : '#f8fafc');
        }
      } catch { /* Theme preference is optional. */ }
    };
    media.addEventListener('change', syncSystemTheme);
    const cleanup = () => { window.removeEventListener('drawflare:confirm', handleConfirm); window.removeEventListener('drawflare:prompt', handlePrompt); media.removeEventListener('change', syncSystemTheme); };
    try {
      const raw = localStorage.getItem('excali_preferences');
      const preferences = raw ? JSON.parse(raw) as { uiTheme?: string } : {};
      const dark = preferences.uiTheme === 'dark' || (preferences.uiTheme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
      document.querySelector('meta[name=theme-color]')?.setAttribute('content', dark ? '#0a0a0a' : '#f8fafc');
    } catch { document.documentElement.dataset.theme = 'light'; }
    return cleanup;
  });
</script>

<svelte:head>
  <meta name="description" content="DrawFlare drawing workspace hosted on Cloudflare Workers." />
  <meta name="theme-color" content="#f8fafc" />
</svelte:head>

{@render children?.()}

{#if confirmRequest}
  <div class="confirm-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) finishConfirm(false); }}>
    <div class="confirm-dialog" role="alertdialog" tabindex="-1" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-message">
      <div class="confirm-icon" aria-hidden="true">{confirmRequest.destructive ? '!' : '?'}</div>
      <h2 id="confirm-title">{confirmRequest.title}</h2>
      <p id="confirm-message">{confirmRequest.message}</p>
      <div class="confirm-actions"><button class="confirm-cancel" onclick={() => finishConfirm(false)}>Cancel</button><button class:danger={confirmRequest.destructive} class="confirm-accept" onclick={() => finishConfirm(true)}>{confirmRequest.confirmLabel}</button></div>
    </div>
  </div>
{/if}
{#if promptRequest}
  <div class="confirm-backdrop" role="presentation" onclick={(event) => { if (event.target === event.currentTarget) finishPrompt(false); }}>
    <div class="confirm-dialog prompt-dialog" role="dialog" aria-modal="true" aria-labelledby="prompt-title" aria-describedby="prompt-message">
      <div class="confirm-icon" aria-hidden="true">✎</div>
      <h2 id="prompt-title">{promptRequest.title}</h2>
      <p id="prompt-message">{promptRequest.message}</p>
      <form class="prompt-form" onsubmit={(event) => { event.preventDefault(); finishPrompt(true); }}>
        <input class="prompt-input" type={promptRequest.inputType} bind:value={promptValue} placeholder={promptRequest.placeholder} aria-describedby={promptError ? 'prompt-error' : undefined} onfocus={(event) => { if (promptRequest?.title.startsWith('Copy ')) (event.currentTarget as HTMLInputElement).select(); }} />
        {#if promptError}<p id="prompt-error" class="prompt-error" role="alert">{promptError}</p>{/if}
        <div class="confirm-actions"><button type="button" class="confirm-cancel" onclick={() => finishPrompt(false)}>Cancel</button><button type="submit" class="confirm-accept">{promptRequest.confirmLabel}</button></div>
      </form>
    </div>
  </div>
{/if}
<style>
  @font-face {
    font-family: 'Excalifont';
    src: url('/fonts/Excalifont-Regular.woff2') format('woff2');
    font-style: normal;
    font-weight: 400;
    font-display: swap;
  }
  :global(*) { box-sizing: border-box; }
  :global(html), :global(body) { margin: 0; min-height: 100%; background: #f3f4f6; color: #1e293b; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
  .confirm-backdrop { position: fixed; z-index: 1000; inset: 0; display: grid; place-items: center; padding: 20px; background: #02061780; backdrop-filter: blur(4px); }
  .confirm-dialog { width: min(420px, 100%); padding: 24px; border: 1px solid #dbe1ea; border-radius: 18px; background: #fff; color: #1e293b; box-shadow: 0 24px 80px #02061740; }
  .confirm-icon { display: grid; place-items: center; width: 38px; height: 38px; border-radius: 12px; background: #eef2ff; color: #4f46e5; font-weight: 900; }
  .confirm-dialog h2 { margin: 16px 0 8px; font-size: 19px; }
  .confirm-dialog p { margin: 0; color: #64748b; font-size: 14px; line-height: 1.6; overflow-wrap: anywhere; }
  .confirm-actions { display: flex; justify-content: flex-end; gap: 9px; margin-top: 24px; }
  .confirm-actions button { padding: 10px 13px; border: 1px solid #cbd5e1; border-radius: 10px; font: 700 12px system-ui; cursor: pointer; }
  .confirm-cancel { background: #fff; color: #334155; } .confirm-accept { background: #4f46e5; color: white; border-color: #4f46e5 !important; } .confirm-accept.danger { background: #be123c; border-color: #be123c !important; }
  /* Dark palette follows frontend/src/index.css in the upstream DrawFlare repository. */
  :global(html[data-theme="dark"]), :global(html[data-theme="dark"] body) { color-scheme: dark; background: #0a0a0a !important; color: #fafafa; }
  :global(html[data-theme="dark"] body) { background-image: radial-gradient(#262626 1px, transparent 1px); background-size: 24px 24px; }
  :global(html[data-theme="dark"] .library-page), :global(html[data-theme="dark"] .settings-page), :global(html[data-theme="dark"] .profile-page), :global(html[data-theme="dark"] .admin-page), :global(html[data-theme="dark"] main.auth-page), :global(html[data-theme="dark"] main:not(.editor):not(.shared-workspace)) { background-color: #0a0a0a !important; background-image: radial-gradient(#262626 1px, transparent 1px) !important; }
  :global(html[data-theme="dark"] .library-page) { --ink: #e5e5e5; --muted: #a3a3a3; --accent: #6366f1; }
  :global(html[data-theme="dark"] .sidebar), :global(html[data-theme="dark"] .settings-card), :global(html[data-theme="dark"] .panel), :global(html[data-theme="dark"] .notice), :global(html[data-theme="dark"] .profile-card), :global(html[data-theme="dark"] .board-row), :global(html[data-theme="dark"] .board-card), :global(html[data-theme="dark"] .dialog), :global(html[data-theme="dark"] .account-menu), :global(html[data-theme="dark"] .board-menu-panel), :global(html[data-theme="dark"] .bulk-move-menu), :global(html[data-theme="dark"] .collection-menu > div), :global(html[data-theme="dark"] .topbar), :global(html[data-theme="dark"] .drawing-list), :global(html[data-theme="dark"] .login-card), :global(html[data-theme="dark"] .card), :global(html[data-theme="dark"] .confirm-dialog), :global(html[data-theme="dark"] .history-panel), :global(html[data-theme="dark"] .history-item), :global(html[data-theme="dark"] .modal), :global(html[data-theme="dark"] .share-dialog), :global(html[data-theme="dark"] .collection-dialog), :global(html[data-theme="dark"] .token-reveal), :global(html[data-theme="dark"] .key-row), :global(html[data-theme="dark"] .ui-card) { background-color: #171717 !important; color: #fafafa !important; border-color: #404040 !important; box-shadow: 3px 3px 0 rgb(255 255 255 / 0.08) !important; }
  :global(html[data-theme="dark"] .stats article), :global(html[data-theme="dark"] .create-form), :global(html[data-theme="dark"] .user-row), :global(html[data-theme="dark"] .status-row), :global(html[data-theme="dark"] .share-form), :global(html[data-theme="dark"] .share-item), :global(html[data-theme="dark"] .state-panel), :global(html[data-theme="dark"] .search-wrap kbd), :global(html[data-theme="dark"] .key-form), :global(html[data-theme="dark"] .notice code), :global(html[data-theme="dark"] .hint code), :global(html[data-theme="dark"] .revoked), :global(html[data-theme="dark"] .pill), :global(html[data-theme="dark"] .ui-card-soft), :global(html[data-theme="dark"] .advanced-content), :global(html[data-theme="dark"] .info-row) { background-color: #262626 !important; color: #d4d4d4 !important; border-color: #404040 !important; }
  :global(html[data-theme="dark"] h1), :global(html[data-theme="dark"] h2), :global(html[data-theme="dark"] h3), :global(html[data-theme="dark"] h4), :global(html[data-theme="dark"] strong), :global(html[data-theme="dark"] .brand-name), :global(html[data-theme="dark"] .content h1) { color: #fafafa !important; }
  :global(html[data-theme="dark"] p), :global(html[data-theme="dark"] small), :global(html[data-theme="dark"] label), :global(html[data-theme="dark"] .intro), :global(html[data-theme="dark"] .description), :global(html[data-theme="dark"] .panel-intro), :global(html[data-theme="dark"] .card-heading p), :global(html[data-theme="dark"] .muted-message), :global(html[data-theme="dark"] .footnote), :global(html[data-theme="dark"] .hint) { color: #a3a3a3; }
  :global(html[data-theme="dark"] input:not([type="checkbox"]):not([type="radio"]):not([type="color"])), :global(html[data-theme="dark"] select), :global(html[data-theme="dark"] textarea), :global(html[data-theme="dark"] option), :global(html[data-theme="dark"] optgroup) { background-color: #262626 !important; color: #fafafa !important; border-color: #404040 !important; color-scheme: dark; }
  :global(html[data-theme="dark"] input::placeholder), :global(html[data-theme="dark"] textarea::placeholder) { color: #737373 !important; }
  :global(html[data-theme="dark"] .nav-item), :global(html[data-theme="dark"] .account-trigger), :global(html[data-theme="dark"] .board-info strong), :global(html[data-theme="dark"] .account-menu a), :global(html[data-theme="dark"] .account-menu button), :global(html[data-theme="dark"] .board-menu-panel button), :global(html[data-theme="dark"] .collection-menu button), :global(html[data-theme="dark"] .bulk-move-menu button) { color: #d4d4d4 !important; }
  :global(html[data-theme="dark"] .drawing-item.active) { background-color: rgb(79 70 229 / 0.2) !important; color: #c7d2fe !important; border-color: #525252 !important; }
  :global(html[data-theme="dark"] .nav-item:hover), :global(html[data-theme="dark"] .account-trigger:hover), :global(html[data-theme="dark"] .account-menu a:hover), :global(html[data-theme="dark"] .account-menu button:hover), :global(html[data-theme="dark"] .board-menu-panel button:hover), :global(html[data-theme="dark"] .collection-menu button:hover), :global(html[data-theme="dark"] .bulk-move-menu button:hover), :global(html[data-theme="dark"] .drawing-item:hover) { background-color: #262626 !important; color: #a5b4fc !important; }
  :global(html[data-theme="dark"] .menu-backdrop), :global(html[data-theme="dark"] .bulk-menu-backdrop) { background: transparent !important; border: 0 !important; box-shadow: none !important; backdrop-filter: none !important; filter: none !important; opacity: 1 !important; }
  :global(html[data-theme="dark"] .account-menu), :global(html[data-theme="dark"] .board-menu-panel), :global(html[data-theme="dark"] .bulk-move-menu), :global(html[data-theme="dark"] .collection-menu > div), :global(html[data-theme="dark"] [role="menu"]), :global(html[data-theme="dark"] .dropdown-menu), :global(html[data-theme="dark"] .context-menu), :global(html[data-theme="dark"] .popover), :global(html[data-theme="dark"] .ui-menu), :global(html[data-theme="dark"] .ui-popover) { background: #171717 !important; color: #fafafa !important; border-color: #404040 !important; box-shadow: none !important; backdrop-filter: none !important; filter: none !important; }
  :global(html[data-theme="dark"] .board-menu summary), :global(html[data-theme="dark"] .collection-menu summary) { background-color: #262626 !important; color: #d4d4d4 !important; border-color: #404040 !important; }
  :global(html[data-theme="dark"] .board-menu-panel button:not(:hover):not(:focus-visible)), :global(html[data-theme="dark"] .collection-menu button:not(:hover):not(:focus-visible)), :global(html[data-theme="dark"] .bulk-move-menu button:not(:hover):not(:focus-visible)), :global(html[data-theme="dark"] .account-menu button:not(:hover):not(:focus-visible)), :global(html[data-theme="dark"] [role="menu"] button:not(:hover):not(:focus-visible)), :global(html[data-theme="dark"] .dropdown-menu button:not(:hover):not(:focus-visible)) { background: transparent !important; border-color: transparent !important; box-shadow: none !important; }
  :global(html[data-theme="dark"] .account-menu a.active), :global(html[data-theme="dark"] .account-menu button.active), :global(html[data-theme="dark"] .board-menu-panel button.active), :global(html[data-theme="dark"] .collection-menu button.active) { background: rgb(79 70 229 / 0.22) !important; color: #c7d2fe !important; border-color: #6366f1 !important; }
  :global(html[data-theme="dark"] .board-menu-panel button:hover), :global(html[data-theme="dark"] .board-menu-panel button:focus-visible), :global(html[data-theme="dark"] .collection-menu button:hover), :global(html[data-theme="dark"] .collection-menu button:focus-visible), :global(html[data-theme="dark"] .bulk-move-menu button:hover), :global(html[data-theme="dark"] .bulk-move-menu button:focus-visible), :global(html[data-theme="dark"] .account-menu button:hover), :global(html[data-theme="dark"] .account-menu button:focus-visible), :global(html[data-theme="dark"] [role="menu"] button:hover), :global(html[data-theme="dark"] .dropdown-menu button:hover) { background: #262626 !important; color: #a5b4fc !important; }
  :global(html[data-theme="dark"] .board-menu-panel select), :global(html[data-theme="dark"] .board-menu-panel option), :global(html[data-theme="dark"] .bulk-move-menu select), :global(html[data-theme="dark"] .collection-menu select) { background-color: #262626 !important; color: #fafafa !important; border-color: #404040 !important; color-scheme: dark; }
  :global(.excalidraw .dropdown-menu .dropdown-menu-item:hover), :global(.excalidraw .dropdown-menu .dropdown-menu-item--hovered), :global(.excalidraw .dropdown-menu .dropdown-menu-item:focus-visible) { background: var(--button-hover-bg, #f1f3f5) !important; color: var(--color-on-surface, #1b1b1f) !important; border-color: transparent !important; box-shadow: none !important; }
  :global(.excalidraw [data-testid="dropdown-menu"]) { background: transparent !important; box-shadow: none !important; border-radius: 0 !important; }
  :global(.excalidraw .dropdown-menu .dropdown-menu-container) { background: var(--island-bg-color, #fff) !important; box-shadow: var(--shadow-island) !important; border-radius: var(--border-radius-lg, 8px) !important; overflow: auto; }
  :global(.excalidraw.theme--dark .dropdown-menu .dropdown-menu-container) { background: var(--island-bg-color, #1e1e1e) !important; }
  :global(.excalidraw .theme-toggle-menu-item .theme-toggle-menu-row) { display: flex; align-items: center; justify-content: space-between; gap: 18px; width: 100%; }
  :global(.excalidraw .theme-mode-options) { display: inline-flex; align-items: center; gap: 2px; padding: 3px; border: 1px solid var(--default-border-color, #d4d4d8); border-radius: 9px; }
  :global(.excalidraw .theme-mode-option) { display: inline-flex; align-items: center; justify-content: center; width: 29px; height: 27px; padding: 0; border: 0; border-radius: 6px; color: inherit; background: transparent; cursor: pointer; }
  :global(.excalidraw .theme-mode-option.is-active) { background: var(--button-hover-bg, #e5e7eb) !important; box-shadow: inset 0 0 0 1px var(--default-border-color, #d4d4d8) !important; }
  :global(.excalidraw.theme--dark .theme-mode-options) { border-color: #52525b; }
  :global(.excalidraw.theme--dark .theme-mode-option.is-active) { background: #3f3f46 !important; }
  :global(.excalidraw.theme--dark .dropdown-menu .dropdown-menu-item:hover), :global(.excalidraw.theme--dark .dropdown-menu .dropdown-menu-item--hovered), :global(.excalidraw.theme--dark .dropdown-menu .dropdown-menu-item:focus-visible) { background: var(--button-hover-bg, #343a40) !important; color: var(--color-on-surface, #e3e3e8) !important; }
  :global(.excalidraw .dropdown-menu .dropdown-menu-item.theme-toggle-menu-item:hover), :global(.excalidraw .dropdown-menu .dropdown-menu-item.theme-toggle-menu-item.dropdown-menu-item--hovered), :global(.excalidraw .dropdown-menu .dropdown-menu-item.theme-toggle-menu-item:focus-visible), :global(.excalidraw .theme-toggle-menu-item .theme-toggle-menu-row:hover) { background: transparent !important; box-shadow: none !important; }
  :global(.excalidraw.theme--dark .dropdown-menu .dropdown-menu-item.theme-toggle-menu-item:hover), :global(.excalidraw.theme--dark .dropdown-menu .dropdown-menu-item.theme-toggle-menu-item.dropdown-menu-item--hovered), :global(.excalidraw.theme--dark .dropdown-menu .dropdown-menu-item.theme-toggle-menu-item:focus-visible), :global(.excalidraw.theme--dark .theme-toggle-menu-item .theme-toggle-menu-row:hover) { background: transparent !important; box-shadow: none !important; }
  :global(html[data-theme="dark"] .account-avatar) { background: #854d0e !important; color: #fef3c7 !important; border-color: #525252 !important; box-shadow: 1.5px 1.5px 0 #404040 !important; }
  :global(html[data-theme="dark"] .board-menu-panel label), :global(html[data-theme="dark"] .bulk-move-menu strong), :global(html[data-theme="dark"] .collection-menu label) { color: #a3a3a3 !important; }
  :global(html[data-theme="dark"] .account-menu a.active), :global(html[data-theme="dark"] .account-menu button.active) { background: rgb(79 70 229 / 0.24) !important; color: #c7d2fe !important; border-color: #6366f1 !important; }
  :global(html[data-theme="dark"] .button-primary), :global(html[data-theme="dark"] .primary), :global(html[data-theme="dark"] .submit), :global(html[data-theme="dark"] .confirm-accept) { background-color: #4f46e5 !important; color: #fff !important; border-color: #525252 !important; }
  :global(html[data-theme="dark"] .button-primary:hover), :global(html[data-theme="dark"] .primary:hover), :global(html[data-theme="dark"] .submit:hover) { background-color: #6366f1 !important; }
  :global(html[data-theme="dark"] .button-secondary), :global(html[data-theme="dark"] .secondary), :global(html[data-theme="dark"] .confirm-cancel), :global(html[data-theme="dark"] .eye) { background-color: #262626 !important; color: #f5f5f5 !important; border-color: #525252 !important; }
  :global(html[data-theme="dark"] .button-danger), :global(html[data-theme="dark"] .danger-action), :global(html[data-theme="dark"] .button-danger:hover), :global(html[data-theme="dark"] .account-menu .logout-item) { color: #fb7185 !important; }
  :global(html[data-theme="dark"] .message.success) { background-color: #052e16 !important; color: #bbf7d0 !important; border-color: #166534 !important; }
  :global(html[data-theme="dark"] .message.error), :global(html[data-theme="dark"] .history-error), :global(html[data-theme="dark"] .ui-alert-error) { background-color: #450a0a !important; color: #fecaca !important; border-color: #991b1b !important; }
  :global(html[data-theme="dark"] .sidebar-bottom), :global(html[data-theme="dark"] .account-menu .logout-item) { border-color: #404040 !important; }
  :global(html[data-theme="dark"] .brand-mark), :global(html[data-theme="dark"] .account-avatar), :global(html[data-theme="dark"] .state-icon), :global(html[data-theme="dark"] .avatar) { border-color: #525252 !important; }
  :global(html[data-theme="dark"] .color-row span), :global(html[data-theme="dark"] .identity p), :global(html[data-theme="dark"] .notice p), :global(html[data-theme="dark"] .panel-heading p), :global(html[data-theme="dark"] .registration-row p) { color: #a3a3a3 !important; }
  :global(html[data-theme="dark"] .password-field) { background: #262626 !important; border-color: #404040 !important; }
  :global(html[data-theme="dark"] .password-field input) { background: transparent !important; color: #fafafa !important; }
  :global(html[data-theme="dark"] .login-card .brand), :global(html[data-theme="dark"] .card .brand) { background: #262626 !important; border-color: #404040 !important; }
  :global(html[data-theme="dark"] .share-form label), :global(html[data-theme="dark"] .share-meta strong) { color: #d4d4d4 !important; }
  :global(html[data-theme="dark"] .share-meta input) { background: #262626 !important; color: #fafafa !important; }
  :global(html[data-theme="dark"] .confirm-backdrop) { background: rgb(0 0 0 / 0.68); backdrop-filter: blur(4px); }
  :global(html[data-theme="dark"] .editor-topbar) { background: rgb(23 23 23 / 0.96) !important; color: #d4d4d4 !important; border-color: #404040 !important; box-shadow: 2px 2px 0 rgb(255 255 255 / 0.08) !important; }
  :global(html[data-theme="dark"] .editor-topbar input), :global(html[data-theme="dark"] .back), :global(html[data-theme="dark"] .top-button) { background: #262626 !important; color: #f5f5f5 !important; border-color: #404040 !important; }
  :global(html[data-theme="dark"] .editor-topbar input:focus) { background: #171717 !important; border-color: #6366f1 !important; }
  :global(html[data-theme="dark"] .history-panel) { background: #171717 !important; border-color: #404040 !important; box-shadow: -4px 0 0 rgb(255 255 255 / 0.08) !important; }
  :global(html[data-theme="dark"] .history-heading h2), :global(html[data-theme="dark"] .history-item strong) { color: #fafafa !important; }
  :global(html[data-theme="dark"] .history-heading p), :global(html[data-theme="dark"] .history-empty), :global(html[data-theme="dark"] .history-item small) { color: #a3a3a3 !important; }
  :global(html[data-theme="dark"] .history-item) { background: #262626 !important; border-color: #404040 !important; box-shadow: 2px 2px 0 rgb(255 255 255 / 0.08) !important; }
  :global(html[data-theme="dark"] .status), :global(html[data-theme="dark"] .home) { background: rgb(23 23 23 / 0.96) !important; color: #d4d4d4 !important; border: 1px solid #404040 !important; }
  :global(html[data-theme="dark"] .conflict) { background: #450a0a !important; color: #fecaca !important; border-color: #991b1b !important; }
  :global(html[data-theme="dark"] .toggle) { background: #262626 !important; color: #d4d4d4 !important; border-color: #404040 !important; }
  :global(html[data-theme="dark"] .toggle.active) { background: rgb(79 70 229 / 0.22) !important; color: #c7d2fe !important; border-color: #6366f1 !important; }
  :global(html[data-theme="dark"] .board-icon) { background-color: #262626 !important; border-color: #404040 !important; }
  :global(html[data-theme="dark"] .board-info small), :global(html[data-theme="dark"] .board-menu-panel label), :global(html[data-theme="dark"] .bulk-move-menu strong) { color: #a3a3a3 !important; }
  :global(html[data-theme="dark"] .share-meta input), :global(html[data-theme="dark"] .move-select) { background: #262626 !important; color: #fafafa !important; border-color: #404040 !important; }
  :global(html[data-theme="dark"] .color-row input) { background: #262626 !important; border-color: #404040 !important; }
  :global(html[data-theme="dark"] details > summary) { color: #e5e5e5; }
  :global(html[data-theme="dark"] details > summary:hover) { color: #a5b4fc; }
  :global(html[data-theme="dark"] .settings-card.advanced[open] summary) { border-color: #404040 !important; }
  :global(html[data-theme="dark"] .account-menu a), :global(html[data-theme="dark"] .account-menu button), :global(html[data-theme="dark"] .board-menu-panel button), :global(html[data-theme="dark"] .collection-menu button), :global(html[data-theme="dark"] .bulk-move-menu button) { transition: background-color 120ms ease, color 120ms ease; }
  :global(html[data-theme="dark"] .actions a), :global(html[data-theme="dark"] .actions button), :global(html[data-theme="dark"] .footer-actions button), :global(html[data-theme="dark"] .backup-actions button), :global(html[data-theme="dark"] .user-controls button), :global(html[data-theme="dark"] .create-form button), :global(html[data-theme="dark"] .key-form button), :global(html[data-theme="dark"] .token-reveal button), :global(html[data-theme="dark"] .key-row button) { border-color: #404040 !important; box-shadow: 2px 2px 0 rgb(255 255 255 / 0.08) !important; }
  :global(html[data-theme="dark"] .actions a:not(.primary)), :global(html[data-theme="dark"] .actions button:not(.primary)), :global(html[data-theme="dark"] .footer-actions .secondary), :global(html[data-theme="dark"] .backup-actions button.secondary), :global(html[data-theme="dark"] .user-controls button:not(.active)) { background: #262626 !important; color: #e5e5e5 !important; }
  :global(html[data-theme="dark"] .eye) { background: #404040 !important; color: #e5e5e5 !important; }
  :global(html[data-theme="dark"] .status-row b) { color: #a3a3a3; }
  :global(html[data-theme="dark"] .status-row b.ok) { color: #86efac !important; }
  :global(html[data-theme="dark"] .drawing-thumb) { background: #262626 !important; color: #a5b4fc !important; border-color: #404040 !important; }
  :global(html[data-theme="dark"] .advanced summary) { color: #fafafa !important; }
  :global(html[data-theme="dark"] .settings-card select) { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%23a3a3a3' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E") !important; }
  .prompt-dialog { display: grid; gap: 12px; }
  .prompt-dialog h2 { margin: 8px 0 0; }
  .prompt-dialog .prompt-input { width: 100%; min-width: 0; padding: 11px 12px; border: 2px solid #e2e8f0; border-radius: 10px; background: #fff; color: #1e293b; font: 13px system-ui, sans-serif; outline: none; }
  .prompt-dialog .prompt-input:focus { border-color: #6366f1; box-shadow: 0 0 0 3px rgb(99 102 241 / 0.18); }
  .prompt-dialog .prompt-error { color: #be123c; font-size: 12px; }
  :global(html[data-theme="dark"] .prompt-dialog .prompt-input) { background: #262626 !important; color: #fafafa !important; border-color: #404040 !important; }
  :global(html[data-theme="dark"] .prompt-dialog .prompt-error) { color: #fda4af !important; }
  :global(html[data-theme="dark"] .excalidraw .dropdown-menu) { background: transparent !important; box-shadow: none !important; }
  :global(html[data-theme="dark"] .excalidraw .dropdown-menu .dropdown-menu-container) { background: var(--island-bg-color, #1e1e1e) !important; box-shadow: var(--shadow-island) !important; border-radius: var(--border-radius-lg, 8px) !important; }
  :global(.excalidraw.theme--dark .color-picker) { --popup-bg-color: #171717; font-family: inherit !important; color: #e5e5e5 !important; background: #171717 !important; border: 1px solid #404040 !important; border-radius: var(--border-radius-lg, 8px) !important; box-shadow: 0 10px 30px rgb(0 0 0 / 0.4) !important; }
  :global(.excalidraw.theme--dark .color-picker input), :global(.excalidraw.theme--dark .color-picker select) { font: inherit !important; color: #e5e5e5 !important; background: #262626 !important; border-color: #525252 !important; }
  :global(.excalidraw .color-picker) { --popup-bg-color: #ffffff; color: #1e293b !important; background: #ffffff !important; border-color: #e2e8f0 !important; box-shadow: 0 10px 30px rgb(15 23 42 / 0.12) !important; }
  :global(.excalidraw .color-picker input), :global(.excalidraw .color-picker select) { color: #1e293b !important; background: #ffffff !important; border-color: #cbd5e1 !important; }
  /* Excalidraw's menu UI must follow Excalidraw's own theme (.theme--dark), not the page-level
     html[data-theme]. The global dark rules above (`.dropdown-menu` color + `button:not(:hover)`
     transparent background/border) otherwise bleed into the canvas-background picker:
     the label gets the wrong color and the swatches only show their color on hover. */
  :global(.excalidraw.excalidraw .dropdown-menu) { color: var(--color-on-surface) !important; }
  :global(.excalidraw.excalidraw [data-testid="canvas-background-label"]) { color: var(--color-on-surface) !important; }
  :global(.excalidraw.excalidraw .dropdown-menu .color-picker__button.color-picker__button) { background-color: var(--swatch-color) !important; border: 1px solid var(--color-gray-30) !important; }
</style>