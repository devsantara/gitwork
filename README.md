<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="https://assets.devsantara.com/gitwork/logo-dark.png">
    <img alt="@devsantara/gitwork logo" src="https://assets.devsantara.com/gitwork/logo-light.png" height="128">
  </picture>
  <h1>@devsantara/gitwork</h1>
  <p>Work across all your repositories like they’re one.</p>
  <a href="https://github.com/devsantara"><img alt="Made by Devsantara" src="https://img.shields.io/badge/Made_By-Devsantara-0F172A.svg?style=for-the-badge&labelColor=000000"></a>
  <a href="./LICENSE"><img alt="MIT License" src="https://img.shields.io/github/license/devsantara/gitwork?style=for-the-badge&labelColor=000000"></a>
  <a href="https://github.com/devsantara/gitwork/graphs/contributors"><img alt="contributors" src="https://img.shields.io/github/contributors/devsantara/gitwork?style=for-the-badge&labelColor=000000"></a>
</div>

## Install

gitwork runs on macOS and Linux. It needs:

- **Node.js 24.22.3 or newer**
- **git 2.34 or newer**, already installed. gitwork runs your own `git`, so your SSH keys, credential helpers and git config all apply.

```sh
npm install --global @devsantara/gitwork
gitwork --version
```

## Usage

### `gitwork init`

Turns the current directory into a **Workspace**:

```sh
mkdir acme-workspace && cd acme-workspace
git init            # optional: gitwork never runs this for you
gitwork init
```

`init` does two things:

- It writes `gitwork.yaml`, the **Manifest**, with no Projects yet:

  ```yaml
  version: 1
  projects: {}
  ```

- It adds `/projects/` to `.gitignore`, creating the file if needed. Projects are cloned into `projects/`, and the Workspace repository should not track them.

If `gitwork.yaml` already exists, `init` changes nothing and exits with code 1.

### The Manifest

`gitwork.yaml` lists every **Project** in the Workspace:

```yaml
version: 1
projects:
  storefront:
    url: git@github.com:acme/storefront.git
    description: Customer-facing shop
    tags: [frontend, web]
  api:
    url: git@github.com:acme/api.git
    tags: [backend]
```

- `version` must be `1`.
- `projects` is a map from each Project's name to its settings:
  - `url` (required): where to clone it from, as you would pass it to `git clone`.
  - `description` (optional): a string.
  - `tags` (optional): a list of **Tags**, used to pick out groups of Projects.
- Project names and Tags use lowercase letters, digits, `.`, `_` and `-`, and start with a letter or digit. Each Project is cloned to `projects/<name>`.
- Unknown keys, duplicate names, duplicate keys and two Projects with the same `url` are errors.

gitwork looks for `gitwork.yaml` in the current directory and then in each parent directory, so you can run it from anywhere inside the Workspace. Every command except `init` refuses to run while the Manifest is invalid.

### `gitwork check`

Validates the Manifest without touching the network, and reports every error at once with its line number:

```console
$ gitwork check
gitwork.yaml:1: 'version' must be 1
gitwork.yaml:5: unknown key 'branch' in Project 'api'
gitwork: gitwork.yaml has 2 errors
```

It exits 0 when the Manifest is valid and 1 otherwise. `--json` prints the result as JSON instead:

```json
{
  "manifest": "/home/me/acme-workspace/gitwork.yaml",
  "valid": false,
  "errors": [
    { "line": 1, "message": "'version' must be 1" },
    { "line": 5, "message": "unknown key 'branch' in Project 'api'" }
  ]
}
```

To catch mistakes before they are merged, run it in the Workspace repository's CI. For example, with GitHub Actions:

```yaml
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 24
      - run: npx --yes @devsantara/gitwork check
```

### `gitwork sync`

Clones every **Missing** Project, that is every Project in the Manifest with no folder in `projects/` yet, and safely updates the ones already cloned:

```console
$ gitwork sync
storefront  cloned
api         updated
web         skipped: behind 2, dirty
admin       unchanged: no upstream, main updated
docs        failed: ERROR: Repository not found. Could not read from remote repository.

1 cloned, 1 updated, 1 unchanged, 1 skipped, 1 failed
```

