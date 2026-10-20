<script lang="ts">
  import { onMount } from 'svelte';
  import { compressExcalidrawFiles, type ExcalidrawFileRecord } from '$lib/imageCompression';

  let { initialData = null, onSave, onRemoteScene, viewOnly = false, langCode = 'en', title = $bindable(), onTitleCommit, onHistory, onShare }: { initialData?: unknown; onSave?: (scene: unknown) => void; onRemoteScene?: (apply: (scene: unknown) => void) => void; viewOnly?: boolean; langCode?: string; title?: string; onTitleCommit?: () => void; onHistory?: () => void; onShare?: () => void } = $props();
  let host: HTMLDivElement;
  let shell: HTMLDivElement;
  let error = $state('');
  // Drawing title shown next to Excalidraw's main-menu button. Excalidraw 0.18 has no
  // "top left" slot, so the position is measured from the menu trigger button itself.
  let titlePos = $state<{ left: number; top: number } | null>(null);
  let resolvedTheme = $state<'light' | 'dark'>('light');
  let titleFocused = $state(false);
  let titleOnFocus = '';
  const titleColors = $derived(resolvedTheme === 'dark'
    ? { text: '#e3e3e8', underline: '#a8a5ff' }
    : { text: '#1b1b1f', underline: '#6965db' });
  const titleStyle = $derived(
    'background:transparent !important;box-shadow:none !important;border:0 !important;border-radius:0 !important;'
    + 'border-bottom:2px solid ' + (titleFocused ? titleColors.underline : 'transparent') + ' !important;'
    + 'color:' + titleColors.text + ' !important;'
    + 'width:' + Math.min(Math.max((title?.length ?? 0) + 1, 6), 40) + 'ch;'
  );

  onMount(() => {
    let measureFrame = 0;
    const measureTitle = () => {
      measureFrame = 0;
      const trigger = host?.querySelector('[data-testid="main-menu-trigger"]') as HTMLElement | null;
      if (!trigger || !shell) { if (titlePos) titlePos = null; return; }
      const shellRect = shell.getBoundingClientRect();
      const triggerRect = trigger.getBoundingClientRect();
      if (triggerRect.width === 0) { if (titlePos) titlePos = null; return; }
      const left = Math.round(triggerRect.right - shellRect.left + 10);
      const top = Math.round(triggerRect.top - shellRect.top + triggerRect.height / 2);
      if (!titlePos || titlePos.left !== left || titlePos.top !== top) titlePos = { left, top };
    };
    const scheduleMeasure = () => { if (!measureFrame) measureFrame = requestAnimationFrame(measureTitle); };
    const mutationObserver = new MutationObserver(scheduleMeasure);
    mutationObserver.observe(host, { childList: true, subtree: true });
    const resizeObserver = new ResizeObserver(scheduleMeasure);
    resizeObserver.observe(shell);
    window.addEventListener('resize', scheduleMeasure);
    scheduleMeasure();
    const stopMeasure = () => {
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      if (measureFrame) cancelAnimationFrame(measureFrame);
    };

    let root: import('react-dom/client').Root | undefined;
    let disposed = false;
    let cleanupTheme: (() => void) | undefined;
    let applyingRemote = false;
    let pendingRemoteValue: unknown;
    let hasPendingRemoteValue = false;
    let latestSceneSnapshot: { elements: unknown; appState: Record<string, unknown>; files: Record<string, ExcalidrawFileRecord> } | null = null;

    void (async () => {
      try {
        const React = await import('react');
        const { createRoot } = await import('react-dom/client');
        const { Excalidraw, MainMenu } = await import('@excalidraw/excalidraw');
        if (disposed) return;

        const savedLangCode = localStorage.getItem('drawflare-lang') || langCode;
        // Excalidraw already inverts the whole canvas (background included) with
        // `invert(93%) hue-rotate(180deg)` when theme === 'dark'. So the default canvas
        // color must stay white in BOTH themes; forcing a dark hex here makes the canvas
        // dark in light mode and (after the inversion) light in dark mode.
        // Legacy dark defaults saved by earlier builds are migrated back to white.
        const DEFAULT_CANVAS_BACKGROUND = '#ffffff';
        const THEME_DEFAULT_BACKGROUNDS = ['#ffffff', '#fff', '#f8fafc', '#171717', '#1e1e1e', '#121212'];
        const normalizeBackground = (value: unknown): string => {
          if (typeof value !== 'string' || !value) return DEFAULT_CANVAS_BACKGROUND;
          return THEME_DEFAULT_BACKGROUNDS.includes(value.toLowerCase()) ? DEFAULT_CANVAS_BACKGROUND : value;
        };
        const applyRemote = (value: unknown) => {
          const api = excalidrawApi as { updateScene?: (scene: Record<string, unknown>) => void; addFiles?: (files: unknown[]) => void } | null;
          const next = value && typeof value === 'object' ? value as Record<string, unknown> : {};
          if (!api?.updateScene) { pendingRemoteValue = value; hasPendingRemoteValue = true; return; }
          applyingRemote = true;
          if (next.files && typeof next.files === 'object' && api.addFiles) api.addFiles(Array.isArray(next.files) ? next.files : Object.values(next.files as Record<string, unknown>));
          const sourceAppState = next.appState && typeof next.appState === 'object' ? next.appState as Record<string, unknown> : {};
          // Synced scenes can arrive after mount and overwrite the theme-adjusted initialData.
          // Keep Excalidraw's UI theme and default canvas color aligned on every scene apply.
          const appState: Record<string, unknown> = { ...sourceAppState };
          const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
          const theme = currentThemeMode === 'system' ? (systemDark ? 'dark' : 'light') : currentThemeMode;
          appState.theme = theme;
          appState.viewBackgroundColor = normalizeBackground(appState.viewBackgroundColor);
          api.updateScene({ elements: Array.isArray(next.elements) ? next.elements : [], appState });
          queueMicrotask(() => { applyingRemote = false; });
        };
        let excalidrawApi: any = null;
        let editorElement: any = null;
        type ThemeMode = 'dark' | 'light' | 'system';
        const storedThemeMode = localStorage.getItem('drawflare-theme-mode');
        let currentThemeMode: ThemeMode = storedThemeMode === 'dark' || storedThemeMode === 'light' || storedThemeMode === 'system' ? storedThemeMode : 'system';
        let setThemeToggleMode: ((mode: ThemeMode) => void) | null = null;
        resolvedTheme = currentThemeMode === 'system' ? (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : currentThemeMode;
        const applyThemeMode = (nextMode: ThemeMode) => {
          currentThemeMode = nextMode;
          localStorage.setItem('drawflare-theme-mode', nextMode);
          const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
          const theme: 'dark' | 'light' = nextMode === 'system' ? (systemDark ? 'dark' : 'light') : nextMode;
          resolvedTheme = theme;
          // Keep the canvas default in sync with the selected editor theme, without
          // overwriting a custom background chosen from Excalidraw's canvas menu.
          const currentBackground = excalidrawApi?.getAppState?.()?.viewBackgroundColor;
          const appState: Record<string, unknown> = { theme };
          const normalizedBackground = normalizeBackground(currentBackground);
          if (normalizedBackground !== currentBackground) appState.viewBackgroundColor = normalizedBackground;
          excalidrawApi?.updateScene?.({ appState });
          // Match upstream DrawFlare: pass the resolved theme as an Excalidraw prop.
          if (root && editorElement) {
            editorElement = React.cloneElement(editorElement, { theme });
            root.render(editorElement);
          }
          setThemeToggleMode?.(nextMode);
        };
        const media = window.matchMedia('(prefers-color-scheme: dark)');
        const onSystemThemeChange = () => { if (currentThemeMode === 'system') applyThemeMode('system'); };
        media.addEventListener?.('change', onSystemThemeChange);
        cleanupTheme = () => { media.removeEventListener?.('change', onSystemThemeChange); setThemeToggleMode = null; };
        const ThemeToggle = () => {
          const [mode, setMode] = React.useState<ThemeMode>(currentThemeMode);
          React.useEffect(() => { setThemeToggleMode = setMode; setMode(currentThemeMode); return () => { setThemeToggleMode = null; }; }, []);
          const icon = (name: ThemeMode) => {
            const paths: Record<ThemeMode, any[]> = {
              dark: [React.createElement('path', { key: 'moon', d: 'M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z' })],
              light: [React.createElement('circle', { key: 'sun', cx: 12, cy: 12, r: 4 }), React.createElement('path', { key: 'rays', d: 'M12 2v2m0 16v2M4.93 4.93l1.42 1.42m11.3 11.3 1.42 1.42M2 12h2m16 0h2M4.93 19.07l1.42-1.42m11.3-11.3 1.42-1.42' })],
              system: [React.createElement('rect', { key: 'screen', x: 3, y: 4, width: 18, height: 13, rx: 2 }), React.createElement('path', { key: 'stand', d: 'M8 21h8m-4-4v4' })]
            };
            return React.createElement('svg', { viewBox: '0 0 24 24', width: 16, height: 16, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }, ...paths[name]);
          };
          return React.createElement(MainMenu.Item, {
            icon: icon('system'),
            className: 'theme-toggle-menu-item',
            onSelect: () => {},
            children: React.createElement('span', { className: 'theme-toggle-menu-row' }, [
              React.createElement('span', { key: 'label' }, 'Theme'),
              React.createElement('span', { key: 'options', className: 'theme-mode-options', role: 'group', 'aria-label': 'Theme mode' },
                (['light', 'dark', 'system'] as ThemeMode[]).map((option) => React.createElement('span', {
                  key: option,
                  role: 'radio',
                  tabIndex: 0,
                  className: 'theme-mode-option' + (mode === option ? ' is-active' : ''),
                  title: option[0].toUpperCase() + option.slice(1),
                  'aria-label': option[0].toUpperCase() + option.slice(1) + ' theme',
                  'aria-checked': mode === option,
                  onClick: (event: MouseEvent) => { event.preventDefault(); event.stopPropagation(); applyThemeMode?.(option); },
                  onKeyDown: (event: KeyboardEvent) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); event.stopPropagation(); applyThemeMode?.(option); } }
                }, icon(option)))
              )
            ])
          });
        };
        onRemoteScene?.(applyRemote);
        root = createRoot(host);
        editorElement = React.createElement(Excalidraw, {
          theme: (() => { const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches; return currentThemeMode === 'system' ? (systemDark ? 'dark' : 'light') : currentThemeMode; })(),
          excalidrawAPI: (api: unknown) => { excalidrawApi = api; if (hasPendingRemoteValue) { const pending = pendingRemoteValue; hasPendingRemoteValue = false; applyRemote(pending); } },
          initialData: (() => {
            const data = initialData && typeof initialData === 'object' ? initialData as Record<string, unknown> : {};
            const appState = data.appState && typeof data.appState === 'object' ? data.appState as Record<string, unknown> : {};
            const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            const theme = currentThemeMode === 'system' ? (systemDark ? 'dark' : 'light') : currentThemeMode;
            const viewBackgroundColor = normalizeBackground(appState.viewBackgroundColor);
            return { ...data, appState: { ...appState, theme, viewBackgroundColor } };
          })(),
          langCode: savedLangCode,
          viewModeEnabled: viewOnly,
          // Rendered by Excalidraw directly to the left of its "Library" button.
          renderTopRightUI: (isMobile: boolean) => {
            if (!onHistory && !onShare) return null;
            const icon = (nodes: any[]) => React.createElement('svg', { viewBox: '0 0 24 24', 'aria-hidden': true, fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }, ...nodes);
            const button = (key: string, label: string, nodes: any[], onClick?: () => void) => React.createElement(
              'button',
              { key, type: 'button', className: 'drawflare-top-button', title: label, 'aria-label': label, onClick: () => onClick?.() },
              icon(nodes),
              isMobile ? null : React.createElement('span', null, label)
            );
            return React.createElement('div', { className: 'drawflare-top-actions' },
              onHistory ? button('history', 'History', [
                React.createElement('circle', { key: 'face', cx: 12, cy: 12, r: 9 }),
                React.createElement('path', { key: 'hands', d: 'M12 7v5l3 2' })
              ], onHistory) : null,
              onShare ? button('share', 'Share', [
                React.createElement('circle', { key: 'a', cx: 18, cy: 5, r: 3 }),
                React.createElement('circle', { key: 'b', cx: 6, cy: 12, r: 3 }),
                React.createElement('circle', { key: 'c', cx: 18, cy: 19, r: 3 }),
                React.createElement('path', { key: 'l1', d: 'M8.6 13.5l6.8 4M15.4 6.5l-6.8 4' })
              ], onShare) : null
            );
          },
          children: React.createElement(MainMenu, null,
            React.createElement(MainMenu.Group, {
              title: 'Workspace',
              children: React.createElement(MainMenu.ItemLink, {
                href: '/',
                icon: React.createElement('svg', {
                  viewBox: '0 0 24 24', width: 20, height: 20, fill: 'none',
                  stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
                  children: [
                    React.createElement('rect', { key: 'board', x: 3, y: 4, width: 18, height: 13, rx: 2 }),
                    React.createElement('path', { key: 'stand', d: 'M8 21h8M12 17v4M7 8h4M7 12h7' })
                  ]
                }),
                children: 'Dashboard'
              })
            }),
            React.createElement(MainMenu.DefaultItems.LoadScene),
            React.createElement(MainMenu.DefaultItems.SaveToActiveFile),
            React.createElement(MainMenu.DefaultItems.Export),
            React.createElement(MainMenu.DefaultItems.SaveAsImage),
            React.createElement(MainMenu.DefaultItems.SearchMenu),
            React.createElement(MainMenu.DefaultItems.Help),
            React.createElement(MainMenu.DefaultItems.ClearCanvas),
            React.createElement(MainMenu.Separator),
            React.createElement(ThemeToggle),
            React.createElement(MainMenu.DefaultItems.ChangeCanvasBackground)
          ),
          onChange: (elements: unknown, appState: unknown, files: unknown) => {
            if (applyingRemote) return;
            const state = appState as Record<string, unknown> | undefined;
            // Excalidraw can emit its initial saved canvas color after the API/theme
            // callback has run. Reconcile that late state so the selected theme wins
            // for the standard light/dark canvas colors, while preserving custom colors.
            if (state && (state.theme === 'dark' || state.theme === 'light')) {
              const background = state.viewBackgroundColor as string | undefined;
              const shouldBe = normalizeBackground(background);
              if (background !== shouldBe) {
                excalidrawApi?.updateScene?.({ appState: { viewBackgroundColor: shouldBe } });
                state.viewBackgroundColor = shouldBe;
              }
            }
            const persistedState: Record<string, unknown> = {};
            if (state) {
              for (const key of ['viewBackgroundColor', 'gridSize', 'zenModeEnabled', 'viewModeEnabled', 'scrollX', 'scrollY', 'zoom']) {
                if (key in state) persistedState[key] = state[key];
              }
            }
            const snapshot = { elements, appState: persistedState, files: files && typeof files === 'object' ? files as Record<string, ExcalidrawFileRecord> : {} };
            latestSceneSnapshot = snapshot;
            void compressExcalidrawFiles(snapshot.files).then((compressed) => {
              if (disposed) return;
              if (compressed.changed) {
                const api = excalidrawApi as { addFiles?: (nextFiles: unknown[]) => void } | null;
                api?.addFiles?.(Object.values(compressed.files));
              }
              const latest = latestSceneSnapshot;
              if (!latest) return;
              return compressExcalidrawFiles(latest.files).then((latestFiles) => {
                if (!disposed) onSave?.({ ...latest, files: latestFiles.files });
              });
            }).catch(() => { if (!disposed) onSave?.(snapshot); });
          }
        });
        root.render(editorElement);
      } catch (e) {
        error = e instanceof Error ? e.message : 'Failed to load Excalidraw';
      }
    })();

    return () => {
      disposed = true;
      stopMeasure();
      cleanupTheme?.();
      root?.unmount();
    };
  });
