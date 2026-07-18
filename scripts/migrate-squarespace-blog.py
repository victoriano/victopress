#!/usr/bin/env python3
"""Download Victoriano's Squarespace blog into VictoPress content folders.

The migration keeps the trusted Squarespace body HTML so captions, image
grids, links, and widths are not flattened by a Markdown conversion. Every
remote image is downloaded and every image reference is rewritten to the
VictoPress image API. The generated manifest is also used by the exhaustive
post-migration validator.
"""

from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import tempfile
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from html.parser import HTMLParser
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit


DEFAULT_SOURCE = "https://victoriano.me/blog?format=json"
DEFAULT_OUTPUT = Path("content/blog")
IMAGE_HOSTS = ("squarespace-cdn.com", "static1.squarespace.com")
HTTPS_LINK_HOSTS = {
    "youtu.be",
    "youtube.com",
    "www.youtube.com",
    "chicass10.blogspot.com",
}
USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138 Safari/537.36"
)


class BodyAuditParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.images: list[str] = []
        self.links: list[str] = []
        self.text_parts: list[str] = []
        self._ignored_depth = 0

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {key: value or "" for key, value in attrs}
        if tag in {"script", "style", "noscript"}:
            self._ignored_depth += 1
            return

        if tag == "img":
            value = (
                attributes.get("data-src")
                or attributes.get("data-image")
                or attributes.get("src")
            )
            if value and is_source_image(value):
                canonical = canonical_image_url(value)
                if canonical not in self.images:
                    self.images.append(canonical)

        if tag == "a" and attributes.get("href"):
            self.links.append(attributes["href"])

        if tag in {"p", "li", "blockquote", "br", "h1", "h2", "h3"}:
            self.text_parts.append(" ")

    def handle_endtag(self, tag: str) -> None:
        if tag in {"script", "style", "noscript"} and self._ignored_depth:
            self._ignored_depth -= 1
            return
        if tag in {"p", "li", "blockquote", "h1", "h2", "h3"}:
            self.text_parts.append(" ")

    def handle_data(self, data: str) -> None:
        if not self._ignored_depth:
            self.text_parts.append(data)

    @property
    def plain_text(self) -> str:
        text = re.sub(r"\bView fullsize\b", " ", "".join(self.text_parts), flags=re.IGNORECASE)
        return re.sub(r"\s+", " ", text).strip()


def request_bytes(url: str, *, referer: str | None = None, timeout: int = 90) -> tuple[bytes, str]:
    headers = {"User-Agent": USER_AGENT, "Accept": "*/*"}
    if referer:
        headers["Referer"] = referer
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return response.read(), response.headers.get("Content-Type", "")


def is_source_image(url: str) -> bool:
    host = urlsplit(url).netloc.lower()
    return any(host == suffix or host.endswith(f".{suffix}") for suffix in IMAGE_HOSTS)


def canonical_image_url(url: str) -> str:
    parsed = urlsplit(html.unescape(url))
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"


def safe_filename(url: str, used: set[str]) -> str:
    raw_name = unquote(Path(urlsplit(url).path).name) or "image.jpg"
    clean_name = re.sub(r"[^A-Za-z0-9._-]+", "-", raw_name).strip("-.") or "image.jpg"
    stem = Path(clean_name).stem
    suffix = Path(clean_name).suffix or ".jpg"
    candidate = f"{stem}{suffix}"
    counter = 2
    while candidate.lower() in used:
        candidate = f"{stem}-{counter}{suffix}"
        counter += 1
    used.add(candidate.lower())
    return candidate


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def download_image(
    source_url: str,
    destination: Path,
    referer: str,
    previous: dict[str, Any] | None,
) -> dict[str, Any]:
    if previous and destination.exists():
        expected_hash = previous.get("sha256")
        if expected_hash and sha256_file(destination) == expected_hash:
            return {
                "sha256": expected_hash,
                "bytes": destination.stat().st_size,
                "contentType": previous.get("contentType", ""),
                "reused": True,
            }

    data, content_type = request_bytes(source_url, referer=referer)
    if not content_type.lower().startswith("image/"):
        raise RuntimeError(f"Expected an image from {source_url}, got {content_type!r}")

    destination.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=destination.parent, delete=False) as handle:
        handle.write(data)
        temporary_path = Path(handle.name)
    os.replace(temporary_path, destination)

    return {
        "sha256": hashlib.sha256(data).hexdigest(),
        "bytes": len(data),
        "contentType": content_type.split(";", 1)[0],
        "reused": False,
    }


