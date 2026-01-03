/**
 * AssetLoader - Fetches and parses BSP/WAD/palette assets with progress events
 */

import { LoadProgressDetail, LoadedAssets, MapLoadOptions } from './types.js';

export class AssetLoader extends EventTarget {
    private abortController: AbortController | null = null;

    /**
     * Load all assets required for a map
     */
    async load(options: MapLoadOptions): Promise<LoadedAssets> {
        // Cancel any in-progress load
        this.abort();
        this.abortController = new AbortController();
        const signal = this.abortController.signal;

        const wadUrls = this.parseWadList(options.wads);
        
        let paletteData: ArrayBuffer | null = null;
        const wadData: ArrayBuffer[] = [];
        let bspData: ArrayBuffer;

        try {
            // Phase 1: Load palette (Quake only)
            if (options.palette) {
                this.emitProgress('palette', 0, 1, 'Loading palette...');
                paletteData = await this.fetchWithProgress(options.palette, 'palette', signal);
                this.emitProgress('palette', 1, 1, 'Palette loaded');
            }

            // Phase 2: Load WADs in parallel
            if (wadUrls.length > 0) {
                this.emitProgress('wads', 0, wadUrls.length, 'Loading textures...');
                const wadPromises = wadUrls.map(async (url, index) => {
                    const data = await this.fetchWithProgress(url, 'wads', signal, index, wadUrls.length);
                    return data;
                });
                const results = await Promise.all(wadPromises);
                wadData.push(...results);
                this.emitProgress('wads', wadUrls.length, wadUrls.length, 'Textures loaded');
            }

            // Phase 3: Load BSP
            this.emitProgress('bsp', 0, 1, 'Loading map...');
            bspData = await this.fetchWithProgress(options.bsp, 'bsp', signal);
            this.emitProgress('bsp', 1, 1, 'Map loaded');

            // Phase 4: Parsing happens in MapRenderer
            this.emitProgress('parsing', 0, 1, 'Parsing map data...');

            return { bspData, wadData, paletteData };

        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
                throw new Error('Loading cancelled');
            }
            throw error;
        }
    }

    /**
     * Abort any in-progress loading
     */
    abort(): void {
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
    }

    private parseWadList(wads: string | string[] | undefined): string[] {
        if (!wads) return [];
        if (Array.isArray(wads)) return wads;
        return wads.split(';').map(s => s.trim()).filter(Boolean);
    }

    private async fetchWithProgress(
        url: string,
        phase: LoadProgressDetail['phase'],
        signal: AbortSignal,
        index: number = 0,
        total: number = 1
    ): Promise<ArrayBuffer> {
        const response = await fetch(url, { signal });
        
        if (!response.ok) {
            throw new Error(`Failed to load ${url}: ${response.status} ${response.statusText}`);
        }

        const contentLength = response.headers.get('content-length');
        const totalBytes = contentLength ? parseInt(contentLength, 10) : 0;

        if (!response.body || totalBytes === 0) {
            // No streaming support or unknown size, just get the buffer
            return response.arrayBuffer();
        }

        // Stream with progress
        const reader = response.body.getReader();
        const chunks: Uint8Array[] = [];
        let loadedBytes = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            
            chunks.push(value);
            loadedBytes += value.length;

            // Emit progress for this specific file within the phase
            // For wads phase, we track individual file progress
            if (phase === 'wads') {
                const fileProgress = loadedBytes / totalBytes;
                const overallProgress = (index + fileProgress) / total;
                this.emitProgress(phase, overallProgress * total, total, `Loading ${this.getFileName(url)}...`);
            }
        }

        // Combine chunks
        const result = new Uint8Array(loadedBytes);
        let offset = 0;
        for (const chunk of chunks) {
            result.set(chunk, offset);
            offset += chunk.length;
        }

        return result.buffer;
    }

    private getFileName(url: string): string {
        const parts = url.split('/');
        return parts[parts.length - 1] || url;
    }

    private emitProgress(
        phase: LoadProgressDetail['phase'],
        loaded: number,
        total: number,
        message?: string
    ): void {
        this.dispatchEvent(new CustomEvent<LoadProgressDetail>('progress', {
            detail: { phase, loaded, total, message }
        }));
    }
}

