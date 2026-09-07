export interface ProgressiveFillProgress<T> {
  item: T;
  processedCount: number;
  filledCount: number;
  totalCount: number;
}

export interface ProgressiveFillResult {
  processedCount: number;
  filledCount: number;
  cancelled: boolean;
}

/**
 * Resolves and commits one item at a time. Earlier commits are intentionally not
 * rolled back when a later request fails or the user cancels the run.
 */
export async function runProgressiveFill<T>(options: {
  items: T[];
  resolveValue: (item: T) => Promise<string | null>;
  applyValue: (item: T, value: string) => Promise<boolean>;
  shouldContinue?: () => boolean;
  onProgress?: (progress: ProgressiveFillProgress<T>) => void;
}): Promise<ProgressiveFillResult> {
  const shouldContinue = options.shouldContinue || (() => true);
  let processedCount = 0;
  let filledCount = 0;

  for (const item of options.items) {
    if (!shouldContinue()) {
      return { processedCount, filledCount, cancelled: true };
    }

    const value = await options.resolveValue(item);
    if (!shouldContinue()) {
      return { processedCount, filledCount, cancelled: true };
    }
    if (value && await options.applyValue(item, value)) filledCount++;
    processedCount++;
    options.onProgress?.({
      item,
      processedCount,
      filledCount,
      totalCount: options.items.length,
    });
  }

  return { processedCount, filledCount, cancelled: false };
}