def ensure_image_src(match: re.Match[str]) -> str:
    tag = match.group(0)
    tag = re.sub(r"\s+srcset=(\"[^\"]*\"|'[^']*')", "", tag, flags=re.IGNORECASE)
    tag = re.sub(r"\s+onload=(\"[^\"]*\"|'[^']*')", "", tag, flags=re.IGNORECASE)
    tag = re.sub(r"\s+data-load=(\"[^\"]*\"|'[^']*')", "", tag, flags=re.IGNORECASE)

    data_src = re.search(r"\sdata-src=(\"([^\"]*)\"|'([^']*)')", tag, flags=re.IGNORECASE)
    src = re.search(r"\ssrc=(\"([^\"]*)\"|'([^']*)')", tag, flags=re.IGNORECASE)
    if not src and data_src:
        value = data_src.group(2) or data_src.group(3) or ""
        tag = tag.replace("<img", f'<img src="{html.escape(value, quote=True)}"', 1)

    closing = "/>" if tag.rstrip().endswith("/>") else ">"
    body = tag.rstrip()[:-len(closing)].rstrip()
    if not re.search(r"\sloading=", body, flags=re.IGNORECASE):
        body += ' loading="lazy"'
    if not re.search(r"\sdecoding=", body, flags=re.IGNORECASE):
        body += ' decoding="async"'
    tag = f"{body}{closing}"
    return tag


def upgrade_safe_http_href(match: re.Match[str]) -> str:
    quote = match.group(1)
    value = html.unescape(match.group(2))
    if urlsplit(value).netloc.lower() not in HTTPS_LINK_HOSTS:
        return match.group(0)
    return f"href={quote}https://{value[len('http://'):]}{quote}"


def rewrite_body(body: str, image_map: dict[str, str]) -> str:
    migrated = body
    for source_url, local_url in sorted(image_map.items(), key=lambda pair: len(pair[0]), reverse=True):
        migrated = migrated.replace(source_url, local_url)

    # Same-site links should keep their path but resolve on the new domain.
    migrated = re.sub(
        r"(href=(?:\"|'))https?://(?:www\.)?victoriano\.me(?=/)",
        r"\1",
        migrated,
        flags=re.IGNORECASE,
    )
    # These providers enforce HTTPS in modern browsers. Store the canonical
    # secure URL so server HTML and the hydrated DOM remain byte-consistent.
    migrated = re.sub(
        r"href=(\"|')(http://[^\"']+)\1",
        upgrade_safe_http_href,
        migrated,
        flags=re.IGNORECASE,
    )
    migrated = re.sub(r"<img\b[^>]*>", ensure_image_src, migrated, flags=re.IGNORECASE)

    remaining_hosts = [host for host in IMAGE_HOSTS if host in migrated]
    if remaining_hosts:
        raise RuntimeError(f"Unmigrated image hosts remain in body: {remaining_hosts}")
    return migrated


def yaml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def build_frontmatter(
    item: dict[str, Any],
    slug: str,
    date: str,
    description: str,
    cover_key: str | None,
) -> str:
    original_url = f"https://victoriano.me{item['fullUrl']}"
    lines = [
        "---",
        f"title: {yaml_string(item['title'])}",
        f"slug: {yaml_string(slug)}",
        f"date: {date}",
        f"description: {yaml_string(description)}",
        'author: "Victoriano Izquierdo"',
        "draft: false",
        "format: html",
        "coverInBody: true",
        f"sourceUrl: {yaml_string(original_url)}",
    ]
    if cover_key:
        lines.append(f"cover: {yaml_string(cover_key)}")
    tags = [str(tag) for tag in item.get("tags") or []]
    if tags:
        lines.append("tags:")
        lines.extend(f"  - {yaml_string(tag)}" for tag in tags)
    lines.extend(["---", ""])
    return "\n".join(lines)


def load_previous_manifest(path: Path) -> dict[str, dict[str, Any]]:
    if not path.exists():
        return {}
    try:
        manifest = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return {
        image["sourceUrl"]: image
        for post in manifest.get("posts", [])
        for image in post.get("images", [])
        if image.get("sourceUrl")
    }


