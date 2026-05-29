export { SynapCoresClient, SynapCoresError } from './client';
export type {
  SynapCoresClientOptions,
  QueryResult,
} from './client';
// server.ts is intentionally NOT re-exported from the package barrel —
// import it directly from "@synapcores/app-framework/db/server" inside
// route handlers / server actions / RSC. (server-only import marker.)
