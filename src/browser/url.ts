/** `node:url` in the browser build: paths are already what a file URL would name. */
export const pathToFileURL = (path: string) => new URL(`file://${path}`);
export const fileURLToPath = (url: string | URL) => new URL(url).pathname;
