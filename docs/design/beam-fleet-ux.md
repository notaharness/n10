# Beam fleet: Desktop and browser ceremony

## Contract and scope

This is the implementation specification, including literal English UI copy. Braced names are interpolated as text, never HTML. Desktop work belongs in n10; the ceremony-page work belongs in beam and is handed to its player. No protocol change is required.

Protocol baseline: beam commit `2773502`, `docs/02-identity.md`, `docs/06-control-socket.md`, `docs/07-cli.md`, `docs/09-build-and-distribution.md`; checked against `internal/control/{ceremonies,flow,enrolment}.go`, `internal/ceremony/{result,slot}.go`, and `worker/public/index.html`. Desktop adapter: `apps/desktop/src/main/beam/`.

A fleet has one passkey. Each machine has a separate node key. Creating a fleet requires **two passkey prompts**: registration, then an assertion that authorizes this machine and yields the PRF directory secret. Joining and revoking each require one assertion. A successful slot POST is delivery of a browser result, not proof that enrolment or revocation succeeded. Only the daemon's wait result establishes completion.

## 1. Fleet in the sidebar

Fleet is a collapsible section in the workspace sidebar and beside the repository
picker. Its controller lives above the repository gate: forms, passkey requests,
fingerprint checks and add-machine tracking survive collapsing, hiding the sidebar
and switching repositories. The status bar and Settings reveal and focus the section.

The header shows a concise state. An enrolled fleet has a small **+** at its right
edge, with **Add a machine** as its accessible label and tooltip. It opens and expands
the instructions. It is disabled while reconnecting, resetting or completing a passkey
flow. Beside it, **Fleet actions** (“…”) opens a menu holding **Reset fleet…**; a
right-click on the header opens the same entry as a native context menu. Choosing it
expands the section. The entry is disabled while reconnecting, completing a passkey
flow or already confirming. Both buttons are siblings of the collapse trigger.

The overview shows compact machine rows, local first. The fleet fingerprint is not
part of it; it appears where it is compared: **Add a machine** and the post-join check.
Rows show name, connection state and fingerprint; queue and access
badges appear when relevant. Offline and revoked states use text and colour.
An otherwise empty fleet says
“Your other machines will appear here.” Shared primitives and colour tokens serve both
themes. Fleet stays within the sidebar’s scroll area.

## 2. Create, join and add

First run says **Your machines, together**, with one sentence explaining passkey and
command access. **Create a fleet** and **Join a fleet** are prominent. Forms ask for
**Machine name**, and for creation **Fleet name** (“Shown in your passkey manager.”).
Blank names use daemon defaults; invalid names stay intact. Creation explains only
“Save a passkey, then use it to add this machine.”

Creation shows **1 of 2 · Save a passkey**, then **2 of 2 · Add this machine**.
Each step replaces the previous link and QR. The browser comparison shows action,
machine and fingerprint, with “Check the action, machine and fingerprint on the page.”
The privacy line is “Keep this link private. It expires in 5 minutes.” **Open in
browser**, **Copy link** and explicit **Cancel** are available while waiting.
Post-passkey progress says “Finding machines…”, “Updating machines…” or “Finishing
setup…”, without protocol explanations.

Successful creation returns directly to the overview and announces **Fleet created**.
A successful join keeps **Check fleet fingerprint**, the grouped fingerprint and
“Compare with a machine already in your fleet.” **Matches** and **Doesn’t match**
record a human security decision. A mismatch says “Stop using remote connections.
Reset here, then join with your fleet’s passkey.” This is advice, not a transport gate;
membership is already established by the daemon.

**Add a machine** has two short paths:

- **Desktop:** “On the other machine, open Fleet → Join a fleet. Use your fleet’s passkey.”
- **Terminal:** `beam join --label buildbox`, a copy icon, and “Run there, then open the link or scan the QR.”

A fingerprint block says “Check that its fleet fingerprint matches:” above the grouped
value and a copy icon. “Waiting for a new machine…” reflects the waiting state. A new member identity from a push or fallback poll
closes the panel, including while collapsed. Renames and reconnects cannot complete
adding. **Close instructions** lets the owner leave early; there is no Done button.

## 3. Revoke and reset

