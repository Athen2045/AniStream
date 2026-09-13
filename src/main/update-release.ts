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
  | { kind: "release"; version: string; releaseUrl: string }
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
  if (
    !value.assets.some(
      (asset: Record<string, unknown>) =>
        (target === "mac-arm64"
          ? asset.name === `AniStream-${version}-arm64.dmg`
          : asset.name === `AniStream.Setup.${version}.exe` ||
            asset.name === `AniStream Setup ${version}.exe`) &&
        asset.state === "uploaded" &&
        positiveInteger(asset.size),
    )
  )
    return { kind: "no-compatible-release" };
  return { kind: "release", version, releaseUrl: value.html_url as string };
}
