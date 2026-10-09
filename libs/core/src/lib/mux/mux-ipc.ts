import {
  createConnection,
  createServer,
  type Server,
  type Socket,
} from 'node:net';
import {
  acceptMuxClient,
  authenticateToMux,
  HANDSHAKE_TIMEOUT_MS,
} from './mux-auth.js';
import {
  ensureRuntimeDir,
  freshCredentials,
  publishCredentials,
  readCredentials,
  type MuxRuntime,
} from './mux-endpoint.js';
import { MuxError } from './mux-error.js';

/** Connections still proving themselves at once; more are dropped. */
const MAX_PENDING_HANDSHAKES = 8;

export interface MuxOwner {
  hostId: string;
  close(): Promise<void>;
}

export interface AuthenticatedConnection {
  socket: Socket;
  hostId: string;
  /** Bytes the peer sent after its handshake line. */
  rest: Buffer;
}

export type ListenResult =
  | { kind: 'owner'; owner: MuxOwner }
  | { kind: 'existing'; hostId: string };

/**
 * Become the user's mux owner, or find the one already running.
 *
 * The endpoint is bound before the credentials are published, so only
 * the process that won the bind publishes. Address-in-use means another
 * owner: it is authenticated against the published credentials and
 * reported, never displaced; one that cannot authenticate is an error
 * and its endpoint is left alone.
 */
export async function listenMux(
  runtime: MuxRuntime,
  onClient: (connection: AuthenticatedConnection) => void
): Promise<ListenResult> {
  ensureRuntimeDir(runtime);
  const credentials = freshCredentials();
  let pending = 0;
  const server = createServer((socket) => {
    if (pending >= MAX_PENDING_HANDSHAKES) {
      socket.destroy();
      return;
    }
    pending++;
    acceptMuxClient(socket, credentials).then(
      (rest) => {
        pending--;
        onClient({ socket, hostId: credentials.hostId, rest });
      },
      () => {
        pending--;
      }
    );
  });
  try {
    await bind(server, runtime.endpoint);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    const existing = await connectMux(runtime);
    existing.socket.destroy();
    return { kind: 'existing', hostId: existing.hostId };
  }
  publishCredentials(runtime, credentials);
  return {
    kind: 'owner',
    owner: {
      hostId: credentials.hostId,
      close: () =>
        new Promise<void>((resolve) => {
          server.close(() => resolve());
        }),
    },
  };
}

function bind(server: Server, endpoint: string): Promise<void> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(endpoint, () => {
      server.off('error', reject);
      resolve();
    });
  });
}

/** Connect and authenticate to the running owner. */
export async function connectMux(
  runtime: MuxRuntime,
  timeoutMs = HANDSHAKE_TIMEOUT_MS
): Promise<AuthenticatedConnection> {
  const credentials = readCredentials(runtime);
  const socket = await open(runtime.endpoint);
  const rest = await authenticateToMux(socket, credentials, timeoutMs);
  return { socket, hostId: credentials.hostId, rest };
}

function open(endpoint: string): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    socket.once('connect', () => {
      socket.off('error', onError);
      resolve(socket);
    });
    const onError = (err: NodeJS.ErrnoException) =>
      reject(
        err.code === 'ENOENT' || err.code === 'ECONNREFUSED'
          ? new MuxError('HOST_NOT_RUNNING', 'No n10 mux owner is running')
          : err
      );
    socket.once('error', onError);
  });
}
