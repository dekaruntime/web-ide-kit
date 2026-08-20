'use client';

import { useEffect, useState } from 'react';
import { ConsolePanel } from './ConsolePanel';
import { RawPanel } from './RawPanel';
import type { CompilerDiagnostic } from '../runtime';

interface TourOutputPanelProps {
  stdout: string;
  stderr: string;
  error?: string;
  diagnostics?: CompilerDiagnostic[];
  source?: string;
  onClear: () => void;
  displayJs?: string;
  compileError?: string;
  isCompiling?: boolean;
  storageNamespace?: string;
  ariaLabel?: string;
}

function getInitialActiveView(viewKey: string): 'console' | 'raw' {
  if (typeof window === 'undefined') return 'console';
  const saved = localStorage.getItem(viewKey);
  return saved === 'raw' ? 'raw' : 'console';
}

function getInitialSplitView(splitKey: string): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(splitKey) === 'true';
}

export function TourOutputPanel({
  stdout,
  stderr,
  error,
  diagnostics,
  source,
  onClear,
  displayJs,
  compileError,
  isCompiling,
  storageNamespace = 'deka.web-ide',
  ariaLabel = 'Output views',
}: TourOutputPanelProps) {
  const viewKey = `${storageNamespace}.outputView`;
  const splitKey = `${storageNamespace}.outputSplit`;

  const [activeView, setActiveView] = useState<'console' | 'raw'>(() => getInitialActiveView(viewKey));
  const [splitView, setSplitView] = useState(() => getInitialSplitView(splitKey));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(viewKey, activeView);
  }, [activeView, viewKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(splitKey, String(splitView));
  }, [splitView, splitKey]);

  const handleSetActiveView = (view: 'console' | 'raw') => {
    setActiveView(view);
    if (view !== 'raw') {
      setSplitView(false);
    }
  };

  const handleToggleSplit = () => {
    setSplitView((prev) => {
      const next = !prev;
      if (next) {
        setActiveView('raw');
      }
      return next;
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!splitView && (
        <div className="flex shrink-0 border-b border-border bg-card px-2" role="tablist" aria-label={ariaLabel}>
          {(['console', 'raw'] as const).map((view) => (
            <button
              key={view}
              type="button"
              role="tab"
              aria-selected={activeView === view}
              onClick={() => handleSetActiveView(view)}
              className={`border-b-2 px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
                activeView === view
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {view === 'raw' ? 'RAW' : 'Console'}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {splitView ? (
          <div className="flex h-full min-h-0 flex-row">
            <div className="min-h-0 flex-1 border-r border-border">
              <ConsolePanel stdout={stdout} stderr={stderr} error={error} diagnostics={diagnostics} source={source} onClear={onClear} />
            </div>
            <div className="min-h-0 flex-1">
              <RawPanel
                js={displayJs}
                error={compileError}
                diagnostics={diagnostics}
                isCompiling={isCompiling}
                splitActive
                onToggleSplit={handleToggleSplit}
              />
            </div>
          </div>
        ) : activeView === 'console' ? (
          <ConsolePanel stdout={stdout} stderr={stderr} error={error} diagnostics={diagnostics} source={source} onClear={onClear} />
        ) : (
          <RawPanel
            js={displayJs}
            error={compileError}
            diagnostics={diagnostics}
            isCompiling={isCompiling}
            splitActive={false}
            onToggleSplit={handleToggleSplit}
          />
        )}
      </div>
    </div>
  );
}
