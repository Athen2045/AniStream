import { ipcMain, type IpcMainInvokeEvent, type WebContents } from "electron";
import type {
  IpcEventChannelMap,
  IpcInvokeArgs,
  IpcInvokeChannel,
  IpcInvokeResult,
} from "../shared/ipc";

type MaybePromise<T> = T | Promise<T>;

export function registerTrustedIpcHandler<Channel extends IpcInvokeChannel>(
  trustedRendererOrigin: string,
  channel: Channel,
  handler: (
    event: IpcMainInvokeEvent,
    ...args: IpcInvokeArgs<Channel>
  ) => MaybePromise<IpcInvokeResult<Channel>>,
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    assertTrustedIpcSender(event, trustedRendererOrigin);
    return handler(event, ...(args as IpcInvokeArgs<Channel>));
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
