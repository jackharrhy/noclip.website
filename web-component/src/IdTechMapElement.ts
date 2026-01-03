/**
 * IdTechMapElement - Web component for rendering Quake/Half-Life BSP maps
 * 
 * Usage:
 * <idtech-map
 *   src="maps/e1m1.bsp"
 *   wads="id1/gfx.wad"
 *   palette="id1/palette.lmp"
 *   camera-controls>
 * </idtech-map>
 */

import { LitElement, html, css, PropertyValues } from 'lit';
import { customElement, property, state, query } from 'lit/decorators.js';
import { AssetLoader } from './AssetLoader.js';
import { MapRenderer } from './MapRenderer.js';
import { SimpleInputManager } from './SimpleInputManager.js';
import type { BSPEntity, LoadProgressDetail, CameraState, IdTechMapEventMap } from './types.js';

@customElement('idtech-map')
export class IdTechMapElement extends LitElement {
    // --- Reactive attributes ---
    
    /** URL to the BSP file */
    @property({ type: String })
    src?: string;

    /** Semicolon-separated WAD file URLs */
    @property({ type: String })
    wads?: string;

    /** URL to palette file (Quake only) */
    @property({ type: String })
    palette?: string;

    /** Enable WASD + mouse look controls */
    @property({ type: Boolean, attribute: 'camera-controls' })
    cameraControls = false;

    /** URL to poster image shown while loading */
    @property({ type: String })
    poster?: string;

    /** Loading strategy: eager (default) or lazy */
    @property({ type: String })
    loading: 'eager' | 'lazy' = 'eager';

    /** Disable lightmap rendering (fullbright mode) */
    @property({ type: Boolean, attribute: 'disable-lightmaps' })
    disableLightmaps = false;

    // --- Internal state ---
    
    @state()
    private _loading = false;

    @state()
    private _progress = 0;

    @state()
    private _progressMessage = '';

    @state()
    private _error?: string;

    @state()
    private _ready = false;

    // --- Refs ---
    
    @query('canvas')
    private canvas!: HTMLCanvasElement;

    @query('.container')
    private container!: HTMLDivElement;

    // --- Private fields ---
    
    private assetLoader = new AssetLoader();
    private mapRenderer: MapRenderer | null = null;
    private inputManager: SimpleInputManager | null = null;
    private resizeObserver: ResizeObserver | null = null;
    private intersectionObserver: IntersectionObserver | null = null;
    private hasBeenVisible = false;

    // --- Styles ---
    
    static override styles = css`
        :host {
            display: block;
            position: relative;
            width: 100%;
            height: 400px;
            background: var(--idtech-map-background, #1a1a1a);
            overflow: hidden;
        }

        .container {
            width: 100%;
            height: 100%;
            position: relative;
        }

        canvas {
            width: 100%;
            height: 100%;
            display: block;
        }

        .overlay {
            position: absolute;
            inset: 0;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            pointer-events: none;
        }

        .poster {
            position: absolute;
            inset: 0;
            background-size: cover;
            background-position: center;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-direction: column;
            transition: opacity 0.3s ease-out;
        }

        .poster.hidden {
            opacity: 0;
            pointer-events: none;
        }

        .loading-indicator {
            color: var(--idtech-map-loading-color, #fff);
            font-family: var(--idtech-map-font, system-ui, sans-serif);
            text-align: center;
        }

        .progress-bar {
            width: 200px;
            height: 4px;
            background: rgba(255, 255, 255, 0.2);
            border-radius: 2px;
            margin-top: 12px;
            overflow: hidden;
        }

        .progress-fill {
            height: 100%;
            background: var(--idtech-map-progress-color, #4a9eff);
            transition: width 0.2s ease-out;
        }

        .progress-message {
            margin-top: 8px;
            font-size: 0.875rem;
            opacity: 0.8;
        }

        .error {
            color: var(--idtech-map-error-color, #ff4a4a);
            padding: 20px;
            text-align: center;
        }

        .controls-hint {
            position: absolute;
            bottom: 12px;
            left: 12px;
            color: rgba(255, 255, 255, 0.6);
            font-size: 0.75rem;
            font-family: var(--idtech-map-font, system-ui, sans-serif);
            pointer-events: none;
            opacity: 0;
            transition: opacity 0.3s;
        }

        :host(:hover) .controls-hint,
        :host(:focus-within) .controls-hint {
            opacity: 1;
        }
    `;

