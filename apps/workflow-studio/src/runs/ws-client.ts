// WebSocket client for workflow run event streaming.
// Reconnect: exponential backoff 1s → 2s → 4s → cap 30s. Stops on explicit close().

export interface StepUpdateEvent {
  runId: string;
  stepId: string;
  nodeId: string;
  nodeType: string;
  status: 'running' | 'success' | 'error';
  outputJson?: string;
}

export interface RunCompleteEvent {
  runId: string;
  status: 'success' | 'error' | 'cancelled';
  error?: string;
  endedAt: string;
}

export type WsStatus = 'connecting' | 'open' | 'closed' | 'error';

export interface RunsWsClient {
  close(): void;
  status(): WsStatus;
}

interface RunsWsOpts {
  url: string;
  onStepUpdate: (event: StepUpdateEvent) => void;
  onRunComplete: (event: RunCompleteEvent) => void;
  onStatusChange?: (status: WsStatus) => void;
}

export function createRunsWsClient(opts: RunsWsOpts): RunsWsClient {
  let ws: WebSocket | null = null;
  let attempt = 0;
  let closed = false;
  let currentStatus: WsStatus = 'connecting';
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function setStatus(s: WsStatus) {
    currentStatus = s;
    opts.onStatusChange?.(s);
  }

  function connect() {
    if (closed) return;

    setStatus('connecting');
    ws = new WebSocket(opts.url);

    ws.onopen = () => {
      attempt = 0;
      setStatus('open');
    };

    ws.onmessage = (ev: MessageEvent) => {
      let msg: { type: string; [key: string]: unknown };
      try {
        msg = JSON.parse(ev.data as string) as { type: string; [key: string]: unknown };
      } catch {
        return;
      }
      if (msg.type === 'step_update') {
        opts.onStepUpdate(msg as unknown as StepUpdateEvent);
      } else if (msg.type === 'run_complete') {
        opts.onRunComplete(msg as unknown as RunCompleteEvent);
      }
    };

    ws.onerror = () => {
      setStatus('error');
    };

    ws.onclose = () => {
      if (closed) {
        setStatus('closed');
        return;
      }
      // Exponential backoff: 1000ms * 2^min(attempt, 5), capped at 30000ms
      const delay = Math.min(30000, 1000 * Math.pow(2, Math.min(attempt, 5)));
      attempt++;
      setStatus('error');
      reconnectTimer = setTimeout(() => {
        if (!closed) connect();
      }, delay);
    };
  }

  connect();

  return {
    close() {
      closed = true;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (ws) {
        ws.close();
        ws = null;
      }
      setStatus('closed');
    },
    status() {
      return currentStatus;
    },
  };
}
