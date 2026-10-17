/** Public domain surface; neighboring domains import this entry. */
export { createSessionService } from './session-service.js';
export type {
  SessionService,
  SessionSnapshot,
  SessionWatchPorts,
} from './session-service.js';
export type { SessionLaunch, SessionLaunchPorts } from './session-commands.js';
export { createTerminalService } from './terminal-service.js';
export type { TerminalLaunch, TerminalPorts } from './terminal-service.js';
export type { TerminalFacts } from './terminal-facts.js';
export { createSessionConnections } from './session-connections.js';
export type {
  AgentConnection,
  BranchCheckout,
  BranchSession,
  BranchSessions,
  BranchTerminal,
} from './branch-sessions.js';
