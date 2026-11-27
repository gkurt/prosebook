/**
 * What answers deictic's requests on the built page (`deictic/vite`'s `standalone`): the Copy tab's, by
 * `backend.ts`, which carries the tools and loads on the first request.
 */
import type { Standalone } from 'deictic';

const importBackend = () => import('./backend.ts');
let backend: ReturnType<typeof importBackend> | undefined;

const answer: Standalone = async (request) => (await (backend ??= importBackend())).answer(request);

export default answer;
