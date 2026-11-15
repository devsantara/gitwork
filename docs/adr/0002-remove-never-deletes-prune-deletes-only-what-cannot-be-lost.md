# `remove` never deletes; `prune` deletes only what cannot be lost

`gitwork remove <name>` only takes a Project out of the Manifest. Its folder stays and becomes Unlisted. Deleting is a separate command, `gitwork prune`. It deletes an Unlisted Project only when nothing in it could be lost:

- `git status` is clean,
- there are no stashes,
- every commit on every local branch exists on a remote,
- no merge or rebase is in progress.

Any other Unlisted Project is Skipped, with the reason shown. This follows the principle "never lose work". A Project's folder can hold work only that one machine has, such as unpushed branches, stashes, or local files.

## Considered Options

- **`remove` also deletes the folder**: rejected. Deleting without checks loses unpushed branches, stashes and local files. Deleting with checks makes `remove` refuse in ordinary situations and mixes two jobs in one command.
- **Ignored files block `prune`**: rejected. Almost every Project has ignored build output such as `node_modules` or `dist`, so `prune` could almost never delete anything.

## Consequences

- `prune` deletes ignored files, including a local `.env`. This is the one loss gitwork accepts, and the docs must say so.
- `prune` never deletes a folder that is not a git repository, because it cannot check that folder.
- When a teammate removes a Project from the Manifest, everyone else's copy becomes Unlisted. Each person runs `gitwork prune` themselves.
