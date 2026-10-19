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
a dependency of `dev` and `build`. `typegen` (Next's route types, such as
`PageProps`, into `.next/types/`) runs after it, and `lint` and `typecheck`
depend on it: without those types the type-aware lint rules read the pages'
props as unresolved.

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

## The landing page

`src/app/(home)/page.tsx` composes the page from `src/components/landing/`;
its layout lives in `src/app/(home)/landing.css`. The chapters follow the
reader's role: coding, reviewing, Auto-fix, orchestrating, then Beam.

The hero's downloads (`landing/home-downloads.tsx`) point at the latest
GitHub release through `src/lib/release-assets.ts`, which reads the asset
names from `apps/desktop/release-assets.json`, the file the release
pipeline names its uploads from. `src/lib/platform.ts` guesses the
visitor's OS and CPU to highlight a button: macOS gets the matching
`.dmg`, and the Linux button opens a menu of AppImage and `.deb` for the
detected CPU, or both CPUs when it is unknown. Nothing on the site names a
release version. `/download` redirects permanently to the homepage's
install section (`next.config.mjs`).

The live demo (`landing/desktop-demo.tsx`) is inert until the visitor
activates it, so Tab passes over it and nothing in it takes focus on load.
Escape or Ctrl+Space inside it returns focus to the page. It is hidden at
1100px and below.

### Illustrations

`src/components/illustrations/` holds the animated SVG diagrams. Each one
renders through `Illustration` (`illustration.tsx`), which fits the drawing
into a shared 640-unit frame and plays it once it is mostly in view. The
server renders the final composition, and that is what readers who prefer
reduced motion see, so every diagram has to make sense at rest. Sequences
are written as `timeline()` beats (`timeline.ts`) and loop: hold the final
frame, fade, restart.

Draw n10's mechanics, not decoration: what owns a checkout, where a session
runs, who sends or posts a message. No robots, invented UI or ornamental
circuitry. Use the palette tokens (`--n10-sage` for local worktrees and
sessions, `--n10-sand` for review material or another machine, `--n10-mix`
for their overlap), rectangular panes with 0–4 unit radii, and Geist Mono
for branch names, paths and commands. A failure is labelled, not only
coloured. Essential labels render at 12–15 CSS px at every width the page
gives a diagram (down to about 335px on phones); drop secondary labels
rather than shrink them. Each piece has an accessible title and
description, and decorative parts stay out of the accessibility tree.

## README stills

The root README's hero stills, `docs/media/hero.png` and `hero-light.png`,
are the desktop demo at rest at 2x. `scripts/hero-stills/record.mjs` takes
them with Playwright on a fake clock, so each run produces the same image.

```sh
npx nx run website:sync-demo
node apps/website/scripts/hero-stills/record.mjs            # both themes
node apps/website/scripts/hero-stills/record.mjs --theme=light
```
