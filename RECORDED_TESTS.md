# Sure² Recorded Test Analysis — R1
Released November 26, 2026. Software version: recorded-tests-1.0.0.

## Start
Open Recorded tests from the existing BIM building workspace, or open recordings.html on the same server. The analysis workspace is part of this repository and opens in a separate tab so the building view can remain open.

For a demonstration, choose "Brief reversal and recovery" under Synthetic software check. This loads an explicitly labeled software fixture, not WBHT facility data or chamber measurements.

The full 180-second example has:
- baseline mean −2 Pa, sample SD 0 Pa;
- sampled peak +4 Pa;
- 12.9167 seconds of observed pressure above the selected +2.5 Pa analysis threshold;
- recovery band entry 3.3333 seconds after restoration, confirmed after a further 5-second hold.

Synthetic data only verify software behavior. They do not establish physical accuracy, fan dynamics, predictive validation or containment certification.

## Working Arduino sketch
The importer matches the current Sure2_Sensor_Display.ino CSV header:
time_ms,dp_a_pa,dp_b_pa,sht_temp_c,sht_rh_pct,bmp_abs_pa,bmp_temp_c,dp_a_ok,dp_b_ok,sht_ok,bmp_ok

The firmware is unchanged. Open serial at 115200 baud and send c. Save the CSV output to a UTF-8 .csv or .txt file. Startup comments before the CSV header are accepted and preserved as notes. Capture must preserve columns; avoid adding a terminal's display timestamps or truncating rows. R1 used saved captures only. The R3 update adds optional browser USB capture; see CHAMBER_CAPTURE.md. Physical board verification remains pending.

DP A and B mean separate pressure devices, not the two pneumatic ports of one sensor. Select the installed channel. The *_ok flags determine validity: a failed value remains missing, never zero. A valid numeric zero remains zero. Blank/nonfinite pressure with a nominally valid flag is still excluded and counted.

time_ms is the sketch's sequential loop-start runtime. The importer subtracts the first acquisition in the file and converts milliseconds to elapsed seconds. It does not create a host UTC measurement timestamp. A reset or duplicate/backward timestamp rejects the recording; split resets into separate runs.

SHT45 ambient values are retained in sample metadata when sht_ok is 1. This workspace analyzes differential pressure; it does not calculate airflow or ACH from temperature/humidity/pressure.

## Analyze an actual recording
1. Upload the saved file; retain your original unchanged.
2. Choose the correct pressure device/boundary. For unmarked files, explicitly declare the provenance; it starts as imported/unverified.
3. Enter physical positive and negative endpoint IDs, such as CHAMBER and REFERENCE. Confirm hose polarity. An intentional sign inversion is saved in the evidence.
4. Select an observed stable baseline interval with at least two valid readings. End the baseline before any marked failure.
5. Enter failure and restoration times in seconds relative to the file origin, if known. Do not invent event times.
6. Choose the pressure analysis threshold, recovery tolerance and continuous hold. The default +2.5 Pa is an example analysis limit, not a universal acceptance rule.
7. Optionally set the maximum connected sample gap. The default is 1.5 times the median acquisition interval.
8. Select an explicit BIM comparison export window of at most 60 seconds.
9. Click Analyze recording; inspect quality warnings, metrics and event intervals.
10. Play or scrub the complete recording; change playback speed if useful.
11. Download the readable HTML report, full JSON evidence and BIM comparison window CSV. The report can be opened offline and printed. Print / Save PDF opens the browser's normal print flow.

Changes to analysis settings invalidate prior results and disable exports until reanalysis. Files/results stay in the current tab; keep exported files before closing it. No uploaded recording is transmitted to a server by this code.

## Generic and boundary CSV
Supported:
- time_s,pressure_pa
- time_s,pressure (verified units required)
- time_s,space_id,pressure_pa
- time_s,positive_space_id,negative_space_id,pressure_pa

time_ms may replace time_s. An optional valid column must contain 0 or 1. CSV supports UTF-8 BOM, quoted commas/newlines and CRLF. Repeated identical headers are counted and ignored; timestamps must remain monotonic per channel. Explicit endpoint or room columns must not be blank.

