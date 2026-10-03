# Office assets

## Seating upholstery · Poly Haven Poly Wool Herringbone

- Source: https://polyhaven.com/a/poly_wool_herringbone; photography by
  colormass, processing by Rico Cilliers. License: CC0,
  https://polyhaven.com/license (checked 2026-09-28).
- Original surface maps only: 1K JPG diffuse, OpenGL normal and roughness,
  2,845,543 bytes combined. The preview render, displacement, Blender files
  and any source scripts are not bundled. No original image pixels are edited.
- Reproduce/verify: `node scripts/acquire-office-assets.mjs --upholstery`.
  The public manifest https://api.polyhaven.com/files/poly_wool_herringbone
  supplies download byte sizes and MD5. Unexpected existing files are preserved.
  Our inspected-file SHA-256 pins (not publisher signatures) are:
  diffuse `fd889a46f617efd331e522e36b8ad2548e16e1cb018c001872f17537d7666af5`;
  normal `314ac7c1b7c101a48106e05199bfdb24e33671e58a6ccb334249b441d8e8ac98`;
  roughness `028b4fb92c322a31b5374171f62f43af2cfd6a012748be175fd44dbf1109903c`.
- Runtime maps the approximately 0.27 × 0.276m source patch to authored cloth
  coordinates. Broad panels use metre UVs, cushion side bands use perimeter
  and rolled-edge distances, and chair-back edges use perimeter/thickness.
  UV-seam vertices preserve the original positions, normals and triangle count;
  narrow armrests use metric face projections. Compressed visitor-chair widths
  remain illustrative rather than a garment-pattern unwrap. The pale-blue tint, normal strength .38,
  roughness .94 and sheen .35 are artistic parameters, not measured reflectance.
- Only tagged office seating is hydrated. Rugs, chair hard shells, staff and
  separate service-interior cloth retain their own finishes. This changes
  surface shading, not mesh dimensions, Agent contacts, lighting or routes.
  Source maps load once per office; material-owned sampler clones keep matching
  transforms. The existing material-local soft shadow remains composed.
- All three channels must load before any seating finish changes. Failure
  keeps the generated weave and shows the existing English/Vietnamese/Chinese
  detail-fallback notice. Closing an office during loading releases the late
  resources without attaching them. Runtime URLs stay on the local demo server;
  there is no Poly Haven connection, account or API key during a demonstration.

## Office rugs · ambientCG Carpet 016

- Source: https://ambientcg.com/view?id=Carpet016; creator/publisher: ambientCG.
- License: CC0 1.0, https://docs.ambientcg.com/license/ (checked 2026-09-28).
- Publisher describes surface photogrammetry and an approximately 1.7 × 1.7m
  tile. Only the original 1K Color, NormalGL and Roughness JPEGs are bundled;
  the preview, scene files and displacement are not used. Total: 4,074,378 bytes.
- Acquisition: `powershell -File scripts/acquire-office-carpet.ps1` downloads
  https://ambientcg.com/get?file=Carpet016_1K-JPG.zip and verifies our inspected
  archive SHA-256 `b9e67b5d42cb47cead082dedae3767ae228175c857b6b3af6fe7bd4e69237b81`.
  This pin is not a publisher signature. The script preserves existing files
  with unexpected content rather than replacing them.
- Channel SHA-256: Color `c6fca66d1d570d27a921d7cb35b1963e83844e2b8ceec70f0193db5e99e04123`;
  NormalGL `2820cad2593d1e1b58ce1fa38cb53e24be05bf935b40393c379be828a35755ea`;
  Roughness `307c7984100374da53261c51dee33665049e3fc5e0e90143da1f58b040298268`.
- Runtime keeps the measured tile scale, registered normal/roughness channels,
  mipmaps and local-only URLs. An authored shader desaturates/tints the beige
  yarn to cool gray-blue, normal strength .42. Original images are unchanged.
  Rounded outlines and bound perimeters are custom geometry, not scanned rugs.
