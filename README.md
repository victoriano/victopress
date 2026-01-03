# VictoPress

A **files-first photo gallery CMS** for photographers. Drag folders, get galleries.

## ⚡ Key Principle: Zero-Config

The system works **only with folders and images**. YAML/config files are **optional** to add metadata, custom order, etc.

```
content/
├── galleries/
│   ├── tokyo-2024/          ← Automatic gallery "Tokyo 2024"
│   │   ├── DSC_001.jpg
│   │   ├── DSC_002.jpg
│   │   └── gallery.yaml     ← Optional: custom metadata
│   └── street-photos/
│       └── ...
└── blog/
    ├── my-first-post/
    │   ├── index.md
    │   └── cover.jpg
    └── another-post.md
```

## 🚀 Deploy to Cloudflare Pages

1. **Go to [Cloudflare Pages](https://dash.cloudflare.com/?to=/:account/pages/new/provider/github)** and click "Connect to Git"
2. **Select this repository** (`victoriano/victopress` or your fork)
3. **Build settings are auto-detected** from `wrangler.toml`:
   - Build command: `bun run build`
   - Build output: `build/client`
4. **Click Deploy** and visit your site at `your-project.pages.dev`
5. **Complete the setup wizard** at `/admin/setup` to configure R2 storage

The setup wizard will guide you through:
- Creating an API token with the right permissions
- Setting up an R2 bucket for your photos
- Binding the bucket to your Pages project
- Seeding initial content (optional)

## 💻 Local Development

```bash
# Install dependencies
bun install

# Start development server
bun run dev

# Build for production
bun run build

# Deploy to Cloudflare Pages
bun run deploy
```

## 📁 Content Structure

### Galleries

Put images in a folder under `content/galleries/`. That's it!

```yaml
# content/galleries/tokyo-2024/gallery.yaml (optional)
title: "Tokyo 2024"
description: "Street photography from Tokyo"
cover: "shibuya-crossing.jpg"
tags:
  - travel
  - japan
  - street
private: false  # Set to true to hide from listings
```

### Photos Metadata

EXIF data is automatically extracted from JPEG files. You can override with `photos.yaml`:

```yaml
# content/galleries/tokyo-2024/photos.yaml (optional)
- filename: "DSC_001.jpg"
  title: "Shibuya Crossing"
  description: "The famous scramble crossing at night"
  tags: ["night", "street"]
  
- filename: "DSC_002.jpg"
  hidden: true  # Hide from gallery
```

### Blog Posts

Markdown files in `content/blog/`:

```markdown
---
title: "My Trip to Tokyo"
date: 2024-03-15
tags: ["travel", "photography"]
cover: "cover.jpg"
---

Your markdown content here...
```

## 🛠️ Tech Stack

- **Framework:** Remix + TypeScript
- **Styling:** Tailwind CSS
- **Storage:** Cloudflare R2 (S3-compatible)
- **Deploy:** Cloudflare Pages
- **Package Manager:** Bun

## 📚 API Endpoints

| Endpoint | Description |
|----------|-------------|
| `GET /api/content` | Full content index (galleries, posts, tags) |
| `GET /api/tags` | All tags with counts |
| `GET /api/photos?tag=street` | Photos filtered by tag |

## 🔒 Privacy Features

- `hidden: true` on photos → excluded from gallery
- `private: true` on galleries → excluded from listings
- Password protection for galleries

## 🔧 Setup Requirements

When deploying to Cloudflare, you'll need to create an API token with these permissions:

| Permission | Scope | Purpose |
|------------|-------|---------|
| Account Settings | Read | Verify token, detect account |
| Workers R2 Storage | Edit | Create bucket, upload content |
| Cloudflare Pages | Edit | Bind R2 bucket to app |

The setup wizard will guide you through creating this token.

## 🔄 Keeping Your Fork Updated

If you forked VictoPress to your own repository, you can pull in updates from the original repo:

```bash
# Add the original repo as upstream (one-time setup)
git remote add upstream https://github.com/victoriano/victopress.git

# Fetch and merge updates
git fetch upstream
git merge upstream/main

# Push to your fork
git push
```

This will bring in new features and bug fixes while preserving your customizations.

## 📖 Documentation

See the [Project Home](https://www.notion.so/2dc358038bc5806e8d7bdd5649e4cef2) on Notion for full documentation.

## License

MIT
