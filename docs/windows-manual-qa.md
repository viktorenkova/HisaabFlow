# Windows Manual QA Checklist

Use this checklist after the local stage-1 pipeline passes on the build machine.

## Preconditions

- Test on `Windows 10 x64` and `Windows 11 x64`.
- Prefer a clean user profile without preinstalled Python or Node.js.
- Use the latest generated installer: `frontend/dist/HisaabFlow Setup 1.1.2.exe`.
- Keep the generated reports from the build machine:
  - `.release-gate/windows-installer-gate-report.json`
  - `.release-gate/windows-release-installed-report.json`

## Install And First Launch

1. Run `HisaabFlow Setup 1.1.2.exe`.
2. Confirm the installer completes without manual environment fixes.
3. Launch `HisaabFlow`.
4. Confirm the app window opens and the backend becomes available.
5. If startup fails, collect logs from `%USERPROFILE%\HisaabFlow\logs`.

## Functional Smoke

Run the same flow with at least one CSV for each of these banks:

- Wise
- Revolut
- Meezan
- NayaPay
- Erste
- Unknown bank flow

For each sample, verify:

1. Upload works.
2. Preview loads.
3. Parse succeeds.
4. Transform succeeds.
5. CSV export succeeds.

Also verify:

1. Refund analyze/export flow.
2. Multi-currency Wise behavior.
3. Transfer detection between accounts.

## Shutdown And Cleanup

1. Close the app normally.
2. Confirm no obvious backend process remains running.
3. Reopen the app once to confirm a clean second startup.
4. Uninstall the app.
5. Confirm the install directory is removed or left only with expected user data.

## Pass Criteria

- Installer works without manual dependency installation.
- First launch succeeds.
- Upload, preview, parse, transform, export, and refund flow succeed.
- No stuck backend process remains after closing the app.
- Uninstall succeeds cleanly.

## Record For Each Machine

- Windows version and build number
- Installer filename
- Result: `pass` or `fail`
- If failed: short symptom summary
- Log path
- Whether issue reproduces on second launch
