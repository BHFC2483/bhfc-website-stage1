# BHFC Website v1.3.4 — Browser-safe live menus

## Changes
- Main Menu and Snacks & More remain live embeds on desktop, tablet and mobile.
- Removed TV 1 and TV 2 labels.
- Removed static screenshot fallbacks.
- Removed links that opened raw full-screen TV menu pages.
- Preserved website navigation, videos, ordering links and all other production behaviour.

# BHFC Website v1.3.1 — Order Link Fix

- Updates every Order Online button to https://order.brunswickheadsfishandchippery.com.au
- Preserves the working sticky mobile header and browser compatibility fixes.
- Footer version updated to BHFC Website v1.3.1.


## BHFC Website v1.3.5 — Same-Origin Live Menu Fix
- Main Menu and Snacks & More are served from the website domain for mobile browser reliability.
- Menu renderer synced to BHFC Digital Menu v13.2.4.
- Menu data remains live via `/api/live-menu`, which proxies the production digital-menu API.
- Removes cross-origin iframe dependency on Chrome/Safari mobile.
- No TV 1 / TV 2 labels and no screenshot fallback.
