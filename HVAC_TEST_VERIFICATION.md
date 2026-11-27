# Main-twin HVAC workflow — verification

Date: November 27, 2026. Base: d5ee93d57f818c0fb60a7fb14bda9ff0e5b2a02b.

## Automated checks

`npm test`: 36 passed, 0 failed (22 prior recorded-analysis tests plus 14 HVAC tests). JavaScript syntax checks and `git diff --check` passed.

HVAC checks include frozen baseline inputs, valid design bands and review requirements; analytic instantaneous failure/restoration pressures; delayed versus simultaneous actions; independent two-room exhaust loss; sustained loss without implicit restoration; continuous exponential command ramps; invalid timing/roles/IDs; unchanged input configurations and mass balance; extended and fractional run horizons; pressure-difference boundary arithmetic and hand-calculated 5/3 s crossing duration; stale baseline rejection; synthetic labeling and escaped HTML.

## Observed browser workflow

- Public Duplex imported (236 represented objects, 21 spaces including roof), with 20 modeled pressure zones and 9 internal links.
- Sequenced run without a reviewed baseline blocked. Baseline captured with normal modeled pressure and entered design band, explicitly not calibration.
- All four patterns ran, including independent second-room selection and no restoration for the sustained case.
- Full 180 s playback and 3D room cells retained building context. Selected A101-to-A104 chart identified the enabled internal connection; 3D cells retained room-to-reference pressure.
- The 3 s and 10 s shutdown-lag cases reproduced the comparison in HVAC_TESTS.md (1.28 versus 5.70 Pa peak; 0.00 versus 7.17 s above the illustrative +2.5 Pa threshold).
- Full 180 s boundary CSV downloaded and reimported: 361 matched samples, 0 unmatched. Zero MAE/RMSE is a self-roundtrip consistency check, not predictive validation.
- A flow edit invalidated the baseline, cleared stale results and disabled exports. A sequence was blocked until baseline recapture. Displayed inputs were synchronized before capture/run.
- HTML summary and JSON evidence downloaded and read back. JSON retained SYNTHETIC source, reviewed baseline, 361 boundary samples and the delayed supply event schedule.
- Legacy 70% A101 exhaust scenario with 60 s horizon retained the prior endpoint pressure of approximately −1.65 Pa; automated regression also retained all three original demonstration values.

The R1 recorded-analysis browser checks remain in RECORDED_TEST_VERIFICATION.md as a historical release record.

## Not established

No physical chamber run, sensor calibration, reference-instrument agreement, live serial acquisition, raw sponsor instrument import or biological-risk assessment was performed. Default geometry and flows remain public/synthetic. The command ramp is an assumption, and the solver remains a lumped equilibrium network evaluated over time.
