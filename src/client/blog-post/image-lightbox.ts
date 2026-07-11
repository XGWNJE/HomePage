import type { Cleanup } from './lifecycle';

type LightboxElements = {
	overlay: HTMLElement | null;
	target: HTMLImageElement | null;
	caption: HTMLElement | null;
};

function getLightboxElements(): LightboxElements {
	return {
		overlay: document.getElementById('img-lightbox'),
		target: document.getElementById('img-lightbox-target') as HTMLImageElement | null,
		caption: document.getElementById('img-lightbox-caption'),
	};
}

export function initImageLightbox(): Cleanup {
	let lockedScrollY = 0;
	let isBodyLocked = false;
	let closeTimer = 0;
	let bodyStyleBeforeLock: Partial<CSSStyleDeclaration> = {};

	const unlockBody = () => {
		if (!isBodyLocked) return;
		document.body.style.position = bodyStyleBeforeLock.position || '';
		document.body.style.top = bodyStyleBeforeLock.top || '';
		document.body.style.left = bodyStyleBeforeLock.left || '';
		document.body.style.right = bodyStyleBeforeLock.right || '';
		document.body.style.width = bodyStyleBeforeLock.width || '';
		document.body.style.overflow = bodyStyleBeforeLock.overflow || '';
		window.scrollTo(0, lockedScrollY);
		isBodyLocked = false;
	};
	const finishClose = () => {
		closeTimer = 0;
		const { overlay, target, caption } = getLightboxElements();
		if (overlay) {
			overlay.classList.add('hidden');
			overlay.classList.remove('flex', 'is-closing');
			overlay.setAttribute('aria-hidden', 'true');
		}
		if (target) {
			target.setAttribute('src', '');
			target.setAttribute('alt', '');
		}
		if (caption) caption.textContent = '';
		unlockBody();
	};
	const closeLightbox = (animate = true) => {
		const { overlay, target } = getLightboxElements();
		if (!overlay || !target || overlay.classList.contains('hidden')) return;
		if (closeTimer || overlay.classList.contains('is-closing')) return;
		if (!animate || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
			finishClose();
			return;
		}
		overlay.classList.add('is-closing');
		closeTimer = window.setTimeout(finishClose, 180);
	};
	const openLightbox = (src: string, altText: string) => {
		const { overlay, target, caption } = getLightboxElements();
		if (!overlay || !target || !src) return;
		if (caption) caption.textContent = altText;
		if (!isBodyLocked) {
			lockedScrollY = window.scrollY;
			bodyStyleBeforeLock = {
				position: document.body.style.position,
				top: document.body.style.top,
				left: document.body.style.left,
				right: document.body.style.right,
				width: document.body.style.width,
				overflow: document.body.style.overflow,
			};
			document.body.style.position = 'fixed';
			document.body.style.top = `-${lockedScrollY}px`;
			document.body.style.left = '0';
			document.body.style.right = '0';
			document.body.style.width = '100%';
			document.body.style.overflow = 'hidden';
			isBodyLocked = true;
		}
		target.setAttribute('src', src);
		target.setAttribute('alt', altText);
		overlay.classList.remove('hidden', 'is-closing');
		overlay.classList.add('flex');
		overlay.setAttribute('aria-hidden', 'false');
	};
	const onClick = (event: MouseEvent) => {
		if (!(event.target instanceof Element)) return;
		const { overlay } = getLightboxElements();
		if (overlay && !overlay.classList.contains('hidden') && overlay.contains(event.target)) {
			event.preventDefault();
			closeLightbox();
			return;
		}
		if (!(event.target instanceof HTMLImageElement) || !event.target.closest('.markdown-prose')) return;
		if (event.target.closest('a')) event.preventDefault();
		const src = event.target.currentSrc || event.target.src;
		if (src) openLightbox(src, event.target.alt || '');
	};
	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key === 'Escape') closeLightbox();
	};

	document.addEventListener('click', onClick);
	document.addEventListener('keydown', onKeyDown);
	return () => {
		document.removeEventListener('click', onClick);
		document.removeEventListener('keydown', onKeyDown);
		if (closeTimer) window.clearTimeout(closeTimer);
		closeTimer = 0;
		finishClose();
	};
}
