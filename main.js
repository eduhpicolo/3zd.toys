import * as THREE from 'three';
import Ammo from 'ammojs-typed';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';

const AmmoLib = await Ammo.call({});
const timer = new THREE.Timer();

const Camera = new THREE.PerspectiveCamera(
	50, window.innerWidth / window.innerHeight, 0.1, 200
);
const Renderer = new THREE.WebGLRenderer({
	antialias: false
});

const Scene = new THREE.Scene();

const CubeLoader = new THREE.CubeTextureLoader();
const TextureLoader = new THREE.TextureLoader();

const baseMaterial = new THREE.MeshPhongMaterial({color: 0x606060});
const ropeMaterial = new THREE.LineBasicMaterial({color: 0x000000});

const gravityConstant = -9.8;
const movement = {x: 0, y: 0, z: 0};
const transformAux1 = new AmmoLib.btTransform();

const graphContent = document.getElementById('graphics');
let controls;
let initialized = false;

let arm;
let armBody;
let armPosition;
let armTransform;

const rigidBodies = [];
const physicsBodies = [];
const softBodies = [];
const objectMeshes = [];

const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();

let ground;
let ball;
let rope;
let body;

let physicsWorld;
let collisionConfiguration;
let dispatcher;
let broadphase;
let solver;
let softBodySolver;

const settings = {
	ballRadius: 2,
	ballWidthSegments: 5,
	ballHeightSegments: 5,
	ballMass: 1,
	ballFriction: 1,
	ropeSegmentsCount: 3,
	ropeLength: 3,
	ropeElastic: 1,
	moveSpeed: 1,
	influence: 1,
};

function initGraphics() {
	if (!graphContent) return;

	Camera.position.set(0, 5, 10);

	Scene.add(new THREE.AmbientLight(0xbbbbbb));

	const light = new THREE.DirectionalLight(0xffffff, 3);
	light.position.set(-10, 10, 5);
	light.castShadow = false;
	Scene.add(light);

	Scene.background = CubeLoader.load([
		'images/00.png',
		'images/00.png',
		'images/00.png',
		'images/00.png',
		'images/00.png',
		'images/0.png',
	]);

	Renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	Renderer.setSize(window.innerWidth, window.innerHeight);
	graphContent.appendChild(Renderer.domElement);
	Renderer.setAnimationLoop(animate);

	controls = new OrbitControls(Camera, Renderer.domElement);
	controls.target.set(0, 5, 0);
	controls.update();

	window.addEventListener('resize', onWindowResize);
}

function initPhysics() {
	collisionConfiguration =
		new AmmoLib.btSoftBodyRigidBodyCollisionConfiguration();

	dispatcher = new AmmoLib.btCollisionDispatcher(collisionConfiguration);
	broadphase = new AmmoLib.btDbvtBroadphase();
	solver = new AmmoLib.btSequentialImpulseConstraintSolver();
	softBodySolver = new AmmoLib.btDefaultSoftBodySolver();

	physicsWorld = new AmmoLib.btSoftRigidDynamicsWorld(
		dispatcher,
		broadphase,
		solver,
		collisionConfiguration,
		softBodySolver
	);

	physicsWorld.setGravity(new AmmoLib.btVector3(0, gravityConstant, 0));
	physicsWorld.getWorldInfo().set_m_gravity(new AmmoLib.btVector3(0, gravityConstant, 0));
}

