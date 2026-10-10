/**
 * `@n10/core/mux`: the user's local mux endpoint, its mutually
 * authenticated connections and the one-shot protocol over them. Node
 * only.
 */
export {
  acceptMuxClient,
  authenticateToMux,
  type MuxCredentials,
} from './lib/mux/mux-auth.js';
export { muxRequest, type MuxResponse } from './lib/mux/mux-client.js';
export {
  muxRuntime,
  readCredentials,
  type MuxRuntime,
} from './lib/mux/mux-endpoint.js';
export {
  isMuxErrorCode,
  MUX_EXIT_STATUS,
  MuxError,
  type MuxErrorCode,
} from './lib/mux/mux-error.js';
export { KEY_NAMES } from './lib/mux/mux-input.js';
export {
  connectMux,
  listenMux,
  type AuthenticatedConnection,
  type ListenResult,
  type MuxOwner,
} from './lib/mux/mux-ipc.js';
export {
  LIMITS,
  MUX_OPS,
  WIRE_VERSION,
  type MuxCapture,
  type MuxOp,
  type MuxStatus,
  type MuxSummary,
  type OwnerType,
} from './lib/mux/mux-protocol.js';
export { MUX_ENV } from './lib/managed-launch.js';
