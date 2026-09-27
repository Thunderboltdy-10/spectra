/** Offline capture only: mirror Vitest's server-only marker shim without
 * switching React to its RSC export. The artifact registry also imports UI
 * definitions, whose normal React exports are required when loading in Node.
 * No application behavior or dependency file is changed.
 */
import { createRequire, Module } from "node:module";

const require = createRequire(import.meta.url);
const marker = require.resolve("server-only");
const shim = new Module(marker);
shim.loaded = true;
shim.exports = {};
require.cache[marker] = shim;
