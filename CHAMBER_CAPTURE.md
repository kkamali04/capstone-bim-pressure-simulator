# Sure² R3 — chamber setup and USB capture

November 27, 2026. This extends the existing main 3D twin and Recorded Test Analysis. The working Arduino firmware is unchanged.

## Chamber model

1. Open the main building workspace and select **Chamber setup**.
2. Enter actual internal width, depth and height. The 2 ft × 2 ft × 4 ft defaults are the approximate proposed box, not confirmed as-built dimensions. Feet/meter switching converts the displayed values.
3. Leave dimension evidence as Proposed until checked. User-declared measured dimensions do not make flows calibrated.
4. Enter explicitly assumed supply, exhaust and reference leakage. The defaults (2 and 4 m³/h, leakage 0.0003 m³/s/√Pa) are an illustrative software case, not sensor measurements or fan specifications.
5. Build the chamber. The resulting shell contains one pressure zone, **CHAMBER**, against **REFERENCE**, and six schematic panels. It does not claim a known partition, opening, fan or tubing arrangement.
6. Review the modeled baseline and run the existing HVAC scenarios. The 3D cells all show the same room pressure at an instant. The default volume is approximately 0.4531 m³; changing volume does not identify a physical response time in this equilibrium solver.
7. Use Inspector → Download reviewed project to save geometry, assumptions, dimension evidence and notes. Reopen the JSON through Open BIM. Chamber setup then loads the saved values for editing.

A chamber build replaces the current in-tab model. Save any reviewed building project first. Generic IFC workflows and the public Duplex example remain available.

## USB capture with the working sketch

The implementation uses [the browser Web Serial API](https://developer.chrome.com/docs/capabilities/serial). The actual computer/browser must expose `navigator.serial` in a secure context (the HTTPS Pages site or localhost). If it does not, file import and synthetic replay remain available. Direct USB connection to the team's board is still awaiting lab verification.

1. Keep the working Sure2_Sensor_Display sketch installed. Connect the board by USB and close the Arduino Serial Monitor so it does not hold the port.
2. Open **Recorded tests**. Enter a unique capture run ID and setup notes: sensor devices connected, physical pressure endpoints/hose polarity, fan/opening state and dimension/photo references.
3. Choose Connect USB and select the board's serial port. The browser opens 115200 baud, 8 data bits, no parity, one stop bit, no hardware flow control.
4. Choose Start new run. It sends `t` then `c`, matching the existing sketch's commands. This requests a fresh CSV header even when the board was already in CSV mode. It does not flash or alter firmware. Allow for any startup/reset delay; verify timestamped rows appear.
5. Observe DP A and DP B separately. They are separate sensor devices, not the two ports of one SDP810. A failed/absent device remains missing, never zero. Preview shows up to 200 recent samples; complete rows remain in the capture.
6. Mark baseline, event/failure, restoration or a note as appropriate. Each marker stores host button UTC, latest received device timestamp and that sample's host receipt UTC. These clocks are not synchronized: the marker is an observation anchored to the latest sample, not a precise instrument trigger.
7. Stop & disconnect. Save raw serial text, normalized Arduino CSV and capture/event JSON before starting another run or closing the tab. Captures remain in memory; there is no autosave or upload.
8. Load capture into analysis. Review the selected channel, pressure sign, endpoints, stable baseline and event times. Device captures start as imported/unverified. A single failure and restoration marker prefill their elapsed times; multiple markers require manual review. The JSON evidence retains the capture metadata and raw-text fingerprint.
9. Export an explicit comparison window and import it into the chamber model. The IDs **CHAMBER** and **REFERENCE** match directly. Align event times and the window origin. Successful matching establishes mapping, not physical model accuracy.

The logger preserves text decoded from the serial stream. It stops on malformed sample rows, duplicate/backward device time, a serial error or the 5 MB / 99,990-row limits. Raw accepted text remains downloadable; error captures cannot be loaded directly into analysis. A trailing line without newline is retained in raw text and excluded from normalized CSV. Repeated identical headers are counted. Do not merge runs across a device reset.

The capture JSON includes raw text, normalized CSV, host receipt timestamps, event markers, notes, source, start/stop time, warnings and errors. Its SHA-256 refers to decoded raw serial text; it is not a device signature or proof of calibration. Synthetic replay remains marked SYNTHETIC in both CSV and analysis. The recorded-analysis export window is still at most 60 seconds; the main simulator supports up to 600 seconds.

## Software demonstration without the board

Use Replay synthetic stream. It sends the existing 180 s software fixture through the same incremental line assembler in fragmented chunks. Mark baseline or add notes while it runs. After completion, load it into analysis and inspect/download the evidence. The fixture remains synthetic; its default analysis event times are 30 s and 100 s, separate from practice button markers in the capture log.

## Verification

`npm test`: 55 passed, 0 failed (36 prior plus 19 chamber/capture checks).

New checks cover SI conversion, geometry/project roundtrip, assumed network inputs, invalid/corrupted setup rejection, volume interpretation, every possible split of a CRLF stream, missing values/true zeros, headers, device resets, malformed flags/rows, raw tail preservation, clock/event anchors, synthetic provenance, memory bounds, and Web Serial adapter setup/command/cleanup/error behavior using in-memory streams.

Browser checks: chamber built and simulated; unit conversion preserved dimensions; project download/reopen retained settings; 181-row synthetic capture analyzed; DP B stayed absent; raw metadata/event JSON and analysis JSON retained the same fingerprint and markers; a 61-point CHAMBER/REFERENCE comparison window imported with no unmatched points.

No physical USB board, new chamber run, calibrated reference, fan curve, live hardware-to-3D stream or facility risk validation was tested. The live USB logger has a preview; model comparison is an explicit saved-recording workflow.
