import { DcuLive } from './dcu-live';

export const dynamic = 'force-dynamic';

/**
 * U6 — DCU live telemetry detection.
 *
 * Server component shell. All the live wiring (Web Worker, WS to the
 * bridge, sparkline animation) lives in the client component below.
 */
export default function DcuPage() {
  return <DcuLive />;
}
