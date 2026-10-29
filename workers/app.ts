import { createRequestHandler } from "react-router";

declare module "react-router" {
  export interface AppLoadContext {
    cloudflare: { env: Env; ctx: ExecutionContext; cf?: IncomingRequestCfProperties };
  }
}

const requestHandler = createRequestHandler(
  () => import("virtual:react-router/server-build"),
  import.meta.env.MODE,
);

export default {
  async fetch(request, env, ctx) {
    return requestHandler(request, { cloudflare: { env, ctx, cf: request.cf as IncomingRequestCfProperties | undefined } });
  },
} satisfies ExportedHandler<Env>;
