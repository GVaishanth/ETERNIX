import { useDiagnosticsStore } from './diagnosticsStore';
import { formatSnapshot } from './format';

/**
 * Development-only overlay. The backtick key toggles it through the single input controller
 * (the 'debugPanel' action), not through a listener of its own. It is read-only and
 * pointer-events are disabled, so it never intercepts input.
 */
export function DebugPanel() {
  const snapshot = useDiagnosticsStore((state) => state.snapshot);
  const errors = useDiagnosticsStore((state) => state.errors);
  const panelVisible = useDiagnosticsStore((state) => state.panelVisible);

  if (!panelVisible) return null;

  return (
    <aside className="debug-panel" aria-label="Development diagnostics">
      <div className="debug-title">DEV DIAGNOSTICS (` to hide)</div>
      {snapshot === null ? (
        <div>waiting for first frame…</div>
      ) : (
        formatSnapshot(snapshot).map((section) => (
          <section key={section.title}>
            <div className="debug-section">{section.title}</div>
            {section.rows.map((row) => (
              <div key={row.label} className="debug-row">
                <span>{row.label}</span>
                <span>{row.value}</span>
              </div>
            ))}
          </section>
        ))
      )}
      <div className="debug-section">Runtime errors ({errors.length})</div>
      {errors.length === 0 ? (
        <div>none</div>
      ) : (
        errors.map((error) => (
          <div key={error.id} className="debug-error">
            [{error.source}] {error.message}
          </div>
        ))
      )}
    </aside>
  );
}
