# Sure² PCI: BIM to digital twin

This release adds a source-aware building import and pressure-analysis pipeline to the original PCI prototype. It is a working research foundation, not a calibrated biosafety digital twin.

## Start in the browser
1. Open bim.html. Upload an IFC2x3/IFC4 file with room spaces, or use the bundled public Duplex model.
2. Orbit/zoom the 3D model; choose a floor and room. Room identity, geometry and volumes remain traceable to IFC GlobalIds.
3. Open Review network & inputs. Check door connections and assumed supply, exhaust and reference leakage. Disable inappropriate links. Unresolved one-sided doors are not automatically declared exterior.
4. Approve synthetic assumptions. Choose Exhaust degradation, a target room and severity. Run, then scrub or play the 60-second result.
5. Use Load synthetic sensor example for a deterministic end-to-end comparison. Export the run CSV. Import a sensor CSV to compare aligned values. The supplied example_sensor_SYNTHETIC.csv is a manufactured +0.1 Pa fixture for room A101 under the default 70% exhaust scenario; it is not real sensor data.
6. Open Validation evidence and Sources & pipeline.

## Online BIM data and attribution
BSI (2020), “Duplex Apartment Test Files,” buildingSMART International.
Source: https://github.com/buildingsmart-community/Community-Sample-Test-Files/tree/main/IFC%202.3.0.1%20(IFC%202x3)/Duplex%20Apartment
CC BY 4.0. Source README reproduced in samples/README.md. Community samples may not pass full IFC validation.

Downloaded unchanged:
- Duplex_A_20110907.ifc: architecture. 21 IfcSpaces, 14 doors, 265 space-boundary relationships. This converter produces 236 mesh objects and 9 two-ended semantic door candidates.
- Duplex_M_20111024_ROOMS_AND_SPACES.ifc: mechanical model. 37 IfcSpaces, 246 flow segments, 207 fittings, 22 energy-conversion devices, 8 flow controllers and 4 flow-moving devices. Its separate conversion produces 524 mesh objects. It has no door adjacency candidates in this importer. It is not automatically federated with the architectural model; matching coordinate systems and room identities needs review.

research/provenance.json records download URLs, upstream commit, byte lengths and SHA-256 hashes. Derivatives: triangulated meter-based display meshes, metadata and door-relationship extraction. Physics values are synthetic additions, not extracted design/operating data.

## Bring your own IFC
Install Python dependencies: `pip install -r requirements.txt`.
Run `python scripts/convert_ifc.py building.ifc building.pci.json`.
Use Upload BIM (.ifc / .json). Raw IFC can now be parsed directly in the browser, or converted offline; there is no server upload or native RVT parser. Request an IFC export from Revit/BIM authors.
Geometry is normalized to meters by IfcOpenShell. Do not multiply geometry by the original project length scale again. Original X/Y translation is recorded; Z stays vertical. In Three.js, IFC XYZ maps to X/Z/-Y for a Y-up renderer. Full GUIDs remain unchanged.

## Actual mathematics
Qij = Kij sign(Pi-Pj) sqrt(abs(Pi-Pj)), with Q in m³/s and P in Pa.
Each room satisfies Supply - Exhaust - reference leakage - sum(outgoing internal flows) = 0.
A damped Newton method solves the nonlinear network at each time sample. The fan change begins at 10 seconds with a 4-second first-order response. This is quasi-steady pressure with dynamic fan input, not compressible transient room CFD.
Defaults: supply = room volume/1000 m³/s (3.6 ACH), exhaust = supply + 0.012 m³/s; internal K = 0.006; reference K = 0.009 m³/s/√Pa. All are explicit synthetic assumptions, not requirements or measured properties.
Every included pressure node has an assumed reference leakage. BIM door connectivity is incomplete and does not define a complete room-airflow graph. Walls, cracks, stair exchanges and duct networks may need additional paths. Ceiling/roof void excluded from the default pressure network.

## Measurement comparison contract
Header: `time_s,space_id,pressure_pa`.
Time is nonnegative seconds relative to the model run start; space_id is the exact IFC GUID; pressure is room minus the same 0 Pa reference. Confirm time origin, sign and reference before interpretation. Unknown rooms, blanks, nonfinite values and duplicate timestamp/room pairs are rejected. No automatic calibration is performed. Samples within the 0–60 s run are compared to the nearest model sample within 0.25 s; unmatched readings are not included in MAE.
This is local browser-session processing. Refresh loses unsaved configuration and readings; export files to retain them. Import files are not sent to a server.

