# TypeScript on Node, using the user's own git

gitwork is written in TypeScript, published to npm as `@devsantara/gitwork`, and does all git work by running the `git` command already installed on the user's machine. Running the user's own git means every Project behaves exactly as it does in their terminal: their SSH keys, credential helpers, `url.<base>.insteadOf` rewrites and other git config all apply without gitwork knowing about them.

## Considered Options

- **A JavaScript git library (e.g. isomorphic-git)**: rejected. These libraries ignore the user's git config, and isomorphic-git has no SSH support.
- **A single binary in Go or Rust**: rejected. The project already uses the npm package name `@devsantara/gitwork`.

## Consequences

- Users need Node and git installed. Both minimum versions follow public support schedules instead of a number we pick:
  - **Node**: every Node LTS line that is still maintained (Node 22 or newer as of November 2026). The minimum rises whenever Node retires a line.
  - **git**: the version shipped by the oldest Ubuntu LTS still in standard support (git 2.34, from Ubuntu 22.04, as of November 2026). The minimum rises when that Ubuntu release leaves standard support. git has no LTS releases of its own.
- gitwork checks the git version at startup and fails with a clear message if it is too old.
- Only macOS and Linux (including WSL) are supported. Windows is neither tested nor promised.
