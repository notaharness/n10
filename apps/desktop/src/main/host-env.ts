/**
 * The session host's first act: put back the `NODE_OPTIONS` the app
 * was started with. The main process adds a `--require` for
 * `N10_HOST_REQUIRE` to the host's own (`host-process.ts`), and the
 * module it names has loaded by the time this runs; everything the
 * host starts afterwards — tmux, and every agent in a server it
 * creates, git, gh — must not load it too. Imported first by
 * `host-worker.ts`, so it runs before any other module of the host.
 */
export const HOST_REQUIRE = 'N10_HOST_REQUIRE';
/** The `NODE_OPTIONS` the app had, set when the host's were changed. */
export const HOST_NODE_OPTIONS = 'N10_HOST_NODE_OPTIONS';

export function restoreNodeOptions(env: NodeJS.ProcessEnv): void {
  delete env.N10_HOST_REQUIRE;
  if (!(HOST_NODE_OPTIONS in env)) return;
  const original = env.N10_HOST_NODE_OPTIONS;
  delete env.N10_HOST_NODE_OPTIONS;
  if (original) env.NODE_OPTIONS = original;
  else delete env.NODE_OPTIONS;
}

/** The host's environment: the app's, with where its data lives and,
 *  for `N10_HOST_REQUIRE`, a module to load before its own code — how
 *  tests put their fakes where the provider's requests are made. A
 *  utility process takes `--require` from `NODE_OPTIONS`, not from
 *  `execArgv`. */
export function hostEnv(
  env: NodeJS.ProcessEnv,
  userData: string
): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = { ...env, N10_USER_DATA: userData };
  const preload = env[HOST_REQUIRE];
  if (preload) {
    out[HOST_NODE_OPTIONS] = env.NODE_OPTIONS ?? '';
    out.NODE_OPTIONS = [
      env.NODE_OPTIONS,
      `--require ${JSON.stringify(preload)}`,
    ]
      .filter(Boolean)
      .join(' ');
  }
  return out;
}