function initInput() {

	let horizontalKey = null;
	let verticalKey = null;

	function updateMovement() {
		movement.x = 0;
		movement.y = 0;
		movement.z = 0;

		switch (horizontalKey) {
			case 'KeyA':
				movement.x = -1;
				break;
			case 'KeyD':
				movement.x = 1;
				break;
			case 'KeyW':
				movement.z = -1;
				break;
			case 'KeyS':
				movement.z = 1;
				break;
		}

		switch (verticalKey) {
			case 'KeyR':
				movement.y = 1;
				break;
			case 'KeyF':
				movement.y = -1;
				break;
		}
	}

	window.addEventListener('keydown', (event) => {
		switch (event.code) {
			case 'KeyA':
			case 'KeyD':
			case 'KeyW':
			case 'KeyS':
				event.preventDefault();
				horizontalKey = event.code;
				updateMovement();
				break;

			case 'KeyR':
			case 'KeyF':
				event.preventDefault();
				verticalKey = event.code;
				updateMovement();
				break;
		}
	});

	window.addEventListener('keyup', (event) => {
		if (event.code === horizontalKey) {
			horizontalKey = null;
			updateMovement();
		}

		if (event.code === verticalKey) {
			verticalKey = null;
			updateMovement();
		}
	});

	window.addEventListener('blur', () => {
		horizontalKey = null;
		verticalKey = null;
		updateMovement();
	});
}

function initObjects() {
	pos.set(0, 0, 0);
	quat.set(0, 0, 0, 1);

	Machine();
	// Mechanism(-4, 9, -4);
	// Toys(0, 5, -5);
	// Toys(0, 5, -5);
	// Toys(0, 5, -5);
}

function Grape() {
	const sphere = {
		radius: 1,
		widthSegments: 32,
		heightSegments: 16,
		phiStart: 0,
		phiLength: Math.PI,
		thetaStart: 0,
		thetaLength: Math.PI
	};
	pos.set(0, 5, 0);
	ball = new THREE.Mesh(
		new THREE.SphereGeometry(sphere.radius, sphere.widthSegments, sphere.heightSegments),
		baseMaterial
	);
	const ballShape = new AmmoLib.btSphereShape(sphere.ballRadius);
	ballShape.setMargin(0);
	createRigidBody(ball, ballShape, settings.ballMass, pos, quat);
	ball.userData.physicsBody.setFriction(settings.ballFriction);
	ball.userData.physicsBody.setActivationState(4);

	const ropePos = ball.position.clone();
	ropePos.y += settings.ballRadius;
	const ropeGeometryTop = ropePos.y + settings.ropeLength;
	const segmentLength = settings.ropeLength / settings.ropeSegmentsCount;

	const ropeIndices = [];
	const ropePositions = [];

	for (let i = 0; i <= settings.ropeSegmentsCount; i++)
		ropePositions.push(ropePos.x, ropePos.y + i * segmentLength, ropePos.z);

	for (let i = 0; i < settings.ropeSegmentsCount; i++)
		ropeIndices.push(i, i + 1);

	const ropeGeometry = new THREE.BufferGeometry();
	ropeGeometry.setIndex(new THREE.BufferAttribute(new Uint16Array(ropeIndices), 1));
	ropeGeometry.setAttribute('position',
		new THREE.BufferAttribute(new Float32Array(ropePositions), 3)
	);
	ropeGeometry.computeBoundingSphere();
	rope = new THREE.LineSegments(ropeGeometry, ropeMaterial);
	rope.frustumCulled = false;

	const softBodyHelpers = new AmmoLib.btSoftBodyHelpers();

	const ropeStart = new AmmoLib.btVector3(
		ropePos.x,
		ropePos.y,
		ropePos.z
	);
	const ropeEnd = new AmmoLib.btVector3(
		ropePos.x,
		ropeGeometryTop,
		ropePos.z
	);

	const ropeSoftBody = softBodyHelpers.CreateRope(
		physicsWorld.getWorldInfo(),
		ropeStart,
		ropeEnd,
		settings.ropeSegmentsCount,
		0
	);

	const sbConfig = ropeSoftBody.get_m_cfg();
	sbConfig.set_viterations(10);
	sbConfig.set_piterations(10);

	ropeSoftBody.setTotalMass(settings.ropeElastic, false);

	AmmoLib.castObject(ropeSoftBody, AmmoLib.btCollisionObject)
		.getCollisionShape()
		.setMargin(0);

	physicsWorld.addSoftBody(ropeSoftBody, 1, -1);

	rope.userData.physicsBody = ropeSoftBody;
	ropeSoftBody.setActivationState(4);
	softBodies.push(ropeSoftBody);

	ropeSoftBody.appendAnchor(
		0,
		ball.userData.physicsBody,
		true,
		settings.influence
	);
	ropeSoftBody.appendAnchor(
		settings.ropeSegmentsCount,
		armBody,
		true,
		settings.influence
	);

	AmmoLib.destroy(ropeStart);
	AmmoLib.destroy(ropeEnd);

	objectMeshes.push(rope);
	Scene.add(rope);
}

