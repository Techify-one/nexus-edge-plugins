import { z } from "zod";
import { civil, month } from "./domain/dates.js";
export const id = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9_-]+$/);
const text = z.string().trim().min(1).max(200);
export const date = z.string().refine((value) => {
  try {
    civil(value);
    return true;
  } catch {
    return false;
  }
}, "Data civil inválida.");
export const monthSchema = z.string().refine((value) => {
  try {
    month(value);
    return true;
  } catch {
    return false;
  }
}, "Mês inválido.");
export const positiveMoney = z.string().regex(/^[1-9]\d{0,14}$/);
export const signedMoney = z.string().regex(/^(?:0|-?[1-9]\d{0,14})$/);
export const companySchema = z
  .object({ nome: text, ativo: z.boolean().optional() })
  .strict();
export const accountSchema = z
  .object({
    nome: text,
    tipo: z.enum(["BANCO", "CAIXA"]),
    saldoInicialCentavos: signedMoney.default("0"),
    dataSaldoInicial: date,
    ativo: z.boolean().default(true),
  })
  .strict();
export const categorySchema = z
  .object({
    nome: text,
    tipo: z.enum(["RECEITA", "DESPESA"]),
    ativo: z.boolean().default(true),
  })
  .strict();
export const settlementSchema = z
  .object({
    contaId: id,
    dataEfetiva: date,
    valorCentavos: positiveMoney,
    chaveIdempotencia: z.string().min(8).max(150),
  })
  .strict();
export const entrySchema = z
  .object({
    tipo: z.enum(["RECEITA", "DESPESA"]),
    descricao: text,
    valorCentavos: positiveMoney,
    competencia: date,
    vencimento: date,
    categoriaId: id,
    contaPrevistaId: id.nullable().optional(),
    contraparte: z.string().trim().max(200).optional(),
    chaveIdempotencia: z.string().min(8).max(150).optional(),
    observacao: z.string().max(5000).optional(),
    confirmado: z.boolean().default(true),
    liquidacao: settlementSchema.omit({ chaveIdempotencia: true }).optional(),
  })
  .strict();
export const reasonSchema = z
  .object({ motivo: z.string().trim().min(5).max(1000) })
  .strict();
export const reversalSchema = reasonSchema
  .extend({ dataEfetiva: date, chaveIdempotencia: z.string().min(8).max(150) })
  .strict();
export const transferSchema = z
  .object({
    contaOrigemId: id,
    contaDestinoId: id,
    dataEfetiva: date,
    valorCentavos: positiveMoney,
    descricao: text.optional(),
    chaveIdempotencia: z.string().min(8).max(150),
  })
  .strict();
export const ruleSchema = z
  .object({
    frequencia: z.enum(["DIA", "SEMANA", "MES", "ANO"]),
    intervalo: z.number().int().min(1).max(366),
    dia_mes: z.number().int().min(1).max(31).optional(),
    semana_do_mes: z
      .union([z.literal(-1), z.number().int().min(1).max(5)])
      .optional(),
    dia_semana: z.number().int().min(0).max(6).optional(),
    ajuste_fds: z.enum(["MANTER", "ANTECIPAR", "ADIAR"]),
  })
  .strict();
export const recurrenceSchema = entrySchema
  .omit({
    competencia: true,
    vencimento: true,
    liquidacao: true,
    chaveIdempotencia: true,
  })
  .extend({
    ancora: date,
    inicio: date,
    fim: date.nullable().optional(),
    regra: ruleSchema,
    excecoes: z.array(date).max(500).default([]),
  })
  .strict();
export const accountUpdateSchema = accountSchema
  .partial()
  .extend({
    saldoInicialCentavos: signedMoney.optional(),
    ativo: z.boolean().optional(),
  })
  .strict();
export const categoryUpdateSchema = categorySchema
  .partial()
  .extend({ ativo: z.boolean().optional() })
  .strict();
export const entryUpdateSchema = entrySchema
  .omit({ liquidacao: true, chaveIdempotencia: true })
  .partial()
  .extend({ confirmado: z.boolean().optional() })
  .strict();
export const generateSchema = z
  .object({ de: date.optional(), ate: date.optional() })
  .strict();
export const recurrenceUpdate = recurrenceSchema
  .partial()
  .extend({
    confirmado: z.boolean().optional(),
    excecoes: z.array(date).max(500).optional(),
    status: z.enum(["ATIVA", "PAUSADA", "ENCERRADA"]).optional(),
    escopo: z.literal("FUTURAS").default("FUTURAS"),
  })
  .strict();
export const viewSchema = z
  .object({
    nome: text,
    filtros: z
      .object({
        tipo: z.enum(["RECEITA", "DESPESA"]).optional(),
        mes: monthSchema.optional(),
        situacao: z
          .enum(["ABERTO", "PARCIAL", "LIQUIDADO", "CANCELADO"])
          .optional(),
        categoriaId: id.optional(),
        contaPrevistaId: id.optional(),
        busca: z.string().max(200).optional(),
      })
      .strict(),
  })
  .strict();
export const noticeSchema = z
  .object({
    ativo: z.boolean(),
    chatId: z.string().regex(/^-?\d{1,20}$/),
    diasAntecedencia: z.number().int().min(0).max(30),
  })
  .strict();
