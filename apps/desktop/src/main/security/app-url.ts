// apps/desktop/src/main/security/app-url.ts
//
// The one definition of "the app's own renderer document". Navigation guards
// and the IPC sender check both use it — a document that fails it must never
// hold the preload bridge's privileges.

import { pathToFileURL } from 'node:url';

export type AppUrlConfig = {
  /** Dev server URL (ELECTRON_RENDERER_URL), or undefined when packaged. */
  devUrl: string | undefined;
  /** Absolute path of the packaged renderer index.html. */
  indexHtml: string;
};

/**
 * True only for the app's document: the exact dev-server origin, or the exact
 * packaged index.html. Parsed, never prefix-matched — `http://localhost:5173`
 * must not admit `http://localhost:5173.attacker.example`. Hash and query are
 * ignored (routing is hash-based, so the document URL itself never changes).
 */
export function isAppUrl(url: string, cfg: AppUrlConfig): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (cfg.devUrl) return u.origin === new URL(cfg.devUrl).origin;
  const index = pathToFileURL(cfg.indexHtml);
  return u.protocol === 'file:' && u.host === '' && u.pathname === index.pathname;
}
