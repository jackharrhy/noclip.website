/**
 * SimpleCameraController - FPS-style camera controller for the web component
 * 
 * Adapted from noclip's FPSCameraController, simplified to work with SimpleInputManager
 * and without noclip-specific dependencies.
 */

import { mat4, vec3 } from 'gl-matrix';
import { SimpleInputManager } from './SimpleInputManager.js';

// Constants
const FPS = 60;
const Vec3Zero = vec3.fromValues(0, 0, 0);
const Vec3UnitX = vec3.fromValues(1, 0, 0);
const Vec3UnitY = vec3.fromValues(0, 1, 0);
const Vec3UnitZ = vec3.fromValues(0, 0, 1);

// Scratch vectors for calculations
const scratchVec3a = vec3.create();
const scratchVec3b = vec3.create();

function clampRange(v: number, lim: number): number {
    return Math.max(-lim, Math.min(v, lim));
}

function getMatrixAxisY(dst: vec3, m: mat4): void {
    vec3.set(dst, m[4], m[5], m[6]);
}

/**
 * Simple camera interface matching MapRenderer's SimpleCamera
 */
interface Camera {
    worldMatrix: mat4;
    viewMatrix: mat4;
}

export class SimpleCameraController {
    private keyMovement = vec3.create();
    private mouseMovement = vec3.create();

    // Movement settings
    private keyMoveSpeed = 60;
    private keyMoveShiftMult = 5;
    private keyMoveVelocityMult = 1 / 5;
    private keyMoveDrag = 0.8;

    // Mouse look settings
    private mouseLookSpeed = 500;
    private mouseLookDragFast = 0;
    private mouseLookDragSlow = 0;

    // Scene scale multiplier (for different map scales)
    public sceneMoveSpeedMult = 4 / 60;  // Default for idtech maps

    constructor(private camera: Camera) {}

    /**
     * Set movement speed multiplier for scene scale
     */
    setSceneMoveSpeedMult(v: number): void {
        this.sceneMoveSpeedMult = v;
    }

    /**
     * Set base movement speed
     */
    setKeyMoveSpeed(speed: number): void {
        this.keyMoveSpeed = speed;
    }

