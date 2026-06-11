# Changelog

All notable changes to Open Poker will be documented in this file.

## [0.1.0.0] - 2026-04-12

### Added
- Account system: create an account with username/password, or stay anonymous. Accounts use scrypt hashing and timing-safe session tokens.
- Device identity: anonymous players get a persistent name saved to their browser. Accounts sync identity across devices.
- Configurable blinds: pick from 11 stake presets ($0.01/$0.02 through $20/$50) or enter custom blinds when creating a table.
- Host mode: authenticated users can create host-controlled rooms with seat approval queues, rebuy management, auto-deal, pause/resume, and end-of-session settlement.
- Hand persistence: every completed hand is saved to disk with full action history, board, and showdown data.
- Hand replay viewer: visit /hand/{id} to see a street-by-street breakdown of any completed hand, including board cards, pot sizes, and showdown results.
- Showdown equity computation for replay analysis.
- PokerNow log parser for importing external hand histories.

### Changed
- Lobby redesigned with stake selection grid, auth panel, and lichess-inspired dark theme.
- Game table now shows chip amounts in dollar format ($1.00 instead of 100).
- Raise controls include pot-fraction presets (Min, 1/2 Pot, 3/4 Pot, Pot, All In) and a dollar-amount input field.
- Players can no longer sit down during an active hand.
- Reconnect grace period extended to cover host-mode sessions between hands.

### Fixed
- Path traversal vulnerability in hand replay file store.
- Session hash comparison now uses constant-time equality.
- Creator IP no longer leaked in room creation API response.
- Anonymous WebSocket connections can no longer spoof authenticated player IDs.
- Host mode requires authentication; host identity derived from session, not client input.
- Room creation no longer leaves orphan rooms when host auth fails.
- WebSocket message routing reads host session state dynamically instead of capturing it once at connection time.
