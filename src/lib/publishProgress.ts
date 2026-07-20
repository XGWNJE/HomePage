// 发布过场（PublishProgress.astro）的驱动：阶段推进、秒数计时、成功/失败收尾。
// 页面只需引入组件并调用 createPublishProgress()。

export type PublishStage = 'save' | 'release' | 'done';

export interface PublishProgressDriver {
	show(initialLabel: string): void;
	setStage(stage: PublishStage, label?: string): void;
	setLabel(text: string): void;
	succeed(text: string): void;
	fail(message: string): void;
	hide(): void;
}

const STAGE_ORDER: PublishStage[] = ['save', 'release', 'done'];

export function createPublishProgress(): PublishProgressDriver {
	const overlay = document.getElementById('publish-progress');
	const label = overlay?.querySelector<HTMLElement>('[data-publish-progress-label]');
	const elapsedNode = overlay?.querySelector<HTMLElement>('[data-publish-elapsed]');
	const errorNode = overlay?.querySelector<HTMLElement>('[data-publish-progress-error]');
	const closeButton = overlay?.querySelector<HTMLButtonElement>('[data-publish-progress-close]');
	let timer: number | undefined;
	let startedAt = 0;

	const setLabel = (text: string) => {
		if (label) label.textContent = text;
	};

	const stopTimer = () => {
		window.clearInterval(timer);
		timer = undefined;
	};

	const hide = () => {
		stopTimer();
		if (!overlay) return;
		overlay.classList.remove('visible');
		overlay.setAttribute('aria-hidden', 'true');
	};

	closeButton?.addEventListener('click', hide);

	const show = (initialLabel: string) => {
		if (!overlay) return;
		overlay.classList.add('visible');
		overlay.setAttribute('aria-hidden', 'false');
		errorNode?.classList.add('hidden');
		closeButton?.classList.add('hidden');
		setLabel(initialLabel);
		for (const item of overlay.querySelectorAll('[data-publish-stage]')) {
			item.classList.remove('is-active', 'is-done');
		}
		startedAt = Date.now();
		if (elapsedNode) elapsedNode.textContent = '0';
		stopTimer();
		timer = window.setInterval(() => {
			if (elapsedNode) elapsedNode.textContent = String(Math.floor((Date.now() - startedAt) / 1000));
		}, 1000);
	};

	const setStage = (stage: PublishStage, stageLabel?: string) => {
		if (!overlay) return;
		const index = STAGE_ORDER.indexOf(stage);
		for (const item of overlay.querySelectorAll<HTMLElement>('[data-publish-stage]')) {
			const itemIndex = STAGE_ORDER.indexOf(item.dataset.publishStage as PublishStage);
			item.classList.toggle('is-done', itemIndex < index);
			item.classList.toggle('is-active', itemIndex === index);
		}
		if (stageLabel) setLabel(stageLabel);
	};

	const succeed = (text: string) => {
		stopTimer();
		setStage('done');
		if (!overlay) return;
		for (const item of overlay.querySelectorAll('[data-publish-stage]')) {
			item.classList.remove('is-active');
			item.classList.add('is-done');
		}
		setLabel(text);
	};

	const fail = (message: string) => {
		stopTimer();
		setLabel('发布失败');
		if (errorNode) {
			errorNode.textContent = message;
			errorNode.classList.remove('hidden');
		}
		closeButton?.classList.remove('hidden');
	};

	return { show, setStage, setLabel, succeed, fail, hide };
}
