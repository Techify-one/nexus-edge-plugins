# Cloudflare Platform Probe

Conformance plugin for the Nexus package-format-2 installer. Its installer
smoke test writes and reads the installation database, R2, KV and a SQLite
Durable Object, then publishes a Queue message. The manifest also requests a
Queue consumer with a dead-letter queue and an hourly Cron trigger.

This plugin exists to validate the platform contract. It is not intended for
production business data.
