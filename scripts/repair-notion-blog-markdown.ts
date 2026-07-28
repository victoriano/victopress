import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const CONTENT_ROOT = path.resolve(process.cwd(), "content");
const MANIFEST_PATHS = [
  "blog/_notion-import-manifest.json",
  "blog/_notion-posted-import-manifest.json",
] as const;

interface ImportedPost {
  target: string;
  contentSha256?: string;
}

interface ImportManifest {
  posts: ImportedPost[];
  layoutRepair?: {
    version: number;
    repairedAt: string;
    blockBoundariesPreserved: boolean;
  };
}

function isListLine(line: string): boolean {
  return /^(?:[\t ]*(?:[-+*]|\d+[.)])\s+)/.test(line);
}

function bracketDelta(line: string): number {
  const visible = line.replace(/\\[\[\]]/g, "");
  let delta = 0;
  for (const character of visible) {
    if (character === "[") delta += 1;
    if (character === "]") delta -= 1;
  }
  return delta;
}

/**
 * Notion's enhanced Markdown represents each top-level block on its own line.
 * Standard Markdown needs an empty line between those blocks; otherwise Marked
 * merges paragraphs and every consecutive image into one inline row.
 */
export function preserveNotionBlockBoundaries(markdown: string): string {
  const normalizedLinks = markdown.replace(
    /\[([^\]]*\n[^\]]*)\]\((https?:\/\/[^\s)]+)\)/g,
    (_match, label: string, href: string) => {
      const readableLabel = label
        .replace(/\n[ \t]*\n+/g, "  \n")
        .replace(/(?<! {2})\n/g, "  \n");
      return `[${readableLabel}](${href})`;
    },
  );

  const lines = normalizedLinks.replaceAll("\r\n", "\n").split("\n");
  const output: string[] = [];
  let inFence = false;
  let openBrackets = 0;
  let previousNonEmpty = "";

  for (const sourceLine of lines) {
    const hadHardBreak = / {2}$/.test(sourceLine);
    const line = sourceLine.replace(/[ \t]+$/, "") + (hadHardBreak ? "  " : "");

    if (!line.trim()) {
      if (output.length && output.at(-1) !== "") output.push("");
      continue;
    }

    const isFence = /^```/.test(line.trimStart());
    const continuesPrevious =
      inFence ||
      openBrackets > 0 ||
      / {2}$/.test(previousNonEmpty) ||
      (isListLine(previousNonEmpty) && isListLine(line));

    if (
      output.length &&
      output.at(-1) !== "" &&
      !continuesPrevious
    ) {
      output.push("");
    }

    output.push(line);
    previousNonEmpty = line;
    openBrackets = Math.max(0, openBrackets + bracketDelta(line));
    if (isFence) inFence = !inFence;
  }

  while (output.at(-1) === "") output.pop();
  return output.join("\n");
}

function bodyFromDocument(document: string): {
  frontmatter: string;
  body: string;
} {
  const match = document.match(/^(---\n[\s\S]*?\n---\n)([\s\S]*)$/);
  if (!match) throw new Error("The imported post has no valid YAML frontmatter");
  return { frontmatter: match[1], body: match[2].trim() };
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function repairManifest(relativePath: string): Promise<number> {
  const manifestPath = path.join(CONTENT_ROOT, relativePath);
  const manifest = JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as ImportManifest;
  let changedPosts = 0;

  for (const post of manifest.posts) {
    const postPath = path.join(CONTENT_ROOT, post.target);
    const document = await readFile(postPath, "utf8");
    const { frontmatter, body } = bodyFromDocument(document);
    const repaired = preserveNotionBlockBoundaries(body);
    const nextDocument = `${frontmatter}\n${repaired}${repaired ? "\n" : ""}`;

    if (nextDocument !== document) {
      await writeFile(postPath, nextDocument, "utf8");
      changedPosts += 1;
    }
    if (post.contentSha256 !== undefined) {
      post.contentSha256 = sha256(repaired);
    }
  }

  manifest.layoutRepair = {
    version: 2,
    repairedAt: "2026-07-28",
    blockBoundariesPreserved: true,
  };
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return changedPosts;
}

if (import.meta.main) {
  let changedPosts = 0;
  for (const manifestPath of MANIFEST_PATHS) {
    changedPosts += await repairManifest(manifestPath);
  }
  console.log(`Repaired Notion block boundaries in ${changedPosts} posts.`);
}
