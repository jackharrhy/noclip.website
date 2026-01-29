
import { ReadonlyVec4 } from "gl-matrix";
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { AABB } from "../../Geometry.js";
import { convertToTrianglesRange, getTriangleIndexCountForTopologyIndexCount, GfxTopology } from "../../gfx/helpers/TopologyHelpers.js";
import { LightmapPackerPage } from "../../SourceEngine/BSPFile.js";
import { assert, decodeString, ensureInList, readString } from "../../util.js";
import { BSPEntity, parseEntitiesLump, readVec4, SurfaceLightmapData, Surface, TexinfoMapping } from "./IdTech2Common.js";

// Quake 2 BSP format constants
const IDBSPHEADER = 0x50534249; // 'IBSP' in little-endian
const BSPXHEADER = 0x58505342; // 'BSPX' in little-endian
const BSPVERSION = 38;

// BSPX DECOUPLED_LM entry (40 bytes per face)
interface DecoupledLMEntry {
    width: number;
    height: number;
    offset: number;
    axisS: Float32Array; // vec3
    offsetS: number;
    axisT: Float32Array; // vec3
    offsetT: number;
}

enum LumpType {
    ENTITIES = 0,
    PLANES = 1,
    VERTEXES = 2,
    VISIBILITY = 3,
    NODES = 4,
    TEXINFO = 5,
    FACES = 6,
    LIGHTING = 7,
    LEAFS = 8,
    LEAFFACES = 9,
    LEAFBRUSHES = 10,
    EDGES = 11,
    SURFEDGES = 12,
    MODELS = 13,
    BRUSHES = 14,
    BRUSHSIDES = 15,
    POP = 16, // unused
    AREAS = 17,
    AREAPORTALS = 18,
}

interface Texinfo {
    textureMapping: TexinfoMapping;
    textureName: string;
    flags: number;
    value: number;
}

export interface Model {
    bbox: AABB;
    headnode: number;
    surfaces: number[];
}

// Re-export shared types for external consumers
export type { BSPEntity, SurfaceLightmapData, Surface } from "./IdTech2Common.js";

// Surface flags from Quake 2
const SURF_SKY = 0x4;
const SURF_WARP = 0x8; // Turbulent water warp
const SURF_TRANS33 = 0x10;
const SURF_TRANS66 = 0x20;
const SURF_FLOWING = 0x40;
const SURF_NODRAW = 0x80;

export class BSPFileQ2 {
    public version: number;

    private entitiesStr: string;
    public models: Model[] = [];
    public entities: BSPEntity[] = [];
    public indexData: ArrayBuffer;
    public vertexData: ArrayBuffer;
    public surfaces: Surface[] = [];
    public textureNames: Set<string> = new Set();
    public lightmapPackerPage = new LightmapPackerPage(2048, 2048);
    public useU32Indices: boolean = false;
    public skyName: string | null = null;

