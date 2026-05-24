# Changelog

## v0.3.0

### Features

- auto fallback with degraded backend tracking
- TUI dashboard (real-time health, stats, logs)
- Web management UI at /web
- stats/health monitoring (cmr stats, cmr health)
- pipeline progress output, per-stage timeout, and Ctrl+C checkpoint/resume
- multi-input pipeline modes (interactive, --file, --stdin, args)
- setup guard prompts for setup if config missing

### Bug Fixes

- correct public/index.html path resolution in web route
- dashboard non-TTY guard
- pipeline SIGINT now aborts mid-stage via AbortSignal

### Documentation

- README v0.3.0 features section
- architecture diagram in README
- bilingual updates (EN/CN)

## v0.2.0

### Features

- pipeline engine for auto model dispatch
- multi-backend routing with modelPattern
- config validation and hot reload
- CLI daemon, setup and pipeline commands

### Bug Fixes

- empty PID file falsely detected as running
- strict plan-to-implementation pipeline discipline

### Documentation

- bilingual README (EN/CN)

## v0.1.0

- initial release
