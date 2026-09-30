/**
 * Refuses every connection the app under test makes to a pull-request
 * provider's servers, and says so.
 *
 * The suite runs offline: GitHub is a fake `gh` on PATH, Azure DevOps a
 * fake `fetch` in the session host. A request that gets past them — a
 * provider pointed at a real organization, a fake that did not load, a
 * code path that talks to a host directly — would otherwise reach the
 * real service and pass or fail on what it answered. This refuses it
 * and writes it to `$N10_NETWORK_GUARD.log`, which fails the test
 * (`setup/network-guard.ts`).
 *
 * Loaded into the main process (`-r` on Electron's command line) and
 * the session host (`host-preload.cjs`). Every Node socket connects
 * through `net.Socket.prototype.connect` — `fetch` and `https` included
 * — so a provider host is refused there, in place of its DNS lookup.
 * In the main process Chromium's own requests (the windows, Electron's
 * `net`) are refused through each session's `webRequest`.
 *
 * It fails closed: each process writes `$N10_NETWORK_GUARD.<type>.loaded`
 * once it is in place, and the fixture runs no test without both.
 */
// A preload runs as CommonJS; built-ins are fetched without require.
const { appendFileSync, writeFileSync } = process.getBuiltinModule('node:fs');
const net = process.getBuiltinModule('node:net');

const BASE = process.env.N10_NETWORK_GUARD;

const PROVIDER =
  /(^|\.)(github\.com|githubusercontent\.com|dev\.azure\.com|visualstudio\.com)\.?$/i;

/** The same hosts as Chromium match patterns. */
const PROVIDER_URLS = [
  'github.com',
  '*.github.com',
  '*.githubusercontent.com',
  'dev.azure.com',
  '*.dev.azure.com',
  '*.visualstudio.com',
].map((host) => `*://${host}/*`);

function refuse(what) {
  appendFileSync(`${BASE}.log`, `${process.type}: ${what}\n`);
  return new Error(`the desktop e2e suite is offline; refused ${what}`);
}

/** A `connect` call's options and callback. Node hands its own calls
 *  over already normalized, as `[options, cb]`; a pipe or a bare port
 *  names no host. */
function normalized(args) {
  if (Array.isArray(args[0])) return args[0];
  if (args[0] && typeof args[0] === 'object') return [args[0], args[1]];
  if (typeof args[1] === 'string') {
    return [{ port: args[0], host: args[1] }, args[2]];
  }
  return [{}, undefined];
}

function guardSockets() {
  const connect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function guardedConnect(...args) {
    const [options, cb] = normalized(args);
    const { host } = options;
    if (typeof host !== 'string' || !PROVIDER.test(host)) {
      return connect.apply(this, args);
    }
    const error = refuse(`a connection to ${host}`);
    // Failed as its lookup, so the socket errors as it does for a host
    // that does not resolve, which every client already handles.
    const lookup = (_host, _options, done) => done(error);
    return connect.call(this, { ...options, lookup }, cb);
  };
}

function guardSessions() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron's module is not a Node built-in, and a preload is CommonJS.
  const { app } = require('electron');
  app.on('session-created', (session) => {
    session.webRequest.onBeforeRequest(
      { urls: PROVIDER_URLS },
      (details, callback) => {
        refuse(`${details.method} ${details.url}`);
        callback({ cancel: true });
      }
    );
  });
}

if (BASE) {
  guardSockets();
  if (process.type === 'browser') guardSessions();
  writeFileSync(`${BASE}.${process.type}.loaded`, '', 'utf8');
}
