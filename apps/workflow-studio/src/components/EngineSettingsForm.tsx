'use client';
import { useState, useEffect, useCallback } from 'react';
import { useForm } from 'react-hook-form';
import { Plus, Trash2, CheckCircle, XCircle } from 'lucide-react';
import {
  Button,
  Input,
  Label,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  cn,
} from '@synapcores/app-framework';

interface EngineEntry {
  id: string;
  label: string;
  url: string;
  createdAt: string;
}

interface FormValues {
  label: string;
  url: string;
  apiKey: string;
}

export function EngineSettingsForm() {
  const [engines, setEngines] = useState<EngineEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [testResult, setTestResult] = useState<'ok' | 'fail' | null>(null);
  const [testMessage, setTestMessage] = useState('');
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    reset,
    getValues,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: { label: '', url: '', apiKey: '' },
  });

  const loadEngines = useCallback(async () => {
    try {
      const res = await fetch('/api/v1/engine');
      if (!res.ok) throw new Error('Failed to load engines');
      const data = (await res.json()) as EngineEntry[];
      setEngines(data);
    } catch (err) {
      console.error('[EngineSettingsForm] load error:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadEngines();
  }, [loadEngines]);

  async function onSubmit(values: FormValues) {
    setSubmitting(true);
    setTestResult(null);
    try {
      const res = await fetch('/api/v1/engine/connect', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? 'Connection failed');
      }
      reset();
      await loadEngines();
    } catch (err) {
      console.error('[EngineSettingsForm] add error:', err);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleTest() {
    const values = getValues();
    setTestResult(null);
    setTestMessage('');
    try {
      const res = await fetch('/api/v1/engine/health', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: values.url, apiKey: values.apiKey }),
      });
      if (res.ok) {
        setTestResult('ok');
        setTestMessage('Connection successful');
      } else {
        const body = (await res.json()) as { error?: string };
        setTestResult('fail');
        setTestMessage(body.error ?? 'Connection failed');
      }
    } catch (err) {
      setTestResult('fail');
      setTestMessage(String(err));
    }
  }

  async function handleDelete(id: string) {
    setDeleteId(id);
    try {
      await fetch(`/api/v1/engine?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
      await loadEngines();
    } catch (err) {
      console.error('[EngineSettingsForm] delete error:', err);
    } finally {
      setDeleteId(null);
    }
  }

  return (
    <div className="space-y-6 mt-6">
      {/* Connected engines */}
      <div className="space-y-3">
        <h3 className="text-sm font-medium text-slate-300">Connected Engines</h3>
        {loading ? (
          <div className="h-16 bg-slate-800 rounded animate-pulse" />
        ) : engines.length === 0 ? (
          <p className="text-sm text-slate-500">No engines connected yet.</p>
        ) : (
          engines.map((engine) => (
            <Card key={engine.id} className="border-slate-800 bg-slate-900">
              <CardContent className="p-4 flex items-center justify-between">
                <div>
                  <div className="text-sm font-medium text-slate-200">{engine.label}</div>
                  <div className="text-xs text-slate-500 font-mono mt-0.5">
                    {engine.url.replace(/^(https?:\/\/)/, '$1').slice(0, 50)}
                    {engine.url.length > 50 ? '...' : ''}
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleDelete(engine.id)}
                  disabled={deleteId === engine.id}
                  className="text-slate-500 hover:text-red-400"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </CardContent>
            </Card>
          ))
        )}
      </div>

      {/* Add engine form */}
      <Card className="border-slate-800 bg-slate-900">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm text-slate-300">Add Engine</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={(e) => void handleSubmit(onSubmit)(e)} className="space-y-4">
            <div>
              <Label htmlFor="label" className="text-xs text-slate-400">
                Label
              </Label>
              <Input
                id="label"
                placeholder="Production engine"
                className="mt-1 bg-slate-800 border-slate-700 text-slate-200"
                {...register('label', { required: 'Label is required' })}
              />
              {errors.label && (
                <p className="text-xs text-red-400 mt-1">{errors.label.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="url" className="text-xs text-slate-400">
                URL
              </Label>
              <Input
                id="url"
                type="text"
                placeholder="http://localhost:28080"
                className="mt-1 bg-slate-800 border-slate-700 text-slate-200"
                {...register('url', { required: 'URL is required' })}
              />
              {errors.url && (
                <p className="text-xs text-red-400 mt-1">{errors.url.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="apiKey" className="text-xs text-slate-400">
                API Key
              </Label>
              <Input
                id="apiKey"
                type="password"
                placeholder="sk-..."
                className="mt-1 bg-slate-800 border-slate-700 text-slate-200"
                {...register('apiKey')}
              />
              <p className="text-xs text-slate-500 mt-1">
                API key is stored server-side only. Your browser never sees it again after
                submission.
              </p>
            </div>

            {testResult && (
              <div
                className={cn(
                  'flex items-center gap-2 text-sm p-2 rounded',
                  testResult === 'ok'
                    ? 'text-green-400 bg-green-900/20'
                    : 'text-red-400 bg-red-900/20',
                )}
              >
                {testResult === 'ok' ? (
                  <CheckCircle className="h-4 w-4" />
                ) : (
                  <XCircle className="h-4 w-4" />
                )}
                {testMessage}
              </div>
            )}

            <div className="flex gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void handleTest()}
              >
                Test Connection
              </Button>
              <Button type="submit" size="sm" disabled={submitting}>
                <Plus className="h-4 w-4 mr-1.5" />
                {submitting ? 'Connecting...' : 'Add Engine'}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