- Texture sets are applied atomically and owned per room. A failed channel
  retains the generated weave and displays the existing localized detail
  fallback; responses after unmount only release their resources. No purchase,
  account, API key or third-party network call is needed during the demo.

## Task service interiors

Assigned service workers reuse the bundled Microsoft Rocketbox business character
assets and task-joint driver documented below (`people/source.json`, MIT). No new
character model or licence is introduced. The service popup owns each cloned
skeleton; immutable geometry, materials and textures remain in the shared cache.
Their hair alpha masks are preserved in the normal/depth pass as well as colour.
An actor represents the currently delegated digital Agent, not a claim that a
physical staff member is present at a real venue. Missing assets retain the
authored basic character with an explicit English/Vietnamese/Chinese notice.

Airport, hotel, museum and restaurant previews are authored procedural geometry
in `src/serviceScenes*.ts`, with generated material textures and localized signs.
The service scenes also reuse the bundled CC0 oak, marble and Pachira assets
documented below. Each popup owns its loaded resources; they are served by the
local demo server, with no external asset requests. Wood/marble use the published
1.2m/1.5m tile sizes and an authored pale-blue/whitewash colour treatment. Tree
stems and leaves retain their source meshes and are fitted to authored planters.
Museum artwork is original abstract geometric composition, not reproduced artwork.
These previews do not download third-party models, photographs or venue interiors at runtime.
They share the office's pale-blue material direction but have distinct functional
layouts. A selected hotel name supplies context only: its depicted interior and
facilities are illustrative, not surveyed or verified.

### Hotel counter · ambientCG Marble 012

- Source: https://ambientcg.com/view?id=Marble012; license: CC0 1.0, https://docs.ambientcg.com/license/ (checked 2026-09-27).
- Publisher describes the creation method as **procedural**, not a scan or photograph. The gray/white whole-stone pattern is used on the two bookmatched counter panels, not on the floors.
- Original package: https://ambientcg.com/get?file=Marble012_1K-JPG.zip; 4,672,904 bytes. The acquisition script pins SHA-256 `b04384c6d49ce73baeb70db7ea4abfe9948fc9b74b9fd92c3766970662bf2c43`, computed from the inspected download (not a publisher signature).
- Reproduce/verify: `powershell -File scripts/acquire-hotel-stone.ps1`. Only the original Color, NormalGL and Roughness JPGs are extracted; no Blend/USD files or scripts are loaded. Original images are unchanged, totaling 2,099,645 bytes.
- Authored mapping: one texture square spans 2.4 scene metres; the source does not establish a measured stone size. Mirrored metric UVs meet at the center seam. This is an illustrative finish, not evidence of real hotel materials.
- SHA-256: Color `a34b55c889c6b3819d2c351b6409bfd0baf0a0a55b073441850627dfebcdcd1e`; NormalGL `2e9a56525ffbb7e80854b19985a5c921f91192698ea337f4834192479ba0063b`; Roughness `f7afd636d6cca0b470549959c514976186df58ac1013016b6c3919910a6d3a04`.
- Runtime requests stay on the local demo server. A cancelled load only releases its resources; a failed channel retains the plain counter finish with the existing visible detail-fallback notice.
- The pleated curtains, rail/bracket geometry and cushions are original procedural construction in `serviceHospitality.ts`; their cloth finishes use the project's generated weave, not downloaded images or simulated fabric dynamics.

## Business staff · Microsoft Rocketbox