Each line shows the Project's outcome, then the states that explain it, as they are once `sync` is done.

- Each Missing Project is cloned with a plain `git clone <url> projects/<name>`: the remote's default branch, with the Manifest's `url` as `origin` (even if your git config names remotes differently), and no shallow clone or submodules.
- If `projects/<name>` exists but is not a git repository, the Project `failed` and its folder is left alone.
- `sync` works on up to 8 Projects at a time and prints one line per Project, in Manifest order, then a summary.
- One Project failing never stops the others. **Skipped** Projects don't count as failures: `sync` exits 0 unless a Project `failed`.
- `sync` never touches the Workspace's own repository.

#### How cloned Projects are updated

`sync` first fetches every remote of the Project and drops remote branches that no longer exist (`git fetch --all --prune`). Then it updates the checked-out branch only when that is a plain fast-forward and nothing uncommitted is in the way:

| The checked-out branch is                                                  | Outcome                       |
| -------------------------------------------------------------------------- | ----------------------------- |
| Behind its upstream, and the Project isn't **Dirty**                       | `updated` (fast-forward only) |
| Up to date                                                                 | `unchanged`                   |
| Ahead only                                                                 | `unchanged: ahead N`          |
| Never pushed                                                               | `unchanged: no upstream`      |
| Tracking an upstream branch that was deleted                               | `unchanged: gone`             |
| Behind, and the Project is Dirty                                           | `skipped: behind N, dirty`    |
| Ahead and behind                                                           | `skipped: diverged`           |
| Not a branch (detached HEAD), or a merge, rebase or similar is in progress | `skipped`, with that state    |

