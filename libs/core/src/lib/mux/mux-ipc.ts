import { unlinkSync } from 'node:fs';
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
import { lockRuntime } from './runtime-lock.js';

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
    // A connection that fails ends; it never takes the owner with it.
    socket.on('error', () => socket.destroy());
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
  if (!(await claimEndpoint(server, runtime))) {
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

/**
 * Bind the endpoint; `false` when another owner holds it. A POSIX socket
 * that a crashed owner left behind refuses connections. It is removed
 * under the startup lock, and probed again there first, so a live
 * listener is never unlinked: a new one can only bind once the file is
 * gone, and only the lock holder removes it. Windows pipes end with
 * their server.
 */
async function claimEndpoint(
  server: Server,
  runtime: MuxRuntime
): Promise<boolean> {
  if (await bound(server, runtime.endpoint)) return true;
  if (process.platform === 'win32' || !(await refuses(runtime.endpoint)))
    return false;
  const lock = await lockRuntime(runtime);
  try {
    if (await refuses(runtime.endpoint)) unlinkSync(runtime.endpoint);
  } finally {
    lock.release();
  }
  return bound(server, runtime.endpoint);
}

/** Bind, or `false` when the address is in use. */
async function bound(server: Server, endpoint: string): Promise<boolean> {
  try {
    await bind(server, endpoint);
    return true;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'EADDRINUSE') throw err;
    return false;
  }
}

/** Whether a socket file is there with nobody listening on it. */
function refuses(endpoint: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const socket = createConnection(endpoint);
    socket.once('connect', () => {
      socket.destroy();
      resolve(false);
    });
    socket.once('error', (err: NodeJS.ErrnoException) => {
      if (err.code === 'ECONNREFUSED') resolve(true);
      else if (err.code === 'ENOENT') resolve(false);
      else reject(err);
    });
  });
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

/** How long a client keeps trying an owner that answers but has not
 *  published its credentials yet: it binds before it publishes. */
const PUBLISH_WAIT_MS = 2_000;

/**
 * Connect and authenticate to the running owner. An owner that answers
 * while `mux.json` is missing or still names its predecessor is in the
 * moment between binding and publishing, so the credentials are read
 * and the handshake tried again until `PUBLISH_WAIT_MS` passes. An
 * endpoint nobody answers on fails at once.
 */
export async function connectMux(
  runtime: MuxRuntime,
  timeoutMs = HANDSHAKE_TIMEOUT_MS
): Promise<AuthenticatedConnection> {
  const deadline = Date.now() + PUBLISH_WAIT_MS;
  for (;;) {
    const socket = await open(runtime.endpoint);
    try {
      const credentials = readCredentials(runtime);
      const rest = await authenticateToMux(socket, credentials, timeoutMs);
      return { socket, hostId: credentials.hostId, rest };
    } catch (err) {
      socket.destroy();
      if (!awaitingPublication(err) || Date.now() > deadline) throw err;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

function awaitingPublication(err: unknown): boolean {
  return (
    err instanceof MuxError &&
    (err.code === 'AUTH_FAILED' || err.code === 'HOST_NOT_RUNNING')
  );
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