Pa is declared by a pressure_pa/Arduino *_pa header. A conflicting unit selection is blocked, not silently reinterpreted. A generic pressure column requires an explicit unit: Pa, kPa or conventional inH2O. Conversion uses 249.0889 Pa per conventional inH2O; confirm the originating instrument's convention. [NIST conversion reference](https://www.nist.gov/pml/special-publication-811/nist-guide-si-appendix-b-conversion-factors/nist-guide-si-appendix-b9).

Raw TEC export layouts are not claimed to be supported until the actual column schema is supplied and mapped. Do not transcribe a report table into a Pa header until ambiguous source units are resolved.

Limit: 5 MB text / approximately 100,000 CSV rows. Browser file input checks byte size. Analysis stays in-browser.

## Method
Baseline: arithmetic sample mean and sample standard deviation (n−1 denominator), not a calibrated offset correction. Raw pressures are never silently zero-adjusted.

Pressure peak: maximum valid sampled pressure; short peaks between samples can be missed.

Threshold episodes: pressure strictly above the selected limit. Crossings are linearly estimated between adjacent valid samples only. Invalid samples and intervals exceeding the maximum gap break continuity. Time in gaps is not counted. The table reports observed durations, not guaranteed true exposure.

Recovery: first observed continuous interval within baseline mean ± tolerance, after restoration, lasting the selected hold. Report both estimated in-band entry and confirmation time. "Not observed" can mean failure to recover, insufficient follow-up, or insufficient valid data. It is not proof of permanent non-recovery.

Failure/restoration are operator-entered event markers. Metrics cover the full recording and do not infer a causal equipment diagnosis.

The graph shows boundary differential pressure. It does not turn a room-to-room differential into an absolute room pressure, or create a spatial airflow field.

## BIM comparison
R1 originally used the existing 0–60 second simulator. The November 27 HVAC update extends the main simulator to 600 seconds and adds selected boundary charting; see HVAC_TESTS.md. The recorded-analysis R1 export remains an explicit window of at most 60 seconds. Full recording playback remains available in the analysis workspace.

The BIM CSV contains valid samples in the selected window, with window-start subtracted from their times. JSON evidence and readable report record the original elapsed window and time origin. Map the endpoints to actual model IDs and align scenario events to that window. Do not compress minutes into seconds. Repeatability or physical accuracy is not inferred from successful import.

The main simulator now charts imported points matching the selected pressure pair within the simulated duration. The recorded-analysis workspace displays any selected imported pressure boundary independently. Map endpoints consistently and keep the chosen time origin explicit.

## Exports and provenance
Readable HTML: self-contained chart, metrics, settings, quality notes, manual reviewer assessment and source fingerprint. Use the browser print flow to save a PDF.

Evidence JSON: full selected-channel samples (including flags, invalid values and available SHT45 metadata), source filename/SHA-256, normalization, device time origin, endpoint mapping, sign, baseline/event settings, quality and review. SHA-256 hashes the original uploaded file bytes. Its availability depends on browser Web Crypto; absence is explicit.

BIM CSV: valid normalized boundary samples in the declared export window. Flags, full duration and original times remain in JSON; no missing readings are filled with zeros.

Provenance is operator-declared for external files. Bundled fixtures and explicitly marked synthetic captures are fixed to SYNTHETIC and cannot be exported as measured data.

Initial and residual risk are manual reviewer fields, not automatic results. A residual rating requires an explanation. No WBHT risk-matrix classification or certification decision is computed. Facility boundary consequences and biological context remain expert-review inputs.

## Verification
Run npm test with Node 18 or later. No npm installation is needed.

The original 22 recorded-analysis tests cover numeric crossing/recovery calculations, flagged gaps, unit conversion, polarity, time resets, malformed rows, schema/mapping, boundary CSV roundtrip, provenance, HTML escaping, large files and the prior A101 model values. The integrated suite now also includes 14 HVAC tests (36 total).

Browser workflow checks are recorded in RECORDED_TEST_VERIFICATION.md. This release does not claim hardware-in-the-loop or WBHT raw-data validation.

