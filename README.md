# Pebolim

A fast, browser-based foosball game with:

- True online multiplayer (browser-to-browser via WebRTC)
- No backend
- No database
- No persistence

The host runs the match simulation (physics, score, collisions), and connected players control assigned rods remotely.

## Features

- HTML5 Canvas game rendering
- Host-authoritative game state for online matches
- Multiple players per side by assigning different rods
- Manual signaling flow (offer/answer JSON copy/paste)
- Responsive UI with in-game setup panel
- Built-in info modal (instructions + credits)

## Tech Stack

- HTML5
- CSS3
- Vanilla JavaScript
- WebRTC Data Channels (with public STUN)

## Project Structure

- [index.html](index.html): Main UI, game canvas, networking controls, info modal
- [style.css](style.css): Styling, responsive layout, modal visuals
- [game.js](game.js): Game loop, physics, controls, and WebRTC logic

## Quick Start

### Option 1: Open directly

Open [index.html](index.html) in a modern browser.

### Option 2: Run a local static server (recommended)

If your browser blocks some local file behaviors, run a static server.

Using Python:

```bash
cd pebolim
python3 -m http.server 8080
```

Then open:

- http://localhost:8080

## How To Play

### Online (multiple devices)

1. On one device, set Mode to `Host Match`.
2. Select which rod to assign to the next joiner.
3. Click `Create Offer` and share that JSON with the joiner.
4. On the joiner device, set Mode to `Join Match`.
5. Paste offer JSON, click `Create Answer`, send answer JSON back.
6. Host pastes answer JSON and clicks `Apply Answer`.
7. Repeat for additional players/rods.

## Controls

### Host controls

- Host selected rod movement: `W / S`
- Host selected rod spin: `Space`
- Choose host-controlled rod in the `Host rod` selector

### Joiner controls

- Assigned rod movement: `W / S`
- Assigned rod spin: `Space`

## Networking Notes

- Uses peer-to-peer WebRTC Data Channels.
- Signaling is manual (copy/paste), so no signaling server is required.
- Uses `stun:stun.l.google.com:19302` for ICE/STUN.
- Some networks with strict NAT/firewalls may fail without TURN relay support.

## Troubleshooting

### Remote player cannot connect

- Verify host and joiner exchanged the correct JSON pair.
- Ensure each answer is applied to its matching offer.
- Try a different network (mobile hotspot often helps diagnose NAT issues).

### Joiner can connect but cannot move rod

- Confirm the host assigned a rod for that joiner.
- Joiner uses `W / S` only.
- Ensure browser tab is focused.

### Game does not load correctly from local file

- Use a local static server (see Quick Start Option 2).

## Gameplay Model

- Host simulates rods, ball, collisions, score, and win state.
- Joiners send input events only.
- Host broadcasts state snapshots to all connected peers.

This model keeps all clients synchronized and avoids divergent physics.

## Roadmap Ideas

- One-click copy buttons for offer/answer JSON
- Rod occupancy/lock indicators in UI
- Optional TURN server support for hard NAT environments
- Touch controls for mobile joiners
- Sound effects and crowd ambience

## Credits

Built with GitHub Copilot (GPT-5.3-Codex).
