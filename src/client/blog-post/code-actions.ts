import { getI18nText } from './globals';
import type { Cleanup } from './lifecycle';

const COPY_ICON = '<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>';
const COPIED_ICON = '<svg class="copy-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 6L9 17l-5-5"></path></svg>';
const MAX_HEIGHT = 400;
const COPY_TIMEOUT = 2000;

function getLanguage(pre: HTMLElement, code: HTMLElement | null): string {
	return (
		(pre.className.match(/language-(\w+)/) || ['', ''])[1] ||
		(code?.className.match(/language-(\w+)/) || ['', ''])[1] ||
		pre.getAttribute('data-language') ||
		''
	);
}

export function initCodeActions(): Cleanup {
	const cleanups: Cleanup[] = [];
	for (const pre of document.querySelectorAll<HTMLElement>('.markdown-prose pre')) {
		const code = pre.querySelector<HTMLElement>('code');
		const codeText = code?.textContent || '';
		const language = getLanguage(pre, code);
		const shouldCollapse = pre.scrollHeight > MAX_HEIGHT;
		const previousStyles = {
			position: pre.style.position,
			maxHeight: pre.style.maxHeight,
			overflow: pre.style.overflow,
			overflowX: pre.style.overflowX,
			overflowY: pre.style.overflowY,
		};
		let copyTimer = 0;
		let expanded = false;
		pre.dataset.codeActionsVisible = 'false';
		pre.dataset.codeEnhanced = 'true';
		pre.style.position = 'relative';

		const setVisible = (visible: boolean) => {
			pre.dataset.codeActionsVisible = visible ? 'true' : 'false';
		};
		const actionBar = document.createElement('div');
		actionBar.className = 'code-action-bar';
		if (language) {
			const languageLabel = document.createElement('span');
			languageLabel.className = 'code-lang-label';
			languageLabel.textContent = language;
			actionBar.appendChild(languageLabel);
		}
		const copyButton = document.createElement('button');
		copyButton.className = 'code-copy-btn';
		copyButton.type = 'button';
		copyButton.setAttribute('aria-label', getI18nText('actions.copy', 'Copy'));
		const renderCopyButton = (copied: boolean) => {
			copyButton.innerHTML = `${copied ? COPIED_ICON : COPY_ICON}<span class="copy-text">${getI18nText(
				copied ? 'actions.copied' : 'actions.copy',
				copied ? 'Copied' : 'Copy',
			)}</span>`;
		};
		renderCopyButton(false);
		const onCopy = async (event: MouseEvent) => {
			event.preventDefault();
			event.stopPropagation();
			setVisible(true);
			try {
				await navigator.clipboard.writeText(codeText);
				renderCopyButton(true);
				if (copyTimer) window.clearTimeout(copyTimer);
				copyTimer = window.setTimeout(() => {
					copyTimer = 0;
					renderCopyButton(false);
				}, COPY_TIMEOUT);
			} catch (error) {
				console.error('Copy failed:', error);
			}
		};
		copyButton.addEventListener('click', onCopy);
		actionBar.appendChild(copyButton);
		pre.appendChild(actionBar);

		let expandButton: HTMLButtonElement | null = null;
		if (shouldCollapse) {
			pre.style.maxHeight = `${MAX_HEIGHT}px`;
			pre.style.overflow = 'hidden';
			expandButton = document.createElement('button');
			expandButton.className = 'code-expand-btn';
			expandButton.type = 'button';
			expandButton.setAttribute('data-expanded', 'false');
			expandButton.textContent = getI18nText('actions.expandCode', 'Expand Code');
			const onExpand = (event: MouseEvent) => {
				event.preventDefault();
				event.stopPropagation();
				expanded = !expanded;
				pre.style.maxHeight = expanded ? 'none' : `${MAX_HEIGHT}px`;
				pre.style.overflowX = 'auto';
				pre.style.overflowY = expanded ? 'auto' : 'hidden';
				expandButton?.setAttribute('data-expanded', String(expanded));
				if (expandButton) {
					expandButton.textContent = expanded
						? getI18nText('actions.collapse', 'Collapse')
						: getI18nText('actions.expandCode', 'Expand Code');
				}
				setVisible(true);
			};
			expandButton.addEventListener('click', onExpand);
			pre.appendChild(expandButton);
			cleanups.push(() => expandButton?.removeEventListener('click', onExpand));
		}

		const showActions = () => setVisible(true);
		const hideActions = () => setVisible(false);
		const onFocusOut = (event: FocusEvent) => {
			if (!(event.relatedTarget instanceof Node) || !pre.contains(event.relatedTarget)) hideActions();
		};
		const onPreClick = (event: MouseEvent) => {
			if (!(event.target instanceof Element)) return;
			if (!event.target.closest('.code-copy-btn, .code-expand-btn')) showActions();
		};
		pre.addEventListener('pointerenter', showActions);
		pre.addEventListener('pointerleave', hideActions);
		pre.addEventListener('focusin', showActions);
		pre.addEventListener('focusout', onFocusOut);
		pre.addEventListener('click', onPreClick);
		cleanups.push(() => {
			copyButton.removeEventListener('click', onCopy);
			pre.removeEventListener('pointerenter', showActions);
			pre.removeEventListener('pointerleave', hideActions);
			pre.removeEventListener('focusin', showActions);
			pre.removeEventListener('focusout', onFocusOut);
			pre.removeEventListener('click', onPreClick);
			if (copyTimer) window.clearTimeout(copyTimer);
			actionBar.remove();
			expandButton?.remove();
			delete pre.dataset.codeActionsVisible;
			delete pre.dataset.codeEnhanced;
			pre.style.position = previousStyles.position;
			pre.style.maxHeight = previousStyles.maxHeight;
			pre.style.overflow = previousStyles.overflow;
			pre.style.overflowX = previousStyles.overflowX;
			pre.style.overflowY = previousStyles.overflowY;
		});
	}

	return () => {
		for (const cleanup of cleanups.reverse()) cleanup();
	};
}