    constructor(buffer: ArrayBufferSlice) {
        const view = buffer.createDataView();

        // Check header
        const magic = view.getUint32(0x00, true);
        assert(magic === IDBSPHEADER, `Invalid BSP magic: expected IBSP`);

        this.version = view.getUint32(0x04, true);
        assert(this.version === BSPVERSION, `Unsupported BSP version: ${this.version}, expected ${BSPVERSION}`);

        function getLumpData(lumpType: LumpType): ArrayBufferSlice {
            const lumpsStart = 0x08;
            const idx = lumpsStart + lumpType * 0x08;
            const offs = view.getUint32(idx + 0x00, true);
            const size = view.getUint32(idx + 0x04, true);
            return buffer.subarray(offs, size);
        }

        // Find BSPX extension header (after all standard lumps)
        function findBSPXLump(name: string): ArrayBufferSlice | null {
            // BSPX header is after all regular lump data
            // Search for 'BSPX' magic in the file
            const dataView = buffer.createDataView();
            for (let pos = 0; pos < buffer.byteLength - 8; pos += 4) {
                if (dataView.getUint32(pos, true) === BSPXHEADER) {
                    const numlumps = dataView.getUint32(pos + 4, true);
                    // Each xlump entry: name[24] + offset[4] + length[4] = 32 bytes
                    for (let i = 0; i < numlumps; i++) {
                        const entryOff = pos + 8 + i * 32;
                        const lumpName = readString(buffer, entryOff, 24, true);
                        if (lumpName === name) {
                            const lumpOffset = dataView.getUint32(entryOff + 24, true);
                            const lumpLength = dataView.getUint32(entryOff + 28, true);
                            return buffer.subarray(lumpOffset, lumpLength);
                        }
                    }
                    return null;
                }
            }
            return null;
        }

        // Parse DECOUPLED_LM from BSPX if present
        const decoupledLMData = findBSPXLump('DECOUPLED_LM');
        const decoupledLM: DecoupledLMEntry[] = [];
        if (decoupledLMData !== null) {
            const dlmView = decoupledLMData.createDataView();
            const numEntries = decoupledLMData.byteLength / 40;
            for (let i = 0; i < numEntries; i++) {
                const off = i * 40;
                decoupledLM.push({
                    width: dlmView.getUint16(off + 0, true),
                    height: dlmView.getUint16(off + 2, true),
                    offset: dlmView.getUint32(off + 4, true),
                    axisS: new Float32Array([
                        dlmView.getFloat32(off + 8, true),
                        dlmView.getFloat32(off + 12, true),
                        dlmView.getFloat32(off + 16, true),
                    ]),
                    offsetS: dlmView.getFloat32(off + 20, true),
                    axisT: new Float32Array([
                        dlmView.getFloat32(off + 24, true),
                        dlmView.getFloat32(off + 28, true),
                        dlmView.getFloat32(off + 32, true),
                    ]),
                    offsetT: dlmView.getFloat32(off + 36, true),
                });
            }
            console.log(`Q2 BSP: Found DECOUPLED_LM with ${numEntries} entries`);
        }

        // Parse entities
        this.entitiesStr = decodeString(getLumpData(LumpType.ENTITIES));
        this.entities = parseEntitiesLump(this.entitiesStr);
        
        // Get sky name from worldspawn entity
        const worldspawn = this.entities.find(e => e.classname === 'worldspawn');
        if (worldspawn && worldspawn.sky)
            this.skyName = worldspawn.sky;

        // Parse texinfo (76 bytes each)
        const texinfoa: Texinfo[] = [];
        const texinfo = getLumpData(LumpType.TEXINFO).createDataView();
        const texinfoCount = texinfo.byteLength / 76;
        for (let i = 0; i < texinfoCount; i++) {
            const infoOffs = i * 76;
            const textureMappingS = readVec4(texinfo, infoOffs + 0x00);
            const textureMappingT = readVec4(texinfo, infoOffs + 0x10);
            const textureMapping: TexinfoMapping = { s: textureMappingS, t: textureMappingT };
            const flags = texinfo.getUint32(infoOffs + 0x20, true);
            const value = texinfo.getUint32(infoOffs + 0x24, true);
            const textureName = readString(getLumpData(LumpType.TEXINFO).slice(infoOffs + 0x28), 0x00, 0x20, true);
            // next texinfo at 0x48 (for animation chains) - ignore for now
            texinfoa.push({ textureMapping, textureName, flags, value });
            // Only add non-empty texture names
            if (textureName && textureName.trim() !== '')
                this.textureNames.add(textureName);
        }

        // Parse edges / surfedges
        const edges = getLumpData(LumpType.EDGES).createTypedArray(Uint16Array);
        const surfedges = getLumpData(LumpType.SURFEDGES).createTypedArray(Int32Array);
        const vertindices = new Uint32Array(surfedges.length);
        for (let i = 0; i < surfedges.length; i++) {
            const surfedge = surfedges[i];
            if (surfedge >= 0)
                vertindices[i] = edges[surfedge * 2 + 0];
            else
                vertindices[i] = edges[-surfedge * 2 + 1];
        }

        // Parse faces (20 bytes each)
        const facelist = getLumpData(LumpType.FACES).createDataView();

        interface Face {
            index: number;
            texinfo: number;
            texName: string;
            flags: number;
        }
        const faces: Face[] = [];

        let numVertexData = 0, numIndexData = 0;
        for (let i = 0; i < facelist.byteLength / 20; i++) {
            const idx = i * 20;
            const numedges = facelist.getUint16(idx + 0x08, true);
            const texinfoIdx = facelist.getUint16(idx + 0x0A, true);

            const texName = texinfoa[texinfoIdx].textureName;
            const flags = texinfoa[texinfoIdx].flags;
            faces.push({ index: i, texinfo: texinfoIdx, texName, flags });

            numVertexData += numedges;
            numIndexData += getTriangleIndexCountForTopologyIndexCount(GfxTopology.TriFans, numedges);
        }

        faces.sort((a, b) => a.texName.localeCompare(b.texName));

        // Parse models (48 bytes each)
        const models = getLumpData(LumpType.MODELS).createDataView();
        const faceToModelIdx: number[] = [];
        for (let idx = 0x00; idx < models.byteLength; idx += 48) {
            const minX = models.getFloat32(idx + 0x00, true);
            const minY = models.getFloat32(idx + 0x04, true);
            const minZ = models.getFloat32(idx + 0x08, true);
            const maxX = models.getFloat32(idx + 0x0C, true);
            const maxY = models.getFloat32(idx + 0x10, true);
            const maxZ = models.getFloat32(idx + 0x14, true);
            const bbox = new AABB(minX, minY, minZ, maxX, maxY, maxZ);

            // origin at 0x18-0x24 (ignored)
            const headnode = models.getUint32(idx + 0x24, true);
            const firstface = models.getUint32(idx + 0x28, true);
            const numfaces = models.getUint32(idx + 0x2C, true);

            const modelIndex = this.models.length;
            for (let i = firstface; i < firstface + numfaces; i++)
                faceToModelIdx[i] = modelIndex;
            this.models.push({ bbox, headnode, surfaces: [] });
        }

        const vertexData = new Float32Array(numVertexData * 7);
        let dstOffsVertex = 0;

        // Use Uint32Array if we have more than 65535 vertices
        this.useU32Indices = numVertexData > 65535;
        if (this.useU32Indices)
            console.log(`Q2 BSP: Using 32-bit indices (${numVertexData} vertices)`);
        const indexData = this.useU32Indices ? new Uint32Array(numIndexData) : new Uint16Array(numIndexData);
        let dstOffsIndex = 0;
        let dstIndexBase = 0;

        // Build surface meshes
        const vertexes = getLumpData(LumpType.VERTEXES).createTypedArray(Float32Array);
        const lighting = getLumpData(LumpType.LIGHTING);
        
        for (let i = 0; i < faces.length; i++) {
            const face = faces[i];
            const idx = face.index * 20;
            const planenum = facelist.getUint16(idx + 0x00, true);
            const side = facelist.getUint16(idx + 0x02, true);
            const firstedge = facelist.getUint32(idx + 0x04, true);
            const numedges = facelist.getUint16(idx + 0x08, true);

            const styles: number[] = [];
            for (let j = 0; j < 4; j++) {
                const style = facelist.getUint8(idx + 0x0C + j);
                if (style === 0xFF)
                    break;
                styles.push(style);
            }

            const lightofs = facelist.getUint32(idx + 0x10, true);

            let mergeSurface: Surface | null = null;
            if (i > 0) {
                const prevFace = faces[i - 1];
                let canMerge = true;

                if (face.texName !== prevFace.texName)
                    canMerge = false;
                else if (faceToModelIdx[prevFace.index] !== faceToModelIdx[face.index])
                    canMerge = false;

                if (canMerge)
                    mergeSurface = this.surfaces[this.surfaces.length - 1];
            }

            const m = texinfoa[face.texinfo].textureMapping;
            let minTexCoordS = Infinity, minTexCoordT = Infinity;
            let maxTexCoordS = -Infinity, maxTexCoordT = -Infinity;

            const dstOffsVertexBase = dstOffsVertex;
            for (let j = 0; j < numedges; j++) {
                const vertIndex = vertindices[firstedge + j];
                const px = vertexes[vertIndex * 3 + 0];
                const py = vertexes[vertIndex * 3 + 1];
                const pz = vertexes[vertIndex * 3 + 2];

                const texCoordS = Math.fround(px * m.s[0] + py * m.s[1] + pz * m.s[2] + m.s[3]);
                const texCoordT = Math.fround(px * m.t[0] + py * m.t[1] + pz * m.t[2] + m.t[3]);

                vertexData[dstOffsVertex++] = px;
                vertexData[dstOffsVertex++] = py;
                vertexData[dstOffsVertex++] = pz;

                vertexData[dstOffsVertex++] = texCoordS;
                vertexData[dstOffsVertex++] = texCoordT;

                // Dummy lightmap coords, filled in later
                vertexData[dstOffsVertex++] = 0;
                vertexData[dstOffsVertex++] = 0;

                minTexCoordS = Math.min(minTexCoordS, texCoordS);
                minTexCoordT = Math.min(minTexCoordT, texCoordT);
                maxTexCoordS = Math.max(maxTexCoordS, texCoordS);
                maxTexCoordT = Math.max(maxTexCoordT, texCoordT);
            }

            // Use DECOUPLED_LM if available, otherwise fall back to standard lightmap calculation
            const dlm = decoupledLM[face.index];
            let surfaceW: number, surfaceH: number;
            let samples: Uint8Array | null = null;
            let usesDecoupledLM = false;

            if (dlm && dlm.offset !== 0xFFFFFFFF && dlm.width > 0 && dlm.height > 0) {
                // Use BSPX DECOUPLED_LM
                surfaceW = dlm.width;
                surfaceH = dlm.height;
                usesDecoupledLM = true;

                const bytesPerTexel = 3;
                const lightmapSamplesSize = surfaceW * surfaceH * styles.length * bytesPerTexel;
                if (styles.length > 0 && lightmapSamplesSize > 0 && dlm.offset + lightmapSamplesSize <= lighting.byteLength) {
                    samples = lighting.subarray(dlm.offset, lightmapSamplesSize).createTypedArray(Uint8Array);
                }
            } else {
                // Standard Q2 lightmap calculation
                const lightmapScale = 1 / 16;
                if (!isFinite(minTexCoordS) || !isFinite(maxTexCoordS) || !isFinite(minTexCoordT) || !isFinite(maxTexCoordT)) {
                    minTexCoordS = minTexCoordT = 0;
                    maxTexCoordS = maxTexCoordT = 16;
                }
                surfaceW = Math.max(1, Math.ceil((maxTexCoordS * lightmapScale)) - Math.floor(minTexCoordS * lightmapScale) + 1);
                surfaceH = Math.max(1, Math.ceil((maxTexCoordT * lightmapScale)) - Math.floor(minTexCoordT * lightmapScale) + 1);

                const bytesPerTexel = 3;
                const lightmapSamplesSize = (surfaceW * surfaceH * styles.length * bytesPerTexel);
                if (lightofs !== 0xFFFFFFFF && styles.length > 0 && lightmapSamplesSize > 0) {
                    samples = lighting.subarray(lightofs, lightmapSamplesSize).createTypedArray(Uint8Array);
                }
            }

            const lightmapData: SurfaceLightmapData = {
                faceIndex: face.index,
                width: surfaceW, height: surfaceH,
                pageIndex: 0, pagePosX: 0, pagePosY: 0,
                styles, samples,
            };

            if (lightmapData.samples !== null)
                assert(this.lightmapPackerPage.allocate(lightmapData));

            // Fill in lightmap UV
            for (let j = 0; j < numedges; j++) {
                let offs = dstOffsVertexBase + (j * 7) + 3;

                // Get vertex position for DECOUPLED_LM calculation
                const posOffs = dstOffsVertexBase + (j * 7);
                const px = vertexData[posOffs + 0];
                const py = vertexData[posOffs + 1];
                const pz = vertexData[posOffs + 2];

                let lightmapCoordS: number, lightmapCoordT: number;

                if (usesDecoupledLM && dlm) {
                    // DECOUPLED_LM uses its own axis vectors for UV calculation
                    lightmapCoordS = px * dlm.axisS[0] + py * dlm.axisS[1] + pz * dlm.axisS[2] + dlm.offsetS + 0.5;
                    lightmapCoordT = px * dlm.axisT[0] + py * dlm.axisT[1] + pz * dlm.axisT[2] + dlm.offsetT + 0.5;
                } else {
                    const texCoordS = vertexData[offs++];
                    const texCoordT = vertexData[offs++];
                    const lightmapScale = 1 / 16;
                    lightmapCoordS = (texCoordS * lightmapScale) - Math.floor(minTexCoordS * lightmapScale) + 0.5;
                    lightmapCoordT = (texCoordT * lightmapScale) - Math.floor(minTexCoordT * lightmapScale) + 0.5;
                    offs -= 2; // Reset for writing
                }

                offs += 2; // Skip diffuse tex coords
                vertexData[offs++] = lightmapData.pagePosX + lightmapCoordS;
                vertexData[offs++] = lightmapData.pagePosY + lightmapCoordT;
            }

            let surface = mergeSurface;

            if (surface === null) {
                surface = { texName: face.texName, startIndex: dstOffsIndex, indexCount: 0, lightmapData: [] };
                this.surfaces.push(surface);
            }

            const indexCount = getTriangleIndexCountForTopologyIndexCount(GfxTopology.TriFans, numedges);
            convertToTrianglesRange(indexData, dstOffsIndex, GfxTopology.TriFans, dstIndexBase, numedges);

            const surfaceIndex = this.surfaces.length - 1;

            const model = this.models[faceToModelIdx[face.index]];
            ensureInList(model.surfaces, surfaceIndex);

            surface.lightmapData.push(lightmapData);
            surface.indexCount += indexCount;

            dstOffsIndex += indexCount;
            dstIndexBase += numedges;
        }

        this.vertexData = vertexData.buffer as ArrayBuffer;
        this.indexData = indexData.buffer as ArrayBuffer;
    }
}

