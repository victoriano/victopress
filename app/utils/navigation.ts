import type { NavItem } from "~/components/Sidebar";

interface GalleryLike {
  slug: string;
  title: string;
}

/**
 * Build navigation structure from galleries.
 * Supports multiple levels of nesting.
 * Creates virtual parent items for deeply nested galleries.
 */
export function buildNavigation(galleries: GalleryLike[]): NavItem[] {
  const navMap = new Map<string, NavItem>();
  const rootItems: NavItem[] = [];

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
        const parentTitle = parentName.charAt(0).toUpperCase() + parentName.slice(1);
        
        const parentItem: NavItem = {
          title: parentTitle,
          slug: parentSlug,
          path: `/gallery/${parentSlug}`,
          children: [],
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
    
    // Create the nav item for this gallery
    const item: NavItem = {
      title: gallery.title,
      slug: gallery.slug,
      path: `/gallery/${gallery.slug}`,
      children: [],
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

  return rootItems;
}
