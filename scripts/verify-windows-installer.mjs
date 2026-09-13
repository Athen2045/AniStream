import { access, mkdtemp, rm } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

if (process.platform !== "win32") {
  throw new Error("The Windows installer check must run on Windows.");
}

const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const installerPath = resolve(process.argv[2] ?? `dist/AniStream Setup ${packageVersion}.exe`);
await access(installerPath);

const workspace = await mkdtemp(join(tmpdir(), "anistream-installer-"));
const installDirectory = join(workspace, "installed");
const userDataDirectory = join(workspace, "user-data");

try {
  run(installerPath, ["/S", `/D=${installDirectory}`]);
  const executable = join(installDirectory, "AniStream.exe");
  await access(executable);

  const app = spawn(executable, ["--no-sandbox", `--user-data-dir=${userDataDirectory}`], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
  });
  await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(
      () => reject(new Error("Installed AniStream did not start in time.")),
      15_000,
    );
    app.once("spawn", () => {
      clearTimeout(timeout);
      resolvePromise();
    });
    app.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  app.unref();
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000));
  if (app.pid) run("taskkill.exe", ["/PID", String(app.pid), "/T", "/F"]);

  const uninstaller = join(installDirectory, "Uninstall AniStream.exe");
  await access(uninstaller);
  run(uninstaller, ["/S"]);
  await waitForRemoval(installDirectory);
  console.log("Verified Windows installer install, launch, and uninstall lifecycle.");
} finally {
  await rm(workspace, { recursive: true, force: true });
}

function run(command, args) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, PATH: `${process.env.PATH ?? ""}${delimiter}${process.cwd()}` },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with code ${result.status}.`);
}

async function waitForRemoval(path) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    try {
      await access(path);
    } catch {
      return;
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
  }
  throw new Error(`Installer did not remove ${path}.`);
}
