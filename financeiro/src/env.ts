import type {
  PluginContextV1,
  PluginDatabase,
  PluginDatabaseBindings,
  PluginInstallerContextV1,
} from "@nexus/plugin-sdk/backend";
export type Bindings = PluginDatabaseBindings & {
  DOCUMENTS?: R2Bucket;
  SCHEDULER?: DurableObjectNamespace;
  TELEGRAM_BOT_TOKEN?: string;
  FINANCEIRO_WEBHOOK_SECRET?: string;
  FINANCEIRO_WEBHOOK_URL?: string;
  FINANCEIRO_WEBHOOK_ALLOWED_HOSTS?: string;
};
export type FinanceEnv = {
  Bindings: Bindings;
  Variables: {
    db: PluginDatabase;
    pluginContext: PluginContextV1;
    installerContext: PluginInstallerContextV1;
  };
};
