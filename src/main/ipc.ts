import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import type {
  IpcEventChannelMap,
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeResult,
} from "../shared/ipc";
import { ipcArgValidators } from "./ipc-validation";
import { startDevTiming } from "./dev-performance";

type MaybePromise<T> = T | Promise<T>;

/**
 * Registers a handler behind two checks a raw `ipcMain.handle` gives up for
 * free: the sender-frame origin check below, and per-channel argument
 * validation (see ./ipc-validation) that replaces a blind `unknown[]` cast
 * with a real runtime shape check. Every domain module goes through this.
 */
export function registerTrustedIpcHandler<Channel extends IpcInvokeChannel>(
  trustedRendererOrigin: string,
  channel: Channel,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: IpcInvokeArgs<Channel>
  ) => MaybePromise<IpcInvokeResult<Channel>>,
): void {
  ipcMain.handle(channel, async (event, ...args: unknown[]) => {
    assertTrustedIpcSender(event, trustedRendererOrigin);
    const validatedArgs = ipcArgValidators[channel](args) as IpcInvokeArgs<Channel>;
    const finish = startDevTiming(channel);
    try {
      const result = await handler(event, ...validatedArgs);
      finish();
      return result;
    } catch (error) {
      finish("error");
      throw error;
    }
  });
}

export function sendTypedIpcEvent<Channel extends keyof IpcEventChannelMap>(
  target: WebContents,
  channel: Channel,
  payload: IpcEventChannelMap[Channel],
): void {
  if (!target.isDestroyed()) target.send(channel, payload);
}

export function assertTrustedIpcSender(
  event: Pick<IpcMainInvokeEvent, "senderFrame">,
  trustedRendererOrigin: string,
): void {
  const senderUrl = event.senderFrame?.url;
  if (!senderUrl || safeOrigin(senderUrl) !== trustedRendererOrigin) {
    throw new Error("AniStream rejected IPC from an untrusted frame.");
  }
}

function safeOrigin(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}
