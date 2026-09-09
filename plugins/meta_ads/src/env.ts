import type { DatabasePort } from "@nexus/plugin-sdk/backend";
import type {
  PluginContext,
  PluginInstallerContext,
} from "@nexus/plugin-sdk/backend";

export type MetaAdsBindings = {
  DATABASE_PROVIDER: "d1" | "postgres";
  DB?: D1Database;
  HYPERDRIVE?: Hyperdrive;
  DATABASE_URL?: string;
  META_ACCESS_TOKEN?: string;
  META_API_VERSION?: string;
};

export type MetaAdsVariables = {
  db: DatabasePort;
  pluginContext?: PluginContext;
  installerContext?: PluginInstallerContext;
};

export type MetaAdsEnv = {
  Bindings: MetaAdsBindings;
  Variables: MetaAdsVariables;
};
