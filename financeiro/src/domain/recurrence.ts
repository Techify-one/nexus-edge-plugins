import { addDays, civil, month, monthEnd } from "./dates.js";

export type Frequencia = "DIA" | "SEMANA" | "MES" | "ANO";
export type AjusteFimDeSemana = "MANTER" | "ANTECIPAR" | "ADIAR";

export interface Regra {
  frequencia: Frequencia;
  intervalo: number;
  dia_mes?: number;
  semana_do_mes?: number;
  dia_semana?: number;
  ajuste_fds: AjusteFimDeSemana;
}

export interface Ocorrencia {
  chave: string;
  dataNominal: string;
  vencimento: string;
  indice: number;
}

export interface Janela {
  inicio: string;
  fim?: string | null;
  /** Inclusive nominal-date bounds. Callers enforce the 90-day request cap. */
  de: string;
  ate: string;
  limite?: number;
}

export class RegraInvalida extends Error {}

export function validarRegra(regra: Regra): void {
  if (!regra || !["DIA", "SEMANA", "MES", "ANO"].includes(regra.frequencia)) {
    throw new RegraInvalida("Frequência deve ser DIA, SEMANA, MES ou ANO.");
  }
  if (
    !Number.isInteger(regra.intervalo) ||
    regra.intervalo < 1 ||
    regra.intervalo > 366
  ) {
    throw new RegraInvalida(
      "O intervalo deve ser um número inteiro entre 1 e 366.",
    );
  }
  if (!["MANTER", "ANTECIPAR", "ADIAR"].includes(regra.ajuste_fds)) {
    throw new RegraInvalida(
      "Ajuste de fim de semana deve ser MANTER, ANTECIPAR ou ADIAR.",
    );
  }
  if (
    regra.frequencia !== "MES" &&
    (regra.dia_mes !== undefined ||
      regra.semana_do_mes !== undefined ||
      regra.dia_semana !== undefined)
  ) {
    throw new RegraInvalida(
      "Dia do mês e semana do mês só valem para frequência mensal.",
    );
  }
  if (
    regra.dia_mes !== undefined &&
    (!Number.isInteger(regra.dia_mes) ||
      regra.dia_mes < 1 ||
      regra.dia_mes > 31)
  ) {
    throw new RegraInvalida("Dia do mês deve estar entre 1 e 31.");
  }
  if (regra.dia_mes !== undefined && regra.semana_do_mes !== undefined) {
    throw new RegraInvalida(
      "Use dia do mês OU enésimo dia da semana, não os dois.",
    );
  }
  if (regra.semana_do_mes !== undefined) {
    if (![1, 2, 3, 4, 5, -1].includes(regra.semana_do_mes)) {
      throw new RegraInvalida("Semana do mês deve ser 1 a 5, ou -1 (última).");
    }
    if (
      regra.dia_semana === undefined ||
      !Number.isInteger(regra.dia_semana) ||
      regra.dia_semana < 0 ||
      regra.dia_semana > 6
    ) {
      throw new RegraInvalida(
        "Informe o dia da semana (0 = domingo até 6 = sábado).",
      );
    }
  } else if (regra.dia_semana !== undefined) {
    throw new RegraInvalida("Dia da semana exige semana do mês.");
  }
}

const partes = (iso: string) => {
  civil(iso);
  const [a, m, d] = iso.split("-").map(Number);
  return { a: a!, m: m!, d: d! };
};

function mesIso(a: number, m: number): string {
  if (!Number.isInteger(a) || !Number.isInteger(m))
    throw new RegraInvalida("Ano e mês devem ser inteiros.");
  return month(`${String(a).padStart(4, "0")}-${String(m).padStart(2, "0")}`);
}

export function ultimoDia(a: number, m: number): number {
  return Number(monthEnd(mesIso(a, m)).slice(8));
}

export function diaDaSemana(iso: string): number {
  return new Date(`${civil(iso)}T00:00:00.000Z`).getUTCDay();
}

export function somarDias(iso: string, dias: number): string {
  return addDays(iso, dias);
}

