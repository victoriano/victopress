# VictoPress headless para victoriano.me/blog

Actualizado el 22 de julio de 2026 en la rama **codex/headless-blog**.

## Decisión

VictoPress sigue siendo el único CMS y la fuente de verdad del blog. La web
personal es una aplicación Remix independiente que publica el contenido en
**victoriano.me/blog** mediante una API HTTP de solo lectura.

- VictoPress conserva Markdown, frontmatter, borradores, imágenes y R2.
- El frontend personal no conoce R2 ni importa código interno del CMS.
- photos.victoriano.me puede mantener un frontend fotográfico distinto.
- Un artículo se edita una sola vez en VictoPress.

## Estado implementado

La frontera headless ya existe:

- **GET /api/v1/blog** lista únicamente artículos publicados.
- **GET /api/v1/blog/*** resuelve slugs históricos anidados.
- Los borradores y las rutas inexistentes devuelven 404.
- El listado no incluye cuerpos completos.
- El detalle incluye Markdown original, HTML sanitizado y navegación
  anterior/siguiente.
- Portadas, imágenes y enlaces internos heredados salen como URLs absolutas del
  frontend de VictoPress.
- Las respuestas incluyen versión de API, CORS, ETag y política de caché.
- El sitemap de VictoPress omite el blog cuando su URL pública pertenece a otro
  origen.
- Los enlaces “View” del editor apuntan a la URL pública externa.
- El contrato acepta `locale=es|en` y expone idioma solicitado, resuelto,
  ediciones disponibles, fallback explícito y URLs alternas.

La aplicación independiente de **/Users/victoriano/Code/victoriano.me** consume
este contrato desde loaders de servidor. Ya ofrece archivo, detalle, RSS,
sitemap, metadatos sociales, JSON-LD y diseño responsive.

## Contrato

El índice expone:

- apiVersion
- site.name y site.blogUrl
- count
- posts con slug, título, fecha, extracto, tiempo de lectura, etiquetas,
  portada y URL canónica

El detalle añade:

- author y sourceUrl
- format y contentMarkdown
- contentHtml sanitizado
- images absolutas
- navigation.newer y navigation.older

Los clientes deben validar que **apiVersion** sea **1** antes de renderizar.

## Configuración

Variables de VictoPress:

- **BLOG_SITE_NAME**: nombre público del autor o sitio.
- **PUBLIC_BLOG_URL**: origen y prefijo del frontend, por ejemplo
  https://victoriano.me/blog.
- **PUBLIC_MEDIA_URL**: origen público de VictoPress, por ejemplo
  https://photos.victoriano.me.

Variable del frontend personal:

- **VICTOPRESS_API_URL**: endpoint base, por ejemplo
  https://photos.victoriano.me/api/v1/blog.

## Flujo editorial comprobado

1. El editor crea una entrada. VictoPress la guarda como borrador.
2. La API pública responde 404 mientras draft sea verdadero.
3. Al publicar, el slug permanece estable aunque cambie el título.
4. La API devuelve el artículo y el frontend independiente lo renderiza.
5. Al borrarlo, desaparece del índice, del detalle y del frontend.

La prueba end-to-end se ejecutó con una entrada temporal y terminó eliminando
el archivo y reconstruyendo el índice. El inventario volvió a cinco posts.

## Seguridad y compatibilidad

- El HTML crudo pegado en Markdown se escapa y no puede ejecutar scripts.
- Los protocolos de enlace e imagen no seguros se descartan.
- Los slugs con traversal, barras codificadas o encoding inválido se rechazan.
- Las imágenes siguen pasando por la ruta optimizada de VictoPress.
- El renderer normal de VictoPress conserva URLs relativas; solo el contrato
  headless las convierte a absolutas.

## Migración al dominio definitivo

Antes de mover producción:

1. Desplegar esta rama con el contenido y secretos actuales de VictoPress.
2. Publicar el repositorio personal en victoriano.me.
3. Establecer PUBLIC_MEDIA_URL en https://photos.victoriano.me.
4. Establecer PUBLIC_BLOG_URL en https://victoriano.me/blog.
5. Cambiar VICTOPRESS_API_URL a
   https://photos.victoriano.me/api/v1/blog.
6. Validar los cinco slugs, las 24 imágenes, RSS, sitemap y canónicas.
7. Activar redirecciones 301 desde cualquier URL antigua del blog.
8. Permitir indexación en robots.txt del frontend personal.

No hace falta dar acceso a R2 al repositorio personal.

## Previews de esta rama

- CMS y API: https://victopress-headless.nominao.com
- Blog independiente: https://victoriano.nominao.com/blog

Ambos previews usan servicios persistentes locales y named tunnels de
Cloudflare; no son todavía los dominios de producción.

La arquitectura bilingüe completa está documentada en
[Spanish and English editions](multilingual-content.md).
