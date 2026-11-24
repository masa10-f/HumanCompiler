# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""
Check an uploaded image and turn it into what is stored: a WebP preview and a
WebP thumbnail, with no metadata.

The sender (the web editor, the CLI) already shrinks the image to the limits
here before uploading, so the original never reaches the server. Nothing the
sender says is trusted: the type is read from the bytes, the size is read from
the image header before any pixel is decoded, and EXIF and XMP (camera, GPS,
software, author) are dropped.

A WebP made of image data alone is stored byte for byte, so the sender's one
lossy encoding is the only one; anything else (another format, or a WebP with
EXIF, XMP, a chunk this module does not know, or bytes after the image) is
encoded as WebP here from its pixels.
"""

import hashlib
from dataclasses import dataclass
from io import BytesIO

from PIL import Image, ImageOps, UnidentifiedImageError

# Limits on the uploaded preview. The sender shrinks to these.
MAX_UPLOAD_BYTES = 300 * 1024
MAX_EDGE = 1600
THUMB_EDGE = 480

_WEBP_QUALITIES = (80, 70, 60)
_THUMB_QUALITY = 75
_FORMATS = {"PNG", "JPEG", "WEBP"}
# The chunks of a still WebP that are the image itself: pixels, alpha, the
# header that says which of those follow, and the colour profile. Everything
# else (EXIF, XMP, animation, anything unknown) makes the file be re-encoded.
_WEBP_IMAGE_CHUNKS = frozenset({b"VP8 ", b"VP8L", b"VP8X", b"ALPH", b"ICCP"})


class ImageRejected(Exception):
    """The upload is not an image this API stores. ``str()`` says why."""


class ImageTooLarge(ImageRejected):
    """The upload has more bytes than ``MAX_UPLOAD_BYTES``."""


@dataclass(frozen=True)
class ProcessedImage:
    """What is stored for one attachment."""

    preview: bytes
    thumb: bytes
    width: int
    height: int
    sha256: str


def _sniff(data: bytes) -> str | None:
    """The format the first bytes say this is, of the three accepted."""
    if data.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG"
    if data.startswith(b"\xff\xd8\xff"):
        return "JPEG"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "WEBP"
    return None


def _is_plain_webp(data: bytes) -> bool:
    """Whether ``data`` is a WebP file holding image chunks and nothing else.

    Walks the RIFF container: the declared size must be the whole of ``data``
    (no bytes after it) and every chunk must be one of ``_WEBP_IMAGE_CHUNKS``.
    """
    if len(data) < 12 or data[:4] != b"RIFF" or data[8:12] != b"WEBP":
        return False
    if int.from_bytes(data[4:8], "little") + 8 != len(data):
        return False
    offset = 12
    while offset < len(data):
        if offset + 8 > len(data):
            return False
        if data[offset : offset + 4] not in _WEBP_IMAGE_CHUNKS:
            return False
        size = int.from_bytes(data[offset + 4 : offset + 8], "little")
        # A chunk's payload is padded to an even length.
        offset += 8 + size + (size & 1)
    return offset == len(data)


def _encode_webp(image: Image.Image, quality: int) -> bytes:
    buffer = BytesIO()
    # No exif, xmp or icc_profile argument: none is written.
    image.save(buffer, format="WEBP", quality=quality, method=6)
    return buffer.getvalue()


def _displayable(image: Image.Image) -> Image.Image:
    """The image in a mode WebP stores (RGB, or RGBA when it has transparency)."""
    if image.mode in ("RGB", "RGBA"):
        return image
    has_alpha = image.mode in ("LA", "PA") or "transparency" in image.info
    return image.convert("RGBA" if has_alpha else "RGB")


def process_upload(data: bytes) -> ProcessedImage:
    """Check ``data`` and make the preview and thumbnail to store.

    Raises ``ImageTooLarge`` or ``ImageRejected`` with a message for the
    sender."""
    if len(data) > MAX_UPLOAD_BYTES:
        raise ImageTooLarge(
            f"The image is {len(data)} bytes; the limit is {MAX_UPLOAD_BYTES} "
            "(shrink it before uploading)"
        )
    sniffed = _sniff(data)
    if sniffed is None:
        raise ImageRejected("Only PNG, JPEG and WebP images are accepted")
    try:
        image = Image.open(BytesIO(data), formats=[sniffed])
    except (UnidentifiedImageError, OSError, ValueError):
        raise ImageRejected("The file is not a readable image") from None

    # Known from the header: checked before the pixels are decoded, so a small
    # file cannot make the server allocate a huge image.
    width, height = image.size
    if width < 1 or height < 1 or max(width, height) > MAX_EDGE:
        raise ImageRejected(
            f"The image is {width}x{height}; the long edge limit is {MAX_EDGE} px "
            "(shrink it before uploading)"
        )
    if getattr(image, "is_animated", False):
        raise ImageRejected("Animated images are not accepted")
    try:
        image.load()
    except (OSError, ValueError, SyntaxError, Image.DecompressionBombError):
        raise ImageRejected("The file is not a readable image") from None

    if sniffed == "WEBP" and _is_plain_webp(data):
        preview = data
        pixels = _displayable(image)
    else:
        # A JPEG's orientation is in its EXIF, which is dropped: turn the
        # pixels the way the image is meant to be seen first.
        pixels = _displayable(ImageOps.exif_transpose(image))
        width, height = pixels.size
        preview = b""
        for quality in _WEBP_QUALITIES:
            preview = _encode_webp(pixels, quality)
            if len(preview) <= MAX_UPLOAD_BYTES:
                break
        else:
            raise ImageTooLarge(
                "The image is over the size limit once stored as WebP "
                "(shrink it before uploading)"
            )

    thumb_image = pixels.copy()
    thumb_image.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.Resampling.LANCZOS)
    thumb = _encode_webp(thumb_image, _THUMB_QUALITY)

    return ProcessedImage(
        preview=preview,
        thumb=thumb,
        width=width,
        height=height,
        sha256=hashlib.sha256(preview).hexdigest(),
    )
