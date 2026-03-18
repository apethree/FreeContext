import { type ComponentPropsWithRef, type FC, forwardRef } from 'react';
import { useMessagePartFile } from '@assistant-ui/react';
import {
  BracesIcon,
  DownloadIcon,
  FileIcon,
  FileTextIcon,
  ImageIcon,
  MusicIcon,
  VideoIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Utilities ──────────────────────────────────────────────────────────────

export function getMimeTypeIcon(mimeType: string) {
  if (mimeType.startsWith('image/')) return ImageIcon;
  if (mimeType === 'application/pdf') return FileTextIcon;
  if (mimeType === 'application/json') return BracesIcon;
  if (mimeType.startsWith('text/')) return FileTextIcon;
  if (mimeType.startsWith('audio/')) return MusicIcon;
  if (mimeType.startsWith('video/')) return VideoIcon;
  return FileIcon;
}

export function getBase64Size(base64: string): number {
  const padding = (base64.match(/=+$/) ?? [''])[0].length;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ── Sub-components ─────────────────────────────────────────────────────────

type FileRootVariant = 'outline' | 'ghost' | 'muted';
type FileRootSize = 'sm' | 'default' | 'lg';

const variantClasses: Record<FileRootVariant, string> = {
  outline: 'border border-border/60',
  ghost: '',
  muted: 'bg-muted/50',
};

const sizeClasses: Record<FileRootSize, string> = {
  sm: 'gap-1.5 px-2 py-1 text-xs',
  default: 'gap-2 px-3 py-2 text-sm',
  lg: 'gap-3 px-4 py-3 text-sm',
};

type FileRootProps = ComponentPropsWithRef<'div'> & {
  variant?: FileRootVariant;
  size?: FileRootSize;
};

export const FileRoot = forwardRef<HTMLDivElement, FileRootProps>(
  ({ variant = 'outline', size = 'default', className, ...props }, ref) => (
    <div
      ref={ref}
      className={cn(
        'flex items-center rounded-lg',
        variantClasses[variant],
        sizeClasses[size],
        className,
      )}
      {...props}
    />
  ),
);
FileRoot.displayName = 'FileRoot';

type FileIconDisplayProps = {
  mimeType: string;
  className?: string;
  children?: React.ReactNode;
};

export const FileIconDisplay: FC<FileIconDisplayProps> = ({ mimeType, className, children }) => {
  if (children) return <>{children}</>;
  const Icon = getMimeTypeIcon(mimeType);
  return <Icon className={cn('size-5 shrink-0 text-muted-foreground', className)} />;
};

export const FileName: FC<ComponentPropsWithRef<'span'>> = ({ className, ...props }) => (
  <span className={cn('min-w-0 truncate font-medium', className)} {...props} />
);

type FileSizeProps = ComponentPropsWithRef<'span'> & { bytes: number };

export const FileSize: FC<FileSizeProps> = ({ bytes, className, ...props }) => (
  <span className={cn('shrink-0 text-muted-foreground', className)} {...props}>
    {formatFileSize(bytes)}
  </span>
);

type FileDownloadProps = {
  data: string;
  mimeType: string;
  filename?: string;
  className?: string;
};

export const FileDownload: FC<FileDownloadProps> = ({ data, mimeType, filename, className }) => {
  const href = `data:${mimeType};base64,${data}`;
  return (
    <a
      href={href}
      download={filename ?? 'file'}
      className={cn(
        'ml-auto shrink-0 rounded-md p-1 text-muted-foreground transition-colors hover:text-foreground',
        className,
      )}
      aria-label="Download file"
    >
      <DownloadIcon className="size-4" />
    </a>
  );
};

// ── Default File component for MessagePrimitive.Parts ──────────────────────

const FileImpl: FC = () => {
  const file = useMessagePartFile();
  const size = file.data ? getBase64Size(file.data) : 0;

  return (
    <FileRoot variant="outline" className="my-1">
      <FileIconDisplay mimeType={file.mimeType} />
      <div className="flex min-w-0 flex-col gap-0.5">
        <FileName>{file.filename ?? 'file'}</FileName>
        {size > 0 && <FileSize bytes={size} className="text-xs" />}
      </div>
      <FileDownload
        data={file.data}
        mimeType={file.mimeType}
        filename={file.filename}
      />
    </FileRoot>
  );
};

export const File = Object.assign(FileImpl, {
  Root: FileRoot,
  Icon: FileIconDisplay,
  Name: FileName,
  Size: FileSize,
  Download: FileDownload,
});
