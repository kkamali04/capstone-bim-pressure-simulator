# Sure² main 3D twin — reviewed baseline and HVAC tests

Released November 27, 2026. Module: hvac-tests-1.0.0.

## Why this was added

The sponsor's report and follow-up emphasized understanding baseline operation and design intent before interpreting equipment failures, pressure reversals and restoration. This update brings that workflow into the existing IFC/3D workspace. It uses the public buildingSMART Duplex and synthetic inputs; private sponsor reports, drawings and measurements are not distributed in this repository.

## Demonstrate the main twin

1. Open the building workspace and choose **Public research: Duplex Architecture (residential)**. Open **Pressure simulation**. Load the synthetic example to select A101.
2. Review the visible supply, exhaust, leakage and network assumptions. Check the input review box.
3. Open **Baseline operation / design intent**. Enter the intended normal pressure relationship in plain language and optionally your reviewer name. Optional lower/upper design-band bounds apply to the selected room relative to the fixed reference. Leave them blank if no justified values exist.
4. Capture normal modeled operation. This freezes a copy of the normal network, calculated pressures, intent and entered bands. It is not measured calibration or a pass/fail certification. Editing flow inputs, intent or bands invalidates this review and old results.
5. Choose the sequenced HVAC scenario. Review the run duration (up to 600 s), severity, failure and restoration times, input-ramp constant, and test pattern. An illustrative starting case is 100% loss, failure at 10 s, primary restoration at 45 s, supply shutdown lag 3 s, supply restoration lag 5 s, ramp 4 s, and duration 180 s.
6. Run. A sequenced test requires a current reviewed baseline. The event list states the actual start/restoration time for each aggregate flow action. Sustained exhaust loss has no restoration within the run.
7. Choose the pressure pair. The selected room is the positive endpoint; choose either the fixed reference or another room as the negative endpoint. The chart and boundary metrics use positive pressure minus negative pressure. **The 3D cell colors always remain room-to-fixed-reference pressures.** Scrub or play the full run.
8. Inspect peak pressure, time above the entered threshold, internal connection basis and modeled flow details. A pressure comparison between rooms without an enabled link is explicitly identified as a pressure comparison only.
9. Download the selected boundary CSV, self-contained HTML test summary and JSON evidence. The HTML opens offline and can be printed. JSON includes the baseline snapshot, event plan, inputs and selected boundary review. Imported recordings keep a separate provenance label.

## Four supported patterns

| Pattern | Aggregate actions |
| --- | --- |
| Exhaust loss with delayed supply shutdown | Exhaust is reduced first; supply follows after the shutdown lag. Both restore with the entered restoration lag. |
| Supply and exhaust loss together | Both selected-room flows reduce and restore at the same scheduled times. |
| Exhaust loss in two rooms | Exhaust is reduced in two different room zones. This is not a model of two identified fans serving one zone. |
| Sustained exhaust loss | Selected-room exhaust reduces and remains reduced through the end of the run. |

Severity scales each affected aggregate flow by the same fractional loss. The ramp is exponential: the fraction of commanded loss rises as `1 − exp(−elapsed / tau)`; after restoration, the achieved loss fraction decays continuously toward zero. The solver computes equilibrium for each 0.5 s sample, including an exact final frame for fractional durations. This is a prescribed input response, not a fitted fan, pneumatic storage or CFD transient.

## Reproducible synthetic software comparison

Using unchanged public Duplex inputs, A101 as the action target, and **A101 minus A104** as the reviewed pressure pair, compare only the supply shutdown lag. Use 100% severity, failure 10 s, exhaust restoration 45 s, supply restoration 50 s, duration 180 s, ramp 4 s, and +2.5 Pa as an illustrative analysis threshold.

| Shutdown lag | Sampled peak A101 − A104 | Modeled time above +2.5 Pa |
| --- | ---: | ---: |
| 3 s | 1.28 Pa | 0.00 s |
| 10 s | 5.70 Pa | 7.17 s |

This demonstrates that sequence timing affects the modeled boundary response. The values are not chamber measurements, facility results or acceptable risk limits. The threshold is a user-selected analysis setting.

## Recorded data and limits

The existing Arduino firmware remains unchanged. Use Recorded Test Analysis to import its saved CSV, verify flags, units, hose polarity, baseline, events and recovery; see RECORDED_TESTS.md. Its R1 BIM export remains an explicit window of at most 60 s. The main twin can now import aligned boundary observations over its longer run (under its existing 500 KB file limit). An export/reimport of the same simulated signal checks software consistency only, not prediction accuracy.

Each room has one pressure at an instant. Cells do not resolve spatial pressure or airflow around vents. Aggregate supply/exhaust and leakage assumptions require physical characterization. Modeled pressure difference alone does not establish biological exposure or safety. No automatic sponsor risk-matrix rating is produced. Raw instrument exports, confirmed source units and boundary IDs are needed before a sponsor-data comparison can be claimed.

The old 60 s A101 example remains available with the prior −1.78 / +2.61 / −1.65 Pa outputs at 0 / 30 / 60 s. Additional software tests do not establish chamber readiness, reference agreement or a live hardware-to-dashboard link.
