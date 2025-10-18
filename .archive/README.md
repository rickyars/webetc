# Archive - Development Debugging Scripts

This folder contains old debugging and testing scripts used during development. They are **not needed** for the project anymore since:

1. All test functionality is now integrated into `src/` and the UI
2. All debugging has been completed
3. The main project uses proper TypeScript sources in `src/`

## Files

- `check-byte-order.js` - Old byte ordering debug (issue already fixed)
- `debug-keccak.js` - Old Keccak implementation debug
- `debug-keccak-detailed.js` - Detailed Keccak debug with step-by-step tracing
- `test-keccak512.js` - Standalone Keccak-512 test script
- `generate-reference-vectors.js` - Reference vector generation (can be revived if needed)

## If You Need Them

If you need to reference or re-run any of these:
1. They can still be run with `node script-name.js` if needed
2. Copy them back to the root directory if necessary
3. Consider moving them to `scripts/` folder for organization instead

## To Delete Permanently

```bash
rm -rf .archive
```

The project doesn't need these files; the build and tests work perfectly without them.
