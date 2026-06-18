'use client';

// SampleDataEditor — FR-37 sample-data fixtures for test-mode runs.
// Allows users to define a JSON object that simulates the NEW/OLD row
// that will be passed to the workflow when testing.

import { useState, useEffect } from 'react';
import { X, AlertCircle, CheckCircle } from 'lucide-react';
import { useWorkflowStore } from '@/store/workflow-store';
import { useShallow } from 'zustand/react/shallow';

function isValidJson(str: string): boolean {
  if (!str.trim()) return true;
  try {
    JSON.parse(str);
    return true;
  } catch {
    return false;
  }
}

export function SampleDataEditor() {
  const { sampleDataEditorOpen, toggleSampleDataEditor, sampleData, setSampleData } =
    useWorkflowStore(useShallow((s) => ({
      sampleDataEditorOpen: s.sampleDataEditorOpen,
      toggleSampleDataEditor: s.toggleSampleDataEditor,
      sampleData: s.sampleData,
      setSampleData: s.setSampleData,
    })));

  const [text, setText] = useState('');
  const [parseError, setParseError] = useState(false);

  // Sync in from store when opened
  useEffect(() => {
    if (sampleDataEditorOpen) {
      setText(
        Object.keys(sampleData).length > 0
          ? JSON.stringify(sampleData, null, 2)
          : '{\n  "id": "row_001",\n  "description": "Sample input text"\n}',
      );
      setParseError(false);
    }
  }, [sampleDataEditorOpen, sampleData]);

  function handleChange(val: string) {
    setText(val);
    setParseError(!isValidJson(val));
  }

  function handleSave() {
    if (parseError) return;
    try {
      const parsed = text.trim() ? (JSON.parse(text) as Record<string, unknown>) : {};
      setSampleData(parsed);
      toggleSampleDataEditor(false);
    } catch {
      setParseError(true);
    }
  }

  if (!sampleDataEditorOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) toggleSampleDataEditor(false);
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Sample data editor"
    >
      <div className="w-full max-w-xl mx-4 bg-slate-900 border border-slate-700/60 rounded-xl shadow-2xl overflow-hidden flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700/60">
          <div>
            <h2 className="text-sm font-semibold text-slate-100">Sample Data Fixtures</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Defines the <code className="text-blue-400">NEW</code> row injected when running in Test mode
            </p>
          </div>
          <button
            onClick={() => toggleSampleDataEditor(false)}
            className="text-slate-500 hover:text-slate-300 transition-colors"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Editor */}
        <div className="flex-1 overflow-hidden flex flex-col p-4 gap-3">
          <div className="flex items-center gap-2 text-xs">
            {parseError ? (
              <span className="flex items-center gap-1 text-red-400">
                <AlertCircle className="h-3.5 w-3.5" />
                Invalid JSON
              </span>
            ) : (
              <span className="flex items-center gap-1 text-green-400">
                <CheckCircle className="h-3.5 w-3.5" />
                Valid JSON
              </span>
            )}
          </div>
          <textarea
            value={text}
            onChange={(e) => handleChange(e.target.value)}
            className="flex-1 w-full min-h-[200px] px-3 py-2.5 text-xs font-mono bg-slate-950 border border-slate-700 rounded text-slate-200 focus:outline-none focus:border-blue-500 resize-none leading-relaxed"
            spellCheck={false}
            aria-label="Sample data JSON"
            aria-invalid={parseError}
          />
          <p className="text-[10px] text-slate-600">
            These values are available as <code className="text-slate-400">@NEW.field_name</code> inside SQL, agent prompts, and memory expressions during test runs.
          </p>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-slate-700/60">
          <button
            onClick={() => toggleSampleDataEditor(false)}
            className="px-3 py-1.5 text-xs text-slate-400 hover:text-slate-200 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={parseError}
            className="px-4 py-1.5 text-xs font-medium bg-blue-700 text-white rounded hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Save Fixtures
          </button>
        </div>
      </div>
    </div>
  );
}
