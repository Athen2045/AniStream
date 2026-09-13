import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const builderConfig = readText("electron-builder.yml");
const expectedConfig = [
  "icon: assets/app-icon/AniStream.icns",
  "icon: assets/app-icon/AniStream.ico",
];

for (const entry of expectedConfig) {
  if (!builderConfig.includes(entry)) {
    throw new Error(`electron-builder.yml is missing the native icon setting: ${entry}`);
  }
}

const pngSizes = [16, 32, 64, 128, 256, 512, 1024];
for (const size of pngSizes) {
  verifyPng(`assets/app-icon/AniStream-${size}.png`, size);
}
verifyPng("src/renderer/src/assets/app-icon.png", 128);
verifyIcns("assets/app-icon/AniStream.icns");
verifyIco("assets/app-icon/AniStream.ico");

console.log("Verified navbar PNG, macOS ICNS, and multi-resolution Windows ICO branding assets.");

function read(relativePath) {
  return readFileSync(resolve(root, relativePath));
}

function readText(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

function pngDimensions(buffer, label) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(signature)) {
    throw new Error(`${label} is not a valid PNG.`);
  }
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function verifyPng(relativePath, expectedSize) {
  const dimensions = pngDimensions(read(relativePath), relativePath);
  if (dimensions.width !== expectedSize || dimensions.height !== expectedSize) {
    throw new Error(
      `${relativePath} must be ${expectedSize}x${expectedSize}, received ${dimensions.width}x${dimensions.height}.`,
    );
  }
}

function verifyIcns(relativePath) {
  const buffer = read(relativePath);
  if (
    buffer.length < 8 ||
    buffer.toString("ascii", 0, 4) !== "icns" ||
    buffer.readUInt32BE(4) !== buffer.length
  ) {
    throw new Error(`${relativePath} has an invalid ICNS header or declared length.`);
  }
}

function verifyIco(relativePath) {
  const buffer = read(relativePath);
  if (buffer.length < 6 || buffer.readUInt16LE(0) !== 0 || buffer.readUInt16LE(2) !== 1) {
    throw new Error(`${relativePath} has an invalid ICO header.`);
  }

  const count = buffer.readUInt16LE(4);
  if (count < 5 || buffer.length < 6 + count * 16) {
    throw new Error(`${relativePath} must contain a complete multi-resolution icon directory.`);
  }

  const embeddedSizes = new Set();
  for (let index = 0; index < count; index += 1) {
    const entryOffset = 6 + index * 16;
    const dataSize = buffer.readUInt32LE(entryOffset + 8);
    const dataOffset = buffer.readUInt32LE(entryOffset + 12);
    if (dataSize === 0 || dataOffset < 6 + count * 16 || dataOffset + dataSize > buffer.length) {
      throw new Error(`${relativePath} contains an out-of-bounds image entry.`);
    }
    const dimensions = pngDimensions(
      buffer.subarray(dataOffset, dataOffset + dataSize),
      `${relativePath} entry ${index + 1}`,
    );
    if (dimensions.width !== dimensions.height) {
      throw new Error(`${relativePath} entry ${index + 1} is not square.`);
    }
    embeddedSizes.add(dimensions.width);
  }

  for (const requiredSize of [16, 32, 64, 128, 256]) {
    if (!embeddedSizes.has(requiredSize)) {
      throw new Error(`${relativePath} is missing its ${requiredSize}x${requiredSize} image.`);
    }
  }
}
