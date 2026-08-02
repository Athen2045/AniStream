export interface AuthorizationTransactionOptions {
  timeoutMs: number;
  onTimeout: () => void;
}

export type AuthorizationCallbackResult<T> = { handled: false } | { handled: true; value: T };

/** Owns the lifecycle of one external-browser OAuth attempt. */
export class AuthorizationTransaction {
  private controller?: AbortController;
  private timeout?: ReturnType<typeof setTimeout>;
  private handlingCallback = false;

  public constructor(private readonly options: AuthorizationTransactionOptions) {}

  public get active(): boolean {
    return Boolean(this.controller);
  }

  public begin(): AbortSignal {
    this.cancel();
    this.controller = new AbortController();
    this.timeout = setTimeout(() => {
      this.finish(true);
      this.options.onTimeout();
    }, this.options.timeoutMs);
    return this.controller.signal;
  }

  public async handleCallback<T>(
    callback: (signal: AbortSignal) => Promise<T>,
  ): Promise<AuthorizationCallbackResult<T>> {
    if (!this.controller || this.handlingCallback) return { handled: false };
    const signal = this.controller.signal;
    this.handlingCallback = true;
    try {
      return { handled: true, value: await callback(signal) };
    } finally {
      this.finish(false);
    }
  }

  public cancel(): boolean {
    if (!this.controller) return false;
    this.finish(true);
    return true;
  }

  private finish(abort: boolean): void {
    if (this.timeout) clearTimeout(this.timeout);
    this.timeout = undefined;
    if (abort) this.controller?.abort();
    this.controller = undefined;
    this.handlingCallback = false;
  }
}
