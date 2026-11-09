# QR Code Generator

A single-file, fully offline QR code generator. Open `index.html` in a browser — there is nothing to build or install, and no data ever leaves your machine.

## Features

- Content types: plain text / URL, Wi-Fi (with optional password reveal), e-mail (several recipients allowed), phone, SMS and vCard
- Phone numbers are normalised (separators and full-width characters are stripped)
- Error correction levels L / M / Q / H, versions 1–40
- Numeric, alphanumeric and byte (UTF-8) encoding modes; the input is split into mixed-mode segments automatically to produce the smallest code
- Styles: square, rounded and dots (dots touch each other and the finder / alignment patterns stay solid, so scanners can still read them)
- Custom size, quiet zone (default 4 modules, as recommended by ISO/IEC 18004) and colors, plus transparent background
- Export as PNG or SVG, or copy the image to the clipboard
- Material 3 inspired UI with light / dark / system appearance and selectable accent colors
- Contrast warnings for low-contrast or inverted colors

## Usage

Just open `index.html`, or serve the folder with any static file server:

```sh
python3 -m http.server 8000
```

## Tests

The encoder and content builders have dependency-free tests (Node.js 18+):

```sh
node --test   # or: npm test
```

## Notes

- Copying an image to the clipboard requires a browser that supports `ClipboardItem` and a secure context (`https://` or `localhost`).
- The encoder is implemented from scratch in plain JavaScript with no dependencies.

## License

AGPL-3.0, see [LICENSE](LICENSE).