Revocation uses a modal with target name and fingerprint. It explains permanence,
offline propagation, that files and programs remain, and that reset cannot restore
revoked access. **Revoke access** starts the passkey request; **Cancel** is explicit
while running. Success closes the modal, updates the row and announces **Access
revoked**, with the offline propagation reminder.

**Reset fleet here?** stays inline. It explains disconnection and queued-message loss,
that other machines and the passkey are unchanged, and that reset cannot recover a
lost passkey or undo revocation. The owner types `reset` exactly. Success returns to
first-run choices. Failure keeps the typed value and offers retry or cancel.

## 4. Pending and error states

Only the daemon’s final result establishes success. A saved change awaiting publication
says **Saved here. Waiting to sync…**, remaining until its matching publication event.
Automatic completion does not discard this notice.

Connection states say **Starting Fleet…**, **Connecting…**, **Reconnecting… Status may
be out of date.**, or **Fleet is unavailable.** with **Retry**. Machine loading errors
have their own retry. Technical details are in a collapsed **Details** disclosure.

`lib/fleet/ceremony-errors.ts` owns concise error copy and actions. Failures distinguish
wrong or unsupported passkeys, cancellation, expiry, storage, revoked access and
uncertain completion. **Passkey help** advises an updated browser/provider or another
device with the same passkey. A new passkey is never a way to join an existing fleet.
Failed creation warns that a passkey may already have been saved. Codes and daemon
text remain selectable plain text in **Details**; stale links disappear and retries
start a fresh request.

The browser handoff and source evidence below are beam reference material; Desktop
does not reproduce the compatibility matrix or protocol copy.

## 5. beam.n10.is page: implementation handoff

Edit `worker/public/index.html` and regenerate the existing CSP hashes in `_headers`, with beam's tests. Keep the static page, existing WebAuthn and HPKE protocol, one slot write, no cookies, analytics, external scripts, directory requests, local storage of results or secrets, or loopback listener. This document does not authorize deploying it.

### Layout and request validation

Single column, max width 36rem, usable at 320px, light/dark system theme. Order: beam brand; operation heading; step explanation; action/machine/fingerprint summary; safety copy; compatibility result and expandable support table; primary button; live progress/result; next action. Names wrap, fingerprints are selectable, touch targets at least 44px. Errors use `role=alert`; progress `role=status`; focus the terminal result heading. Keep technical detail collapsed but readily available.

Accept only known `o=c|a|r`, unique required parameters `o,s,k,c,l,f` (and `n` for create, default fleet name if omitted), correctly shaped slot (22 base64url chars decoding to 16 bytes), `k` (32 bytes), challenge (32 bytes), and `f` (16 lowercase hex chars). Validate label/fleet-name bounds as above. Unknown extra parameters can be ignored, but do not infer authorization or extra protocol states from them. Render names only with `textContent`. Validate structure before importing the key so malformed keys do not masquerade as unsupported crypto.

- No fragment: heading “Connect your machines with beam”; body “Start in n10 Desktop → Fleet, or run beam init or beam join. Open the link or scan the QR code shown there.” No passkey button. Compatibility help remains accessible.
- Invalid/incomplete fragment: “This link is incomplete or invalid. Return to n10 Desktop or your terminal and start again for a fresh link.” No passkey button or slot write.
- Safety copy on every valid request: “Continue only if you started this request just now. Compare the action, machine name and machine fingerprint with n10 Desktop or your terminal.” Labels: **Action**, **Machine**, **Machine fingerprint**; never call `f` a fleet fingerprint.

### Literal Action values shared by Desktop and the page

Both surfaces render the label **Action** with exactly the value below, derived from the current ceremony URL fragment. These are action-summary values, separate from the headings, step indicators and button labels above and below.

| Fragment `o` | Exact Action value               | Fields and meaning                                                                                                                                                                                                        |
| ------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `c`          | `Create fleet passkey for “{n}”` | `n` is the fleet display name used for passkey registration, defaulting to `beam` when omitted. This creates the credential; it does not yet authorize the machine or finish fleet creation.                              |
| `a`          | `Add “{l}” to fleet`             | `l` is the machine whose membership statement is being signed. Use this same value for init step 2, a new join and a re-join. The fragment cannot distinguish those flows and carries no fleet name or fleet fingerprint. |
| `r`          | `Remove “{l}” from fleet`        | `l` is the machine being revoked, not necessarily the machine that initiated the request. This signs permanent revocation of that machine identity. The fragment carries no fleet name or fleet fingerprint.              |

