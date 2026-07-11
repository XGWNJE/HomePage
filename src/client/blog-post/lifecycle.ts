export type Cleanup = () => void;

export const noopCleanup: Cleanup = () => {};

export function combineCleanups(cleanups: Cleanup[]): Cleanup {
	return () => {
		for (const cleanup of cleanups.reverse()) {
			try {
				cleanup();
			} catch (error) {
				console.error('Blog post cleanup failed:', error);
			}
		}
	};
}
