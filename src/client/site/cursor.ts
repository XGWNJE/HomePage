let initialized = false;

const textSelector = [
	'p', 'span', 'strong', 'em', 'blockquote', 'li',
	'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
	'figcaption', 'td', 'th', 'summary', 'label',
].join(',');

const clickableSelector = [
	'a', 'button', 'summary', 'label', 'input', 'textarea', 'select',
	'[role="button"]', '[role="tab"]', '[data-auth-login]',
	'.apple-float-chip', '.icon-button',
].join(',');

type CursorState = 'default' | 'clickable' | 'text';

export const initCursor = (): void => {
	if (initialized) return;
	initialized = true;

	const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const finePointer = window.matchMedia('(pointer: fine)').matches;
	if (reducedMotion || !finePointer) return;

	let cursor: HTMLDivElement | null = null;
	let targetX = window.innerWidth / 2;
	let targetY = window.innerHeight / 2;
	let state: CursorState = 'default';
	let pressed = false;
	let positioned = false;
	const observedBodies = new WeakSet<HTMLElement>();

	const suppressNativeCursor = (): void => {
		document.documentElement.classList.add('has-custom-cursor');
		document.documentElement.style.cursor = 'none';
		if (document.body) document.body.style.cursor = 'none';
	};

	const ensureCursor = (): HTMLDivElement => {
		if (cursor?.isConnected) return cursor;
		cursor = document.createElement('div');
		cursor.className = 'app-cursor';
		(document.body || document.documentElement).appendChild(cursor);
		suppressNativeCursor();
		return cursor;
	};

	const updateCursor = (): void => {
		const element = ensureCursor();
		element.style.transform = `translate3d(${targetX}px, ${targetY}px, 0) translate(-50%, -50%)`;
		element.classList.toggle('is-visible', positioned);
		element.classList.toggle('is-clickable', state === 'clickable');
		element.classList.toggle('is-text', state === 'text');
		element.classList.toggle('is-pressed', pressed);
	};

	const pointInside = (x: number, y: number, rect: DOMRect): boolean =>
		x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;

	const isTextHit = (target: EventTarget | null, x: number, y: number): boolean => {
		if (!(target instanceof Element)) return false;
		const textElement = target.closest(textSelector);
		if (!textElement) return false;

		const caretPosition = document.caretPositionFromPoint?.(x, y);
		if (caretPosition?.offsetNode) {
			const node = caretPosition.offsetNode;
			const parent = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
			if (parent instanceof Element && parent.closest(textSelector)) return true;
		}

		const legacyCaretRange = Reflect.get(document, 'caretRangeFromPoint') as
			| ((x: number, y: number) => Range | null)
			| undefined;
		const legacyNode = legacyCaretRange?.call(document, x, y)?.startContainer;
		if (legacyNode) {
			const parent = legacyNode.nodeType === Node.TEXT_NODE ? legacyNode.parentElement : legacyNode;
			if (parent instanceof Element && parent.closest(textSelector)) return true;
		}

		const range = document.createRange();
		const walker = document.createTreeWalker(textElement, NodeFilter.SHOW_TEXT, {
			acceptNode(node) {
				return node.textContent?.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
			},
		});
		for (let node = walker.nextNode(); node; node = walker.nextNode()) {
			range.selectNodeContents(node);
			for (const rect of range.getClientRects()) {
				if (pointInside(x, y, rect)) return true;
			}
		}
		return false;
	};

	const updateState = (target: EventTarget | null, x = targetX, y = targetY): void => {
		if (!(target instanceof Element)) state = 'default';
		else if (target.closest(clickableSelector)) state = 'clickable';
		else state = isTextHit(target, x, y) ? 'text' : 'default';
		updateCursor();
	};

	const cursorObserver = new MutationObserver(suppressNativeCursor);
	const observeCurrentBody = (): void => {
		if (!document.body || observedBodies.has(document.body)) return;
		observedBodies.add(document.body);
		cursorObserver.observe(document.body, {
			attributes: true,
			attributeFilter: ['style', 'class'],
		});
	};

	const restoreAfterNavigation = (): void => {
		suppressNativeCursor();
		observeCurrentBody();
		requestAnimationFrame(suppressNativeCursor);
		updateCursor();
	};

	document.addEventListener('pointermove', (event) => {
		if (event.pointerType && event.pointerType !== 'mouse') return;
		targetX = event.clientX;
		targetY = event.clientY;
		positioned = true;
		updateState(event.target, event.clientX, event.clientY);
	}, { passive: true });
	document.addEventListener('pointerdown', (event) => {
		if (event.pointerType && event.pointerType !== 'mouse') return;
		pressed = true;
		updateCursor();
	}, { passive: true });
	document.addEventListener('pointerup', (event) => {
		if (event.pointerType && event.pointerType !== 'mouse') return;
		pressed = false;
		updateCursor();
	}, { passive: true });
	document.addEventListener('pointerover', (event) => {
		if (event.pointerType && event.pointerType !== 'mouse') return;
		updateState(event.target);
	}, { passive: true });
	document.addEventListener('pointerleave', () => {
		positioned = false;
		cursor?.classList.remove('is-visible');
	});
	window.addEventListener('blur', () => {
		positioned = false;
		cursor?.classList.remove('is-visible');
	});
	window.addEventListener('focus', restoreAfterNavigation);
	document.addEventListener('astro:after-swap', restoreAfterNavigation);
	document.addEventListener('astro:page-load', restoreAfterNavigation);
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'visible') suppressNativeCursor();
	});

	cursorObserver.observe(document.documentElement, {
		attributes: true,
		attributeFilter: ['class', 'style'],
	});
	if (document.body) observeCurrentBody();
	else document.addEventListener('DOMContentLoaded', restoreAfterNavigation, { once: true });
	restoreAfterNavigation();
};
