'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Code2, Copy, LoaderCircle, SquareSplitVertical, TriangleAlert, X } from 'lucide-react';
import { Button } from './button';
import { getDocsThemeName, waitForMonacoReady } from '../editor';
import type { CompilerDiagnostic } from '../runtime';

interface RawPanelProps {
  js?: string;
  error?: string;
  diagnostics?: CompilerDiagnostic[];
  isCompiling?: boolean;
  splitActive?: boolean;
  onToggleSplit?: () => void;
}

declare global {
  interface Window {
    // Monaco is loaded through the existing browser loader, which does not
    // publish TypeScript declarations for the AMD global.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    monaco: any;
    monacoLoaded?: boolean;
  }
}

/**
 * Displays the exact JavaScript returned by the browser compiler. This panel
 * deliberately has no transformation layer: the same string is sent to the
 * sandbox execution path and copied to the clipboard.
 */
export function RawPanel({ js, error, diagnostics, isCompiling = false, splitActive, onToggleSplit }: RawPanelProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const monacoRef = useRef<any>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!editorRef.current || js === undefined) return;

    let disposed = false;
    const createEditor = () => {
      if (!editorRef.current || disposed) return;
      monacoRef.current?.dispose();
      monacoRef.current = window.monaco.editor.create(editorRef.current, {
        value: js,
        language: 'javascript',
        theme: getDocsThemeName(),
        readOnly: true,
        domReadOnly: true,
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 14,
        lineHeight: 22,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        renderLineHighlight: 'none',
        scrollbar: { vertical: 'auto', horizontal: 'auto' },
      });
    };

    if (window.monaco && window.monacoLoaded) {
      createEditor();
    } else {
      void waitForMonacoReady().then(() => {
        if (!disposed) createEditor();
      });
    }

    return () => {
      disposed = true;
      monacoRef.current?.dispose();
      monacoRef.current = null;
    };
  }, [js]);

  const handleCopy = async () => {
    if (js === undefined) return;
    await navigator.clipboard.writeText(js);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Code2 className="h-3.5 w-3.5" />
          RAW <span className="normal-case font-mono font-normal">JavaScript</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={onToggleSplit}
            className="gap-1.5"
            title={splitActive ? 'Hide split view' : 'Show Console and RAW together'}
          >
            {splitActive ? <X className="h-4 w-4" /> : <SquareSplitVertical className="h-4 w-4" />}
            {splitActive ? 'Hide' : 'Split'}
          </Button>
          <Button variant="ghost" size="sm" onClick={handleCopy} disabled={js === undefined} className="gap-1.5">
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
      </div>

      <div className="relative min-h-0 flex-1 overflow-hidden">
        {js !== undefined ? (
          <div ref={editorRef} className="h-full" aria-label="Compiled JavaScript" />
        ) : error || diagnostics?.length ? (
          <div className="m-4 space-y-3">
            {diagnostics?.map((diagnostic, index) => {
              const location = [diagnostic.file, diagnostic.line, diagnostic.column]
                .filter((part) => part !== undefined)
                .join(':');
              return (
                <div key={index} className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                  <div className="mb-1 flex flex-wrap items-center gap-2 text-xs font-semibold uppercase tracking-wider">
                    <span>{diagnostic.severity}</span>
                    {diagnostic.code ? <code className="rounded bg-black/10 px-1 py-0.5 dark:bg-white/10">{diagnostic.code}</code> : null}
                    {location ? <span className="font-normal opacity-80">→ {location}</span> : null}
                  </div>
                  <pre className="whitespace-pre-wrap break-all">{diagnostic.message}</pre>
                </div>
              );
            })}
            {error && !diagnostics?.length ? (
              <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                <pre className="whitespace-pre-wrap break-all">{error}</pre>
              </div>
            ) : null}
          </div>
        ) : (
          <div className="flex h-full items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
            {isCompiling ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}
            <span>{isCompiling ? 'Compiling JavaScript…' : 'Edit code or click Run to inspect the emitted JavaScript.'}</span>
          </div>
        )}
      </div>
    </div>
  );
}
