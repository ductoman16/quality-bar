import "fastify";

declare module "fastify" {
  interface FastifySchema {
    operationId?: string;
    security?: Array<Record<string, unknown[]>>;
  }
}
