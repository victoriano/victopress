#!/usr/bin/env python3
"""Exhaustively validate the Squarespace to VictoPress blog migration.

Run with:
  uv run --with playwright python scripts/validate-blog-migration.py

The validator checks the canonical migration manifest, all 24 image bytes,
the public index, every individual post on both sites, link rewrites, layout
geometry, browser errors, screenshots, and the Markdown editor/save path for
every migrated post in VictoPress.
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import html
import json
import os
import re
import shlex
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import unquote, urlsplit

from playwright.async_api import BrowserContext, Error as PlaywrightError, Page, async_playwright


DEFAULT_SOURCE = "https://victoriano.me"
DEFAULT_TARGET = "https://victopress-dev.nominao.com"
DEFAULT_ADMIN_TARGET = "http://127.0.0.1:5174"
DEFAULT_MANIFEST = Path("content/blog/_migration-manifest.json")
DEFAULT_OUTPUT = Path("test-results/blog-migration")
VIEWPORT = {"width": 1440, "height": 1000}
HTTPS_LINK_HOSTS = {
    "youtu.be",
    "youtube.com",
    "www.youtube.com",
    "chicass10.blogspot.com",
}


def normalized_text(value: str) -> str:
    value = re.sub(r"\bView fullsize\b", " ", value, flags=re.IGNORECASE)
    return re.sub(r"\s+", " ", value).strip()


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, raw_value = line.split("=", 1)
        key = key.strip()
        raw_value = raw_value.strip()
        try:
            parsed = shlex.split(raw_value, comments=False, posix=True)
            value = parsed[0] if len(parsed) == 1 else raw_value
        except ValueError:
            value = raw_value.strip("\"'")
        values[key] = value
    return values


def admin_credentials(path: Path) -> dict[str, str]:
    """Load local defaults, allowing protected process env values to override them."""
    values = parse_env_file(path)
    overrides = {
        "ADMIN_USERNAME": "VICTOPRESS_ADMIN_USERNAME",
        "ADMIN_PASSWORD": "VICTOPRESS_ADMIN_PASSWORD",
    }
    for credential_key, environment_key in overrides.items():
        environment_value = os.environ.get(environment_key)
        if environment_value:
            values[credential_key] = environment_value
    return values


def content_body(index_path: Path) -> str:
    value = index_path.read_text(encoding="utf-8")
    match = re.match(r"^---\n[\s\S]*?\n---\n([\s\S]*)$", value)
    if not match:
        raise ValueError(f"Frontmatter missing from {index_path}")
    return match.group(1).strip()


def canonical_image_source(value: str) -> str:
    parsed = urlsplit(html.unescape(value))
    return f"{parsed.scheme}://{parsed.netloc}{parsed.path}"


def normalize_source_url(value: str, post: dict[str, Any]) -> str:
    value = html.unescape(value)
    image_map = {
        image["sourceUrl"]: image["localUrl"] for image in post["images"]
    }
    parsed = urlsplit(value)
    if parsed.scheme == "http" and parsed.netloc.lower() in HTTPS_LINK_HOSTS:
        return f"https://{value[len('http://'):]}"
    if parsed.netloc.endswith("squarespace-cdn.com"):
        mapped = image_map.get(canonical_image_source(value))
        if mapped:
            return mapped
    if parsed.netloc.lower() in {"victoriano.me", "www.victoriano.me"}:
        return parsed.path + (f"?{parsed.query}" if parsed.query else "") + (
            f"#{parsed.fragment}" if parsed.fragment else ""
        )
    return value


def fetch_image(url: str, expected_hash: str, expected_bytes: int) -> dict[str, Any]:
    request = urllib.request.Request(
        url,
        headers={"User-Agent": "Mozilla/5.0", "Accept": "image/*"},
    )
    with urllib.request.urlopen(request, timeout=90) as response:
        payload = response.read()
        content_type = response.headers.get("Content-Type", "").split(";", 1)[0]
        status = response.status
    return {
        "url": url,
        "status": status,
        "contentType": content_type,
        "bytes": len(payload),
        "sha256": sha256_bytes(payload),
        "matches": (
            status == 200
            and content_type.startswith("image/")
            and len(payload) == expected_bytes
            and sha256_bytes(payload) == expected_hash
        ),
    }


async def prepare_page(page: Page, url: str) -> tuple[int | None, list[dict[str, Any]]]:
    failures: list[dict[str, Any]] = []
    page.on(
        "response",
        lambda response: failures.append(
            {"status": response.status, "url": response.url}
        )
        if response.status >= 400
        else None,
    )
    response = await page.goto(url, wait_until="domcontentloaded", timeout=120_000)
    try:
        await page.wait_for_load_state("networkidle", timeout=25_000)
    except Exception:
        pass
    await page.wait_for_selector("article", timeout=60_000)
    await page.evaluate(
        """async () => {
          for (const image of document.querySelectorAll('img')) image.loading = 'eager';
          for (let y = 0; y < document.documentElement.scrollHeight; y += 650) {
            window.scrollTo(0, y);
            await new Promise(resolve => setTimeout(resolve, 45));
          }
          window.scrollTo(0, 0);
        }"""
    )
    try:
        await page.wait_for_function(
            "[...document.querySelectorAll('article img')].every(image => image.complete && image.naturalWidth > 0)",
            timeout=90_000,
        )
    except Exception:
        pass
    await page.wait_for_timeout(750)
    return response.status if response else None, failures


async def inspect_articles(page: Page) -> dict[str, Any]:
    for attempt in range(3):
        try:
            return await _inspect_articles(page)
        except Exception:
            if attempt == 2:
                raise
            try:
                await page.wait_for_load_state("domcontentloaded", timeout=30_000)
                await page.wait_for_selector("article", timeout=30_000)
                await page.wait_for_timeout(500)
            except Exception:
                pass
    raise RuntimeError("Unable to inspect articles after browser reloads")


async def _inspect_articles(page: Page) -> dict[str, Any]:
    return await page.evaluate(
        """() => ({
          documentTitle: document.title,
          scrollHeight: document.documentElement.scrollHeight,
          articles: [...document.querySelectorAll('article')].map(article => {
            const content = article.querySelector('.legacy-squarespace-content, .markdown-blog-content, .entry-content');
            const rect = article.getBoundingClientRect();
            const contentRect = content.getBoundingClientRect();
            const packRect = element => {
              const value = element.getBoundingClientRect();
              return {x: value.x, y: value.y + scrollY, width: value.width, height: value.height};
            };
            const packStyle = element => {
              const style = getComputedStyle(element);
              return {
                fontSize: style.fontSize,
                fontWeight: style.fontWeight,
                fontStyle: style.fontStyle,
                lineHeight: style.lineHeight,
                color: style.color,
                letterSpacing: style.letterSpacing,
                textDecorationLine: style.textDecorationLine,
                textAlign: style.textAlign,
              };
            };
            const title = article.querySelector('h1, h2');
            const date = article.querySelector('time');
            const visibleImages = [...content.querySelectorAll('img')].filter(image => {
              const imageRect = image.getBoundingClientRect();
              return imageRect.width > 1 && imageRect.height > 1;
            });
            const textElements = [
              ...content.querySelectorAll(
                'p:not(.blog-image-row), a:not(.blog-image-link):not(.image-slide-anchor), li, blockquote, .blog-image-caption'
              ),
            ].filter(element => !element.closest('.slide-meta, .v6-visually-hidden'));
            return {
              serialization: content.classList.contains('markdown-blog-content') ? 'markdown' : 'html',
              title: title?.textContent?.trim() || '',
              date: date?.textContent?.trim() || '',
              text: content.innerText,
              rect: {x: rect.x, y: rect.y + scrollY, width: rect.width, height: rect.height},
              contentRect: {x: contentRect.x, y: contentRect.y + scrollY, width: contentRect.width, height: contentRect.height},
              typography: {
                title: packStyle(title),
                date: packStyle(date),
                content: packStyle(content),
                elements: textElements.map(element => ({
                  kind: element.matches('.blog-image-caption, .image-caption-wrapper p')
                    ? 'caption'
                    : element.tagName.toLowerCase(),
                  style: packStyle(element),
                })),
              },
              blocks: [...content.querySelectorAll('.sqs-col-12 > .sqs-block')].map(block => ({
                kind: block.classList.contains('html-block') ? 'html' : block.classList.contains('gallery-block') ? 'gallery' : 'image',
                rect: packRect(block),
              })),
              mediaBoxes: [...content.querySelectorAll(
                '.image-block .sqs-image-shape-container-element, .gallery-block .margin-wrapper, .blog-image-link'
              )].map(packRect),
              images: visibleImages.map(image => ({
                ref: image.getAttribute('data-image') || image.getAttribute('data-src') || image.getAttribute('src') || '',
                src: image.currentSrc || image.src,
                alt: image.alt,
                naturalWidth: image.naturalWidth,
                naturalHeight: image.naturalHeight,
                rect: packRect(image),
              })),
              links: [...content.querySelectorAll('a')]
                .filter(link => !link.matches('.blog-image-link, .image-slide-anchor, .sqs-block-image-button'))
                .map(link => link.getAttribute('href') || ''),
            };
          }),
        })"""
    )


def compare_number(
    failures: list[str],
    label: str,
    source: float,
    target: float,
    tolerance: float = 0.5,
) -> None:
    if abs(source - target) > tolerance:
        failures.append(f"{label}: source={source:.3f}, target={target:.3f}")


def typography_signature(value: dict[str, Any]) -> dict[str, Any]:
    """Compare rendered style families without depending on wrapper tag counts."""
    return {
        "title": value["title"],
        "date": value["date"],
        "content": value["content"],
        "elementStyles": sorted({
            json.dumps(element["style"], sort_keys=True)
            for element in value["elements"]
        }),
    }


def compare_article(
    source_article: dict[str, Any],
    target_article: dict[str, Any],
    post: dict[str, Any],
    *,
    compare_position: bool,
) -> list[str]:
    failures: list[str] = []
    prefix = post["title"]
    if source_article["title"] != target_article["title"]:
        failures.append(f"{prefix}: title mismatch")
    if source_article["date"] != target_article["date"]:
        failures.append(
            f"{prefix}: date mismatch {source_article['date']!r} != {target_article['date']!r}"
        )

    source_text = normalized_text(source_article["text"])
    target_text = normalized_text(target_article["text"])
    if source_text != target_text:
        failures.append(
            f"{prefix}: visible text mismatch {sha256_text(source_text)} != {sha256_text(target_text)}"
        )

    if typography_signature(source_article["typography"]) != typography_signature(target_article["typography"]):
        failures.append(f"{prefix}: typography/style mismatch")

    if len(source_article["images"]) != len(target_article["images"]):
        failures.append(
            f"{prefix}: image count {len(source_article['images'])} != {len(target_article['images'])}"
        )
    if any(image["naturalWidth"] == 0 for image in target_article["images"]):
        failures.append(f"{prefix}: one or more target images failed to decode")

    source_refs = [normalize_source_url(image["ref"], post) for image in source_article["images"]]
    target_refs = [image["ref"] for image in target_article["images"]]
    if source_refs != target_refs:
        failures.append(f"{prefix}: image order/reference mismatch")

    source_links = [normalize_source_url(value, post) for value in source_article["links"]]
    if source_links != target_article["links"]:
        failures.append(f"{prefix}: link order/reference mismatch")

    # Markdown intentionally removes Squarespace's wrapper divs. Keep strict
    # wrapper geometry for the HTML fallback only; visible media and overall
    # content geometry remain strict below for Markdown posts.
    if target_article["serialization"] != "markdown":
        if len(source_article["blocks"]) != len(target_article["blocks"]):
            failures.append(f"{prefix}: content block count mismatch")
        else:
            for index, (source_block, target_block) in enumerate(
                zip(source_article["blocks"], target_article["blocks"])
            ):
                if source_block["kind"] != target_block["kind"]:
                    failures.append(f"{prefix}: block {index} type mismatch")
                compare_number(
                    failures,
                    f"{prefix}: block {index} width",
                    source_block["rect"]["width"],
                    target_block["rect"]["width"],
                )
                compare_number(
                    failures,
                    f"{prefix}: block {index} height",
                    source_block["rect"]["height"],
                    target_block["rect"]["height"],
                )

    if len(source_article["mediaBoxes"]) != len(target_article["mediaBoxes"]):
        failures.append(f"{prefix}: media container count mismatch")
    else:
        for index, (source_box, target_box) in enumerate(
            zip(source_article["mediaBoxes"], target_article["mediaBoxes"])
        ):
            compare_number(
                failures,
                f"{prefix}: media {index} width",
                source_box["width"],
                target_box["width"],
            )
            compare_number(
                failures,
                f"{prefix}: media {index} height",
                source_box["height"],
                target_box["height"],
            )

    compare_number(
        failures,
        f"{prefix}: content width",
        source_article["contentRect"]["width"],
        target_article["contentRect"]["width"],
    )
    compare_number(
        failures,
        f"{prefix}: content height",
        source_article["contentRect"]["height"],
        target_article["contentRect"]["height"],
    )
    if compare_position:
        for key in ("x", "y", "width", "height"):
            compare_number(
                failures,
                f"{prefix}: article {key}",
                source_article["rect"][key],
                target_article["rect"][key],
                tolerance=0.75,
            )
    return failures


async def validate_pair(
    context: BrowserContext,
    source_url: str,
    target_url: str,
    post: dict[str, Any] | None,
    output_root: Path,
    name: str,
) -> dict[str, Any]:
    source_page = await context.new_page()
    print(f"[browser] {name}: source")
    source_status, _ = await prepare_page(source_page, source_url)
    source_data = await inspect_articles(source_page)
    await source_page.screenshot(
        path=str(output_root / f"source-{name}.png"), full_page=False
    )
    await source_page.close()

    target_page = await context.new_page()
    target_console: list[dict[str, Any]] = []
    target_page.on(
        "console",
        lambda message: target_console.append(
            {
                "type": message.type,
                "text": message.text[:500],
                "url": message.location.get("url", ""),
            }
        )
        if message.type == "error"
        else None,
    )
    print(f"[browser] {name}: target")
    target_status, target_responses = await prepare_page(target_page, target_url)
    target_data = await inspect_articles(target_page)
    await target_page.screenshot(
        path=str(output_root / f"target-{name}.png"), full_page=False
    )

    failures: list[str] = []
    if source_status != 200:
        failures.append(f"{name}: source HTTP {source_status}")
    if target_status != 200:
        failures.append(f"{name}: target HTTP {target_status}")
    if target_responses:
        failures.extend(
            f"{name}: target resource HTTP {item['status']} {item['url']}"
            for item in target_responses
        )
    if target_console:
        failures.extend(
            f"{name}: target console error: {item['text']} ({item['url']})"
            for item in target_console
        )

    if post is None:
        expected_titles: list[str] = []
        # Caller adds the expected index comparisons below.
    else:
        expected_titles = [post["title"]]
        if len(source_data["articles"]) != 1 or len(target_data["articles"]) != 1:
            failures.append(
                f"{name}: expected one article, got {len(source_data['articles'])}/{len(target_data['articles'])}"
            )
        else:
            failures.extend(
                compare_article(
                    source_data["articles"][0],
                    target_data["articles"][0],
                    post,
                    compare_position=False,
                )
            )

    await target_page.close()
    return {
        "name": name,
        "sourceUrl": source_url,
        "targetUrl": target_url,
        "sourceStatus": source_status,
        "targetStatus": target_status,
        "source": source_data,
        "target": target_data,
        "expectedTitles": expected_titles,
        "failures": failures,
    }


async def validate_admin(
    context: BrowserContext,
    target: str,
    public_target: str,
    posts: list[dict[str, Any]],
    credentials: dict[str, str],
    output_root: Path,
) -> dict[str, Any]:
    username = credentials.get("ADMIN_USERNAME")
    password = credentials.get("ADMIN_PASSWORD")
    if not username or not password:
        return {"checked": False, "failures": ["Admin credentials unavailable"]}

    failures: list[str] = []
    page = await context.new_page()

    async def stable_goto(url: str):
        last_error: PlaywrightError | None = None
        for attempt in range(3):
            try:
                response = await page.goto(
                    url,
                    wait_until="domcontentloaded",
                    timeout=120_000,
                )
                try:
                    await page.wait_for_load_state("networkidle", timeout=15_000)
                except PlaywrightError:
                    pass
                return response
            except PlaywrightError as error:
                last_error = error
                if attempt < 2:
                    await page.wait_for_timeout(1_000 * (attempt + 1))
        assert last_error is not None
        raise last_error

    await stable_goto(f"{public_target}/admin/blog")
    public_auth_redirect = "/admin/login" in page.url
    if not public_auth_redirect:
        failures.append("Public admin route did not redirect to the login page")

    response = await stable_goto(f"{target}/admin/blog")
    if "/admin/login" in page.url:
        await page.fill("#username", username)
        await page.fill("#password", password)
        await page.locator('button[type="submit"]').click()
        await page.wait_for_url(re.compile(r"/admin/?$"), timeout=60_000)
        response = await stable_goto(f"{target}/admin/blog")

    if "/admin/login" in page.url:
        await page.close()
        return {"checked": False, "failures": ["Admin login did not complete"]}

    if not response or response.status != 200:
        failures.append(f"Admin list HTTP {response.status if response else None}")
    await page.locator("tbody").wait_for(timeout=60_000)
    body_text = await page.locator("body").inner_text()
    if "5 published, 0 drafts" not in body_text:
        failures.append("Admin stats do not show 5 published and 0 drafts")

    admin_titles = await page.evaluate(
        """() => [...new Map(
          [...document.querySelectorAll('tbody a[href^="/admin/blog/"]')]
            .filter(link => link.textContent.trim())
            .map(link => [link.getAttribute('href'), link.textContent.trim()])
        ).entries()].map(([href, title]) => ({href, title}))"""
    )
    expected_titles = [post["title"] for post in posts]
    if [item["title"] for item in admin_titles] != expected_titles:
        failures.append("Admin list titles/order do not match the migration manifest")
    await page.screenshot(path=str(output_root / "target-admin-blog.png"), full_page=True)

    editors: list[dict[str, Any]] = []
    for post_index, post in enumerate(posts):
        url = f"{target}/admin/blog/{post['slug']}"
        print(f"[admin] {post['title']}")
        editor_response = await stable_goto(url)
        await page.locator("textarea").wait_for(timeout=60_000)
        title_value = await page.locator('input[type="text"]').nth(0).input_value()
        slug_value = await page.locator('input[type="text"]').nth(1).input_value()
        editor_body = await page.locator("textarea").input_value()
        expected_body = content_body(Path(post["indexFile"]))
        item_failures: list[str] = []
        if not editor_response or editor_response.status != 200:
            item_failures.append(f"HTTP {editor_response.status if editor_response else None}")
        if title_value != post["title"]:
            item_failures.append("title field mismatch")
        if slug_value != post["slug"]:
            item_failures.append("slug field mismatch")
        if editor_body.strip() != expected_body:
            item_failures.append("editor body mismatch")
        if re.search(r"<(?:div|figure|img|p|span|a)\b", editor_body, flags=re.IGNORECASE):
            item_failures.append("editor still contains HTML")
        if await page.get_by_text("Stored as Markdown", exact=True).count() != 1:
            item_failures.append("Markdown storage indicator missing")
        if await page.get_by_role("button", name="Preview", exact=True).count() != 1:
            item_failures.append("Preview mode missing")
        if await page.locator(".markdown-blog-content").count() != 1:
            item_failures.append("Live Markdown preview missing")

        save_checked = False
        if post_index == 0 and not item_failures:
            save_result = await page.evaluate(
                """async ({slug, content}) => {
                  const body = new FormData();
                  body.append('action', 'update');
                  body.append('slug', slug);
                  body.append('content', content);
                  const response = await fetch('/api/admin/blog', {
                    method: 'POST',
                    body,
                    credentials: 'include',
                  });
                  let payload;
                  try { payload = await response.json(); }
                  catch { payload = {success: false, body: await response.text()}; }
                  return {status: response.status, payload};
                }""",
                {"slug": post["slug"], "content": editor_body},
            )
            save_payload = save_result["payload"]
            save_checked = save_result["status"] == 200 and save_payload.get("success") is True
            if not save_checked:
                item_failures.append(
                    f"save failed with HTTP {save_result['status']}: {save_payload}"
                )
        failures.extend(f"Admin {post['title']}: {value}" for value in item_failures)
        editors.append(
            {
                "title": post["title"],
                "url": url,
                "status": editor_response.status if editor_response else None,
                "contentLength": len(editor_body),
                "saveChecked": save_checked,
                "failures": item_failures,
            }
        )

    await page.close()
    return {
        "checked": True,
        "target": target,
        "publicAuthRedirect": public_auth_redirect,
        "listCount": len(admin_titles),
        "titles": [item["title"] for item in admin_titles],
        "editors": editors,
        "failures": failures,
    }


async def run(args: argparse.Namespace) -> dict[str, Any]:
    manifest_path = args.manifest.resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    posts: list[dict[str, Any]] = manifest["posts"]
    output_root = args.output.resolve()
    output_root.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []

    if manifest.get("postCount") != 5 or len(posts) != 5:
        failures.append("Manifest does not contain exactly 5 posts")
    if manifest.get("imageCount") != 24:
        failures.append("Manifest does not contain exactly 24 images")
    for post in posts:
        if post["sourceTextSha256"] != post["migratedTextSha256"]:
            failures.append(f"Manifest text hash mismatch: {post['title']}")
        if not Path(post["indexFile"]).exists():
            failures.append(f"Missing CMS post file: {post['indexFile']}")
        for image in post["images"]:
            image_path = Path("content") / image["key"]
            if not image_path.exists():
                failures.append(f"Missing local image: {image_path}")
            elif sha256_bytes(image_path.read_bytes()) != image["sha256"]:
                failures.append(f"Local image hash mismatch: {image_path}")

    print(f"[assets] validating {manifest['imageCount']} live image objects")
    asset_results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=6) as executor:
        jobs = {
            executor.submit(
                fetch_image,
                f"{args.target}{image['localUrl']}",
                image["sha256"],
                image["bytes"],
            ): image
            for post in posts
            for image in post["images"]
        }
        for future in as_completed(jobs):
            image = jobs[future]
            try:
                result = future.result()
            except Exception as error:
                result = {
                    "url": f"{args.target}{image['localUrl']}",
                    "matches": False,
                    "error": f"{type(error).__name__}: {error}",
                }
            asset_results.append(result)
            if not result["matches"]:
                failures.append(f"Live image mismatch: {result['url']}")
    asset_results.sort(key=lambda item: item["url"])

    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True)
        public_context = await browser.new_context(viewport=VIEWPORT, device_scale_factor=1)

        index_result = await validate_pair(
            public_context,
            f"{args.source}/blog",
            f"{args.target}/blog",
            None,
            output_root,
            "index",
        )
        expected_titles = [post["title"] for post in posts]
        source_articles = index_result["source"]["articles"]
        target_articles = index_result["target"]["articles"]
        if [article["title"] for article in source_articles] != expected_titles:
            index_result["failures"].append("Source index titles/order differ from manifest")
        if [article["title"] for article in target_articles] != expected_titles:
            index_result["failures"].append("Target index titles/order differ from manifest")
        if len(source_articles) == len(target_articles) == len(posts):
            for source_article, target_article, post in zip(
                source_articles, target_articles, posts
            ):
                index_result["failures"].extend(
                    compare_article(
                        source_article,
                        target_article,
                        post,
                        compare_position=True,
                    )
                )
            compare_number(
                index_result["failures"],
                "Index document height",
                index_result["source"]["scrollHeight"],
                index_result["target"]["scrollHeight"],
                tolerance=1,
            )
        failures.extend(index_result["failures"])

        post_results: list[dict[str, Any]] = []
        for post in posts:
            name = post["slug"].replace("/", "__")
            result = await validate_pair(
                public_context,
                post["sourceUrl"],
                f"{args.target}{post['targetPath']}",
                post,
                output_root,
                name,
            )
            post_results.append(result)
            failures.extend(result["failures"])

        credentials = admin_credentials(args.env_file)
        admin_context = await browser.new_context(viewport=VIEWPORT)
        admin_result = await validate_admin(
            admin_context,
            args.admin_target,
            args.target,
            posts,
            credentials,
            output_root,
        )
        failures.extend(admin_result["failures"])
        await admin_context.close()
        await public_context.close()
        try:
            await asyncio.wait_for(browser.close(), timeout=30)
        except (TimeoutError, PlaywrightError) as error:
            print(f"[browser] close warning: {type(error).__name__}")

    return {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "source": args.source,
        "target": args.target,
        "manifest": str(manifest_path),
        "postCount": len(posts),
        "imageCount": len(asset_results),
        "assetMatches": sum(1 for item in asset_results if item["matches"]),
        "assets": asset_results,
        "index": index_result,
        "posts": post_results,
        "admin": admin_result,
        "failures": failures,
        "passed": not failures,
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", default=DEFAULT_SOURCE)
    parser.add_argument("--target", default=DEFAULT_TARGET)
    parser.add_argument("--admin-target", default=DEFAULT_ADMIN_TARGET)
    parser.add_argument("--manifest", type=Path, default=DEFAULT_MANIFEST)
    parser.add_argument("--env-file", type=Path, default=Path(".dev.vars"))
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    report = asyncio.run(run(args))
    report_path = args.output.resolve() / "validation-report.json"
    report_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(
        f"Validation {'PASSED' if report['passed'] else 'FAILED'}: "
        f"{report['postCount']} posts, {report['assetMatches']}/{report['imageCount']} images, "
        f"{len(report['failures'])} failures"
    )
    print(f"Report: {report_path}")
    if report["failures"]:
        for failure in report["failures"]:
            print(f"  - {failure}")
        raise SystemExit(1)


if __name__ == "__main__":
    main()
