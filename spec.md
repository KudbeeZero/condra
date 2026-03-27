# Condra

## Current State
Full top-down action shooter running on Canvas API. Controls are keyboard (WASD move, mouse aim/shoot, Q sorcery). No touch controls. index.html has a basic viewport meta tag with no mobile-specific configuration. Audio via Web AudioContext with ElevenLabs narration.

## Requested Changes (Diff)

### Add
- Virtual left joystick for movement (left half of screen, touch drag)
- Right-side touch controls: tap/hold right side to aim and auto-fire toward touch point
- Sorcery button (overlay button, bottom right area)
- iOS-specific HTML meta tags: apple-mobile-web-app-capable, apple-mobile-web-app-status-bar-style, apple-touch-icon placeholder
- iOS AudioContext unlock wrapper (iOS requires a user gesture before AudioContext can play; add a one-time unlock on first touch)
- Prevent default touch behaviors: no pinch-zoom, no scroll bounce, no double-tap zoom
- CSS to prevent rubber-band scrolling on iOS (overscroll-behavior: none, touch-action: none on canvas container)
- Mobile-responsive HUD: scale font sizes, virus meter, HP bar for smaller screens using vw/vh units so they're readable on phones
- Portrait and landscape orientation support with no layout breakage
- On menu screen: replace "WASD MOVE · MOUSE AIM & SHOOT · Q SORCERY" hint with "JOYSTICK MOVE · TAP RIGHT TO SHOOT · SORCERY BUTTON"

### Modify
- index.html: update viewport meta to `width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no` and add iOS meta tags
- Game loop: merge touch input (joystick delta → player movement, right-touch pos → mousePos + mouseDown) with existing keyboard/mouse input so both work simultaneously
- AudioContext initialization: wrap in iOS unlock shim (play a silent buffer on first touchstart to unlock audio)
- Canvas sizing: use `visualViewport` API where available for correct height on iOS Safari (avoids the 100vh bottom bar issue)

### Remove
- Nothing removed

## Implementation Plan
1. Update `index.html` with proper mobile/iOS meta tags and prevent-zoom viewport
2. In `App.tsx`, add a `useMobileControls` logic block that:
   a. Tracks a left-side joystick touch (touchstart on left 45% of screen = joystick center, touchmove = delta → normalized direction vector)
   b. Tracks a right-side aim/fire touch (touchstart/touchmove on right 55% = set mousePos to touch coords, set mouseDown=true; touchend = mouseDown=false)
   c. Renders a virtual joystick visual (semi-transparent circle + inner dot) on the canvas overlay OR as a positioned div
   d. Renders a SORCERY button as a fixed positioned button (bottom-right area)
3. Add iOS AudioContext unlock: on first `touchstart` anywhere, try to resume/unlock AudioContext with a silent buffer
4. Add CSS touch-action:none and overscroll-behavior:none to body/canvas wrapper
5. Use `window.visualViewport?.height ?? window.innerHeight` for canvas height to avoid iOS toolbar issues
6. Scale HUD elements with canvas size so they remain usable on small screens
