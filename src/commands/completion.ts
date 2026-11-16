import { UserError } from '#/errors.js';

type Shell = (typeof SHELLS)[number];
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';

import { errorCode, errorMessage } from '#/errors.js';
import { isValidName } from '#/manifest.js';
import { scanProjectsFolder } from '#/projects.js';
import { loadWorkspace } from '#/workspace.js';

export const SHELLS = ['zsh', 'bash'] as const;

/** What `gitwork __complete <kind>` lists, one per line. */
const KINDS = ['projects', 'tags', 'unlisted'] as const;

/** Prints the completion script for `shell`; `completion install` loads it for you. */
export function completion(shell: string | undefined): number {
  if (!isShell(shell)) {
    throw new UserError(
      `'completion' needs a shell, one of: ${SHELLS.join(', ')}, or 'install' or 'uninstall'`,
    );
  }
  process.stdout.write(shell === 'zsh' ? ZSH : BASH);
  return 0;
}

const BLOCK_START = '# >>> gitwork completion >>>';
const BLOCK_END = '# <<< gitwork completion <<<';

/**
 * The block `completion install` puts in the rc file. It defines a stand-in
 * `_gitwork` that, on the first Tab after `gitwork`, loads the real script from
 * the `gitwork` on PATH and hands over to it: the shell starts no slower, and
 * the script never goes stale when gitwork is upgraded.
 */
function rcBlock(shell: Shell): string {
  const lines =
    shell === 'zsh'
      ? [
          '(( $+functions[compdef] )) || { autoload -Uz compinit && compinit; }',
          '_gitwork() { local s; s=$(gitwork completion zsh 2>/dev/null) || return; eval "$s" && _gitwork "$@"; }',
          'compdef _gitwork gitwork',
        ]
      : [
          '_gitwork() { local s; s=$(gitwork completion bash 2>/dev/null) || return; eval "$s" && _gitwork "$@"; }',
          'complete -F _gitwork gitwork',
        ];
  return [
    BLOCK_START,
    "# Added by 'gitwork completion install'; 'gitwork completion uninstall' removes it.",
    ...lines,
    BLOCK_END,
    '',
  ].join('\n');
}

/** Matches the block, whatever is inside it, with the newline after it. */
const BLOCK_PATTERN = new RegExp(
  `${escapeRegExp(BLOCK_START)}\\n[\\s\\S]*?${escapeRegExp(BLOCK_END)}\\n?`,
);

/**
 * The shell named, or else the one in $SHELL. Fails when that isn't a shell
 * gitwork can complete in.
 */
function resolveShell(named: string | undefined): Shell {
  const shell = named ?? basename(process.env.SHELL ?? '');
  if (isShell(shell)) return shell;
  throw new UserError(
    named === undefined
      ? `cannot tell your shell from $SHELL; name it, as in 'gitwork completion install zsh' (one of: ${SHELLS.join(', ')})`
      : `'completion' needs a shell, one of: ${SHELLS.join(', ')}`,
  );
}

function isShell(name: string | undefined): name is Shell {
  return SHELLS.some((shell) => shell === name);
}

/** The file `shell` reads when it starts: on macOS, bash starts as a login shell. */
function rcFile(shell: Shell): string {
  if (shell === 'zsh') return join(process.env.ZDOTDIR || homedir(), '.zshrc');
  return join(
    homedir(),
    process.platform === 'darwin' ? '.bash_profile' : '.bashrc',
  );
}

/** The rc file's text, or '' when it doesn't exist yet. */
function readRc(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch (error) {
    if (errorCode(error) === 'ENOENT') return '';
    throw new UserError(
      `cannot read ${tildePath(file)}: ${errorMessage(error)}`,
    );
  }
}

function writeRc(file: string, text: string): void {
  try {
    writeFileSync(file, text);
  } catch (error) {
    throw new UserError(
      `cannot write ${tildePath(file)}: ${errorMessage(error)}`,
    );
  }
}

/**
 * Adds the completion block to the rc file of `named`, or of the shell in
 * $SHELL, or brings an older block up to date. Running it again changes nothing.
 */
export function installCompletion(named: string | undefined): number {
  const shell = resolveShell(named);
  const file = rcFile(shell);
  const text = readRc(file);
  const block = rcBlock(shell);
  const found = findBlocks(file, text);
  if (found.length === 1 && found[0] === block) {
    console.log(`gitwork completion is already in ${tildePath(file)}`);
    return 0;
  }
  if (found.length > 0) {
    // The first block becomes the current one; any copies of it go.
    let first = true;
    const updated = text.replace(withBlankLineBefore(), (whole, before) => {
      if (!first) return before;
      first = false;
      return whole.replace(BLOCK_PATTERN, () => block);
    });
    writeRc(file, updated);
    console.log(`Updated gitwork completion in ${tildePath(file)}`);
  } else {
    const separator = text === '' || text.endsWith('\n') ? '' : '\n';
    writeRc(file, `${text}${separator}\n${block}`.replace(/^\n/, ''));
    console.log(`Added gitwork completion to ${tildePath(file)}`);
  }
  console.log(`Open a new shell to use it, or run: exec ${shell}`);
  return 0;
}

