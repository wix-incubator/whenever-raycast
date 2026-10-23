# Whenever for Raycast

This starter extension provides an **Open Whenever** command.
Workflow search, account connection, and execution are not implemented yet.

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
Linting includes Raycast's manifest, Store author, and icon validation.
Dependencies have a fourteen-day minimum release age.
Tests cover the dependency-audit gate, not account connection or workflow execution.

The audit checker and its test patterns are adapted from
[Whenever for n8n](https://github.com/wix-incubator/n8n-nodes-whenever), under the included MIT license.

## Store submission

The Store author is `kasparasb`.
Complete the extension's features and Store listing before submission.
Run the checks above, then submit with:

```sh
npm run publish
```

This opens a public pull request in `raycast/extensions` for Raycast review.
Repository CI does not publish to npm or submit to the Store automatically.
See [Raycast's publishing guide](https://developers.raycast.com/basics/publish-an-extension).
