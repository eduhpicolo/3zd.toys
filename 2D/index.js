import {gameConfig} from './config.js'

// Read dimensions from CSS custom properties
const computed = getComputedStyle(document.documentElement)
const cssVar = (name, parse = parseFloat) => parse(computed.getPropertyValue(name).trim())
const toyWidth = cssVar('--toy-w')
const toyHeight = toyWidth

const elements = {
	clawMachine: document.querySelector('.claw-machine'),
	box: document.querySelector('.box'),
	collectionBox: document.querySelector('.collection-box'),
	collectionSlot: document.querySelector('.slot-lg'),
	toys: [],
}

const settings = {
	targetToy: null,
	collectedNumber: 0,
}

const toyCount = Math.max(0, Math.floor(gameConfig.toys.count))
const toyColumns = Math.max(1, Math.floor(gameConfig.toys.columns))
const toyRows = Math.ceil(toyCount / toyColumns)
const toyTypes = Array.from(
	{length: Math.max(1, Math.floor(gameConfig.toys.imageCount))},
	(_, i) => `${String(i + gameConfig.toys.firstFrame)}`,
)

const createToyImage = toyType =>
	Object.assign(document.createElement('img'), {
		className: 'toy-image',
		src: `${gameConfig.toys.imageDirectory}/${toyType}.png`,
		alt: 'Collectible toy',
		decoding: 'async',
		draggable: false,
	})

const sortedToys = Array.from({length: toyCount}, (_, i) => toyTypes[i % toyTypes.length])
for (let i = sortedToys.length - 1; i > 0; i--) {
	const j = Math.floor(Math.random() * (i + 1))
	;[sortedToys[i], sortedToys[j]] = [sortedToys[j], sortedToys[i]]
}

const cornerBuffer = gameConfig.toys.padding
const machineBuffer = gameConfig.boundaries.movementPadding
const radToDeg = rad => Math.round(rad * (180 / Math.PI))
const calcX = (i, n) => i % n
const calcY = (i, n) => Math.floor(i / n)

const {width: machineWidth, top: machineTop} = elements.box.getBoundingClientRect()
const {height: machineTopHeight} = document.querySelector('.machine-top').getBoundingClientRect()
const {
	height: machineBottomHeight,
	top: machineBottomTop
} = document.querySelector('.machine-bottom').getBoundingClientRect()

const maxArmLength = Math.max(1, machineBottomTop - machineTop - machineBuffer.y)
const clamp = (v, min, max) => min > max ? (min + max) / 2 : Math.max(min, Math.min(max, v))
const adjustAngle = a => {
	const r = a % 360;
	return r < 0 ? r + 360 : r
}
const randomN = (min, max) => Math.round(min - 0.5 + Math.random() * (max - min + 1))

// ─── Classes ─────────────────────────────────────────────────

class Button {
	constructor({className, action, isLocked, pressAction, releaseAction}) {
		Object.assign(this, {el: document.querySelector(`.${className}`), isLocked})
		this.el.disabled = isLocked
		this.el.addEventListener('click', action)
		this.el.addEventListener('pointerdown', e => {
			if (this.isLocked || !pressAction || e.button !== 0) return
			e.preventDefault()
			this.activePointerId = e.pointerId
			this.el.setPointerCapture(e.pointerId)
			pressAction()
		})
		const release = e => {
			if (e.pointerId !== this.activePointerId) return
			this.activePointerId = null
			if (!this.isLocked) releaseAction?.()
		}
		this.el.addEventListener('pointerup', release)
		this.el.addEventListener('pointercancel', release)
		this.el.addEventListener('keydown', e => {
			if (this.isLocked || !pressAction || e.repeat || !['Enter', 'Space'].includes(e.code)) return
			e.preventDefault()
			this.activeKey = e.code
			pressAction()
		})
		this.el.addEventListener('keyup', e => {
			if (e.code !== this.activeKey) return
			this.activeKey = null
			if (!this.isLocked) releaseAction?.()
		})
		if (!isLocked) this.activate()
	}

	activate() {
		this.isLocked = false;
		this.el.disabled = false;
		this.el.classList.add('active')
	}

	deactivate() {
		this.isLocked = true;
		this.el.disabled = true;
		this.el.classList.remove('active')
	}
}

class WorldObject {
	constructor(props) {
		Object.assign(this, {
			className: null, x: 0, y: 0, z: 0, angle: 0,
			bottom: null, transformOrigin: '0px 0px',
			interval: null, default: {}, moveWith: [],
			isArmJoint: props.className === 'arm-joint',
			el: props.className && document.querySelector(`.${props.className}`),
			...props,
		})
		this.setStyles()
		if (props.className) {
			const {width, height} = this.el.getBoundingClientRect()
			this.w = width;
			this.h = height
		}
		;['x', 'y', 'w', 'h'].forEach(k => {
			this.default[k] = this[k]
		})
	}

