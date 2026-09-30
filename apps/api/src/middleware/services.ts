import type { FastifyInstance } from 'fastify';
import type { ActivityLogService } from '../services/activity-log.service.js';
import type { ProjectService } from '../services/project.service.js';
import type { TaskService } from '../services/task.service.js';
import type { TodoService } from '../services/todo.service.js';
import type { TaskLinkService } from '../services/task-link.service.js';

/**
 * The services, built once and reached through a Fastify decorator.
 *
 * A route handler receives its service rather than constructing one. That matters
 * for more than tidiness: a service owns a transaction, and a handler that built
 * its own would hold a second Knex pool and open a transaction that the route's
 * other writes could not join. One service per process, one pool.
 */

export interface Services {
  readonly activityLog: ActivityLogService;
  readonly projects: ProjectService;
  readonly tasks: TaskService;
  readonly todos: TodoService;
  readonly taskLinks: TaskLinkService;
}

declare module 'fastify' {
  interface FastifyInstance {
    services: Services;
  }
}

export function decorateServices(app: FastifyInstance, services: Services): void {
  // Fastify 5 refuses a reference type as a decorator default, because it would
  // be one object shared by every request. The getter/setter pair stores it on the
  // instance instead, and the value is the same for the process's lifetime —
  // which is the point, so it is deliberately not per-request.
  app.decorate('services', services);
}

/** The services, for a handler. Throws rather than returning undefined. */
export function servicesOf(app: FastifyInstance): Services {
  const services = app.services;
  if (!services) {
    throw new Error('Services are not decorated on this instance; call decorateServices first.');
  }
  return services;
}
