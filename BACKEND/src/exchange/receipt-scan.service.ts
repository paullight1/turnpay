import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { imageSize } from 'image-size';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';

export const RECEIPT_SCAN_MAX_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_SIDE = 2_000;
const SCAN_TIMEOUT_MS = 20_000;

export class ReceiptScanResult {
  receiptName!: string | null;
  bankReference!: string | null;
}

@Injectable()
export class ReceiptScanService {
  private scanning = false;

  async scan(image: Buffer): Promise<ReceiptScanResult> {
    if (!image.length || image.length > RECEIPT_SCAN_MAX_BYTES) {
      throw new BadRequestException('Upload a receipt image up to 8 MiB');
    }
    const dimensions = this.readDimensions(image);
    if (
      dimensions.type !== 'png' ||
      !dimensions.width ||
      !dimensions.height ||
      dimensions.width > MAX_IMAGE_SIDE ||
      dimensions.height > MAX_IMAGE_SIDE
    ) {
      throw new BadRequestException('Receipt scan requires a resized PNG');
    }
    if (this.scanning) {
      throw new ServiceUnavailableException('Receipt reader is busy');
    }

    this.scanning = true;
    let worker: Worker | undefined;
    let timeout: NodeJS.Timeout | undefined;
    try {
      worker = new Worker(join(__dirname, 'receipt-ocr.worker.js'), {
        workerData: Uint8Array.from(image),
        resourceLimits: { maxOldGenerationSizeMb: 64 },
      });
      const runningWorker = worker;
      const text = await new Promise<string>((resolve, reject) => {
        const fail = () => reject(new Error('Receipt scan failed'));
        timeout = setTimeout(fail, SCAN_TIMEOUT_MS);
        runningWorker.once('error', fail);
        runningWorker.once('exit', fail);
        runningWorker.once('message', (result: unknown) => {
          if (typeof result === 'string') resolve(result);
          else fail();
        });
      });
      return extractReceiptDetails(text);
    } catch {
      throw new ServiceUnavailableException('Could not read this receipt');
    } finally {
      clearTimeout(timeout);
      await worker?.terminate().catch(() => undefined);
      this.scanning = false;
    }
  }

  private readDimensions(image: Buffer) {
    try {
      return imageSize(image);
    } catch {
      throw new BadRequestException('Receipt image is invalid');
    }
  }
}

const senderLabel =
  /^(?:sender(?:['’]s)?(?:\s+name)?|payer(?:['’]s)?(?:\s+name)?|remitter(?:\s+name)?|paid\s+by|(?:source|debit(?:ed)?|from)\s+account\s+name|from)(?:\s*[:#–—-]\s*|\s+|$)/iu;
const accountNameLabel = /^account\s+name(?:\s*[:–—-]\s*|\s+|$)/iu;
const referenceLabel =
  /^(?:(?:transaction|transfer|payment|bank)\s+(?:reference(?:\s+(?:number|no\.?))?|ref\.?|id)|(?:ghipss\s+)?session\s+id|reference(?:\s+(?:number|no\.?))?|ref\.?)(?:\s*[:#–—-]\s*|\s+|$)/iu;
const recipientLabel =
  /^(?:recipient|beneficiary|receiver|payee|destination|credited|to(?:\s|:|$))/iu;
const otherLabel =
  /^(?:amount|date|time|bank|status|currency|account number)\b/iu;

export function extractReceiptDetails(text: string): ReceiptScanResult {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = (label: RegExp, valid: (value: string) => boolean) => {
    const values = new Set<string>();
    for (const [index, line] of lines.entries()) {
      const prefix = label.exec(line);
      if (!prefix) continue;
      const inline = line.slice(prefix[0].length).trim();
      const next = lines[index + 1] ?? '';
      const value =
        inline ||
        ([
          senderLabel,
          accountNameLabel,
          referenceLabel,
          recipientLabel,
          otherLabel,
        ].some((pattern) => pattern.test(next))
          ? ''
          : next);
      if (valid(value)) values.add(value);
    }
    return values;
  };

  const isName = (value: string) =>
    value.length <= 120 && /^[\p{L}][\p{L}\p{M} .,'’&()-]+$/u.test(value);
  const senders = candidates(senderLabel, isName);
  const names =
    senders.size || lines.some((line) => recipientLabel.test(line))
      ? senders
      : candidates(accountNameLabel, isName);
  const references = candidates(
    referenceLabel,
    (value) => /^[A-Z0-9._-]{4,100}$/i.test(value) && /\d/.test(value),
  );
  const normalizedReferences = new Set(
    [...references].map((value) => value.toUpperCase()),
  );
  return {
    receiptName: names.size === 1 ? [...names][0] : null,
    bankReference:
      normalizedReferences.size === 1 ? [...normalizedReferences][0] : null,
  };
}
