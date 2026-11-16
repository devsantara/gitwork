# Agents use the CLI, not an MCP server

AI agents work with gitwork the same way people do: by running the `gitwork` command from their shell and reading its `--json` output. gitwork ships no MCP server. Every coding agent already has a shell, and gitwork never prompts, so the CLI is already a complete agent interface. What agents need beyond that, gitwork adds to the CLI itself: `--json` on every command, distinct exit codes, and a guide to the Workspace that the installed binary prints.

## Considered Options

- **An MCP server (`gitwork mcp`)**: rejected. It would be a second interface to keep in step with the CLI, it needs installing and configuring per agent, and it can do nothing the CLI can't.
- **Both the CLI and an MCP server**: rejected, for the same reasons.

## Consequences

- Every command must be usable by a program: `--json` output, exit codes that tell a mistake in the call apart from a Project that Failed, and no prompts.
- How to use gitwork in a Workspace is told to agents by the CLI, not by tool descriptions, so the guide always matches the installed version.
