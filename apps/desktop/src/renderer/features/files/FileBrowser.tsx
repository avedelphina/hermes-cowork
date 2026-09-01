import { useCallback, useEffect, useState } from 'react';
import type { DirListing, FilePreview } from '@shared/types';
import { activeProject, useProjectStore } from '../projects/project.store';

function crumbs(path: string): string[] {
  return path ? path.split('/') : [];
}
function parentOf(path: string): string {
  return path.split('/').slice(0, -1).join('/');
}
function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export function FileBrowser() {
  useProjectStore((s) => s.activeId);
  const project = activeProject();
  if (!project) {
    return <div className="p-4 text-xs text-muted">Open a project to browse its files.</div>;
  }
  // key on the project id → switching projects remounts with fresh state.
  return <Browser key={project.id} projectId={project.id} projectName={project.name} />;
}

function Browser({ projectId, projectName }: { projectId: string; projectName: string }) {
  const [dir, setDir] = useState('');
  const [listing, setListing] = useState<DirListing | null>(null);
  const [sel, setSel] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreview | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((rel: string) => {
    window.hermes.fs
      .list(projectId, rel)
      .then((l) => { setListing(l); setError(null); })
      .catch((e) => setError(String(e)));
  }, [projectId]);

  useEffect(() => { load(dir); }, [dir, load]);

  useEffect(() => {
    if (!sel) return;
    window.hermes.fs
      .read(projectId, sel)
      .then((p) => { setPreview(p); setError(null); })
      .catch((e) => setError(String(e)));
  }, [projectId, sel]);

  const project = { name: projectName };

  return (
    <div className="flex h-full flex-col text-xs">
      <div className="flex items-center gap-1 border-b border-border px-3 py-2 text-[11px] text-muted">
        <button className="hover:text-fg" onClick={() => setDir('')}>{project.name}</button>
        {crumbs(dir).map((c, i) => (
          <span key={i} className="flex items-center gap-1">
            <span className="text-dim">/</span>
            <button className="hover:text-fg" onClick={() => setDir(crumbs(dir).slice(0, i + 1).join('/'))}>{c}</button>
          </span>
        ))}
      </div>

      {error && <p className="px-3 py-2 text-danger">{error}</p>}

      <div className="flex min-h-0 flex-1 flex-col">
        <ul className="max-h-[45%] overflow-y-auto border-b border-border">
          {dir && (
            <li>
              <button className="w-full px-3 py-1.5 text-left text-muted hover:bg-surface2" onClick={() => setDir(parentOf(dir))}>
                ../
              </button>
            </li>
          )}
          {listing?.entries.map((e) => {
            const rel = dir ? `${dir}/${e.name}` : e.name;
            return (
              <li key={e.name}>
                <button
                  onClick={() => (e.kind === 'dir' ? setDir(rel) : setSel(rel))}
                  className={
                    'flex w-full items-center justify-between px-3 py-1.5 text-left hover:bg-surface2 ' +
                    (sel === rel ? 'bg-surface2 text-fg' : 'text-muted')
                  }
                >
                  <span className="truncate">{e.kind === 'dir' ? '📁 ' : '📄 '}{e.name}</span>
                  {e.kind === 'file' && <span className="ml-2 shrink-0 text-[10px] text-dim">{fmtSize(e.size)}</span>}
                </button>
              </li>
            );
          })}
        </ul>

        <div className="flex-1 overflow-auto p-3">
          {!preview && <p className="text-muted">Select a file to preview.</p>}
          {preview?.kind === 'text' && (
            <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-fg">
              {preview.text}
              {preview.truncated && '\n\n… (truncated)'}
            </pre>
          )}
          {preview?.kind === 'image' && <img src={preview.dataUri} alt={preview.name} className="max-w-full" />}
          {preview?.kind === 'pdf' && <embed src={preview.dataUri} type="application/pdf" className="h-64 w-full" />}
          {preview?.kind === 'unsupported' && (
            <p className="text-muted">No preview for {preview.name} ({fmtSize(preview.size)}).</p>
          )}
        </div>
      </div>
    </div>
  );
}
