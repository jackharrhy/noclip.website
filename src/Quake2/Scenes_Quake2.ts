

import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";
import { BSPFileQ2 } from "../Common/IdTech2/BSPFileQ2.js";
import { Q2BSPRenderer, Quake2Renderer } from "../Common/IdTech2/RenderQ2.js";

const pathBase = `Quake2/baseq2`;

export class Quake2SceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<SceneGfx> {
        const renderer = new Quake2Renderer(device, sceneContext.dataFetcher, pathBase);

        // Initialize texture cache (loads palette)
        await renderer.textureCache.init();

        // Load BSP
        const bspData = await sceneContext.dataFetcher.fetchData(`${pathBase}/maps/${this.id}.bsp`);
        const bspFile = new BSPFileQ2(bspData);

        // Preload all textures used by the BSP
        await renderer.textureCache.preloadTextures(bspFile.textureNames);

        // Create BSP renderer
        const bspRenderer = new Q2BSPRenderer(renderer.renderHelper.renderCache, renderer.textureCache, bspFile);
        renderer.bspRenderers.push(bspRenderer);

        // Create skybox if the map has one
        if (bspFile.skyName)
            renderer.createSkybox(bspFile.skyName);

        return renderer;
    }
}

// Map names based on Quake II level structure
const sceneDescs = [
    "Unit 1: Outer Base",
    new Quake2SceneDesc('base1', "base1 - Outer Base"),
    new Quake2SceneDesc('base2', "base2 - Installation"),
    new Quake2SceneDesc('base3', "base3 - Comm Center"),
    new Quake2SceneDesc('train', "train - Lost Station"),
    "Unit 2: Installation",
    new Quake2SceneDesc('bunk1', "bunk1 - Ammo Depot"),
    new Quake2SceneDesc('ware1', "ware1 - Supply Station"),
    new Quake2SceneDesc('ware2', "ware2 - Warehouse"),
    new Quake2SceneDesc('jail1', "jail1 - Main Gate"),
    new Quake2SceneDesc('jail2', "jail2 - Detention Center"),
    new Quake2SceneDesc('jail3', "jail3 - Security Complex"),
    new Quake2SceneDesc('jail4', "jail4 - Torture Chambers"),
    new Quake2SceneDesc('jail5', "jail5 - Guard House"),
    new Quake2SceneDesc('security', "security - Grid Control"),
    "Unit 3: Refinery",
    new Quake2SceneDesc('mintro', "mintro - Mine Entrance"),
    new Quake2SceneDesc('mine1', "mine1 - Upper Mines"),
    new Quake2SceneDesc('mine2', "mine2 - Borehole"),
    new Quake2SceneDesc('mine3', "mine3 - Drilling Area"),
    new Quake2SceneDesc('mine4', "mine4 - Lower Mines"),
    new Quake2SceneDesc('fact1', "fact1 - Receiving Center"),
    new Quake2SceneDesc('fact2', "fact2 - Processing Plant"),
    new Quake2SceneDesc('fact3', "fact3 - Sudden Death"),
    new Quake2SceneDesc('refinery', "refinery - Refinery"),
    "Unit 4: Power Station",
    new Quake2SceneDesc('power1', "power1 - Power Plant"),
    new Quake2SceneDesc('power2', "power2 - The Reactor"),
    new Quake2SceneDesc('cool1', "cool1 - Cooling Facility"),
    new Quake2SceneDesc('waste1', "waste1 - Toxic Waste Dump"),
    new Quake2SceneDesc('waste2', "waste2 - Pumping Station 1"),
    new Quake2SceneDesc('waste3', "waste3 - Pumping Station 2"),
    new Quake2SceneDesc('biggun', "biggun - Big Gun"),
    "Unit 5: Big Gun",
    new Quake2SceneDesc('hangar1', "hangar1 - Outer Hangar"),
    new Quake2SceneDesc('hangar2', "hangar2 - Inner Hangar"),
    new Quake2SceneDesc('command', "command - Launch Command"),
    new Quake2SceneDesc('strike', "strike - Outlands"),
    "Unit 6: City",
    new Quake2SceneDesc('city1', "city1 - Outer Courts"),
    new Quake2SceneDesc('city2', "city2 - Lower Palace"),
    new Quake2SceneDesc('city3', "city3 - Upper Palace"),
    "Final Boss",
    new Quake2SceneDesc('boss1', "boss1 - Inner Chamber"),
    new Quake2SceneDesc('boss2', "boss2 - Final Showdown"),
    "Call of the Machine",
    new Quake2SceneDesc('mguhub', "mguhub - Hub"),
    new Quake2SceneDesc('mgu1m1', "mgu1m1 - Strogg Approach"),
    new Quake2SceneDesc('mgu1m2', "mgu1m2 - Perimeter"),
    new Quake2SceneDesc('mgu1m3', "mgu1m3 - Forward Base"),
    new Quake2SceneDesc('mgu1m4', "mgu1m4 - Comm Facility"),
    new Quake2SceneDesc('mgu1m5', "mgu1m5 - Final Assault"),
    new Quake2SceneDesc('mgu2m1', "mgu2m1 - Waterfront"),
    new Quake2SceneDesc('mgu2m2', "mgu2m2 - The Docks"),
    new Quake2SceneDesc('mgu2m3', "mgu2m3 - Cargo Bay"),
    new Quake2SceneDesc('mgu3m1', "mgu3m1 - Dig Site"),
    new Quake2SceneDesc('mgu3m2', "mgu3m2 - Excavation"),
    new Quake2SceneDesc('mgu3m3', "mgu3m3 - Underground"),
    new Quake2SceneDesc('mgu3m4', "mgu3m4 - Depths"),
    new Quake2SceneDesc('mgu4m1', "mgu4m1 - Fuel Depot"),
    new Quake2SceneDesc('mgu4m2', "mgu4m2 - Refueling Station"),
    new Quake2SceneDesc('mgu4m3', "mgu4m3 - Fuel Core"),
    new Quake2SceneDesc('mgu5m1', "mgu5m1 - Transport Hub"),
    new Quake2SceneDesc('mgu5m2', "mgu5m2 - Rail Station"),
    new Quake2SceneDesc('mgu5m3', "mgu5m3 - Tramway"),
    new Quake2SceneDesc('mgu6m1', "mgu6m1 - Processing"),
    new Quake2SceneDesc('mgu6m2', "mgu6m2 - Production"),
    new Quake2SceneDesc('mgu6m3', "mgu6m3 - Assembly"),
    new Quake2SceneDesc('mguboss', "mguboss - Final Boss"),
    "The Reckoning (Xatrix)",
    new Quake2SceneDesc('xswamp', "xswamp - Swamp"),
    new Quake2SceneDesc('xsewer1', "xsewer1 - Sewers 1"),
    new Quake2SceneDesc('xsewer2', "xsewer2 - Sewers 2"),
    new Quake2SceneDesc('xcompnd1', "xcompnd1 - Compound 1"),
    new Quake2SceneDesc('xcompnd2', "xcompnd2 - Compound 2"),
    new Quake2SceneDesc('xintell', "xintell - Intelligence"),
    new Quake2SceneDesc('xmoon1', "xmoon1 - Moon 1"),
    new Quake2SceneDesc('xmoon2', "xmoon2 - Moon 2"),
    new Quake2SceneDesc('xhangar1', "xhangar1 - Hangar 1"),
    new Quake2SceneDesc('xhangar2', "xhangar2 - Hangar 2"),
    new Quake2SceneDesc('xreactor', "xreactor - Reactor"),
    new Quake2SceneDesc('xship', "xship - Ship"),
    "Ground Zero (Rogue)",
    new Quake2SceneDesc('rbase1', "rbase1 - Base 1"),
    new Quake2SceneDesc('rbase2', "rbase2 - Base 2"),
    new Quake2SceneDesc('rhangar1', "rhangar1 - Hangar 1"),
    new Quake2SceneDesc('rhangar2', "rhangar2 - Hangar 2"),
    new Quake2SceneDesc('rware1', "rware1 - Warehouse 1"),
    new Quake2SceneDesc('rware2', "rware2 - Warehouse 2"),
    new Quake2SceneDesc('rsewer1', "rsewer1 - Sewer 1"),
    new Quake2SceneDesc('rsewer2', "rsewer2 - Sewer 2"),
    new Quake2SceneDesc('rmine1', "rmine1 - Mine 1"),
    new Quake2SceneDesc('rmine2', "rmine2 - Mine 2"),
    new Quake2SceneDesc('rlava1', "rlava1 - Lava 1"),
    new Quake2SceneDesc('rlava2', "rlava2 - Lava 2"),
    new Quake2SceneDesc('rammo1', "rammo1 - Ammo 1"),
    new Quake2SceneDesc('rammo2', "rammo2 - Ammo 2"),
    new Quake2SceneDesc('rboss', "rboss - Boss"),
    "N64 Maps",
    new Quake2SceneDesc('base64', "base64 - Base (N64)"),
    new Quake2SceneDesc('city64', "city64 - City (N64)"),
    new Quake2SceneDesc('sewer64', "sewer64 - Sewer (N64)"),
    "Deathmatch",
    new Quake2SceneDesc('q2dm1', "q2dm1 - The Edge"),
    new Quake2SceneDesc('q2dm2', "q2dm2 - Tokay's Towers"),
    new Quake2SceneDesc('q2dm3', "q2dm3 - The Frag Pipe"),
    new Quake2SceneDesc('q2dm4', "q2dm4 - Lost Hallways"),
    new Quake2SceneDesc('q2dm5', "q2dm5 - The Pits"),
    new Quake2SceneDesc('q2dm6', "q2dm6 - Lava Tomb"),
    new Quake2SceneDesc('q2dm7', "q2dm7 - The Slimy Place"),
    new Quake2SceneDesc('q2dm8', "q2dm8 - WareHouse"),
    new Quake2SceneDesc('mgdm1', "mgdm1 - Misty Heights"),
    "CTF",
    new Quake2SceneDesc('q2ctf1', "q2ctf1 - McKinley Station"),
    new Quake2SceneDesc('q2ctf2', "q2ctf2 - Stronghold Opposition"),
    new Quake2SceneDesc('q2ctf3', "q2ctf3 - The Smelter"),
    new Quake2SceneDesc('q2ctf4', "q2ctf4 - Outlands"),
    new Quake2SceneDesc('q2ctf5', "q2ctf5 - Capture Showdown"),
    "Miscellaneous",
    new Quake2SceneDesc('tutorial', "tutorial - Tutorial"),
    new Quake2SceneDesc('badlands', "badlands - Badlands"),
    new Quake2SceneDesc('industry', "industry - Industrial Base"),
    new Quake2SceneDesc('lab', "lab - Lab"),
    new Quake2SceneDesc('outbase', "outbase - Outer Base (variant)"),
    new Quake2SceneDesc('space', "space - Space Station"),
    new Quake2SceneDesc('w_treat', "w_treat - Water Treatment"),
];

const id = 'Quake2';
const name = "Quake II";
export const sceneGroup: SceneGroup = { id, name, sceneDescs };

