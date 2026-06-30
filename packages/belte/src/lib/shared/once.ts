/* Memoises a zero-arg async producer so repeat calls reuse the first in-flight promise. */
export function once<T>(produce: () => Promise<T>): () => Promise<T> {
    let promise: Promise<T> | undefined
    return () => {
        if (!promise) {
            promise = produce()
        }
        return promise
    }
}