	setStyles() {
		Object.assign(this.el.style, {
			left: `${this.x}px`,
			top: !this.bottom && `${this.y}px`,
			bottom: this.bottom,
			width: `${this.w}px`,
			height: `${this.h}px`,
			transformOrigin: this.transformOrigin,
		})
		this.el.style.zIndex = this.z
		if (this.isArmJoint) this.updateJointPos()
	}

	updateJointPos() {
		elements.box?.style.setProperty('--arm-joint-top', `${this.y}px`)
	}

	setClawPos(pos) {
		this.clawPos = pos
	}

	setTransformOrigin(o) {
		this.transformOrigin = o === 'center' ? 'center' : `${o.x}px ${o.y}px`
		this.setStyles()
	}

	handleNext(next) {
		clearInterval(this.interval);
		this.interval = null;
		if (next) next()
	}

	resumeMove(opts) {
		clearInterval(this.interval);
		this.interval = null;
		this.move(opts)
	}

	move({moveKey, target, moveTime, next}) {
		if (this.interval) {
			this.handleNext(next)
		} else {
			const moveTarget = target ?? this.default[moveKey]
			this.interval = setInterval(() => {
				const dist = Math.min(Math.abs(this[moveKey] - moveTarget), Math.max(1, gameConfig.movement.step))
				const inc = Math.sign(moveTarget - this[moveKey]) * dist
				if (dist > 0) {
					this[moveKey] += inc
					const styleKey = moveKey === 'x' ? 'left' : moveKey === 'y' ? 'top' : 'height'
					this.el.style[styleKey] = `${this[moveKey]}px`
					if (moveKey === 'y' && this.isArmJoint) this.updateJointPos()
					if (this.moveWith.length) {
						this.moveWith.forEach(obj => {
							if (!obj) return
							const key = moveKey === 'h' ? 'y' : moveKey
							obj[key] += inc
							obj.el.style[key === 'x' ? 'left' : 'top'] = `${obj[key]}px`
							if (key === 'y' && obj.isArmJoint) obj.updateJointPos()
						})
					}
				} else {
					this.handleNext(next)
				}
			}, moveTime ?? gameConfig.movement.tickMs)
		}
	}
}

class Toy extends WorldObject {
	constructor(props) {
		const toyType = sortedToys[props.index]
		const size = {w: toyWidth, h: toyHeight}
		const initialAngle = randomN(-gameConfig.toys.maxRotation, gameConfig.toys.maxRotation)
		super({
			el: Object.assign(document.createElement('div'), {className: 'toy'}),
			x: clamp(
				cornerBuffer +
				calcX(props.index, toyColumns) * Math.max(0, machineWidth - cornerBuffer * 2 - size.w) / Math.max(1, toyColumns - 1) +
				randomN(-gameConfig.toys.jitter.x, gameConfig.toys.jitter.x),
				0, Math.max(0, machineWidth - size.w)
			),
			y: clamp(
				machineBottomTop - machineTop + cornerBuffer - size.h / 2 +
				calcY(props.index, toyColumns) * Math.max(0, machineBottomHeight - cornerBuffer * 2 - size.h / 2) / Math.max(1, toyRows - 1) +
				randomN(-gameConfig.toys.jitter.y, gameConfig.toys.jitter.y),
				0, Math.max(0, machineBottomTop - machineTop + machineBottomHeight - size.h)
			),
			transformOrigin: 'center', z: 1, angle: initialAngle, toyType, ...size, ...props,
		})
		this.el.style.setProperty('--rotate-angle', `${initialAngle}deg`)
		this.el.append(createToyImage(toyType))
		const toy = this
		this.el.addEventListener('click', () => this.collectToy(toy))
		this.el.addEventListener('keydown', e => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				this.collectToy(toy)
			}
		})
		elements.toys.push(this)
	}

	collectToy(toy) {
		if (!toy.el.classList.contains('selected')) return
		toy.el.classList.remove('selected')
		toy.el.removeAttribute('tabindex')
		toy.el.removeAttribute('role')
		toy.el.removeAttribute('aria-label')
		toy.x = machineWidth / 2 - toy.w / 2
		toy.y = elements.clawMachine.clientHeight / 2 - toy.h / 2
		toy.z = 7
		toy.el.style.setProperty('--rotate-angle', '0deg')
		toy.setTransformOrigin('center')
		toy.el.classList.add('display')
		elements.clawMachine.classList.add('show-overlay')
		settings.collectedNumber++

		const collectedToy = Object.assign(document.createElement('div'), {className: 'toy'})
		collectedToy.append(createToyImage(toy.toyType))
		const toyWrapper = Object.assign(document.createElement('div'), {
			className: `toy-wrapper ${settings.collectedNumber > gameConfig.collection.slots ? 'squeeze-in' : ''}`,
		})
		toyWrapper.append(collectedToy)
		elements.collectionBox.appendChild(toyWrapper)

		setTimeout(() => {
			elements.clawMachine.classList.remove('show-overlay')
		}, gameConfig.timing.overlayMs)
	}

	setRotateAngle() {
		const angle = radToDeg(
			Math.atan2(this.y + this.h / 2 - this.clawPos.y, this.x + this.w / 2 - this.clawPos.x),
		) - 90
		const adj = Math.round(adjustAngle(angle))
		this.angle = adj < 180 ? adj * -1 : 360 - adj
		this.el.style.setProperty('--rotate-angle', `${this.angle}deg`)
	}
}