    /**
     * Update camera from input - returns true if camera changed
     */
    update(inputManager: SimpleInputManager, dt: number): boolean {
        const camera = this.camera;
        let updated = false;

        // Ensure minimum speed
        this.keyMoveSpeed = Math.max(this.keyMoveSpeed, 1);

        const isShiftPressed = inputManager.isKeyDown('ShiftLeft') || inputManager.isKeyDown('ShiftRight');
        const keyMoveMult = isShiftPressed ? this.keyMoveShiftMult : 1;
        const keyMoveSpeedCap = this.keyMoveSpeed * keyMoveMult;
        const keyMoveVelocity = keyMoveSpeedCap * this.keyMoveVelocityMult;

        const keyMovement = this.keyMovement;
        const keyMoveLowSpeedCap = 0.1;

        // Forward/backward
        if (inputManager.isKeyDown('KeyW') || inputManager.isKeyDown('ArrowUp')) {
            keyMovement[2] = clampRange(keyMovement[2] - keyMoveVelocity, keyMoveSpeedCap);
        } else if (inputManager.isKeyDown('KeyS') || inputManager.isKeyDown('ArrowDown')) {
            keyMovement[2] = clampRange(keyMovement[2] + keyMoveVelocity, keyMoveSpeedCap);
        } else if (Math.abs(keyMovement[2]) >= keyMoveLowSpeedCap) {
            keyMovement[2] *= this.keyMoveDrag;
            if (Math.abs(keyMovement[2]) < keyMoveLowSpeedCap) keyMovement[2] = 0.0;
        }

        // Strafe left/right
        if (inputManager.isKeyDown('KeyA') || inputManager.isKeyDown('ArrowLeft')) {
            keyMovement[0] = clampRange(keyMovement[0] - keyMoveVelocity, keyMoveSpeedCap);
        } else if (inputManager.isKeyDown('KeyD') || inputManager.isKeyDown('ArrowRight')) {
            keyMovement[0] = clampRange(keyMovement[0] + keyMoveVelocity, keyMoveSpeedCap);
        } else if (Math.abs(keyMovement[0]) >= keyMoveLowSpeedCap) {
            keyMovement[0] *= this.keyMoveDrag;
            if (Math.abs(keyMovement[0]) < keyMoveLowSpeedCap) keyMovement[0] = 0.0;
        }

        // Up/down (Q/E or Space/C)
        if (inputManager.isKeyDown('KeyQ') || inputManager.isKeyDown('PageDown') || inputManager.isKeyDown('KeyC')) {
            keyMovement[1] = clampRange(keyMovement[1] - keyMoveVelocity, keyMoveSpeedCap);
        } else if (inputManager.isKeyDown('KeyE') || inputManager.isKeyDown('PageUp') || inputManager.isKeyDown('Space')) {
            keyMovement[1] = clampRange(keyMovement[1] + keyMoveVelocity, keyMoveSpeedCap);
        } else if (Math.abs(keyMovement[1]) >= keyMoveLowSpeedCap) {
            keyMovement[1] *= this.keyMoveDrag;
            if (Math.abs(keyMovement[1]) < keyMoveLowSpeedCap) keyMovement[1] = 0.0;
        }

        // Get view vectors
        const viewUp = scratchVec3a;
        getMatrixAxisY(viewUp, camera.viewMatrix);

        const viewRight = Vec3UnitX;
        const viewForward = Vec3UnitZ;

        // Apply movement
        if (!vec3.exactEquals(keyMovement, Vec3Zero)) {
            const finalMovement = scratchVec3b;
            vec3.zero(finalMovement);

            vec3.scaleAndAdd(finalMovement, finalMovement, viewRight, keyMovement[0]);
            vec3.scaleAndAdd(finalMovement, finalMovement, viewForward, keyMovement[2]);
            vec3.scaleAndAdd(finalMovement, finalMovement, viewUp, keyMovement[1]);

            vec3.scale(finalMovement, finalMovement, this.sceneMoveSpeedMult * (dt / FPS));

            mat4.translate(camera.worldMatrix, camera.worldMatrix, finalMovement);
            updated = true;
        }

        // Mouse look
        const mouseMoveLowSpeedCap = 0.0001;
        const dx = inputManager.getMouseDeltaX() * (-1 / this.mouseLookSpeed);
        const dy = inputManager.getMouseDeltaY() * (-1 / this.mouseLookSpeed);

        const mouseMovement = this.mouseMovement;
        mouseMovement[0] += dx;
        mouseMovement[1] += dy;

        if (!vec3.exactEquals(this.mouseMovement, Vec3Zero)) {
            mat4.rotate(camera.worldMatrix, camera.worldMatrix, this.mouseMovement[0], viewUp);
            mat4.rotate(camera.worldMatrix, camera.worldMatrix, this.mouseMovement[1], Vec3UnitX);
            updated = true;

            const mouseLookDrag = inputManager.isDragging() ? this.mouseLookDragFast : this.mouseLookDragSlow;
            vec3.scale(this.mouseMovement, this.mouseMovement, mouseLookDrag);

            if (Math.abs(this.mouseMovement[0]) < mouseMoveLowSpeedCap) this.mouseMovement[0] = 0.0;
            if (Math.abs(this.mouseMovement[1]) < mouseMoveLowSpeedCap) this.mouseMovement[1] = 0.0;
        }

        // Handle scroll wheel for speed adjustment
        if (inputManager.dz !== 0) {
            this.keyMoveSpeed = Math.max(1, this.keyMoveSpeed + inputManager.dz * 10);
        }

        return updated;
    }

    /**
     * Reset movement state
     */
    reset(): void {
        vec3.zero(this.keyMovement);
        vec3.zero(this.mouseMovement);
    }
}

