# BIM Pressure Simulator

University of Maryland Cyber-Physical Systems Engineering capstone. This browser demo imports IFC building models and overlays room-level pressure results as 3D voxels. The simulated pressure is uniform within each room at a given time.

## Try the demo
[Open the BIM Pressure Simulator](https://kkamali04.github.io/capstone-bim-pressure-simulator/), select Public research: Duplex Architecture (residential), then open Pressure simulation. Load the synthetic example to select A101. Choose Exhaust degradation at 70%, start at 10 s, recovery at 45 s. Review the inputs, run the scenario, then scrub the timeline. Use Cut height to see the voxel layers inside the building.

At 0, 30, and 60 seconds, the example predicts −1.78, +2.61, and −1.65 Pa. These are simulated room-to-reference pressures. The recording bundled for comparison is synthetic.

## Run locally
Serve the repository root over HTTP, for example with `python -m http.server 8000`, and open `http://localhost:8000/`. IFC files are parsed in the browser. Choose a bundled example or select **Open BIM** to use an IFC file.

## Companion project
[Open the Rover Scan Planner](https://kkamali04.github.io/capstone-rover-scan-planner/) to explore 12 floor stations at three probe heights.

## Credits
The buildingSMART International Duplex Apartment Test Files are CC BY 4.0. The raw IFC files are redistributed as supplied. The converted JSON versions normalize geometry and extract metadata for the demo. The pressure recording is synthetic and separate from the original sample.

- [Duplex_A_20110907.ifc](https://media.githubusercontent.com/media/buildingsmart-community/Community-Sample-Test-Files/0eedca9e15bd7a551a8ba548fa285bfb01433281/IFC%202.3.0.1%20%28IFC%202x3%29/Duplex%20Apartment/Duplex_A_20110907.ifc) — BSI (2020) Duplex Apartment Test Files, buildingSMART International, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
- [Duplex_M_20111024_ROOMS_AND_SPACES.ifc](https://media.githubusercontent.com/media/buildingsmart-community/Community-Sample-Test-Files/0eedca9e15bd7a551a8ba548fa285bfb01433281/IFC%202.3.0.1%20%28IFC%202x3%29/Duplex%20Apartment/Duplex_M_20111024_ROOMS_AND_SPACES.ifc) — BSI (2020) Duplex Apartment Test Files, buildingSMART International, [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

Third-party libraries retain their included license files under vendor/. The [Rover Scan Planner repository](https://github.com/kkamali04/capstone-rover-scan-planner) contains the companion app source and release history.