Decode `n` and `l` with `URLSearchParams`, validate them, then interpolate as text. Preserve the literal quotation marks shown above. For every kind, the adjacent **Machine** value is `{l}` and **Machine fingerprint** is `{f}` grouped in fours. `f` identifies that machine's node key, never the fleet. During `c`, these identify the machine that will be authorized in the next step; they do not imply registration already authorized it. `c` (the fragment field, as distinct from the value `o=c`) is the encoded challenge; `s` is the slot and `k` the answer-encryption public key. None is an additional human-readable action or fleet identifier. Unknown or invalid `o` has no Action value or approval button; use the invalid-link state.

### Capability detection before any passkey prompt

1. Check secure context, `PublicKeyCredential`, and `navigator.credentials.create/get`. Missing: “This browser cannot run a WebAuthn passkey request. Open this link in an up-to-date browser.” No automatic prompt.
2. Import validated X25519 public key, then exercise ephemeral generate/export/derive plus HPKE prerequisites locally with disposable data; an import alone is insufficient. Failure: “This browser cannot encrypt beam’s answer. It needs X25519 in Web Crypto. Use Safari 18.4+, Chrome 133+, or Firefox 130+; passkey PRF support is also required.” No automatic slot write if sealing is unavailable. **Copy link** remains available; say “Return to the originating machine to cancel or restart.”
3. If available, await `PublicKeyCredential.getClientCapabilities()` with a bounded UI wait (e.g. 3 seconds; timeout is unknown, not unsupported). Read `capabilities['extension:prf']` exactly. Explicit true: “Browser PRF support detected. Your selected passkey provider must support PRF too.” Explicit false: “This browser reports that WebAuthn PRF is unavailable. Choose a supported browser before continuing.” Disable primary approval, offer copy/help and **Cancel request**. Missing method/key, thrown exception, or timeout: “This browser cannot confirm PRF support in advance. You can try; beam will check the selected passkey’s result.” Allow approval. Do not use `isUserVerifyingPlatformAuthenticatorAvailable()` as a PRF test and do not reject a USB key because no platform authenticator exists.
4. A false preflight is advisory about this browser, not proof about a provider, and does not consume the slot automatically. A browser extension may replace native credential handling. **Try anyway** is an explicit secondary override for false, with copy “Your provider may handle passkeys separately from the browser. beam still requires a valid PRF result.” No UA-derived hard gate. See W3C source [S1].
5. Definitive check after `create`: `getClientExtensionResults().prf?.enabled === true`. After `get`: `prf.results.first` must be exactly 32 bytes. Missing/false/wrong-size produces `prf-unsupported`; never derive a fallback from a signature, password or credential ID. Never evaluate/use PRF output from registration to establish beam's directory secret.

### Ready and active steps

| URL operation | Heading and explanation                                                                                                                                                                                     | Primary button / active copy                                                                 |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `c`           | “Step 1 of 2 · Create your fleet passkey”. “Save a passkey for {fleetName} at beam.n10.is. This creates the fleet’s credential. A second prompt will authorize {label} and unlock its encrypted directory.” | **Create passkey** / “Waiting for your passkey manager to create the passkey…”               |
| `a`           | “Authorize {label}”. “Use your fleet’s passkey to sign this machine’s membership and unlock the encrypted directory. If you just created a fleet passkey, this is step 2 of 2.”                             | **Authorize machine** / “Waiting for your fleet passkey…”                                    |
| `r`           | “Remove {label} from your fleet”. “Use your fleet’s passkey to permanently revoke this machine identity. Offline machines learn when they reconnect.”                                                       | destructive **Authorize removal** / “Waiting for your fleet passkey to sign the revocation…” |

`o=a` is shared by init step 2 and join. The page cannot reliably tell which it is. Do not label every `a` as step 2 or use referrer/session storage to guess. After `c` succeeds, the page cannot open the second URL: it does not have it. The originating desktop/terminal supplies it.

