/**
 * Canonical route table and the capability every route declares (MCP-14).
 *
 * `MCP-14` says the assistant can read and create, and can never mutate or
 * close. That holds only if the limit lives in the app rather than in the MCP
 * server, and it is auditable only if the declaration sits next to the route.
 * So the map below is the single list, and the capability middleware reads it.
 *
 * A route that declares nothing is refused. The default is deny, not allow
 * (AGENTS.md ground rule 7).
 */

/** Capabilities a principal can hold. Names read as actions, not as nouns. */
export const CAPABILITIES = {
  TASK_READ: 'task:read',
  TASK_CREATE: 'task:create',
  TASK_UPDATE: 'task:update',
  TASK_CLOSE: 'task:close',
  TIME_READ: 'time:read',
  TIME_WRITE: 'time:write',
  PROJECT_READ: 'project:read',
  PROJECT_WRITE: 'project:write',
  TAG_READ: 'tag:read',
  TAG_CREATE: 'tag:create',
  TAG_UPDATE: 'tag:update',
  CALENDAR_READ: 'calendar:read',
  CALENDAR_WRITE: 'calendar:write',
  REMINDER_READ: 'reminder:read',
  REMINDER_WRITE: 'reminder:write',
  KNOWLEDGE_READ: 'knowledge:read',
  KNOWLEDGE_WRITE: 'knowledge:write',
  REPORT_READ: 'report:read',
  SETTINGS_READ: 'settings:read',
  SETTINGS_WRITE: 'settings:write',
  EXPORT: 'data:export',
  IMPORT: 'data:import',
} as const;

export type Capability = (typeof CAPABILITIES)[keyof typeof CAPABILITIES];

/** The local user has everything. The MCP token has a subset, per Settings. */
export const LOCAL_USER_CAPABILITIES: readonly Capability[] = Object.values(CAPABILITIES);

/**
 * The highest-trust set the assistant may ever be granted. `task:close` is
 * absent on purpose: closing a task is the one action that writes a closure
 * record, and the closure gate (`FR-GATE-08`) is a human accountability step.
 */
export const MCP_MAX_CAPABILITIES: readonly Capability[] = [
  CAPABILITIES.TASK_READ,
  CAPABILITIES.TASK_CREATE,
  CAPABILITIES.TIME_READ,
  CAPABILITIES.TAG_READ,
  CAPABILITIES.TAG_CREATE,
  CAPABILITIES.PROJECT_READ,
  CAPABILITIES.CALENDAR_READ,
  CAPABILITIES.REMINDER_READ,
  CAPABILITIES.KNOWLEDGE_READ,
  CAPABILITIES.REPORT_READ,
];
