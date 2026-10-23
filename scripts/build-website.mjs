// Assembles the landing page in dist-website/ from website/, the README screenshots and icon,
// and the app's bundled font. Download links come from the latest GitHub release, written in at
// build time so visitors' browsers never call the GitHub API.
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "dist-website");
const repo = "Athen2045/AniStream";
const releasesUrl = `https://github.com/${repo}/releases/latest`;

function latestRelease() {
  try {
    const json = execFileSync(
      "gh",
      ["release", "view", "--repo", repo, "--json", "tagName,url,assets"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    const release = JSON.parse(json);
    const find = (pattern) => release.assets.find((asset) => pattern.test(asset.name))?.url;
    const win = find(/^AniStream\.Setup\.[\d.]+\.exe$/);
    const mac = find(/^AniStream-[\d.]+-arm64\.dmg$/);
    if (!win || !mac) throw new Error("release is missing an installer");
    return { version: release.tagName.replace(/^v/, ""), win, mac, url: release.url };
  } catch (error) {
    console.warn(`Latest release unavailable (${error.message}); linking to the releases page.`);
    return { version: "", win: releasesUrl, mac: releasesUrl, url: releasesUrl };
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "website"), out, { recursive: true });
cpSync(join(root, "assets", "screenshots"), join(out, "img"), { recursive: true });
for (const size of ["32", "128", "256"]) {
  cpSync(
    join(root, "assets", "app-icon", `AniStream-${size}.png`),
    join(out, "img", `icon-${size}.png`),
  );
}
mkdirSync(join(out, "fonts"), { recursive: true });
cpSync(
  join(root, "src", "renderer", "src", "assets", "fonts", "plus-jakarta-sans-variable.ttf"),
  join(out, "fonts", "plus-jakarta-sans-variable.ttf"),
);
cpSync(
  join(root, "src", "renderer", "public", "licenses", "plus-jakarta-sans-OFL.txt"),
  join(out, "fonts", "OFL.txt"),
);

const release = latestRelease();
const indexPath = join(out, "index.html");
const html = readFileSync(indexPath, "utf8")
  .replaceAll("{{VERSION}}", release.version ? `Version ${release.version}` : "Latest release")
  .replaceAll("{{WIN_URL}}", release.win)
  .replaceAll("{{MAC_URL}}", release.mac)
  .replaceAll("{{RELEASE_URL}}", release.url);
writeFileSync(indexPath, html);
console.log(`Built dist-website/ (${release.version || "no version"}).`);
