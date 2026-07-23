#!/usr/bin/env python3
"""Browser smoke test for the public Squarespace-order migration."""

import argparse
import asyncio
import json
from pathlib import Path

from playwright.async_api import async_playwright


CHECKS = [
    {
        "name": "portraits",
        "path": "/gallery/humans/portraits",
        "count": 38,
        "first": [
            "galleries/humans/portraits/16829268284_d477cb6f9a_o.jpg",
            "galleries/humans/portraits/IMG_3206bw.jpg",
            "galleries/humans/portraits/IMG_2909.jpg",
            "galleries/humans/portraits/22706019080_dfec053d8c_o.jpg",
        ],
    },
    {
        "name": "rome-repeated-photo",
        "path": "/gallery/geographies/europe/italy/rome",
        "count": 38,
    },
    {
        "name": "japan-page-2",
        "path": "/gallery/geographies/asia/japan?page=2",
        "count": 46,
    },
    {
        "name": "featured-home",
        "path": "/",
        "count": 26,
    },
]


def image_path(src: str) -> str:
    marker = "/api/images/"
    return src.split(marker, 1)[1] if marker in src else ""


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--base-url",
        default="https://victopress-dev.nominao.com",
    )
    parser.add_argument(
        "--screenshot",
        default="test-results/squarespace-order-portraits.png",
    )
    args = parser.parse_args()

    screenshot_path = Path(args.screenshot).resolve()
    screenshot_path.parent.mkdir(parents=True, exist_ok=True)
    failures: list[str] = []
    results: list[dict[str, object]] = []

    async with async_playwright() as playwright:
        chrome_path = Path(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        )
        browser = await playwright.chromium.launch(
            headless=True,
            executable_path=str(chrome_path) if chrome_path.exists() else None,
        )
        page = await browser.new_page(viewport={"width": 2048, "height": 1152})
        console_issues: list[str] = []
        page_errors: list[str] = []
        failed_requests: list[str] = []
        page.on(
            "console",
            lambda message: (
                console_issues.append(f"{message.type}: {message.text}")
                if message.type in {"warning", "error"}
                else None
            ),
        )
        page.on("pageerror", lambda error: page_errors.append(str(error)))
        page.on(
            "requestfailed",
            lambda request: failed_requests.append(
                f"{request.method} {request.url}: {request.failure}"
            ),
        )

        for check in CHECKS:
            response = await page.goto(
                f"{args.base_url.rstrip('/')}{check['path']}",
                wait_until="domcontentloaded",
            )
            if not response or not response.ok:
                failures.append(
                    f"{check['name']}: navigation returned "
                    f"{response.status if response else 'no response'}"
                )
                continue

            images = page.locator("img[src*='/api/images/']")
            count = await images.count()
            if count != check["count"]:
                failures.append(
                    f"{check['name']}: expected {check['count']} images, got {count}"
                )

            paths = [
                image_path(await images.nth(index).get_attribute("src") or "")
                for index in range(count)
            ]
            expected_first = check.get("first")
            if expected_first and paths[: len(expected_first)] != expected_first:
                failures.append(
                    f"{check['name']}: first image sequence differs"
                )

            broken: list[str] = []
            for index in range(count):
                image = images.nth(index)
                await image.scroll_into_view_if_needed()
                try:
                    await image.evaluate(
                        """image => image.complete
                          ? Promise.resolve()
                          : new Promise((resolve, reject) => {
                              image.addEventListener('load', resolve, { once: true });
                              image.addEventListener('error', reject, { once: true });
                            })"""
                    )
                except Exception:
                    broken.append(paths[index])
                    continue
                natural_width = await image.evaluate("image => image.naturalWidth")
                if natural_width <= 0:
                    broken.append(paths[index])
            if broken:
                failures.append(
                    f"{check['name']}: {len(broken)} broken images: {broken}"
                )

            if check["name"] == "portraits":
                await page.evaluate("window.scrollTo(0, 0)")
                await page.wait_for_timeout(250)
                await page.screenshot(path=str(screenshot_path), full_page=False)

            results.append(
                {
                    "name": check["name"],
                    "images": count,
                    "broken": len(broken),
                }
            )

        await browser.close()

    if console_issues:
        failures.append(f"console issues: {console_issues}")
    if page_errors:
        failures.append(f"page errors: {page_errors}")
    if failed_requests:
        failures.append(f"failed requests: {failed_requests}")

    print(
        json.dumps(
            {
                "baseUrl": args.base_url,
                "results": results,
                "consoleIssues": console_issues,
                "pageErrors": page_errors,
                "failedRequests": failed_requests,
                "screenshot": str(screenshot_path),
                "failures": failures,
            },
            indent=2,
        )
    )
    if failures:
        raise SystemExit(1)


if __name__ == "__main__":
    asyncio.run(main())
