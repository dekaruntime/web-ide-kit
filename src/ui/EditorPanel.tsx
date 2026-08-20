'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Play, Wand2 } from 'lucide-react';
import { Button } from './button';
import { waitForMonacoReady, getDocsThemeName, createDekaScriptLspWorkerBridge, DekaScriptDiagnosticsAdapter, DEKASCRIPT_LANGUAGE_ID } from '../editor';
import { formatDekaDs } from '../runtime';

interface EditorPanelProps {
  source: string;
  filename: string;
  documentUriPrefix: string;
  onChange: (value: string) => void;
  onRun: () => void;
  isRunning?: boolean;
  compiler?: { name: string; version: string; sourceCommit: string };
  formatOnKeystroke?: boolean;
  formatOnRun?: boolean;
  showFormatButton?: boolean;
  toolbarActions?: ReactNode;
}

declare global {
  interface Window {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    require: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    monaco: any;
    monacoLoaded?: boolean;
  }
}

export function EditorPanel({
  source,
  filename,
  documentUriPrefix,
  onChange,
  onRun,
  isRunning,
  compiler,
  formatOnKeystroke = true,
  formatOnRun = true,
  showFormatButton = false,
  toolbarActions,
}: EditorPanelProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const monacoRef = useRef<any>(null);
  const [isLoading, setIsLoading] = useState(!globalThis.window?.monaco);
  const formatTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const applyFormattedSource = useCallback(
    async (value: string) => {
      const result = await formatDekaDs(value);
      if (!result.ok || result.code === undefined || result.code === value) return;

      const editor = monacoRef.current;
      if (!editor) return;

      const model = editor.getModel();
      if (!model) return;

      // Replace the entire model with the formatted source, preserving cursor
      // position by computing the full-range edit through Monaco.
      const fullRange = model.getFullModelRange();
      const position = editor.getPosition();
      editor.executeEdits('deka-format', [
        {
          range: fullRange,
          text: result.code,
          forceMoveMarkers: false,
        },
      ]);
      if (position) {
        editor.setPosition(position);
      }
      onChange(result.code);
    },
    [onChange]
  );

  const handleRun = useCallback(async () => {
    if (formatOnRun) {
      const value = monacoRef.current?.getValue();
      if (typeof value === 'string') {
        await applyFormattedSource(value);
      }
    }
    onRun();
  }, [applyFormattedSource, formatOnRun, onRun]);

  const handleFormat = useCallback(() => {
    const value = monacoRef.current?.getValue();
    if (typeof value === 'string') {
      void applyFormattedSource(value);
    }
  }, [applyFormattedSource]);

  useEffect(() => {
    if (!editorRef.current) return;

    let disposed = false;
    let disposeLspBridge: (() => void) | undefined;

    const createEditor = () => {
      if (!editorRef.current || disposed) return;

      if (monacoRef.current) {
        monacoRef.current.dispose();
        monacoRef.current = null;
      }

      editorRef.current.innerHTML = '';

      monacoRef.current = window.monaco.editor.create(editorRef.current, {
        value: source,
        language: 'dekascript',
        theme: getDocsThemeName(),
        automaticLayout: true,
        minimap: { enabled: false },
        fontSize: 14,
        lineHeight: 22,
        lineNumbers: 'on',
        scrollBeyondLastLine: false,
        wordWrap: 'on',
        renderLineHighlight: 'line',
        tabSize: 2,
        insertSpaces: true,
        detectIndentation: false,
        folding: true,
        scrollbar: {
          vertical: 'auto',
          horizontal: 'auto',
        },
      });

      const model = monacoRef.current.getModel();
      const documentUri = `${documentUriPrefix}${encodeURIComponent(filename)}`;
      const lspBridge = createDekaScriptLspWorkerBridge();
      const diagnostics = new DekaScriptDiagnosticsAdapter(window.monaco);
      let documentVersion = 1;
      const removeDiagnosticsListener = lspBridge.onDiagnostics((message) => {
        if (message.uri === documentUri && (message.version === undefined || message.version === documentVersion) && model) {
          diagnostics.apply(model, message.diagnostics);
        }
      });

      lspBridge.updateDocument({
        uri: documentUri,
        languageId: DEKASCRIPT_LANGUAGE_ID,
        text: source,
        version: documentVersion,
      });
      disposeLspBridge = () => {
        removeDiagnosticsListener();
        if (model) diagnostics.clear(model);
        lspBridge.dispose();
      };

      monacoRef.current.onDidChangeModelContent(() => {
        const value = monacoRef.current?.getValue();
        if (typeof value === 'string') {
          onChange(value);
          documentVersion += 1;
          lspBridge.updateDocument({
            uri: documentUri,
            languageId: DEKASCRIPT_LANGUAGE_ID,
            text: value,
            version: documentVersion,
          });
          if (formatOnKeystroke) {
            if (formatTimeoutRef.current) clearTimeout(formatTimeoutRef.current);
            formatTimeoutRef.current = setTimeout(() => {
              void applyFormattedSource(value);
            }, 1000);
          }
        }
      });

      monacoRef.current.addCommand(
        window.monaco.KeyMod.CtrlCmd | window.monaco.KeyCode.Enter,
        () => {
          void handleRun();
        }
      );

      setIsLoading(false);
    };

    if (window.monaco && window.monacoLoaded) {
      createEditor();
    } else {
      waitForMonacoReady().then(() => {
        if (!disposed) createEditor();
      });
    }

    const handleThemeChange = () => {
      if (!monacoRef.current) return;
      window.monaco.editor.setTheme(getDocsThemeName());
    };

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.attributeName === 'class') {
          handleThemeChange();
        }
      }
    });
    observer.observe(document.documentElement, { attributes: true });

    return () => {
      disposed = true;
      observer.disconnect();
      disposeLspBridge?.();
      if (formatTimeoutRef.current) {
        clearTimeout(formatTimeoutRef.current);
        formatTimeoutRef.current = null;
      }
      if (monacoRef.current) {
        monacoRef.current.dispose();
        monacoRef.current = null;
      }
    };
    // Dependencies intentionally limited: recreate editor only when filename,
    // documentUriPrefix, or action handlers change. `source` is synced
    // separately; `applyFormattedSource` and `formatOnKeystroke` are stable
    // behaviours of this component.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filename, documentUriPrefix, onChange, onRun, applyFormattedSource, handleRun]);

  // Sync external source changes into the editor without resetting cursor on
  // every keystroke. Only update when the value differs and the editor is not
  // currently focused (prevents fighting the user during typing).
  useEffect(() => {
    if (!monacoRef.current) return;
    const current = monacoRef.current.getValue();
    if (current === source) return;
    if (monacoRef.current.hasTextFocus()) return;
    const position = monacoRef.current.getPosition();
    monacoRef.current.setValue(source);
    if (position) {
      monacoRef.current.setPosition(position);
    }
  }, [source]);

  return (
    <div className="flex h-full flex-col border-b border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <span>deka</span>
          {compiler ? (
            <a
              href="https://deka.gg/install"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-foreground hover:underline"
              title={compiler.sourceCommit}
            >
              v{compiler.version}
            </a>
          ) : null}
          <span>-</span>
          <span>{filename}</span>
        </div>
        <div className="flex items-center gap-2">
          {toolbarActions}
          {showFormatButton && (
            <Button
              variant="ghost"
              size="sm"
              onClick={handleFormat}
              className="gap-1.5"
              title="Format DekaScript"
            >
              <Wand2 className="h-4 w-4" />
              Format
            </Button>
          )}
          <Button size="sm" onClick={handleRun} disabled={isRunning} className="gap-1.5">
            <Play className="h-4 w-4" />
            {isRunning ? 'Running…' : 'Run'}
          </Button>
        </div>
      </div>

      <div className="relative flex flex-1 flex-col overflow-hidden">
        {isLoading ? (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
            Loading editor…
          </div>
        ) : null}
        <div
          ref={editorRef}
          className={`flex-1 ${isLoading ? 'opacity-0' : 'opacity-100'}`}
        />
      </div>
    </div>
  );
}
