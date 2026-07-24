// Regenera los iconos de la marca redimensionando el logo original.
//
//   node scripts/generate-icons.mjs
//
// Fuente unica: public/brand/vantix-icon-source.png (1254x1254). No se
// redibuja nada: todas las salidas son ese mismo bitmap reescalado.
//
// Salidas:
//   src/app/favicon.ico     ICO multi-tamano (16/32/48) para la pestana
//   src/app/icon.svg        el PNG a 512 embebido, para pestanas en alta densidad
//   src/app/apple-icon.png  180x180, Next lo publica como <link rel="apple-touch-icon">
//   public/apple-touch-icon.png  copia en la raiz para clientes que la piden por path fijo
//   public/icon-192.png     icono del manifest (pantalla de inicio)
//   public/icon-512.png     icono del manifest (splash / stores)
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(ROOT, "public/brand/vantix-icon-source.png");

const scaled = (size) =>
  sharp(SOURCE).resize(size, size, { fit: "cover", kernel: "lanczos3" });

// El PNG original trae grano, y eso hincha cualquier compresion sin perdida:
// el 512 salia en 164 kB. El dibujo son tres colores planos mas antialiasing,
// asi que cuantizar a paleta lo deja igual a la vista y pesando una decima parte.
async function render(size) {
  return scaled(size)
    .png({ palette: true, colours: 128, compressionLevel: 9, effort: 10 })
    .toBuffer();
}

// El decodificador de ICO de Next rechaza los PNG indexados ("The PNG is not in
// RGBA format"), asi que las entradas del .ico van sin paleta y con alfa
// explicito: el original es RGB y sharp no la agrega solo.
async function renderRgba(size) {
  return scaled(size).ensureAlpha().png({ compressionLevel: 9 }).toBuffer();
}

// ICO con imagenes PNG embebidas (soportado por todos los navegadores actuales).
export function buildIco(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reservado
  header.writeUInt16LE(1, 2); // tipo: icono
  header.writeUInt16LE(images.length, 4);

  const DIR_ENTRY = 16;
  let offset = header.length + images.length * DIR_ENTRY;
  const entries = [];

  for (const { size, data } of images) {
    const entry = Buffer.alloc(DIR_ENTRY);
    entry.writeUInt8(size >= 256 ? 0 : size, 0);
    entry.writeUInt8(size >= 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2); // paleta
    entry.writeUInt8(0, 3); // reservado
    entry.writeUInt16LE(1, 4); // planos
    entry.writeUInt16LE(32, 6); // bits por pixel
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    entries.push(entry);
    offset += data.length;
  }

  return Buffer.concat([
    header,
    ...entries,
    ...images.map((image) => image.data),
  ]);
}

async function main() {
  const icoImages = [];
  for (const size of [16, 32, 48]) {
    icoImages.push({ size, data: await renderRgba(size) });
  }
  await writeFile(path.join(ROOT, "src/app/favicon.ico"), buildIco(icoImages));

  const apple = await render(180);
  await writeFile(path.join(ROOT, "src/app/apple-icon.png"), apple);
  await writeFile(path.join(ROOT, "public/apple-touch-icon.png"), apple);

  const png192 = await render(192);
  await writeFile(path.join(ROOT, "public/icon-192.png"), png192);
  await writeFile(path.join(ROOT, "public/icon-512.png"), await render(512));

  // Un bitmap no se puede vectorizar sin redibujarlo, asi que el SVG solo
  // envuelve el PNG: misma imagen, disponible como image/svg+xml. Va el de 192
  // y no el de 512 porque una pestana nunca pasa de ~64 px ni en pantalla retina,
  // y el grano del original hace que el 512 pese treinta veces mas.
  await writeFile(
    path.join(ROOT, "src/app/icon.svg"),
    `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512" role="img" aria-label="Vantix">` +
      `<image href="data:image/png;base64,${png192.toString("base64")}" width="512" height="512"/>` +
      `</svg>\n`
  );

  console.log("Iconos regenerados desde public/brand/vantix-icon-source.png");
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  await main();
}
