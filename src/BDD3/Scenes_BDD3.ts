import { GfxDevice } from "../gfx/platform/GfxPlatform.js";
import { SceneContext, SceneDesc, SceneGroup } from "../SceneBase.js";
import { SceneGfx } from "../viewer.js";
import { BSPFile } from "../Common/IdTech2/BSPFile.js";
import { BSPRenderer, IdTech2Renderer } from "../Common/IdTech2/Render.js";
import { parseWAD } from "../Common/IdTech2/WAD.js";

const pathBase = `BDD3`;

function parsePaletteTxt(text: string): Uint8Array {
    const lines = text.trim().split('\n');
    const palette = new Uint8Array(256 * 3);
    for (let i = 0; i < 256; i++) {
        const parts = lines[i].trim().split(/\s+/);
        palette[i * 3 + 0] = parseInt(parts[0], 10);
        palette[i * 3 + 1] = parseInt(parts[1], 10);
        palette[i * 3 + 2] = parseInt(parts[2], 10);
    }
    return palette;
}

export class BDD3SceneDesc implements SceneDesc {
    constructor(public id: string, public name: string = id) {
    }

    public async createScene(device: GfxDevice, sceneContext: SceneContext): Promise<SceneGfx> {
        const renderer = new IdTech2Renderer(device);

        const paletteText = await sceneContext.dataFetcher.fetchData(`${pathBase}/gfx/palette.txt`);
        const palette = parsePaletteTxt(new TextDecoder().decode(paletteText.copyToBuffer()));
        renderer.textureCache.setPalette(palette);

        const wadData = await sceneContext.dataFetcher.fetchData(`${pathBase}/gfx.wad`);
        const wad = parseWAD(wadData);
        renderer.textureCache.addWAD(wad);

        const bspData = await sceneContext.dataFetcher.fetchData(`${pathBase}/maps/${this.id}.bsp`);
        const bspFile = new BSPFile(bspData);
        renderer.textureCache.addBSP(bspFile);

        const bspRenderer = new BSPRenderer(renderer.renderHelper.renderCache, renderer.textureCache, bspFile);
        renderer.bspRenderers.push(bspRenderer);

        return renderer;
    }
}

const sceneDescs = [
    new BDD3SceneDesc('10cristopaodeacucar2'),
    new BDD3SceneDesc('10surfamazonia'),
    new BDD3SceneDesc('11EDINHO'),
    new BDD3SceneDesc('11zegaroto'),
    new BDD3SceneDesc('12copaloco'),
    new BDD3SceneDesc('12RODOPRACAMARISACAMELO'),
    new BDD3SceneDesc('13partaginrocket'),
    new BDD3SceneDesc('13sambodromo'),
    new BDD3SceneDesc('14metrorio'),
    new BDD3SceneDesc('14myhouse'),
    new BDD3SceneDesc('15AMANHA'),
    new BDD3SceneDesc('15jiboyaskate'),
    new BDD3SceneDesc('16ALCANTARARUADAFEIRA'),
    new BDD3SceneDesc('16ULTIMAFASE'),
    new BDD3SceneDesc('17FINAL'),
    new BDD3SceneDesc('17GLOBE'),
    new BDD3SceneDesc('18FINALEPILOGUE'),
    new BDD3SceneDesc('18niteroi'),
    new BDD3SceneDesc('19varginhao'),
    new BDD3SceneDesc('1MAPA1'),
    new BDD3SceneDesc('20cristopaodeacucar'),
    new BDD3SceneDesc('21cristopaodeacucar2'),
    new BDD3SceneDesc('22EDINHO'),
    new BDD3SceneDesc('23copaloco'),
    new BDD3SceneDesc('24Sambodromo'),
    new BDD3SceneDesc('25metrorio'),
    new BDD3SceneDesc('26AMANHA'),
    new BDD3SceneDesc('27ULTIMAFASE'),
    new BDD3SceneDesc('28FINAL'),
    new BDD3SceneDesc('29FINALEPILOGUE'),
    new BDD3SceneDesc('2mapa2'),
    new BDD3SceneDesc('3MAPAtreze'),
    new BDD3SceneDesc('4CARRETA'),
    new BDD3SceneDesc('5salga'),
    new BDD3SceneDesc('6chavinha19'),
    new BDD3SceneDesc('6GLOBE'),
    new BDD3SceneDesc('7niteroi'),
    new BDD3SceneDesc('7pierniteroi'),
    new BDD3SceneDesc('8praca16'),
    new BDD3SceneDesc('8varginhao'),
    new BDD3SceneDesc('9aniversarioguanaSAOGONCALO'),
    new BDD3SceneDesc('9cristopaodeacucar'),
    new BDD3SceneDesc('ALCANTARARUADAFEIRA'),
    new BDD3SceneDesc('aniversarioguanaSAOGONCALO'),
    new BDD3SceneDesc('chavinha19'),
    new BDD3SceneDesc('dm_barraco1'),
    new BDD3SceneDesc('dm_barraco2'),
    new BDD3SceneDesc('dm_cheirado'),
    new BDD3SceneDesc('horda_CAKESETUP'),
    new BDD3SceneDesc('horda_chavinha'),
    new BDD3SceneDesc('horda_cheirado'),
    new BDD3SceneDesc('horda_cristoeagua'),
    new BDD3SceneDesc('horda_dj'),
    new BDD3SceneDesc('horda_favela'),
    new BDD3SceneDesc('horda_maraca'),
    new BDD3SceneDesc('horda_museuSP'),
    new BDD3SceneDesc('horda_portugal'),
    new BDD3SceneDesc('horda_ShoppingGoncalo'),
    new BDD3SceneDesc('jiboyaskate'),
    new BDD3SceneDesc('MASTERMAPA1'),
    new BDD3SceneDesc('MASTERMAPA2'),
    new BDD3SceneDesc('MASTERSALGA'),
    new BDD3SceneDesc('myhouse'),
    new BDD3SceneDesc('partaginrocket'),
    new BDD3SceneDesc('pierniteroi'),
    new BDD3SceneDesc('praca16'),
    new BDD3SceneDesc('RODOPRACAMARISACAMELO'),
    new BDD3SceneDesc('start'),
    new BDD3SceneDesc('surfamazonia'),
    new BDD3SceneDesc('udidntopenaportalAPRILSFOOLS'),
    new BDD3SceneDesc('zegaroto'),
];

const id = 'BDD3';
const name = "BDD3";
export const sceneGroup: SceneGroup = { id, name, sceneDescs };

