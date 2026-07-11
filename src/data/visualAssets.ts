export const visualAssets = {
	sandrone: {
		heroGuide: '/image/sandrone/hero-guide-v1.webp',
		aboutObserver: '/image/sandrone/about-observer-v1.webp',
		indexAssistant: '/image/sandrone/index-assistant-v1.webp',
		maintenanceAssistant: '/image/sandrone/maintenance-assistant-v1.webp',
		dialogChibi: '/image/sandrone/dialog-chibi-v1.webp',
		reserve: {
			archiveNightHero: '/image/sandrone/reserve/archive-night-hero-v1.webp',
			teaLedgerBanner: '/image/sandrone/reserve/tea-ledger-banner-v1.webp',
			blueprintIndexPanel: '/image/sandrone/reserve/blueprint-index-panel-v1.webp',
			roseClockworkCard: '/image/sandrone/reserve/rose-clockwork-card-v1.webp',
			frostgearDivider: '/image/sandrone/reserve/frostgear-divider-v1.webp',
			archiveSealTile: '/image/sandrone/reserve/archive-seal-tile-v1.webp',
			dialogueAtmospherePanel: '/image/sandrone/reserve/dialogue-atmosphere-panel-v1.webp',
			paperIndexTexture: '/image/sandrone/reserve/paper-index-texture-v1.webp',
			heroes: {
				archiveOverseer: '/image/sandrone/reserve/heroes/archive-overseer-wide-v1.webp',
				teaIntermission: '/image/sandrone/reserve/heroes/tea-intermission-wide-v1.webp',
				blueprintReview: '/image/sandrone/reserve/heroes/blueprint-review-wide-v1.webp',
			},
			parts: {
				gearCluster: '/image/sandrone/reserve/parts/gear-cluster-v1.webp',
				frostStarCore: '/image/sandrone/reserve/parts/frost-star-core-v1.webp',
				teaCupMechanism: '/image/sandrone/reserve/parts/tea-cup-mechanism-v1.webp',
				archiveCardStack: '/image/sandrone/reserve/parts/archive-card-stack-v1.webp',
				burgundyRibbonLoop: '/image/sandrone/reserve/parts/burgundy-ribbon-loop-v1.webp',
				laceSeparatorSegment: '/image/sandrone/reserve/parts/lace-separator-segment-v1.webp',
				indexNode: '/image/sandrone/reserve/parts/index-node-v1.webp',
				cornerFiligree: '/image/sandrone/reserve/parts/corner-filigree-v1.webp',
			},
			motion: {
				gearfieldFar: '/image/sandrone/reserve/motion/gearfield-far-v1.webp',
				frostParticlesMid: '/image/sandrone/reserve/motion/frost-particles-mid-v1.webp',
				goldNodeNetwork: '/image/sandrone/reserve/motion/gold-node-network-v1.webp',
				burgundyRibbonNear: '/image/sandrone/reserve/motion/burgundy-ribbon-near-v1.webp',
				laceScrollStrip: '/image/sandrone/reserve/motion/lace-scroll-strip-v1.webp',
			},
			diverseHeroes: {
				earlyManorMemory: '/image/sandrone/reserve/heroes/diverse/early-manor-memory-v1.webp',
				sunlitRoseGarden: '/image/sandrone/reserve/heroes/diverse/sunlit-rose-garden-v1.webp',
				snowfieldEngineer: '/image/sandrone/reserve/heroes/diverse/snowfield-engineer-v1.webp',
				amberWorkshop: '/image/sandrone/reserve/heroes/diverse/amber-workshop-v1.webp',
				midnightSalon: '/image/sandrone/reserve/heroes/diverse/midnight-salon-v2.webp',
				clockworkTheatre: '/image/sandrone/reserve/heroes/diverse/clockwork-theatre-v2.webp',
			},
		},
	},
	mascot: {
		ownerDialog: '/image/mascot/xgwnje-cat-dialog-v1.webp',
	},
} as const;

export type SandroneReserveAsset = keyof typeof visualAssets.sandrone.reserve;
export type SandroneReserveHeroAsset = keyof typeof visualAssets.sandrone.reserve.heroes;
export type SandroneReservePartAsset = keyof typeof visualAssets.sandrone.reserve.parts;
export type SandroneReserveMotionAsset = keyof typeof visualAssets.sandrone.reserve.motion;
export type SandroneDiverseHeroAsset = keyof typeof visualAssets.sandrone.reserve.diverseHeroes;
