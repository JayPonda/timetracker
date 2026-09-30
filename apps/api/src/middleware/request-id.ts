import type { FastifyInstance, FastifyRequest } from 'fastify';

/**
 * A request id, so a log line, a browser error and a bug report can be
 * correlated.
 *
 * Fastify's own `requestId` is left alone: it is `req-1`, `req-2`, and it means
 * nothing outside one process. An id that appears in a log line **and** in the
 * response body and in an error popup is worth having, and the only cost is
 * honouring an inbound `x-request-id` when one is offered.
 */

declare module 'fastify' {
  interface FastifyRequest {
    /**
     * The id on every request.
     *
     * Non-optional because `registerRequestId` is installed before any route in
     * `createServer`. An optional id would push a `?? undefined` into every error
     * envelope, and an envelope that might lack the one field that ties a bug
     * report to a log line is worse than one that always has it.
     */
    requestId: string;
  }
}

const MAX_INBOUND_LENGTH = 128;

export function registerRequestId(app: FastifyInstance): void {
  // A primitive default, shared across requests, immediately overwritten in
  // `onRequest`. Fastify 5 disallows a shared reference type here, which is the
  // right restriction: it is what stops an accidental shared object.
  app.decorateRequest('requestId', '');

  app.addHook('onRequest', async (req, reply) => {
    const incoming = req.headers['x-request-id'];
    // Length-capped because the value is echoed into logs and into a response
    // body; an unbounded client-supplied string is a log-injection vector.
    const id =
      typeof incoming === 'string' && incoming.length > 0 && incoming.length <= MAX_INBOUND_LENGTH
        ? incoming
        : crypto.randomUUID();
    req.requestId = id;
    void reply.header('x-request-id', id);
  });
}

export function requestIdOf(req: FastifyRequest): string {
  return req.requestId;
}
