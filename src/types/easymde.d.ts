declare module 'easymde' {
	interface EasyMDEOptions {
		element: HTMLTextAreaElement;
		spellChecker?: boolean;
		status?: boolean | string[];
		autoRefresh?: boolean | { delay: number };
		placeholder?: string;
		minHeight?: string;
		toolbar?: (string | '|')[];
	}

	class EasyMDE {
		constructor(options: EasyMDEOptions);
		value(): string;
		value(next: string): void;
		codemirror: {
			on(event: string, handler: (...args: unknown[]) => void): void;
			replaceSelection(text: string): void;
			focus(): void;
		};
	}

	export default EasyMDE;
}

declare module 'easymde/dist/easymde.min.css';
