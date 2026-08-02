# BHFC Website — Stage 1

A separate Render-ready staging website for Brunswick Heads Fish & Chippery.

## Included

- Responsive video-led homepage
- Mobile navigation
- Live website menu proxied from the existing Menu Manager
- Current Square prices and sold-out status
- Signature dish media
- Brunswick Heads drone section
- Visit and directions section
- Existing Square Online ordering remains separate

## Deploy to Render

1. Create a new GitHub repository, for example `bhfc-website-stage1`.
2. Upload all extracted files from this ZIP.
3. In Render choose **New → Web Service** and connect the repository.
4. Use:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
5. Add this optional environment variable:
   - `MENU_API_URL=https://bhfc-digital-menu.onrender.com/api/menu`
6. Deploy.

Render will issue a temporary URL such as:

`https://bhfc-website-stage1.onrender.com`

## Before launch

Update these details after confirmation:

- Exact Square Online order URL in `public/app.js`
- Phone number in `public/index.html`
- Final trading hours
- Final approved logo asset if a higher-resolution original is supplied

The current Square website and domain remain untouched until the staging site is approved.
