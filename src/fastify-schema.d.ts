import "fastify";

// The route schema carries two fields Quality Bar consumes at runtime:
// `operationId` dispatches each route to its handler (see
// `registerApiRoutes`), and `security` declares which authentication schemes
// a route accepts (enforced by the product request hook). These were formerly
// contributed to `FastifySchema` by the OpenAPI plugin's type augmentation;
// they are declared here directly now that the plugin is gone.
declare module "fastify" {
  interface FastifySchema {
    operationId?: string;
    security?: Record<string, string[]>[];
  }
}
