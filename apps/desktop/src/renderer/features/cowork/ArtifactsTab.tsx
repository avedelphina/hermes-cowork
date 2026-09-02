import { useCoworkStore } from './cowork.store';

export function ArtifactsTab({ onOpenFile }: { onOpenFile?: () => void }) {
  const artifacts = useCoworkStore((s) => s.artifacts);
  const openInFiles = useCoworkStore((s) => s.openInFiles);
  if (artifacts.length === 0) {
    return <div className="p-4 text-xs text-muted">Files Hermes reads or writes appear here.</div>;
  }
  return (
    <div className="flex flex-col gap-1 px-3 py-3 text-xs">
      {artifacts.map((a, i) => (
        <button
          key={i}
          onClick={() => { openInFiles(a.path); onOpenFile?.(); }}
          title="Open in Files"
          className="rounded border border-border bg-surface px-2 py-1.5 text-left hover:bg-surface2"
        >
          <div className="truncate text-fg">{a.path}</div>
          <div className="text-[10px] text-dim">{new Date(a.addedAt).toLocaleTimeString()}</div>
        </button>
      ))}
    </div>
  );
}