function Mechanism(x, y, z) {
	pos.set(x, y, z);

	arm = createBoxObject(.1, .1, .1, 0, pos, quat, baseMaterial);
	arm.castShadow = false;
	arm.receiveShadow = false;

	armBody = arm.userData.physicsBody;
	armBody.setCollisionFlags(armBody.getCollisionFlags() | 2); // kinematic
	armBody.setActivationState(4);
	armTransform = new AmmoLib.btTransform();
	armPosition = new AmmoLib.btVector3(0, 0, 0);

	Grape();
}

function Toys(x, y, z) {
	pos.set(x, y, z);
	const brickMass = 1;
	const brickLength = 1;
	const brickDepth = 1;
	const brickHeight = 1;
	const numBricksLength = 5;
	const numBricksHeight = 2;
	const z0 = -numBricksLength * brickLength;
	for (let j = 0; j < numBricksHeight; j++) {
		const oddRow = j % 2 === 1;
		pos.z = oddRow ? z0 - 0.25 * brickLength : z0;
		pos.y = y + j * brickHeight;
		const rowLength = oddRow ? numBricksLength + 1 : numBricksLength;
		for (let i = 0; i < rowLength; i++) {
			let currentLength = brickLength;
			let currentMass = brickMass;

			if (oddRow && (i === 0 || i === rowLength - 1)) {
				currentLength *= 0.5;
				currentMass *= 0.5;
			}

			const brick = createBoxObject(
				brickDepth,
				brickHeight,
				currentLength,
				currentMass,
				pos,
				quat,
				RandomColorMaterial()
			);

			brick.castShadow = false;
			brick.receiveShadow = false;

			if (oddRow && (i === 0 || i === rowLength - 2)) {
				pos.z += 0.75 * brickLength;
			} else {
				pos.z += brickLength;
			}
		}
	}
}

function Machine() {
	const thickness = 0.1;
	const length = 10;

	pos.set(0, -thickness, 0);
	const base = createBoxObject(
		length / 2, thickness, length / 2, 0,
		pos, quat, baseMaterial);
	base.castShadow = false;
	base.receiveShadow = false;

	// pos.set(0, -thickness / 2, 0);
	// ground = createBoxObject(length, thickness, length, 0,
	// 	pos, 0,
	// 	new THREE.MeshPhongMaterial({ color: 0xffffff,  })
	// );
	// ground.castShadow = false;
	// ground.receiveShadow = false;

	// const matGlass = new THREE.MeshPhongMaterial({
	// 	color: 0xffffff,
	// 	transparent: true,
	// 	opacity: 0.25,
	// });
	//
	// pos.set(-length / 2, length / 2, 0);
	// ground.attach(createBoxObject(thickness, length, length, 0,
	// 	pos,
	// 	matGlass));
	//
	// pos.set(length / 2, length / 2, 0);
	// ground.attach(createBoxObject(thickness, length, length, 0,
	// 	pos, 0,
	// 	matGlass));
	//
	// pos.set(0, length, 0);
	// ground.attach(createBoxObject(length, thickness, length, 0,
	// 	pos, 0,
	// 	matGlass));
	//
	// pos.set(0, length / 2, -length / 2)
	// ground.attach(createBoxObject(length,length, thickness, 0,
	// 	pos, 0,
	// 	matGlass));
	//
	// pos.set(0, length / 2, length / 2)
	// ground.attach(createBoxObject(-length,-length, thickness,		0,
	// 	pos,0,
	// 	matGlass));

	setTexture(ground);
}

