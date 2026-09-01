'use client';

import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { X, SquareSplitVertical } from 'lucide-react';
import { Button } from './button';
import { ConsolePanel } from './ConsolePanel';
import { RawPanel } from './RawPanel';
import type { CompilerDiagnostic } from '../runtime';

/**
 * An additional output tab supplied by the host app, rendered alongside the
 * built-in Console and RAW panes.
 *
 * The panel owns the chrome — tab button, header, split toggle — so a consumer
 * only provides content. That keeps every pane's affordances identical instead
 * of leaving each host to re-implement the split button.
 */
export interface OutputPane {
  /** Stable identifier. Persisted in localStorage, so do not change it casually. */
  key: string;
  /** Tab label. Rendered uppercase to match Console / RAW. */
  label: string;
  /** Optional subtitle shown next to the header title, in normal case. */
  hint?: string;
  content: ReactNode;
}

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
  /** Extra tabs after RAW. Omit for the built-in Console/RAW behaviour. */
  extraPanes?: OutputPane[];
}

const CONSOLE = 'console';
const RAW = 'raw';

function getInitialActiveView(viewKey: string, valid: string[]): string {
  if (typeof window === 'undefined') return CONSOLE;
  const saved = localStorage.getItem(viewKey);
  return saved !== null && valid.includes(saved) ? saved : CONSOLE;
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
  extraPanes = [],
}: TourOutputPanelProps) {
  const viewKey = `${storageNamespace}.outputView`;
  const splitKey = `${storageNamespace}.outputSplit`;

  const views = useMemo(
    () => [CONSOLE, RAW, ...extraPanes.map((pane) => pane.key)],
    [extraPanes]
  );

  const [activeView, setActiveView] = useState<string>(() => getInitialActiveView(viewKey, views));
  const [splitView, setSplitView] = useState(() => getInitialSplitView(splitKey));

  // A pane can disappear between sessions (a host stops passing it) while the
  // saved view still names it. Fall back rather than render nothing.
  useEffect(() => {
    if (!views.includes(activeView)) setActiveView(CONSOLE);
  }, [views, activeView]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(viewKey, activeView);
  }, [activeView, viewKey]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(splitKey, String(splitView));
  }, [splitView, splitKey]);

  const handleSetActiveView = (view: string) => {
    setActiveView(view);
    // Split always pairs Console with something else, so selecting Console
    // itself has nothing left to pair with.
    if (view === CONSOLE) setSplitView(false);
  };

  const handleToggleSplit = () => {
    setSplitView((prev) => {
      const next = !prev;
      if (next && activeView === CONSOLE) setActiveView(RAW);
      return next;
    });
  };

  const labelFor = (view: string) => {
    if (view === RAW) return 'RAW';
    if (view === CONSOLE) return 'Console';
    return extraPanes.find((pane) => pane.key === view)?.label ?? view;
  };

  const rawPane = (splitActive: boolean) => (
    <RawPanel
      js={displayJs}
      error={compileError}
      diagnostics={diagnostics}
      isCompiling={isCompiling}
      splitActive={splitActive}
      onToggleSplit={handleToggleSplit}
    />
  );

  const consolePane = (
    <ConsolePanel
      stdout={stdout}
      stderr={stderr}
      error={error}
      diagnostics={diagnostics}
      source={source}
      onClear={onClear}
    />
  );

  /** Chrome for a host-supplied pane, matching RawPanel's header. */
  const extraPane = (pane: OutputPane, splitActive: boolean) => (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {pane.label}
          {pane.hint ? (
            <span className="font-mono font-normal normal-case">{pane.hint}</span>
          ) : null}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleToggleSplit}
          className="gap-1.5"
          title={splitActive ? 'Hide split view' : `Show Console and ${pane.label} together`}
        >
          {splitActive ? <X className="h-4 w-4" /> : <SquareSplitVertical className="h-4 w-4" />}
          {splitActive ? 'Hide' : 'Split'}
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">{pane.content}</div>
    </div>
  );

  const renderView = (view: string, splitActive: boolean) => {
    if (view === CONSOLE) return consolePane;
    if (view === RAW) return rawPane(splitActive);
    const pane = extraPanes.find((candidate) => candidate.key === view);
    return pane ? extraPane(pane, splitActive) : consolePane;
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!splitView && (
        <div
          className="flex shrink-0 border-b border-border bg-card px-2"
          role="tablist"
          aria-label={ariaLabel}
        >
          {views.map((view) => (
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
              {labelFor(view)}
            </button>
          ))}
        </div>
      )}
      <div className="min-h-0 flex-1">
        {splitView ? (
          <div className="flex h-full min-h-0 flex-row">
            <div className="min-h-0 flex-1 border-r border-border">{consolePane}</div>
            <div className="min-h-0 flex-1">
              {renderView(activeView === CONSOLE ? RAW : activeView, true)}
            </div>
          </div>
        ) : (
          renderView(activeView, false)
        )}
      </div>
    </div>
  );
}
