/**
 * The session host's end of its channel to the frontend. Forked by the
 * desktop as a utility process it has `process.parentPort`; run as
 * `n10 host --stdio` (in WSL, over SSH) it has its stdin and stdout,
 * framed by `host-wire.ts`. The host's code is the same either way.
 */
import { homedir } from 'node:os';
import type { HostToMain, MainToHost } from './host-protocol.js';
import {
  encodeFrame,
  encodeHello,
  HOST_PROTOCOL,
  lineReader,
  parseLine,
} from './host-wire.js';

export interface HostChannel {
  /** Behind a pipe, on a machine the frontend may not share. */
  readonly remote: boolean;
  post(message: HostToMain): void;
  /** `ended` runs once the frontend has gone: its pipe closed. A
   *  utility process ends with the app instead. */
  listen(onMessage: (message: MainToHost) => void, ended: () => void): void;
}

export function openHostChannel(
  env: NodeJS.ProcessEnv = process.env
): HostChannel {
  const port = (process as { parentPort?: Electron.ParentPort }).parentPort;
  if (port) {
    return {
      remote: false,
      post: (message) => port.postMessage(message),
      listen: (onMessage) =>
        port.on('message', ({ data }: { data: MainToHost }) => onMessage(data)),
    };
  }
  return stdioChannel(env);
}

function stdioChannel(env: NodeJS.ProcessEnv): HostChannel {
  // Stdout is the protocol's: everything the host would print goes to
  // stderr, which the frontend logs.
  const toStderr = (...args: unknown[]) => console.error(...args);
  console.log = toStderr;
  console.info = toStderr;
  console.debug = toStderr;
  process.stdout.write(
    encodeHello({
      protocol: HOST_PROTOCOL,
      version: env.N10_HOST_VERSION ?? 'dev',
      platform: process.platform,
      home: homedir(),
      ...(env.WSL_DISTRO_NAME ? { distro: env.WSL_DISTRO_NAME } : {}),
      ...(process.argv[1] ? { entry: process.argv[1] } : {}),
    })
  );
  return {
    remote: true,
    post: (message) => process.stdout.write(encodeFrame(message)),
    listen: (onMessage, ended) => {
      const read = lineReader(
        (line) => {
          const parsed = parseLine(line);
          if (parsed.kind === 'message')
            onMessage(parsed.message as MainToHost);
          else if (line)
            console.error('[host] ignored input:', line.slice(0, 200));
        },
        () => {
          console.error('[host] input line too long; closing');
          ended();
        }
      );
      process.stdin.on('data', read);
      process.stdin.once('end', ended);
      // How a later host takes over (`host-lock.ts`).
      process.once('SIGTERM', ended);
      // A frontend that is gone leaves nothing to write to.
      process.stdout.on('error', ended);
    },
  };
}
