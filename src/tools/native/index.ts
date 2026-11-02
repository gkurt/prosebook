/**
 * The native files `generate` writes beside the TypeScript, one per target in the config's `native`
 * (Android's resources, a file per locale). A message a target can't render fails the build with the
 * reason, as a translation that drifted does.
 */
import { CatalogError, type Catalog, type Problem } from '#src/tools/catalog.ts';
import type { Entry } from '#src/tools/compile.ts';
import type { ResolvedConfig } from '#src/tools/config.ts';
import { androidResources } from './android.ts';
import { kotlinFile } from './kotlin.ts';
import { nativeModel } from './model.ts';
import { rustModule } from './rust.ts';
import { swiftFile } from './swift.ts';

const WRITERS = { rust: rustModule, swift: swiftFile, kotlin: kotlinFile };

export function nativeFiles(
  config: ResolvedConfig,
  catalog: Catalog,
  locales: string[],
  entries: Map<string, Entry[]>,
  banner: string,
): Map<string, string> {
  const files = new Map<string, string>();
  const problems: Problem[] = [];
  for (const target of config.native) {
    try {
      if (target.language === 'android') {
        const { files: written, problems: found } = androidResources(target, catalog, locales, entries, banner);
        problems.push(...found);
        for (const [path, content] of written) files.set(path, content);
        continue;
      }
      const { model, problems: found } = nativeModel(target, catalog, locales, entries);
      problems.push(...found);
      if (found.length > 0) continue;
      files.set(target.out, WRITERS[target.language](model, target, banner));
    } catch (e) {
      problems.push({ severity: 'error', message: (e as Error).message });
    }
  }
  if (problems.length > 0) throw new CatalogError(problems);
  return files;
}
