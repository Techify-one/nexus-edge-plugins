export type Row = { id: string; [key: string]: unknown };
export type Company = Row & { nome: string; ativo: boolean };
export type Account = Row & {
  nome: string;
  tipo: "BANCO" | "CAIXA";
  ativo: boolean;
  saldoInicialCentavos: string;
  dataSaldoInicial: string;
  saldoCentavos?: string;
};
export type Category = Row & {
  nome: string;
  tipo: "RECEITA" | "DESPESA";
  ativo: boolean;
};
export type Entry = Row & {
  descricao: string;
  tipo: "RECEITA" | "DESPESA";
  valorCentavos: string;
  liquidadoCentavos: string;
  pendenteCentavos: string;
  competencia: string;
  vencimento: string;
  categoriaId: string;
  contaPrevistaId?: string | null;
  confirmado: boolean;
  cancelado: boolean;
  situacao: "ABERTO" | "PARCIAL" | "LIQUIDADO" | "CANCELADO";
  observacao?: string;
};
export type Rule = {
  frequencia: "DIA" | "SEMANA" | "MES";
  intervalo: number;
  dia_mes?: number;
  semana_do_mes?: number;
  dia_semana?: number;
  ajuste_fds: "MANTER" | "ANTECIPAR" | "ADIAR";
};
export type Recurrence = Entry & {
  status: "ATIVA" | "PAUSADA" | "ENCERRADA";
  versao: number;
  ancora: string;
  inicio: string;
  fim?: string;
  regra: Rule;
  excecoes?: string[];
};
export type Movement = Row & {
  contaId: string;
  lancamentoId?: string;
  transferenciaId?: string;
  valorCentavos: string;
  dataEfetiva: string;
  sinal: 1 | -1;
  estornoDeId?: string;
  estornado: boolean;
};
export type Transfer = Row & {
  contaOrigemId: string;
  contaDestinoId: string;
  dataEfetiva: string;
  valorCentavos: string;
  descricao?: string;
  estornado?: boolean;
};
export type Closing = Row & {
  mes: string;
  versao: number;
  status: "FECHADO" | "REABERTO";
  createdAt: string;
  snapshot: Summary;
};
export type Summary = {
  mes: string;
  receitasCentavos: string;
  despesasCentavos: string;
  resultadoCompetenciaCentavos: string;
  entradasCentavos: string;
  saidasCentavos: string;
  resultadoCaixaCentavos: string;
  saldoConsolidadoCentavos: string;
  pendenteReceberCentavos: string;
  pendentePagarCentavos: string;
  estimadasReceitasCentavos?: string;
  estimadasDespesasCentavos?: string;
  contas: { id: string; nome: string; saldoCentavos: string }[];
};
export type Attachment = Row & {
  nome: string;
  contentType: string;
  tamanho: number;
  createdAt: string;
};
export type Audit = Row & {
  action: string;
  user_id: string;
  created_at: string;
  before: unknown;
  after: unknown;
  request_id?: string;
};
export type View = Row & { nome: string; filtros: Record<string, string> };
export type Notice = {
  ativo: boolean;
  chatId: string;
  diasAntecedencia: number;
  telegramConfigurado?: boolean;
};
export type List<T> = { data: T[]; total: number };
export type Single<T> = { data: T };
