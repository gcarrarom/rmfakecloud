# Screen-share diagnostics

The Screen Share page uses an authenticated Server-Sent Events connection to
show tablet MQTT presence and new signaling/WebRTC diagnostics. EventSource
reconnects automatically after a temporary browser or network disconnect; the
page also retries screen-share negotiation with capped exponential backoff.

Diagnostics are stored in the application data directory as
`screenshare-diagnostics.jsonl`. They are scoped to the authenticated user and
contain event names and short summaries only; SDP, TURN credentials, ICE
candidates, and screen contents are not stored.

Retention and volume can be tuned with these environment variables:

| Variable | Default | Description |
| --- | ---: | --- |
| `SCREENSHARE_DIAGNOSTICS_RETENTION_DAYS` | `7` | Maximum age of retained diagnostics. |
| `SCREENSHARE_DIAGNOSTICS_MAX_EVENTS` | `5000` | Maximum retained events per user, in addition to the age limit. |

Invalid or non-positive values use the defaults. Retention is capped at 100
years and the event cap at 100,000 per user to protect storage and memory. Old
events are pruned at startup, every 15 seconds, and as new diagnostics are
recorded.
