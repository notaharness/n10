{
  lib,
  buildNpmPackage,
  importNpmLock,
  makeWrapper,
  nodejs,
  python3,
  electron_44,
  tmux,
  git,
  gh,
}:

let
  cli = lib.importJSON ../apps/cli/package.json;
in
buildNpmPackage {
  pname = "n10";
  inherit (cli) version;

  src = ../.;

  npmDeps = importNpmLock { npmRoot = ../.; };
  npmConfigHook = importNpmLock.npmConfigHook;

  nativeBuildInputs = [
    makeWrapper
    python3
  ];

  # The workspace has no root build script: Nx builds the CLI and the
  # desktop app, and prepare-publish assembles the package in apps/cli/dist.
  dontNpmBuild = true;
  dontNpmInstall = true;

  env = {
    # node-gyp compiles node-pty against these headers instead of downloading them.
    npm_config_nodedir = nodejs;
    # The Electron binary comes from nixpkgs (see the wrapper below).
    ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
    NX_DAEMON = "false";
    NX_NO_CLOUD = "true";
    NX_ISOLATE_PLUGINS = "false";
    # Nx's terminal UI and native task runner need a TTY, which the sandbox lacks.
    NX_TUI = "false";
    NX_NATIVE_COMMAND_RUNNER = "false";
  };

  buildPhase = ''
    runHook preBuild
    export HOME="$TMPDIR"
    npx nx run cli:prepare-publish --skip-nx-cache
    runHook postBuild
  '';

  # `dist` is the published package: what apps/cli's prepare-publish.mjs
  # lists in `files`, plus the manifest and README npm always packs (dist also
  # holds type declarations that don't ship). Its runtime dependencies are the ones
  # prepare-publish.mjs lists: node-pty (native, so external to both bundles),
  # the electron package (the launcher requires it for the binary's path) and
  # @notaharness/beam with its platform package.
  installPhase = ''
    runHook preInstall
    app=$out/lib/n10
    mkdir -p $out/bin $app/node_modules
    dist=apps/cli/dist
    cp -r $dist/*.js $dist/webp.wasm $dist/desktop $dist/LICENSE $dist/README.md \
      $dist/package.json $app/
    cp -r node_modules/node-pty node_modules/electron $app/node_modules/
    mkdir $app/node_modules/@notaharness
    cp -r node_modules/@notaharness/beam node_modules/@notaharness/beam-* \
      $app/node_modules/@notaharness/

    # ELECTRON_OVERRIDE_DIST_PATH is the electron package's own switch for
    # using an existing binary, so the first-run download never happens.
    makeWrapper ${lib.getExe nodejs} $out/bin/n10 \
      --add-flags $app/main.js \
      --prefix PATH : ${
        lib.makeBinPath [
          tmux
          git
          gh
        ]
      } \
      --set-default ELECTRON_OVERRIDE_DIST_PATH ${electron_44}/bin
    runHook postInstall
  '';

  meta = {
    description = cli.description;
    homepage = "https://n10.is";
    license = lib.licenses.mit;
    mainProgram = "n10";
    platforms = lib.platforms.linux;
  };
}
