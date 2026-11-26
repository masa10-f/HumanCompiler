# SPDX-License-Identifier: AGPL-3.0-or-later
# SPDX-FileCopyrightText: 2024-2026 Masato Fukushima <masa1063fuk@gmail.com>
#
# This file is part of HumanCompiler.
# For commercial licensing, see COMMERCIAL-LICENSE.md or contact masa1063fuk@gmail.com

"""Images made in memory for the attachment tests."""

from io import BytesIO
from typing import Any

from PIL import Image


def image_bytes(
    image_format: str = "PNG",
    size: tuple[int, int] = (64, 48),
    color: tuple[int, ...] = (200, 30, 30),
    mode: str = "RGB",
    **save_options: Any,
) -> bytes:
    """A plain one-colour image, a few hundred bytes."""
    buffer = BytesIO()
    Image.new(mode, size, color).save(buffer, format=image_format, **save_options)
    return buffer.getvalue()


def noise_bytes(image_format: str, size: tuple[int, int], **save_options: Any) -> bytes:
    """An image of random pixels, which no codec compresses well."""
    buffer = BytesIO()
    Image.effect_noise(size, 80).convert("RGB").save(
        buffer, format=image_format, **save_options
    )
    return buffer.getvalue()


def opened(data: bytes) -> Image.Image:
    image = Image.open(BytesIO(data))
    image.load()
    return image
