
import { GfxDevice, GfxTexture, GfxFormat, makeTextureDescriptor2D, GfxInputLayout, GfxVertexAttributeDescriptor, GfxInputLayoutBufferDescriptor, GfxVertexBufferFrequency, GfxBuffer, GfxBufferUsage, GfxProgram, GfxCullMode, GfxFrontFaceMode, GfxVertexBufferDescriptor, GfxIndexBufferDescriptor, GfxBufferFrequencyHint } from "../../gfx/platform/GfxPlatform.js";
import { GfxRenderCache } from "../../gfx/render/GfxRenderCache.js";
import { nArray } from "../../util.js";
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { convertToCanvas } from "../../gfx/helpers/TextureConversionHelpers.js";
import { SceneGfx, Texture, ViewerRenderInput } from "../../viewer.js";
import { DeviceProgram } from "../../Program.js";
import { BSPEntity, BSPFileQ2, Model, Surface, SurfaceLightmapData } from "./BSPFileQ2.js";
import { GfxRenderInstManager } from "../../gfx/render/GfxRenderInstManager.js";
import { TextureMapping } from "../../TextureHolder.js";
import { mat4, ReadonlyMat4 } from "gl-matrix";
import { CameraController } from "../../Camera.js";
import { fillMatrix4x4, fillVec4 } from "../../gfx/helpers/UniformBufferHelpers.js";
import { GfxRenderHelper } from "../../gfx/render/GfxRenderHelper.js";
import { makeBackbufferDescSimple, standardFullClearRenderPassDescriptor } from "../../gfx/helpers/RenderGraphHelpers.js";
import { GfxrAttachmentSlot } from "../../gfx/render/GfxRenderGraph.js";
import { LightmapPackerPage } from "../../SourceEngine/BSPFile.js";
import { GfxShaderLibrary } from "../../gfx/helpers/GfxShaderLibrary.js";
import { createBufferFromData } from "../../gfx/helpers/BufferHelpers.js";
import { TextureListHolder } from "../../ui.js";
import { WorldLightingState } from "./WorldLightingState.js";
import { parseWAL, parseColormapPCX, WALTexture } from "./WAL.js";
import { DataFetcher } from "../../DataFetcher.js";
import { isToolTexture, IdTech2View } from "./IdTech2Common.js";

export class Q2TextureData {
    public gfxTexture: GfxTexture;
    public viewerTexture: Texture;

    public name: string;
    public width: number;
    public height: number;

    constructor(device: GfxDevice, name: string, width: number, height: number, rgba: Uint8Array) {
        this.name = name;
        
        // Clamp invalid dimensions to create a 1x1 pink placeholder
        if (width <= 0 || height <= 0) {
            console.error(`Q2TextureData: Invalid texture dimensions for "${name}": ${width}x${height}`);
            width = 1;
            height = 1;
            rgba = new Uint8Array([255, 0, 255, 255]); // pink
        }

        this.width = width;
        this.height = height;

        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        device.setResourceName(this.gfxTexture, name);
        device.uploadTextureData(this.gfxTexture, 0, [rgba]);

        const surfaces = [convertToCanvas(new ArrayBufferSlice(rgba.buffer), width, height, GfxFormat.U8_RGBA_NORM)];
        this.viewerTexture = { name, surfaces };
    }

    public static fromWAL(device: GfxDevice, wal: WALTexture, palette: Uint8Array): Q2TextureData {
        if (wal.width <= 0 || wal.height <= 0) {
            console.error(`Q2TextureData.fromWAL: Invalid dimensions for "${wal.name}": ${wal.width}x${wal.height}`);
            // Return 1x1 pink placeholder
            return new Q2TextureData(device, wal.name, 1, 1, new Uint8Array([255, 0, 255, 255]));
        }

        const view = wal.data.createDataView();
        const rgba = new Uint8Array(wal.width * wal.height * 4);

        let srcOffs = wal.mipOffsets[0];
        for (let i = 0; i < wal.width * wal.height; i++) {
            const palIdx = view.getUint8(srcOffs++);
            rgba[i * 4 + 0] = palette[palIdx * 3 + 0];
            rgba[i * 4 + 1] = palette[palIdx * 3 + 1];
            rgba[i * 4 + 2] = palette[palIdx * 3 + 2];
            rgba[i * 4 + 3] = 0xFF;
        }

        return new Q2TextureData(device, wal.name, wal.width, wal.height, rgba);
    }