## Verification completed
- 18 import, data validation and numerical checks in bim-tests.mjs.
- A 19th check independently solves a nonuniform fault case with SciPy and compares pressures to the browser algorithm. These are two numerical implementations of the same equations; they are not a CONTAM benchmark or field validation.
- Legacy 11 numerical checks retained for the original five-room demonstration.
- Browser E2E results are recorded separately in research/browser-e2e.json.
Run `node bim-tests.mjs`, then `python scripts/crosscheck.py`. The second step appends the independent check to dist/bim-tests.json. Run legacy checks with `node tests.mjs`.

## How the complete PCI goal is approached
| Layer | Current evidence | Remaining work |
| --- | --- | --- |
| Geometry / room network | Real IFC import, GUIDs, door candidates, reviewed synthetic network | Actual facility BIM, complete reviewed connectivity |
| Heat loads / ventilation | Editable synthetic supply/exhaust and mesh-derived room volume | Room sheets, thermal calculations, measured operating points |
| Dynamic HVAC / reversals | Fan response, signed pressure, duration/peak metrics | Site control sequence, tubing dynamics, WBHT event definitions |
| CFD / Lagrangian transport | Module boundary and source geometry available | Mesh/BC setup, solver, convergence and tracer validation |
| Calibration / sensor fusion | CSV observations and residual/MAE comparison | Parameter fitting, instrument uncertainty, held-out validation |
| Diagnosis / next test | Original synthetic template demonstration remains available | BIM-linked fault models and independent diagnosis evaluation |
| Forecasting | Conditional synthetic scenarios | Validated prediction and calibrated uncertainty |

## Physical validation sequence
1. Agree intended use, reversal rules and acceptance criteria with WBHT.
2. Benchmark matched pressure networks with NIST CONTAM or another validated reference implementation. Not yet done.
3. Survey geometry and ventilation. Check independent instruments, zero/polarity, range, reference endpoints, tubing lag and time alignment.
4. Record baseline, approved event and recovery runs. Keep whole runs separate for calibration and evaluation.
5. Report pressure MAE/bias, reversal onset/peak/duration error, false alarms and repeatability, with uncertainty.
6. Validate CFD/particle claims separately with numerical convergence and suitable tracer observations. Pressure alone does not establish escaped contaminant quantity or identify a unique fault.

Primary references:
https://docs.ifcopenshell.org/ifcopenshell-python/geometry_processing.html
https://www.nist.gov/el/beed/nist-multizone-modeling/software/contam/contam-documentation
https://doi.org/10.6028/NIST.TN.1887r1

Historical v0.2 browser E2E: 11 checks passed for model loading, approval gate, fault reversal, scrubbing, playback, floor filtering, section controls, overlay visibility, known +0.1 Pa sensor comparison, invalid-input rejection and stale-result protection. The browser file-picker workflow stalled and is not verified; the parser and built-in sensor-fixture path were tested. The preview used the SVG compatibility renderer because WebGL was unavailable. Mobile layout and download-file completion were not verified.


## Direct IFC upload and anomaly scenarios (v0.3)
Use **Upload BIM (.ifc / .json)** to select an IFC file directly. Parsing runs in an isolated browser worker using the pinned web-ifc 0.0.77 distribution; no file is uploaded to a server. The Python converter remains available. Native RVT must be exported to IFC first. Browser limits: 30 MB, 100 pressure rooms, 2,000 objects and 600,000 triangles; the offline converter does not make large models suitable for this renderer automatically. Files must include IfcSpace geometry. Missing rooms give an actionable error; the app does not invent spaces from walls. Incomplete door connectivity still requires manual review and additional paths.

Seven scenarios: baseline, exhaust loss, excess supply, supply loss, increased reference leakage, door connection opening, and sensor bias. Fault severity and event/recovery times are configurable. Door opening modifies the first enabled connection adjacent to the selected room; no effect is expected if both endpoint pressures are identical. It represents net pressure-driven flow, not buoyant/two-way exchange. Sensor bias changes a separately labeled synthetic reading while leaving physical room pressure unchanged. Affected-room tables compare physical pressures to pre-event baseline; a connection inspector reports signed net airflow.

