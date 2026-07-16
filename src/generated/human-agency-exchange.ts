/* Generated from the versioned human-agency exchange JSON Schema. Do not edit directly. */

export type StringList = string[];
export type Hash = string;

/**
 * A public-safe, versioned package exchanged with HomePage.
 */
export interface HumanAgencyExchangePackage {
	schema_version: '1.0.0';
	package_version: 1;
	package_id: string;
	approval_status: 'approved-preview' | 'approved-publish';
	generated_at: string;
	/**
	 * @minItems 1
	 */
	entries: [Entry, ...Entry[]];
	content_hash: Hash;
}
export interface Entry {
	id: string;
	slug: string;
	revision: number;
	kind: 'cognitive-map' | 'case-study' | 'research-question' | 'deep-article';
	language: 'zh-CN' | 'en';
	cognition_status: 'understood' | 'researching' | 'unresolved';
	title: string;
	core_question: string;
	human_gain: StringList;
	mental_model: string;
	delegable_capabilities: StringList;
	retained_capabilities: StringList;
	transfer_scenarios: StringList;
	evidence: PublicEvidence[];
	open_questions: StringList;
	body_markdown: string;
	related_blog_groups: string[];
	entry_hash: Hash;
}
export interface PublicEvidence {
	label: string;
	url?: string;
}
