# @devsantara/gitwork

## 0.2.0

### Minor Changes

- [#13](https://github.com/devsantara/gitwork/pull/13) [`b60ecf4`](https://github.com/devsantara/gitwork/commit/b60ecf4f1459d6f6be90b717441fdad601fd8c35) - `gitwork exec` runs several words after `--` as a program and its arguments, so `gitwork exec -- git commit -m 'fix: typo'` works without quoting the command twice. A single word still runs through `sh -c`, as in `gitwork exec -- 'npm ci && npm test'`.
  
  Tab completion for zsh and bash: `gitwork completion install` sets it up in your shell's rc file, and `gitwork init` suggests it until you have. It completes commands, options, Project names and Tags, and completes the command after `exec ... --` like any other. `gitwork completion zsh|bash` prints the script, to load it yourself.

## 0.1.0

### Minor Changes

- [#11](https://github.com/devsantara/gitwork/pull/11) [`a92dcb9`](https://github.com/devsantara/gitwork/commit/a92dcb9c0bd16f24d6194a6e2f322cc6f6e58771) - Add the `gitwork` CLI for managing a Workspace of Projects declared in a `gitwork.yaml` Manifest.
  
  - `gitwork init` creates an empty Manifest and adds `/projects/` to `.gitignore`.
  - `gitwork check` validates the Manifest and reports every error with its line number.
  - `gitwork sync` clones Missing Projects and safely updates cloned ones, optionally limited to a Selection of names or Tags.
  - `gitwork status` reports the state of each Project and warns about Unlisted Projects.
  - `gitwork exec` runs a command in every cloned Project.
  - `gitwork add` and `gitwork remove` add Projects to and remove them from the Manifest.
  - `gitwork prune` deletes Unlisted Projects that hold nothing to lose.
