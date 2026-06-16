/** Shared types for the aerospace-rca app. */

export type Program = 'BE-4' | 'BE-3' | 'NS' | 'NG' | 'HLS';

export type Severity = 'critical' | 'major' | 'minor' | 'observation';

export type AnomalyStatus =
  | 'open'
  | 'investigating'
  | 'closed'
  | 'corrective-action-applied';

export interface Anomaly {
  id: string;
  ts: string;
  program: string;
  subsystem: string;
  unit_id: string;
  severity: string;
  status: string;
  title: string;
  description: string;
  reporter: string;
  test_stand: string | null;
  source_doc: string | null;
}

export interface SimilarAnomaly extends Anomaly {
  similarity: number;
}

export interface RFA {
  id: string;
  opened_ts: string;
  program: string;
  subsystem: string;
  title: string;
  description: string;
  owner: string;
  status: string;
  days_open: number;
  related_anomaly_id: string | null;
  related_part_id: string | null;
}

export interface CorrectiveAction {
  id: string;
  anomaly_id: string;
  ts: string;
  title: string;
  description: string;
  owner: string;
  status: string;
  applied_to_programs: string | null;
}

export interface EvidenceChainEntry {
  id: string;
  ts: string;
  actor: string;
  action: string;
  target_id: string;
  details: string;
}

export interface AgentFinding {
  persona: 'reliability_engineer' | 'safety_officer';
  summary: string;
  programs_covered: Array<{ program: string; status: 'covered' | 'unprotected' }>;
  rfa_flags: Array<{ id: string; reason: string; days_open: number }>;
  recommended_action: string;
  citations: string[];
  duration_ms: number;
  prose?: string;
}
