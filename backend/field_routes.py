import os
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.security import OAuth2PasswordBearer
from jose import JWTError, jwt
from image_engine import analyse_upload, ImageIngestError

SECRET_KEY    = os.getenv("SECRET_KEY", "change-me-in-production-use-env-file")
ALGORITHM     = "HS256"
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/auth/login")
router        = APIRouter(prefix="/field", tags=["field"])

_MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MB


async def _get_user(token: str = Depends(oauth2_scheme)) -> str:
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        return payload["sub"]
    except (JWTError, KeyError):
        raise HTTPException(401, "Invalid or expired token")


@router.post("/upload")
async def upload_field_image(
    file: UploadFile = File(...),
    _: str = Depends(_get_user),
):
    """
    Accepts a multi-band GeoTIFF (B04, B08[, B03] — see image_engine.py for
    the exact convention) and returns a grid of zones with NDVI/NDWI and a
    best-effort land classification per zone.

    Note: this does not yet call the crop-recommendation model — soil/weather
    lookup and per-zone prediction are a follow-up phase.
    """
    data = await file.read()
    if len(data) > _MAX_UPLOAD_BYTES:
        raise HTTPException(413, "File too large (max 50 MB)")

    try:
        result = analyse_upload(data)
    except ImageIngestError as exc:
        raise HTTPException(400, str(exc))

    return result
