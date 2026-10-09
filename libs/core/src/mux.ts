/**
 * `@n10/core/mux`: the user's local mux endpoint and its mutually
 * authenticated connections. Node only.
 */
export {
  acceptMuxClient,
  authenticateToMux,
  type MuxCredentials,
} from './lib/mux/mux-auth.js';
export {
  muxRuntime,
  readCredentials,
  type MuxRuntime,
} from './lib/mux/mux-endpoint.js';
export { MuxError, type MuxErrorCode } from './lib/mux/mux-error.js';
export {
  connectMux,
  listenMux,
  type AuthenticatedConnection,
  type ListenResult,
  type MuxOwner,
} from './lib/mux/mux-ipc.js';
