export type BalanceResponse = {
  balance: number;
  updatedAt: string;
};

export type StatementRow = {
  id: string;
  type: string;
  date: string;
  description: string;
  value: number;
  balance: number | null;
  paymentId: string | null;
  transferId: string | null;
};

export type StatementResponse = {
  hasMore: boolean;
  totalCount: number;
  limit: number;
  offset: number;
  data: StatementRow[];
};

export type PixKeyType = "CPF" | "CNPJ" | "EMAIL" | "PHONE" | "EVP";

export type PixTransfer = {
  id: string;
  externalReference: string;
  asaasTransferId: string | null;
  pixKeyType: PixKeyType;
  pixKeyMasked: string;
  valueCents: number;
  description: string | null;
  status: string;
  errorCode: string | null;
  authorizationStatus: "NOT_REQUESTED" | "APPROVED" | "REFUSED";
  authorizationReason: string | null;
  authorizationDecidedAt: string | number | null;
  createdAt: string | number;
  updatedAt: string | number;
};
