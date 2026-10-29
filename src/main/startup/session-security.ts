import { session } from "electron";
import { installPlayerScriptFilter } from "../player-script-filter";
import { embeddedPlayerOrigins, type ProviderConfig } from "../provider-config";

/**
 * The default session's permissions and the embedded players' script allowlist. Full screen is
 * open to AniStream's page and the configured players; local fonts only to AniStream's page.
 */
export function secureSession(config: ProviderConfig, trustedRendererOrigin: string): void {
  const allowedOrigins = new Set([trustedRendererOrigin, ...embeddedPlayerOrigins(config)]);
  // Local fonts (read on this device, never sent anywhere) let the own player's ASS subtitles use
  // the fonts their styles name; only AniStream's own window may ask, never an embedded player.
  const allowed = (permission: string, origin: string | undefined): boolean =>
    (permission === "fullscreen" && allowedOrigins.has(origin ?? "")) ||
    (permission === "local-fonts" && origin === trustedRendererOrigin);
  session.defaultSession.setPermissionCheckHandler((_webContents, permission, requestingOrigin) =>
    allowed(permission, safeOrigin(requestingOrigin)),
  );
  session.defaultSession.setPermissionRequestHandler(
    (_webContents, permission, callback, details) => {
      const requestingOrigin = safeOrigin(details.requestingUrl);
      callback(allowed(permission, requestingOrigin));
    },
  );
  installPlayerScriptFilter(
    session.defaultSession,
    [
      ...config.anime.media
        .flatMap((player) => (player.kind === "indexed-embed" ? [player] : []))
        .map((player) => ({
          origin: player.playerOrigin,
          scriptHosts: player.scriptHosts,
          blockedScriptPaths: player.blockedScriptPaths,
          blockedRequestHosts: player.blockedRequestHosts,
        })),
      ...config.more.media,
      // Only the app's own page may load its stream, offline and artwork addresses (finding 5).
    ],
    trustedRendererOrigin,
  );
}

export function safeOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}
