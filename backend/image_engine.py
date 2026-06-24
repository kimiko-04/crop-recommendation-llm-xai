"""
Satellite image ingestion engine for the FastAPI backend.

Scope of this module (current phase): parse a farmer-uploaded GeoTIFF that
stacks real Sentinel-2 reflectance bands (Red/NIR[/Green]) exported from the
Copernicus Browser "Analytical" download, compute vegetation/water indices,
and split the field into a coarse grid of zones with a best-effort land
classification per zone.

NOT yet implemented here (left for the next phase, by design):
  - Soil (SoilGrids) / weather (Open-Meteo) lookup per zone
  - Calling ml_engine.predict_crop()/compute_shap() per zone
  - Raw Sentinel-2 SAFE .jp2 zip ingestion (USGS EarthExplorer path)
  - Sentinel Hub auto-fetch (map-picker path)

Expected upload convention (documented to the farmer/demo instructions):
  A single multi-band GeoTIFF with bands in this exact order:
    band 1 = B04 (Red)
    band 2 = B08 (NIR)
    band 3 = B03 (Green)   [optional — enables NDWI/water masking]
  This matches a Copernicus Browser custom layer with B04, B08, B03 dragged
  in that order, downloaded as Analytical GeoTIFF.

If a future upload doesn't match this (wrong band count, or band
descriptions embedded in the file disagree with the assumed order), the
ingestion fails loudly with a clear error rather than silently producing a
wrong NDVI — see _resolve_band_order().
"""
import io
import numpy as np
import rasterio
from pyproj import Transformer

# ── Band-order convention ───────────────────────────────────────────────────

_EXPECTED_BANDS_2 = ["B04", "B08"]            # Red, NIR — minimum viable
_EXPECTED_BANDS_3 = ["B04", "B08", "B03"]     # Red, NIR, Green — adds NDWI

# ── Classification thresholds ────────────────────────────────────────────────
# Best-effort heuristics from Red/Green/NIR only. Without SWIR/built-up bands
# we cannot reliably separate bare soil from rooftops/roads — documented
# limitation, acceptable for an FYP-scope MVP demo.
NDVI_WATER_NO_NDWI   = -0.10   # NDVI below this (no green band) → likely water/shadow
NDWI_WATER           = 0.00    # NDWI above this (green band present) → likely water
NDVI_VEGETATED       = 0.30    # NDVI above this → already vegetated/healthy growth
# Between water and vegetated → "bare_soil_or_built_up", treated as the
# best-effort plantable target zone.


class ImageIngestError(ValueError):
    """Raised when an uploaded file doesn't match the expected band convention."""


def _resolve_band_order(dataset: rasterio.DatasetReader) -> list[str]:
    """
    Decide which physical band each raster band represents.

    Strategy (in order of preference):
      1. If the GeoTIFF has embedded GDAL band descriptions (B02/B03/B04/B08),
         trust those — they were written by the exporter and are the ground truth.
      2. Otherwise fall back to the documented upload convention: band 1=B04,
         band 2=B08, band 3=B03 (the order Copernicus Browser uses).
      3. Any other band count → loud error rather than silent wrong NDVI.
    """
    count = dataset.count
    descriptions = [d for d in dataset.descriptions if d]

    if len(descriptions) == count and all(
        d.upper() in {"B02", "B03", "B04", "B08"} for d in descriptions
    ):
        return [d.upper() for d in descriptions]

    if count == 2:
        return _EXPECTED_BANDS_2
    if count == 3:
        return _EXPECTED_BANDS_3

    raise ImageIngestError(
        f"Expected a 2-band (Red,NIR) or 3-band (Red,NIR,Green) GeoTIFF, "
        f"got {count} band(s). Re-export from Copernicus Browser as a custom "
        f"layer with bands B04, B08[, B03] in that order, Analytical GeoTIFF."
    )


def ingest_geotiff(data: bytes) -> dict:
    """
    Parse an uploaded GeoTIFF into band arrays + georeferencing info.

    Returns:
        {
          "bands": {"B04": ndarray, "B08": ndarray, "B03": ndarray|None},
          "crs":       rasterio CRS,
          "transform": affine.Affine,
          "width":     int,
          "height":    int,
        }
    Raises ImageIngestError on band-count/order mismatch or unreadable file.
    """
    try:
        with rasterio.io.MemoryFile(data) as memfile:
            with memfile.open() as dataset:
                band_names = _resolve_band_order(dataset)
                arrays = {
                    name: dataset.read(i + 1).astype(np.float64)
                    for i, name in enumerate(band_names)
                }
                arrays.setdefault("B03", None)

                return {
                    "bands":     arrays,
                    "crs":       dataset.crs,
                    "transform": dataset.transform,
                    "width":     dataset.width,
                    "height":    dataset.height,
                }
    except rasterio.errors.RasterioIOError as exc:
        raise ImageIngestError(
            "Could not read file as a GeoTIFF - make sure you exported "
            "'Analytical' GeoTIFF (not a PNG/JPG screenshot)."
        ) from exc