    public static fromPNG(device: GfxDevice, name: string, img: HTMLImageElement): Q2TextureData {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, img.width, img.height);
        return new Q2TextureData(device, name, img.width, img.height, new Uint8Array(imageData.data));
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

export class Q2TextureCache implements TextureListHolder {
    public textures: Q2TextureData[] = [];
    public onnewtextures: (() => void) | null = null;
    public palette: Uint8Array | null = null;
    private texturePromises: Map<string, Promise<Q2TextureData | null>> = new Map();
    private loadedTextures: Map<string, Q2TextureData> = new Map();
    private placeholderTexture: Q2TextureData | null = null;

    constructor(public cache: GfxRenderCache, private dataFetcher: DataFetcher, private pathBase: string) {
    }

    public async init(): Promise<void> {
        // Load palette from colormap.pcx
        try {
            const colormapData = await this.dataFetcher.fetchData(`${this.pathBase}/pics/colormap.pcx`);
            this.palette = parseColormapPCX(colormapData);
        } catch (e) {
            console.warn('Failed to load colormap.pcx, using default palette');
            this.palette = new Uint8Array(768);
            for (let i = 0; i < 256; i++) {
                this.palette[i * 3 + 0] = i;
                this.palette[i * 3 + 1] = i;
                this.palette[i * 3 + 2] = i;
            }
        }

        // Create placeholder texture (pink/black checkerboard)
        const placeholderSize = 64;
        const placeholderData = new Uint8Array(placeholderSize * placeholderSize * 4);
        for (let y = 0; y < placeholderSize; y++) {
            for (let x = 0; x < placeholderSize; x++) {
                const idx = (y * placeholderSize + x) * 4;
                const checker = ((x >> 3) ^ (y >> 3)) & 1;
                if (checker) {
                    placeholderData[idx + 0] = 255;
                    placeholderData[idx + 1] = 0;
                    placeholderData[idx + 2] = 255;
                } else {
                    placeholderData[idx + 0] = 0;
                    placeholderData[idx + 1] = 0;
                    placeholderData[idx + 2] = 0;
                }
                placeholderData[idx + 3] = 255;
            }
        }
        this.placeholderTexture = new Q2TextureData(this.cache.device, '__placeholder__', placeholderSize, placeholderSize, placeholderData);
    }

    public get textureNames(): string[] {
        return this.textures.map((tex) => tex.name);
    }

    public async getViewerTexture(i: number): Promise<Texture> {
        return this.textures[i].viewerTexture;
    }

    private async loadTextureAsync(texName: string): Promise<Q2TextureData | null> {
        const device = this.cache.device;

        // Skip empty or invalid texture names
        if (!texName || texName.trim() === '') {
            console.warn(`Skipping empty texture name`);
            return null;
        }

        // The re-release data replaces '+' with '_' in filenames
        // (e.g., +0comp10_1 becomes _0comp10_1)
        const diskTexName = texName.replace(/\+/g, '_');

        // Try WAL first (these should always exist)
        const walPath = `${this.pathBase}/textures/${diskTexName}.wal`;
        const walData = await this.dataFetcher.fetchData(walPath, { allow404: true });

        if (walData.byteLength > 0) {
            try {
                const wal = parseWAL(walData);
                const texture = Q2TextureData.fromWAL(device, wal, this.palette!);
                this.textures.push(texture);
                return texture;
            } catch (e) {
                console.warn(`Failed to parse WAL texture: ${texName}`, e);
            }
        }

        // Try PNG as fallback (re-release high-res textures)
        const pngPath = `${this.pathBase}/textures/${diskTexName}.png`;
        const pngData = await this.dataFetcher.fetchData(pngPath, { allow404: true });

        if (pngData.byteLength > 0) {
            try {
                // Decode PNG using browser APIs
                const blob = new Blob([pngData.copyToBuffer()], { type: 'image/png' });
                const imageBitmap = await createImageBitmap(blob);

                const canvas = document.createElement('canvas');
                canvas.width = imageBitmap.width;
                canvas.height = imageBitmap.height;
                const ctx = canvas.getContext('2d')!;
                ctx.drawImage(imageBitmap, 0, 0);
                const imageData = ctx.getImageData(0, 0, imageBitmap.width, imageBitmap.height);

                const texture = new Q2TextureData(device, texName, imageBitmap.width, imageBitmap.height, new Uint8Array(imageData.data));
                this.textures.push(texture);
                return texture;
            } catch (e) {
                // PNG decode failed
            }
        }

        console.warn(`Failed to load texture: ${texName} (tried ${diskTexName})`);
        return null;
    }

