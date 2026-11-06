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
const WALL_THICKNESS = 0.5;
const TOY_COUNT = 30;
const DISABLE_DEACTIVATION = 4;
const CF_KINEMATIC_OBJECT = 2;

const settings = {
	ballRadius: 1,
	ballWidthSegments: 16,
	ballHeightSegments: 12,
	ballMass: 1,
	ballFriction: 1,
	ropeSegmentsCount: 6,
	ropeLength: 3,
	ropeElastic: 1, // total rope mass
	moveSpeed: 3,
	influence: 1,
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
	opacity: 0.3,
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

const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();

// Per-world registries (cleared on rebuild)
let arm = null;
let armBody = null;
let rope = null;
let ropeSoftBody = null;
let ropeNodes = null;
const dynamicMeshes = [];   // meshes synced from physics each frame
const allMeshes = [];       // every mesh added to the scene
const physicsBodies = [];
const motionStates = [];
const physicsShapes = [];
const softBodies = [];

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
		if (!MOVE_KEYS.has(event.code)) return;
		event.preventDefault();
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

	Scene.add(new THREE.AmbientLight('white', 1.2));
	const light = new THREE.DirectionalLight('white', 2);
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
		createBoxObject(
			1, 1, 1, 1, pos, quat,
			new THREE.MeshPhongMaterial({color: Math.floor(Math.random() * 0xffffff)}),
			toyGeometry
		);
	}
}

function Mechanism() {
	const r = settings.ballRadius;
	const L = settings.ropeLength;
	const maxY = MACHINE_SIZE - 1;

	// Arm hangs above the ball; the ball starts a little above the floor.
	const armY = Math.min(L + 2 * r + 1.5, maxY);
	pos.set(0, armY, 0);
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

	// Ball (hangs below the arm: arm bottom - rope length - radius)
	const ballY = Math.max(r, armY - 0.5 - L - r);
	pos.set(0, ballY, 0);
	quat.set(0, 0, 0, 1);

	const ball = new THREE.Mesh(
		new THREE.SphereGeometry(
			r,
			settings.ballWidthSegments,
			settings.ballHeightSegments
		),
		baseMaterial
	);
	const ballShape = new AmmoLib.btSphereShape(r);
	const ballBody = createRigidBody(ball, ballShape, settings.ballMass, pos, quat);
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

	// Rope soft body. CreateRope's "res" = number of nodes BETWEEN the ends,
	// so segments - 1 gives exactly segments + 1 nodes (matches the geometry).
	const helpers = new AmmoLib.btSoftBodyHelpers();
	const ropeStart = new AmmoLib.btVector3(0, ropeStartY, 0);
	const ropeEnd = new AmmoLib.btVector3(0, ropeEndY, 0);

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

	allMeshes.push(rope);
	Scene.add(rope);
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
	arm = null;
	armBody = null;
	rope = null;
	ropeSoftBody = null;
	ropeNodes = null;
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
// Simulation
// ---------------------------------------------------------------------------
function moveArm(deltaTime) {
	if (!armBody) return;
	if (movement.x === 0 && movement.y === 0 && movement.z === 0) return;

	const length = Math.hypot(movement.x, movement.y, movement.z);
	const scale = (length > 1 ? 1 / length : 1) * settings.moveSpeed * deltaTime;

	const current = armBody.getWorldTransform().getOrigin();
	const limit = MACHINE_SIZE / 2 - 0.8;

	const x = THREE.MathUtils.clamp(current.x() + movement.x * scale, -limit, limit);
	const y = THREE.MathUtils.clamp(current.y() + movement.y * scale, 1, MACHINE_SIZE - 1);
	const z = THREE.MathUtils.clamp(current.z() + movement.z * scale, -limit, limit);

	armPosition.setValue(x, y, z);
	armTransform.setIdentity();
	armTransform.setOrigin(armPosition);

	armBody.setWorldTransform(armTransform);
	const motionState = armBody.getMotionState();
	if (motionState) motionState.setWorldTransform(armTransform);

	arm.position.set(x, y, z);
}

function syncGraphics() {
	if (rope && ropeNodes) {
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