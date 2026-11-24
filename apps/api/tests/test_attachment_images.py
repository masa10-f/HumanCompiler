# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Checking an uploaded image and making what is stored from it."""

import hashlib
from io import BytesIO

import pytest
from PIL import Image

from humancompiler_api.attachment_images import (
    MAX_EDGE,
    MAX_UPLOAD_BYTES,
    THUMB_EDGE,
    ImageRejected,
    ImageTooLarge,
    process_upload,
)
from tests.attachment_helpers import image_bytes, noise_bytes, opened


def _exif(orientation: int | None = None) -> Image.Exif:
    exif = Image.Exif()
    exif[0x010F] = "SecretCameraMaker"
    if orientation is not None:
        exif[0x0112] = orientation
    return exif


@pytest.mark.parametrize("image_format", ["PNG", "JPEG"])
def test_png_and_jpeg_are_stored_as_webp(image_format: str) -> None:
    result = process_upload(image_bytes(image_format, size=(640, 400)))

    preview = opened(result.preview)
    assert preview.format == "WEBP"
    assert preview.size == (640, 400) == (result.width, result.height)
    assert result.sha256 == hashlib.sha256(result.preview).hexdigest()


def test_clean_webp_is_stored_byte_for_byte() -> None:
    data = image_bytes("WEBP", size=(640, 400), quality=80)

    result = process_upload(data)

    assert result.preview == data


def test_thumbnail_fits_the_thumbnail_edge_and_keeps_the_shape() -> None:
    result = process_upload(image_bytes("PNG", size=(1600, 800)))

    thumb = opened(result.thumb)
    assert thumb.format == "WEBP"
    assert thumb.size == (THUMB_EDGE, THUMB_EDGE // 2)


def test_small_image_is_not_enlarged_for_the_thumbnail() -> None:
    result = process_upload(image_bytes("PNG", size=(120, 60)))

    assert opened(result.thumb).size == (120, 60)


@pytest.mark.parametrize("image_format", ["JPEG", "WEBP"])
def test_exif_is_removed(image_format: str) -> None:
    data = image_bytes(image_format, size=(200, 100), exif=_exif())
    assert b"SecretCameraMaker" in data

    result = process_upload(data)

    assert b"SecretCameraMaker" not in result.preview
    assert b"SecretCameraMaker" not in result.thumb
    assert not opened(result.preview).info.get("exif")


def test_png_text_metadata_is_removed() -> None:
    from PIL.PngImagePlugin import PngInfo

    info = PngInfo()
    info.add_text("Software", "SecretPlottingTool")
    data = image_bytes("PNG", size=(200, 100), pnginfo=info)
    assert b"SecretPlottingTool" in data

    assert b"SecretPlottingTool" not in process_upload(data).preview


def test_exif_orientation_is_applied_before_it_is_dropped() -> None:
    # Orientation 6: the stored pixels are shown turned a quarter.
    data = image_bytes("JPEG", size=(200, 100), exif=_exif(orientation=6))

    result = process_upload(data)

    assert (result.width, result.height) == (100, 200)
    assert opened(result.preview).size == (100, 200)


def test_transparency_is_kept() -> None:
    data = image_bytes("PNG", size=(64, 64), color=(0, 0, 255, 0), mode="RGBA")

    preview = opened(process_upload(data).preview)

    assert preview.mode == "RGBA"
    assert preview.getpixel((10, 10))[3] == 0


def test_palette_png_is_accepted() -> None:
    data = image_bytes("PNG", size=(64, 64), color=3, mode="P")

    assert opened(process_upload(data).preview).format == "WEBP"


@pytest.mark.parametrize(
    "data",
    [
        b"",
        b"not an image at all",
        b"GIF89a" + b"\x00" * 64,
        b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
        b"\x89PNG\r\n\x1a\n" + b"garbage after a real signature",
    ],
    ids=["empty", "text", "gif", "svg", "broken-png"],
)
def test_other_content_is_rejected(data: bytes) -> None:
    with pytest.raises(ImageRejected):
        process_upload(data)


def test_type_is_read_from_the_bytes_not_the_name() -> None:
    # A GIF is refused whatever the upload called it.
    buffer = BytesIO()
    Image.new("P", (8, 8)).save(buffer, format="GIF")

    with pytest.raises(ImageRejected, match="PNG, JPEG and WebP"):
        process_upload(buffer.getvalue())


def test_long_edge_over_the_limit_is_rejected() -> None:
    with pytest.raises(ImageRejected, match="long edge"):
        process_upload(image_bytes("PNG", size=(MAX_EDGE + 1, 10)))


def test_long_edge_at_the_limit_is_accepted() -> None:
    result = process_upload(image_bytes("PNG", size=(MAX_EDGE, 10)))

    assert result.width == MAX_EDGE


def test_too_many_bytes_is_rejected_before_decoding() -> None:
    data = noise_bytes("PNG", (700, 700))
    assert len(data) > MAX_UPLOAD_BYTES

    with pytest.raises(ImageTooLarge):
        process_upload(data)


def test_animated_images_are_rejected() -> None:
    frames = [Image.new("RGB", (32, 32), color) for color in ("red", "blue")]
    buffer = BytesIO()
    frames[0].save(buffer, format="WEBP", save_all=True, append_images=frames[1:])

    with pytest.raises(ImageRejected, match="Animated"):
        process_upload(buffer.getvalue())


def test_stored_preview_stays_within_the_byte_limit() -> None:
    # A PNG just under the limit whose WebP at quality 80 is larger than a
    # lower quality: whatever is stored fits.
    data = noise_bytes("JPEG", (900, 900), quality=35)
    assert len(data) <= MAX_UPLOAD_BYTES

    try:
        result = process_upload(data)
    except ImageTooLarge:
        return
    assert len(result.preview) <= MAX_UPLOAD_BYTES