function createBoxObject(sx, sy, sz, mass, pos, quat, material) {
	const threeObject = new THREE.Mesh(
		new THREE.BoxGeometry(sx, sy, sz),
		material
	);

	const shape = new AmmoLib.btBoxShape(
		new AmmoLib.btVector3(sx, sy, sz)
	);
	shape.setMargin(.5);

	createRigidBody(threeObject, shape, mass, pos, quat);

	return threeObject;
}

function createRigidBody(threeObject, physicsShape, mass, pos, quat) {
	threeObject.position.copy(pos);
	threeObject.quaternion.copy(quat);

	const transform = new AmmoLib.btTransform();
	transform.setIdentity();
	const origin = new AmmoLib.btVector3(pos.x, pos.y, pos.z);
	const rotation = new AmmoLib.btQuaternion(quat.x, quat.y, quat.z, quat.w);
	transform.setOrigin(origin);
	transform.setRotation(rotation);

	const localInertia = new AmmoLib.btVector3(0, 0, 0);
	physicsShape.calculateLocalInertia(mass, localInertia);

	const motionState = new AmmoLib.btDefaultMotionState(transform);
	const rbInfo = new AmmoLib.btRigidBodyConstructionInfo(
		mass, motionState, physicsShape, localInertia
	);

	body = new AmmoLib.btRigidBody(rbInfo);
	threeObject.userData.physicsBody = body;

	physicsBodies.push(body);
	physicsWorld.addRigidBody(body);
	objectMeshes.push(threeObject);
	if (mass > 0) rigidBodies.push(threeObject);

	AmmoLib.destroy(origin);
	AmmoLib.destroy(rotation);
	AmmoLib.destroy(transform);
	AmmoLib.destroy(localInertia);
	AmmoLib.destroy(rbInfo);

	Scene.add(threeObject);
}

function RandomColorMaterial() {
	return new THREE.MeshPhongMaterial({color: Math.floor(Math.random() * (1 << 24))});
}

function setTexture(object) {
	TextureLoader.load('textures/grid.png', (texture) => {
		texture.colorSpace = THREE.SRGBColorSpace;
		texture.wrapS = THREE.RepeatWrapping;
		texture.wrapT = THREE.RepeatWrapping;
		texture.repeat.set(10, 10);
		object.material.map = texture;
		object.material.needsUpdate = true;
	});
}

function updatePhysics(deltaTime) {
	physicsWorld.stepSimulation(deltaTime, 5);
	if (rope && rope.userData.physicsBody) {
		const softBody = rope.userData.physicsBody;
		const positions = rope.geometry.attributes.position.array;
		const nodes = softBody.get_m_nodes();

		const nodeCount = Math.min(
			positions.length / 3,
			nodes.size()
		);

		for (let i = 0; i < nodeCount; i++) {
			const nodePosition = nodes.at(i).get_m_x();
			const index = i * 3;

			positions[index] = nodePosition.x();
			positions[index + 1] = nodePosition.y();
			positions[index + 2] = nodePosition.z();
		}

		rope.geometry.attributes.position.needsUpdate = true;
	}
	for (const object of rigidBodies) {
		const body = object.userData.physicsBody;
		const motionState = body.getMotionState();

		if (!motionState) continue;

		motionState.getWorldTransform(transformAux1);

		const position = transformAux1.getOrigin();
		const rotation = transformAux1.getRotation();

		object.position.set(position.x(), position.y(), position.z());
		object.quaternion.set(
			rotation.x(),
			rotation.y(),
			rotation.z(),
			rotation.w()
		);
	}
	moveArm();
}

