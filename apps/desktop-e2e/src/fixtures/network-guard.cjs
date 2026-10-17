/**
 * Refuses every connection the app under test makes off this machine,
 * and says so.
 *
 * The suite runs offline: GitHub is a fake `gh` on PATH, Azure DevOps a
 * fake `fetch` in the session host, beam a fake control socket, the
 * update registry a loopback server. A request that gets past them — a
 * provider pointed at a real organization, a fake that did not load, an
 * update check, a code path that talks to a host directly — would
 * otherwise reach the real service and pass or fail on what it
 * answered. This refuses it and writes it to `$N10_NETWORK_GUARD.log`,
 * which fails the test (`setup/network-guard.ts`). Loopback is the
 * fakes' and stays open.
 *
 * Loaded into the main process (`-r` on Electron's command line) and
 * the session host (`host-preload.cjs`). Every Node socket connects
 * through `net.Socket.prototype.connect` — `fetch` and `https` included
 * — so a remote host is refused there, in place of its DNS lookup.
 * In the main process Chromium's own requests (the windows, Electron's
 * `net`) are refused through each session's `webRequest`, and so is
 * every URL handed to `shell.openExternal`, which would otherwise start
 * the system browser at it.
 *
 * It fails closed: each process writes `$N10_NETWORK_GUARD.<type>.loaded`
 * once it is in place, and the fixture runs no test without both.
 */
// A preload runs as CommonJS; built-ins are fetched without require.
const { appendFileSync, writeFileSync } = process.getBuiltinModule('node:fs');
const net = process.getBuiltinModule('node:net');

const BASE = process.env.N10_NETWORK_GUARD;

/** Hosts that stay on this machine: names and literals, bracketed or
 *  not. */
const LOOPBACK = /^(localhost|127(\.\d{1,3}){3}|\[?::1\]?)\.?$/i;

function isLoopback(host) {
  return LOOPBACK.test(host) || /\.localhost\.?$/i.test(host);
}

/** Chromium's requests that can leave the machine; the window itself
 *  loads from `file:`. */
const REMOTE_URLS = ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'];

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
    // No host is a pipe, a Unix socket or Node's default, localhost.
    if (typeof host !== 'string' || isLoopback(host)) {
      return connect.apply(this, args);
    }
    const error = refuse(`a connection to ${host}`);
    // Failed as its lookup, so the socket errors as it does for a host
    // that does not resolve, which every client already handles.
    const lookup = (_host, _options, done) => done(error);
    return connect.call(this, { ...options, lookup }, cb);
  };
}

function isRemoteUrl(url) {
  try {
    return !isLoopback(new URL(url).hostname);
  } catch {
    return false;
  }
}

/** Nothing opens outside the app under test. The app calls it as
 *  `void shell.openExternal(url)`, so a refusal resolves: nothing
 *  opens, and the log fails the test. */
function guardOpenExternal(shell) {
  shell.openExternal = function guardedOpenExternal(url) {
    refuse(`openExternal ${url}`);
    return Promise.resolve();
  };
}

function guardMain() {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- Electron's module is not a Node built-in, and a preload is CommonJS.
  const { app, shell } = require('electron');
  guardOpenExternal(shell);
  app.on('session-created', (session) => {
    session.webRequest.onBeforeRequest(
      { urls: REMOTE_URLS },
      (details, callback) => {
        if (!isRemoteUrl(details.url)) return callback({});
        refuse(`${details.method} ${details.url}`);
        callback({ cancel: true });
      }
    );
  });
}

if (BASE) {
  guardSockets();
  if (process.type === 'browser') guardMain();
  writeFileSync(`${BASE}.${process.type}.loaded`, '', 'utf8');
}
