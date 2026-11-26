# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Checking an uploaded image and making what is stored from it."""

import hashlib
import struct
import zlib
from io import BytesIO

import pytest
from PIL import Image, ImageCms

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


def _with_chunk(webp: bytes, tag: bytes, payload: bytes) -> bytes:
    """``webp`` with one more RIFF chunk at its end, and the size to match."""
    chunk = tag + len(payload).to_bytes(4, "little") + payload
    if len(payload) % 2:
        chunk += b"\x00"
    body = webp[8:] + chunk
    return b"RIFF" + len(body).to_bytes(4, "little") + body


def test_webp_with_an_unknown_chunk_is_stored_from_its_pixels() -> None:
    clean = image_bytes("WEBP", size=(320, 200), quality=80)
    data = _with_chunk(clean, b"JUNK", b"SecretNoteInAChunk")
    assert opened(data).size == (320, 200)

    result = process_upload(data)

    assert b"SecretNoteInAChunk" not in result.preview
    assert b"JUNK" not in result.preview
    assert opened(result.preview).size == (320, 200)


def test_bytes_after_the_webp_are_not_stored() -> None:
    data = image_bytes("WEBP", size=(320, 200), quality=80) + b"SecretTrailer"

    result = process_upload(data)

    assert b"SecretTrailer" not in result.preview
    assert opened(result.preview).size == (320, 200)


def test_webp_with_alpha_and_a_colour_profile_is_stored_byte_for_byte() -> None:
    # VP8X + ICCP + ALPH + VP8: all of it is the image.
    profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    data = image_bytes(
        "WEBP",
        size=(64, 64),
        color=(0, 0, 255, 120),
        mode="RGBA",
        quality=80,
        icc_profile=profile,
    )
    assert b"ICCP" in data and b"VP8X" in data

    assert process_upload(data).preview == data


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


def _png_header_only(width: int, height: int) -> bytes:
    """A PNG that is nothing but a header claiming a size: a few dozen bytes."""

    def chunk(tag: bytes, body: bytes) -> bytes:
        checksum = zlib.crc32(tag + body) & 0xFFFFFFFF
        return struct.pack(">I", len(body)) + tag + body + struct.pack(">I", checksum)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IEND", b"")


@pytest.mark.parametrize("edge", [2000, 12000, 20000, 60000])
@pytest.mark.filterwarnings("ignore::PIL.Image.DecompressionBombWarning")
def test_tiny_file_claiming_a_huge_image_is_rejected(edge: int) -> None:
    # Past about 179 million pixels Pillow refuses to open the file at all,
    # with an error that is not an OSError.
    data = _png_header_only(edge, edge)
    assert len(data) < 100

    with pytest.raises(ImageRejected, match="long edge limit"):
        process_upload(data)


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
