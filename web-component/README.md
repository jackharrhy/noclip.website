# @noclip/map-viewer

A web component for rendering Quake and Half-Life (GoldSrc) BSP maps directly in the browser. Built to be extensible for other map formats in the future. Built on the rendering engine from [noclip.website](https://noclip.website).

## Features

- Renders Quake (BSP v29) and Half-Life (BSP v30) maps
- WebGL2 and WebGPU support with automatic fallback
- First-person camera controls (WASD + mouse look)
- Lightmap rendering
- Progressive loading with progress events
- Lazy loading support
- Touch support for mobile devices
- Fully encapsulated web component

## Installation

This package is part of the [noclip.website](https://github.com/magcius/noclip.website) pnpm monorepo.

### Within the monorepo

```bash
# From the noclip.website root
pnpm install

# The web-component package can now import from @noclip/website/*
```

### Standalone (future)

When published as a standalone package:

```bash
npm install @noclip/map-viewer
# or
pnpm add @noclip/map-viewer
```

## Quick Start

```html
<script type="module">
  import '@noclip/map-viewer';
</script>

<!-- Quake map -->
<idtech-map
  src="maps/e1m1.bsp"
  wads="id1/gfx.wad"
  palette="id1/palette.lmp"
  camera-controls>
</idtech-map>

<!-- Half-Life map (no palette needed) -->
<idtech-map
  src="maps/c1a0.bsp"
  wads="valve/halflife.wad"
  camera-controls>
</idtech-map>
```

## Attributes

| Attribute | Type | Description |
|-----------|------|-------------|
| `src` | `string` | URL to the BSP file (required) |
| `wads` | `string` | Semicolon-separated WAD file URLs |
| `palette` | `string` | URL to palette file (Quake only, 768 bytes) |
| `camera-controls` | `boolean` | Enable WASD + mouse look controls |
| `poster` | `string` | URL to poster image shown while loading |
| `loading` | `"eager"` \| `"lazy"` | When to start loading (default: `"eager"`) |
| `disable-lightmaps` | `boolean` | Render in fullbright mode |

## CSS Custom Properties

```css
idtech-map {
  /* Sizing */
  width: 100%;
  height: 500px;

  /* Theming */
  --idtech-map-background: #1a1a1a;
  --idtech-map-loading-color: #fff;
  --idtech-map-progress-color: #4a9eff;
  --idtech-map-error-color: #ff4a4a;
  --idtech-map-font: system-ui, sans-serif;
}
```

## Events

| Event | Detail | Description |
|-------|--------|-------------|
| `load` | `{ entities: BSPEntity[] }` | Map loaded successfully |
| `error` | `{ message: string, error?: Error }` | Loading or rendering failed |
| `progress` | `LoadProgressDetail` | Loading progress update |
| `camera-change` | `CameraState` | Camera position/rotation changed |

```javascript
const map = document.querySelector('idtech-map');

map.addEventListener('load', (e) => {
  console.log('Map loaded with', e.detail.entities.length, 'entities');
});

map.addEventListener('progress', (e) => {
  console.log(`${e.detail.phase}: ${e.detail.message}`);
});

map.addEventListener('error', (e) => {
  console.error('Failed to load:', e.detail.message);
});
```

## Slots

| Slot | Description |
|------|-------------|
| `poster` | Custom content shown while loading |
| `loading` | Custom loading indicator |
| `error` | Custom error message |
| `overlay` | Content overlaid on the rendered map |

```html
<idtech-map src="e1m1.bsp" camera-controls>
  <div slot="poster">
    <img src="e1m1-preview.jpg" alt="E1M1">
    <p>Click to load</p>
  </div>
  
  <div slot="overlay" class="hud">
    <div class="health">100</div>
  </div>
</idtech-map>
```

## JavaScript API

```javascript
const map = document.querySelector('idtech-map');

// Get entities from the loaded map
const spawns = map.entities.filter(e => e.classname === 'info_player_start');

// Control the camera
map.jumpToSpawn(0);  // Jump to first spawn point
map.setCameraPosition(100, 200, 50);

// Get camera state
const { position, rotation } = map.getCameraState();

// Reload the map
await map.reload();
```

## Controls

When `camera-controls` is enabled:

| Input | Action |
|-------|--------|
| Click | Enable mouse look (pointer lock) |
| Mouse | Look around |
| W / Arrow Up | Move forward |
| S / Arrow Down | Move backward |
| A / Arrow Left | Strafe left |
| D / Arrow Right | Strafe right |
| Space / E | Move up |
| C / Q | Move down |
| Shift | Move faster |
| Scroll | Adjust movement speed |
| Escape | Exit mouse look |

## Advanced Usage

For more control, you can use the underlying classes directly:

```javascript
import { MapRenderer, AssetLoader, SimpleInputManager } from '@noclip/map-viewer';

// Create renderer manually
const canvas = document.querySelector('canvas');
const renderer = new MapRenderer(canvas, { backend: 'webgpu' });
await renderer.initialize();

// Load assets
const loader = new AssetLoader();
loader.addEventListener('progress', (e) => console.log(e.detail));

const assets = await loader.load({
  bsp: 'maps/e1m1.bsp',
  wads: ['id1/gfx.wad'],
  palette: 'id1/palette.lmp',
});

// Load and render
renderer.loadMap(assets);
renderer.resize(800, 600);
renderer.start();

// Enable controls
const input = new SimpleInputManager(canvas);
renderer.enableControls(input);
```

## Asset Requirements

### Quake (BSP v29)

- **BSP file**: The map file (e.g., `e1m1.bsp`)
- **WAD files**: Texture archives (e.g., `gfx.wad`)
- **Palette**: `palette.lmp` (768 bytes, required for texture colors)

### Half-Life (BSP v30)

- **BSP file**: The map file (e.g., `c1a0.bsp`)
- **WAD files**: Texture archives (referenced in BSP's `worldspawn.wad` entity)
- Palette is embedded in textures, not needed separately

## Browser Support

Requires WebGL2 or WebGPU support:
- Chrome 90+
- Firefox 90+
- Safari 15.4+
- Edge 90+

## License

MIT - Part of [noclip.website](https://github.com/magcius/noclip.website)
