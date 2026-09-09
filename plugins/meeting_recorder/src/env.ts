import type { DatabasePort } from "@nexus/plugin-sdk/backend";
import type {
  PluginContext,
  PluginInstallerContext,
  PluginPublicContext,
} from "@nexus/plugin-sdk/backend";

export type MeetingRecorderBindings = {
  DATABASE_PROVIDER: "d1" | "postgres";
  DB?: D1Database;
  HYPERDRIVE?: Hyperdrive;
  DATABASE_URL?: string;
  STORAGE?: R2Bucket;
  AI?: Ai;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_WEBHOOK_SECRET?: string;
};

export type MeetingRecorderVariables = {
  db: DatabasePort;
  pluginContext?: PluginContext;
  publicContext?: PluginPublicContext;
  installerContext?: PluginInstallerContext;
};

export type MeetingRecorderEnv = {
  Bindings: MeetingRecorderBindings;
  Variables: MeetingRecorderVariables;
};