# ── Indices ───────────────────────────────────────────────────────────────────

def _safe_ratio(a: np.ndarray, b: np.ndarray) -> np.ndarray:
    """(a-b)/(a+b) with zero-division guarded by a tiny epsilon."""
    denom = a + b
    denom = np.where(denom == 0, 1e-6, denom)
    return (a - b) / denom


def compute_indices(bands: dict) -> dict:
    """
    Compute NDVI (always) and NDWI (only if the Green band was supplied).

    NDVI = (NIR - Red) / (NIR + Red)   — ranges −1 to +1; healthy vegetation > 0.3
    NDWI = (Green - NIR) / (Green + NIR) — positive values indicate water presence

    Both are normalised ratios, so they are scale-invariant — the same formula
    works regardless of whether the GeoTIFF stores raw DN counts or L2A
    bottom-of-atmosphere reflectances.  No unit conversion is needed.
    """
    red, nir, green = bands["B04"], bands["B08"], bands.get("B03")
    out = {"ndvi": _safe_ratio(nir, red)}
    if green is not None:
        out["ndwi"] = _safe_ratio(green, nir)
    return out


# ── Geo helpers ──────────────────────────────────────────────────────────────

def pixel_to_lonlat(transform, crs, row: int, col: int) -> tuple[float, float]:
    """Convert a (row, col) pixel centre to (lon, lat) in WGS84."""
    x, y = transform * (col + 0.5, row + 0.5)
    if crs is None or crs.to_epsg() == 4326:
        return x, y
    transformer = Transformer.from_crs(crs, "EPSG:4326", always_xy=True)
    lon, lat = transformer.transform(x, y)
    return lon, lat


# ── Gridding & classification ───────────────────────────────────────────────

def classify_cell(ndvi_mean: float, ndwi_mean: float | None) -> str:
    if ndwi_mean is not None:
        if ndwi_mean > NDWI_WATER:
            return "water"
    elif ndvi_mean < NDVI_WATER_NO_NDWI:
        return "water"

    if ndvi_mean > NDVI_VEGETATED:
        return "vegetated"

    return "bare_soil_or_built_up"


def grid_field(indices: dict, transform, crs, height: int, width: int,
                n_cells: int = 8) -> list[dict]:
    """
    Split the raster into an n_cells x n_cells grid (clipped to image bounds
    for non-divisible sizes) and summarise each cell.

    Returns a flat list of cell dicts:
        {row, col, ndvi, ndwi, lat, lon, classification, plantable}
    """
    ndvi = indices["ndvi"]
    ndwi = indices.get("ndwi")

    row_edges = np.linspace(0, height, n_cells + 1, dtype=int)
    col_edges = np.linspace(0, width,  n_cells + 1, dtype=int)

    cells = []
    for r in range(n_cells):
        for c in range(n_cells):
            r0, r1 = row_edges[r], row_edges[r + 1]
            c0, c1 = col_edges[c], col_edges[c + 1]
            if r1 <= r0 or c1 <= c0:
                continue

            ndvi_mean = float(ndvi[r0:r1, c0:c1].mean())
            ndwi_mean = float(ndwi[r0:r1, c0:c1].mean()) if ndwi is not None else None
            cls = classify_cell(ndvi_mean, ndwi_mean)

            center_row = (r0 + r1) // 2
            center_col = (c0 + c1) // 2
            lon, lat = pixel_to_lonlat(transform, crs, center_row, center_col)

            cells.append({
                "row":            r,
                "col":            c,
                "ndvi":           round(ndvi_mean, 4),
                "ndwi":           round(ndwi_mean, 4) if ndwi_mean is not None else None,
                "lat":            round(lat, 6),
                "lon":            round(lon, 6),
                "classification": cls,
                "plantable":      cls != "water",
            })

    return cells


def analyse_upload(data: bytes, n_cells: int = 8) -> dict:
    """End-to-end: ingest GeoTIFF → indices → grid. Raises ImageIngestError on bad input."""
    parsed  = ingest_geotiff(data)
    indices = compute_indices(parsed["bands"])
    cells   = grid_field(
        indices, parsed["transform"], parsed["crs"],
        parsed["height"], parsed["width"], n_cells=n_cells,
    )
    return {
        "width":        parsed["width"],
        "height":       parsed["height"],
        "has_ndwi":     "ndwi" in indices,
        "grid_size":    n_cells,
        "cells":        cells,
        "plantable_count": sum(1 for c in cells if c["plantable"]),
        "total_count":     len(cells),
    }
