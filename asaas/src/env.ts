import type { DatabasePort } from "@nexus/plugin-sdk/backend";
import type {
  PluginContext,
  PluginInstallerContext,
} from "@nexus/plugin-sdk/backend";

export type AsaasBindings = {
  DATABASE_PROVIDER: "d1" | "postgres";
  DB?: D1Database;
  HYPERDRIVE?: Hyperdrive;
  DATABASE_URL?: string;
  ASAAS_API_KEY?: string;
};

export type AsaasVariables = {
  db: DatabasePort;
  pluginContext?: PluginContext;
  installerContext?: PluginInstallerContext;
};

export type AsaasEnv = {
  Bindings: AsaasBindings;
  Variables: AsaasVariables;
};
