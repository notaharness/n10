# Beam fleet: Desktop and browser ceremony

## Contract and scope

This is the implementation specification, including literal English UI copy. Braced names are interpolated as text, never HTML. Desktop work belongs in n10; the ceremony-page work belongs in beam and is handed to its player. No protocol change is required.

Protocol baseline: beam commit `2773502`, `docs/02-identity.md`, `docs/06-control-socket.md`, `docs/07-cli.md`, `docs/09-build-and-distribution.md`; checked against `internal/control/{ceremonies,flow,enrolment}.go`, `internal/ceremony/{result,slot}.go`, and `worker/public/index.html`. Desktop adapter: `apps/desktop/src/main/beam/`.

A fleet has one passkey. Each machine has a separate node key. Creating a fleet requires **two passkey prompts**: registration, then an assertion that authorizes this machine and yields the PRF directory secret. Joining and revoking each require one assertion. A successful slot POST is delivery of a browser result, not proof that enrolment or revocation succeeded. Only the daemon's wait result establishes completion.

## 1. Fleet in the sidebar

The guided Fleet contract is [beam’s guided-fleet design](https://github.com/notaharness/beam/blob/15baa784dda0604c2b1b87bcf5b52788c1f91964/docs/design/guided-fleet-ux.md).
Its literal copy and completion authority apply to both surfaces. This document
records Desktop placement and the compatibility evidence retained below.

Fleet is a collapsible section beside the workspace and repository picker.
Compact machine rows, add-machine instructions and typed reset stay inline.
Fleet **+** opens **Add a machine**; Fleet **…** exposes **Copy fleet fingerprint**
and **Reset fleet…**. The header’s native context menu offers the same actions.
Names and fingerprints remain selectable text. Status reflects observed machine
connectivity, never presumed browser or remote progress.

Create/join forms and passkey requests use the existing controlled Radix Dialog.
Controllers and dialog visibility live above the repository gate. **Keep working**,
close and Escape hide the dialog without cancelling its request. Fleet shows
**Passkey step in progress** and **Resume setup** while a request runs; a completed
join retains **Check fleet fingerprint** until answered. Forms and failed requests
also remain resumable. Closing returns focus to Fleet; resuming focuses the current
heading. Background progress never opens a hidden dialog or focuses another app.
**Cancel request** is the separate operation that asks beam to cancel.

## 2. Create, join and add

First run offers **Your machines, connected anywhere**, **Create a fleet** and
**Join a fleet**. The existing beam illustration, Tailscale attribution and
**More information** link remain. Forms ask for **Machine name** and, when
creating, **Fleet name** with “Shown in your passkey manager.” Blank names use
daemon defaults; invalid input stays intact.

Create explains “Save one passkey for your fleet, then use it to add this machine.
Expect two passkey prompts.” Join explains “Use the passkey for your existing
fleet. This takes one passkey prompt.” **Continue** starts the request.

Create steps are **1 of 2 · Save a passkey** and **2 of 2 · Add this machine**.
Join uses **Add this machine**. The handoff says **Next · browser or phone**;
create’s first step says “Save the passkey there. Come back here for the second
link.” Its second says “Use the passkey you just saved.” Join says “Use your
fleet’s passkey there. Come back here to see the result.” Each ceremony event
replaces the link and QR, including when hidden. The host opens each new link.

The comparison labels are **Action**, **Machine**, **Machine fingerprint**.
Action values remain exactly `Create fleet passkey for “{fleetName}”`,
`Add “{machine}” to fleet`, and `Remove “{machine}” from fleet`, derived from the
current URL. The fingerprint is grouped in fours. “Check the action, machine
name and machine fingerprint on the page.” **Open in browser**, **Copy link**
and QR refer to identical URL bytes. “Keep this link private. Requests expire
after five minutes.” The raw URL is not painted in the dialog.

Only daemon stages produce **Finding machines…**, **Updating machines…** or
**Finishing setup…**. Successful create closes the dialog and announces
**Fleet created**. Successful join shows **Check fleet fingerprint**:
“This machine joined. Before using remote connections, compare with a machine
already in your fleet: Fleet … → Copy fleet fingerprint.” **Matches** dismisses
it; **Doesn’t match** shows **Different fleet** and “Stop using remote connections.
Reset here, then join with your fleet’s passkey.” **Reset fleet…** opens the inline
confirmation. This is a human reminder, not a transport gate. It survives hidden
dialogs, collapse and repository changes for the current app session; restart
persistence is optional in the design and is not implemented.

**Add a machine** stays inline:

- **Next · your other machine** — “Open n10 Desktop → Fleet → Join a fleet.
  Use your existing fleet passkey.”
- “Or run this on the other machine:” `beam join --label my-server`, with
  **Copy command**. “Open its link or scan its QR code.”
- “Compare its fleet fingerprint with this:” with **Copy fleet fingerprint**.
- “Waiting for a new machine…” until a new verified identity is observed.

Known identities are captured when instructions open. Rename/reconnect cannot
complete adding. A new identity closes instructions and announces **{machine}
joined**, even when collapsed. **Close instructions** remains available.

## 3. Revoke and reset

Revoke confirms **Revoke access to {machine}?**, with **Machine fingerprint**:
“This permanently revokes this machine identity. Files and programs remain.
Offline machines learn when they reconnect. Reset cannot restore revoked access.”
**Revoke access** starts the request. The active dialog can be hidden and resumed.
Only the successful wait result closes it and announces **Access revoked here**,
with “Acknowledged by {n} peers. Offline peers learn when they reconnect.” The
acknowledgement count is result-time evidence; the row shows **Revoked**.

**Reset fleet here?** stays inline: “Disconnect this machine and delete queued
messages to its old peers. Other machines and your passkey stay unchanged.”
“This keeps this machine’s identity. It will not recover a lost passkey or undo
a revocation.” **Type reset to confirm** must equal `reset`; double submission
is prevented. Successful socket completion announces **Fleet reset here**, clears
local ceremony/publication UI, and returns to first-run choices. Failure retains
the typed confirmation and offers mapped explanation and **Details**.

## 4. Pending and recovery

Only daemon wait results establish completion. Browser delivery, prompt opening
and browser cancellation are not Desktop signals. Pending publication remains
inline after a dialog closes: **Saved here. Waiting to sync…** and “Directory
publication is pending; beam will retry while it runs.” Only matching publication
events clear it. No durable publication inventory is inferred after restart.

`lib/fleet/ceremony-errors.ts` maps daemon codes to recovery copy from the guided
design. Cancellation and expiry are explicit; expiry offers **Start a fresh
request**. Wrong passkey, missing PRF, directory read, storage and uncertain
completion remain distinct. Failed links disappear. **Details** contains selectable
plain text, never interpreted HTML. A PRF failure says “This passkey could not complete the request.” and “Update your browser and passkey manager, then start a fresh request.” The precise PRF explanation stays in **Details**; **Passkey help** opens alongside it.

Connection loss says **Reconnecting… Status may be out of date.** Mutations are
disabled until status is available. Existing status/peer refresh and publication
handling stay authoritative; no browser polling or new protocol is introduced.

## 5. Browser ownership

beam owns the standalone browser page. The guided design linked above is its
copy and layout contract: no client branding, breadcrumb, promotional footer or
illustration; CLI-first no-request instructions; explicit return to the originating
machine after delivery. Browser approval never claims daemon-confirmed membership
or revocation. The two create links remain separate. The browser cannot discover
the second link or advance itself to it. The compatibility evidence below remains
qualified; no mocked passkey test proves real provider support.

## 6. Fingerprints and privacy

Machine fingerprint identifies the node key whose add/remove statement is signed. Fleet fingerprint identifies the fleet credential public key. Comparing fleet fingerprints with an existing trusted machine checks the root adopted by a first join; it is necessary because a replaced page and colluding directory could substitute a different fleet. It is a human comparison, not proof of possession of a secret. The 64-bit display is abbreviated; backend checks use full IDs.

The ceremony URL authorizes writing one sealed answer, not reading it. Do not log, persist, attach to telemetry, or put it in a PR or report. “Do not share this link or QR code. Anyone who sees it can answer this request first.” Sharing deliberately between the owner's devices is supported. Passkey/private keys and PRF output never appear in UI or diagnostics.

## 7. Compatibility: evidence and exact user-facing help

Intro: “beam needs WebAuthn PRF, not just ordinary passkeys. PRF derives the key that encrypts your fleet directory. Support depends on the browser, operating system, passkey provider and sometimes the way a security key connects. The ceremony page checks browser capabilities, then verifies the selected passkey result.”

The table below is documentation evidence, **not an end-to-end tested matrix**. Preserve the distinction in the page's **Passkey compatibility** disclosure. Minimum browser crypto support and provider PRF support are separate requirements. Unsupported or unverified combinations must not be marketed as working.

| Layer/provider                          | Verified claim and source                                                                                 | Boundary / exact qualification                                                                                                                                                                                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Safari/WebKit                           | PRF added in Safari 18.0 [S2]; X25519 added in Safari 18.4 [S3]                                           | “For this page use Safari 18.4 or later. Safari 18.0 PRF support alone is insufficient.” The Safari 17 X25519 claim in beam docs/page is contradicted by WebKit.                                                                                                                               |
| Apple Passwords/iCloud Keychain         | Apple staff confirms platform/hybrid PRF behavior and a fix targeted for iOS 18.4 / macOS 15.4 betas [S4] | “Use updated Apple software. iOS/iPadOS 18.4+ with Safari 18.4+ is the page’s practical baseline; macOS Safari 18.4+ also needs a compatible provider.” Exact oldest supported macOS/provider pairing and shipping hybrid-fix status are **unverified**, not inferred from a beta statement.   |
| Firefox desktop                         | PRF on all desktop platforms from Firefox 139 [S5]; X25519 from 130 [S6]                                  | “Firefox 139+ on desktop has the browser features. Your passkey provider must still supply PRF.” Firefox 130 alone is not enough to promise PRF. Android/iOS combinations **unverified**.                                                                                                      |
| Chrome                                  | X25519 and getClientCapabilities in Chrome 133 on Android/ChromeOS/Linux/macOS/Windows [S7]               | “Chrome 133+ meets the encryption baseline. PRF must still be confirmed for your provider.” Exact first browser PRF release and Google Password Manager OS/version matrix **unverified from Google's primary sources**; do not claim Chrome 132 guarantees GPM PRF.                            |
| 1Password iOS                           | Stable 8.10.74 adds PRF for iOS 18 [S8]                                                                   | “1Password for iOS 8.10.74+ adds provider PRF support on iOS 18. This page also needs Safari/iOS 18.4+ for X25519.” No assertion about all older credentials or every browser/provider route.                                                                                                  |
| 1Password browser / Android             | Vendor announced extension beta 2.26.1 and Android beta 8.10.38 [S9]                                      | “PRF was introduced in these beta versions; earliest stable versions are unverified here. Update your provider and use the result check.” Do not present beta minima as stable release minima.                                                                                                 |
| YubiKey                                 | Vendor documents hmac-secret/PRF and transport/platform caveats [S10]                                     | “Use a PRF-capable FIDO2 key with a browser/OS that exposes it. A key supporting hmac-secret alone does not guarantee WebAuthn PRF.” Exact firmware/OS minima **unverified**. Vendor's Safari exclusion may be stale against newer OS releases: do not assert universal permanent non-support. |
| Windows Hello                           | No independently verified Microsoft release/OS support matrix in this review                              | **Unverified**; do not equate browser support with Windows Hello support.                                                                                                                                                                                                                      |
| Bitwarden, Proton Pass, other providers | Provider PRF for arbitrary relying parties not verified here                                              | **Unverified**. Ability to unlock that provider's own vault using PRF does not prove it returns PRF for beam credentials.                                                                                                                                                                      |
| Edge / Samsung Internet                 | No independent vendor minimum verified here                                                               | **Unverified**; do not copy Chrome version numbers onto other products. Use runtime checks.                                                                                                                                                                                                    |

For the reported iPhone failure, do not infer the selected provider, iOS version, browser version or reason from “iPhone”. Provide the missing primitive (`prf.enabled` or 32-byte `prf.results.first`), show the table, and explain how to choose/update the provider. A successful Firefox attempt is evidence for that tested combination only.

### Primary sources

- [S1: W3C WebAuthn client capabilities and PRF](https://w3c.github.io/webauthn/#sctn-getClientCapabilities): missing keys can mean unknown; true describes client support, not authenticator support.
- [S2: WebKit Safari 18.0 release](https://webkit.org/blog/15865/webkit-features-in-safari-18-0/).
- [S3: WebKit Safari 18.4 release](https://webkit.org/blog/16574/webkit-features-in-safari-18-4/).
- [S4: Apple staff on PRF hybrid results](https://developer.apple.com/forums/thread/764730). Only staff statements are evidence; user comments are not vendor guarantees.
- [S5: Mozilla Firefox 139 developer release notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/139).
- [S6: Mozilla Firefox 130 developer release notes](https://developer.mozilla.org/en-US/docs/Mozilla/Firefox/Releases/130).
- [S7: Chrome 133 release notes](https://developer.chrome.com/release-notes/133).
- [S8: 1Password iOS stable release notes, 8.10.74](https://releases.1password.com/ios/stable/#1password-for-ios-8.10.74).
- [S9: 1Password PRF announcement](https://1password.com/blog/encrypt-data-saved-passkeys).
- [S10: Yubico developer PRF guide](https://developers.yubico.com/WebAuthn/Concepts/PRF_Extension/Developers_Guide_to_PRF.html).

## 8. Verification

Desktop e2e covers both passkey steps, automatic create/revoke/reset completion,
persistent fingerprint comparison, new-member detection across collapse, retry and
pending publication. Fleet screenshots cover both themes in the pinned Playwright
container alongside full-workspace baselines. The website demo uses the same renderer
with a mock host; no machine joins it on its own.

Real browser/provider compatibility remains manual; mocked passkeys do not establish
device support. Tests isolate HOME and tmux sockets and never touch user sessions.
