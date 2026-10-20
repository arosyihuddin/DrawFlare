declare global {
  namespace App {
    interface Platform {
      env: {
        DB?: D1Database;
        COLLABORATION_ROOMS?: DurableObjectNamespace;
        COLLABORATION_ROOMS?: DurableObjectNamespace;
        FILES?: R2Bucket;
        ASSETS?: Fetcher;
        MCP_AUTH_TOKEN?: string;
        APP_PASSWORD?: string;
        AUTH_SECRET?: string;
        APP_NAME?: string;
        DRAWFLARE_GITHUB_REPO?: string;
        MCP_SERVER_NAME?: string;
        RESEND_API_KEY?: string;
        RESEND_FROM_EMAIL?: string;
      };
    }
    interface Locals {
      user: import('$lib/server/auth').SessionIdentity | null;
    }
  }
}
export {};