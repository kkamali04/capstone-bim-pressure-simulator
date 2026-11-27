# BIM Pressure Simulator

University of Maryland Cyber-Physical Systems Engineering capstone. This browser demo imports IFC building models and overlays room-level pressure results as 3D voxels. The simulated pressure is uniform within each room at a given time.

## Try the demo
[Open the BIM Pressure Simulator](https://kkamali04.github.io/capstone-bim-pressure-simulator/), select Public research: Duplex Architecture (residential), then open Pressure simulation. Load the synthetic example to select A101. Choose Exhaust degradation at 70%, start at 10 s, recovery at 45 s. Review the inputs, run the scenario, then scrub the timeline. Use Cut height to see the voxel layers inside the building.

At 0, 30, and 60 seconds, the example predicts −1.78, +2.61, and −1.65 Pa. These are simulated room-to-reference pressures. The recording bundled for comparison is synthetic.

## Run locally
Run `npm run dev` and open the URL printed by the server. IFC files are parsed in the browser. Choose a bundled example or select **Open BIM** to use an IFC file.

## Baseline and HVAC test sequences (November 27, 2026)

The main 3D workspace now captures normal modeled operation and design intent before a sequenced test. It supports delayed supply shutdown after exhaust loss, simultaneous supply/exhaust loss, exhaust loss in two rooms, and sustained exhaust loss. Runs extend to 600 seconds with explicit assumed flow ramps and restoration timing.

Select a room-to-reference or room-to-room pressure pair for the chart, peak and time-above-threshold review. The 3D cells continue to show each room's pressure relative to the fixed reference. Download a self-contained test summary, boundary CSV and JSON evidence. Editing normal flow inputs invalidates the reviewed baseline and old results.

Follow [the HVAC test walkthrough](HVAC_TESTS.md) for a reproducible demonstration and interpretation limits. These are synthetic aggregate-flow scenarios informed by the sponsor's testing workflow; they do not recreate a facility or establish biological risk. [Verification](HVAC_TEST_VERIFICATION.md) records the checks performed.

## Companion project
[Open the Rover Scan Planner](https://kkamali04.github.io/capstone-rover-scan-planner/) to explore 12 floor stations at three probe heights.

## Credits
The buildingSMART International Duplex Apartment Test Files are CC BY 4.0. The raw IFC files are redistributed as supplied. The converted JSON versions normalize geometry and extract metadata for the demo. The pressure recording is synthetic and separate from the original sample.

- [Duplex_A_20110907.ifc](https://media.githubusercontent.com/media/buildingsmart-community/Community-Sample-Test-Files/0eedca9e15bd7a551a8ba548fa285bfb01433281/IFC%202.3.0.1%20%28IFC%202x3%29/Duplex%20Apartment/Duplex_A_20110907.ifc) — BSI (2020) Duplex Apartment Test Files, buildingSMART International, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Duplex_M_20111024_ROOMS_AND_SPACES.ifc](https://media.githubusercontent.com/media/buildingsmart-community/Community-Sample-Test-Files/0eedca9e15bd7a551a8ba548fa285bfb01433281/IFC%202.3.0.1%20%28IFC%202x3%29/Duplex%20Apartment/Duplex_M_20111024_ROOMS_AND_SPACES.ifc) — BSI (2020) Duplex Apartment Test Files, buildingSMART International, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Third-party libraries retain their included license files under vendor/. The [Rover Scan Planner repository](https://github.com/kkamali04/capstone-rover-scan-planner) contains the companion app source and release history.

## Recorded Test Analysis (November 26, 2026)

Open [Recorded Test Analysis](https://kkamali04.github.io/capstone-bim-pressure-simulator/recordings.html) from the building workspace. It reads the existing Arduino CSV, analyzes recorded pressure independently of the solver, plays the full recording and exports a printable HTML report, JSON evidence and a declared 60-second BIM comparison window. All processing stays in the browser tab; no recordings are uploaded.

Start with a labeled synthetic example, then review the channel, pressure endpoints, provenance, baseline, events, threshold and recovery criterion. Follow [the recorded-test guide](RECORDED_TESTS.md) for data formats, methods, limitations and verification. Original firmware is unchanged. Run checks with `npm test` (Node 18+).
