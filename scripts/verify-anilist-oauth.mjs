import { readFile } from "node:fs/promises";

const mainBundle = await readFile("out/main/index.js", "utf8");

if (mainBundle.includes('searchParams.set("response_type", "token")')) {
  throw new Error("AniList implicit OAuth is still present in the built main process.");
}

for (const requiredFragment of [
  'searchParams.set("response_type", "code")',
  'grant_type: "authorization_code"',
  '"find-generic-password"',
  '"add-generic-password"',
  '"delete-generic-password"',
  "display dialog",
  "AniList rejected the saved client secret",
]) {
  if (!mainBundle.includes(requiredFragment)) {
    throw new Error(`Built AniList OAuth flow is missing: ${requiredFragment}`);
  }
}

console.log("Verified AniList authorization-code flow and Keychain credential lookup.");