function moveArm(deltaTime) {
	if (!armBody) return;

	if (movement.x === 0 && movement.y === 0 && movement.z === 0) return;

	const length = Math.hypot(movement.x, movement.y, movement.z);
	const scale = length > 1 ? 1 / length : 1;

	const current = armBody.getWorldTransform().getOrigin();

	armPosition.setValue(
		current.x() + movement.x * scale * settings.moveSpeed * deltaTime,
		current.y() + movement.y * scale * settings.moveSpeed * deltaTime,
		current.z() + movement.z * scale * settings.moveSpeed * deltaTime
	);

	armTransform.setIdentity();
	armTransform.setOrigin(armPosition);
	armTransform.setRotation(armBody.getWorldTransform().getRotation());
	armBody.setWorldTransform(armTransform);

	const motionState = armBody.getMotionState();
	if (motionState) {
		motionState.setWorldTransform(armTransform);
	}

	arm.position.set(armPosition.x(), armPosition.y(), armPosition.z());
}

function animate() {
	if (!initialized) return;
	timer.update();
	render();
}

function render() {
	const deltaTime = Math.min(timer.getDelta(), 0.1);
	updatePhysics(deltaTime);
	Renderer.render(Scene, Camera);
	if (!initialized)
		alert(initialized)
}

function onWindowResize() {
	Camera.aspect = window.innerWidth / window.innerHeight;
	Camera.updateProjectionMatrix();
	Renderer.setSize(window.innerWidth, window.innerHeight);
}

// function updateObjects() {
// 	for (const body of physicsBodies) {
// 		physicsWorld.removeRigidBody(body);
// 	}
//
// 	for (const body of softBodies) {
// 		physicsWorld.removeSoftBody(body);
// 	}
//
// 	for (const mesh of objectMeshes) {
// 		scene.remove(mesh);
// 		mesh.geometry.dispose();
//
// 		if (mesh.material !== baseMaterial) {
// 			if (Array.isArray(mesh.material)) {
// 				mesh.material.forEach((material) => material.dispose());
// 			} else {
// 				mesh.material.dispose();
// 			}
// 		}
// 	}
//
// 	physicsBodies.length = 0;
// 	softBodies.length = 0;
// 	objectMeshes.length = 0;
// 	rigidBodies.length = 0;
// 	arm = null;
// 	armBody = null;
// 	rope = null;
// 	createObjects();
// }
const sliderRanges = {
	ballRadius: {min: 0.1, max: 2, step: 0.05},
	ballWidthSegments: {min: 3, max: 20, step: 1},
	ballHeightSegments: {min: 3, max: 20, step: 1},
	ballMass: {min: 0.1, max: 10, step: 0.1},
	ballFriction: {min: 0.1, max: 10, step: 0.1},
	ropeSegmentsCount: {min: 1, max: 10, step: 1},
	ropeLength: {min: 1, max: 10, step: 1},
	ropeElastic: {min: 0.1, max: 10, step: 0.1},
	moveSpeed: {min: 0.1, max: 10, step: 0.1},
	influence: {min: 0.1, max: 10, step: 0.1},
};

function initSettingsControls() {
	const container = document.getElementById("divsliders");
	if (!container) return;
	container.replaceChildren();
	for (const [id, defaultValue = "0"] of Object.entries(settings)) {
		const range = sliderRanges[id] ?? {min: 0, max: 100, step: 1};
		const wrapper = document.createElement("div");
		const label = document.createElement("label");
		label.htmlFor = id;
		label.textContent = id;
		const slider = document.createElement("input");
		slider.id = id;
		slider.type = "range";
		slider.min = range.min;
		slider.max = range.max;
		slider.step = range.step;
		slider.value = defaultValue;
		slider.style.width = "200px";
		const output = document.createElement("span");
		output.textContent = ` ${defaultValue}`;
		slider.addEventListener("input", () => {
			settings[id] = Number(slider.value);
			output.textContent = ` ${slider.value}`;
			// updateObjects();
		});
		wrapper.append(label, document.createElement("br"),
			slider, output);
		container.appendChild(wrapper);
	}
}

function init() {
	try {
		initGraphics();
		initPhysics();
		initObjects();
		initInput();
		initSettingsControls();
		initialized = true;
	} catch (e) {
		alert(e)
	}
}

init();