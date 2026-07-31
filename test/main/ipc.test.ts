import { describe, expect, it } from "vitest";
import { assertTrustedIpcSender } from "../../src/main/ipc";

type TrustedEvent = Parameters<typeof assertTrustedIpcSender>[0];

function eventFrom(url?: string): TrustedEvent {
  return {
    senderFrame: url ? { url } : null,
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
      eventFrom("https://megaplay.buzz/stream/ani/1/1/sub"),
      eventFrom("http://127.0.0.1:41731.evil.example/"),
      eventFrom(),
    ]) {
      expect(() => assertTrustedIpcSender(event, "http://127.0.0.1:41731")).toThrow(
        /untrusted frame/,
      );
    }
  });
});