export function enesimoDiaDaSemana(
  a: number,
  m: number,
  n: number,
  diaSemana: number,
): number | null {
  if (
    ![1, 2, 3, 4, 5, -1].includes(n) ||
    !Number.isInteger(diaSemana) ||
    diaSemana < 0 ||
    diaSemana > 6
  ) {
    throw new RegraInvalida("Semana do mês ou dia da semana inválido.");
  }
  const ultimo = ultimoDia(a, m);
  const prefixo = mesIso(a, m);
  if (n === -1)
    return ultimo - ((diaDaSemana(`${prefixo}-${ultimo}`) - diaSemana + 7) % 7);
  const primeiro = 1 + ((diaSemana - diaDaSemana(`${prefixo}-01`) + 7) % 7);
  const dia = primeiro + (n - 1) * 7;
  return dia <= ultimo ? dia : null;
}

/** Every occurrence is computed from the anchor, never from the prior result. */
export function nominal(
  regra: Regra,
  ancora: string,
  n: number,
): string | null {
  validarRegra(regra);
  const base = partes(ancora);
  if (!Number.isSafeInteger(n) || n < 0)
    throw new RegraInvalida("Índice deve ser um inteiro não negativo.");
  if (regra.frequencia !== "MES" && regra.frequencia !== "ANO") {
    return somarDias(
      ancora,
      n * regra.intervalo * (regra.frequencia === "SEMANA" ? 7 : 1),
    );
  }
  const total =
    base.a * 12 +
    base.m -
    1 +
    n * regra.intervalo * (regra.frequencia === "ANO" ? 12 : 1);
  const a = Math.floor(total / 12);
  const m = (total % 12) + 1;
  const prefixo = mesIso(a, m);
  const dia =
    regra.semana_do_mes !== undefined && regra.dia_semana !== undefined
      ? enesimoDiaDaSemana(a, m, regra.semana_do_mes, regra.dia_semana)
      : Math.min(regra.dia_mes ?? base.d, ultimoDia(a, m));
  return dia === null
    ? null
    : civil(`${prefixo}-${String(dia).padStart(2, "0")}`);
}

export function ajustarFimDeSemana(
  iso: string,
  ajuste: AjusteFimDeSemana,
): string {
  civil(iso);
  if (!["MANTER", "ANTECIPAR", "ADIAR"].includes(ajuste))
    throw new RegraInvalida("Ajuste de fim de semana inválido.");
  if (ajuste === "MANTER") return iso;
  const ds = diaDaSemana(iso);
  if (ds !== 0 && ds !== 6) return iso;
  return somarDias(
    iso,
    ajuste === "ANTECIPAR" ? (ds === 6 ? -1 : -2) : ds === 6 ? 2 : 1,
  );
}

function indiceDoPeriodo(regra: Regra, ancora: string, data: string): number {
  if (regra.frequencia === "MES" || regra.frequencia === "ANO") {
    const base = partes(ancora);
    const alvo = partes(data);
    const meses = (alvo.a - base.a) * 12 + alvo.m - base.m;
    return Math.floor(
      meses / (regra.intervalo * (regra.frequencia === "ANO" ? 12 : 1)),
    );
  }
  const dias =
    (Date.parse(`${data}T00:00:00Z`) - Date.parse(`${ancora}T00:00:00Z`)) /
    86_400_000;
  return Math.floor(
    dias / (regra.intervalo * (regra.frequencia === "SEMANA" ? 7 : 1)),
  );
}

function indiceInicial(regra: Regra, ancora: string, de: string): number {
  return Math.max(0, indiceDoPeriodo(regra, ancora, de) - 1);
}