/** Takes every completion block out of the rc file of `named`, or of the shell in $SHELL. */
export function uninstallCompletion(named: string | undefined): number {
  const shell = resolveShell(named);
  const file = rcFile(shell);
  const text = readRc(file);
  if (findBlocks(file, text).length === 0) {
    console.log(`gitwork completion is not in ${tildePath(file)}`);
    return 0;
  }
  writeRc(file, text.replace(withBlankLineBefore(), '$1'));
  console.log(`Removed gitwork completion from ${tildePath(file)}`);
  return 0;
}

/**
 * Every block, with the blank line install puts before one, so removing it
 * leaves no gap. Group 1 is the end of the line before, which must stay.
 */
function withBlankLineBefore(): RegExp {
  return new RegExp(`(^|\\n)\\n?${BLOCK_PATTERN.source}`, 'g');
}

/**
 * The completion blocks in `text`, in order. Fails when a start or end line
 * has lost its partner, as after a hand edit: which lines then belong to
 * gitwork is a guess, and a wrong guess would delete the user's own.
 */
function findBlocks(file: string, text: string): string[] {
  const blocks = [...text.matchAll(new RegExp(BLOCK_PATTERN.source, 'g'))].map(
    (match) => match[0],
  );
  const lines = text.split('\n');
  const starts = lines.filter((line) => line === BLOCK_START).length;
  const ends = lines.filter((line) => line === BLOCK_END).length;
  if (starts !== blocks.length || ends !== blocks.length) {
    throw new UserError(
      `${tildePath(file)} has a '${starts > ends ? BLOCK_START : BLOCK_END}' line with no partner; fix or remove it by hand, then run this again`,
    );
  }
  return blocks;
}

/**
 * Whether the shell in $SHELL can complete gitwork but its rc file has no
 * completion block yet: then `init` suggests `completion install`.
 */
export function completionNotInstalled(): boolean {
  const shell = basename(process.env.SHELL ?? '');
  if (!isShell(shell)) return false;
  try {
    return !BLOCK_PATTERN.test(readFileSync(rcFile(shell), 'utf8'));
  } catch {
    return true;
  }
}

