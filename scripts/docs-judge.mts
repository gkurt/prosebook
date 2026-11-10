/**
 * The repo's docs held to the guidelines by the judge (`prosebook judge --docs`), through the AI Gateway.
 * Skipped, passing, without its key: in a fork's CI or on a machine with none, `bun run docs` still
 * reads the verdicts the lock holds. Run with the key, then commit `prosebook.lock.json`.
 */
const KEYS = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN'];

if (!KEYS.some((key) => process.env[key])) {
  console.log(`docs:judge skipped: set ${KEYS[0]} to judge the docs`);
  process.exit(0);
}

const run = Bun.spawnSync(['bun', '--conditions=prosebook@dev', 'src/cli.ts', 'judge', '--docs', ...process.argv.slice(2)], {
  cwd: `${import.meta.dir}/..`,
  stdio: ['inherit', 'inherit', 'inherit'],
});
process.exit(run.exitCode);
