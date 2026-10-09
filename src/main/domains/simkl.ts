import { registerTrustedIpcHandler } from "../ipc";
import type { SimklClient } from "../simkl/client";
import type { SimklService } from "../simkl/service";

export function registerSimklDomain(
  origin: string,
  client: SimklClient,
  service: SimklService,
): void {
  registerTrustedIpcHandler(origin, "simkl:status", () => service.status());
  registerTrustedIpcHandler(origin, "simkl:connect", () => client.startLogin());
  registerTrustedIpcHandler(origin, "simkl:cancel", () => client.cancelLogin());
  registerTrustedIpcHandler(origin, "simkl:disconnect", () => client.logout());
  registerTrustedIpcHandler(origin, "simkl:sync", () => service.sync());
  registerTrustedIpcHandler(origin, "simkl:profile", () => service.profile());
  registerTrustedIpcHandler(origin, "simkl:stats", () => service.stats());
  registerTrustedIpcHandler(origin, "simkl:title-ratings", (_event, ref) =>
    service.titleRatings(ref),
  );
}
