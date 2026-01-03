/**
 * @noclip/map-viewer - Web component for rendering game maps in the browser
 * 
 * Currently supports Quake and Half-Life (GoldSrc) BSP maps.
 * 
 * @example
 * ```html
 * <script type="module">
 *   import '@noclip/map-viewer';
 * </script>
 * 
 * <idtech-map
 *   src="maps/e1m1.bsp"
 *   wads="id1/gfx.wad"
 *   palette="id1/palette.lmp"
 *   camera-controls>
 * </idtech-map>
 * ```
 */

// Main web component
export { IdTechMapElement } from './IdTechMapElement.js';

// Core classes for advanced usage
export { MapRenderer } from './MapRenderer.js';
export type { MapRendererOptions, RenderBackend } from './MapRenderer.js';

export { AssetLoader } from './AssetLoader.js';
export { SimpleInputManager } from './SimpleInputManager.js';
export { SimpleCameraController } from './SimpleCameraController.js';

// Types
export type {
    BSPEntity,
    LoadProgressDetail,
    CameraState,
    MapLoadOptions,
    LoadedAssets,
    IdTechMapEventMap,
} from './types.js';

