/**
 * `prosebook judge` from source in a folder of the repo: `bun scripts/judge.mts site`, or `. --docs`
 * for the repo's docs. The configs ask Jev where TYPESAFE_AI_API_KEY is set and Claude Haiku, which also
 * suggests rewrites, where ANTHROPIC_API_KEY is. Skipped, passing, with neither: in a fork's CI or on a
 * machine with no key, lint still reads the verdicts the lock holds. Then commit the folder's lock.
 */
const KEYS = ['TYPESAFE_AI_API_KEY', 'ANTHROPIC_API_KEY'];
const [folder = '.', ...args] = process.argv.slice(2);

if (!KEYS.some((key) => process.env[key])) {
  console.log(`judge skipped in ${folder}: set ${KEYS.join(' or ')} to judge`);
  process.exit(0);
}

const root = `${import.meta.dir}/..`;
const run = Bun.spawnSync(['bun', '--conditions=prosebook@dev', 'src/cli.ts', 'judge', '--root', folder, ...args], {
  cwd: root,
  stdio: ['inherit', 'inherit', 'inherit'],
});
process.exit(run.exitCode);