Each fault follows a first-order 4 s response and recovery; this time constant is an assumption. A room-network solve is repeated at 0.5 s intervals. Room pressure is quasi-steady, not compressible dynamic CFD. The reversal threshold is editable and has no implied WBHT approval. A fault need not produce a reversal. Results are invalidated when scenario inputs change.

**Volume correction:** earlier sample conversion used a raw signed triangle sum, which was wrong for two hallways with inconsistent triangle winding. Both converters now weld render vertices, check edge closure and orient each connected component before volume integration. A201/B201 architectural hallway volumes are approximately 18.115464 m³, matching BIM-declared values. Open/nonmanifold or inconsistent meshes receive explicitly labeled bounding-box estimates. Nested cavities and overlapping closed components still need enclosure review. Volume is editable in network setup; no mesh volume establishes surveyed room volume.

**Save/reopen:** Save project exports geometry, reviewed network and controls to one JSON file. Upload that JSON to restore; approval is always reset. Sensor observations and generated frames are not saved; reimport sensor readings and rerun. Export run CSV includes physical pressure, synthetic sensor value, supply and exhaust. Sensor import still expects exactly `time_s,space_id,pressure_pa`; a run CSV with extra columns is an output dataset, not a sensor import file.

Additional tests: `node upload-tests.mjs` verifies raw IFC2x3 parsing, an IFC4 millimeter-to-meter fixture, GUID/volume/dimension agreement, mesh quality, fault direction, mass residuals, door equalization, bias separation, recovery and saved-project equivalence. No numerical test demonstrates field accuracy. Independent CONTAM benchmarking, calibration and held-out real events remain pending.

Dependency source: https://github.com/ThatOpen/engine_web-ifc (MPL-2.0, license bundled). Source distribution is vendored unchanged. The 0.0.78 browser API/WASM combination produced a signature error in E2E testing; v0.3 pins 0.0.77.

Latest v0.3 browser verification: 15 grouped checks passed, including actual file-picker uploads for IFC2x3, IFC4 millimeter geometry, missing-room rejection, all scenarios, configured recovery, real CSV upload, project download/reimport, setup rejection/invalidation and CSV download completion. See research/browser-e2e-v03.json. WebGL and mobile device playback are still unverified. SHA-256 hashing is available in secure browser contexts; the HTTP preview explicitly reports when unavailable.

## v0.4 measurement/calibration workbench
The planned tabletop preset uses professor concept dimensions (not as-built geometry). All operating flows and leakages remain assumed. Default generic deficit settings are not a hardware specification; review and replace them for the bench rig.

Boundary CSV explicitly maps positive and negative endpoints and compares their difference against the same simulation time. REFERENCE denotes fixed zero. It reports unmatched records without extrapolation.

The calibration CSV workflow fits one global reference-leak multiplier from steady baseline observations. Known supply/exhaust and fixed internal connections are prerequisites. Calibration and holdout must be independent entire runs at the specified unchanged operating settings. File names alone cannot establish that independence. Identical file contents are rejected. Imported provenance is UNVERIFIED; no instrument calibration or physical prediction accuracy is asserted. The fitted candidate does not automatically alter model inputs. Export preserves model/config, source filenames, results and limitations. Model/scenario/config edits invalidate workbench evidence.

The explicit synthetic example injects scale1.6 and a separate +0.02Pa holdout offset. It verifies recovery of a known parameter, not generalization to real buildings. Only one scalar is estimated; no covariance, confidence interval, dynamics, fan faults or per-door leakage fitting is claimed.

Numerical robustness now includes an exact-flow-law bracketed nodal fallback when Newton stalls. Saved projects preserve selected fault-target GUID.

Verification commands: node tests.mjs; node bim-tests.mjs; python scripts/crosscheck.py; node upload-tests.mjs; node calibration-tests.mjs; node channels-tests.mjs; node solver-robustness-tests.mjs. Total69 numerical/integration checks. Seven additional workbench browser checks are in research/workbench-e2e.json. Earlier browser15 checks remain historical; current workbench tests supplement rather than imply a complete rerun on every device.
