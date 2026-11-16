# gitwork

gitwork lets developers work across many related git repositories as if they were one, driven by a shared list of those repositories.

## Language

### Workspace

**Workspace**:
A directory holding a Manifest, usually a small git repository a team shares. Its Projects live in its `projects/` folder.
_Avoid_: root, meta-repo

**Manifest**:
The `gitwork.yaml` file at the top of a Workspace; the single source of truth for which Projects should exist.
_Avoid_: config, project list

### Projects

**Project**:
A git repository in a Workspace: listed in the Manifest under a unique name, present at `projects/<name>`, or both.
_Avoid_: repo, clone (as a noun), module

**Tag**:
A label on a listed Project, used to pick out groups of Projects.
_Avoid_: group, label, category

**Selection**:
The listed Projects a command acts on: every Project named, plus every Project carrying a named Tag. When nothing is named, it is every Project in the Manifest.
_Avoid_: filter, scope, subset

### Project states

**Listed**:
A Project the Manifest names. To list a Project is to put it in the Manifest.
_Avoid_: tracked, registered, configured

**Cloned**:
A Listed Project whose folder is present in `projects/`.
_Avoid_: checked out, present, local

**Missing**:
A Project listed in the Manifest with no folder in `projects/` yet. This is normal when someone works with only some of the Projects; it is not an error.
_Avoid_: not cloned, absent

**Unlisted**:
A Project in `projects/` that the Manifest does not list. gitwork warns about it but never acts on it, except to prune it or to list it with `gitwork add`.
_Avoid_: orphan, stray, extraneous

**Dirty**:
A Project whose `git status` is not clean, counting untracked files but not ignored ones.
_Avoid_: has local changes, modified

### Outcomes

**Skipped**:
A Project a command left alone because acting would risk someone's work. Not a failure.
_Avoid_: refused, blocked

**Failed**:
A Project a command could not act on because something broke, such as the network, authentication, or a folder that is not a git repository.
_Avoid_: error (as a state)

**Prune**:
To delete Unlisted Projects whose folders hold nothing that could be lost.
_Avoid_: clean, purge

### Agents

**Agent Guide**:
What gitwork tells an AI agent about working in a Workspace: the rules for using gitwork safely, and the Workspace's own Projects. It always matches the installed gitwork.
_Avoid_: prompt, instructions, agent docs
