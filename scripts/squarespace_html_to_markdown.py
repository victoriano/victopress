#!/usr/bin/env python3
"""Convert the small Squarespace block subset used by this blog to Markdown.

The converter deliberately uses only Python's standard library. It understands
the text, image, and grid-gallery blocks found in the source export and emits
portable Markdown. Gallery layout is stored in the optional image title
(`gallery-2` or `gallery-3`), which remains valid Markdown and lets VictoPress
reproduce the original two- and three-column compositions.
"""

from __future__ import annotations

import argparse
import re
from dataclasses import dataclass, field
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable, Iterator


VOID_ELEMENTS = {
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
    "meta", "param", "source", "track", "wbr",
}


@dataclass
class Node:
    tag: str
    attrs: dict[str, str] = field(default_factory=dict)
    children: list["Node | str"] = field(default_factory=list)
    parent: "Node | None" = field(default=None, repr=False)

    @property
    def classes(self) -> set[str]:
        return set(self.attrs.get("class", "").split())

    def descendants(self) -> Iterator["Node"]:
        for child in self.children:
            if isinstance(child, Node):
                yield child
                yield from child.descendants()

    def find_by_class(self, class_name: str) -> "Node | None":
        if class_name in self.classes:
            return self
        return next((node for node in self.descendants() if class_name in node.classes), None)


class DOMParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.root = Node("root")
        self.stack = [self.root]

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        node = Node(tag.lower(), {key: value or "" for key, value in attrs}, parent=self.stack[-1])
        self.stack[-1].children.append(node)
        if node.tag not in VOID_ELEMENTS:
            self.stack.append(node)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        self.handle_starttag(tag, attrs)
        if tag.lower() not in VOID_ELEMENTS:
            self.stack.pop()

    def handle_endtag(self, tag: str) -> None:
        wanted = tag.lower()
        for index in range(len(self.stack) - 1, 0, -1):
            if self.stack[index].tag == wanted:
                del self.stack[index:]
                return

    def handle_data(self, data: str) -> None:
        self.stack[-1].children.append(data)


def normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", value.replace("\xa0", " "))


def text_content(node: Node) -> str:
    parts: list[str] = []
    for child in node.children:
        if isinstance(child, str):
            parts.append(child)
        elif child.tag not in {"script", "style", "noscript"}:
            parts.append(text_content(child))
    return normalize_text("".join(parts)).strip()


def wrapped(value: str, marker: str) -> str:
    if not value.strip():
        return value
    leading = value[: len(value) - len(value.lstrip())]
    trailing = value[len(value.rstrip()):]
    core = value.strip()
    if not re.search(r"\w", core, flags=re.UNICODE):
        return f"{leading}{core}{trailing}"
    return f"{leading}{marker}{core}{marker}{trailing}"


def inline_markdown(node: Node) -> str:
    parts: list[str] = []
    for child in node.children:
        if isinstance(child, str):
            parts.append(normalize_text(child))
            continue

        if child.tag in {"script", "style", "noscript", "img"}:
            continue
        if "v6-visually-hidden" in child.classes:
            continue

        inner = inline_markdown(child)
        if child.tag in {"strong", "b"}:
            parts.append(wrapped(inner, "**"))
        elif child.tag in {"em", "i"}:
            parts.append(wrapped(inner, "*"))
        elif child.tag == "code":
            parts.append(wrapped(inner.replace("`", "\\`"), "`"))
        elif child.tag == "a":
            href = child.attrs.get("href", "").strip().replace(" ", "%20")
            label = inner.strip()
            leading = inner[: len(inner) - len(inner.lstrip())]
            trailing = inner[len(inner.rstrip()):]
            parts.append(
                f"{leading}[{label}]({href}){trailing}" if href and label else inner
            )
        elif child.tag == "br":
            parts.append("\\\n")
        else:
            parts.append(inner)
    return "".join(parts)


def direct_children(node: Node, tag: str) -> list[Node]:
    return [child for child in node.children if isinstance(child, Node) and child.tag == tag]


def list_markdown(node: Node, depth: int = 0) -> str:
    ordered = node.tag == "ol"
    lines: list[str] = []
    for index, item in enumerate(direct_children(node, "li"), 1):
        nested = [
            child for child in item.children
            if isinstance(child, Node) and child.tag in {"ul", "ol"}
        ]
        inline_children = Node(
            "span",
            children=[
                child for child in item.children
                if not (isinstance(child, Node) and child.tag in {"ul", "ol"})
            ],
        )
        label = block_markdown(inline_children).replace("\n\n", " ").strip()
        prefix = f"{index}. " if ordered else "- "
        indentation = "  " * depth
        lines.append(f"{indentation}{prefix}{label}")
        for nested_list in nested:
            lines.append(list_markdown(nested_list, depth + 1))
    return "\n".join(lines)