    // --- Public API ---

    /**
     * Get entities from the loaded map
     */
    get entities(): BSPEntity[] {
        return this.mapRenderer?.entities ?? [];
    }

    /**
     * Jump camera to a spawn point
     */
    jumpToSpawn(index = 0): void {
        this.mapRenderer?.jumpToSpawn(index);
    }

    /**
     * Set camera position directly
     */
    setCameraPosition(x: number, y: number, z: number): void {
        this.mapRenderer?.setCameraPosition(x, y, z);
    }

    /**
     * Get current camera state
     */
    getCameraState(): CameraState | null {
        return this.mapRenderer?.getCameraState() ?? null;
    }

    /**
     * Reload the current map
     */
    async reload(): Promise<void> {
        if (this.src) {
            await this.loadMap();
        }
    }

    // --- Lifecycle ---

    override connectedCallback(): void {
        super.connectedCallback();
        
        // Set up asset loader events
        this.assetLoader.addEventListener('progress', this.handleProgress as EventListener);
    }

    override disconnectedCallback(): void {
        super.disconnectedCallback();
        
        this.assetLoader.removeEventListener('progress', this.handleProgress as EventListener);
        this.assetLoader.abort();
        
        this.cleanupRenderer();
        this.resizeObserver?.disconnect();
        this.intersectionObserver?.disconnect();
    }

    override firstUpdated(): void {
        // Set up resize observer
        this.resizeObserver = new ResizeObserver(this.handleResize);
        this.resizeObserver.observe(this.container);

        // Set up intersection observer for lazy loading
        if (this.loading === 'lazy') {
            this.intersectionObserver = new IntersectionObserver(
                this.handleIntersection,
                { threshold: 0.1 }
            );
            this.intersectionObserver.observe(this);
        }

        // Initialize renderer
        this.initializeRenderer();
    }

    override updated(changedProperties: PropertyValues): void {
        // Handle src change
        if (changedProperties.has('src') && this.src && this._ready) {
            if (this.loading === 'eager' || this.hasBeenVisible) {
                this.loadMap();
            }
        }

        // Handle camera-controls change
        if (changedProperties.has('cameraControls')) {
            this.updateControlsState();
        }
    }

    // --- Render ---

    override render() {
        const showPoster = this._loading || this._error || !this._ready;
        const posterStyle = this.poster ? `background-image: url(${this.poster})` : '';

        return html`
            <div class="container">
                <canvas></canvas>
                
                <div class="poster ${showPoster ? '' : 'hidden'}" style="${posterStyle}">
                    ${this._loading ? this.renderLoading() : null}
                    ${this._error ? this.renderError() : null}
                    <slot name="poster"></slot>
                </div>

                <slot name="overlay"></slot>

                ${this.cameraControls ? html`
                    <div class="controls-hint">
                        Click to look around · WASD to move · Space/C up/down
                    </div>
                ` : null}
            </div>
        `;
    }

    private renderLoading() {
        return html`
            <div class="loading-indicator">
                <slot name="loading">
                    <div>Loading...</div>
                    <div class="progress-bar">
                        <div class="progress-fill" style="width: ${this._progress}%"></div>
                    </div>
                    <div class="progress-message">${this._progressMessage}</div>
                </slot>
            </div>
        `;
    }

    private renderError() {
        return html`
            <div class="error">
                <slot name="error">
                    <div>Failed to load map</div>
                    <div>${this._error}</div>
                </slot>
            </div>
        `;
    }

    // --- Private methods ---

