---
'@devsantara/gitwork': minor
---

`gitwork exec` runs several words after `--` as a program and its arguments, so `gitwork exec -- git commit -m 'fix: typo'` works without quoting the command twice. A single word still runs through `sh -c`, as in `gitwork exec -- 'npm ci && npm test'`.

Tab completion for zsh and bash: `gitwork completion install` sets it up in your shell's rc file, and `gitwork init` suggests it until you have. It completes commands, options, Project names and Tags, and completes the command after `exec ... --` like any other. `gitwork completion zsh|bash` prints the script, to load it yourself.
