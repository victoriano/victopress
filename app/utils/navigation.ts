import type { NavItem } from "~/components/Sidebar";

interface GalleryLike {
  slug: string;
  title: string;
  order?: number;
}

interface ParentMetadata {
  slug: string;
  title?: string;
  order?: number;
}

interface NavItemWithOrder extends NavItem {
  order?: number;
}

/**
 * Build navigation structure from galleries.
 * Supports multiple levels of nesting.
 * Creates virtual parent items for deeply nested galleries.
 * Respects the order field for sorting.
 * 
 * @param galleries - List of galleries with images
 * @param parentMetadata - Optional metadata for parent folders without images
 */
export function buildNavigation(
  galleries: GalleryLike[], 
  parentMetadata?: ParentMetadata[]
): NavItem[] {
  // Create a map of parent metadata for quick lookup
  const parentMap = new Map<string, ParentMetadata>();
  if (parentMetadata) {
    for (const meta of parentMetadata) {
      parentMap.set(meta.slug, meta);
    }
  }
  const navMap = new Map<string, NavItemWithOrder>();
  const rootItems: NavItemWithOrder[] = [];

  // Sort galleries by slug to ensure parents are processed before children
  const sortedGalleries = [...galleries].sort((a, b) => 
    a.slug.localeCompare(b.slug)
  );

  for (const gallery of sortedGalleries) {
    const parts = gallery.slug.split("/");
    
    // Ensure all parent levels exist in the navMap
    for (let i = 1; i < parts.length; i++) {
      const parentSlug = parts.slice(0, i).join("/");
      
      if (!navMap.has(parentSlug)) {
        // Create virtual parent item
        const parentName = parts[i - 1];
        const defaultTitle = parentName.charAt(0).toUpperCase() + parentName.slice(1);
        
        // Check if we have metadata for this parent
        const meta = parentMap.get(parentSlug);
        
        const parentItem: NavItemWithOrder = {
          title: meta?.title || defaultTitle,
          slug: parentSlug,
          path: `/gallery/${parentSlug}`,
          children: [],
          order: meta?.order ?? 999, // Use metadata order or default high
        };
        
        navMap.set(parentSlug, parentItem);
        
        // Add to parent or root
        if (i === 1) {
          rootItems.push(parentItem);
        } else {
          const grandparentSlug = parts.slice(0, i - 1).join("/");
          const grandparent = navMap.get(grandparentSlug);
          if (grandparent) {
            grandparent.children = grandparent.children || [];
            grandparent.children.push(parentItem);
          }
        }
      }
    }
    
    // Check if this gallery already exists as virtual parent
    const existingItem = navMap.get(gallery.slug);
    if (existingItem) {
      // Update the virtual parent with real gallery data
      existingItem.title = gallery.title;
      existingItem.order = gallery.order;
      continue;
    }
    
    // Create the nav item for this gallery
    const item: NavItemWithOrder = {
      title: gallery.title,
      slug: gallery.slug,
      path: `/gallery/${gallery.slug}`,
      children: [],
      order: gallery.order,
    };
    
    // Store in navMap so children can find it
    navMap.set(gallery.slug, item);
    
    if (parts.length === 1) {
      // Root level gallery
      rootItems.push(item);
    } else {
      // Nested gallery - find parent (guaranteed to exist now)
      const parentSlug = parts.slice(0, -1).join("/");
      const parent = navMap.get(parentSlug);
      
      if (parent) {
        parent.children = parent.children || [];
        parent.children.push(item);
      }
    }
  }

  // Sort function by order
  const sortByOrder = (a: NavItemWithOrder, b: NavItemWithOrder) => 
    (a.order ?? 999) - (b.order ?? 999);

  // Sort root items and all children recursively
  const sortChildren = (items: NavItemWithOrder[]) => {
    items.sort(sortByOrder);
    for (const item of items) {
      if (item.children && item.children.length > 0) {
        sortChildren(item.children as NavItemWithOrder[]);
      }
    }
  };

  sortChildren(rootItems);

  return rootItems;
}
