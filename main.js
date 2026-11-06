import * as THREE from 'three';
import {PerspectiveCamera} from 'three';
import Ammo from 'ammojs-typed';
import {OrbitControls} from 'three/addons/controls/OrbitControls.js';
const graphContent = document.getElementById('graphics');
const AmmoLib = await Ammo.call({});
const timer = new THREE.Timer();

const Camera = new PerspectiveCamera(
	90, window.innerWidth / window.innerHeight, 0.1, 300
);
const Renderer = new THREE.WebGLRenderer({
	antialias: false
});

const Scene = new THREE.Scene();

const CubeLoader = new THREE.CubeTextureLoader();
const TextureLoader = new THREE.TextureLoader();

const baseMaterial = new THREE.MeshPhongMaterial({color: 0xffffff});
const ropeMaterial = new THREE.LineBasicMaterial({color: 0x000000});

const gravityConstant = -9.8;
const movement = {x: 0, y: 0, z: 0};
let controls;
let initialized = false;

let arm;
let armBody;
let armTransform = new AmmoLib.btTransform();
let armPosition = new AmmoLib.btVector3(0, 0, 0);
let ball;
const rigidBodies = [];
const physicsBodies = [];
const softBodies = [];
const objectMeshes = [];

const pos = new THREE.Vector3();
const quat = new THREE.Quaternion();

let ground;
let grape;
let rope;
let body;

let physicsWorld;
let collisionConfiguration;
let dispatcher;
let broadphase;
let solver;
let softBodySolver;

