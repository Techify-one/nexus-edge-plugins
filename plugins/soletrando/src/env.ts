import type { DatabasePort } from "@nexus/plugin-sdk/backend";
import type {
  PluginContext,
  PluginInstallerContext,
  PluginPublicContext,
} from "@nexus/plugin-sdk/backend";

export type SoletrandoBindings = {
  DATABASE_PROVIDER: "d1" | "postgres";
  DB?: Env["DB"];
  HYPERDRIVE?: Hyperdrive;
  DATABASE_URL?: string;
  AI?: Env["AI"];
};

export type SoletrandoVariables = {
  db: DatabasePort;
  pluginContext?: PluginContext;
  publicContext?: PluginPublicContext;
  installerContext?: PluginInstallerContext;
};

export type SoletrandoEnv = {
  Bindings: SoletrandoBindings;
  Variables: SoletrandoVariables;
};
