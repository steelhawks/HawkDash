# HawkDash

A web dashboard for analyzing AdvantageKit `.wpilog` files from FRC team SteelHawks' `Rebuilt2026` robot.

Drop a `.wpilog` into the page and HawkDash parses it locally in your browser — no upload, no server. It then renders charts and tables for:

- **Overview** — match metadata, alliance, enabled time, robot mode timeline
- **Power** — battery voltage / current / power, PDH per-channel currents, per-device current draw, energy usage
- **Vision** — camera connection status, accepted / rejected pose counts, tag tracking
- **Shooter** — flywheel velocity vs. target, hood angle, turret angle, "ready to shoot" / "at goal" timeline, SOTM ballistics
- **Intake / Indexer** — rack positions, currents, beam break, stall / jam flags
- **Swerve** — module velocities, drive currents, gyro acceleration, chassis speeds, collision detection
- **Alerts** — error, warning, and info timelines from the AdvantageKit `Alert` system
- **System** — CPU temp, RAM usage, CAN utilization, loop overrun count
- **Timing** — per-subsystem loop times from `LoopTimeUtil`

## Running locally

It's a pure static site — no build step.

```sh
# from the repo root
python3 -m http.server 8000
# then open http://localhost:8000
```

Or open `index.html` directly in a browser (some browsers restrict ES module loading from `file://`, in which case use the local server).

## Deploying

Any static host works. For GitHub Pages, push `main` and enable Pages on the repo root.

## Implementation notes

- WPILOG parser: pure JS, implements the WPILib datalog v1.0 spec (header, control records, typed payloads). Decodes scalar primitives, arrays, JSON, and the common AdvantageKit struct types (`Pose2d`, `Translation2d`, `ChassisSpeeds`, `SwerveModuleState`).
- Charts: [uPlot](https://github.com/leeoniya/uPlot) via CDN (small, fast time-series).
- All parsing happens on the main thread for now; large logs (>50 MB) may take a few seconds to index.

## What gets read

The dashboard knows the log keys produced by the `Rebuilt2026` robot. See `js/keys.js` for the canonical list — it covers `/RealOutputs/...`, the per-subsystem `processInputs` prefixes (Vision, Swerve, Flywheel, Hood, Turret, Intake, Indexer, Beam), the `Alert` arrays, and the auto-logged `/SystemStats`, `/PowerDistribution`, `/DriverStation`, `/Timing` keys produced by `LoggedRobot`.
