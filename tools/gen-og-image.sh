#!/usr/bin/env bash
# Generate the 1200x630 Open Graph / social preview image.
#
#   ./tools/gen-og-image.sh
#
# Requires ImageMagick (convert) and the DejaVu fonts. Output: assets/og-image.png.
# Re-run after changing the headline copy below.
set -euo pipefail

cd "$(dirname "$0")/.."
mkdir -p assets

FONT_BOLD=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf
FONT=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf
FONT_MONO_BOLD=/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf

INK=#11142B
PAPER=#FFF8E7
CYAN=#65E8FF
YELLOW=#FFE168
PINK=#FF4E91
BLUE=#3768FF

convert -size 1200x630 "xc:${INK}" \
  -fill "${BLUE}" -draw "rectangle 0 0 1200 630" \
  -fill "${PAPER}" -draw "rectangle 0 0 1200 582" \
  -fill "${CYAN}" -draw "rectangle 40 40 1160 46" \
  -fill "${YELLOW}" -draw "rectangle 40 88 300 132" \
  -font "${FONT_MONO_BOLD}" -pointsize 26 -fill "${INK}" \
  -annotate +62+118 "FIELDNOTES" \
  -font "${FONT_BOLD}" -pointsize 78 -fill "${INK}" -interline-spacing 2 \
  -annotate +40+250 "From first frame to" \
  -annotate +40+340 "a portfolio with" \
  -annotate +40+430 "purpose." \
  -font "${FONT}" -pointsize 30 -fill "#3B4159" \
  -annotate +42+492 "A free, location-neutral nature photography roadmap." \
  -font "${FONT_MONO_BOLD}" -pointsize 25 -fill "${INK}" \
  -annotate +42+552 "09 STAGES · 25 LEARNING CARDS · 32 WEEKS · FREE" \
  -fill "${CYAN}" -draw "rectangle 980 300 1012 332" \
  -fill "${YELLOW}" -draw "rectangle 1012 300 1044 332" \
  -fill "${PINK}" -draw "rectangle 1044 300 1076 332" \
  -fill "${YELLOW}" -draw "rectangle 980 332 1012 364" \
  -fill "${PINK}" -draw "rectangle 1012 332 1044 364" \
  -fill "${CYAN}" -draw "rectangle 1044 332 1076 364" \
  -fill "${PINK}" -draw "rectangle 980 364 1012 396" \
  -fill "${CYAN}" -draw "rectangle 1012 364 1044 396" \
  -fill "${YELLOW}" -draw "rectangle 1044 364 1076 396" \
  -fill "${PINK}" -draw "rectangle 1010 88 1110 108" \
  -fill "${CYAN}" -draw "rectangle 1010 122 1160 142" \
  -fill "${YELLOW}" -draw "rectangle 1010 156 1080 176" \
  -font "${FONT_MONO_BOLD}" -pointsize 25 -fill "#FFFFFF" \
  -annotate +42+617 "nature-photography-roadmap.vercel.app" \
  -strip -quality 92 assets/og-image.png

echo "wrote assets/og-image.png ($(wc -c < assets/og-image.png) bytes)"
identify assets/og-image.png
