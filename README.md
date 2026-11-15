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

### Global options

- `-C <dir>` runs any command as if gitwork had been started in `<dir>`, like `git -C`. The search for `gitwork.yaml` starts there.

gitwork never prompts, so it is safe to use in scripts, CI and agents.
