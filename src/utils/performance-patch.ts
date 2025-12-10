export const patchPerformanceMeasure = () => {
    if (typeof window === 'undefined' || !window.performance) return;

    const originalMeasure = window.performance.measure;

    window.performance.measure = function (
        measureName: string,
        startOrMeasureOptions?: string | PerformanceMeasureOptions,
        endMark?: string
    ): PerformanceMeasure {
        try {
            return originalMeasure.call(
                this,
                measureName,
                startOrMeasureOptions,
                endMark
            );
        } catch (e: unknown) {
            if (e instanceof DOMException && e.name === 'DataCloneError') {
                // This is the specific error we want to suppress.
                // It happens when structured clone fails on `detail` objects.
                // We'll retry without the detail if possible, or just create a dummy measure.
                
                // If the second argument was an options object, we can try to strip 'detail'
                if (typeof startOrMeasureOptions === 'object' && startOrMeasureOptions !== null) {
                    try {
                        const safeOptions = { ...startOrMeasureOptions };
                        delete safeOptions.detail;
                        return originalMeasure.call(this, measureName, safeOptions, endMark);
                    } catch {
                        // If it still fails, just fallback
                    }
                }
                
                // Fallback: just measure without any extra data
                // Note: The signature options might be complex, so simplest fallback is often best.
                // But for React's use case, it might expect the measure to exist.
                 try {
                     return originalMeasure.call(this, measureName);
                 } catch {
                     // If even that fails (e.g. invalid mark names), we can't do much.
                     // Return a mock PerformanceMeasure object to satisfy return type if needed
                     return {
                         name: measureName,
                         entryType: 'measure',
                         startTime: 0,
                         duration: 0,
                         detail: null,
                         toJSON: () => ({})
                     } as PerformanceMeasure;
                 }
            }
            // Re-throw other errors
            throw e;
        }
    };
};

// Auto-run the patch
patchPerformanceMeasure();
