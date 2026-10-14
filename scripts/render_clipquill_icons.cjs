#!/usr/bin/env node
/*
 * Reproducible PNG exports from the checked-in SVG paths. Requires sharp only
 * for this development command; the extension has no new runtime dependency.
 *
 * node scripts/render_clipquill_icons.cjs
 * Or use the bundled Codex runtime without installing dependencies:
 * NODE_PATH=<workspace-dependencies>/node/node_modules node scripts/render_clipquill_icons.cjs
 */
const fs = require('node:fs/promises');
const path = require('node:path');
const sharp = require('sharp');

const root = path.resolve(__dirname, '..');
const extension = path.join(root, 'outputs/douyin-independent-extension');
const brand = path.join(extension, 'assets/brand');
const icons = path.join(extension, 'icons');

function symbolOnPlate(symbol) {
  const contents = symbol.replace(/^<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128">
    <rect x="1" y="1" width="126" height="126" rx="25" fill="#0D1421" stroke="#344159" stroke-width="2"/>
    <g transform="translate(5 5) scale(.92)">${contents}</g>
  </svg>`;
}

async function renderSvg(svg, size, destination) {
  await sharp(Buffer.from(svg), { density: 576 })
    .resize(size, size, { kernel: 'lanczos3' }).png().toFile(destination);
}

async function main() {
  await fs.mkdir(icons, { recursive: true });
  const main = await fs.readFile(path.join(brand, 'clipquill-logo.svg'), 'utf8');
  const small = await fs.readFile(path.join(brand, 'clipquill-logo-small.svg'), 'utf8');
  for (const size of [16, 32, 48, 128]) {
    await renderSvg(symbolOnPlate(size <= 32 ? small : main), size, path.join(icons, `icon${size}.png`));
  }
  for (const size of [16, 32]) {
    await renderSvg(small, size, path.join(icons, `favicon${size}.png`));
  }
  // Preview is a design inspection asset, never a running-UI screenshot.
  const previewDir = path.join(root, 'docs/ui-redesign/screenshots');
  await fs.mkdir(previewDir, { recursive: true });
  const sizes = [16, 32, 48, 128];
  const cellWidths = [92, 92, 108, 174];
  const background = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="520" height="470">
    <rect width="520" height="228" fill="#F4F6FB"/><rect y="228" width="520" height="242" fill="#101722"/>
    <g font-family="sans-serif" font-size="13" fill="#192336"><text x="24" y="24">ClipQuill — PNG inspection at actual pixel size (1×)</text>
    <text x="24" y="44">16px</text><text x="116" y="44">32px</text><text x="208" y="44">48px</text><text x="316" y="44">128px</text></g>
    <g font-family="sans-serif" font-size="13" fill="#EDF2FA"><text x="24" y="248">Dark background</text></g>
  </svg>`);
  // Two strips per background: first plated, then transparent. Large preview
  // uses a separate panel below to avoid obscuring small-size comparisons.
  const composite = [];
  let x = 24;
  for (let index = 0; index < sizes.length; index += 1) {
    const size = sizes[index];
    for (const top of [56, 270]) {
      composite.push({ input: path.join(icons, `icon${size}.png`), left: x, top });
    }
    if (size <= 48) {
      const glyph = await sharp(Buffer.from(small), { density: 576 }).resize(size, size).png().toBuffer();
      for (const top of [132, 350]) composite.push({ input: glyph, left: x, top });
    }
    x += cellWidths[index];
  }
  await sharp(background).composite(composite).png()
    .toFile(path.join(previewDir, 'brand-icons-actual-size.png'));
  process.stdout.write('Exported icon16/32/48/128.png, favicon16/32.png and actual-size inspection sheet.\n');
}

main().catch(error => { process.stderr.write(`${error.stack}\n`); process.exitCode = 1; });
