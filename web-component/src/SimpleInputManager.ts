/**
 * SimpleInputManager - Canvas-scoped input handling with pointer lock support
 * 
 * A simplified version of noclip's InputManager that only binds to the component's
 * canvas rather than the document, suitable for use within a web component.
 */

export class SimpleInputManager {
    // Mouse state
    public mouseX = 0;
    public mouseY = 0;
    public dx = 0;
    public dy = 0;
    public dz = 0;  // scroll wheel
    public buttons = 0;

    // Keyboard state
    private keysDown = new Map<string, boolean>();

    // Pointer lock state
    private isPointerLocked = false;
    private readonly canvas: HTMLCanvasElement;

    // Touch state
    private touchStartX = 0;
    private touchStartY = 0;
    private lastTouchX = 0;
    private lastTouchY = 0;
    private isTouching = false;
    private touchId: number | null = null;

    // Settings
    public invertX = false;
    public invertY = false;

    constructor(canvas: HTMLCanvasElement) {
        this.canvas = canvas;
        this.setupEventListeners();
    }

    private setupEventListeners(): void {
        // Make canvas focusable
        this.canvas.tabIndex = 0;

        // Mouse events
        this.canvas.addEventListener('mousedown', this.onMouseDown);
        this.canvas.addEventListener('mouseup', this.onMouseUp);
        this.canvas.addEventListener('mousemove', this.onMouseMove);
        this.canvas.addEventListener('wheel', this.onWheel, { passive: false });
        this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());

        // Pointer lock
        document.addEventListener('pointerlockchange', this.onPointerLockChange);
        document.addEventListener('pointerlockerror', this.onPointerLockError);

        // Keyboard events (on canvas when focused)
        this.canvas.addEventListener('keydown', this.onKeyDown);
        this.canvas.addEventListener('keyup', this.onKeyUp);
        this.canvas.addEventListener('blur', this.onBlur);

        // Touch events
        this.canvas.addEventListener('touchstart', this.onTouchStart, { passive: false });
        this.canvas.addEventListener('touchmove', this.onTouchMove, { passive: false });
        this.canvas.addEventListener('touchend', this.onTouchEnd);
        this.canvas.addEventListener('touchcancel', this.onTouchEnd);
    }

    // --- Mouse Handlers ---

    private onMouseDown = (e: MouseEvent): void => {
        e.preventDefault();
        this.canvas.focus();
        this.buttons = e.buttons;

        // Request pointer lock on left click for FPS controls
        if (e.button === 0 && !this.isPointerLocked) {
            this.canvas.requestPointerLock();
        }
    };

    private onMouseUp = (e: MouseEvent): void => {
        this.buttons = e.buttons;
    };

    private onMouseMove = (e: MouseEvent): void => {
        if (this.isPointerLocked) {
            this.dx += e.movementX;
            this.dy += e.movementY;
        } else {
            this.mouseX = e.offsetX;
            this.mouseY = e.offsetY;
        }
    };

    private onWheel = (e: WheelEvent): void => {
        e.preventDefault();
        this.dz += Math.sign(e.deltaY) * -1;
    };

    // --- Pointer Lock Handlers ---

    private onPointerLockChange = (): void => {
        this.isPointerLocked = document.pointerLockElement === this.canvas;
        if (!this.isPointerLocked) {
            // Reset deltas when exiting pointer lock
            this.dx = 0;
            this.dy = 0;
        }
    };

    private onPointerLockError = (): void => {
        console.warn('Pointer lock failed');
        this.isPointerLocked = false;
    };

    // --- Keyboard Handlers ---

    private onKeyDown = (e: KeyboardEvent): void => {
        // Don't interfere with browser shortcuts
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        
        e.preventDefault();
        this.keysDown.set(e.code, true);
    };

    private onKeyUp = (e: KeyboardEvent): void => {
        this.keysDown.delete(e.code);
    };

    private onBlur = (): void => {
        this.keysDown.clear();
        this.buttons = 0;
    };

    // --- Touch Handlers ---

    private onTouchStart = (e: TouchEvent): void => {
        if (this.isTouching) return;
        
        e.preventDefault();
        this.canvas.focus();
        
        const touch = e.touches[0];
        this.touchId = touch.identifier;
        this.touchStartX = touch.clientX;
        this.touchStartY = touch.clientY;
        this.lastTouchX = touch.clientX;
        this.lastTouchY = touch.clientY;
        this.isTouching = true;
    };

    private onTouchMove = (e: TouchEvent): void => {
        if (!this.isTouching) return;

        const touch = Array.from(e.touches).find(t => t.identifier === this.touchId);
        if (!touch) return;

        e.preventDefault();
        
        this.dx += touch.clientX - this.lastTouchX;
        this.dy += touch.clientY - this.lastTouchY;
        this.lastTouchX = touch.clientX;
        this.lastTouchY = touch.clientY;
    };

    private onTouchEnd = (): void => {
        this.isTouching = false;
        this.touchId = null;
    };

    // --- Public API ---

    /**
     * Check if a key is currently pressed
     */
    isKeyDown(code: string): boolean {
        return this.keysDown.has(code);
    }

    /**
     * Check if the canvas has pointer lock
     */
    hasPointerLock(): boolean {
        return this.isPointerLocked;
    }

    /**
     * Check if currently dragging (touch or mouse with button held)
     */
    isDragging(): boolean {
        return this.isTouching || this.isPointerLocked;
    }

    /**
     * Get mouse delta X with inversion applied
     */
    getMouseDeltaX(): number {
        return this.invertX ? -this.dx : this.dx;
    }

    /**
     * Get mouse delta Y with inversion applied
     */
    getMouseDeltaY(): number {
        return this.invertY ? -this.dy : this.dy;
    }

    /**
     * Reset per-frame deltas - call at end of each frame
     */
    resetDeltas(): void {
        this.dx = 0;
        this.dy = 0;
        this.dz = 0;
    }

    /**
     * Request pointer lock (for external use)
     */
    requestPointerLock(): void {
        if (!this.isPointerLocked) {
            this.canvas.requestPointerLock();
        }
    }

    /**
     * Exit pointer lock
     */
    exitPointerLock(): void {
        if (this.isPointerLocked) {
            document.exitPointerLock();
        }
    }

    /**
     * Clean up event listeners
     */
    destroy(): void {
        this.canvas.removeEventListener('mousedown', this.onMouseDown);
        this.canvas.removeEventListener('mouseup', this.onMouseUp);
        this.canvas.removeEventListener('mousemove', this.onMouseMove);
        this.canvas.removeEventListener('wheel', this.onWheel);
        this.canvas.removeEventListener('keydown', this.onKeyDown);
        this.canvas.removeEventListener('keyup', this.onKeyUp);
        this.canvas.removeEventListener('blur', this.onBlur);
        this.canvas.removeEventListener('touchstart', this.onTouchStart);
        this.canvas.removeEventListener('touchmove', this.onTouchMove);
        this.canvas.removeEventListener('touchend', this.onTouchEnd);
        this.canvas.removeEventListener('touchcancel', this.onTouchEnd);
        document.removeEventListener('pointerlockchange', this.onPointerLockChange);
        document.removeEventListener('pointerlockerror', this.onPointerLockError);
        
        if (this.isPointerLocked) {
            document.exitPointerLock();
        }
    }
}

