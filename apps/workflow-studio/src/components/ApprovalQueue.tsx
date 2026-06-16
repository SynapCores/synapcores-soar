'use client';
import { useState, useEffect, useCallback } from 'react';
import { CheckCircle, XCircle, Clock } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
} from '@synapcores/app-framework';

interface ApprovalItem {
  id: string;
  runId: string;
  nodeId: string;
  state: string;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string | null;
  reason: string | null;
  workflowId: string;
}

export function ApprovalQueue() {
  const [approvals, setApprovals] = useState<ApprovalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [rejectId, setRejectId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [actingId, setActingId] = useState<string | null>(null);

  const loadApprovals = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/approvals');
      if (!res.ok) throw new Error('Failed to load approvals');
      const data = (await res.json()) as ApprovalItem[];
      setApprovals(data);
    } catch (err) {
      console.error('[ApprovalQueue] load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadApprovals();
    const interval = setInterval(() => void loadApprovals(), 10000);
    return () => clearInterval(interval);
  }, [loadApprovals]);

  async function decide(id: string, decision: 'approved' | 'rejected', reason?: string) {
    setActingId(id);
    try {
      await fetch(`/api/v1/approvals/${id}/decide`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decision, reason }),
      });
      setRejectId(null);
      setRejectReason('');
      await loadApprovals();
    } catch (err) {
      console.error('[ApprovalQueue] decide error:', err);
    } finally {
      setActingId(null);
    }
  }

  if (loading) {
    return (
      <div className="mt-6 space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="h-28 bg-slate-800 rounded animate-pulse" />
        ))}
      </div>
    );
  }

  if (approvals.length === 0) {
    return (
      <div className="mt-6 flex flex-col items-center justify-center py-16 text-slate-500">
        <CheckCircle className="h-12 w-12 mb-3 opacity-30" />
        <p className="text-sm">No approvals pending</p>
      </div>
    );
  }

  return (
    <div className="mt-6 space-y-4">
      {approvals.map((item) => (
        <Card key={item.id} className="border-slate-800 bg-slate-900">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm text-slate-200 flex items-center gap-2">
                <Clock className="h-4 w-4 text-yellow-400" />
                Approval Required
              </CardTitle>
              <span className="text-xs text-slate-500">
                {new Date(item.requestedAt).toLocaleString()}
              </span>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="text-xs text-slate-500 space-y-1">
              <div>
                <span className="text-slate-600">Workflow: </span>
                <span className="font-mono">{item.workflowId.slice(0, 8)}</span>
              </div>
              <div>
                <span className="text-slate-600">Run: </span>
                <span className="font-mono">{item.runId.slice(0, 8)}</span>
              </div>
              <div>
                <span className="text-slate-600">Node: </span>
                <span className="font-mono">{item.nodeId}</span>
              </div>
            </div>

            {rejectId === item.id ? (
              <div className="space-y-2">
                <input
                  type="text"
                  placeholder="Reason for rejection (optional)"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-slate-500"
                />
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => void decide(item.id, 'rejected', rejectReason || undefined)}
                    disabled={actingId === item.id}
                  >
                    <XCircle className="h-3.5 w-3.5 mr-1" />
                    Confirm Reject
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRejectId(null);
                      setRejectReason('');
                    }}
                  >
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex gap-2">
                <Button
                  size="sm"
                  className="bg-green-600 hover:bg-green-700 text-white"
                  onClick={() => void decide(item.id, 'approved')}
                  disabled={actingId === item.id}
                >
                  <CheckCircle className="h-3.5 w-3.5 mr-1" />
                  Approve
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="border-red-500/40 text-red-400 hover:bg-red-900/20"
                  onClick={() => setRejectId(item.id)}
                  disabled={actingId === item.id}
                >
                  <XCircle className="h-3.5 w-3.5 mr-1" />
                  Reject
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