def migrate(source_url: str, output_root: Path, workers: int) -> dict[str, Any]:
    raw_json, content_type = request_bytes(source_url)
    if "json" not in content_type.lower():
        raise RuntimeError(f"Squarespace endpoint did not return JSON: {content_type!r}")
    source = json.loads(raw_json)
    items = source.get("items") or []
    if not items:
        raise RuntimeError("No blog entries found in Squarespace JSON")

    output_root.mkdir(parents=True, exist_ok=True)
    source_snapshot_path = output_root / "_source.json"
    source_snapshot_path.write_bytes(raw_json)
    manifest_path = output_root / "_migration-manifest.json"
    previous_images = load_previous_manifest(manifest_path)

    prepared_posts: list[dict[str, Any]] = []
    download_jobs: list[dict[str, Any]] = []

    for item in items:
        full_url = str(item.get("fullUrl") or "")
        if not full_url.startswith("/blog/"):
            raise RuntimeError(f"Unexpected blog URL: {full_url!r}")
        slug = full_url[len("/blog/") :].strip("/")
        if not slug or any(segment in {"", ".", ".."} for segment in slug.split("/")):
            raise RuntimeError(f"Unsafe blog slug: {slug!r}")

        post_directory = output_root / Path(*slug.split("/"))
        post_directory.mkdir(parents=True, exist_ok=True)
        parser = BodyAuditParser()
        parser.feed(item.get("body") or "")
        used_names: set[str] = set()
        images: list[dict[str, Any]] = []
        image_map: dict[str, str] = {}

        for source_image_url in parser.images:
            filename = safe_filename(source_image_url, used_names)
            destination = post_directory / filename
            key = f"blog/{slug}/{filename}"
            local_url = f"/api/images/{key}"
            image = {
                "sourceUrl": source_image_url,
                "filename": filename,
                "key": key,
                "localUrl": local_url,
                "path": destination,
            }
            images.append(image)
            image_map[source_image_url] = local_url
            download_jobs.append(image | {"referer": f"https://victoriano.me{full_url}"})

        publish_on = int(item.get("publishOn") or item.get("addedOn") or 0)
        date = datetime.fromtimestamp(publish_on / 1000, timezone.utc).date().isoformat()
        description = parser.plain_text[:220].strip()
        if len(parser.plain_text) > len(description):
            description = description.rsplit(" ", 1)[0].rstrip(".,;:") + "…"

        prepared_posts.append(
            {
                "item": item,
                "slug": slug,
                "date": date,
                "description": description,
                "directory": post_directory,
                "images": images,
                "imageMap": image_map,
                "sourceText": parser.plain_text,
            }
        )

    with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
        futures = {
            executor.submit(
                download_image,
                job["sourceUrl"],
                job["path"],
                job["referer"],
                previous_images.get(job["sourceUrl"]),
            ): job
            for job in download_jobs
        }
        for future in as_completed(futures):
            job = futures[future]
            result = future.result()
            job.update(result)
            state = "reused" if result["reused"] else "downloaded"
            print(f"[{state}] {job['key']} ({result['bytes']} bytes)")

    results_by_source = {job["sourceUrl"]: job for job in download_jobs}
    manifest_posts: list[dict[str, Any]] = []

    for post in prepared_posts:
        item = post["item"]
        migrated_body = rewrite_body(item.get("body") or "", post["imageMap"])
        cover_key = post["images"][0]["key"] if post["images"] else None
        frontmatter = build_frontmatter(
            item,
            post["slug"],
            post["date"],
            post["description"],
            cover_key,
        )
        index_path = post["directory"] / "index.md"
        index_path.write_text(f"{frontmatter}\n{migrated_body.strip()}\n", encoding="utf-8")

        migrated_parser = BodyAuditParser()
        migrated_parser.feed(migrated_body)
        manifest_images = []
        for image in post["images"]:
            result = results_by_source[image["sourceUrl"]]
            manifest_images.append(
                {
                    "sourceUrl": image["sourceUrl"],
                    "localUrl": image["localUrl"],
                    "key": image["key"],
                    "filename": image["filename"],
                    "bytes": result["bytes"],
                    "sha256": result["sha256"],
                    "contentType": result["contentType"],
                }
            )

        manifest_posts.append(
            {
                "title": item["title"],
                "date": post["date"],
                "sourceUrl": f"https://victoriano.me{item['fullUrl']}",
                "targetPath": f"/blog/{post['slug']}",
                "slug": post["slug"],
                "indexFile": str(index_path),
                "sourceBodySha256": hashlib.sha256((item.get("body") or "").encode()).hexdigest(),
                "migratedBodySha256": hashlib.sha256(migrated_body.encode()).hexdigest(),
                "sourceTextSha256": hashlib.sha256(post["sourceText"].encode()).hexdigest(),
                "migratedTextSha256": hashlib.sha256(migrated_parser.plain_text.encode()).hexdigest(),
                "links": migrated_parser.links,
                "images": manifest_images,
            }
        )
        print(f"[post] {item['title']} -> {index_path}")

    manifest = {
        "version": 1,
        "source": source_url,
        "sourceSnapshot": str(source_snapshot_path),
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "postCount": len(manifest_posts),
        "imageCount": sum(len(post["images"]) for post in manifest_posts),
        "posts": manifest_posts,
    }
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return manifest


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--workers", type=int, default=6)
    args = parser.parse_args()

    manifest = migrate(args.source, args.output, args.workers)
    total_bytes = sum(
        image["bytes"] for post in manifest["posts"] for image in post["images"]
    )
    print(
        f"Migration complete: {manifest['postCount']} posts, "
        f"{manifest['imageCount']} images, {total_bytes / 1024 / 1024:.1f} MiB"
    )


if __name__ == "__main__":
    main()
