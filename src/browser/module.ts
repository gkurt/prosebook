/** `node:module` in the browser build: no config file is imported there, so its cache is empty. */
export const createRequire = () =>
  Object.assign(
    () => {
      throw new Error('prosebook: nothing to require in the browser');
    },
    { cache: {} },
  );
