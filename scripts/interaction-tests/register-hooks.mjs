/** Register the Vite `import.meta.env` shim as an ESM load hook. */
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';

register('./vite-env-hook.mjs', pathToFileURL(new URL('./', import.meta.url).pathname).href);