// ─── Setup ───────────────────────────────────────────────────

const clawInitialZ = 2

const armJoint = new WorldObject({className: 'arm-joint', z: clawInitialZ})
const getHoriTarget = t => clamp(t, machineBuffer.x, machineWidth - armJoint.w - machineBuffer.x)
const getVertTarget = t => clamp(t, machineBuffer.y, machineTopHeight - machineBuffer.y)

const vertRail = new WorldObject({className: 'vert', moveWith: [null, armJoint]})
const arm = new WorldObject({className: 'arm'})

armJoint.move({
	moveKey: 'y',
	target: getVertTarget(machineTopHeight - machineBuffer.y),
	moveTime: gameConfig.movement.returnTickMs,
	next: () => vertRail.resumeMove({
		moveKey: 'x',
		target: machineBuffer.x,
		moveTime: gameConfig.movement.returnTickMs,
		next: () => {
			Object.assign(armJoint.default, {
				y: getVertTarget(machineTopHeight - machineBuffer.y),
				x: getHoriTarget(machineBuffer.x)
			})
			Object.assign(vertRail.default, {x: getHoriTarget(machineBuffer.x)})
			activateHoriBtn()
		},
	}),
})

// Claw collider offset
const clawRect = document.querySelector('.claws').getBoundingClientRect()
const jointRect = armJoint.el.getBoundingClientRect()
const clawCenterOffset = {
	x: clawRect.left + clawRect.width / 2 - jointRect.left,
	y: clawRect.top + clawRect.height / 2 - jointRect.top - arm.h,
}

const getClawCollider = () => {
	const {width: w, height: h} = gameConfig.claw.collider
	const currentArmLength = arm.h
	return {
		x: armJoint.x + clawCenterOffset.x + gameConfig.claw.centerOffset.x - w / 2,
		y: armJoint.y + currentArmLength + clawCenterOffset.y + gameConfig.claw.centerOffset.y - h / 2,
		w, h,
	}
}

const getToyCollider = toy => {
	const w = toy.w * gameConfig.toys.collider.widthRatio
	const h = toy.h * gameConfig.toys.collider.heightRatio
	return {x: toy.x + (toy.w - w) / 2, y: toy.y + (toy.h - h) / 2, w, h}
}

const doOverlap = (a, b) =>
	a.x <= b.x + b.w && a.x + a.w >= b.x && a.y <= b.y + b.h && a.y + a.h >= b.y

const getClosestToy = () => {
	const claw = getClawCollider()
	const center = {x: claw.x + claw.w / 2, y: claw.y + claw.h / 2}
	let toy = null, closest = Infinity
	for (const t of elements.toys) {
		if (t.el.classList.contains('selected') || t.el.classList.contains('display') || !doOverlap(getToyCollider(t), claw)) continue
		const dx = t.x + t.w / 2 - center.x
		const dy = t.y + t.h / 2 - center.y
		const d = dx * dx + dy * dy
		if (d < closest || (d === closest && t.index > toy.index)) {
			toy = t;
			closest = d
		}
	}
	settings.targetToy = toy
	if (toy) {
		toy.setTransformOrigin('center')
		toy.setClawPos(center)
		armJoint.z = toy.z + 1
		armJoint.setStyles()
	}
}

// Create toys
const frag = document.createDocumentFragment()
for (let i = 0; i < toyCount; i++) frag.append(new Toy({index: i}).el)
elements.box.append(frag)

// ─── Game logic ──────────────────────────────────────────────

const stopHoriAndActivateVert = () => {
	armJoint.interval = null
	horiBtn.deactivate()
	autoBtn.deactivate()
	vertBtn.activate()
}

