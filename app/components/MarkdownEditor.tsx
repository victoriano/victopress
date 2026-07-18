import { useCallback, useRef, useState } from "react";
import { MarkdownContent } from "~/components/BlogPostContent";

type EditorMode = "write" | "preview" | "split";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  imagePathHint?: string;
}

export function MarkdownEditor({ value, onChange, imagePathHint }: MarkdownEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<EditorMode>("split");

  const replaceSelection = useCallback((
    before: string,
    after: string,
    placeholder: string,
    alwaysUsePlaceholder = false,
  ) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = value.slice(start, end);
    const insertion = alwaysUsePlaceholder ? placeholder : selected || placeholder;
    const nextValue = value.slice(0, start) + before + insertion + after + value.slice(end);
    onChange(nextValue);

    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(start + before.length, start + before.length + insertion.length);
    });
  }, [onChange, value]);

  const prefixLines = useCallback((prefix: string, numbered = false) => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    const selectionStart = textarea.selectionStart;
    const selectionEnd = textarea.selectionEnd;
    const lineStart = value.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1;
    const nextBreak = value.indexOf("\n", selectionEnd);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    const block = value.slice(lineStart, lineEnd);
    const lines = block.split("\n");
    const prefixed = lines.map((line, index) => {
      if (numbered) return `${index + 1}. ${line.replace(/^\d+\.\s+/, "")}`;
      if (prefix.startsWith("#")) return `${prefix}${line.replace(/^#{1,6}\s+/, "")}`;
      return line.startsWith(prefix) ? line.slice(prefix.length) : `${prefix}${line}`;
    }).join("\n");

    onChange(value.slice(0, lineStart) + prefixed + value.slice(lineEnd));
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(lineStart, lineStart + prefixed.length);
    });
  }, [onChange, value]);

  const insertLink = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const selected = value.slice(textarea.selectionStart, textarea.selectionEnd) || "link text";
    const href = window.prompt("Link URL", "https://");
    if (!href) return;
    replaceSelection("[", `](${href})`, selected);
  }, [replaceSelection, value]);

  const insertImage = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const src = window.prompt(
      "Image URL or VictoPress image path",
      imagePathHint ? `/api/images/${imagePathHint}/image.jpg` : "/api/images/blog/image.jpg",
    );
    if (!src) return;
    const alt = window.prompt("Alt text or caption", "") || "";
    const markdown = alt ? `![${alt}](${src} "caption")` : `![](${src})`;
    replaceSelection("", "", markdown, true);
  }, [imagePathHint, replaceSelection]);

  const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    if (event.key.toLowerCase() === "b") {
      event.preventDefault();
      replaceSelection("**", "**", "bold text");
    }
    if (event.key.toLowerCase() === "i") {
      event.preventDefault();
      replaceSelection("*", "*", "italic text");
    }
    if (event.key.toLowerCase() === "k") {
      event.preventDefault();
      insertLink();
    }
  }, [insertLink, replaceSelection]);

  const showEditor = mode !== "preview";
  const showPreview = mode !== "write";
  const wordCount = value.trim() ? value.trim().split(/\s+/).length : 0;

  return (
    <div className="overflow-hidden border border-gray-200 bg-white shadow-sm dark:border-gray-700 dark:bg-gray-900">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-200 bg-gray-50 px-3 py-2 dark:border-gray-700 dark:bg-gray-800">
        <div className="flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
          <span className="h-2 w-2 rounded-full bg-green-500" aria-hidden="true" />
          Stored as Markdown
        </div>
        <div className="inline-flex border border-gray-200 bg-white p-0.5 dark:border-gray-700 dark:bg-gray-900" aria-label="Editor view">
          <ModeButton active={mode === "write"} onClick={() => setMode("write")}>Write</ModeButton>
          <ModeButton active={mode === "preview"} onClick={() => setMode("preview")}>Preview</ModeButton>
          <ModeButton active={mode === "split"} onClick={() => setMode("split")}>Split</ModeButton>
        </div>
      </div>

      {showEditor && (
        <div className="flex flex-wrap items-center gap-1 border-b border-gray-200 px-3 py-2 dark:border-gray-700" role="toolbar" aria-label="Markdown formatting">
          <ToolbarButton label="Heading 2" onClick={() => prefixLines("## ")}><span className="font-semibold">H2</span></ToolbarButton>
          <ToolbarButton label="Heading 3" onClick={() => prefixLines("### ")}><span className="font-semibold">H3</span></ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton label="Bold (⌘B)" onClick={() => replaceSelection("**", "**", "bold text")}><strong>B</strong></ToolbarButton>
          <ToolbarButton label="Italic (⌘I)" onClick={() => replaceSelection("*", "*", "italic text")}><em>I</em></ToolbarButton>
          <ToolbarButton label="Link (⌘K)" onClick={insertLink}>Link</ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton label="Quote" onClick={() => prefixLines("> ")}>“”</ToolbarButton>
          <ToolbarButton label="Bulleted list" onClick={() => prefixLines("- ")}>• List</ToolbarButton>
          <ToolbarButton label="Numbered list" onClick={() => prefixLines("", true)}>1. List</ToolbarButton>
          <ToolbarDivider />
          <ToolbarButton label="Insert image" onClick={insertImage}>Image</ToolbarButton>
        </div>
      )}

      <div className={mode === "split" ? "grid lg:grid-cols-2" : "block"}>
        {showEditor && (
          <div className={mode === "split" ? "border-b border-gray-200 lg:border-b-0 lg:border-r dark:border-gray-700" : ""}>
            <div className="border-b border-gray-100 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-gray-400 dark:border-gray-800">
              Markdown
            </div>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="# Start writing…"
              spellCheck
              className="min-h-[34rem] w-full resize-y bg-transparent px-5 py-5 font-sans text-[16px] leading-7 text-gray-900 outline-none placeholder:text-gray-300 dark:text-white dark:placeholder:text-gray-600"
            />
          </div>
        )}

        {showPreview && (
          <div className="min-w-0 bg-[#fdfdfc] dark:bg-gray-950">
            <div className="border-b border-gray-100 px-4 py-2 text-[11px] font-medium uppercase tracking-[0.12em] text-gray-400 dark:border-gray-800">
              Live preview
            </div>
            <div className="min-h-[34rem] overflow-hidden px-5 py-5">
              {value.trim() ? (
                <MarkdownContent content={value} />
              ) : (
                <p className="pt-8 text-center text-sm text-gray-400">Your post will appear here.</p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center justify-between border-t border-gray-200 bg-gray-50 px-3 py-2 text-xs text-gray-400 dark:border-gray-700 dark:bg-gray-800">
        <span>⌘B bold · ⌘I italic · ⌘K link</span>
        <span>{wordCount} words · {value.length} characters</span>
      </div>
    </div>
  );
}

function ModeButton({ active, onClick, children }: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1.5 text-xs font-medium transition-colors ${
        active
          ? "bg-gray-900 text-white dark:bg-white dark:text-gray-900"
          : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function ToolbarButton({ label, onClick, children }: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="min-w-8 px-2 py-1.5 text-xs text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-950 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
    >
      {children}
    </button>
  );
}

function ToolbarDivider() {
  return <span className="mx-1 h-5 w-px bg-gray-200 dark:bg-gray-700" aria-hidden="true" />;
}
