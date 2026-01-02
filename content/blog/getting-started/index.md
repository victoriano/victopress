---
title: "Getting Started with VictoPress"
date: 2026-01-02
description: "Learn how to set up your photo gallery CMS in minutes"
tags:
  - tutorial
  - getting-started
author: "VictoPress"
---

# Welcome to VictoPress! 🎉

VictoPress is a **files-first photo gallery CMS**. That means you don't need a complicated admin panel to manage your content - just organize your files and folders, and VictoPress does the rest.

## Quick Start

### 1. Add a Gallery

Create a folder in `content/galleries/` with your images:

```
content/galleries/my-trip/
├── photo1.jpg
├── photo2.jpg
└── photo3.jpg
```

That's it! VictoPress will automatically:
- Create a gallery called "My Trip"
- Use the first image as the cover
- Extract EXIF data from your photos

### 2. Customize with YAML (Optional)

Want more control? Add a `gallery.yaml` file:

```yaml
title: "My Amazing Trip"
description: "Photos from my adventure"
cover: "photo2.jpg"
tags:
  - travel
  - adventure
```

### 3. Add Blog Posts

Create markdown files in `content/blog/`:

```
content/blog/my-post/
├── index.md
└── cover.jpg
```

## Configuration

### Local Development

In development, VictoPress reads from your local `content/` folder. No cloud setup needed!

### Production (Cloudflare R2)

For production, configure your R2 bucket in `wrangler.toml`:

```toml
[[r2_buckets]]
binding = "CONTENT_BUCKET"
bucket_name = "your-bucket-name"
```

Then upload your content to R2 and deploy to Cloudflare Pages.

## Next Steps

- Add some photos to `content/galleries/`
- Check the [ARCHITECTURE.md](https://www.notion.so/1dd18ac214874a9da121897a495adc1d) for technical details
- Join our community!

Happy publishing! 📸
