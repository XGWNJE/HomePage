export function normalizeTagLabel(tag: string): string {
	return tag.trim();
}

export function getTagSlug(tag: string): string {
	return normalizeTagLabel(tag).toLowerCase();
}
