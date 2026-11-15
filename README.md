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

- **Node.js 22 or newer** (every maintained LTS line)
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

### Global options

- `-C <dir>` runs any command as if gitwork had been started in `<dir>`, like `git -C`.

gitwork never prompts, so it is safe to use in scripts, CI and agents.