On explicit primary click, disable duplicate submission and run the existing WebAuthn call. Keep safety summary visible. Local **Cancel request** aborts an outstanding WebAuthn request with AbortController and sends `cancelled` once; use one settled state to avoid duplicate sends from the abort catch. Without an active call, Cancel sends `cancelled` if sealing is available. Closing a browser tab is not reliable cancellation: no unload network hack. The daemon eventually times out. A browser `NotAllowedError` does not distinguish user cancellation from timeout/no eligible credential.

### Result delivery and every terminal state

Seal the result form using the existing HPKE suite and POST ciphertext to `/v1/slots/{slot}`. During this: “Sending the encrypted answer to your machine…”. Use the same terminal handling for all four result codes; **never overwrite an error with generic Done after a 201**.

| Condition                                       | Exact terminal copy / next action                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 201 after `ok`, `c`                             | “Passkey created. One more step.” / “Return to n10 Desktop or your terminal. Open the new link or scan the new QR code, then use this same passkey to authorize {label}. This page cannot open the second step.”                                                                                                                                                                                                                                   |
| 201 after `ok`, `a`                             | “Approval sent.” / “Return to {label} to check whether it joined. beam still needs to verify the answer and finish directory work. After joining, compare the fleet fingerprint with a machine already in your fleet.”                                                                                                                                                                                                                             |
| 201 after `ok`, `r`                             | “Revocation approval sent.” / “Return to your originating machine to check that the revocation completed and see its publication and acknowledgement status.”                                                                                                                                                                                                                                                                                      |
| 201 after `prf-unsupported`                     | “This passkey did not provide WebAuthn PRF.” / “beam needs PRF to derive its encrypted directory key. The browser, OS and selected passkey provider must support it. Return to your machine and start a fresh request using a supported combination.” Show support table; create adds “A passkey may have been saved, but fleet creation is not complete.” Join/revoke adds “Use the same fleet passkey; a new passkey creates a different fleet.” |
| 201 after `cancelled`                           | “Passkey request cancelled or not allowed.” / “The browser did not return a passkey. You may have cancelled, the prompt may have expired, or no eligible passkey was available. Return to your machine to try again with a fresh link.”                                                                                                                                                                                                            |
| 201 after `failed`                              | “The passkey request failed.” / “The browser could not complete the request. Return to your machine and try a fresh request.” Show DOMException name, if available, as technical detail; do not claim PRF failure without its result.                                                                                                                                                                                                              |
| 409 for any result                              | “This request was already answered.” / “Another device, or an earlier attempt on this device, sent the first answer. Check the originating machine. If you did not approve that answer and it enrolled, reset the fleet on that machine. A reset does not undo a completed revocation.” Do not retry this slot or claim compromise established.                                                                                                    |
| Network failure / response lost                 | “Could not confirm delivery.” / “Check the originating machine before starting again: it may have received your answer. If it is still waiting, cancel there and start a fresh request.” No automatic replay or second passkey call.                                                                                                                                                                                                               |
| 429                                             | “Too many requests.” / “beam.n10.is did not accept this answer. Wait a minute, then cancel the pending request on the originating machine and start again.”                                                                                                                                                                                                                                                                                        |
| Other HTTP rejection, including 400/404/413/5xx | “beam.n10.is did not accept the answer (HTTP {status}). Return to the originating machine and start a fresh request.” Distinguish delivery failure from the WebAuthn result in details.                                                                                                                                                                                                                                                            |
| Sealing failure after approval                  | “Could not encrypt the answer.” / “Nothing was sent from this attempt. Return to the originating machine, cancel this request and start again in a supported browser.”                                                                                                                                                                                                                                                                             |
| Null credential / unexpected exception          | Send `failed`; display its failure copy even after successful delivery.                                                                                                                                                                                                                                                                                                                                                                            |

No trustworthy page countdown: URL has no issue time. Say “Requests expire after five minutes. The originating machine shows whether this request is still active.” No page-specific `ceremony-timeout`, `ceremony-state`, `wrong-passkey`, `directory-unavailable` or fleet-mismatch result: these are established by the daemon/user after submission. Link to the appropriate desktop recovery instructions, never fabricate receipt of such an event. After a terminal response, no same-slot Try again button; the origin must create the next request.

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
container alongside full-workspace baselines. The website demo uses the same renderer;
its mock watches the add panel and emits a joining member to complete the flow.

Real browser/provider compatibility remains manual; mocked passkeys do not establish
device support. Tests isolate HOME and tmux sockets and never touch user sessions.