function tildePath(path: string): string {
  const home = homedir();
  return path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Prints the listed Projects, the Tags, or the Unlisted Projects of the
 * Workspace at `dir`, one per line, for the completion scripts. Prints nothing
 * when there is no valid Workspace: completing must never fail loudly.
 */
export async function complete(
  dir: string,
  kind: string | undefined,
): Promise<number> {
  if (!KINDS.some((k) => k === kind)) return 0;
  let words: string[];
  try {
    const workspace = loadWorkspace(dir);
    const projects = workspace.manifest.projects;
    words =
      kind === 'projects'
        ? projects.map((p) => p.name)
        : kind === 'tags'
          ? [...new Set(projects.flatMap((p) => p.tags))]
          : (await scanProjectsFolder(workspace)).unlisted;
  } catch {
    return 0;
  }
  // Unlisted Projects are whatever folders are there; only valid names are
  // offered, so no completion script ever sees shell syntax in a word.
  for (const word of words.filter(isValidName)) {
    process.stdout.write(`${word}\n`);
  }
  return 0;
}

const ZSH = `#compdef gitwork
# gitwork completion for zsh. Set it up with:
#   gitwork completion install zsh
# or load it yourself with eval "$(gitwork completion zsh)", after compinit,
# or save it as _gitwork in a directory on your $fpath.

_gitwork_list() {
  gitwork "\${_gitwork_dir[@]}" __complete $1 2>/dev/null
}

_gitwork() {
  local -a _gitwork_dir
  local cmd i word

  for (( i = 2; i < CURRENT; i++ )); do
    word=\${words[i]}
    case $word in
      -C) _gitwork_dir=(-C \${~\${(Q)words[i+1]}}); (( i++ )) ;;
      -C?*) _gitwork_dir=(-C \${~\${(Q)word#-C}}) ;;
      --tag|--description) (( i++ )) ;;
      --)
        if [[ $cmd == exec ]]; then
          # Everything after -- is a command of its own: complete it as one.
          shift $i words
          (( CURRENT -= i ))
          _normal
          return
        fi
        ;;
      -*) ;;
      *) [[ -z $cmd ]] && cmd=$word ;;
    esac
  done

  case \${words[CURRENT-1]} in
    -C) _directories; return ;;
    --tag) compadd -- \${(f)"$(_gitwork_list tags)"}; return ;;
    --description) return ;;
  esac

  if [[ -z $cmd ]]; then
    if [[ $PREFIX == -* ]]; then
      compadd -- -C -h --help -v --version
    else
      local -a commands
      commands=(
        'init:Create gitwork.yaml here and ignore the projects/ folder'
        'check:Validate gitwork.yaml and report every error'
        'sync:Clone Missing Projects and fast-forward cloned ones'
        'status:Show the branch and states of each Project'
        'exec:Run a command in each cloned Project'
        'add:Clone a Project, then list it in gitwork.yaml'
        'remove:Take a Project out of gitwork.yaml, leaving its folder'
        'prune:Delete Unlisted Projects that hold nothing that could be lost'
        'completion:Print the shell completion script'
      )
      _describe command commands
    fi
    return
  fi

  local -a options names
  case $cmd in
    check) options=(--json) ;;
    sync) options=(--tag --json); names=(\${(f)"$(_gitwork_list projects)"}) ;;
    status) options=(--tag --json --fetch); names=(\${(f)"$(_gitwork_list projects)"}) ;;
    exec) options=(--tag --parallel --); names=(\${(f)"$(_gitwork_list projects)"}) ;;
    add) options=(--tag --description --no-clone); names=(\${(f)"$(_gitwork_list unlisted)"}) ;;
    remove) names=(\${(f)"$(_gitwork_list projects)"}) ;;
    prune) options=(--dry-run); names=(\${(f)"$(_gitwork_list unlisted)"}) ;;
    completion) names=(zsh bash) ;;
  esac
  if [[ $PREFIX == -* ]]; then
    (( $#options )) && compadd -- $options
  else
    (( $#names )) && compadd -- $names
  fi
}

if [[ $zsh_eval_context[-1] == loadautofunc ]]; then
  _gitwork "$@"
else
  compdef _gitwork gitwork
fi
`;

const BASH = `# gitwork completion for bash. Set it up with:
#   gitwork completion install bash
# or load it yourself with eval "$(gitwork completion bash)"
# Completing the command after 'exec ... --' uses bash-completion when it is installed.

_gitwork_list() {
  gitwork "\${_gitwork_dir[@]}" __complete "$1" 2>/dev/null
}

# Adds each word read from stdin that starts with $cur, as it is: unlike
# compgen -W, this never expands $(...) or backquotes inside a word.
_gitwork_add() {
  local word
  while IFS= read -r word; do
    [[ -n $word && $word == "$cur"* ]] && COMPREPLY+=("$word")
  done
}

_gitwork() {
  local cur=\${COMP_WORDS[COMP_CWORD]} prev=\${COMP_WORDS[COMP_CWORD-1]}
  local cmd= i word
  local -a _gitwork_dir=()
  COMPREPLY=()

  for (( i = 1; i < COMP_CWORD; i++ )); do
    word=\${COMP_WORDS[i]}
    case $word in
      -C) _gitwork_dir=(-C "\${COMP_WORDS[i+1]/#\\~/$HOME}"); (( i++ )) ;;
      -C?*) word=\${word#-C}; _gitwork_dir=(-C "\${word/#\\~/$HOME}") ;;
      --tag|--description) (( i++ )) ;;
      --)
        if [[ $cmd == exec ]]; then
          # Everything after -- is a command of its own: complete it as one.
          if declare -F _comp_command_offset >/dev/null; then
            _comp_command_offset $(( i + 1 ))
          elif declare -F _command_offset >/dev/null; then
            _command_offset $(( i + 1 ))
          elif (( COMP_CWORD == i + 1 )); then
            COMPREPLY=($(compgen -c -- "$cur"))
          else
            COMPREPLY=($(compgen -f -- "$cur"))
          fi
          return
        fi
        ;;
      -*) ;;
      *) [[ -z $cmd ]] && cmd=$word ;;
    esac
  done

  case $prev in
    -C) COMPREPLY=($(compgen -d -- "$cur")); return ;;
    --tag) _gitwork_add < <(_gitwork_list tags); return ;;
    --description) return ;;
  esac

  if [[ -z $cmd ]]; then
    if [[ $cur == -* ]]; then
      COMPREPLY=($(compgen -W "-C -h --help -v --version" -- "$cur"))
    else
      COMPREPLY=($(compgen -W "init check sync status exec add remove prune completion" -- "$cur"))
    fi
    return
  fi

  local options= names=
  case $cmd in
    check) options="--json" ;;
    sync) options="--tag --json"; names=$(_gitwork_list projects) ;;
    status) options="--tag --json --fetch"; names=$(_gitwork_list projects) ;;
    exec) options="--tag --parallel --"; names=$(_gitwork_list projects) ;;
    add) options="--tag --description --no-clone"; names=$(_gitwork_list unlisted) ;;
    remove) names=$(_gitwork_list projects) ;;
    prune) options="--dry-run"; names=$(_gitwork_list unlisted) ;;
    completion) names=$'zsh\nbash' ;;
  esac
  if [[ $cur == -* ]]; then
    COMPREPLY=($(compgen -W "$options" -- "$cur"))
  else
    _gitwork_add <<< "$names"
  fi
}

complete -F _gitwork gitwork
`;
