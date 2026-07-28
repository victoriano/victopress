import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";

import matter from "gray-matter";

type Locale = "es" | "en";

export type LanguageEvidence = {
  words: number;
  es: number;
  en: number;
};

export type BlogLanguageIssue = {
  file: string;
  locale: Locale;
  scope: "document" | "block";
  block?: number;
  evidence: LanguageEvidence;
  sample: string;
};

const BLOG_ROOT = join(process.cwd(), "content", "blog");

const SPANISH_WORDS = new Set([
  "al",
  "algo",
  "algunas",
  "algunos",
  "aunque",
  "cada",
  "como",
  "con",
  "contra",
  "cuando",
  "cual",
  "de",
  "del",
  "desde",
  "donde",
  "durante",
  "el",
  "ella",
  "ellas",
  "ellos",
  "en",
  "entre",
  "era",
  "esa",
  "esas",
  "ese",
  "esos",
  "esta",
  "estas",
  "este",
  "estos",
  "fue",
  "ha",
  "hace",
  "hacer",
  "han",
  "hasta",
  "hay",
  "las",
  "le",
  "les",
  "lo",
  "los",
  "más",
  "mientras",
  "mucho",
  "muchos",
  "nada",
  "ni",
  "nos",
  "nosotros",
  "otra",
  "otras",
  "otro",
  "otros",
  "para",
  "pero",
  "poco",
  "por",
  "porque",
  "puede",
  "pueden",
  "pues",
  "que",
  "quien",
  "se",
  "según",
  "si",
  "sin",
  "sobre",
  "son",
  "su",
  "sus",
  "también",
  "tiene",
  "tienen",
  "todo",
  "todos",
  "una",
  "uno",
  "unos",
  "ya",
  "yo",
]);

const ENGLISH_WORDS = new Set([
  "about",
  "after",
  "again",
  "all",
  "also",
  "although",
  "an",
  "and",
  "any",
  "are",
  "around",
  "as",
  "at",
  "be",
  "because",
  "been",
  "before",
  "being",
  "between",
  "both",
  "but",
  "by",
  "can",
  "could",
  "did",
  "do",
  "does",
  "during",
  "each",
  "even",
  "few",
  "for",
  "from",
  "further",
  "had",
  "has",
  "have",
  "he",
  "her",
  "here",
  "his",
  "how",
  "however",
  "if",
  "in",
  "into",
  "is",
  "it",
  "its",
  "just",
  "made",
  "make",
  "many",
  "may",
  "might",
  "more",
  "most",
  "much",
  "my",
  "now",
  "of",
  "on",
  "once",
  "one",
  "only",
  "or",
  "other",
  "our",
  "over",
  "same",
  "she",
  "should",
  "so",
  "some",
  "such",
  "than",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "those",
  "through",
  "to",
  "too",
  "under",
  "us",
  "very",
  "was",
  "we",
  "were",
  "what",
  "when",
  "where",
  "which",
  "while",
  "who",
  "why",
  "will",
  "with",
  "within",
  "without",
  "would",
  "you",
  "your",
]);

function visibleMarkdown(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/~~~[\s\S]*?~~~/g, " ")
    .replace(/`[^`\n]*`/g, " ")
    .replace(/!\[([^\]]*)]\([^)\n]+\)/g, "$1")
    .replace(/\[([^\]]*)]\([^)\n]+\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&(?:[a-z]+|#\d+);/gi, " ")
    .replace(/[*_>#|~[\]{}()\\-]/g, " ")
    .normalize("NFKC")
    .toLowerCase();
}

function normalizedWords(text: string): string[] {
  return visibleMarkdown(text).match(/[\p{L}]+/gu) || [];
}

export function languageEvidence(text: string): LanguageEvidence {
  const words = normalizedWords(text);
  let es = 0;
  let en = 0;

  for (const word of words) {
    if (SPANISH_WORDS.has(word)) es += 1;
    if (ENGLISH_WORDS.has(word)) en += 1;
  }

  return { words: words.length, es, en };
}

function belongsToOtherLanguage(
  locale: Locale,
  evidence: LanguageEvidence,
  minimumWords: number,
  minimumOther = 3,
  margin = 2,
): boolean {
  if (evidence.words < minimumWords) return false;
  const expected = locale === "es" ? evidence.es : evidence.en;
  const other = locale === "es" ? evidence.en : evidence.es;
  return other >= minimumOther && other >= expected + margin;
}

function issueSample(text: string): string {
  return visibleMarkdown(text).replace(/\s+/g, " ").trim().slice(0, 180);
}

export function inspectBlogLanguage({
  file,
  locale,
  title,
  description,
  markdown,
}: {
  file: string;
  locale: Locale;
  title: string;
  description: string;
  markdown: string;
}): BlogLanguageIssue[] {
  const issues: BlogLanguageIssue[] = [];
  const documentText = [title, description, markdown].filter(Boolean).join("\n\n");
  const documentEvidence = languageEvidence(documentText);

  if (belongsToOtherLanguage(locale, documentEvidence, 20)) {
    issues.push({
      file,
      locale,
      scope: "document",
      evidence: documentEvidence,
      sample: issueSample(documentText),
    });
  }

  for (const [index, block] of markdown.split(/\n\s*\n/).entries()) {
    const evidence = languageEvidence(block);
    const isReference = /(?:🔗|\*\*(?:source|fuente)\*\*)/i.test(block);
    if (!belongsToOtherLanguage(
      locale,
      evidence,
      isReference ? 4 : 6,
      isReference ? 2 : 3,
      isReference ? 1 : 2,
    )) continue;

    issues.push({
      file,
      locale,
      scope: "block",
      block: index + 1,
      evidence,
      sample: issueSample(block),
    });
  }

  return issues;
}

async function collectEditionFiles(directory: string): Promise<string[]> {
  const files: string[] = [];

  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectEditionFiles(path));
    } else if (/^index(?:\.(?:es|en))?\.md$/.test(entry.name)) {
      files.push(path);
    }
  }

  return files.sort();
}

export async function auditBlogLanguages(
  root = BLOG_ROOT,
): Promise<BlogLanguageIssue[]> {
  const issues: BlogLanguageIssue[] = [];

  for (const path of await collectEditionFiles(root)) {
    const source = await readFile(path, "utf8");
    const document = matter(source);
    const locale = document.data.locale;
    if (locale !== "es" && locale !== "en") {
      throw new Error(`${relative(process.cwd(), path)} has an invalid locale`);
    }

    issues.push(...inspectBlogLanguage({
      file: relative(process.cwd(), path),
      locale,
      title: String(document.data.title || ""),
      description: String(document.data.description || ""),
      markdown: document.content,
    }));
  }

  return issues;
}

if (import.meta.main) {
  const issues = await auditBlogLanguages();

  if (issues.length === 0) {
    console.log("All blog editions contain prose in their declared language.");
  } else {
    console.error(`${issues.length} blog language issue${issues.length === 1 ? "" : "s"} found:`);
    for (const issue of issues) {
      const location = issue.scope === "block" ? ` block ${issue.block}` : "";
      console.error(
        `- ${issue.file}${location}: expected ${issue.locale}, ` +
          `evidence es=${issue.evidence.es} en=${issue.evidence.en}. ` +
          issue.sample,
      );
    }
    process.exitCode = 1;
  }
}
