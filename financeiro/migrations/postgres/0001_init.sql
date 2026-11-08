CREATE TABLE financeiro_empresas (
 id TEXT PRIMARY KEY, nome TEXT NOT NULL, ativo INTEGER NOT NULL DEFAULT 1 CHECK (ativo IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 0 CHECK (revision >= 0), created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE financeiro_contas (
 id TEXT PRIMARY KEY, empresa_id TEXT NOT NULL REFERENCES financeiro_empresas(id), payload TEXT NOT NULL,
 UNIQUE (empresa_id,id)
);
CREATE TABLE financeiro_categorias (
 id TEXT PRIMARY KEY, empresa_id TEXT NOT NULL REFERENCES financeiro_empresas(id), tipo TEXT NOT NULL CHECK (tipo IN ('RECEITA','DESPESA')), payload TEXT NOT NULL,
 UNIQUE (empresa_id,id), UNIQUE (empresa_id,id,tipo)
);
CREATE TABLE financeiro_recorrencias (
 id TEXT PRIMARY KEY, empresa_id TEXT NOT NULL REFERENCES financeiro_empresas(id), categoria_id TEXT NOT NULL, conta_id TEXT, tipo TEXT NOT NULL CHECK (tipo IN ('RECEITA','DESPESA')), payload TEXT NOT NULL,
 UNIQUE (empresa_id,id), FOREIGN KEY (empresa_id,categoria_id,tipo) REFERENCES financeiro_categorias(empresa_id,id,tipo),
 FOREIGN KEY (empresa_id,conta_id) REFERENCES financeiro_contas(empresa_id,id)
);
CREATE TABLE financeiro_lancamentos (
 id TEXT PRIMARY KEY, empresa_id TEXT NOT NULL REFERENCES financeiro_empresas(id), categoria_id TEXT NOT NULL, conta_id TEXT, recorrencia_id TEXT, ocorrencia TEXT,
 tipo TEXT NOT NULL CHECK (tipo IN ('RECEITA','DESPESA')), competencia TEXT NOT NULL, vencimento TEXT NOT NULL, valor_centavos TEXT NOT NULL, payload TEXT NOT NULL,
 UNIQUE (empresa_id,id), UNIQUE (empresa_id,recorrencia_id,ocorrencia),
 FOREIGN KEY (empresa_id,categoria_id,tipo) REFERENCES financeiro_categorias(empresa_id,id,tipo),
 FOREIGN KEY (empresa_id,conta_id) REFERENCES financeiro_contas(empresa_id,id),
 FOREIGN KEY (empresa_id,recorrencia_id) REFERENCES financeiro_recorrencias(empresa_id,id),
 CHECK (valor_centavos ~ '^[1-9][0-9]{0,14}$')
);
CREATE TABLE financeiro_transferencias (
 id TEXT PRIMARY KEY, empresa_id TEXT NOT NULL REFERENCES financeiro_empresas(id), origem_id TEXT NOT NULL, destino_id TEXT NOT NULL, payload TEXT NOT NULL,
 UNIQUE (empresa_id,id), CHECK (origem_id <> destino_id),
 FOREIGN KEY (empresa_id,origem_id) REFERENCES financeiro_contas(empresa_id,id),
 FOREIGN KEY (empresa_id,destino_id) REFERENCES financeiro_contas(empresa_id,id)
);
CREATE TABLE financeiro_movimentos (
 id TEXT PRIMARY KEY, empresa_id TEXT NOT NULL REFERENCES financeiro_empresas(id), lancamento_id TEXT, conta_id TEXT NOT NULL, transferencia_id TEXT, estorno_de_id TEXT,
 data_efetiva TEXT NOT NULL, valor_centavos TEXT NOT NULL, sinal INTEGER NOT NULL CHECK (sinal IN (-1,1)), payload TEXT NOT NULL,
 UNIQUE (empresa_id,id), UNIQUE (empresa_id,estorno_de_id),
 CHECK ((lancamento_id IS NOT NULL AND transferencia_id IS NULL) OR (lancamento_id IS NULL AND transferencia_id IS NOT NULL)),
 FOREIGN KEY (empresa_id,lancamento_id) REFERENCES financeiro_lancamentos(empresa_id,id),
 FOREIGN KEY (empresa_id,conta_id) REFERENCES financeiro_contas(empresa_id,id),
 FOREIGN KEY (empresa_id,transferencia_id) REFERENCES financeiro_transferencias(empresa_id,id),
 FOREIGN KEY (empresa_id,estorno_de_id) REFERENCES financeiro_movimentos(empresa_id,id),
 CHECK (valor_centavos ~ '^[1-9][0-9]{0,14}$')
);
CREATE TABLE financeiro_fechamentos (
 id TEXT PRIMARY KEY, empresa_id TEXT NOT NULL REFERENCES financeiro_empresas(id), mes TEXT NOT NULL, versao INTEGER NOT NULL CHECK (versao > 0), payload TEXT NOT NULL,
 UNIQUE (empresa_id,id), UNIQUE (empresa_id,mes,versao)
);
CREATE TABLE financeiro_visoes (
 id TEXT PRIMARY KEY, empresa_id TEXT NOT NULL REFERENCES financeiro_empresas(id), user_id TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE (empresa_id,id)
);
CREATE TABLE financeiro_anexos (
 id TEXT PRIMARY KEY, empresa_id TEXT NOT NULL REFERENCES financeiro_empresas(id), lancamento_id TEXT NOT NULL, payload TEXT NOT NULL, UNIQUE (empresa_id,id),
 FOREIGN KEY (empresa_id,lancamento_id) REFERENCES financeiro_lancamentos(empresa_id,id)
);
CREATE TABLE financeiro_avisos (
 id TEXT PRIMARY KEY, empresa_id TEXT NOT NULL REFERENCES financeiro_empresas(id), payload TEXT NOT NULL, UNIQUE (empresa_id,id)
);
CREATE TABLE financeiro_idempotencia (
 id TEXT PRIMARY KEY, empresa_id TEXT NOT NULL REFERENCES financeiro_empresas(id), chave TEXT NOT NULL, hash TEXT NOT NULL, payload TEXT NOT NULL,
 UNIQUE (empresa_id,id), UNIQUE (empresa_id,chave)
);
CREATE TABLE financeiro_auditoria (
 id TEXT PRIMARY KEY, empresa_id TEXT NOT NULL REFERENCES financeiro_empresas(id), user_id TEXT NOT NULL, request_id TEXT NOT NULL,
 action TEXT NOT NULL, before_json TEXT NOT NULL, after_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE financeiro_outbox (
 id TEXT PRIMARY KEY, empresa_id TEXT NOT NULL REFERENCES financeiro_empresas(id), event_type TEXT NOT NULL, payload TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','SENT','BLOCKED')), created_at TEXT NOT NULL, sent_at TEXT
);
CREATE INDEX financeiro_lancamentos_periodo_idx ON financeiro_lancamentos(empresa_id,competencia,vencimento);
CREATE INDEX financeiro_movimentos_periodo_idx ON financeiro_movimentos(empresa_id,data_efetiva);
CREATE INDEX financeiro_movimentos_conta_idx ON financeiro_movimentos(empresa_id,conta_id,data_efetiva);
CREATE INDEX financeiro_movimentos_lancamento_idx ON financeiro_movimentos(empresa_id,lancamento_id);
CREATE INDEX financeiro_auditoria_empresa_idx ON financeiro_auditoria(empresa_id,created_at);
CREATE INDEX financeiro_outbox_pending_idx ON financeiro_outbox(status,created_at);
CREATE INDEX financeiro_visoes_user_idx ON financeiro_visoes(empresa_id,user_id);
