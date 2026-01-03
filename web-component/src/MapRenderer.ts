/**
 * MapRenderer - Simplified renderer for BSP maps with internal render loop
 * 
 * Adapts IdTech2Renderer for standalone use in a web component.
 */

import { mat4, vec3 } from 'gl-matrix';
import ArrayBufferSlice from '@noclip/website/ArrayBufferSlice.js';
import { BSPFile, BSPEntity } from '@noclip/website/Common/IdTech2/BSPFile.js';
import { BSPRenderer, TextureCache } from '@noclip/website/Common/IdTech2/Render.js';
import { parseWAD } from '@noclip/website/Common/IdTech2/WAD.js';
import { GfxDevice, GfxSwapChain, GfxTexture } from '@noclip/website/gfx/platform/GfxPlatform.js';
import { createSwapChainForWebGL2, GfxPlatformWebGL2Config } from '@noclip/website/gfx/platform/GfxPlatformWebGL2.js';
import { createSwapChainForWebGPU, GfxPlatformWebGPUConfig } from '@noclip/website/gfx/platform/GfxPlatformWebGPU.js';
import { GfxRenderHelper } from '@noclip/website/gfx/render/GfxRenderHelper.js';
import { GfxRenderInstList } from '@noclip/website/gfx/render/GfxRenderInstManager.js';
import { AntialiasingMode, makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from '@noclip/website/gfx/helpers/RenderGraphHelpers.js';
import { GfxrAttachmentSlot } from '@noclip/website/gfx/render/GfxRenderGraph.js';
import { LoadedAssets, CameraState } from './types.js';
import { SimpleInputManager } from './SimpleInputManager.js';
import { SimpleCameraController } from './SimpleCameraController.js';

// Source engine coordinate system conversion
const noclipSpaceFromSourceEngineSpace = mat4.fromValues(
    0, 0, -1, 0,
    -1, 0, 0, 0,
    0, 1, 0, 0,
    0, 0, 0, 1,
);

/**
 * Simple camera for the renderer
 */
class SimpleCamera {
    public worldMatrix = mat4.create();
    public viewMatrix = mat4.create();
    public projectionMatrix = mat4.create();
    public clipFromWorldMatrix = mat4.create();
    
    public fovY = Math.PI / 4;  // 45 degrees
    public aspect = 1;
    public near = 1;
    public far = 100000;

    constructor() {
        mat4.identity(this.worldMatrix);
    }

    updateProjection(width: number, height: number): void {
        this.aspect = width / height;
        mat4.perspective(this.projectionMatrix, this.fovY, this.aspect, this.near, this.far);
    }

    updateViewMatrix(): void {
        mat4.invert(this.viewMatrix, this.worldMatrix);
        mat4.mul(this.clipFromWorldMatrix, this.projectionMatrix, this.viewMatrix);
    }

    getPosition(): vec3 {
        return vec3.fromValues(
            this.worldMatrix[12],
            this.worldMatrix[13],
            this.worldMatrix[14]
        );
    }
}

/**
 * View state for rendering (matches noclip's View class)
 */
class RenderView {
    public viewFromWorldMatrix = mat4.create();
    public worldFromViewMatrix = mat4.create();
    public clipFromWorldMatrix = mat4.create();
    public clipFromViewMatrix = mat4.create();

    public mainList = new GfxRenderInstList();
    public skyList = new GfxRenderInstList();

    finishSetup(): void {
        mat4.invert(this.worldFromViewMatrix, this.viewFromWorldMatrix);
        mat4.mul(this.clipFromWorldMatrix, this.clipFromViewMatrix, this.viewFromWorldMatrix);
    }

    setupFromCamera(camera: SimpleCamera): void {
        mat4.mul(this.viewFromWorldMatrix, camera.viewMatrix, noclipSpaceFromSourceEngineSpace);
        mat4.copy(this.clipFromViewMatrix, camera.projectionMatrix);
        this.finishSetup();
    }

    reset(): void {
        this.mainList.reset();
        this.skyList.reset();
    }
}

export type RenderBackend = 'webgl2' | 'webgpu' | 'auto';

export interface MapRendererOptions {
    /** Preferred rendering backend */
    backend?: RenderBackend;
    /** Enable debug shader output */
    shaderDebug?: boolean;
}

export class MapRenderer {
    private canvas: HTMLCanvasElement;
    private swapChain: GfxSwapChain | null = null;
    private device: GfxDevice | null = null;
    private renderHelper: GfxRenderHelper | null = null;
    private textureCache: TextureCache | null = null;
    private bspRenderer: BSPRenderer | null = null;
    private bspFile: BSPFile | null = null;

    private camera = new SimpleCamera();
    private cameraController: SimpleCameraController | null = null;
    private inputManager: SimpleInputManager | null = null;
    private view = new RenderView();

    private running = false;
    private animationFrameId: number | null = null;
    private lastTime = 0;

    private width = 0;
    private height = 0;

    public onCameraChange: ((state: CameraState) => void) | null = null;

    constructor(canvas: HTMLCanvasElement, private options: MapRendererOptions = {}) {
        this.canvas = canvas;
    }

    /**
     * Initialize the graphics device
     */
    async initialize(): Promise<void> {
        const backend = this.options.backend ?? 'auto';

        // Try WebGPU first if available and requested
        if (backend === 'webgpu' || backend === 'auto') {
            const config: GfxPlatformWebGPUConfig = {
                trackResources: false,
                shaderDebug: this.options.shaderDebug ?? false,
            };
            this.swapChain = await createSwapChainForWebGPU(this.canvas, config);
        }

        // Fall back to WebGL2
        if (!this.swapChain && (backend === 'webgl2' || backend === 'auto')) {
            const gl = this.canvas.getContext('webgl2', {
                alpha: false,
                antialias: false,
                preserveDrawingBuffer: false,
            });

            if (!gl) {
                throw new Error('WebGL2 not supported');
            }

            const config = new GfxPlatformWebGL2Config();
            config.shaderDebug = this.options.shaderDebug ?? false;
            this.swapChain = createSwapChainForWebGL2(gl, config);
        }

        if (!this.swapChain) {
            throw new Error('Failed to initialize graphics backend');
        }

        this.device = this.swapChain.getDevice();
        this.renderHelper = new GfxRenderHelper(this.device);
        this.textureCache = new TextureCache(this.renderHelper.renderCache);
    }

    /**
     * Load a map from parsed assets
     */
    loadMap(assets: LoadedAssets): void {
        if (!this.device || !this.renderHelper || !this.textureCache) {
            throw new Error('Renderer not initialized. Call initialize() first.');
        }

        // Clean up previous map
        this.unloadMap();

        const bspSlice = new ArrayBufferSlice(assets.bspData);
        this.bspFile = new BSPFile(bspSlice);

        // Set up palette for Quake
        if (assets.paletteData) {
            const palette = new Uint8Array(assets.paletteData);
            this.textureCache.setPalette(palette);
        }

        // Add embedded textures from BSP
        this.textureCache.addBSP(this.bspFile);

        // Add WAD textures
        for (const wadBuffer of assets.wadData) {
            const wad = parseWAD(new ArrayBufferSlice(wadBuffer));
            this.textureCache.addWAD(wad);
        }

        // Create the BSP renderer
        this.bspRenderer = new BSPRenderer(
            this.renderHelper.renderCache,
            this.textureCache,
            this.bspFile
        );

        // Position camera at first spawn point
        this.jumpToSpawn();
    }

    /**
     * Unload the current map
     */
    unloadMap(): void {
        if (this.bspRenderer && this.device) {
            this.bspRenderer.destroy(this.device);
            this.bspRenderer = null;
        }
        this.bspFile = null;
    }

    /**
     * Get entities from the loaded map
     */
    get entities(): BSPEntity[] {
        return this.bspFile?.entities ?? [];
    }

    /**
     * Jump camera to a spawn point
     */
    jumpToSpawn(index = 0): void {
        const spawns = this.entities.filter(
            e => e.classname === 'info_player_start' || e.classname === 'info_player_deathmatch'
        );

        if (spawns.length === 0) {
            // Default position if no spawn found
            mat4.fromTranslation(this.camera.worldMatrix, [0, 0, 100]);
            return;
        }

        const spawn = spawns[index % spawns.length];
        const originParts = spawn.origin?.split(' ').map(Number) ?? [0, 0, 0];
        const origin = vec3.fromValues(originParts[0], originParts[1], originParts[2]);
        const angle = spawn.angle ? parseFloat(spawn.angle) : 0;

        // Set camera position and rotation
        mat4.identity(this.camera.worldMatrix);
        mat4.translate(this.camera.worldMatrix, this.camera.worldMatrix, origin);
        mat4.rotateZ(this.camera.worldMatrix, this.camera.worldMatrix, (angle * Math.PI) / 180);
    }

    /**
     * Set camera position directly
     */
    setCameraPosition(x: number, y: number, z: number): void {
        this.camera.worldMatrix[12] = x;
        this.camera.worldMatrix[13] = y;
        this.camera.worldMatrix[14] = z;
    }

    /**
     * Get current camera state
     */
    getCameraState(): CameraState {
        const pos = this.camera.getPosition();
        // Extract rotation from world matrix (simplified - just yaw and pitch)
        const yaw = Math.atan2(this.camera.worldMatrix[4], this.camera.worldMatrix[0]);
        const pitch = Math.asin(-this.camera.worldMatrix[8]);
        
        return {
            position: [pos[0], pos[1], pos[2]],
            rotation: [yaw, pitch]
        };
    }

    /**
     * Enable camera controls
     */
    enableControls(inputManager: SimpleInputManager): void {
        this.inputManager = inputManager;
        this.cameraController = new SimpleCameraController(this.camera);
    }

    /**
     * Disable camera controls
     */
    disableControls(): void {
        this.inputManager = null;
        this.cameraController = null;
    }

    /**
     * Start the render loop
     */
    start(): void {
        if (this.running) return;
        this.running = true;
        this.lastTime = performance.now();
        this.scheduleFrame();
    }

    /**
     * Stop the render loop
     */
    stop(): void {
        this.running = false;
        if (this.animationFrameId !== null) {
            cancelAnimationFrame(this.animationFrameId);
            this.animationFrameId = null;
        }
    }

    /**
     * Resize the renderer
     */
    resize(width: number, height: number): void {
        if (width === this.width && height === this.height) return;
        
        this.width = width;
        this.height = height;

        // Update canvas size
        this.canvas.width = width * devicePixelRatio;
        this.canvas.height = height * devicePixelRatio;

        // Update camera projection
        this.camera.updateProjection(width, height);

        // Update swap chain
        if (this.swapChain) {
            this.swapChain.configureSwapChain(
                this.canvas.width,
                this.canvas.height
            );
        }
    }

    /**
     * Destroy the renderer and release all resources
     */
    destroy(): void {
        this.stop();
        this.unloadMap();

        if (this.textureCache && this.device) {
            this.textureCache.destroy(this.device);
            this.textureCache = null;
        }

        if (this.renderHelper) {
            this.renderHelper.destroy();
            this.renderHelper = null;
        }

        this.swapChain = null;
        this.device = null;
    }

    private scheduleFrame(): void {
        this.animationFrameId = requestAnimationFrame(this.renderFrame);
    }

    private renderFrame = (time: number): void => {
        if (!this.running) return;

        const dt = time - this.lastTime;
        this.lastTime = time;

        this.update(dt);
        this.render();

        this.scheduleFrame();
    };

    private update(dt: number): void {
        // Update camera from input
        if (this.cameraController && this.inputManager) {
            const changed = this.cameraController.update(this.inputManager, dt);
            
            if (changed && this.onCameraChange) {
                this.onCameraChange(this.getCameraState());
            }

            // Reset input deltas for next frame
            this.inputManager.resetDeltas();
        }

        this.camera.updateViewMatrix();
    }

    private render(): void {
        if (!this.device || !this.renderHelper || !this.swapChain || !this.bspRenderer) {
            return;
        }

        // Set up view from camera
        this.view.setupFromCamera(this.camera);

        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        // Create render targets
        const onscreenTexture = this.swapChain.getOnscreenTexture();
        const viewerInput = {
            backbufferWidth: this.canvas.width,
            backbufferHeight: this.canvas.height,
            antialiasingMode: AntialiasingMode.None,
            onscreenTexture,
        };

        const mainColorDesc = makeBackbufferDescSimple(
            GfxrAttachmentSlot.Color0,
            viewerInput,
            standardFullClearRenderPassDescriptor
        );
        const mainDepthDesc = makeBackbufferDescSimple(
            GfxrAttachmentSlot.DepthStencil,
            viewerInput,
            standardFullClearRenderPassDescriptor
        );

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');

        // Skybox pass
        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                this.view.skyList.drawOnPassRenderer(this.renderHelper!.renderCache, passRenderer);
            });
        });

        // Main pass
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.view.mainList.drawOnPassRenderer(this.renderHelper!.renderCache, passRenderer);
            });
        });

        // Resolve to screen
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, onscreenTexture);

        // Prepare BSP for rendering
        this.renderHelper.pushTemplateRenderInst();
        this.bspRenderer.prepareToRender(renderInstManager, this.view as any);
        renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();

        // Execute render graph
        this.renderHelper.renderGraph.execute(builder);

        // Reset view for next frame
        this.view.reset();
    }
}