When another branch is checked out, `sync` also fast-forwards the default branch (the one `origin/HEAD` points at) if it is simply behind its upstream, and reports `main updated` (with the branch's name). This only moves the branch, never any files, so it happens even when the Project is Dirty. It is left alone if it has commits of its own, if the checked-out HEAD is detached or a merge, rebase or similar is in progress, if another worktree has it checked out or has a detached HEAD (it may be rebasing it), or if the default branch can't be determined.

If `origin` isn't the Manifest's `url`, the Project gets the `url mismatch` state and a warning on stderr. `sync` still follows the branch's configured upstream, and never changes `origin`.

`sync` never creates merge commits, rebases, resets, stashes or force-updates anything. Anything it won't do safely is left for you.

`--json` prints the outcome and states of each Project instead:

```json
{
  "projects": [
    { "name": "storefront", "outcome": "cloned", "states": [] },
    { "name": "api", "outcome": "updated", "states": [] },
    { "name": "web", "outcome": "skipped", "states": ["behind 2", "dirty"] },
    {
      "name": "admin",
      "outcome": "unchanged",
      "states": ["no upstream", "main updated"]
    },
    {
      "name": "docs",
      "outcome": "failed",
      "states": [],
      "error": "ERROR: Repository not found. Could not read from remote repository."
    }
  ]
}
```

### `gitwork status`

Shows one row per Project: its name, its checked-out branch and its states.

```console
$ gitwork status
storefront  main         up to date
api         main         behind 3, dirty
admin       spike/login  no upstream
docs                     missing
my-tool     main         unlisted, ahead 1
unlisted: my-tool (gitwork prune deletes them; gitwork add <name> lists one)
```

- `status` works offline: it reports what git already knows from the last fetch. `--fetch` first fetches every remote of each Project and drops remote branches that no longer exist.
- In a terminal, the branch is highlighted when it isn't the remote's default branch.
- `status` never changes a Project. `--fetch` only updates the remote branches of listed Projects; Unlisted ones are never fetched.
- It works on up to 8 Projects at a time and prints the rows in Manifest order.
- With no Selection, Unlisted Projects follow as `unlisted` rows.
- A folder in `projects/` that isn't a git repository is reported on stderr and left alone. If a listed Project's folder isn't one, that Project `failed`.
- `status` exits 0 unless a Project failed, for example because its fetch failed.

Each row shows the states that apply:

| State                                                                         | Meaning                                                               |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| `missing`                                                                     | Listed in the Manifest, with no folder in `projects/` yet.            |
| `unlisted`                                                                    | In `projects/` but not in the Manifest.                               |
| `up to date`                                                                  | The checked-out branch matches its upstream.                          |
| `behind N`                                                                    | The upstream has N commits the branch doesn't.                        |
| `ahead N`                                                                     | The branch has N commits the upstream doesn't.                        |
| `diverged`                                                                    | Both: the branch and its upstream each have commits the other lacks.  |
| `no upstream`                                                                 | The branch has never been pushed, or has no upstream set.             |
| `gone`                                                                        | The branch's upstream was deleted from the remote.                    |
| `detached`                                                                    | No branch is checked out (detached HEAD).                             |
| `dirty`                                                                       | `git status` isn't clean. Untracked files count; ignored files don't. |
| `merging`, `rebasing`, `cherry-picking`, `reverting`, `bisecting`, `applying` | git is stopped in the middle of that operation.                       |
| `url mismatch`                                                                | `origin` isn't the Manifest's `url`.                                  |

`--json` prints the rows instead. `branch` is `null` when HEAD is detached or the Project isn't cloned, `defaultBranch` is the remote's default branch when it's known, and a failed Project has an `error`:

```json
{
  "projects": [
    {
      "name": "api",
      "branch": "main",
      "defaultBranch": "main",
      "states": ["behind 3", "dirty"]
    },
    {
      "name": "docs",
      "branch": null,
      "defaultBranch": null,
      "states": ["missing"]
    }
  ]
}
```

### `gitwork exec`

Runs one command in every cloned Project of the Selection. Everything after `--` is the command; it runs through the shell (`sh -c`) with `projects/<name>` as the working directory:

```console
$ gitwork exec -- 'npm ci && npm test'
==> storefront <==
...
==> api <==
...

storefront  ok
api         failed: exit code 1
docs        skipped: missing

1 ok, 1 failed, 1 skipped
```

- By default the command runs in one Project at a time, in Manifest order, with a `==> name <==` heading above each Project's output. The command's output goes straight to your terminal.
- `--parallel` runs it in up to 8 Projects at once and puts `[name]` in front of every line of output, on stdout and stderr alike:

  ```console
  $ gitwork exec --parallel --tag backend -- git log -1 --oneline
  [api] 3f2c1ab Add rate limiting
  [billing] 9d0e4b2 Bump dependencies
  ```

- It runs only in cloned Projects. **Missing** Projects are `skipped: missing`. If a listed Project's folder isn't a git repository, that Project `failed` and nothing runs there.
- One command failing never stops the others. The summary shows each Project's outcome, with the exit code of each one that `failed`.
- `exec` exits 1 if any command failed, otherwise 0.
- The words after `--` are joined with spaces, like `ssh` does, so quote anything the shell should see as one argument, or pass the whole command as one quoted string.
- The command gets no stdin and git's prompts are off (`GIT_TERMINAL_PROMPT=0`), so it can never wait for input.

### Unlisted Projects

You can clone your own repositories into `projects/` too. A git repository there that the Manifest doesn't list is **Unlisted**. gitwork never acts on it, and every command except `init` ends with one warning on stderr naming them:

```text
unlisted: my-tool, old-api (gitwork prune deletes them; gitwork add <name> lists one)
```

An Unlisted Project can't be selected. Naming one exits 1 and says how to list it.

### Selection

Commands that act on Projects, such as `sync`, `status` and `exec`, take a **Selection**: Project names and any number of `--tag <tag>` options. Every Project that matches any of them is selected:

```sh
gitwork sync                           # every Project in the Manifest
gitwork sync api                       # just api
gitwork sync --tag frontend            # every Project tagged frontend
gitwork sync api --tag frontend --tag web
```

- With no names or Tags, the Selection is every Project in the Manifest.
- A name that isn't in the Manifest, or a Tag no Project has, is an error, and nothing is done.
- The Selection never depends on the current directory: running `gitwork sync` inside `projects/api` still syncs every Project.

### Global options

- `-C <dir>` runs any command as if gitwork had been started in `<dir>`, like `git -C`. The search for `gitwork.yaml` starts there.

gitwork never prompts, so it is safe to use in scripts, CI and agents.
