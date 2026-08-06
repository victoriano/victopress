export const SUPPORTED_LOCALES = ["es", "en"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

// English is the canonical, unprefixed public edition. Spanish uses /es.
export const DEFAULT_LOCALE: Locale = "en";
export const LOCALE_COOKIE = "victoriano_locale";
export const LOCALE_QUERY_PARAMETER = "lang";

export const localeNames: Record<Locale, string> = {
  es: "Español",
  en: "English",
};

export type LocalizedText = {
  title?: string;
  description?: string;
  tags?: string[];
};

export type TranslationMap<T> = Partial<Record<Locale, T>>;

export type TranslationResolution<T> = {
  value: T;
  requestedLocale: Locale;
  resolvedLocale: Locale;
  availableLocales: Locale[];
  isFallback: boolean;
};

export function isLocale(value: unknown): value is Locale {
  return value === "es" || value === "en";
}

export function normalizeLocale(value: unknown): Locale | null {
  if (typeof value !== "string") return null;
  const language = value.trim().toLowerCase().split(/[-_]/, 1)[0];
  return isLocale(language) ? language : null;
}

export function localeFromPathname(pathname: string): Locale | null {
  const firstSegment = pathname.split("/").filter(Boolean)[0];
  return normalizeLocale(firstSegment);
}

export function stripLocaleFromPathname(pathname: string): string {
  const normalized = pathname.startsWith("/") ? pathname : `/${pathname}`;
  const segments = normalized.split("/");
  if (isLocale(segments[1])) segments.splice(1, 1);
  const result = segments.join("/");
  return result === "" ? "/" : result;
}

export function localizedPath(locale: Locale, pathname: string): string {
  const [pathOnly, suffix = ""] = pathname.split(/(?=[?#])/, 2);
  const unprefixed = stripLocaleFromPathname(pathOnly || "/");
  const localized = locale === DEFAULT_LOCALE
    ? unprefixed
    : unprefixed === "/" ? `/${locale}` : `/${locale}${unprefixed}`;
  return `${localized}${suffix}`;
}

/**
 * Build a manual language-switch URL. The transient query flag lets someone
 * leave /es even when their existing preference cookie still says Spanish;
 * the server consumes it, updates the cookie, and redirects to the clean URL.
 */
export function languageSwitchPath(locale: Locale, pathname: string): string {
  const localized = localizedPath(locale, pathname);
  const currentPath = pathname.split(/(?=[?#])/, 1)[0] || "/";
  if (
    locale !== DEFAULT_LOCALE ||
    localeFromPathname(currentPath) !== "es"
  ) return localized;

  const url = new URL(localized, "https://victopress.local");
  url.searchParams.set(LOCALE_QUERY_PARAMETER, locale);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function alternateLocale(locale: Locale): Locale {
  return locale === "es" ? "en" : "es";
}

export function availableTranslationLocales<T>(
  sourceLocale: Locale,
  translations?: TranslationMap<T>,
): Locale[] {
  return SUPPORTED_LOCALES.filter(
    (locale) => locale === sourceLocale || Boolean(translations?.[locale]),
  );
}

export function resolveTranslation<T>(
  base: T,
  sourceLocale: Locale,
  translations: TranslationMap<T> | undefined,
  requestedLocale: Locale,
): TranslationResolution<T> {
  const requested = translations?.[requestedLocale];
  const source = translations?.[sourceLocale];
  const value = requested || source || base;
  const resolvedLocale = requested ? requestedLocale : sourceLocale;

  return {
    value,
    requestedLocale,
    resolvedLocale,
    availableLocales: availableTranslationLocales(sourceLocale, translations),
    isFallback: resolvedLocale !== requestedLocale,
  };
}

export function parseAcceptLanguage(value: string | null): Locale | null {
  if (!value) return null;

  const candidates = value
    .split(",")
    .map((part, index) => {
      const [tag, ...parameters] = part.trim().split(";");
      const qualityParameter = parameters.find((parameter) =>
        parameter.trim().toLowerCase().startsWith("q="),
      );
      const quality = qualityParameter
        ? Number.parseFloat(qualityParameter.split("=", 2)[1])
        : 1;
      return {
        locale: normalizeLocale(tag),
        quality: Number.isFinite(quality) ? quality : 0,
        index,
      };
    })
    .filter((candidate): candidate is { locale: Locale; quality: number; index: number } =>
      Boolean(candidate.locale) && candidate.quality > 0,
    )
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  return candidates[0]?.locale || null;
}

export const photoMessages = {
  es: {
    search: "Buscar",
    explore: "Explorar",
    blog: "Blog",
    about: "Sobre mí",
    contact: "Contacto",
    home: "Inicio",
    share: "Compartir",
    linkCopied: "Enlace copiado",
    tags: "Etiquetas",
    noPosts: "Todavía no hay entradas",
    addPosts: "Añade archivos Markdown a content/blog/",
    galleryNotFound: "Galería no encontrada",
    photoNotFound: "Foto no encontrada",
    protectedGallery: "Esta galería está protegida con contraseña.",
    featuredPhoto: "Foto destacada",
    allPhotosFrom: "Todas las fotos de",
    photos: "fotos",
    previous: "Anterior",
    next: "Siguiente",
    thumbnails: "Miniaturas",
    openMenu: "Abrir menú",
    closeMenu: "Cerrar menú",
    expand: "Desplegar",
    collapse: "Plegar",
    toggleTheme: "Cambiar tema",
    switchToLight: "Cambiar al modo claro",
    switchToDark: "Cambiar al modo oscuro",
    goToGallery: "Ir a la galería",
    previousPhoto: "Foto anterior",
    nextPhoto: "Foto siguiente",
    showThumbnails: "Mostrar miniaturas",
    similarPhotos: "Fotos similares",
    selectedVisually: "Selección visual",
    previewUnavailable: "Vista previa no disponible",
    loadingSimilarPhotos: "Cargando fotos similares",
    viewPhoto: "Ver",
    fromGallery: "de",
    protectedTitle: "Galería protegida",
    protectedSuffix: "está protegida con contraseña.",
    password: "Contraseña",
    enterPassword: "Introduce la contraseña",
    showPassword: "Mostrar contraseña",
    hidePassword: "Ocultar contraseña",
    verifying: "Comprobando…",
    enterGallery: "Entrar en la galería",
    backHome: "Volver al inicio",
    pagination: "Paginación",
    previousPage: "Página anterior",
    nextPage: "Página siguiente",
    prevShort: "Ant",
    searchTitle: "Buscar fotografías",
    searchDescription: "Describe un tema, lugar, color o atmósfera. La búsqueda también entiende ideas visuales relacionadas.",
    searchMetaDescription: "Busca fotografías por tema, lugar, atmósfera o galería.",
    exploreTitle: "Explorar el archivo",
    exploreDescription: "Descubre fotografías por cercanía visual o recorre el archivo como una cuadrícula. La búsqueda y los elementos detectados por IA filtran ambas vistas.",
    exploreMetaDescription: "Explora el archivo fotográfico como un mapa visual o una cuadrícula y filtra por temas detectados mediante IA.",
    searchLabel: "Buscar fotografías",
    searchPlaceholder: "Personas de noche, paisajes tranquilos…",
    galleryLimit: "Limitar a una galería",
    allGalleries: "Todas las galerías",
    searchingArchive: "Buscando en el archivo…",
    searchPrompt: "Escribe una descripción para explorar el archivo.",
    searchFailed: "La búsqueda ha fallado",
    searchUnavailable: "La búsqueda no está disponible temporalmente.",
    unexpectedSearchResponse: "El servicio de búsqueda ha devuelto una respuesta inesperada.",
    tryAgain: "Intentar de nuevo",
    noMatches: "Ninguna fotografía coincide con",
    searchAllGalleries: "Buscar en todas las galerías",
    photograph: "fotografía",
    photographs: "fotografías",
    inThisGallery: "en esta galería",
    detectedElements: "Elementos detectados",
    allDetectedElements: "Todos",
    showAllFilters: "Ver más",
    hideFilters: "Ver menos",
    graphView: "Grafo",
    gridView: "Cuadrícula",
    exploreLoadingMap: "Construyendo el mapa visual…",
    exploreMapUnavailable: "El mapa fotográfico no está disponible temporalmente.",
    unexpectedExploreResponse: "El archivo ha devuelto una respuesta inesperada.",
    exploreNoMatches: "No hay fotografías para estos filtros.",
    graphAriaLabel: "Mapa de {count} fotografías agrupadas por similitud visual",
    graphInstructions: "Rueda o +/− para ampliar · arrastra para moverte",
    resetGraph: "Centrar",
    zoomIn: "Ampliar",
    zoomOut: "Reducir",
    selectGraphPhoto: "Selecciona un punto",
    selectGraphPhotoHint: "Aquí aparecerán la fotografía, su descripción y los elementos detectados.",
    showMorePhotos: "Mostrar más fotografías",
  },
  en: {
    search: "Search",
    explore: "Explore",
    blog: "Blog",
    about: "About me",
    contact: "Contact",
    home: "Home",
    share: "Share",
    linkCopied: "Link copied",
    tags: "Tags",
    noPosts: "No posts yet",
    addPosts: "Add Markdown files to content/blog/",
    galleryNotFound: "Gallery not found",
    photoNotFound: "Photo not found",
    protectedGallery: "This gallery is password protected.",
    featuredPhoto: "Featured photo",
    allPhotosFrom: "All photos from",
    photos: "photos",
    previous: "Previous",
    next: "Next",
    thumbnails: "Thumbnails",
    openMenu: "Open menu",
    closeMenu: "Close menu",
    expand: "Expand",
    collapse: "Collapse",
    toggleTheme: "Toggle theme",
    switchToLight: "Switch to light mode",
    switchToDark: "Switch to dark mode",
    goToGallery: "Go to",
    previousPhoto: "Previous photo",
    nextPhoto: "Next photo",
    showThumbnails: "Show thumbnails",
    similarPhotos: "Similar photos",
    selectedVisually: "Selected visually",
    previewUnavailable: "Preview unavailable",
    loadingSimilarPhotos: "Loading similar photos",
    viewPhoto: "View",
    fromGallery: "from",
    protectedTitle: "Protected gallery",
    protectedSuffix: "is password protected.",
    password: "Password",
    enterPassword: "Enter password",
    showPassword: "Show password",
    hidePassword: "Hide password",
    verifying: "Verifying…",
    enterGallery: "Enter gallery",
    backHome: "Back to home",
    pagination: "Pagination",
    previousPage: "Previous page",
    nextPage: "Next page",
    prevShort: "Prev",
    searchTitle: "Search photographs",
    searchDescription: "Describe a subject, place, color, or atmosphere. Search also understands related visual ideas.",
    searchMetaDescription: "Search photographs by subject, place, atmosphere, or gallery.",
    exploreTitle: "Explore the archive",
    exploreDescription: "Discover photographs by visual proximity or browse the archive as a grid. Search and AI-detected elements filter both views.",
    exploreMetaDescription: "Explore the photography archive as a visual map or grid and filter by AI-detected subjects.",
    searchLabel: "Search photographs",
    searchPlaceholder: "People at night, quiet landscapes…",
    galleryLimit: "Limit to gallery",
    allGalleries: "All galleries",
    searchingArchive: "Searching the archive…",
    searchPrompt: "Enter a description to explore the archive.",
    searchFailed: "Search failed",
    searchUnavailable: "Search is temporarily unavailable.",
    unexpectedSearchResponse: "The search service returned an unexpected response.",
    tryAgain: "Try again",
    noMatches: "No photographs matched",
    searchAllGalleries: "Search all galleries",
    photograph: "photograph",
    photographs: "photographs",
    inThisGallery: "in this gallery",
    detectedElements: "Detected elements",
    allDetectedElements: "All",
    showAllFilters: "Show more",
    hideFilters: "Show less",
    graphView: "Graph",
    gridView: "Grid",
    exploreLoadingMap: "Building the visual map…",
    exploreMapUnavailable: "The photo map is temporarily unavailable.",
    unexpectedExploreResponse: "The archive returned an unexpected response.",
    exploreNoMatches: "No photographs match these filters.",
    graphAriaLabel: "Map of {count} photographs clustered by visual similarity",
    graphInstructions: "Scroll or use +/− to zoom · drag to pan",
    resetGraph: "Reset",
    zoomIn: "Zoom in",
    zoomOut: "Zoom out",
    selectGraphPhoto: "Select a point",
    selectGraphPhotoHint: "The photograph, its description and detected elements will appear here.",
    showMorePhotos: "Show more photographs",
  },
} as const;
