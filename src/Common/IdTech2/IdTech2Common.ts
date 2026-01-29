
import { mat4, ReadonlyVec4, vec4 } from "gl-matrix";
import { pairs2obj, ValveKeyValueParser, VKFPair } from "../../SourceEngine/VMT.js";
import { GfxRenderInstList } from "../../gfx/render/GfxRenderInstManager.js";
import { Camera } from "../../Camera.js";

// ============================================================================
// Shared Interfaces
// ============================================================================

export interface TexinfoMapping {
    s: ReadonlyVec4;
    t: ReadonlyVec4;
}

export interface SurfaceLightmapData {
    faceIndex: number;
    // Size of a single lightmap.
    width: number;
    height: number;
    styles: number[];
    samples: Uint8Array | null;
    // Dynamic allocation
    pageIndex: number;
    pagePosX: number;
    pagePosY: number;
}

export interface Surface {
    texName: string;
    startIndex: number;
    indexCount: number;
    lightmapData: SurfaceLightmapData[];
}

export interface BSPEntity {
    classname: string;
    [k: string]: string;
}

// ============================================================================
// Shared Parsing Functions
// ============================================================================

export function parseEntitiesLump(str: string): BSPEntity[] {
    const p = new ValveKeyValueParser(str);
    const entities: BSPEntity[] = [];
    while (p.hastok()) {
        entities.push(pairs2obj(p.unit() as VKFPair[]) as BSPEntity);
        p.skipwhite();
    }
    return entities;
}

export function readVec4(view: DataView, offs: number): vec4 {
    const x = view.getFloat32(offs + 0x00, true);
    const y = view.getFloat32(offs + 0x04, true);
    const z = view.getFloat32(offs + 0x08, true);
    const w = view.getFloat32(offs + 0x0C, true);
    return vec4.fromValues(x, y, z, w);
}

// ============================================================================
// Shared Render Utilities
// ============================================================================

/**
 * Check if a texture name is a tool texture (triggers, clips, etc.)
 * that should not be rendered.
 */
export function isToolTexture(texName: string): boolean {
    const lower = texName.toLowerCase();
    // Q1/HL tool textures
    if (lower === 'trigger') return true;
    if (lower === 'clip') return true;
    if (lower === 'skip') return true;
    if (lower === 'hint') return true;
    if (lower === 'origin') return true;
    if (lower === 'aaatrigger') return true;
    if (lower === 'null') return true;
    if (lower === 'nodraw') return true;
    if (lower === 'invisible') return true;
    if (lower.startsWith('tools/')) return true;
    // Q2 tool textures (path-based)
    if (lower.endsWith('/trigger')) return true;
    if (lower.endsWith('/clip')) return true;
    if (lower.endsWith('/skip')) return true;
    if (lower.endsWith('/hint')) return true;
    if (lower.endsWith('/origin')) return true;
    return false;
}

/**
 * Coordinate space conversion from IdTech2 conventions to noclip conventions.
 * In IdTech2/Source: +X forward, -X backward, +Y left, -Y right, +Z up, -Z down.
 */
export const noclipSpaceFromIdTech2Space = mat4.fromValues(
    0,  0, -1, 0,
    -1, 0,  0, 0,
    0,  1,  0, 0,
    0,  0,  0, 1,
);

// ============================================================================
// Shared View Class
// ============================================================================

/**
 * A "View" represents camera settings in IdTech2 engine space.
 * Used for both Q1/HL and Q2 rendering.
 */
export class IdTech2View {
    // aka viewMatrix
    public viewFromWorldMatrix = mat4.create();
    // aka worldMatrix
    public worldFromViewMatrix = mat4.create();
    public clipFromWorldMatrix = mat4.create();
    // aka projectionMatrix
    public clipFromViewMatrix = mat4.create();

    public time = 0;

    public mainList = new GfxRenderInstList();
    public skyList = new GfxRenderInstList();

    public finishSetup(): void {
        mat4.invert(this.worldFromViewMatrix, this.viewFromWorldMatrix);
        mat4.mul(this.clipFromWorldMatrix, this.clipFromViewMatrix, this.viewFromWorldMatrix);
    }

    public setupFromCamera(camera: Camera): void {
        mat4.mul(this.viewFromWorldMatrix, camera.viewMatrix, noclipSpaceFromIdTech2Space);
        mat4.copy(this.clipFromViewMatrix, camera.projectionMatrix);
        this.finishSetup();
    }

    public reset(): void {
        this.mainList.reset();
        this.skyList.reset();
    }
}

