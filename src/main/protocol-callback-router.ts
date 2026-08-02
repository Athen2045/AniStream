/** Buffers one macOS custom-protocol callback until the owning client is ready. */
export class ProtocolCallbackRouter {
  private pending?: string;
  private handler?: (url: string) => Promise<void>;

  public route(url: string): void {
    if (!this.handler) {
      this.pending = url;
      return;
    }
    void this.handler(url);
  }

  public attach(handler: (url: string) => Promise<void>): void {
    this.handler = handler;
    if (!this.pending) return;
    const pending = this.pending;
    this.pending = undefined;
    void handler(pending);
  }
}