</script>

<div class="editor-shell" bind:this={shell}>
  <div class="editor" bind:this={host}></div>
  {#if title !== undefined}
    <div class="title-overlay" style:left={titlePos ? titlePos.left + 'px' : '0'} style:top={titlePos ? titlePos.top + 'px' : '0'} style:visibility={titlePos ? 'visible' : 'hidden'}>
      <input
        class="title-input"
        aria-label="Drawing title"
        title="Click to rename"
        maxlength="160"
        spellcheck="false"
        bind:value={title}
        style={titleStyle}
        onfocus={() => { titleFocused = true; titleOnFocus = title ?? ''; }}
        onblur={() => { titleFocused = false; onTitleCommit?.(); }}
        onkeydown={(event) => {
          event.stopPropagation();
          const input = event.currentTarget as HTMLInputElement;
          if (event.key === 'Enter') input.blur();
          else if (event.key === 'Escape') { title = titleOnFocus; input.blur(); }
        }}
      />
    </div>
  {/if}
  {#if error}
    <div class="error" role="alert">Excalidraw failed to load: {error}</div>
  {/if}
</div>

<style>
  .editor-shell { position: relative; width: 100%; height: 100%; min-height: 0; }
  .editor { width: 100%; height: 100%; min-height: 0; }
  .title-overlay { position: absolute; z-index: 6; display: flex; align-items: center; transform: translateY(-50%); max-width: clamp(90px, calc(50vw - 330px), 320px); }
  .title-input { box-sizing: content-box; max-width: 100%; min-width: 0; margin: 0; padding: 3px 1px 1px; outline: none; font: 600 15px/1.3 system-ui, sans-serif; text-overflow: ellipsis; transition: border-color 120ms ease; }
  .editor :global(.excalidraw) { height: 100%; }
  .error { position: absolute; inset: auto 1rem 1rem; z-index: 20; color: #b91c1c; background: white; padding: .75rem; border: 1px solid #fecaca; border-radius: .5rem; }
</style>
