import adapter from '@sveltejs/adapter-cloudflare';

export default {
  kit: {
    adapter: adapter({
      config: 'wrangler.build.toml',
      platformProxy: {
        configPath: 'wrangler.dev.toml',
        remoteBindings: false,
        persist: true
      }
    }),
    alias: {
      '$lib': './src/lib'
    }
  }
};