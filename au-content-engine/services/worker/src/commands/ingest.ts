import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { AssetSchema, type Asset } from "@au/schemas";
import { makeProxy, probe } from "../ffmpeg";

const MEDIA_EXTENSIONS = new Set([".mp4", ".mov", ".m4v"]);

const checksumOf = (filePath: string): Promise<string> =>
  new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(filePath)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("hex")));
  });

export interface IngestResult {
  assets: Asset[];
  proxyPaths: Record<string, string>;
  sourcePaths: Record<string, string>;
  skipped: { file: string; reason: string }[];
}

export const ingest = async (folder: string, workDir: string): Promise<IngestResult> => {
  const proxyDir = path.join(workDir, "proxies");
  await mkdir(proxyDir, { recursive: true });

  const entries = (await readdir(folder, { withFileTypes: true }))
    .filter((e) => e.isFile() && MEDIA_EXTENSIONS.has(path.extname(e.name).toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name));

  const assets: Asset[] = [];
  const proxyPaths: Record<string, string> = {};
  const sourcePaths: Record<string, string> = {};
  const skipped: { file: string; reason: string }[] = [];
  const seenChecksums = new Map<string, string>();

  for (const entry of entries) {
    const filePath = path.join(folder, entry.name);
    try {
      const [meta, checksum] = await Promise.all([probe(filePath), checksumOf(filePath)]);

      const duplicateOf = seenChecksums.get(checksum);
      if (duplicateOf) {
        skipped.push({ file: entry.name, reason: `identical to ${duplicateOf}` });
        continue;
      }
      seenChecksums.set(checksum, entry.name);

      const id = `ast_${checksum.slice(0, 10)}`;
      const asset = AssetSchema.parse({ id, filename: entry.name, checksum, ...meta });

      const proxyPath = path.join(proxyDir, `${id}.mp4`);
      await makeProxy(filePath, proxyPath);

      assets.push(asset);
      proxyPaths[id] = proxyPath;
      sourcePaths[id] = path.resolve(filePath);
      process.stderr.write(`  ingested ${entry.name} -> ${id} (${Math.round(meta.durationMs / 1000)}s)\n`);
    } catch (error) {
      // One corrupt clip must not fail the project — NFR-005. It is named and skipped.
      skipped.push({ file: entry.name, reason: error instanceof Error ? error.message : String(error) });
      process.stderr.write(`  SKIPPED ${entry.name}: ${skipped[skipped.length - 1]!.reason}\n`);
    }
  }

  const result: IngestResult = { assets, proxyPaths, sourcePaths, skipped };
  await writeFile(path.join(workDir, "assets.json"), JSON.stringify(result, null, 2), "utf8");
  return result;
};
