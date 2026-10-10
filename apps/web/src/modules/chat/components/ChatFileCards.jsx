import { FileText, X } from '@phosphor-icons/react';
import { useState } from 'react';

function sizeLabel(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function ChatFileCards({ files = [], onRemove, onOpen, compact = false }) {
  const [error, setError] = useState('');
  if (!files.length) return null;
  return <div className={`chat-file-cards${compact ? ' compact' : ''}`}>
    {files.map((file) => {
      const Tag = onOpen ? 'button' : 'div';
      return <Tag className="chat-file-card" key={file.id || `${file.attachmentId}:${file.name}`} title={file.name}
        {...(onOpen ? { type: 'button', onClick: () => {
          setError('');
          Promise.resolve(onOpen(file)).catch((cause) => setError(cause?.message || '打开文件失败'));
        } } : {})}>
      <FileText size={23} weight="regular" aria-hidden="true" />
      <span className="chat-file-card-label"><span className="chat-file-card-name">{file.name}</span><small>{sizeLabel(file.bytes)}</small></span>
      {onRemove ? <button type="button" onClick={() => onRemove(file.id)} aria-label={`移除 ${file.name}`}><X size={14} /></button> : null}
    </Tag>;
    })}
    {error ? <small className="chat-file-error" role="alert">{error}</small> : null}
  </div>;
}
