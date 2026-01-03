/**
 * Public types for the idtech-map web component
 */

import type { BSPEntity } from '@noclip/website/Common/IdTech2/BSPFile.js';

export type { BSPEntity };

/**
 * Progress event detail for asset loading
 */
export interface LoadProgressDetail {
    phase: 'palette' | 'wads' | 'bsp' | 'parsing' | 'building';
    loaded: number;
    total: number;
    message?: string;
}

/**
 * Camera position and rotation
 */
export interface CameraState {
    position: [number, number, number];
    /** [yaw, pitch] in radians */
    rotation: [number, number];
}

/**
 * Options for loading a map
 */
export interface MapLoadOptions {
    /** URL to the BSP file */
    bsp: string;
    /** URLs to WAD files (semicolon or array) */
    wads?: string | string[];
    /** URL to palette file (Quake only) */
    palette?: string;
}

/**
 * Loaded assets ready for rendering
 */
export interface LoadedAssets {
    bspData: ArrayBuffer;
    wadData: ArrayBuffer[];
    paletteData: ArrayBuffer | null;
}

/**
 * Events emitted by the idtech-map element
 */
export interface IdTechMapEventMap {
    'load': CustomEvent<{ entities: BSPEntity[] }>;
    'error': CustomEvent<{ message: string; error?: Error }>;
    'progress': CustomEvent<LoadProgressDetail>;
    'camera-change': CustomEvent<CameraState>;
}

