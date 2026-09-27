# n10 website

The landing page and documentation for n10, at [n10.is](https://n10.is).
Next.js 16 (App Router) + [Fumadocs](https://fumadocs.dev), deployed to
Cloudflare Workers via [OpenNext](https://opennext.js.org/cloudflare).

## Commands

```sh
npx nx dev website           # http://localhost:3100
npx nx build website         # OpenNext build -> .open-next/
npx nx typecheck website
npx nx lint website
npx nx preview website       # real workerd runtime, http://localhost:8787
npx nx run website:deploy:check   # wrangler --dry-run, no credentials needed
npx nx run website:deploy         # needs CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID
```

`sync-content` (Fumadocs' MDX codegen into `.source/`) runs automatically as
a dependency of `dev`, `build` and `typecheck`.

## Conventions that differ from the rest of the repo

- **Imports are extensionless.** The workspace's `tsconfig.base.json` uses
  `moduleResolution: "nodenext"`, which is why other projects write
  `from '../../lib/utils.js'`. This project resolves with
  `moduleResolution: "bundler"` (required by Next) and does not extend the
  base tsconfig — see the comments in `tsconfig.json` and `tsconfig.app.json`.
- **`@/*` resolves to `./src/*`.** Declared only in this project's own
  `tsconfig.app.json`; the workspace has no path aliases elsewhere.
- **App code lives in `src/app/`, not `app/`.** The root ESLint config's
  type-aware rules only match `**/src/**`.
- **`next-env.d.ts` and `tsconfig.app.json`'s `jsx`/`include` fields are
  rewritten by Next itself** on `dev`/`build`/`typegen`. Don't hand-edit them
  back to something Next will just overwrite.

## The palette and type

`src/app/global.css` sets Fumadocs' `--color-fd-*` tokens from the two
colours of the mark (`src/components/logo.tsx`): the accent is sage taken
dark enough to carry white text, and the neutrals are warm greys leaning
toward sand. The raw brand colours are also exposed as `--n10-sage`,
`--n10-sand` and `--n10-mix` for decoration. The desktop app keeps its own
IDE palette; only `--radius` matches.

Type is Geist and Geist Mono through `next/font/google` (`src/app/layout.tsx`),
which downloads the files at build time and self-hosts them — the build
needs network access, the deployed site makes no request to Google.

Only two files are copied from the desktop app: `src/lib/cn.ts` and
`src/components/ui/button.tsx`. Fumadocs ships its own accordion, tabs,
callout, code block and search dialog — don't duplicate those.

## A build footgun: `NODE_ENV`

`scripts.build` is `NODE_ENV=production next build`, not plain `next build`.
If the ambient shell already has `NODE_ENV=development` set (true in some
dev-tooling environments), a bare `next build` can load a mixed
development/production React module graph partway through prerendering and
crash every route — including the synthetic `/_not-found` and
`/_global-error` pages — with `TypeError: Cannot read properties of null
(reading 'useContext')`. It reproduces on a stock, dependency-free Next 16
app, independent of anything in this project. Forcing `NODE_ENV=production`
in the script (rather than relying on the caller's environment) makes the
build deterministic regardless of how it's invoked.

## AI features

`/llms.txt` and `/llms-full.txt` are live (`src/app/llms.txt/route.ts`,
`src/lib/llms.ts`). The MCP endpoint (`/api/mcp`) and the "Ask AI" chat
dialog are not implemented yet: the version of `@fumadocs/cli` available
under this workspace's min-release-age constraint (`1.5.0`) doesn't ship
the `feature mcp` / `add ai/*` generators the newer Fumadocs docs describe.
Revisit once a newer CLI clears the cooldown, or hand-roll `/api/mcp` on
top of `source` and the Model Context Protocol SDK directly. The AI chat
dialog also needs a provider API key as a Worker secret before it's worth
adding.

## Deploying

The site is the `n10-website` Worker, served at `n10.is` through the
custom-domain route in `wrangler.jsonc` and at its `workers.dev` URL.
The `Deploy website` workflow (`.github/workflows/deploy-website.yml`)
runs on every push to master that affects the project, including changes
to `desktop` (an implicit dependency, for the demo):

- `deploy:check` builds and runs a wrangler dry run, which needs no
  credentials.
- `deploy` publishes with the `CLOUDFLARE_API_TOKEN` repository secret
  (Cloudflare's "Edit Cloudflare Workers" template, scoped to this
  account and the `n10.is` zone) and the `CLOUDFLARE_ACCOUNT_ID`
  repository variable. The step is skipped when the secret is absent.

Both first run `check-demo`, which fails the build when the hero's
desktop demo is missing from `.open-next/assets/desktop-demo/demo/`.
That is the path `src/components/landing/desktop-demo.tsx` loads in its
iframe; the page sits under `demo/` because of how `desktop:build-demo`
lays out its output.

## Media

The landing page's feature clips (`public/media/<clip>-<theme>.{webm,mp4}`
and `<clip>-<theme>-poster.webp`) exist in both themes. `DemoVideo`
(`src/components/demo-video.tsx`) plays the one matching the site's theme
and swaps recordings on a toggle without a reload, at the same time into
the clip; its poster is a `ThemeImage`, so only the shown theme's still
is fetched.

`scripts/record-media/record.mjs` re-records them. The desktop clips are
scripted with Playwright against the standalone demo (`sync-demo`), on
Playwright's fake clock, so each run produces the same frames. The `tui`
clip films the real TUI through `cli-wterm-host` against the README
demo's fixture repository. `scripts/convert-media.mjs` encodes the frames.
The `hero` target instead writes the root README's stills,
`docs/media/hero.png` and `hero-light.png`: the demo at rest, at 2x.

```sh
npx nx run website:sync-demo
npx nx run-many -t build -p cli cli-wterm-host
node apps/website/scripts/record-media/record.mjs            # every clip, both themes
node apps/website/scripts/record-media/record.mjs plan --theme=light
```

It needs ffmpeg, and tmux for the `tui` clip. The output changes only
when a clip is re-recorded, so run it by hand and commit the result
rather than making the build depend on ffmpeg and a browser.
