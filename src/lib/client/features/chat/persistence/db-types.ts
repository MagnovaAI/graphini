export interface DbMessageRow {
  content: string;
  created_at: string;
  id: string;
  metadata: Record<string, unknown> | null;
  model_used: string | null;
  parts: unknown;
  role: string;
}