- Publisher: Microsoft; source library: https://github.com/microsoft/Microsoft-Rocketbox
- License: MIT. Original notice is included in `people/LICENSE-Rocketbox.txt`; upstream https://github.com/microsoft/Microsoft-Rocketbox/blob/master/LICENSE.md.
- Pinned source commit: `0943055db6ec570bcef9f2c8b41c9e5467c808f9`.
- Selected originals: `Assets/Avatars/Professions/Business_Male_01` and `Business_Female_01`; standard FBX, not the facial-animation variants.
- Bundled outputs: `people/business-male-01.glb` (8,634,480 bytes), `people/business-female-01.glb` (10,147,088 bytes). Source FBX and output SHA-256 hashes are in `people/source.json`.
- Preparation: clone the pinned repository into `.artifacts/rocketbox-source`, sparse-checkout the two paths above, then run `node scripts/prepare-office-people.mjs`. This offline browser conversion requires installed Chrome and free port 5173. It uses the installed Three.js r180 FBX/TGA loaders and glTF exporter; it does not modify original files.
- Conversion preserves source meshes, 80-joint skinning and diffuse/normal maps. TGA images are explicitly resampled to 1024px PNGs (not cropped), source black Phong diffuse coefficients are replaced with white multipliers for their texture maps, hair uses its source RGBA cutout, and each figure is normalized to 1.76 scene metres. Original animation clips are not bundled.
- Runtime: immutable geometry/material/texture templates are shared; each task worker has independent cloned bones and skeleton buffers. The existing task state machine drives walking, seated work, review and presentation. These are authored retargeted animations, not motion capture, collision simulation or a live human avatar.
- The model files load from the local demo server; no Microsoft or third-party request is made at runtime. Detailed staff loading pauses presentation-driven work progression; an explicit bilingual basic-model fallback is shown on load failure.
- Unit tests verify hashes, embedded texture dimensions, skin weights, finite posed vertices, actual sole contact and resource ownership. Browser checks cover production rendering, loading/failure, pause, roles and localized state. These checks are not a guarantee of photorealism.

## Potted Plant 01

- Creator: Rico Cilliers / Poly Haven
- Source: https://polyhaven.com/a/potted_plant_01
- License: CC0, as stated on the asset page; https://polyhaven.com/license
- Downloaded: 2026-09-25, 1K glTF and its referenced buffers/textures
- Download manifest: https://api.polyhaven.com/files/potted_plant_01
- Reproduce/verify: `node scripts/acquire-office-assets.mjs` verifies publisher MD5 and byte sizes.
- Runtime changes: scaled for the office; pot diffuse material replaced with light porcelain to match the design. Leaf textures retained. The desktop instance uses the offline geometry derivative described below; the original remains available as a loading fallback.
- The asset is a decorative plant, not a surveyed object or an Agent model.

The app loads these bundled files locally. No Poly Haven network requests occur during the demo.

### Desktop geometry derivative

- Reproduce after acquiring the original: `node scripts/prepare-office-plant.mjs` (meshoptimizer 0.22.0, explicit dev dependency).
- Outputs: `potted_plant_01_office.gltf` and `potted_plant_01_office.bin`; original glTF, binary and images are not overwritten.
- Actual triangle counts: 176,226 original → 43,650 derivative. Derived binary: 1,661,784 bytes. Stem, pot, pebbles and leaf parts remain separate with their original materials, images, node transforms and retained vertex attributes.
- Simplification locks topological borders and limits relative geometry error to 0.001, except pot pebbles at 0.005. These are algorithmic bounds, not a perceptual or botanical accuracy guarantee. Inspect the production camera and close-up captures when changing the target size.
- This is a fixed office-scale asset, not a camera-distance LOD system. The source remains CC0; no new license restriction is applied to the derivative. Tests check index ranges, finite attributes, material/texture preservation and actual geometry reduction.

## Anthurium Botany 01

- Creators: Rico Cilliers (modeling), Rob Tuytel (scanning) / Poly Haven
- Source: https://polyhaven.com/a/anthurium_botany_01
- License: CC0, https://polyhaven.com/license
- Downloaded: 2026-09-25, original 1K glTF, buffer and referenced textures.
- Manifest: https://api.polyhaven.com/files/anthurium_botany_01
- Reproduce/verify: `node scripts/acquire-office-assets.mjs --tropical` checks publisher byte sizes and MD5.
- Runtime changes: the first two upright specimens are individually scaled to 0.95m foliage height, placed in authored pale ceramic pots, and rotated to avoid identical silhouettes. Roughness/environment intensity adjusted; original geometry and image files unchanged.
- These plants supply local mesh detail, not a flat office background. The AO pass preserves the source leaf alpha masks.