    public async preloadTextures(textureNames: Iterable<string>): Promise<void> {
        const promises: Promise<void>[] = [];
        for (const texName of textureNames) {
            if (!this.texturePromises.has(texName)) {
                const promise = this.loadTextureAsync(texName).then((tex) => {
                    if (tex) {
                        this.loadedTextures.set(texName, tex);
                    }
                });
                this.texturePromises.set(texName, promise.then(() => this.loadedTextures.get(texName) ?? null));
                promises.push(promise);
            }
        }
        await Promise.all(promises);
    }

    public findTexture(texName: string): Q2TextureData {
        const tex = this.loadedTextures.get(texName);
        if (tex !== undefined)
            return tex;
        return this.placeholderTexture!;
    }

    public destroy(device: GfxDevice): void {
        for (const tex of this.textures)
            tex.destroy(device);
        if (this.placeholderTexture)
            this.placeholderTexture.destroy(device);
    }
}

class Q2Program extends DeviceProgram {
    public static ub_SceneParams = 0;
    public static ub_ModelParams = 1;

    public static a_Position = 0;
    public static a_TexCoord = 1;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
    vec4 u_Params[1];
};

layout(std140) uniform ub_ModelParams {
    Mat4x4 u_ModelMatrix;
};

#define u_Time (u_Params[0].x)

uniform sampler2D u_TextureDiffuse;
uniform sampler2D u_TextureLightmap;
`;

    public override vert = `
layout(location = ${Q2Program.a_Position}) in vec3 a_Position;
layout(location = ${Q2Program.a_TexCoord}) in vec4 a_TexCoord;

out vec4 v_TexCoord;

void main() {
    vec4 t_PositionWorld = UnpackMatrix(u_ModelMatrix) * vec4(a_Position, 1.0);
    gl_Position = UnpackMatrix(u_ProjectionView) * t_PositionWorld;
    v_TexCoord = a_TexCoord;
}
`;

    public override frag = `
in vec4 v_TexCoord;

void main() {
    vec2 t_TexCoordDiffuse = v_TexCoord.xy;

#if defined USE_WARP
    float warpS = 10.0 * sin(t_TexCoordDiffuse.y * 0.03 + u_Time * 0.5);
    float warpT = 10.0 * sin(t_TexCoordDiffuse.x * 0.03 + u_Time * 0.5);
    t_TexCoordDiffuse.x += warpS;
    t_TexCoordDiffuse.y += warpT;
#endif

    t_TexCoordDiffuse.xy /= vec2(textureSize(TEXTURE(u_TextureDiffuse), 0));
    vec4 t_DiffuseSample = texture(SAMPLER_2D(u_TextureDiffuse), t_TexCoordDiffuse.xy);

    if (t_DiffuseSample.a < 0.1)
        discard;

    vec2 t_TexCoordLightmap = v_TexCoord.zw / vec2(textureSize(TEXTURE(u_TextureLightmap), 0));
    vec4 t_Color = t_DiffuseSample;

#if defined USE_LIGHTMAP
    vec4 t_LightmapSample = texture(SAMPLER_2D(u_TextureLightmap), t_TexCoordLightmap.xy);
    t_Color.rgb *= t_LightmapSample.rgb * 2.0;
#endif

    // Quake 2 gamma/contrast adjustment
    t_Color.rgb = t_Color.rgb * 1.2;
    t_Color.rgb = pow(t_Color.rgb, vec3(0.9));

    gl_FragColor = t_Color;
}
`;
}

// Skybox shader program
class Q2SkyboxProgram extends DeviceProgram {
    public static ub_SceneParams = 0;

    public static a_Position = 0;
    public static a_TexCoord = 1;

    public override both = `
${GfxShaderLibrary.MatrixLibrary}

layout(std140) uniform ub_SceneParams {
    Mat4x4 u_ProjectionView;
};

uniform sampler2D u_Texture;
`;

    public override vert = `
layout(location = ${Q2SkyboxProgram.a_Position}) in vec3 a_Position;
layout(location = ${Q2SkyboxProgram.a_TexCoord}) in vec2 a_TexCoord;

out vec2 v_TexCoord;

void main() {
    gl_Position = UnpackMatrix(u_ProjectionView) * vec4(a_Position, 1.0);
    v_TexCoord = a_TexCoord;
}
`;

    public override frag = `
in vec2 v_TexCoord;

void main() {
    gl_FragColor = texture(SAMPLER_2D(u_Texture), v_TexCoord);
}
`;
}

// Skybox renderer for Q2-style env maps
export class Q2SkyboxRenderer {
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private inputLayout: GfxInputLayout;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    private indexBufferDescriptor: GfxIndexBufferDescriptor;
    private gfxProgram: GfxProgram;
    private textures: GfxTexture[] = [];
    private textureMapping = new TextureMapping();
    private loaded = false;

    constructor(cache: GfxRenderCache, private dataFetcher: DataFetcher, private pathBase: string, private skyName: string) {
        const device = cache.device;

        // Build skybox cube geometry (6 faces, 4 verts each)
        // Vertex format: position (3 floats) + texcoord (2 floats)
        const vertexData = new Float32Array(6 * 4 * 5);
        const indexData = new Uint16Array(6 * 6);

        let dstVert = 0;
        let dstIdx = 0;
        const size = 8192.0; // Large enough to always be behind geometry

        function addVert(x: number, y: number, z: number, u: number, v: number): void {
            vertexData[dstVert++] = x;
            vertexData[dstVert++] = y;
            vertexData[dstVert++] = z;
            vertexData[dstVert++] = u;
            vertexData[dstVert++] = v;
        }

        function addQuad(x0: number, y0: number, z0: number,
                         x1: number, y1: number, z1: number,
                         x2: number, y2: number, z2: number,
                         x3: number, y3: number, z3: number): void {
            const base = dstVert / 5;
            addVert(x0, y0, z0, 0, 0);
            addVert(x1, y1, z1, 1, 0);
            addVert(x2, y2, z2, 1, 1);
            addVert(x3, y3, z3, 0, 1);
            indexData[dstIdx++] = base + 0;
            indexData[dstIdx++] = base + 1;
            indexData[dstIdx++] = base + 2;
            indexData[dstIdx++] = base + 0;
            indexData[dstIdx++] = base + 2;
            indexData[dstIdx++] = base + 3;
        }

        // Quake 2 coordinate system: +X right, +Y forward, +Z up
        // Order: rt, lf, bk, ft, up, dn
        // Right (+X)
        addQuad(size, -size, size, size, size, size, size, size, -size, size, -size, -size);
        // Left (-X)
        addQuad(-size, size, size, -size, -size, size, -size, -size, -size, -size, size, -size);
        // Back (-Y)
        addQuad(-size, -size, size, size, -size, size, size, -size, -size, -size, -size, -size);
        // Front (+Y)
        addQuad(size, size, size, -size, size, size, -size, size, -size, size, size, -size);
        // Up (+Z)
        addQuad(-size, size, size, size, size, size, size, -size, size, -size, -size, size);
        // Down (-Z)
        addQuad(-size, -size, -size, size, -size, -size, size, size, -size, -size, size, -size);

        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, vertexData.buffer);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, indexData.buffer);

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: Q2SkyboxProgram.a_Position, bufferIndex: 0, bufferByteOffset: 0, format: GfxFormat.F32_RGB },
            { location: Q2SkyboxProgram.a_TexCoord, bufferIndex: 0, bufferByteOffset: 3 * 4, format: GfxFormat.F32_RG },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: 5 * 4, frequency: GfxVertexBufferFrequency.PerVertex },
        ];
        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat: GfxFormat.U16_R });

        this.vertexBufferDescriptors = [{ buffer: this.vertexBuffer }];
        this.indexBufferDescriptor = { buffer: this.indexBuffer };

        this.gfxProgram = cache.createProgram(new Q2SkyboxProgram());

        this.loadTextures();
    }

    private async loadTextures(): Promise<void> {
        const suffixes = ['rt', 'lf', 'bk', 'ft', 'up', 'dn'];

        for (const suffix of suffixes) {
            const path = `${this.pathBase}/env/${this.skyName}${suffix}.tga`;
            try {
                const data = await this.dataFetcher.fetchData(path, { allow404: true });
                if (data.byteLength > 0) {
                    // Decode TGA
                    const texture = await this.decodeTGA(data);
                    this.textures.push(texture);
                } else {
                    console.warn(`Failed to load skybox texture: ${path}`);
                    this.textures.push(this.createPlaceholderTexture());
                }
            } catch (e) {
                console.warn(`Failed to load skybox texture: ${path}`, e);
                this.textures.push(this.createPlaceholderTexture());
            }
        }

        this.loaded = this.textures.length === 6;
    }

    private device: GfxDevice | null = null;

    private createPlaceholderTexture(): GfxTexture {
        const device = this.device!;
        const texture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, 1, 1, 1));
        device.uploadTextureData(texture, 0, [new Uint8Array([128, 128, 128, 255])]);
        return texture;
    }

    private async decodeTGA(data: ArrayBufferSlice): Promise<GfxTexture> {
        const view = data.createDataView();

        // Parse TGA header
        const idLength = view.getUint8(0);
        const colorMapType = view.getUint8(1);
        const imageType = view.getUint8(2);
        const width = view.getUint16(12, true);
        const height = view.getUint16(14, true);
        const bitsPerPixel = view.getUint8(16);
        const descriptor = view.getUint8(17);

        const imageDataOffset = 18 + idLength + (colorMapType ? view.getUint16(5, true) * (view.getUint8(7) / 8) : 0);

        const rgba = new Uint8Array(width * height * 4);
        const bytesPerPixel = bitsPerPixel / 8;

        const flipVertical = !((descriptor >> 5) & 1);

        for (let y = 0; y < height; y++) {
            const srcY = flipVertical ? (height - 1 - y) : y;
            for (let x = 0; x < width; x++) {
                const srcIdx = imageDataOffset + (srcY * width + x) * bytesPerPixel;
                const dstIdx = (y * width + x) * 4;

                if (bitsPerPixel === 32) {
                    rgba[dstIdx + 0] = view.getUint8(srcIdx + 2); // R (TGA is BGRA)
                    rgba[dstIdx + 1] = view.getUint8(srcIdx + 1); // G
                    rgba[dstIdx + 2] = view.getUint8(srcIdx + 0); // B
                    rgba[dstIdx + 3] = view.getUint8(srcIdx + 3); // A
                } else if (bitsPerPixel === 24) {
                    rgba[dstIdx + 0] = view.getUint8(srcIdx + 2); // R (TGA is BGR)
                    rgba[dstIdx + 1] = view.getUint8(srcIdx + 1); // G
                    rgba[dstIdx + 2] = view.getUint8(srcIdx + 0); // B
                    rgba[dstIdx + 3] = 255;
                }
            }
        }

        if (!this.device)
            throw new Error("Device not set");

        const texture = this.device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, width, height, 1));
        this.device.uploadTextureData(texture, 0, [rgba]);
        return texture;
    }

    public setDevice(device: GfxDevice): void {
        this.device = device;
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, view: IdTech2View): void {
        if (!this.loaded || this.textures.length < 6)
            return;

        const template = renderInstManager.pushTemplate();
        template.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);
        template.setBindingLayouts([{ numSamplers: 1, numUniformBuffers: 1 }]);
        template.setGfxProgram(this.gfxProgram);

        for (let i = 0; i < 6; i++) {
            const renderInst = renderInstManager.newRenderInst();

            this.textureMapping.gfxTexture = this.textures[i];
            renderInst.setSamplerBindingsFromTextureMappings([this.textureMapping]);

            let offs = renderInst.allocateUniformBuffer(Q2SkyboxProgram.ub_SceneParams, 16);
            const d = renderInst.mapUniformBufferF32(Q2SkyboxProgram.ub_SceneParams);
            offs += fillMatrix4x4(d, offs, view.clipFromWorldMatrix);

            renderInst.setDrawCount(6, i * 6);
            view.skyList.submitRenderInst(renderInst);
        }

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        for (const tex of this.textures)
            device.destroyTexture(tex);
    }
}


class Q2BSPSurfaceRenderer {
    private textureMapping = nArray(2, () => new TextureMapping());
    private visible = true;
    private gfxProgram: GfxProgram | null = null;
    private sky = false;
    private warp = false;

    constructor(cache: GfxRenderCache, textureCache: Q2TextureCache, private surface: Surface) {
        const texName = this.surface.texName;

        if (isToolTexture(texName)) {
            this.visible = false;
            return;
        }

        const texture = textureCache.findTexture(texName);
        this.textureMapping[0].gfxTexture = texture.gfxTexture;

        // Check for sky/warp based on texture name patterns
        const lowerName = texName.toLowerCase();
        if (lowerName.includes('/sky') || lowerName.startsWith('sky')) {
            this.sky = true;
            // Don't create a program for sky surfaces - they will be skipped
            // in favor of the skybox renderer
            return;
        }
        if (lowerName.includes('water') || lowerName.includes('lava') || lowerName.includes('slime'))
            this.warp = true;

        const program = new Q2Program();
        program.setDefineBool('USE_LIGHTMAP', !this.warp);
        program.setDefineBool('USE_WARP', this.warp);
        this.gfxProgram = cache.createProgram(program);
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, lightmapManager: Q2LightmapManager, view: IdTech2View, modelMatrix: ReadonlyMat4): void {
        if (!this.visible || this.gfxProgram === null)
            return;

        this.textureMapping[1].gfxTexture = lightmapManager.gfxTexture;

        const renderInst = renderInstManager.newRenderInst();
        renderInst.setGfxProgram(this.gfxProgram);
        renderInst.setDrawCount(this.surface.indexCount, this.surface.startIndex);
        renderInst.setSamplerBindingsFromTextureMappings(this.textureMapping);

        let offs = renderInst.allocateUniformBuffer(Q2Program.ub_ModelParams, 16);
        const d = renderInst.mapUniformBufferF32(Q2Program.ub_ModelParams);
        offs += fillMatrix4x4(d, offs, modelMatrix);

        const list = this.sky ? view.skyList : view.mainList;
        list.submitRenderInst(renderInst);
    }
}

const identityMatrix = mat4.create();

class Q2BSPModelRenderer {
    public visible: boolean = true;
    public surfaceRenderers: Q2BSPSurfaceRenderer[] = [];

    constructor(cache: GfxRenderCache, textureCache: Q2TextureCache, private model: Model, private surfaces: Surface[], private lightmapManager: Q2LightmapManager) {
        for (let i = 0; i < model.surfaces.length; i++) {
            const surface = surfaces[model.surfaces[i]];
            this.surfaceRenderers.push(new Q2BSPSurfaceRenderer(cache, textureCache, surface));

            for (let j = 0; j < surface.lightmapData.length; j++)
                lightmapManager.addSurface(surface.lightmapData[j]);
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, view: IdTech2View): void {
        if (!this.visible)
            return;

        for (let i = 0; i < this.surfaceRenderers.length; i++)
            this.surfaceRenderers[i].prepareToRender(renderInstManager, this.lightmapManager, view, identityMatrix);
    }
}

class Q2LightmapManager {
    public gfxTexture: GfxTexture;
    public lightmapData: SurfaceLightmapData[] = [];
    private lightmapPixelData: Uint8ClampedArray;
    private width: number;
    private height: number;

    constructor(device: GfxDevice, private packerPage: LightmapPackerPage) {
        // Use at least 1x1 to avoid WebGL errors if no lightmaps were allocated
        this.width = Math.max(1, packerPage.width);
        this.height = Math.max(1, packerPage.height);
        this.gfxTexture = device.createTexture(makeTextureDescriptor2D(GfxFormat.U8_RGBA_NORM, this.width, this.height, 1));
        const numPixels = this.width * this.height;
        this.lightmapPixelData = new Uint8ClampedArray(numPixels * 4);
    }

    public addSurface(lightmapData: SurfaceLightmapData): void {
        this.lightmapData.push(lightmapData);
    }

    public prepareToRender(device: GfxDevice, worldLightingState: WorldLightingState): void {
        const dst = this.lightmapPixelData;
        dst.fill(0);

        // Quake 2 uses RGB lightmaps (3 bytes per texel)
        const bytesPerTexel = 3;

        for (let i = 0; i < this.lightmapData.length; i++) {
            const lightmapData = this.lightmapData[i];

            if (lightmapData.samples === null)
                continue;

            const src = lightmapData.samples;
            const numStyles = lightmapData.styles.length;
            const styleSize = lightmapData.width * lightmapData.height * bytesPerTexel;

            for (let y = 0; y < lightmapData.height; y++) {
                let dstOffs = (this.width * (lightmapData.pagePosY + y) + lightmapData.pagePosX) * 4;
                for (let x = 0; x < lightmapData.width; x++) {
                    let r = 0, g = 0, b = 0;
                    for (let styleIdx = 0; styleIdx < numStyles; styleIdx++) {
                        const styleNum = lightmapData.styles[styleIdx];
                        const styleValue = worldLightingState.getValue(styleNum);
                        const styleOffset = styleIdx * styleSize;
                        const pixelOffset = styleOffset + (y * lightmapData.width + x) * 3;

                        r += src[pixelOffset + 0] * styleValue;
                        g += src[pixelOffset + 1] * styleValue;
                        b += src[pixelOffset + 2] * styleValue;
                    }
                    dst[dstOffs++] = Math.min(255, r);
                    dst[dstOffs++] = Math.min(255, g);
                    dst[dstOffs++] = Math.min(255, b);
                    dst[dstOffs++] = 0xFF;
                }
            }
        }
        
        device.uploadTextureData(this.gfxTexture, 0, [dst]);
    }

    public destroy(device: GfxDevice): void {
        device.destroyTexture(this.gfxTexture);
    }
}

export class Q2BSPRenderer {
    public modelRenderers: Q2BSPModelRenderer[] = [];

    private inputLayout: GfxInputLayout;
    private vertexBuffer: GfxBuffer;
    private indexBuffer: GfxBuffer;
    private vertexBufferDescriptors: GfxVertexBufferDescriptor[];
    private indexBufferDescriptor: GfxIndexBufferDescriptor;

    private lightmapManager: Q2LightmapManager;

    constructor(cache: GfxRenderCache, textureCache: Q2TextureCache, private bsp: BSPFileQ2) {
        const device = cache.device;

        const vertexAttributeDescriptors: GfxVertexAttributeDescriptor[] = [
            { location: Q2Program.a_Position, bufferIndex: 0, bufferByteOffset: 0*0x04, format: GfxFormat.F32_RGB, },
            { location: Q2Program.a_TexCoord, bufferIndex: 0, bufferByteOffset: 3*0x04, format: GfxFormat.F32_RGBA, },
        ];
        const vertexBufferDescriptors: GfxInputLayoutBufferDescriptor[] = [
            { byteStride: (3+4)*0x04, frequency: GfxVertexBufferFrequency.PerVertex, },
        ];
        const indexBufferFormat = bsp.useU32Indices ? GfxFormat.U32_R : GfxFormat.U16_R;
        this.inputLayout = cache.createInputLayout({ vertexAttributeDescriptors, vertexBufferDescriptors, indexBufferFormat });

        this.vertexBuffer = createBufferFromData(device, GfxBufferUsage.Vertex, GfxBufferFrequencyHint.Static, this.bsp.vertexData);
        this.indexBuffer = createBufferFromData(device, GfxBufferUsage.Index, GfxBufferFrequencyHint.Static, this.bsp.indexData);

        this.vertexBufferDescriptors = [
            { buffer: this.vertexBuffer },
        ];
        this.indexBufferDescriptor = { buffer: this.indexBuffer };

        this.lightmapManager = new Q2LightmapManager(device, this.bsp.lightmapPackerPage);

        for (let i = 0; i < this.bsp.models.length; i++) {
            const model = this.bsp.models[i];
            const modelRenderer = new Q2BSPModelRenderer(cache, textureCache, model, this.bsp.surfaces, this.lightmapManager);
            // Model 0 (worldspawn) is always visible
            modelRenderer.visible = (i === 0);
            this.modelRenderers.push(modelRenderer);
        }

        this.processEntities(this.bsp.entities);
    }

    private processEntities(entities: BSPEntity[]): void {
        for (const entity of entities) {
            if (!entity.model || !entity.model.startsWith('*'))
                continue;

            const modelIndex = parseInt(entity.model.slice(1), 10);
            if (modelIndex <= 0 || modelIndex >= this.modelRenderers.length)
                continue;

            const classname = entity.classname || '';

            if (classname.startsWith('trigger_'))
                continue;

            const modelRenderer = this.modelRenderers[modelIndex];
            modelRenderer.visible = true;
        }
    }

    public prepareToRender(renderInstManager: GfxRenderInstManager, view: IdTech2View, worldLightingState: WorldLightingState): void {
        this.lightmapManager.prepareToRender(renderInstManager.gfxRenderCache.device, worldLightingState);

        const template = renderInstManager.pushTemplate();
        template.setBindingLayouts([{ numSamplers: 2, numUniformBuffers: 2 }]);
        template.setVertexInput(this.inputLayout, this.vertexBufferDescriptors, this.indexBufferDescriptor);
        template.setMegaStateFlags({ cullMode: GfxCullMode.Back, frontFace: GfxFrontFaceMode.CW });

        let offs = template.allocateUniformBuffer(Q2Program.ub_SceneParams, 16+4);
        const d = template.mapUniformBufferF32(Q2Program.ub_SceneParams);
        offs += fillMatrix4x4(d, offs, view.clipFromWorldMatrix);
        offs += fillVec4(d, offs, view.time);

        for (let i = 0; i < this.modelRenderers.length; i++)
            this.modelRenderers[i].prepareToRender(renderInstManager, view);

        renderInstManager.popTemplate();
    }

    public destroy(device: GfxDevice): void {
        device.destroyBuffer(this.vertexBuffer);
        device.destroyBuffer(this.indexBuffer);
        this.lightmapManager.destroy(device);
    }
}

export class Quake2Renderer implements SceneGfx {
    public textureCache: Q2TextureCache;
    public textureHolder: Q2TextureCache;
    public bspRenderers: Q2BSPRenderer[] = [];
    public renderHelper: GfxRenderHelper;
    public worldLightingState: WorldLightingState;
    public skyboxRenderer: Q2SkyboxRenderer | null = null;

    public mainView = new IdTech2View();

    private dataFetcher: DataFetcher;
    private pathBase: string;

    constructor(device: GfxDevice, dataFetcher: DataFetcher, pathBase: string) {
        this.renderHelper = new GfxRenderHelper(device);
        this.textureCache = new Q2TextureCache(this.renderHelper.renderCache, dataFetcher, pathBase);
        this.textureHolder = this.textureCache;
        this.worldLightingState = new WorldLightingState();
        this.dataFetcher = dataFetcher;
        this.pathBase = pathBase;
    }

    public createSkybox(skyName: string): void {
        if (this.skyboxRenderer)
            this.skyboxRenderer.destroy(this.renderHelper.renderCache.device);
        this.skyboxRenderer = new Q2SkyboxRenderer(this.renderHelper.renderCache, this.dataFetcher, this.pathBase, skyName);
        this.skyboxRenderer.setDevice(this.renderHelper.renderCache.device);
    }

    public adjustCameraController(c: CameraController): void {
        c.setSceneMoveSpeedMult(4/60);
    }

    private prepareToRender(renderInstManager: GfxRenderInstManager, viewerInput: ViewerRenderInput): void {
        this.mainView.time += viewerInput.deltaTime / 1000;
        this.mainView.setupFromCamera(viewerInput.camera);

        this.worldLightingState.update(this.mainView.time);

        this.renderHelper.pushTemplateRenderInst();

        // Render skybox first
        if (this.skyboxRenderer)
            this.skyboxRenderer.prepareToRender(renderInstManager, this.mainView);

        for (let i = 0; i < this.bspRenderers.length; i++)
            this.bspRenderers[i].prepareToRender(renderInstManager, this.mainView, this.worldLightingState);

        renderInstManager.popTemplate();
        this.renderHelper.prepareToRender();
    }

    public render(device: GfxDevice, viewerInput: ViewerRenderInput) {
        const renderInstManager = this.renderHelper.renderInstManager;
        const builder = this.renderHelper.renderGraph.newGraphBuilder();

        const mainColorDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.Color0, viewerInput, standardFullClearRenderPassDescriptor);
        const mainDepthDesc = makeBackbufferDescSimple(GfxrAttachmentSlot.DepthStencil, viewerInput, standardFullClearRenderPassDescriptor);

        const mainColorTargetID = builder.createRenderTargetID(mainColorDesc, 'Main Color');
        builder.pushPass((pass) => {
            pass.setDebugName('Skybox');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            const skyboxDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Skybox Depth');
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, skyboxDepthTargetID);
            pass.exec((passRenderer) => {
                this.mainView.skyList.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        const mainDepthTargetID = builder.createRenderTargetID(mainDepthDesc, 'Main Depth');
        builder.pushPass((pass) => {
            pass.setDebugName('Main');
            pass.attachRenderTargetID(GfxrAttachmentSlot.Color0, mainColorTargetID);
            pass.attachRenderTargetID(GfxrAttachmentSlot.DepthStencil, mainDepthTargetID);
            pass.exec((passRenderer) => {
                this.mainView.mainList.drawOnPassRenderer(this.renderHelper.renderCache, passRenderer);
            });
        });
        this.renderHelper.antialiasingSupport.pushPasses(builder, viewerInput, mainColorTargetID);
        builder.resolveRenderTargetToExternalTexture(mainColorTargetID, viewerInput.onscreenTexture);

        this.prepareToRender(renderInstManager, viewerInput);
        this.renderHelper.renderGraph.execute(builder);
        this.mainView.reset();
    }

    public destroy(device: GfxDevice): void {
        for (let i = 0; i < this.bspRenderers.length; i++)
            this.bspRenderers[i].destroy(device);
        if (this.skyboxRenderer)
            this.skyboxRenderer.destroy(device);
        this.renderHelper.destroy();
        this.textureCache.destroy(device);
    }
}

