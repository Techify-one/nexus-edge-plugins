// Local-only end-to-end test. A private host fixture connects the actual plugin UI to real D1.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { openDatabase } from "./integration/harness.ts";
import { app, LedgerService } from "../src/index.ts";
import { today } from "../src/domain/dates.ts";
import { readFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || require.resolve("playwright")
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const manifest = JSON.parse(
  await readFile(resolve(root, "financeiro/manifest.json"), "utf8"),
);
const db = await openDatabase("d1");
const env = db.testBindings;
const actor = {
  userId: "browser-integration",
  requestId: "browser-integration",
  permissions: manifest.permissions,
};
const ledger = new LedgerService(db, actor);
const date = today();
const mes = date.slice(0, 7);
const company = await ledger.createCompany({ nome: "Empresa E2E isolada" });
const bank = await ledger.createAccount(company.id, {
  nome: "Banco E2E",
  tipo: "BANCO",
  saldoInicialCentavos: "1000000",
  dataSaldoInicial: "2026-01-01",
});
const cash = await ledger.createAccount(company.id, {
  nome: "Caixa E2E",
  tipo: "CAIXA",
  saldoInicialCentavos: "0",
  dataSaldoInicial: "2026-01-01",
});
const category = await ledger.createCategory(company.id, {
  nome: "Serviços E2E",
  tipo: "DESPESA",
});
const html = `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><header style="height:64px;display:flex;align-items:center;gap:12px;padding:0 16px"><button id="host-back">Voltar</button><div data-nexus-plugin-header-nav="financeiro" style="min-width:0;flex:1;overflow-x:auto"></div></header><main id="root"></main><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;</script><script type="module">import React from 'react';import {FinanceApp} from '/financeiro/frontend/entry.tsx';import {mountReactPlugin} from '/.marketplace/frontend/src/plugin-host.tsx';const host={apiVersion:1,pluginId:'financeiro',locale:'pt-BR',theme:'light',permissions:${JSON.stringify(manifest.permissions)},api:(path,init)=>fetch('/api/v1/p/financeiro'+path,init),coreApi:(path,init)=>fetch(path,init),navigate:path=>history.pushState({},'',path),notify:()=>{},tablePreferences:{get:async()=>null,set:async()=>{}}};mountReactPlugin(document.getElementById('root'),host,React.createElement(FinanceApp,{host}));</script></body></html>`;
const server = await createServer({
  root,
  configFile: false,
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "financeiro-real-d1-fixture",
      configureServer(vite) {
        vite.middlewares.use(async (req, res, next) => {
          try {
            if (req.url?.startsWith("/api/v1/p/financeiro")) {
              const chunks = [];
              for await (const chunk of req) chunks.push(Buffer.from(chunk));
              const body = Buffer.concat(chunks);
              const headers = new Headers();
              for (const [name, value] of Object.entries(req.headers))
                if (value !== undefined)
                  headers.set(
                    name,
                    Array.isArray(value) ? value.join(",") : value,
                  );
              headers.set(
                "X-Plugin-Context",
                Buffer.from(JSON.stringify(actor)).toString("base64url"),
              );
              const response = await app.request(
                new Request(
                  "http://financeiro" +
                    req.url.replace("/api/v1/p/financeiro", ""),
                  {
                    method: req.method,
                    headers,
                    ...(body.length ? { body } : {}),
                  },
                ),
                undefined,
                env,
              );
              res.statusCode = response.status;
              response.headers.forEach((v, k) => res.setHeader(k, v));
              res.end(Buffer.from(await response.arrayBuffer()));
              return;
            }
            if (req.url?.startsWith("/api/v1/me/table-preferences/")) {
              res.setHeader("Content-Type", "application/json");
              res.end(JSON.stringify({ config: null }));
              return;
            }
            if (req.url?.startsWith("/app/")) {
              res.setHeader("Content-Type", "text/html");
              res.end(await vite.transformIndexHtml(req.url, html));
              return;
            }
            next();
          } catch (error) {
            res.statusCode = 500;
            res.end("Isolated test fixture error");
            console.error(error);
          }
        });
      },
    },
  ],
  server: { host: "127.0.0.1", port: 0, fs: { allow: [root] } },
});
let browser;
try {
  await server.listen();
  const origin = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  page.setDefaultTimeout(15000);
  const errors = [];
  page.on("console", (message) => {
    if (message.type() === "error") console.log("UI_ERROR", message.text());
  });
  page.on("pageerror", (e) => errors.push(e.message));
  console.log("TEST goto");
  await page.goto(
    `${origin}/app/p/financeiro/lancamentos?empresaId=${company.id}&mes=${mes}`,
  );
  console.log("TEST add");
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await page
    .getByLabel("Descrição", { exact: true })
    .fill("Despesa real D1 E2E");
  await page.getByLabel("Valor", { exact: true }).fill("100,01");
  await page
    .getByRole("dialog")
    .getByLabel("Categoria", { exact: true })
    .selectOption(category.id);
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.getByText("Despesa real D1 E2E", { exact: true }).waitFor();
  const entries = await ledger.list(company.id, "lancamentos");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].valorCentavos, "10001");
  await page
    .getByRole("button", { name: "Pagar ou receber", exact: true })
    .click();
  await page.getByLabel("Valor", { exact: true }).fill("40,01");
  await page.getByLabel("Conta", { exact: true }).selectOption(bank.id);
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await page.getByRole("cell", { name: "Parcial", exact: true }).waitFor();
  assert.equal(
    (await ledger.getEntry(company.id, entries[0].id)).liquidadoCentavos,
    "4001",
  );
  await page.getByRole("link", { name: "Transferências", exact: true }).click();
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await page.getByLabel("Valor", { exact: true }).fill("5,01");
  await page
    .getByLabel("Conta de origem", { exact: true })
    .selectOption(bank.id);
  await page
    .getByLabel("Conta de destino", { exact: true })
    .selectOption(cash.id);
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.getByText("R$ 5,01", { exact: false }).waitFor();
  const summary = await ledger.summary(company.id, mes);
  assert.equal(summary.saldoConsolidadoCentavos, "995999");
  assert.equal(summary.saidasCentavos, "4001");
  assert.equal(summary.resultadoCaixaCentavos, "-4001");
  await page.getByRole("link", { name: "Fechamento", exact: true }).click();
  await page.getByRole("button", { name: "Fechar mês", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await page.getByText("Fechado", { exact: true }).waitFor();
  const closures = await ledger.list(company.id, "fechamentos");
  assert.equal(closures.length, 1);
  assert.equal(closures[0].snapshot.saldoConsolidadoCentavos, "995999");
  await page.getByRole("button", { name: "Reabrir mês", exact: true }).click();
  await page
    .getByLabel("Justificativa", { exact: true })
    .fill("Conferência do teste isolado");
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await page.getByText("Reaberto", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Resumo", exact: true }).click();
  await page
    .locator(".metric-label")
    .filter({ hasText: "Saldo consolidado" })
    .waitFor();
  await page.screenshot({
    path: "/tmp/financeiro-real-d1-summary.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await page.getByRole("link", { name: "Recorrências", exact: true }).click();
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  const dialog = page.getByRole("dialog");
  const frequency = dialog.getByLabel("Frequência", { exact: true });
  assert.deepEqual(await frequency.locator("option").allTextContents(), [
    "Semanal",
    "Mensal",
    "Anual",
  ]);
  await dialog
    .getByLabel("Descrição", { exact: true })
    .fill("Recorrência mensal real E2E");
  await dialog.getByLabel("Valor", { exact: true }).fill("25,01");
  await dialog
    .getByLabel("Categoria", { exact: true })
    .selectOption(category.id);
  await frequency.selectOption("MES");
  await dialog.getByRole("button", { name: "Salvar", exact: true }).click();
  await page
    .getByText("Recorrência mensal real E2E", { exact: true })
    .waitFor();
  await page
    .locator(".metric-label")
    .filter({ hasText: "Despesas no mês" })
    .waitFor();
  assert.equal((await ledger.list(company.id, "recorrencias")).length, 1);
  assert.equal(
    (await ledger.list(company.id, "lancamentos")).filter(
      (e) => e.statusLancamento === "LANCADO",
    ).length,
    1,
  );
  assert.equal(
    (await ledger.recurrenceSummary(company.id, mes)).despesasCentavos,
    "2501",
  );
  const headerNav = page.locator(
    '[data-nexus-plugin-header-nav="financeiro"] nav',
  );
  await headerNav.waitFor();
  assert.equal(await page.locator(".financeiro > nav").count(), 0);
  const headerY = await headerNav.evaluate((e) => e.getBoundingClientRect().y);
  const backY = await page
    .locator("#host-back")
    .evaluate((e) => e.getBoundingClientRect().y);
  assert.ok(Math.abs(headerY - backY) < 32, "Navigation must share Back row");
  assert.equal(
    await page
      .getByRole("button", { name: "Gerar 90 dias", exact: true })
      .count(),
    0,
  );
  await page.getByText("Média mensal de entradas", { exact: true }).waitFor();
  await page.getByText("Média mensal de saídas", { exact: true }).waitFor();
  const tableTop = await page
    .locator("table")
    .first()
    .evaluate((element) => element.getBoundingClientRect().top);
  assert.ok(tableTop < 210, `Table begins too low: ${tableTop}px`);
  const search = page.getByRole("searchbox", { name: "Buscar recorrência" });
  await search.fill("não existe xyz");
  await page.getByText("Nenhum registro encontrado", { exact: true }).waitFor();
  await search.fill("mensal");
  await page
    .getByRole("cell", { name: "Recorrência mensal real E2E", exact: true })
    .waitFor();
  await page.reload({ waitUntil: "networkidle" });
  assert.equal(await search.inputValue(), "mensal");
  await search.fill("");
  await page
    .getByRole("cell", { name: "Recorrência mensal real E2E", exact: true })
    .waitFor();
  await page
    .getByRole("button", {
      name: "Sobre os totais e a geração automática",
      exact: true,
    })
    .click();
  await page.getByRole("dialog").waitFor();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole("searchbox", { name: "Buscar recorrência" }).waitFor();
  await page.screenshot({
    path: "/tmp/financeiro-compact-mobile.png",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.screenshot({
    path: "/tmp/financeiro-real-recurrences.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      ok: true,
      engine: "D1 real local",
      ui: "native React",
      entryCents: "10001",
      settledCents: "4001",
      transferCents: "501",
      balanceCents: "995999",
      closingReopened: true,
      productionDataChanged: false,
    }),
  );
} finally {
  if (browser) await browser.close();
  await server.close();
  await db.close();
}
