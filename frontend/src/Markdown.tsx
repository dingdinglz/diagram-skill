import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

export function Markdown({ text }: { text: string }) {
  return <div className="markdown"><ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={{
    img: ({ alt }) => <span className="image-placeholder">[图片未嵌入：{alt || '请使用文字或代码说明'}]</span>,
    a: ({ children }) => <span className="markdown-link">{children}</span>,
  }}>{text}</ReactMarkdown></div>;
}