## Oak Wood Planks

- Creator: Dimitrios Savva / Poly Haven
- Source: https://polyhaven.com/a/oak_wood_planks
- License: CC0, https://polyhaven.com/license
- Downloaded: 2026-09-25; original 1K JPG diffuse, OpenGL normal and roughness maps.
- Manifest: https://api.polyhaven.com/files/oak_wood_planks
- Reproduce/verify: `node scripts/acquire-office-assets.mjs --floor` validates publisher MD5 and byte sizes.
- Published physical tile dimensions: 1.2 × 1.2m; repeated over the modeled 23.4 × 16.2m floor.
- Runtime changes: shader-based low-saturation white-oak albedo, normal strength 0.2. Original image files are unchanged. The floor is still geometry with PBR material, not a room-background photograph.

## Marble 01

- Creator: Rob Tuytel / Poly Haven
- Source: https://polyhaven.com/a/marble_01
- License: CC0, https://polyhaven.com/license
- Downloaded: 2026-09-25; original 1K JPG diffuse, OpenGL normal and roughness maps (507,107 bytes combined).
- Manifest: https://api.polyhaven.com/files/marble_01
- Verify/download: `node scripts/acquire-office-assets.mjs --stone` checks publisher MD5 and byte sizes.
- Published tile dimensions: 1.5 × 1.5m. Applied only to the 1.7m-deep entrance foyer on the existing floor plane; oak remains inside the office.
- Runtime changes: authored pale neutral albedo, normal strength 0.12, smoother finish. Original image files are unchanged. A shared reflection captures real scene objects; no additional coplanar floor layer is added.

## Fern 02 and Pachira Aquatica 01

- Creators: Rico Cilliers (modeling), Rob Tuytel (scanning) / Poly Haven.
- Sources: https://polyhaven.com/a/fern_02 and https://polyhaven.com/a/pachira_aquatica_01
- License: CC0, stated on both source pages; https://polyhaven.com/license
- Downloaded: 2026-09-25, original 1K glTF, buffers and referenced texture files; 13 files / 6,285,192 bytes combined.
- Manifests: https://api.polyhaven.com/files/fern_02 and https://api.polyhaven.com/files/pachira_aquatica_01
- Verify/download: `node scripts/acquire-office-assets.mjs --fern` and `--tree` check publisher MD5 and byte sizes.
- Runtime: the fern asset's four individual specimens form the central planted divider. Each tree combines its matching bark and leaves before uniform scaling, preserving relative placement. The stem stays rooted in the authored pot; the canopy is bounded around that root to stay inside the room. Source geometry/images are unchanged; roughness and environment contribution are art-directed.
- Floor planters select upright Pachira forms according to the height attainable within their existing clearance, retaining variation among similarly fitting specimens. The two authored entrance troughs each reuse three fern specimens seated on their soil surface. No source geometry is stretched or rewritten; immutable source extents are cached during hydration, not calculated during animation.
- The six private-room pots now compose a principal upright specimen and a lower companion, sharing the same soil surface. Source geometry, maps and proportional scales are preserved; companion roots are offset at most 9cm and its fit reserves that offset before bounding the complete canopy. Each room reserves a 0.64m-radius, 2.55m-high local envelope; the shallower centre room uses a 0.60m radius to clear its consultation-wing desk. The planter group keeps its existing 0.95 scale, and roots move slightly inward from the glass. This is authored indoor planting, not a surveyed botanical arrangement or growth simulation. It reuses the existing instance batches and optional-source fallback; no external model or runtime request was added.
- Both assets load locally and share immutable geometry/textures between repeated office instances. Closing an office releases its instance buffers, not the source asset cache. Existing tropical foliage remains as fallback if an optional asset fails to load.
