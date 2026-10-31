# Image generation provenance

Built-in image_gen tool. Original PNGs are retained; WebP encoding is used only for package size. No external API credentials or runtime network requests.

## 角色动作

Create an actual transparent game sprite atlas based on the approved reference characters. Output landscape canvas, 6 EXACTLY EQUAL columns and 3 EXACTLY EQUAL rows (18 cells). Every sprite fully contained in its cell, centered horizontally, feet aligned at 90% cell height, generous transparent gutters. NO labels, NO text, NO background, NO sheet border, NO scenery, NO floor shadows. TRUE alpha transparency. Each character about 75% of cell height, same proportions and scale throughout row. All frames face three-quarter RIGHT. Meticulous crisp pixel art with hard square pixel clusters, warm limited palettes, about 64x80 conceptual pixel detail per character; retain approved expressive faces, clothing and silhouettes at small sizes. Not smooth painting. Preserve identity rigorously.
Row1 same blacksmith from reference: short curly dark hair, beard, goggles above forehead, rust rolled shirt, brown leather apron, gloves, charcoal pants, boots.
Row2 same gardener from reference: straw hat green band, brown braid, cream shirt, green overalls, boots, teal watering can.
Row3 same fisherman from reference: blue cap, dark short hair, blue shirt, ochre vest, teal trousers, brown boots, fishing rod.
Columns for ALL rows:
1 idle standing relaxed, tools held safely down;
2 walking contact pose right leg forward and left arm forward counter-swing;
3 walking passing pose left leg forward opposite gait phase, same body size and feet baseline;
4 beginning WORK pose: blacksmith hammer raised with left hand holding tongs toward unseen anvil; gardener raises can preparing tilt; fisherman standing holding rod angled forward, preparing cast;
5 middle WORK pose: blacksmith hammer forward/down toward unseen anvil with connected arm; gardener tilts can to water toward right, EMPTY spout no water particles; fisherman extends rod forward and settles fishing stance;
6 settled WORK pose: blacksmith hammer near waist recovering stroke, tongs still extend right; gardener slightly lowers can to rest; fisherman holding rod patiently angled up to right.
IMPORTANT: do not include anvil, water, fishing line, stools, beds, stations, UI, cropped tools or extra people. Wide tools must fit INSIDE their cell with no overlap into neighboring cells. Feet and lower legs keep consistent anatomy, no added limbs. Game-ready layout, transparent 6x3 sheet.

## 小院场景

Use case: stylized-concept. Asset: production BACKGROUND ONLY for a cozy 2D pixel art cottage game, landscape 4:3 aspect ratio. No UI, no text, no characters, no pets. Fine handcrafted pixel art, slightly top down orthographic view (NOT isometric diamond), warm earthy palettes, lush layered foliage, honey-colored timber, reddish roof tiles, amber forge, clear turquoise water. Highly polished tiny-world diorama, readable at 480x360. Pixel shapes and clustered shading, crisp edges, no blur or photographic texture.
LAYOUT to support game overlay sprites:
Top 0%-15%: quiet pale green treeline and sky, low contrast, no important objects (HUD space).
Upper-left 3%-48% width, 17%-57% height: open-front timber cottage workshop, short tiled roof with ivy and chimney, interior wooden plank floor visible. Forge at back-left wall with orange ember glow, tools hung on wall, shelves, stacked firewood, a small window with flowers. LEAVE workshop FRONT floor at x20%,y49% EMPTY for a blacksmith sprite; low iron anvil at x29%,y51%. No worker.
Upper-middle x49%-66%, y25%-54%: green grass with flowerpots and a small seed table, leave x55%,y51% empty for a gardener sprite.
Upper-right x70%-100%, y27%-70%: curving small blue pond with reeds and waterlilies, a short wood dock protrudes from left shore horizontally. Dock has a CLEAR EMPTY standing spot at x76%,y48% for a fisherman; water lies immediately right of it. Trees behind pond.
Across x0%-100%, y57%-68%: unobstructed gently curved sandy walking path, clear of objects, connecting cottage entrance to dock shore. No big rocks or tall grass on this path.
Lower-left/middle x5%-68%, y70%-83%: four EMPTY rectangular raised vegetable beds, arranged in one horizontal row, neat dark tilled soil and wood edges, no planted vegetables. Each bed about 12% image width, separated by grass gaps. These four beds are the main player gardening area.
Bottom y85%-100%: grass, little flower clusters at corners only, quiet light meadow behind future bottom toolbar. Lower right near pond: small bucket, fishing basket, flowers, stepping stones, keep modest.
Composition complete edge to edge, inviting living courtyard, varied texture and local details but no excessive visual noise. A coherent walkable little world, no repeated scene panels, no outlines around entire image. NO baked-in people, task badges, UI, labels, numbers, speech bubbles, or animals.

## 玩家角色

Production 2D pixel art sprite atlas, TRUE transparent background, EXACTLY 6 equal columns in ONE horizontal row. Original cozy life simulation player character: youthful friendly cottage keeper, short chestnut hair, small cream neck scarf, terracotta waistcoat over ivory long-sleeve shirt, moss green trousers, brown ankle boots, small cross-body leather satchel. No hat, no tools. About 3.5 heads tall, distinct connected limbs, finely clustered pixel detail at roughly 48x64 logical pixels. Match handcrafted detailed 16-bit cozy village NPCs, no vector style, no blur. EVERY cell repeats EXACT SAME character, clothing, scale, identity, feet baseline and neutral mouth. Generous transparent margins, full body. No text, grid, shadows or scenery.
Cell1 standing relaxed front three-quarter right. Cell2 standing relaxed side right.
Cells3-6 a coherent FOUR FRAME WALK CYCLE facing RIGHT: (3) right heel touches ground in front, left toe behind, left arm forward; (4) body passes above planted right foot, left knee bends forward, legs close; (5) left heel touches front, right toe behind, right arm forward; (6) body passes above planted left foot, right knee bends forward, legs close. Grounded weight, constant leg lengths, a slight one-pixel body bob on passing poses only. Do not repeat same leg pose in every cell. Absolutely no additional limbs, each cell exactly one complete figure. Transparent sprite sheet, wide 3:1 canvas.

