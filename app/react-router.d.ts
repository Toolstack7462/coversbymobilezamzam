/**
 * The server build is produced by the React Router Vite plugin at build time and
 * resolved through a virtual module, so it has no file on disk to infer from.
 */
declare module "virtual:react-router/server-build" {
  import type { ServerBuild } from "react-router";
  const build: ServerBuild;
  export = build;
}
