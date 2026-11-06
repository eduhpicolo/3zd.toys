export const gameConfig = {
	boundaries: {
		movementPadding: {x: 26, y: 16},
		dropBottomPadding: 6
	},
	toys: {
		count: 90,
		columns: 17,
		imageDirectory: "toys",
		imageCount: 90,
		firstFrame: 1,
		padding: 10,
		jitter: {x: 5, y: 6},
		maxRotation: 22,
		collider: {widthRatio: 0.8, heightRatio: 0.8}
	},
	claw: {collider: {width: 30, height: 30}, centerOffset: {x: 0, y: 16}},
	movement: {step: 10, tickMs: 100, returnTickMs: 50},
	timing: {beforeGrabMs: 300, closeClawMs: 300, releaseMs: 300, overlayMs: 2000},
	collection: {slots: 5}
}
