# @devsantara/gitwork

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