const activateHoriBtn = () => {
	armJoint.z = clawInitialZ
	armJoint.setStyles()
	horiBtn.activate()
	autoBtn.activate()
	;[vertRail, armJoint, arm].forEach(c => (c.interval = null))
}

const dropToy = () => {
	arm.el.classList.add('open')
	if (settings.targetToy) {
		const toy = settings.targetToy
		const machineRect = elements.clawMachine.getBoundingClientRect()
		const boxRect = elements.box.getBoundingClientRect()
		const chuteRect = elements.collectionSlot.getBoundingClientRect()
		const originX = machineRect.left + elements.clawMachine.clientLeft
		const originY = machineRect.top + elements.clawMachine.clientTop
		toy.x += boxRect.left - originX
		toy.y += boxRect.top - originY
		elements.clawMachine.append(toy.el)
		toy.z = 6
		// Align toy to the left edge of the slot (slot is at bottom-left corner)
		toy.x = chuteRect.left - originX
		toy.setStyles()
		toy.el.style.setProperty('--rotate-angle', '0deg')
		toy.move({
			moveKey: 'y',
			target: chuteRect.bottom - originY - toy.h - gameConfig.boundaries.dropBottomPadding,
			moveTime: gameConfig.movement.returnTickMs,
		})
		;[vertRail, armJoint, arm].forEach(o => (o.moveWith[0] = null))
	}
	setTimeout(() => {
		arm.el.classList.remove('open')
		activateHoriBtn()
		if (settings.targetToy) {
			settings.targetToy.el.classList.add('selected')
			settings.targetToy.el.tabIndex = 0
			settings.targetToy.el.setAttribute('role', 'button')
			settings.targetToy.el.setAttribute('aria-label', 'Collect toy')
			settings.targetToy = null
		}
	}, gameConfig.timing.releaseMs)
}

const grabToy = () => {
	if (settings.targetToy) {
		;[vertRail, armJoint, arm].forEach(o => (o.moveWith[0] = settings.targetToy))
		settings.targetToy.setRotateAngle()
	}
}

const startGrabSequence = () => {
	setTimeout(() => {
		arm.el.classList.add('open')
		arm.move({
			moveKey: 'h',
			target: maxArmLength,
			next: () => {
				getClosestToy()
				setTimeout(() => {
					arm.el.classList.remove('open')
					grabToy()
					arm.resumeMove({
						moveKey: 'h',
						next: () => vertRail.resumeMove({
							moveKey: 'x',
							next: () => armJoint.resumeMove({
								moveKey: 'y',
								next: dropToy,
							}),
						}),
					})
				}, gameConfig.timing.closeClawMs)
			},
		})
	}, gameConfig.timing.beforeGrabMs)
}

// ─── Buttons ─────────────────────────────────────────────────

const horiBtn = new Button({
	className: 'hori-btn',
	isLocked: true,
	pressAction: () => {
		vertRail.move({
			moveKey: 'x',
			target: getHoriTarget(machineWidth - armJoint.w - machineBuffer.x),
			next: stopHoriAndActivateVert,
		})
	},
	releaseAction: () => {
		clearInterval(vertRail.interval)
		stopHoriAndActivateVert()
	},
})

const vertBtn = new Button({
	className: 'vert-btn',
	isLocked: true,
	pressAction: () => {
		if (vertBtn.isLocked) return
		armJoint.move({moveKey: 'y', target: getVertTarget(machineBuffer.y)})
	},
	releaseAction: () => {
		clearInterval(armJoint.interval)
		vertBtn.deactivate()
		startGrabSequence()
	},
})

const autoBtn = new Button({
	className: 'auto-btn',
	isLocked: true,
	action: () => {
		if (autoBtn.isLocked) return
		const available = elements.toys.filter(
			t => !t.el.classList.contains('selected') && !t.el.classList.contains('display'),
		)
		if (!available.length) return

		horiBtn.deactivate()
		vertBtn.deactivate()
		autoBtn.deactivate()

		const target = available[Math.floor(Math.random() * available.length)]
		const claw = getClawCollider()
		const offsetX = claw.x + claw.w / 2 - armJoint.x
		const offsetY = claw.y + claw.h / 2 - armJoint.y
		const targetX = getHoriTarget(target.x + target.w / 2 - offsetX)
		const targetY = getVertTarget(target.y + target.h / 2 - offsetY)

		vertRail.move({
			moveKey: 'x',
			target: targetX,
			next: () => {
				clearInterval(vertRail.interval)
				armJoint.move({
					moveKey: 'y',
					target: targetY,
					next: () => {
						clearInterval(armJoint.interval)
						startGrabSequence()
					},
				})
			},
		})
	},
})
