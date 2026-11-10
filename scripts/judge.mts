/**
 * `prosebook judge` from source in a folder of the repo, through the AI Gateway: `bun scripts/judge.mts
 * site`, or `. --docs` for the repo's docs. Skipped, passing, without the gateway's key: in a fork's CI
 * or on a machine with none, lint still reads the verdicts the lock holds. Run with the key, then
 * commit the folder's lock.
 */
const KEYS = ['AI_GATEWAY_API_KEY', 'VERCEL_OIDC_TOKEN'];
const [folder = '.', ...args] = process.argv.slice(2);

if (!KEYS.some((key) => process.env[key])) {
  console.log(`judge skipped in ${folder}: set ${KEYS[0]} to judge`);
  process.exit(0);
}

const root = `${import.meta.dir}/..`;
const run = Bun.spawnSync(['bun', '--conditions=prosebook@dev', 'src/cli.ts', 'judge', '--root', folder, ...args], {
  cwd: root,
  stdio: ['inherit', 'inherit', 'inherit'],
});
process.exit(run.exitCode);