const settings = {
	ballRadius: 1,
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

function r (){
	return Math.floor(Math.random()*51);
}
function log(t){
	const label = document.getElementById("logger");
	label.innerHTML += `${t}<br>`;
}
function Recorder() {
	// let x = r();
	// let y = r();
	// let z = r();
	// log("x"+x+"y"+y+"z"+z);
	Camera.position.set(1,5,10);
	controls = new OrbitControls(Camera, Renderer.domElement);
	controls.target.set(1, 3, 1);
	controls.update();
}
function onWindowResize() {
	Camera.aspect = window.innerWidth / window.innerHeight;
	Camera.updateProjectionMatrix();
	Renderer.setSize(window.innerWidth, window.innerHeight);
}
function initGraphics() {
	if (!graphContent) return;
	Recorder();
	Scene.add(new THREE.AmbientLight("white", 10));

	const light = new THREE.DirectionalLight("white", 10);
	light.position.set(0, 10, 0);
	Scene.add(light);

	Scene.background = CubeLoader.load([
		'images/shortcut.png',
		'images/banco.png',
		'images/ceu.png',
		'images/piso.png',
		'images/sol.png',
		'images/way.png',
	]);

	Renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
	Renderer.setSize(window.innerWidth, window.innerHeight);
	graphContent.appendChild(Renderer.domElement);
	Renderer.setAnimationLoop(animate);
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

	window.addEventListener('resize', onWindowResize);
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
	Machine();
	Toys();
	Mechanism();
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
		.getCollisionShape();

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

function Mechanism() {
	pos.set(1, 8, 1);
	quat.set(0, 0, 0, 1);
	arm = createBoxObject(1, 1, 1, 0, pos, quat, baseMaterial);
	arm.castShadow = false;
	arm.receiveShadow = false;

	armBody = arm.userData.physicsBody;
	armBody.setCollisionFlags(armBody.getCollisionFlags() | 2); // kinematic
	armBody.setActivationState(4);
	armTransform = new AmmoLib.btTransform();
	armPosition = new AmmoLib.btVector3(0, 0, 0);

	Grape();
}


const toys = new Map();
const quantity = 30;
function Toys() {
	for (let i = 0; i < quantity; i++) {
		pos.set(0,5,0);
		const toy = createBoxObject(
			1,1,1,1, pos, quat,
			RandomColorMaterial()
		);
		toys.set(i, toy);
	}
}

function Machine() {
	const thickness = .02;
	const length = 10;
	pos.set(0, 0, 0);
	quat.set(0, 0, 0, 1);

	const matGlass = new THREE.MeshPhongMaterial({
		color: "grey",
		transparent: true,
		opacity: .3,
	});

	pos.set(0, -thickness, -1);
	ground = createBoxObject(
		length, thickness, length-2, 0,
		pos, quat, matGlass);

	pos.set(-length / 2, length / 2, 0);
	ground.attach(createBoxObject(thickness, length, length, 0,
		pos, quat, matGlass));

	pos.set(length / 2, length / 2, 0);
	quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -Math.PI);
	ground.attach(createBoxObject(thickness, length, length, 0,
		pos, quat, matGlass));

	pos.set(0, length, 0);
	ground.attach(createBoxObject(length, thickness, length, 0,
		pos, quat,
		matGlass));

	pos.set(0, length / 2, -length / 2)
	ground.attach(createBoxObject(length, length, thickness, 0,
		pos, quat,
		matGlass));

	pos.set(0, length / 2, length / 2)
	ground.attach(createBoxObject(-length, -length, thickness, 0,
		pos, quat,
		matGlass));

	// setTexture(ground);
}

function createSphereObject(sx, sy, sz, mass, pos, quat, material) {

	const threeObject = new THREE.Mesh(
		new THREE.Sphere(sx, sy, sz), material
	);
	Scene.add(threeObject);

	const physicsShape = new AmmoLib.btBoxShape(
		new AmmoLib.btVector3(sx*0.5, sy*0.5, sz*0.5));

	threeObject.position.copy(pos);
	threeObject.quaternion.copy(quat);

	const transform = new AmmoLib.btTransform();
	transform.setIdentity();

	const origin = new AmmoLib.btVector3(pos.x, pos.y, pos.z);
	transform.setOrigin(origin);

	const rotation = new AmmoLib.btQuaternion(quat.x, quat.y, quat.z, quat.w);
	transform.setRotation(rotation);

	const localInertia = new AmmoLib.btVector3(0,0,0);
	physicsShape.calculateLocalInertia(mass, localInertia);

	const motionState = new AmmoLib.btDefaultMotionState(transform);
	const rbInfo = new AmmoLib.btRigidBodyConstructionInfo(
		mass, motionState, physicsShape, localInertia
	);
	body = new AmmoLib.btRigidBody(rbInfo);

	objectMeshes.push(threeObject);
	physicsBodies.push(body);
	physicsWorld.addRigidBody(body);
	threeObject.userData.physicsBody = body;
	if (mass > 0) rigidBodies.push(threeObject);

	return threeObject;
}

function createBoxObject(sx, sy, sz, mass, pos, quat, material) {
	const threeObject = new THREE.Mesh(
		new THREE.BoxGeometry(sx, sy, sz), material
	);
	Scene.add(threeObject);

	const physicsShape = new AmmoLib.btBoxShape(
		new AmmoLib.btVector3(sx*0.5, sy*0.5, sz*0.5));

	threeObject.position.copy(pos);
	threeObject.quaternion.copy(quat);

	const transform = new AmmoLib.btTransform();
	transform.setIdentity();

	const origin = new AmmoLib.btVector3(pos.x, pos.y, pos.z);
	transform.setOrigin(origin);

	const rotation = new AmmoLib.btQuaternion(quat.x, quat.y, quat.z, quat.w);
	transform.setRotation(rotation);

	const localInertia = new AmmoLib.btVector3(0,0,0);
	physicsShape.calculateLocalInertia(mass, localInertia);

	const motionState = new AmmoLib.btDefaultMotionState(transform);
	const rbInfo = new AmmoLib.btRigidBodyConstructionInfo(
		mass, motionState, physicsShape, localInertia
	);
	body = new AmmoLib.btRigidBody(rbInfo);

	objectMeshes.push(threeObject);
	physicsBodies.push(body);
	physicsWorld.addRigidBody(body);
	threeObject.userData.physicsBody = body;
	if (mass > 0) rigidBodies.push(threeObject);

	return threeObject;
}

function RandomColorMaterial() {
	return new THREE.MeshPhongMaterial({color: Math.floor(Math.random() * (1 << 24))});
}

// function setTexture(object) {
// 	TextureLoader.load('textures/grid.png', (texture) => {
// 		texture.colorSpace = THREE.SRGBColorSpace;
// 		texture.wrapS = THREE.RepeatWrapping;
// 		texture.wrapT = THREE.RepeatWrapping;
// 		texture.repeat.set(10, 10);
// 		object.material.map = texture;
// 		object.material.needsUpdate = true;
// 	});
// }

function updatePhysics(deltaTime) {
	physicsWorld.stepSimulation(deltaTime, 1);
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

		const transformAux1 = new AmmoLib.btTransform();
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
		alert(initialized);
}

function updateObjects() {
	for (const body of physicsBodies) {
		physicsWorld.removeRigidBody(body);
	}

	for (const body of softBodies) {
		physicsWorld.removeSoftBody(body);
	}

	for (const mesh of objectMeshes) {
		Scene.remove(mesh);
		mesh.geometry.dispose();

		if (mesh.material !== baseMaterial) {
			if (Array.isArray(mesh.material)) {
				mesh.material.forEach((material) => material.dispose());
			} else {
				mesh.material.dispose();
			}
		}
	}

	physicsBodies.length = 0;
	softBodies.length = 0;
	objectMeshes.length = 0;
	rigidBodies.length = 0;
	arm = null;
	armBody = null;
	rope = null;
	init();
}

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
	const container = document.getElementById("slider");
	if (!container) return;
	container.replaceChildren();
	for (const [id, defaultValue = "0"] of Object.entries(settings)) {
		const range = sliderRanges[id] ?? {min: 0, max: 100, step: 1};
		const wrapper = document.createElement("div");
		wrapper.style.scale = .7;
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
			updateObjects();
		});
		wrapper.append(label, document.createElement("br"),
			slider, output);
		container.appendChild(wrapper);
	}
}

function init() {
	try {
		initPhysics();
		initInput();
		initObjects();
		initGraphics();
		initSettingsControls();
		initialized = true;
	} catch (e) {
		alert(e)
	}
}

init();