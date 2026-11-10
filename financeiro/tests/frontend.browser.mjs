// Run with Node 24+. PLAYWRIGHT_MODULE may point to an existing playwright index.mjs.
// This is a controlled UI/API-contract fixture, not a production data seed.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const require = createRequire(import.meta.url);
const { chromium } = await import(
  process.env.PLAYWRIGHT_MODULE || require.resolve("playwright")
);
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const html = `<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><header style="height:64px;display:flex;align-items:center;gap:12px;padding:0 16px"><button id="host-back">Voltar</button><div data-nexus-plugin-header-nav="financeiro" style="min-width:0;flex:1;overflow-x:auto"></div></header><main id="root"></main><script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type; window.__vite_plugin_react_preamble_installed__=true;</script><script type="module">
import { FinanceApp } from '/financeiro/frontend/entry.tsx';
import { mountReactPlugin } from '/.marketplace/frontend/src/plugin-host.tsx';
import React from 'react';
const config=window.__testConfig; document.documentElement.dataset.theme=config.theme; document.documentElement.classList.toggle('dark',config.theme==='dark');
const host={apiVersion:1,pluginId:'financeiro',locale:config.locale,theme:config.theme,permissions:config.permissions,api:(path,init)=>fetch('/api/v1/p/financeiro'+path,init),coreApi:(path,init)=>fetch(path,init),navigate:path=>history.pushState({},'',path),notify:()=>{},tablePreferences:{get:async()=>null,set:async()=>{}}};
mountReactPlugin(document.getElementById('root'),host,React.createElement(FinanceApp,{host}));
</script></body></html>`;
const server = await createServer({
  root,
  configFile: false,
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "financeiro-test-html",
      configureServer(vite) {
        vite.middlewares.use((req, res, next) => {
          if (!req.url?.startsWith("/app/")) return next();
          vite
            .transformIndexHtml(req.url, html)
            .then((content) => {
              res.setHeader("Content-Type", "text/html");
              res.end(content);
            })
            .catch(next);
        });
      },
    },
  ],
  server: {
    host: "127.0.0.1",
    port: 0,
    fs: { allow: [root, "/home/francisco/nexus-edge/plugins"] },
  },
});
await server.listen();
const address = server.httpServer.address();
const origin = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const resources = [
  "empresas",
  "contas",
  "categorias",
  "lancamentos",
  "movimentos",
  "transferencias",
  "recorrencias",
  "fechamentos",
  "resumo",
  "relatorios",
  "visoes",
  "auditoria",
  "anexos",
  "avisos",
];
const permissions = resources.flatMap((resource) =>
  [
    "read",
    "create",
    "update",
    "delete",
    "cancel",
    "reverse",
    "generate",
    "close",
    "reopen",
    "manage",
  ].map((action) => `financeiro.${resource}.${action}`),
);
const date = "2026-11-08";
const state = {
  empresas: [
    { id: "company", nome: "UI test company", ativo: 1 },
    { id: "company2", nome: "Second company", ativo: 1 },
  ],
  contas: [
    {
      id: "bank",
      nome: "Test bank",
      tipo: "BANCO",
      ativo: true,
      saldoInicialCentavos: "1000000",
      saldoCentavos: "1000000",
      dataSaldoInicial: date,
    },
    {
      id: "cash",
      nome: "Test cash",
      tipo: "CAIXA",
      ativo: true,
      saldoInicialCentavos: "0",
      saldoCentavos: "0",
      dataSaldoInicial: date,
    },
  ],
  categorias: [
    { id: "category", nome: "Services", tipo: "DESPESA", ativo: true },
  ],
  lancamentos: [],
  movimentos: [],
  transferencias: [],
  recorrencias: [],
  fechamentos: [],
  visoes: [],
  auditoria: [],
  anexos: [],
};
const mutations = [];
const reads = [];
let searchDelay = 0;
let generation = 0;
const summary = {
  mes: "2026-11",
  receitasCentavos: "0",
  despesasCentavos: "10001",
  resultadoCompetenciaCentavos: "-10001",
  entradasCentavos: "0",
  saidasCentavos: "1",
  resultadoCaixaCentavos: "-1",
  saldoConsolidadoCentavos: "999999",
  pendenteReceberCentavos: "0",
  pendentePagarCentavos: "10000",
  contas: state.contas.map((account) => ({
    id: account.id,
    nome: account.nome,
    saldoCentavos: account.saldoCentavos,
  })),
};
async function configure(
  page,
  locale = "pt-BR",
  theme = "light",
  grants = permissions,
) {
  await page.addInitScript(
    (config) => {
      window.__testConfig = config;
    },
    { locale, theme, permissions: grants },
  );
  await page.route("**/api/v1/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname.replace("/api/v1/p/financeiro", "");
    const [resource, id, action] = path.slice(1).split("/");
    const data = request.postData();
    let body = {};
    try {
      body = data ? JSON.parse(data) : {};
    } catch {}
    const reply = (value) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(value),
      });
    if (url.pathname.includes("/table-preferences/"))
      return reply({ tableId: path.split("/").at(-1), config: null });
    if (request.method() === "GET") {
      reads.push(`${url.pathname}${url.search}`);
      if (resource === "recorrencias" && !id && searchDelay)
        await new Promise((resolve) => setTimeout(resolve, searchDelay));
      if (resource === "resumo") return reply({ data: summary });
      if (resource === "recorrencias" && id === "resumo")
        return reply({
          data: { receitasCentavos: "50000", despesasCentavos: "10000" },
        });
      if (resource === "avisos")
        return reply({
          data: {
            ativo: false,
            chatId: "-123",
            diasAntecedencia: 1,
            telegramConfigurado: false,
          },
        });
      const rows = state[resource] ?? [];
      return reply({ data: rows, total: rows.length });
    }
    mutations.push({ resource, id, action, body });
    if (resource === "recorrencias" && id === "gerar")
      return reply({
        data:
          ++generation === 1
            ? { gerados: 20, restantes: 3, concluido: false }
            : { gerados: 3, restantes: 0, concluido: true },
      });
    if (resource === "recorrencias" && id === "previa")
      return reply({ data: [{ vencimento: date, dataNominal: date }] });
    if (resource === "lancamentos" && action === "baixas") {
      const entry = state.lancamentos.find((row) => row.id === id);
      entry.liquidadoCentavos = body.valorCentavos;
      entry.pendenteCentavos = String(
        BigInt(entry.valorCentavos) - BigInt(body.valorCentavos),
      );
      entry.situacao = "PARCIAL";
      state.movimentos.push({
        id: "movement",
        contaId: body.contaId,
        lancamentoId: id,
        valorCentavos: body.valorCentavos,
        dataEfetiva: body.dataEfetiva,
        sinal: -1,
        estornado: false,
      });
      return reply({ data: entry });
    }
    if (resource === "movimentos" && action === "estornar") {
      state.movimentos[0].estornado = true;
      return reply({ data: {} });
    }
    if (resource === "fechamentos" && action === "reabrir") {
      state.fechamentos.find((row) => row.id === id).status = "REABERTO";
      return reply({ data: {} });
    }
    if (request.method() === "PATCH") {
      const row = state[resource].find((row) => row.id === id);
      Object.assign(row, body);
      return reply({ data: row });
    }
    const row = { ...body, id: `${resource}${state[resource]?.length ?? 0}` };
    if (resource === "lancamentos")
      Object.assign(row, {
        liquidadoCentavos: "0",
        pendenteCentavos: body.valorCentavos,
        situacao: "ABERTO",
        cancelado: false,
      });
    if (resource === "fechamentos")
      Object.assign(row, {
        status: "FECHADO",
        versao: 1,
        createdAt: new Date().toISOString(),
        snapshot: summary,
      });
    state[resource]?.push(row);
    return reply({ data: row });
  });
}
try {
  const page = await browser.newPage({
    viewport: { width: 1366, height: 900 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await configure(page);
  await page.goto(
    `${origin}/app/p/financeiro/cadastros?empresaId=company&mes=2026-11&cadastro=contas`,
  );
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await page.getByLabel("Nome", { exact: true }).fill("UI-created account");
  await page.getByLabel("Saldo inicial", { exact: true }).fill("25,01");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.getByText("UI-created account", { exact: true }).waitFor();
  assert.equal(
    mutations.find((m) => m.resource === "contas").body.saldoInicialCentavos,
    "2501",
  );
  await page.getByRole("link", { name: "Lançamentos", exact: true }).click();
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await page
    .getByLabel("Descrição", { exact: true })
    .fill("Browser contract entry");
  await page.getByLabel("Valor", { exact: true }).fill("100,01");
  await page
    .getByRole("dialog")
    .getByLabel("Categoria", { exact: true })
    .selectOption("category");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.getByText("Browser contract entry", { exact: true }).waitFor();
  assert.equal(
    mutations.find((m) => m.resource === "lancamentos").body.valorCentavos,
    "10001",
  );
  assert.ok(
    mutations.find((m) => m.resource === "lancamentos").body.chaveIdempotencia,
  );
  await page
    .getByRole("button", { name: "Pagar ou receber", exact: true })
    .click();
  await page.getByLabel("Valor", { exact: true }).fill("0,01");
  await page.getByLabel("Conta", { exact: true }).selectOption("bank");
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await page.getByRole("cell", { name: "Parcial", exact: true }).waitFor();
  await page.getByText("Browser contract entry", { exact: true }).click();
  await page.getByRole("button", { name: "Estornar", exact: true }).click();
  await page
    .getByLabel("Justificativa", { exact: true })
    .fill("Reversão de teste");
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await page.getByRole("link", { name: "Transferências", exact: true }).click();
  await page.getByRole("button", { name: "Adicionar", exact: true }).click();
  await page.getByLabel("Valor", { exact: true }).fill("5,01");
  await page
    .getByLabel("Conta de origem", { exact: true })
    .selectOption("bank");
  await page
    .getByLabel("Conta de destino", { exact: true })
    .selectOption("cash");
  await page.getByRole("button", { name: "Salvar", exact: true }).click();
  await page.getByText("R$ 5,01", { exact: false }).waitFor();
  await page.getByRole("link", { name: "Fechamento", exact: true }).click();
  await page.getByRole("button", { name: "Fechar mês", exact: true }).click();
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await page.getByText("Fechado", { exact: true }).waitFor();
  await page.screenshot({
    path: "/tmp/financeiro-ui-closing.png",
    fullPage: true,
  });
  await page.getByRole("button", { name: "Reabrir mês", exact: true }).click();
  await page
    .getByLabel("Justificativa", { exact: true })
    .fill("Ajuste de conferência");
  await page.getByRole("button", { name: "Confirmar", exact: true }).click();
  await page.getByText("Reaberto", { exact: true }).waitFor();
  await page.getByRole("link", { name: "Recorrências", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "Gerar 90 dias", exact: true })
      .count(),
    0,
  );
  await page
    .locator('[data-nexus-plugin-header-nav="financeiro"] nav')
    .waitFor();
  assert.equal(await page.locator(".financeiro > nav").count(), 0);
  await page.getByText("Média mensal de entradas", { exact: true }).waitFor();
  await page.getByText("Média mensal de saídas", { exact: true }).waitFor();
  await page.waitForTimeout(400);
  const search = page.getByRole("searchbox");
  const inputHandle = await search.elementHandle();
  const startReads = reads.length;
  searchDelay = 700;
  await search.click();
  await search.pressSequentially("aluguel", { delay: 40 });
  assert.equal(await search.inputValue(), "aluguel");
  assert.ok(
    await inputHandle.evaluate((input) => input === document.activeElement),
  );
  await page.waitForURL(/buscaRecorrencias=aluguel/);
  await page.waitForTimeout(900);
  assert.ok(
    await inputHandle.evaluate((input) => input === document.activeElement),
  );
  const searchReads = reads.slice(startReads);
  assert.equal(searchReads.length, 1, JSON.stringify(searchReads));
  assert.ok(searchReads[0].includes("busca=aluguel"));
  await search.fill("a");
  await page.waitForURL(/buscaRecorrencias=a(?:&|$)/);
  await search.fill("aluguel");
  await page.waitForURL(/buscaRecorrencias=aluguel/);
  await page.waitForTimeout(900);
  assert.equal(await search.inputValue(), "aluguel");
  assert.ok(
    await inputHandle.evaluate((input) => input === document.activeElement),
  );
  await search.fill("");
  await page.waitForURL((url) => !url.searchParams.has("buscaRecorrencias"));
  await page.waitForTimeout(900);
  searchDelay = 0;
  await page.screenshot({
    path: "/tmp/financeiro-header-averages.png",
    fullPage: true,
  });
  await page.getByRole("link", { name: "Resumo", exact: true }).click();
  await page
    .locator(".metric-label")
    .filter({ hasText: "Saldo consolidado" })
    .waitFor();
  await page.screenshot({
    path: "/tmp/financeiro-ui-summary-light.png",
    fullPage: true,
  });
  assert.deepEqual(errors, []);
  await page.close();
  const readonly = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await configure(readonly, "en", "dark", [
    "financeiro.empresas.read",
    "financeiro.lancamentos.read",
    "financeiro.contas.read",
    "financeiro.categorias.read",
  ]);
  await readonly.goto(
    `${origin}/app/p/financeiro/lancamentos?empresaId=company&mes=2026-11`,
  );
  await readonly.getByText("Browser contract entry", { exact: true }).waitFor();
  assert.equal(
    await readonly.getByRole("button", { name: "Add", exact: true }).count(),
    0,
  );
  assert.equal(
    await readonly
      .getByRole("button", { name: "Pay or receive", exact: true })
      .count(),
    0,
  );
  assert.equal(await readonly.locator("h1").count(), 0);
  await readonly.screenshot({
    path: "/tmp/financeiro-ui-readonly-dark-mobile.png",
    fullPage: true,
  });
  await readonly.close();
  console.log(
    "PASS native browser UI: account, entry, partial settlement, reversal, transfer, close/reopen, automatic generation without manual button, pt-BR/en, dark/mobile and read-only permissions.",
  );
} finally {
  await browser.close();
  await server.close();
}
