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
3. **Configure build settings:**

   | Setting | Value |
   |---------|-------|
   | Framework preset | **Remix** |
   | Build command | `bun run build` |
   | Build output directory | `build/client` |

4. **Click "Save and Deploy"** and wait for the build to complete
5. **Visit your site** at `your-project.pages.dev`
6. **Complete the setup wizard** at `/admin/setup` to configure R2 storage

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

## 🏗️ Architecture

### Storage Adapter Pattern

VictoPress uses an abstract storage layer that works with both local filesystem (development) and Cloudflare R2 (production):

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     Content Engine Layer                                 │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐          │
│  │ gallery-scanner │  │ content-index   │  │ api.admin.*     │          │
│  │  (EXIF cache)   │  │ (partial update)│  │  (uses both)    │          │
│  └────────┬────────┘  └────────┬────────┘  └────────┬────────┘          │
│           │                    │                    │                    │
│           └──────────┬─────────┴────────────────────┘                    │
│                      │                                                   │
│              ┌───────▼───────┐                                           │
│              │ StorageAdapter │  ← Abstract interface                    │
│              └───────┬───────┘                                           │
└──────────────────────┼───────────────────────────────────────────────────┘
                       │
         ┌─────────────┴─────────────┐
         │                           │
    ┌────▼────┐                 ┌────▼────┐
    │  Local  │                 │   R2    │
    │ Adapter │                 │ Adapter │
    │  (dev)  │                 │ (prod)  │
    └────┬────┘                 └────┬────┘
         │                           │
    ┌────▼────┐                 ┌────▼────┐
    │./content│                 │R2 Bucket│
    └─────────┘                 └─────────┘
```

### StorageAdapter Interface

Both adapters implement this interface (`app/lib/content-engine/types.ts`):

```typescript
interface StorageAdapter {
  list(prefix: string): Promise<FileInfo[]>;      // List files in folder
  listRecursive(prefix: string): Promise<FileInfo[]>; // List all recursively
  get(key: string): Promise<ArrayBuffer | null>;  // Read binary (images)
  getText(key: string): Promise<string | null>;   // Read text (YAML)
  put(key: string, data: ArrayBuffer | string): Promise<void>; // Write
  delete(key: string): Promise<void>;             // Delete file
  exists(key: string): Promise<boolean>;          // Check existence
  move(from: string, to: string): Promise<void>;  // Move/rename
  copy(from: string, to: string): Promise<void>;  // Copy file
  getSignedUrl(key: string): Promise<string>;     // Get URL for image
}
```

### Adapter Implementations

| Method | LocalStorageAdapter | R2StorageAdapter |
|--------|---------------------|------------------|
| `list()` | `fs.readdir()` | `bucket.list({ delimiter: "/" })` |
| `get()` | `fs.readFile()` → Buffer | `bucket.get()` → `arrayBuffer()` |
| `put()` | `fs.mkdir()` + `fs.writeFile()` | `bucket.put()` with MIME detection |
| `delete()` | `fs.unlink()` | `bucket.delete()` |
| `move()` | `fs.rename()` (atomic) | `copy()` + `delete()` (2 ops) |
| `exists()` | `fs.access()` | `bucket.head()` |

### EXIF Caching & Incremental Updates

To optimize performance, especially with R2 where each file read is a network request:

```
Full rebuild WITHOUT cache:        Full rebuild WITH cache:
  Local:  ~400-500ms                 Local:  ~40ms
  R2:     10-30 seconds              R2:     ~200-500ms

Partial update (reorder/hide/edit):
  Local:  ~15ms
  R2:     ~50-100ms
```

The content index stores EXIF data and `lastModified` timestamps. On rebuild, if a photo hasn't changed, its cached EXIF is reused instead of re-reading the image file.

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
