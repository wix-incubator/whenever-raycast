# Whenever for Raycast

Search your Whenever workflows, review input, run saved versions, and inspect recorded results from Raycast.

## Commands

- **Search Workflows** lists workflows like the Whenever sidebar: pinned first, then by most recent activity, each with its status. Search names, IDs, or statuses.
- **Run Workflow** reviews the latest saved version and optional JSON input before requesting confirmation.
- **Workflow Runs** opens per-workflow history and links to runs started from this Raycast connection.
- **Whenever Account** connects through browser sign-in or signs out.
- **Open Whenever** opens the web app.

Statuses, run labels, colors, and the run timeline follow the Whenever web app.
Pin workflows in Whenever; Raycast shows the same pins.
Run details show the run status, failure messages, a step timeline, and available output.
Copy or paste output, or open an HTTP/HTTPS link returned as a string.

## Connection and execution

Sign in through **Whenever Account** or any workflow command.
The extension registers a public OAuth client and uses PKCE with Raycast's web redirect.
Raycast stores access and refresh tokens through its native OAuth API.
The extension contacts `https://mcp.whenever.dev/` for account and workflow operations.
Sign-out requests server revocation and clears native tokens even if revocation fails.

Clipboard and selected text are read only through explicit actions.
These actions insert `{ "text": "…" }` into the form for review.
Edit the JSON to match your workflow's expected input.
For multiple triggers, enter the trigger key declared in your workflow.

Manual execution runs the reviewed **saved version**, which can differ from the published version.
It requires confirmation because workflows can change external accounts.
The extension records a stable run ID before dispatch and never automatically retries a launch.
If a launch answer is lost or uncertain, inspect that run before requesting another.
A launch acknowledgement does not mean the run succeeded.

## Data and limits

IDs of runs started from Raycast are stored locally for each connection.
Sign-out clears those records. Input, workflow source, and results are not stored in local activity records.

Workflow status comes from the activation Whenever last recorded, as in the web app sidebar.
Use the web app to configure credentials, edit, publish, pin, or manage triggers.
Workflow lists and run history can be partial. The extension labels incomplete lists.
Run details read at most 100 events per request and display the latest 500 loaded events.
Automatic refresh stops when observation completes, a read fails, or another event page requires loading.
Large or unavailable output is labelled explicitly.

## Development

Use the Node.js version in `.nvmrc`, then run:

```sh
npm ci --ignore-scripts
npm run dev
```

Raycast imports the extension when development starts.

## Checks

```sh
npm test
npm run lint
npm run typecheck
npm run build
```

CI runs on pull requests, pushes to `master`, and manual dispatch.
It audits dependencies with `npq@3.27.0`, verifies the lockfile, and runs these checks.
The npq provenance check is disabled because it reports React's stable release as a regression against an experimental release.
Other npq checks remain enabled.
Linting includes Raycast's manifest, Store author, and icon validation.
Dependencies have a fourteen-day minimum release age.
Tests exercise HTTP tool requests and response validation, launch uncertainty, token lifecycle, local activity, and the dependency-audit gate.
Source, tests, scripts, and configuration use TypeScript and are checked by `npm run typecheck`.
Node runs the TypeScript tests directly. ESLint rejects JavaScript files in repository code.
Network fixtures do not prove a real workflow executed or produced external effects.

## Store submission

The Store author is `kasparasb`.
Prepare Store screenshots and review the listing before submission.
Run the checks above, then submit with:

```sh
npm run publish
```

This opens a public pull request in `raycast/extensions` for Raycast review.
Repository CI does not publish to npm or submit to the Store automatically.
See [Raycast's publishing guide](https://developers.raycast.com/basics/publish-an-extension).
