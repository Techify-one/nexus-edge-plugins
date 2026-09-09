import type { DatabasePort } from "@nexus/plugin-sdk/backend";
import type {
  PluginContext,
  PluginInstallerContext,
} from "@nexus/plugin-sdk/backend";

export type CrmBindings = {
  DATABASE_PROVIDER: "d1" | "postgres";
  DB?: D1Database;
  HYPERDRIVE?: Hyperdrive;
  DATABASE_URL?: string;
};
export type CrmVariables = {
  db: DatabasePort;
  pluginContext?: PluginContext;
  installerContext?: PluginInstallerContext;
};
export type CrmEnv = { Bindings: CrmBindings; Variables: CrmVariables };
