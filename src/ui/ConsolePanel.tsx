import { Terminal, Trash2, AlertCircle } from 'lucide-react';
import { Button } from './button';
import type { CompilerDiagnostic } from '../runtime';
import { formatDiagnostic } from '../runtime';

interface ConsolePanelProps {
  stdout: string;
  stderr: string;
  error?: string;
  diagnostics?: CompilerDiagnostic[];
  source?: string;
  onClear: () => void;
}

function severityClass(severity: CompilerDiagnostic['severity']) {
  switch (severity) {
    case 'error':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'warning':
      return 'border-yellow-500/30 bg-yellow-500/10 text-yellow-600';
    case 'info':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-600';
    default:
      return 'border-border bg-muted text-foreground';
  }
}

function DiagnosticItem({ diagnostic, source }: { diagnostic: CompilerDiagnostic; source?: string }) {
  return (
    <div className={`rounded-lg border p-3 ${severityClass(diagnostic.severity)}`}>
      <pre className="whitespace-pre-wrap break-all text-sm">{formatDiagnostic(diagnostic, source)}</pre>
    </div>
  );
}

export function ConsolePanel({ stdout, stderr, error, diagnostics, source, onClear }: ConsolePanelProps) {
  const hasConsole = Boolean(stdout || stderr || error || diagnostics?.length);

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          <Terminal className="h-3.5 w-3.5" />
          Console
        </div>
        <Button variant="ghost" size="sm" onClick={onClear} className="gap-1.5">
          <Trash2 className="h-4 w-4" />
          Clear
        </Button>
      </div>

      <div className="flex-1 space-y-3 overflow-auto p-4 font-mono text-sm">
        {diagnostics?.length ? (
          <div className="space-y-3">
            {diagnostics.map((diagnostic, index) => (
              <DiagnosticItem key={index} diagnostic={diagnostic} source={source} />
            ))}
          </div>
        ) : error ? (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <pre className="whitespace-pre-wrap break-all">{error}</pre>
          </div>
        ) : null}

        {stderr ? (
          <div className="mb-4">
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              stderr
            </div>
            <pre className="whitespace-pre-wrap break-all text-destructive">{stderr}</pre>
          </div>
        ) : null}

        {stdout ? (
          <div>
            <div className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              stdout
            </div>
            <pre className="whitespace-pre-wrap break-all text-foreground">{stdout}</pre>
          </div>
        ) : null}

        {!hasConsole ? (
          <div className="text-muted-foreground">
            Edit code or click <strong>Run</strong> to see console output here.
          </div>
        ) : null}
      </div>
    </div>
  );
}
