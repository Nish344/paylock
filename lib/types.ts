// lib/types.ts

export interface Span {
  start: number;
  end: number;
}

export type Call<T> =
  | {
      ok: true;
      data: T;
      credits: number;
      replayed: boolean;
    }
  | {
      ok: false;
      error: string;
      status?: number;
      replayed?: boolean;
    };

// Extract endpoint response
export interface ExtractFieldItem {
  start: number;
  end: number;
  fields: Record<
    string,
    {
      value: string | null;
      start: number;
      end: number;
      confidence?: number;
    }
  >;
}

export interface ExtractField {
  value?: string | number | null | Array<Record<string, unknown>>;
  start?: number;
  end?: number;
  confidence?: number;
  items?: ExtractFieldItem[];
  row_anchor?: string;
}

export interface ExtractResponse {
  model?: string;
  fields: Record<string, ExtractField>;
  timing?: Record<string, number>;
}

// Fill endpoint response
export interface FillFieldItem {
  start?: number;
  end?: number;
  value?: string | number | boolean | null;
  [key: string]: unknown;
}

export interface FillField {
  value: string | number | boolean | null | string[] | Record<string, unknown>[];
  start?: number;
  end?: number;
  source?: "generated" | "source" | string;
  confidence?: number;
  items?: FillFieldItem[];
  [key: string]: unknown;
}

export interface FillResponse {
  model?: string;
  fields: Record<string, FillField>;
  timing?: Record<string, number>;
}

// Decide endpoint response
export interface DecideAnswer {
  type?: string;
  choice?: string;
  probabilities?: Record<string, number>;
  confidence?: number;
  noul?: number;
  decision?: boolean;
  score?: number;
  selected?: string[];
}

export interface DecideResponse {
  model?: string;
  answers: {
    recommendation?: DecideAnswer;
    [question: string]: DecideAnswer | undefined;
  };
  timing?: Record<string, number>;
}

// Guard (/clocked/injection) endpoint response
export interface GuardEvidence {
  quote: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface GuardResponse {
  model?: string;
  verdict: string; // "benign" | "injection" | ...
  injection: number; // 0..1
  category: string;
  categories?: Record<string, number>;
  severity?: string;
  evidence?: GuardEvidence[];
  timing?: Record<string, number>;
}

// Protect (/clocked/pii) endpoint response
export interface ProtectEntity {
  type: string;
  value: string;
  start: number;
  end: number;
  confidence?: number;
  source?: string;
}

export interface ProtectResponse {
  model?: string;
  entities: ProtectEntity[];
  counts?: Record<string, number>;
  anonymized_text?: string;
  timing?: Record<string, number>;
}

// Compare endpoint response
export interface ComparePassage {
  document: string;
  quote: string;
  start: number;
  end: number;
  confidence?: number;
}

export interface CompareConflict {
  kind?: string;
  a?: ComparePassage;
  b?: ComparePassage;
}

export interface ComparePair {
  a: string;
  b: string;
  relation: "same" | "overlapping" | "conflicting" | "unrelated" | string;
  related?: number;
  probabilities?: Record<string, number>;
  conflicts?: CompareConflict[];
  duplicates?: Array<{ kind?: string; a?: ComparePassage; b?: ComparePassage }>;
}

export interface CompareResponse {
  model?: string;
  verdict?: string;
  pairs: ComparePair[];
  timing?: Record<string, number>;
}

// Verify (/clocked/grounding) endpoint response
export interface VerifyClaim {
  claim: string;
  kind?: string;
  counted: boolean;
  weight?: number;
  verdict: "supported" | "contradicted" | "not_stated" | "not_a_claim" | string;
  supported?: number;
  contradicted?: number;
  not_stated?: number;
  not_a_claim?: number;
  source?: string | null;
  evidence?: {
    document?: string;
    quote: string;
    start: number;
    end: number;
    confidence?: number;
  };
}

export interface VerifyResponse {
  model?: string;
  grounded?: number;
  ungrounded?: number;
  verdict?: string;
  claims: VerifyClaim[];
  timing?: Record<string, number>;
}
