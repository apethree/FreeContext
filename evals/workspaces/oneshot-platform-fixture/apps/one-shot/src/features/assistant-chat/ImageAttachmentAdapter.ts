import type { Attachment, AttachmentAdapter, CompleteAttachment, PendingAttachment } from '@assistant-ui/react';

export const MAX_IMAGE_ATTACHMENT_BYTES = 5_000_000;
export const ALLOWED_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

export class ImageAttachmentAdapter implements AttachmentAdapter {
  accept = Array.from(ALLOWED_IMAGE_MIME_TYPES).join(',');

  async add({ file }: { file: File }): Promise<PendingAttachment> {
    if (!file.type.startsWith('image/')) {
      throw new Error('Only image files are supported.');
    }
    if (!ALLOWED_IMAGE_MIME_TYPES.has(file.type)) {
      throw new Error(`Unsupported image type: ${file.type}`);
    }
    if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
      throw new Error('Image exceeds 5 MB limit.');
    }

    return {
      id: crypto.randomUUID(),
      type: 'image',
      name: file.name || 'image',
      contentType: file.type,
      file,
      status: { type: 'requires-action', reason: 'composer-send' },
    };
  }

  async send(attachment: PendingAttachment): Promise<CompleteAttachment> {
    const image = await this.fileToDataUrl(attachment.file);
    return {
      id: attachment.id,
      type: 'image',
      name: attachment.name,
      contentType: attachment.contentType,
      content: [{ type: 'image', image, filename: attachment.name }],
      status: { type: 'complete' },
    };
  }

  async remove(_attachment: Attachment): Promise<void> {
    return;
  }

  private async fileToDataUrl(file: File): Promise<string> {
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error ?? new Error('Failed to read file'));
      reader.readAsDataURL(file);
    });
  }
}