    private async initializeRenderer(): Promise<void> {
        try {
            this.mapRenderer = new MapRenderer(this.canvas);
            await this.mapRenderer.initialize();

            // Set up camera change callback
            this.mapRenderer.onCameraChange = (state) => {
                this.dispatchEvent(new CustomEvent('camera-change', { detail: state }));
            };

            // Apply initial size
            const rect = this.container.getBoundingClientRect();
            this.mapRenderer.resize(rect.width, rect.height);

            this._ready = true;

            // Update controls state
            this.updateControlsState();

            // Load map if src is set
            if (this.src && (this.loading === 'eager' || this.hasBeenVisible)) {
                this.loadMap();
            }
        } catch (error) {
            this._error = error instanceof Error ? error.message : 'Failed to initialize renderer';
            this.dispatchEvent(new CustomEvent('error', {
                detail: { message: this._error, error }
            }));
        }
    }

    private async loadMap(): Promise<void> {
        if (!this.mapRenderer || !this.src) return;

        this._loading = true;
        this._error = undefined;
        this._progress = 0;
        this._progressMessage = '';

        try {
            // Parse WAD list
            const wadList = this.wads?.split(';').map(s => s.trim()).filter(Boolean) ?? [];

            // Load assets
            const assets = await this.assetLoader.load({
                bsp: this.src,
                wads: wadList,
                palette: this.palette,
            });

            // Load map into renderer
            this._progressMessage = 'Building geometry...';
            this._progress = 90;
            
            this.mapRenderer.loadMap(assets);

            this._progress = 100;
            this._loading = false;

            // Start rendering
            this.mapRenderer.start();

            // Dispatch load event
            this.dispatchEvent(new CustomEvent('load', {
                detail: { entities: this.entities }
            }));

        } catch (error) {
            this._loading = false;
            this._error = error instanceof Error ? error.message : 'Failed to load map';
            
            this.dispatchEvent(new CustomEvent('error', {
                detail: { message: this._error, error }
            }));
        }
    }

    private updateControlsState(): void {
        if (!this.mapRenderer) return;

        if (this.cameraControls) {
            if (!this.inputManager) {
                this.inputManager = new SimpleInputManager(this.canvas);
            }
            this.mapRenderer.enableControls(this.inputManager);
        } else {
            if (this.inputManager) {
                this.inputManager.destroy();
                this.inputManager = null;
            }
            this.mapRenderer.disableControls();
        }
    }

    private cleanupRenderer(): void {
        this.mapRenderer?.stop();
        this.mapRenderer?.destroy();
        this.mapRenderer = null;

        if (this.inputManager) {
            this.inputManager.destroy();
            this.inputManager = null;
        }
    }

    // --- Event handlers ---

    private handleProgress = (event: CustomEvent<LoadProgressDetail>): void => {
        const { phase, loaded, total, message } = event.detail;

        // Calculate overall progress
        const phaseWeights: Record<string, [number, number]> = {
            palette: [0, 5],
            wads: [5, 40],
            bsp: [45, 85],
            parsing: [85, 95],
            building: [95, 100],
        };

        const [start, end] = phaseWeights[phase] ?? [0, 100];
        const phaseProgress = total > 0 ? loaded / total : 0;
        this._progress = start + (end - start) * phaseProgress;
        this._progressMessage = message ?? '';

        // Forward progress event
        this.dispatchEvent(new CustomEvent('progress', { detail: event.detail }));
    };

    private handleResize = (entries: ResizeObserverEntry[]): void => {
        const entry = entries[0];
        if (entry && this.mapRenderer) {
            const { width, height } = entry.contentRect;
            this.mapRenderer.resize(width, height);
        }
    };

    private handleIntersection = (entries: IntersectionObserverEntry[]): void => {
        const entry = entries[0];
        if (entry?.isIntersecting && !this.hasBeenVisible) {
            this.hasBeenVisible = true;
            if (this.src && this._ready) {
                this.loadMap();
            }
        }
    };
}

// Augment global HTMLElementTagNameMap for TypeScript
declare global {
    interface HTMLElementTagNameMap {
        'idtech-map': IdTechMapElement;
    }
}

