import * as THREE from 'three';
import Ammo from 'ammojs-typed';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const graphContent = document.getElementById('graphics');
const AmmoLib = await Ammo.call({});
const timer = new THREE.Timer();
timer.connect(document);

// ---------------------------------------------------------------------------
// Constants / settings
// ---------------------------------------------------------------------------
const GRAVITY = -9.8;
const FIXED_STEP = 1 / 60;
const MAX_SUBSTEPS = 5;
const MACHINE_SIZE = 10;
const WALL_THICKNESS = 0.02;
const TOY_COUNT = 50;
const DISABLE_DEACTIVATION = 4;
const ACTIVE_TAG = 1;
const CF_KINEMATIC_OBJECT = 2;

// Claw sequence tuning
const CLAW = {
	descendSpeed: 2.5,     // units/s while the rope is paying out
	ascendSpeed: 2.5,      // units/s while the rope is reeling in
	travelSpeed: 3,        // units/s while carrying the toy to the corner
	releaseDelay: 0.8,     // seconds to wait after dropping the toy
	contactTolerance: 0.03,
	corner: {x: -1, z: -1}, // which corner to drop the toy in (-1 / +1)
	returnHome: true,      // go back to the start position after release
};

const settings = {
	ballRadius: .25,
	ballWidthSegments: 12,
	ballHeightSegments: 12,
	ballMass: 10,
	ballFriction: 1,
	ropeSegmentsCount: 3,
	ropeLength: 1,
	ropeElastic: 6.7,
	moveSpeed: 1,
	influence: .5,
};

const sliderRanges = {
	ballRadius: {min: 0.1, max: 2, step: 0.05},
	ballWidthSegments: {min: 3, max: 32, step: 1},
	ballHeightSegments: {min: 3, max: 32, step: 1},
	ballMass: {min: 0.1, max: 10, step: 0.1},
	ballFriction: {min: 0.1, max: 10, step: 0.1},
	ropeSegmentsCount: {min: 1, max: 20, step: 1},
	ropeLength: {min: 1, max: 4, step: 0.5},
	ropeElastic: {min: 0.1, max: 10, step: 0.1},
	moveSpeed: {min: 0.1, max: 10, step: 0.1},
	influence: {min: 0.1, max: 1, step: 0.05},
};

// ---------------------------------------------------------------------------
// Three.js objects (created once)
// ---------------------------------------------------------------------------
const Camera = new THREE.PerspectiveCamera(
	90, window.innerWidth / window.innerHeight, 0.1, 300
);
const Renderer = new THREE.WebGLRenderer({antialias: false});
const Scene = new THREE.Scene();
const CubeLoader = new THREE.CubeTextureLoader();

// Resources that live for the whole app and must never be disposed on rebuild
const baseMaterial = new THREE.MeshPhongMaterial({color: 0xffffff});
const ropeMaterial = new THREE.LineBasicMaterial({color: 0x000000});
const glassMaterial = new THREE.MeshPhongMaterial({
	color: 'grey',
	transparent: true,
	opacity: 0.37,
	depthWrite: false,
});
const toyGeometry = new THREE.BoxGeometry(1, 1, 1);
const persistentResources = new Set([
	baseMaterial, ropeMaterial, glassMaterial, toyGeometry,
]);

let controls;

// ---------------------------------------------------------------------------
// Physics (world created once)
// ---------------------------------------------------------------------------
let physicsWorld;
let collisionConfiguration;
let dispatcher;
let broadphase;
let solver;
let softBodySolver;

// Reused temporaries (avoid allocating WASM objects every frame)
const tmpTransform = new AmmoLib.btTransform();
const armTransform = new AmmoLib.btTransform();
const armPosition = new AmmoLib.btVector3(0, 0, 0);
const tmpVec = new AmmoLib.btVector3(0, 0, 0);

const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();

// Per-world registries (cleared on rebuild)
let arm = null;
let armBody = null;
let ballMesh = null;
let ballBody = null;
let rope = null;
let ropeSegmentCount = 1;
let ropeSoftBody = null;
let ropeNodes = null;
const dynamicMeshes = [];   // meshes synced from physics each frame
const allMeshes = [];       // every mesh added to the scene
const toyMeshes = [];       // grabbable toy cubes
const physicsBodies = [];
const motionStates = [];
const physicsShapes = [];
const softBodies = [];

