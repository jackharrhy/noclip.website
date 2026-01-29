
import ArrayBufferSlice from "../../ArrayBufferSlice.js";
import { assert, readString } from "../../util.js";

// Quake 2 WAL texture format
// 32 bytes name + 4 bytes width + 4 bytes height + 16 bytes offsets + 32 bytes animname + 12 bytes flags/contents/value

export interface WALTexture {
    name: string;
    width: number;
    height: number;
    mipOffsets: number[];
    animName: string;
    flags: number;
    contents: number;
    value: number;
    data: ArrayBufferSlice;
}

export function parseWAL(buffer: ArrayBufferSlice): WALTexture {
    // WAL header is 100 bytes (0x64)
    if (buffer.byteLength < 0x64) {
        throw new Error(`WAL file too small: ${buffer.byteLength} bytes`);
    }

    const view = buffer.createDataView();

    const name = readString(buffer, 0x00, 0x20, true);
    const width = view.getUint32(0x20, true);
    const height = view.getUint32(0x24, true);

    // Validate dimensions
    if (width === 0 || height === 0 || width > 4096 || height > 4096) {
        throw new Error(`Invalid WAL dimensions: ${width}x${height}`);
    }

    const mipOffsets: number[] = [];
    for (let i = 0; i < 4; i++) {
        mipOffsets.push(view.getUint32(0x28 + i * 4, true));
    }

    // Validate first mip offset - should point within the file
    if (mipOffsets[0] < 0x64 || mipOffsets[0] >= buffer.byteLength) {
        throw new Error(`Invalid WAL mip offset: ${mipOffsets[0]}`);
    }

    // Validate there's enough data for the first mip
    const expectedSize = mipOffsets[0] + width * height;
    if (buffer.byteLength < expectedSize) {
        throw new Error(`WAL file too small for texture data: have ${buffer.byteLength}, need ${expectedSize}`);
    }

    const animName = readString(buffer, 0x38, 0x20, true);
    const flags = view.getUint32(0x58, true);
    const contents = view.getUint32(0x5C, true);
    const value = view.getUint32(0x60, true);

    return {
        name,
        width,
        height,
        mipOffsets,
        animName,
        flags,
        contents,
        value,
        data: buffer,
    };
}

// Standard Quake 2 palette (256 RGB entries), loaded from pics/colormap.pcx
export function parseColormapPCX(buffer: ArrayBufferSlice): Uint8Array {
    const view = buffer.createDataView();

    // PCX header is 128 bytes
    // Palette is at the end of the file, after 0x0C marker, 768 bytes (256 * 3)
    const fileSize = buffer.byteLength;
    const paletteMarker = view.getUint8(fileSize - 769);
    assert(paletteMarker === 0x0C, 'PCX file does not have valid palette marker');

    const palette = buffer.createTypedArray(Uint8Array, fileSize - 768, 768);
    return palette;
}
