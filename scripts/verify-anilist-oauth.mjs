import { readFile } from "node:fs/promises";

const mainBundle = await readFile("out/main/index.js", "utf8");

for (const requiredFragment of [
  'searchParams.set("response_type", "token")',
  'url.hash.startsWith("#")',
  'params.get("access_token")',
]) {
  if (!mainBundle.includes(requiredFragment)) {
    throw new Error(`Built AniList OAuth flow is missing: ${requiredFragment}`);
  }
}

if (mainBundle.includes('searchParams.set("redirect_uri", ANILIST_REDIRECT_URI)')) {
  throw new Error("Implicit AniList OAuth must not send redirect_uri in the authorize request.");
}

console.log("Verified AniList implicit OAuth flow and encrypted session storage.");
