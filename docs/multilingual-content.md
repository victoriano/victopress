# Spanish and English editions

Implemented on 22 July 2026 in `codex/headless-blog`.

## Public URL contract

Multilingual publishing is an installation-level option. A new VictoPress
installation starts in single-language mode; this portfolio opts in through:

```yaml
# content/site.yaml
language:
  multilingual: true
  default: en
```

The same values are editable in **Settings → Languages**. Turning the option
off does not delete sidecars or YAML translations. The CMS shows only the
configured default edition, secondary public routes redirect to that edition,
and the sitemap/canonical metadata publish only that edition. Turning it on
again restores the preserved editions.

Every indexable document has a stable edition URL:

- English: `/`, `/gallery/...`, `/photo/...`, `/blog/...`, `/about`
- Spanish: `/es`, `/es/gallery/...`, `/es/photo/...`, `/es/blog/...`, `/es/about`

English owns the canonical unprefixed URLs, so an English browser is served
directly without a redirect. A Spanish preference stored in
`victoriano_locale`, or a Spanish `Accept-Language` when no preference exists,
redirects the same entry point to `/es/...`. The compact `ES · EN` control
changes the edition and stores the manual choice for one year. Its transient
`?lang=en` flag is consumed immediately when leaving `/es`, so the final English
URL remains clean. Legacy `/en` and `/en/*` links permanently redirect to their
unprefixed equivalents. In production the cookie uses
`Domain=victoriano.me`, so the choice is shared by `victoriano.me` and
`photos.victoriano.me`.

Documents expose the correct `lang`, `Content-Language`, canonical URL and
reciprocal `hreflang` alternates. The unprefixed English URL is also the
`x-default`. Both sitemaps publish English without a prefix and Spanish under
`/es`; the personal site also publishes one RSS feed per language.

## Files-first content model

The original file remains the source edition. Its language is declared with
`locale` (blog and photo metadata), `sourceLocale` (pages), or the gallery
YAML `locale` field.

```text
content/blog/a-post/index.md       source edition
content/blog/a-post/index.es.md    Spanish sidecar, when Spanish is not source
content/blog/a-post/index.en.md    English sidecar, when English is not source

content/pages/about/index.html     source edition
content/pages/about/index.es.html  Spanish sidecar
content/pages/about/page.yaml      sourceLocale: en
```

Gallery and photo translations live beside their existing metadata:

```yaml
locale: en
title: Geographies
translations:
  es:
    title: Geografías
    description: Fotografías de todo el mundo organizadas por lugar
```

Photo entries use the same shape inside `photos.yaml`. Metadata-only partial
sidecars do not alter the gallery order; an explicit `order` remains required
when a partial sidecar is also intended to reorder photographs.

Missing editions never masquerade as translated content. Resolved objects and
the headless API expose `locale`, `resolvedLocale`, `availableLocales` and
`isFallback`.

## CMS

VictoPress remains the single editorial system. When multilingual publishing
is enabled, blog posts, gallery settings, photo metadata and static pages offer
ES/EN edition tabs. Index screens show `ready` or `missing` status for each
language. In single-language mode those controls disappear. Saving writes the source file
and the matching sidecar or YAML translation atomically through the existing
storage adapter, so local storage and R2 use the same model.

## Headless blog contract

Both endpoints accept `?locale=es` or `?locale=en`; without it they negotiate
`Accept-Language` and default to English.

- `GET /api/v1/blog?locale=en`
- `GET /api/v1/blog/<nested-slug>?locale=es`

Responses include localized titles, excerpts, Markdown, safe HTML, navigation,
canonical URLs and both alternate URLs. API version 1 is retained because the
new fields are additive.

## Current migration and verification

- 5/5 blog posts have complete Spanish and English editions.
- Each edition preserves all 24 body-image references across the five posts.
- 27/27 gallery metadata files have Spanish and English titles/descriptions.
- All 9 existing authored/EXIF photo captions have explicit Spanish and
  English editions; photos without text remain language-neutral.
- About and Contact have complete Spanish and English editions.
- Public controls, accessibility labels, protected galleries, pagination and
  optional visual search/recommendations use the active edition as well.
- Automated coverage checks negotiation, redirects, cookie precedence,
  explicit fallbacks, sidecars, safe HTML, canonical URLs and migrated content.
- The named-tunnel previews are verified at
  `https://victopress-headless.nominao.com/` (English),
  `https://victopress-headless.nominao.com/es` (Spanish),
  `https://victoriano.nominao.com/` (English), and
  `https://victoriano.nominao.com/es` (Spanish).
