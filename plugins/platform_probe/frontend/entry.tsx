import { definePlugin } from "@nexus/plugin-sdk";
import "./styles.css";

export default definePlugin({
  mountPage({ container, host }) {
    const title =
      host.locale === "en"
        ? "Cloudflare platform probe"
        : "Teste da plataforma Cloudflare";
    const run = host.locale === "en" ? "Run probe" : "Executar teste";
    container.innerHTML = `<main class="platform-probe"><h1>${title}</h1><p>R2 · KV · Queue · Durable Objects · Cron</p><button type="button">${run}</button><pre aria-live="polite"></pre></main>`;
    const button = container.querySelector<HTMLButtonElement>("button")!;
    const output = container.querySelector<HTMLPreElement>("pre")!;
    const controller = new AbortController();
    const execute = async () => {
      button.disabled = true;
      try {
        const response = await host.api("/run", {
          method: "POST",
          signal: controller.signal,
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        output.textContent = JSON.stringify(await response.json(), null, 2);
        host.notify({
          message: "Cloudflare resources verified",
          tone: "success",
        });
      } catch (error) {
        if (!controller.signal.aborted)
          host.notify({
            message: error instanceof Error ? error.message : "Probe failed",
            tone: "error",
          });
      } finally {
        button.disabled = false;
      }
    };
    button.addEventListener("click", execute);
    return {
      dispose() {
        controller.abort();
        button.removeEventListener("click", execute);
        container.replaceChildren();
      },
    };
  },
});