def block_markdown(node: Node) -> str:
    blocks: list[str] = []
    for child in node.children:
        if isinstance(child, str):
            value = normalize_text(child).strip()
            if value:
                blocks.append(value)
            continue

        if child.tag in {"script", "style", "noscript"}:
            continue
        if child.tag in {"p", "div", "section", "article"}:
            if child.tag == "p":
                value = inline_markdown(child).strip()
            else:
                value = block_markdown(child).strip()
            if value:
                blocks.append(value)
        elif child.tag in {"h1", "h2", "h3", "h4", "h5", "h6"}:
            value = inline_markdown(child).strip()
            if value:
                blocks.append(f"{'#' * int(child.tag[1])} {value}")
        elif child.tag in {"ul", "ol"}:
            value = list_markdown(child)
            if value:
                blocks.append(value)
        elif child.tag == "blockquote":
            value = block_markdown(child).strip() or inline_markdown(child).strip()
            if value:
                blocks.append("\n".join(f"> {line}" if line else ">" for line in value.splitlines()))
        elif child.tag == "hr":
            blocks.append("---")
        else:
            value = inline_markdown(child).strip()
            if value:
                blocks.append(value)
    return "\n\n".join(blocks)


def block_nodes(root: Node) -> Iterable[Node]:
    for node in root.descendants():
        if "sqs-block" not in node.classes:
            continue
        ancestor = node.parent
        while ancestor and ancestor is not root:
            if "sqs-block" in ancestor.classes:
                break
            ancestor = ancestor.parent
        else:
            yield node


def image_records(block: Node) -> list[tuple[str, str]]:
    records: list[tuple[str, str]] = []
    seen: set[str] = set()
    for image in (node for node in block.descendants() if node.tag == "img"):
        src = image.attrs.get("data-image") or image.attrs.get("data-src") or image.attrs.get("src")
        if not src or src in seen:
            continue
        seen.add(src)
        records.append((src, normalize_text(image.attrs.get("alt", "")).strip()))
    return records


def markdown_alt(value: str) -> str:
    return value.replace("\\", "\\\\").replace("[", "\\[").replace("]", "\\]")


def image_markdown(src: str, alt: str = "", title: str | None = None) -> str:
    suffix = f' "{title}"' if title else ""
    return f"![{markdown_alt(alt)}]({src}{suffix})"


def squarespace_html_to_markdown(body: str) -> str:
    parser = DOMParser()
    parser.feed(body)
    output: list[str] = []

    for block in block_nodes(parser.root):
        if "sqs-block-html" in block.classes:
            content = block.find_by_class("sqs-html-content") or block.find_by_class("sqs-block-content") or block
            value = block_markdown(content).strip()
            if value:
                output.append(value)
            continue

        if "sqs-block-gallery" in block.classes:
            class_names = set(block.classes)
            for descendant in block.descendants():
                class_names.update(descendant.classes)
            column_class = next(
                (name for name in class_names if name.startswith("sqs-gallery-thumbnails-per-row-")),
                "sqs-gallery-thumbnails-per-row-2",
            )
            columns = column_class.rsplit("-", 1)[-1]
            images = image_records(block)
            if images:
                output.append("\n".join(
                    image_markdown(src, alt, f"gallery-{columns}")
                    for src, alt in images
                ))
            continue

        if "sqs-block-image" in block.classes:
            images = image_records(block)
            if not images:
                continue
            caption_node = block.find_by_class("image-caption-wrapper")
            caption = text_content(caption_node) if caption_node else ""
            src, alt = images[0]
            if caption:
                output.append(image_markdown(src, caption, "caption"))
            else:
                output.append(image_markdown(src, alt))

    return "\n\n".join(output).strip() + "\n"


def convert_file(path: Path, *, check: bool = False) -> bool:
    source = path.read_text(encoding="utf-8")
    match = re.match(r"^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$", source)
    if not match or not re.search(r"(?m)^format:\s*html\s*$", match.group(1)):
        return False

    frontmatter = re.sub(
        r"(?m)^format:\s*html\s*$",
        "format: markdown",
        match.group(1),
    )
    markdown = squarespace_html_to_markdown(match.group(2))
    converted = f"---\n{frontmatter}\n---\n\n{markdown}"
    if re.search(r"<(?:div|figure|img|p|span|a)\b", markdown, flags=re.IGNORECASE):
        raise RuntimeError(f"HTML remained after converting {path}")
    if not check:
        path.write_text(converted, encoding="utf-8")
    return True


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("paths", nargs="*", type=Path)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    paths = args.paths or sorted(Path("content/blog").glob("**/index.md"))
    changed = [path for path in paths if convert_file(path, check=args.check)]
    action = "would convert" if args.check else "converted"
    for path in changed:
        print(f"[{action}] {path}")
    print(f"{action.capitalize()} {len(changed)} Markdown post(s)")


if __name__ == "__main__":
    main()
