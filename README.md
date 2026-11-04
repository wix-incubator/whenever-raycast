# Whenever for Raycast

Source for the Whenever Raycast extension. The Store listing and everything submitted to the Raycast Store live in [`extension/`](extension); tests and CI scripts stay at the repository root.

## Development

Use the Node.js version in `extension/.nvmrc`, then run:

```sh
cd extension
npm ci --ignore-scripts
npm run dev
```

Before opening a pull request, run from the repository root:

```sh
npm test
npm run lint
npm run typecheck
```

and from `extension/`: `npm run lint`, `npm run typecheck` and `npm run build`.

## Publishing

The extension is published by the `whenever-team` Raycast account. From `extension/`, `npm run publish` submits it to the public Raycast Store for review. Publishing and the author check in `npm run lint` need you signed in with `npx ray login` as that account.
