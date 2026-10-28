import { describe, expect, it } from "vitest";
import { assertTrustedIpcSender } from "../../src/main/ipc";

type TrustedEvent = Parameters<typeof assertTrustedIpcSender>[0];

function eventFrom(url?: string, parent: object | null = null): TrustedEvent {
  return {
    senderFrame: url ? { url, parent } : null,
  } as unknown as TrustedEvent;
}

describe("trusted IPC sender validation", () => {
  it("accepts only the configured renderer origin", () => {
    expect(() =>
      assertTrustedIpcSender(
        eventFrom("http://127.0.0.1:41731/assets/index.js"),
        "http://127.0.0.1:41731",
      ),
    ).not.toThrow();
  });

  it("rejects provider frames, missing frames, and lookalike origins", () => {
    for (const event of [
      eventFrom("https://player.example/a/1/1/sub"),
      eventFrom("http://127.0.0.1:41731.evil.example/"),
      eventFrom(),
      // A nested frame on the app's own origin is still not the window's page.
      eventFrom("http://127.0.0.1:41731/index.html", { url: "http://127.0.0.1:41731/index.html" }),
    ]) {
      expect(() => assertTrustedIpcSender(event, "http://127.0.0.1:41731")).toThrow(
        /untrusted frame/,
      );
    }
  });
});
