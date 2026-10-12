# Changelog

## 0.1.0 – 2026-10-12

First release.

### Viewer

* Open an image by dropping it on the page, browsing for it or pasting it. JPEG, PNG, WebP, TIFF, GIF, AVIF
  and SVG are supported, also at gigapixel size.
* Smooth deep zoom: the image is cut into a tile pyramid once, and the browser loads only the tiles that are
  visible. A 900 MP TIFF is ready in about 15 s.
* Zoom, fit, 100 %, rotate, flip, minimap, tile boundaries and fullscreen, each with a keyboard shortcut.
* The status bar shows the pixel under the cursor, the zoom, the tile pyramid and the cache usage.
* Light and dark theme.

### Tiles and cache

* Tile size, format (WebP, JPEG, PNG), quality, overlap and pyramid depth can be changed in the settings; the
  open image is then regenerated from the stored original.
* Tiles are cached by content: opening the same file again is instant.
* When the cache exceeds its size limit, the least recently opened images are removed.

### App

* The version is shown in the header; a click on it opens this changelog.
* After an update, the page shows once per browser what is new.
* An **Update available** badge appears beside the version when a newer release is on GitHub.
* Docker image for `linux/amd64` and `linux/arm64`.
