import { dirname, join } from 'node:path';
import { parentPort, workerData } from 'node:worker_threads';
import { createWorker, OEM } from 'tesseract.js';

async function readReceipt(image: Uint8Array) {
  const modelDirectory = dirname(require.resolve('@tesseract.js-data/eng'));
  const worker = await createWorker('eng', OEM.LSTM_ONLY, {
    langPath: join(modelDirectory, '4.0.0_best_int'),
    cacheMethod: 'none',
    errorHandler: () => parentPort?.postMessage(null),
  });
  try {
    const result = await worker.recognize(Buffer.from(image));
    parentPort?.postMessage(result.data.text.slice(0, 25_000));
  } finally {
    await worker.terminate();
  }
}

const image: unknown = workerData;
if (image instanceof Uint8Array) {
  void readReceipt(image).catch(() => parentPort?.postMessage(null));
}
