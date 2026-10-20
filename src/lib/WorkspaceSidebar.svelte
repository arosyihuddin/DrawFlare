<script lang="ts">
  import { onMount } from 'svelte';
  type Collection = { id: string; name: string; drawing_count?: number };
  type SessionUser = { id: string | null; email: string | null; name: string; role: 'ADMIN' | 'USER'; legacy: boolean };
  let { activePage = 'dashboard' }: { activePage?: 'dashboard' | 'settings' | 'profile' | 'admin' } = $props();
  let collections = $state<Collection[]>([]);
  let accountMenuOpen = $state(false);
  let sessionUser = $state<SessionUser | null>(null);
  let uiLocale = $state<'en' | 'zh-CN'>('en');
  onMount(() => {
    try {
      const raw = localStorage.getItem('excali_preferences');
      const preferences = raw ? JSON.parse(raw) as { compactSidebar?: boolean } : {};
      document.documentElement.dataset.compactSidebar = preferences.compactSidebar === true ? 'true' : 'false';
    } catch { document.documentElement.dataset.compactSidebar = 'false'; }
    try { uiLocale = localStorage.getItem('drawflare-ui-locale') === 'zh-CN' ? 'zh-CN' : 'en'; } catch { uiLocale = 'en'; }
    void (async () => {
      try {
        const [collectionResponse, sessionResponse] = await Promise.all([fetch('/api/collections'), fetch('/api/auth/session')]);
        if (collectionResponse.ok) collections = await collectionResponse.json() as Collection[];
        if (sessionResponse.ok) { const data = await sessionResponse.json() as { user: SessionUser | null }; sessionUser = data.user; }
      } catch { /* Sidebar navigation remains usable without optional account data. */ }
    })();
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') accountMenuOpen = false; };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  });
</script>
<aside class="sidebar">
  <a href="/" class="sidebar-brand" aria-label="DrawFlare home"><span class="brand-mark"><img src="/drawflare-logo.svg" alt="" /></span><span class="brand-name">DrawFlare</span><span class="beta">Beta</span></a>
  <div class="sidebar-scroll">
    <div class="sidebar-section-label">{uiLocale === 'zh-CN' ? '资料库' : 'LIBRARY'}</div>
    <a class="nav-item" href="/"><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg> <span>{uiLocale === 'zh-CN' ? '全部绘图' : 'All drawings'}</span></a>
    <a class="nav-item" href="/?view=favorites"><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2L12 17.3l-5.6 2.9 1.1-6.2L3 9.6l6.2-.9L12 3z"/></svg> <span>{uiLocale === 'zh-CN' ? '收藏夹' : 'Favorites'}</span></a>
    <a class="nav-item" href="/?view=unorganized"><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h18v13H3zM3 7l2-4h14l2 4M9 11h6"/></svg> <span>{uiLocale === 'zh-CN' ? '未整理' : 'Unorganized'}</span></a>
    <div class="sidebar-section-label collection-label">{uiLocale === 'zh-CN' ? '集合' : 'COLLECTIONS'}</div>
    {#each collections.filter((item) => item.name !== 'Trash') as collection (collection.id)}
      <a class="nav-item collection-link" href={'/?collectionId=' + encodeURIComponent(collection.id)}><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg> <span>{collection.name}</span>{#if collection.drawing_count !== undefined}<small>{collection.drawing_count}</small>{/if}</a>
    {/each}
  </div>
  <div class="sidebar-bottom">
    {#if accountMenuOpen}
      <button class="menu-backdrop" aria-label="Close account menu" onclick={() => accountMenuOpen = false}></button>
      <div class="account-menu">
        <a href="/?view=trash"><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2m-11 0 1 14h12l1-14M10 10v6m4-6v6"/></svg> <span>{uiLocale === 'zh-CN' ? '回收站' : 'Trash'}</span></a>
        <a class:active={activePage === 'profile'} href="/profile"><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></svg> <span>{uiLocale === 'zh-CN' ? '个人资料' : 'Profile'}</span></a>
        {#if !sessionUser || sessionUser.role === 'ADMIN'}<a class:active={activePage === 'admin'} href="/admin"><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s8-4 8-11V5l-8-3-8 3v6c0 7 8 11 8 11z"/><path d="m9 12 2 2 4-4"/></svg> <span>{uiLocale === 'zh-CN' ? '管理' : 'Administration'}</span></a>{/if}
        <a class:active={activePage === 'settings'} href="/settings"><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.6a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.6-1.4-2.4 1.4-1.1a8 8 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.6a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.6 1.4 2.4-1.4 1.1a8 8 0 0 1 0 2z"/></svg> <span>{uiLocale === 'zh-CN' ? '设置' : 'Settings'}</span></a>
        <button class="logout-item" onclick={async () => { await fetch('/api/auth/logout', { method: 'POST' }); location.href = '/login'; }}><svg class="nav-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M10 17l5-5-5-5M15 12H3M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7"/></svg> <span>{uiLocale === 'zh-CN' ? '退出登录' : 'Sign out'}</span></button>
      </div>
    {/if}
    <button class="account-trigger" aria-expanded={accountMenuOpen} onclick={() => accountMenuOpen = !accountMenuOpen}><span class="account-avatar">{sessionUser?.name?.slice(0, 1).toUpperCase() ?? 'E'}</span><span class="account-copy"><strong>{sessionUser?.name ?? 'Workspace'}</strong><small>{sessionUser?.legacy ? 'Shared-password mode' : sessionUser?.email ?? 'Workspace mode'}</small></span><span class="account-chevron">⌃</span></button>
  </div>
</aside>
<style>
  .sidebar{position:sticky;top:14px;align-self:start;display:flex;flex-direction:column;min-width:0;height:calc(100dvh - 28px);padding:16px 10px 10px;border:2px solid #1e293b;border-radius:16px;background:#fff;box-shadow:1.5px 1.5px 0 #1e293b;overflow:hidden}
  .sidebar-brand{display:flex;align-items:center;gap:10px;margin:0 6px 26px;padding:4px 5px;color:#1e293b;text-decoration:none;flex:0 0 auto}.brand-mark{display:grid;place-items:center;width:38px;height:38px;flex:0 0 auto;border:2px solid #1e293b;border-radius:12px;background:#fff;box-shadow:1.5px 1.5px 0 #1e293b}.brand-mark img{width:34px;height:34px;object-fit:contain}.brand-name{font:400 23px 'Excalifont',sans-serif;white-space:nowrap;letter-spacing:-.025em}.beta{align-self:flex-start;margin:4px 0 0 auto;color:#ef4444;font-size:10px;font-weight:800}
  .sidebar-scroll{flex:1;min-height:0;overflow-y:auto;scrollbar-width:thin;scrollbar-color:#cbd5e1 transparent}.sidebar-section-label{display:flex;align-items:center;margin:2px 10px 9px;color:#94a3b8;font-size:10px;font-weight:850;letter-spacing:.1em}.collection-label{margin-top:24px}
  .nav-icon{display:block;width:18px;height:18px;min-width:18px;min-height:18px;flex:0 0 18px;overflow:visible;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
  .nav-item svg,.account-menu svg{display:block;width:18px;height:18px;min-width:18px;min-height:18px;flex:0 0 18px}
  .nav-item{display:flex;align-items:center;gap:10px;width:100%;min-height:38px;margin:2px 0;padding:8px 10px;border:2px solid transparent;border-radius:10px;background:transparent;color:#475569;text-align:left;text-decoration:none;font-size:13px;font-weight:650}.nav-item span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.nav-item small{color:#94a3b8;font-size:11px}.nav-item:hover{border-color:#1e293b;background:#f8fafc}:global(.nav-item.active){border-color:#1e293b;background:#eef2ff;color:#3730a3;box-shadow:1.5px 1.5px 0 #1e293b}
  .sidebar-bottom{position:relative;flex:0 0 auto;margin-top:auto;padding-top:12px;border-top:1px solid #e2e8f0}.account-trigger{display:flex;align-items:center;gap:10px;width:100%;padding:9px 8px;border:0;border-radius:11px;background:transparent;color:#1e293b;text-align:left;cursor:pointer}.account-trigger:hover{background:#f1f5f9}.account-avatar{display:grid;place-items:center;width:34px;height:34px;flex:0 0 auto;border:2px solid #1e293b;border-radius:12px;background:#fcd34d;box-shadow:1.5px 1.5px 0 #1e293b;font:400 21px 'Excalifont',sans-serif}.account-copy{display:grid;flex:1;min-width:0;gap:2px}.account-copy strong{font-size:12px;font-weight:800}.account-copy small{overflow:hidden;color:#64748b;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.account-chevron{color:#64748b;transform:rotate(180deg)}
  .menu-backdrop{position:fixed;inset:0;z-index:25;border:0;background:transparent}.account-menu{position:absolute;z-index:26;right:0;bottom:calc(100% + 8px);left:0;display:grid;gap:4px;padding:5px;border:1px solid #1e293b;border-radius:12px;background:#fff;box-shadow:1.5px 1.5px 0 rgb(30 41 59 / .9)}.account-menu a,.account-menu button{display:flex;align-items:center;gap:9px;width:100%;padding:9px 10px;border:0;border-radius:8px;background:transparent;color:#475569;text-align:left;text-decoration:none;font:650 12px system-ui;cursor:pointer}.account-menu a:hover,.account-menu button:hover,.account-menu a.active{background:#eef2ff;color:#3730a3}.account-menu .logout-item{margin-top:2px;border-top:1px solid #e2e8f0;border-radius:0 0 7px 7px;color:#be123c}
  :global(html[data-compact-sidebar="true"] .settings-layout),:global(html[data-compact-sidebar="true"] .layout),:global(html[data-compact-sidebar="true"] .library-page){grid-template-columns:78px minmax(0,1fr)!important}
  :global(html[data-compact-sidebar="true"] .sidebar){padding-right:6px;padding-left:6px}
  :global(html[data-compact-sidebar="true"] .sidebar-brand){justify-content:center;margin-right:0;margin-left:0}
  :global(html[data-compact-sidebar="true"] .brand-name),:global(html[data-compact-sidebar="true"] .beta),:global(html[data-compact-sidebar="true"] .sidebar-section-label),:global(html[data-compact-sidebar="true"] .nav-item span),:global(html[data-compact-sidebar="true"] .nav-item small),:global(html[data-compact-sidebar="true"] .account-copy),:global(html[data-compact-sidebar="true"] .account-chevron){display:none}
  :global(html[data-compact-sidebar="true"] .nav-item){justify-content:center;padding-right:0;padding-left:0}
  :global(html[data-compact-sidebar="true"] .account-trigger){justify-content:center;padding-right:0;padding-left:0}
  :global(html[data-compact-sidebar="true"] .account-menu){right:auto;bottom:0;left:calc(100% + 8px);width:200px}
  @media(max-width:650px){.sidebar{position:static;display:flex;flex-direction:row;align-items:center;gap:4px;width:100%;height:auto;padding:8px;border:2px solid #1e293b;border-radius:14px;overflow:visible}.sidebar-brand{margin:0 8px 0 0;flex:0 0 auto}.brand-name{font-size:19px}.brand-mark{width:32px;height:32px}.brand-mark img{width:28px;height:28px}.beta{display:none}.sidebar-scroll{display:contents}.sidebar-section-label,.collection-link{display:none}.sidebar-bottom{margin-left:auto;padding:0;border:0}.account-copy{display:none}.account-trigger{width:auto;padding:2px}.account-menu{right:0;left:auto;width:180px}}
  @media(max-width:650px){:global(html[data-compact-sidebar="true"] .settings-layout),:global(html[data-compact-sidebar="true"] .layout),:global(html[data-compact-sidebar="true"] .library-page){grid-template-columns:minmax(0,1fr)!important}:global(html[data-compact-sidebar="true"] .brand-name){display:inline}:global(html[data-compact-sidebar="true"] .account-menu){right:0;bottom:calc(100% + 8px);left:auto;width:180px}}
</style>
