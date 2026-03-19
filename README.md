# Business Card Editor

Simple browser-based prototype for XAMPP.

## What it does

- Upload a business card image
- Run OCR in the browser to detect text lines
- Create editable text layers from detected content
- Adjust text, font family, font size, weight, color, width, position, and rotation
- Drag layers directly on the preview canvas
- Export the result as PNG or PDF

## How to use

1. Open `http://localhost/business-card-editor/`
2. Upload a card image
3. Click `Analyze text`
4. Select a text layer and edit it
5. Export to PNG or PDF

## Important limitation

If the uploaded card is only a flat image, the app can estimate text blocks and styling, but it cannot perfectly recover the original vector text or guaranteed exact font family. Best results come from:

- high-resolution source images
- simple, high-contrast text
- manual font selection after OCR detection