export function proximas(
  regra: Regra,
  ancora: string,
  janela: Janela,
): Ocorrencia[] {
  validarRegra(regra);
  civil(ancora);
  civil(janela.inicio);
  civil(janela.de);
  civil(janela.ate);
  if (janela.fim !== undefined && janela.fim !== null) civil(janela.fim);
  if (
    janela.limite !== undefined &&
    (!Number.isSafeInteger(janela.limite) || janela.limite < 0)
  ) {
    throw new RegraInvalida("Limite deve ser um inteiro não negativo.");
  }
  const de = janela.de > janela.inicio ? janela.de : janela.inicio;
  const ate = janela.fim && janela.fim < janela.ate ? janela.fim : janela.ate;
  const limite = janela.limite ?? Number.POSITIVE_INFINITY;
  const saida: Ocorrencia[] = [];
  if (de > ate || ancora > ate || limite === 0) return saida;

  // A period bound also terminates months with no fifth weekday occurrence.
  const ultimoIndice = indiceDoPeriodo(regra, ancora, ate);
  for (
    let n = indiceInicial(regra, ancora, de), iteracoes = 0;
    n <= ultimoIndice;
    n++, iteracoes++
  ) {
    if (iteracoes >= 20_000)
      throw new RegraInvalida("Janela excede o limite de cálculo.");
    const data = nominal(regra, ancora, n);
    if (data === null || data < de || data < ancora || data > ate) continue;
    saida.push({
      chave: data,
      dataNominal: data,
      vencimento: ajustarFimDeSemana(data, regra.ajuste_fds),
      indice: n,
    });
    if (saida.length >= limite) break;
  }
  return saida;
}

export function descreverRegra(regra: Regra): string {
  validarRegra(regra);
  const DIAS = [
    "domingo",
    "segunda-feira",
    "terça-feira",
    "quarta-feira",
    "quinta-feira",
    "sexta-feira",
    "sábado",
  ];
  const ORDINAL: Record<number, string> = {
    1: "primeira",
    2: "segunda",
    3: "terceira",
    4: "quarta",
    5: "quinta",
    [-1]: "última",
  };
  const n = regra.intervalo;
  let base: string;
  if (regra.frequencia === "DIA")
    base = n === 1 ? "todo dia" : `a cada ${n} dias`;
  else if (regra.frequencia === "SEMANA")
    base = n === 1 ? "toda semana" : `a cada ${n} semanas`;
  else if (regra.frequencia === "ANO")
    base = n === 1 ? "todo ano" : `a cada ${n} anos`;
  else {
    const periodo =
      n === 1
        ? "todo mês"
        : n === 6
          ? "a cada semestre"
          : n === 12
            ? "todo ano"
            : `a cada ${n} meses`;
    if (regra.semana_do_mes !== undefined && regra.dia_semana !== undefined) {
      const dia = DIAS[regra.dia_semana];
      const masc = regra.dia_semana === 0 || regra.dia_semana === 6;
      const ord = ORDINAL[regra.semana_do_mes]!;
      base = `${periodo}, n${masc ? "o" : "a"} ${masc ? ord.replace(/a$/, "o") : ord} ${dia}`;
    } else if (regra.dia_mes !== undefined)
      base = `${periodo}, no dia ${regra.dia_mes}`;
    else base = `${periodo}, no dia da data âncora`;
  }
  const ajuste = {
    MANTER: "",
    ANTECIPAR: " (fim de semana antecipa para sexta)",
    ADIAR: " (fim de semana adia para segunda)",
  }[regra.ajuste_fds];
  return `${base}${ajuste}`;
}

/** Periods follow the installation's civil calendar; weeks start on Monday. */
export function periodoAtual(
  regra: Regra,
  data: string,
): { de: string; ate: string } {
  civil(data);
  if (regra.frequencia === "DIA") return { de: data, ate: data };
  if (regra.frequencia === "SEMANA") {
    const de = addDays(data, -((diaDaSemana(data) + 6) % 7));
    return { de, ate: addDays(de, 6) };
  }
  if (
    regra.frequencia === "ANO" ||
    (regra.frequencia === "MES" && regra.intervalo % 12 === 0)
  )
    return {
      de: `${data.slice(0, 4)}-01-01`,
      ate: `${data.slice(0, 4)}-12-31`,
    };
  return { de: `${data.slice(0, 7)}-01`, ate: monthEnd(data) };
}
