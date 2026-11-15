import { execFileSync } from 'node:child_process';

// Tests run the real, built `gitwork` command, so build it once up front.
export default function setup(): void {
  execFileSync('pnpm', ['run', 'build'], { stdio: 'inherit' });
}
