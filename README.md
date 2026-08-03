# BHFC Website — Stage 1.6 Final

Deployable update for the existing Render/GitHub preview website.

## Completed fixes

- Fixed the missing header logo by correcting the Express `/assets` static path.
- Uses the supplied transparent `Main logo.png` throughout the site.
- Preserves the existing desktop homepage design.
- Uses the current homepage footage and ends the loop at 15.7 seconds, before the final shot of the two older men.
- Uses the latest supplied `Captains_Pantry_7s(3).mp4` video.
- Captain’s Pantry video autoplays muted, loops, hides controls and crops to fill its panel.
- Corrected menu category mapping and TV-menu order:
  1. Beer Battered Fish
  2. Crumbed Fish
  3. Grilled Fish
  4. Burgers & Tacos
  5. Snacks
  6. Chips
- `freshFish` now displays as **Beer Battered Fish**.
- `addChips` is grouped under **Grilled Fish**, matching the TV menu layout.
- Item order from the Menu Manager is preserved within every section.
- Google service layer retained for trading hours, special hours, open/closed status, rating, review count, address and directions.
- Popular Times is not requested or displayed.
- Media assets are stored under the `assets/` folder.

## Render environment variables

- `MENU_API_URL`
- `GOOGLE_PLACES_API_KEY`
- `GOOGLE_PLACE_ID`

## Deploy

Extract the ZIP, upload all files to the root of the existing GitHub repository and commit. Render should deploy automatically. If required, use **Manual Deploy → Deploy latest commit**.