// ---------------------------------------------------------------------------
// Claw sequence state
// phases: idle -> descend -> ascend -> travel -> wait -> home -> finish -> idle
// ---------------------------------------------------------------------------
const iX = -MACHINE_SIZE/2+1;
const iY = MACHINE_SIZE/2+1;
const iZ = MACHINE_SIZE/2-1;
const claw = {
	phase: 'idle',
	arm: new THREE.Vector3(),      // authoritative arm position during sequence
	ball: new THREE.Vector3(),     // authoritative ball position during sequence
	home: new THREE.Vector3(iX,iY,iZ),     // where the arm started
	target: new THREE.Vector3(),
	corner: new THREE.Vector3(),
	toy: null,
	toyOffset: new THREE.Vector3(),
	topBallY: 0,
	timer: 0,
};

function resetClawState() {
	claw.phase = 'idle';
	claw.toy = null;
	claw.timer = 0;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const movement = {x: 0, y: 0, z: 0};
const pressedKeys = new Set();
const MOVE_KEYS = new Set(['KeyA', 'KeyD', 'KeyW', 'KeyS', 'KeyR', 'KeyF']);

function updateMovement() {
	movement.x = (pressedKeys.has('KeyD') ? 1 : 0) - (pressedKeys.has('KeyA') ? 1 : 0);
	movement.z = (pressedKeys.has('KeyS') ? 1 : 0) - (pressedKeys.has('KeyW') ? 1 : 0);
	movement.y = (pressedKeys.has('KeyR') ? 1 : 0) - (pressedKeys.has('KeyF') ? 1 : 0);
}

function initInput() {
	window.addEventListener('keydown', (event) => {
		if (event.code === 'Space') {
			event.preventDefault();
			if (!event.repeat) startClaw();
			return;
		}

		if (!MOVE_KEYS.has(event.code)) return;
		event.preventDefault();

		// Movement keys are blocked while the claw sequence is running
		if (claw.phase !== 'idle') return;

		pressedKeys.add(event.code);
		updateMovement();
	});

	window.addEventListener('keyup', (event) => {
		if (!MOVE_KEYS.has(event.code)) return;
		pressedKeys.delete(event.code);
		updateMovement();
	});

	window.addEventListener('blur', () => {
		pressedKeys.clear();
		updateMovement();
	});
}

// ---------------------------------------------------------------------------
// One-time initialisation
// ---------------------------------------------------------------------------
function onWindowResize() {
	Camera.aspect = window.innerWidth / window.innerHeight;
	Camera.updateProjectionMatrix();
	Renderer.setSize(window.innerWidth, window.innerHeight);
}

function initGraphics() {
	if (!graphContent) return;

	Camera.position.set(1, 5, 10);
	controls = new OrbitControls(Camera, Renderer.domElement);
	controls.target.set(1, 3, 1);
	controls.update();

	Scene.add(new THREE.AmbientLight('white', 2));
	const light = new THREE.DirectionalLight('#f3f3f3', 100);
	light.position.set(0, 10, 0);
	Scene.add(light);

	const background = CubeLoader.load([
		'images/shortcut.png',
		'images/banco.png',
		'images/ceu.png',
		'images/piso.png',
		'images/sol.png',
		'images/way.png',
	]);
	background.colorSpace = THREE.SRGBColorSpace;
	Scene.background = background;

	Renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	Renderer.setSize(window.innerWidth, window.innerHeight);
	graphContent.appendChild(Renderer.domElement);

	window.addEventListener('resize', onWindowResize);
	Renderer.setAnimationLoop(animate);
}

function initPhysics() {
	collisionConfiguration = new AmmoLib.btSoftBodyRigidBodyCollisionConfiguration();
	dispatcher = new AmmoLib.btCollisionDispatcher(collisionConfiguration);
	broadphase = new AmmoLib.btDbvtBroadphase();
	solver = new AmmoLib.btSequentialImpulseConstraintSolver();
	softBodySolver = new AmmoLib.btDefaultSoftBodySolver();

	physicsWorld = new AmmoLib.btSoftRigidDynamicsWorld(
		dispatcher, broadphase, solver, collisionConfiguration, softBodySolver
	);

	const gravity = new AmmoLib.btVector3(0, GRAVITY, 0);
	physicsWorld.setGravity(gravity);
	physicsWorld.getWorldInfo().set_m_gravity(gravity);
	AmmoLib.destroy(gravity);
}

// ---------------------------------------------------------------------------
// Object creation
// ---------------------------------------------------------------------------
function createRigidBody(threeObject, physicsShape, mass, position, rotation) {
	threeObject.position.copy(position);
	threeObject.quaternion.copy(rotation);

	const transform = new AmmoLib.btTransform();
	transform.setIdentity();
	const origin = new AmmoLib.btVector3(position.x, position.y, position.z);
	const rot = new AmmoLib.btQuaternion(rotation.x, rotation.y, rotation.z, rotation.w);
	transform.setOrigin(origin);
	transform.setRotation(rot);

	const localInertia = new AmmoLib.btVector3(0, 0, 0);
	if (mass > 0) physicsShape.calculateLocalInertia(mass, localInertia);

	const motionState = new AmmoLib.btDefaultMotionState(transform);
	const rbInfo = new AmmoLib.btRigidBodyConstructionInfo(
		mass, motionState, physicsShape, localInertia
	);
	const rigidBody = new AmmoLib.btRigidBody(rbInfo);

	threeObject.userData.physicsBody = rigidBody;

	physicsWorld.addRigidBody(rigidBody);
	physicsBodies.push(rigidBody);
	motionStates.push(motionState);
	physicsShapes.push(physicsShape);
	allMeshes.push(threeObject);
	if (mass > 0) dynamicMeshes.push(threeObject);

	AmmoLib.destroy(origin);
	AmmoLib.destroy(rot);
	AmmoLib.destroy(transform);
	AmmoLib.destroy(localInertia);
	AmmoLib.destroy(rbInfo);

	Scene.add(threeObject);
	return rigidBody;
}

function createBoxObject(sx, sy, sz, mass, position, rotation, material, geometry) {
	const mesh = new THREE.Mesh(
		geometry ?? new THREE.BoxGeometry(sx, sy, sz),
		material
	);
	if (geometry) mesh.scale.set(sx, sy, sz);

	const halfExtents = new AmmoLib.btVector3(sx * 0.5, sy * 0.5, sz * 0.5);
	const shape = new AmmoLib.btBoxShape(halfExtents);
	AmmoLib.destroy(halfExtents);

	createRigidBody(mesh, shape, mass, position, rotation);
	return mesh;
}

function Machine() {
	const t = WALL_THICKNESS;
	const L = MACHINE_SIZE;
	const half = L / 2;
	quat.set(0, 0, 0, 1);

	// Floor (top surface at y = 0)
	pos.set(0, -t / 2, 0);
	createBoxObject(L + 2 * t, t, L + 2 * t, 0, pos, quat, glassMaterial);

	// Left / right
	pos.set(-half - t / 2, half, 0);
	createBoxObject(t, L, L, 0, pos, quat, glassMaterial);
	pos.set(half + t / 2, half, 0);
	createBoxObject(t, L, L, 0, pos, quat, glassMaterial);

	// Back / front
	pos.set(0, half, -half - t / 2);
	createBoxObject(L, L, t, 0, pos, quat, glassMaterial);
	pos.set(0, half, half + t / 2);
	createBoxObject(L, L, t, 0, pos, quat, glassMaterial);

	// Ceiling
	pos.set(0, L + t / 2, 0);
	createBoxObject(L + 2 * t, t, L + 2 * t, 0, pos, quat, glassMaterial);

	// Collector
	// Left / right
	pos.set(-half, half/4, half-L/8);
	createBoxObject(t, L/4, L/4, 0, pos, quat, glassMaterial);
	pos.set(-half+half-L/4, half/4, half-L/8);
	createBoxObject(t, L/4, L/4, 0, pos, quat, glassMaterial);
	pos.set(-(half-L/8), half/4,half-half/2);
	createBoxObject(L/4,L/4,t, 0, pos, quat, glassMaterial);
	// pos.set(-half - t+half-L/4, half/4, half-L/8);
	// createBoxObject(t, L/4, L/4, 0, pos, quat, glassMaterial);

}

function Toys(avoidX, avoidZ, avoidRadius) {
	const placed = [];
	const limit = MACHINE_SIZE / 2 - 1;
	quat.set(0, 0, 0, 1);

	for (let i = 0; i < TOY_COUNT; i++) {
		let x, y, z;
		let attempts = 0;
		do {
			x = (Math.random() * 2 - 1) * limit;
			y = 0.6 + Math.random() * 4.5;
			z = (Math.random() * 2 - 1) * limit;
			attempts++;
		} while (
			attempts < 50 &&
			(Math.hypot(x - avoidX, z - avoidZ) < avoidRadius ||
				placed.some((p) => Math.hypot(p.x - x, p.y - y, p.z - z) < 1.8))
			);
		placed.push({x, y, z});

		pos.set(x, y, z);
		const toy = createBoxObject(
			1, 1, 1, 1, pos, quat,
			new THREE.MeshPhongMaterial({color: Math.floor(Math.random() * 0xffffff)}),
			toyGeometry
		);
		toyMeshes.push(toy);
	}
}

function Mechanism() {
	const r = settings.ballRadius;
	const L = settings.ropeLength;
	const maxY = claw.home.y;

	// Arm hangs above the ball; the ball starts a little above the floor.
	const armY = claw.home.y+ Math.min(L + 2 * r + 1.5, maxY);
	pos.set(claw.home.x, armY, claw.home.z);
	quat.set(0, 0, 0, 1);
	arm = createBoxObject(1, 1, 1, 0, pos, quat, baseMaterial);

	armBody = arm.userData.physicsBody;
	armBody.setCollisionFlags(armBody.getCollisionFlags() | CF_KINEMATIC_OBJECT);
	armBody.setActivationState(DISABLE_DEACTIVATION);

	Grape(armY);
}

function Grape(armY) {
	const r = settings.ballRadius;
	const L = settings.ropeLength;
	const segments = Math.max(1, Math.floor(settings.ropeSegmentsCount));
	ropeSegmentCount = segments;

	// Ball (hangs below the arm: arm bottom - rope length - radius)
	const ballY = Math.max(r, armY - 0.5 - L - r);
	pos.set(claw.home.x, ballY, claw.home.z);
	quat.set(0, 0, 0, 1);

	ballMesh = new THREE.Mesh(
		new THREE.SphereGeometry(
			r,
			settings.ballWidthSegments,
			settings.ballHeightSegments
		),
		baseMaterial
	);
	const ballShape = new AmmoLib.btSphereShape(r);
	ballBody = createRigidBody(ballMesh, ballShape, settings.ballMass, pos, quat);
	ballBody.setFriction(settings.ballFriction);
	ballBody.setActivationState(DISABLE_DEACTIVATION);

	// Rope geometry (segments + 1 points)
	const ropeStartY = ballY + r;
	const ropeEndY = armY - 0.5;
	const ropePositions = new Float32Array((segments + 1) * 3);
	for (let i = 0; i <= segments; i++) {
		ropePositions[i * 3] = 0;
		ropePositions[i * 3 + 1] = ropeStartY + (i / segments) * (ropeEndY - ropeStartY);
		ropePositions[i * 3 + 2] = 0;
	}
	const ropeIndices = new Uint16Array(segments * 2);
	for (let i = 0; i < segments; i++) {
		ropeIndices[i * 2] = i;
		ropeIndices[i * 2 + 1] = i + 1;
	}

	const ropeGeometry = new THREE.BufferGeometry();
	ropeGeometry.setIndex(new THREE.BufferAttribute(ropeIndices, 1));
	const positionAttr = new THREE.BufferAttribute(ropePositions, 3);
	positionAttr.setUsage(THREE.DynamicDrawUsage);
	ropeGeometry.setAttribute('position', positionAttr);
	rope = new THREE.LineSegments(ropeGeometry, ropeMaterial);
	rope.frustumCulled = false;

	createRopeSoftBody();

	allMeshes.push(rope);
	Scene.add(rope);
}

// Rope soft body is created between the CURRENT ball top and arm bottom, so it
// can be re-created at any time (used at the end of the claw sequence).
function createRopeSoftBody() {
	const r = settings.ballRadius;
	const segments = ropeSegmentCount;
	const bp = ballMesh.position;
	const ap = arm.position;

	// CreateRope's "res" = number of nodes BETWEEN the ends,
	// so segments - 1 gives exactly segments + 1 nodes (matches the geometry).
	const helpers = new AmmoLib.btSoftBodyHelpers();
	const ropeStart = new AmmoLib.btVector3(bp.x, bp.y + r, bp.z);
	const ropeEnd = new AmmoLib.btVector3(ap.x, ap.y - 0.5, ap.z);

	ropeSoftBody = helpers.CreateRope(
		physicsWorld.getWorldInfo(), ropeStart, ropeEnd, segments - 1, 0
	);

	const cfg = ropeSoftBody.get_m_cfg();
	cfg.set_viterations(10);
	cfg.set_piterations(10);

	ropeSoftBody.setTotalMass(settings.ropeElastic, false);
	physicsWorld.addSoftBody(ropeSoftBody, 1, -1);
	ropeSoftBody.setActivationState(DISABLE_DEACTIVATION);

	ropeSoftBody.appendAnchor(0, ballBody, true, settings.influence);
	ropeSoftBody.appendAnchor(segments, armBody, true, settings.influence);

	softBodies.push(ropeSoftBody);
	ropeNodes = ropeSoftBody.get_m_nodes();

	AmmoLib.destroy(ropeStart);
	AmmoLib.destroy(ropeEnd);
	AmmoLib.destroy(helpers);
}

function destroyRopeSoftBody() {
	if (!ropeSoftBody) return;
	physicsWorld.removeSoftBody(ropeSoftBody);
	AmmoLib.destroy(ropeSoftBody);
	const index = softBodies.indexOf(ropeSoftBody);
	if (index >= 0) softBodies.splice(index, 1);
	ropeSoftBody = null;
	ropeNodes = null;
}

// ---------------------------------------------------------------------------
// World build / teardown
// ---------------------------------------------------------------------------
function buildWorld() {
	Machine();
	Mechanism();
	Toys(0, 0, settings.ballRadius + 1.5);
}

function destroyWorld() {
	for (const sb of softBodies) {
		physicsWorld.removeSoftBody(sb);
		AmmoLib.destroy(sb);
	}
	for (const body of physicsBodies) {
		physicsWorld.removeRigidBody(body);
		AmmoLib.destroy(body);
	}
	for (const ms of motionStates) AmmoLib.destroy(ms);
	for (const shape of physicsShapes) AmmoLib.destroy(shape);

	for (const mesh of allMeshes) {
		Scene.remove(mesh);
		if (!persistentResources.has(mesh.geometry)) mesh.geometry.dispose();
		if (!persistentResources.has(mesh.material)) mesh.material.dispose();
	}

	softBodies.length = 0;
	physicsBodies.length = 0;
	motionStates.length = 0;
	physicsShapes.length = 0;
	allMeshes.length = 0;
	dynamicMeshes.length = 0;
	toyMeshes.length = 0;
	arm = null;
	armBody = null;
	ballMesh = null;
	ballBody = null;
	rope = null;
	ropeSoftBody = null;
	ropeNodes = null;
	resetClawState();
}

function rebuildWorld() {
	destroyWorld();
	buildWorld();
}

let rebuildTimeout = 0;
function scheduleRebuild() {
	clearTimeout(rebuildTimeout);
	rebuildTimeout = setTimeout(rebuildWorld, 120);
}

// ---------------------------------------------------------------------------
// Kinematic helpers
// ---------------------------------------------------------------------------
function setArmPosition(x, y, z) {
	armPosition.setValue(x, y, z);
	armTransform.setIdentity();
	armTransform.setOrigin(armPosition);

	armBody.setWorldTransform(armTransform);
	const motionState = armBody.getMotionState();
	if (motionState) motionState.setWorldTransform(armTransform);

	arm.position.set(x, y, z);
}

// Moves a kinematic body keeping its current rotation
function setKinematicOrigin(body, x, y, z) {
	tmpVec.setValue(x, y, z);
	const transform = body.getWorldTransform();
	transform.setOrigin(tmpVec);
	const motionState = body.getMotionState();
	if (motionState) motionState.setWorldTransform(transform);
}

function zeroVelocity(body) {
	tmpVec.setValue(0, 0, 0);
	body.setLinearVelocity(tmpVec);
	body.setAngularVelocity(tmpVec);
}

function makeKinematic(body) {
	zeroVelocity(body);
	body.setCollisionFlags(body.getCollisionFlags() | CF_KINEMATIC_OBJECT);
	body.setActivationState(DISABLE_DEACTIVATION);
}

function makeDynamic(body, keepAwake) {
	body.setCollisionFlags(body.getCollisionFlags() & ~CF_KINEMATIC_OBJECT);
	zeroVelocity(body);
	body.setActivationState(keepAwake ? DISABLE_DEACTIVATION : ACTIVE_TAG);
}

const _delta = new THREE.Vector3();
// Moves `current` toward `target` by at most maxDist. Returns true when reached.
function stepToward(current, target, maxDist) {
	_delta.copy(target).sub(current);
	const d = _delta.length();
	if (d <= maxDist || d < 1e-6) {
		current.copy(target);
		return true;
	}
	current.addScaledVector(_delta, maxDist / d);
	return false;
}

// ---------------------------------------------------------------------------
// Claw sequence (SPACE)
// ---------------------------------------------------------------------------
const _local = new THREE.Vector3();
const _invQuat = new THREE.Quaternion();

// Sphere (center, radius) vs. oriented box (toy mesh) overlap test
function sphereTouchesToy(center, radius, toy) {
	_invQuat.copy(toy.quaternion).invert();
	_local.copy(center).sub(toy.position).applyQuaternion(_invQuat);

	const hx = 0.5 * toy.scale.x;
	const hy = 0.5 * toy.scale.y;
	const hz = 0.5 * toy.scale.z;

	const dx = _local.x - THREE.MathUtils.clamp(_local.x, -hx, hx);
	const dy = _local.y - THREE.MathUtils.clamp(_local.y, -hy, hy);
	const dz = _local.z - THREE.MathUtils.clamp(_local.z, -hz, hz);

	const reach = radius + CLAW.contactTolerance;
	return dx * dx + dy * dy + dz * dz <= reach * reach;
}

function findTouchedToy() {
	const r = settings.ballRadius;
	for (const toy of toyMeshes) {
		if (toy === claw.toy) continue;
		if (sphereTouchesToy(claw.ball, r, toy)) return toy;
	}
	return null;
}

function grabToy(toy) {
	claw.toy = toy;
	claw.toyOffset.copy(toy.position).sub(claw.ball);
	makeKinematic(toy.userData.physicsBody);
}

function releaseToy() {
	if (!claw.toy) return;
	makeDynamic(claw.toy.userData.physicsBody, false);
	claw.toy = null;
}

function startClaw() {
	if(arm.position.x < -2 && arm.position.z > 2)
		return;

	if (claw.phase !== 'idle' || !armBody || !ballBody) return;
	// block / clear manual movement
	pressedKeys.clear();
	updateMovement();

	const r = settings.ballRadius;
	claw.arm.copy(arm.position);
	claw.home.copy(arm.position);
	claw.ball.copy(ballMesh.position);

	// Current rope length = distance from arm bottom to ball top
	const ropeLen = Math.max(0.2, (arm.position.y - 0.5) - (ballMesh.position.y + r));
	claw.topBallY = arm.position.y - 0.5 - ropeLen - r;

	const limit = MACHINE_SIZE / 2 - Math.max(0.8, r + 0.5);
	claw.corner.set(CLAW.corner.x * limit, arm.position.y, CLAW.corner.z * limit);

	claw.toy = null;
	claw.timer = 0;

	// The physical rope is replaced by a visual rope that stretches freely
	destroyRopeSoftBody();
	makeKinematic(ballBody);

	claw.phase = 'descend';
}

function finishClaw() {
	makeDynamic(ballBody, true);
	createRopeSoftBody();   // physical rope again, from current ball to arm
	resetClawState();
}

function applyBallAndToy() {
	setKinematicOrigin(ballBody, claw.ball.x, claw.ball.y, claw.ball.z);
	ballMesh.position.copy(claw.ball);

	if (claw.toy) {
		const x = claw.ball.x + claw.toyOffset.x;
		const y = claw.ball.y + claw.toyOffset.y;
		const z = claw.ball.z + claw.toyOffset.z;
		setKinematicOrigin(claw.toy.userData.physicsBody, x, y, z);
		claw.toy.position.set(x, y, z);
	}
}

function updateClaw(dt) {
	if (claw.phase === 'idle' || !armBody || !ballBody) return;

	const r = settings.ballRadius;

	switch (claw.phase) {
		case 'descend': {
			// rope grows while the sphere goes down
			claw.ball.y -= CLAW.descendSpeed * dt;

			if (claw.ball.y <= r) {
				claw.ball.y = r;          // reached the floor without a toy
				claw.phase = 'ascend';
			} else {
				const toy = findTouchedToy();
				if (toy) {
					grabToy(toy);         // sphere collided with a cube
					claw.phase = 'ascend';
				}
			}
			break;
		}

		case 'ascend': {
			// rope shortens until the sphere is back at the top
			claw.target.set(claw.arm.x, claw.topBallY, claw.arm.z);
			if (stepToward(claw.ball, claw.target, CLAW.ascendSpeed * dt)) {
				claw.phase = claw.toy ? 'travel' : 'goback';
			}
			break;
		}

		case 'travel': {
			// carry the toy to the corner (ball stays under the arm)
			claw.target.set(-4, claw.arm.y, 4);
			const arrived = stepToward(claw.arm, claw.target, CLAW.travelSpeed * dt);
			claw.ball.set(claw.arm.x, claw.topBallY, claw.arm.z);

			if (arrived) {
				releaseToy();
				claw.timer = 0;
				claw.phase = 'wait';
			}
			break;
		}

		case 'wait': {
			claw.timer += dt;
			if (claw.timer >= CLAW.releaseDelay) {
				claw.phase = CLAW.returnHome ? 'goback' : 'goback';
			}
			break;
		}

		case 'home': {
			claw.target.set(claw.home.x, claw.arm.y, claw.home.z);
			const arrived = stepToward(claw.arm, claw.target, CLAW.travelSpeed * dt);
			claw.ball.set(claw.arm.x, claw.topBallY, claw.arm.z);
			if (arrived) claw.phase = 'goback';
			break;
		}

		case 'goback': {
			claw.target.set(-4, claw.arm.y, 4);
			const arrived = stepToward(claw.arm, claw.target, CLAW.travelSpeed * dt);
			claw.ball.set(claw.arm.x, claw.topBallY, claw.arm.z);
			if (arrived) claw.phase = 'finish';
			break;
		}

		case 'finish': {
			setArmPosition(claw.arm.x, claw.arm.y, claw.arm.z);
			applyBallAndToy();
			finishClaw();
			return;
		}
	}

	setArmPosition(claw.arm.x, claw.arm.y, claw.arm.z);
	applyBallAndToy();
}

// Straight visual rope between the ball top and the arm bottom
function updateClawRopeLine() {
	const positions = rope.geometry.attributes.position;
	const array = positions.array;
	const r = settings.ballRadius;
	const count = array.length / 3;

	const bx = ballMesh.position.x;
	const by = ballMesh.position.y + r;
	const bz = ballMesh.position.z;
	const ax = arm.position.x;
	const ay = arm.position.y - 0.5;
	const az = arm.position.z;

	for (let i = 0; i < count; i++) {
		const t = count > 1 ? i / (count - 1) : 0;
		array[i * 3] = bx + (ax - bx) * t;
		array[i * 3 + 1] = by + (ay - by) * t;
		array[i * 3 + 2] = bz + (az - bz) * t;
	}
	positions.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------
function moveArm(deltaTime) {
	if (!armBody) return;
	if (claw.phase !== 'idle') return; // manual movement blocked during claw sequence
	if (movement.x === 0 && movement.y === 0 && movement.z === 0) return;

	const length = Math.hypot(movement.x, movement.y, movement.z);
	const scale = (length > 1 ? 1 / length : 1) * settings.moveSpeed * deltaTime;

	const current = armBody.getWorldTransform().getOrigin();
	const limit = MACHINE_SIZE / 2 - 0.8;

	const x = THREE.MathUtils.clamp(current.x() + movement.x * scale, -limit, limit);
	const y = THREE.MathUtils.clamp(current.y() + movement.y * scale, 1, MACHINE_SIZE - 1);
	const z = THREE.MathUtils.clamp(current.z() + movement.z * scale, -limit, limit);

	setArmPosition(x, y, z);
}

function syncGraphics() {
	if (rope) {
		if (ropeNodes) {
			const positions = rope.geometry.attributes.position;
			const array = positions.array;
			const nodeCount = Math.min(array.length / 3, ropeNodes.size());

			for (let i = 0; i < nodeCount; i++) {
				const p = ropeNodes.at(i).get_m_x();
				const index = i * 3;
				array[index] = p.x();
				array[index + 1] = p.y();
				array[index + 2] = p.z();
			}
			positions.needsUpdate = true;
		} else if (claw.phase !== 'idle' && ballMesh && arm) {
			updateClawRopeLine();
		}
	}

	for (const mesh of dynamicMeshes) {
		const motionState = mesh.userData.physicsBody.getMotionState();
		if (!motionState) continue;

		motionState.getWorldTransform(tmpTransform);
		const p = tmpTransform.getOrigin();
		const q = tmpTransform.getRotation();
		mesh.position.set(p.x(), p.y(), p.z());
		mesh.quaternion.set(q.x(), q.y(), q.z(), q.w());
	}
}

function animate() {
	timer.update();
	const deltaTime = Math.min(timer.getDelta(), 0.1);

	moveArm(deltaTime);
	updateClaw(deltaTime);
	physicsWorld.stepSimulation(deltaTime, MAX_SUBSTEPS, FIXED_STEP);
	syncGraphics();

	Renderer.render(Scene, Camera);
}

// ---------------------------------------------------------------------------
// Settings UI (built once; sliders are never destroyed while dragging)
// ---------------------------------------------------------------------------
function initSettingsControls() {
	const container = document.getElementById('slider');
	if (!container) return;
	container.replaceChildren();

	for (const [id, defaultValue] of Object.entries(settings)) {
		const range = sliderRanges[id] ?? {min: 0, max: 100, step: 1};

		const wrapper = document.createElement('div');
		wrapper.style.scale = 0.7;

		const label = document.createElement('label');
		label.htmlFor = id;
		label.textContent = id;

		const slider = document.createElement('input');
		slider.id = id;
		slider.type = 'range';
		slider.min = range.min;
		slider.max = range.max;
		slider.step = range.step;
		slider.value = defaultValue;
		slider.style.width = '200px';

		const output = document.createElement('span');
		output.textContent = ` ${defaultValue}`;

		slider.addEventListener('input', () => {
			settings[id] = Number(slider.value);
			output.textContent = ` ${slider.value}`;
			if (id === 'moveSpeed') return; // no rebuild needed
			scheduleRebuild();
		});

		wrapper.append(label, document.createElement('br'), slider, output);
		container.appendChild(wrapper);
	}
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
function init() {
	try {
		initPhysics();
		initInput();
		initGraphics();
		buildWorld();
		initSettingsControls();
	} catch (e) {
		console.error(e);
		alert(e);
	}
}

init();