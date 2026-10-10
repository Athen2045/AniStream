export const RELEASE_REPOSITORY = "https://github.com/Athen2045/AniStream";
export const RELEASE_ENDPOINT = "https://api.github.com/repos/Athen2045/AniStream/releases/latest";

export type UpdateTarget = "mac-arm64" | "win-x64";

export function updateTarget(
  packaged: boolean,
  platform: string,
  arch: string,
): UpdateTarget | undefined {
  if (!packaged) return undefined;
  if (platform === "darwin" && arch === "arm64") return "mac-arm64";
  if (platform === "win32" && arch === "x64") return "win-x64";
  return undefined;
}

export function stableVersion(value: unknown): string | undefined {
  if (typeof value !== "string" || !/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value))
    return undefined;
  const version = value.replace(/^v/, "");
  return version.split(".").every((part) => Number.isSafeInteger(Number(part)))
    ? version
    : undefined;
}

export function newerVersion(left: string, right: string): boolean {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index]! > b[index]!;
  }
  return false;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function positiveInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

export function parseRelease(
  value: unknown,
  target: UpdateTarget,
):
  | { kind: "release"; version: string; releaseUrl: string; canInstall: boolean }
  | { kind: "invalid-response" | "no-compatible-release" } {
  if (
    !record(value) ||
    !positiveInteger(value.id) ||
    value.draft !== false ||
    value.prerelease !== false
  )
    return { kind: "invalid-response" };
  const version = stableVersion(value.tag_name);
  if (
    !version ||
    value.html_url !== `${RELEASE_REPOSITORY}/releases/tag/${value.tag_name}` ||
    !Array.isArray(value.assets)
  )
    return { kind: "invalid-response" };
  for (const asset of value.assets) {
    if (
      !record(asset) ||
      !positiveInteger(asset.id) ||
      typeof asset.name !== "string" ||
      typeof asset.state !== "string" ||
      typeof asset.size !== "number" ||
      !Number.isSafeInteger(asset.size) ||
      asset.size < 0
    )
      return { kind: "invalid-response" };
  }
  const uploaded = (name: string): boolean =>
    (value.assets as Record<string, unknown>[]).some(
      (asset) => asset.name === name && asset.state === "uploaded" && positiveInteger(asset.size),
    );
  const dottedInstaller = `AniStream.Setup.${version}.exe`;
  if (
    target === "mac-arm64"
      ? !uploaded(`AniStream-${version}-arm64.dmg`)
      : !uploaded(dottedInstaller) && !uploaded(`AniStream Setup ${version}.exe`)
  )
    return { kind: "no-compatible-release" };
  // In-app installation follows latest.yml, whose installer URL must be the exact name GitHub
  // serves. Older releases without it keep the manual "View release" path.
  const canInstall =
    target === "win-x64" && uploaded(dottedInstaller) && uploaded(WINDOWS_UPDATE_MANIFEST);
  return { kind: "release", version, releaseUrl: value.html_url as string, canInstall };
}

/** electron-builder's Windows update manifest, published beside the installer. */
export const WINDOWS_UPDATE_MANIFEST = "latest.yml";

/** The pinned per-release download base the Windows updater reads `latest.yml` from. */
export function releaseDownloadBase(version: string): string {
  return `${RELEASE_REPOSITORY}/releases/download/v${version}`;
}
