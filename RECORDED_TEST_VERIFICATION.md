# Recorded Test Analysis R1 — Verification
Date: November 26, 2026.
Software: recorded-tests-1.0.0.
Base repository revision: 34c6e565742b35dd3f7372cd7b597bc3df625ce4.

## Automated
Command: npm test.
Result: 22 passed, 0 failed.
Additional 99,999-sample pressure recording analyzed successfully.
JavaScript syntax checks and git diff --check passed.

Meaningful assertions include hand-calculated crossing duration (5/3 s), sample SD, uninterrupted recovery entry/confirmation, flags/gaps, no invented zeros, duplicate/reset rejection, unit mismatch rejection, inH2O conversion, endpoint validation, synthetic provenance and HTML escaping.

The existing A101 exhaust scenario retains approximately −1.78 / +2.61 / −1.65 Pa at 0 / 30 / 60 seconds. The solver source is unchanged.

## Observed browser checks
- Existing public Duplex IFC imported: 236 represented objects, 21 spaces including roof.
- Original simulation opened, synthetic comparison loaded and scenario ran. Baseline −1.78 Pa; end −1.65 Pa.
- New workspace opened from the same software.
- Brief synthetic capture analyzed: −2 Pa baseline, +4 Pa sampled peak, 12.92 s above +2.5 Pa, recovery entry 3.33 s after restoration.
- Sustained synthetic capture: 240 s full duration, 206.25 s above threshold, recovery not observed.
- Dropout fixture: 162 valid / 11 invalid samples; gaps appear in the trace; no false zero or early recovery.
- Actual file chooser imported a sketch-format CSV.
- Generic unknown units blocked import. Selecting verified inH2O allowed import; 0.045 converted to 11.209 Pa.
- A recording with a device time reset was rejected.
- Changing settings disabled stale exports.
- Playback advanced through the recording.
- Readable HTML, JSON and boundary CSV downloads completed.
- Downloaded JSON was read back: original file SHA-256 matched, source SYNTHETIC, all 181 samples preserved.
- Exported boundary CSV mapped to A101 was imported into the existing simulator: 61 readings, 61 matched, 0 unmatched. Numerical errors here compare deliberately different synthetic signals and are not validation results.

The exported HTML report is self-contained and supports normal browser printing. Physical printer output is outside these checks.

## Not established
No chamber hardware was connected during this work. No calibrated pressure reference or WBHT TEC raw data was used. No physical prediction, facility certification, live serial acquisition or automated risk assessment is claimed.

