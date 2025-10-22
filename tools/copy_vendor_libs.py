"""
Copies required JavaScript libraries from node_modules to the assets/js/vendor directory.

This script should be run after `npm install` to ensure the frontend has
local copies of its dependencies, making the app self-contained and removing
the need to rely on external CDNs.
"""

import pathlib
import shutil
import sys

# Define the base directory of the project (assuming this script is in tools/)
BASE_DIR = pathlib.Path(__file__).parent.parent.resolve()
NODE_MODULES_DIR = BASE_DIR / "node_modules"
VENDOR_DIR = BASE_DIR / "assets" / "js" / "vendor"

LIBS_TO_COPY = [
    {
        "name": "TensorFlow.js TFLite Vision",
        "source": NODE_MODULES_DIR / "@mediapipe" / "tasks-vision" / "vision_bundle.mjs",
        "dest": VENDOR_DIR / "tasks.min.js",
    },
    {
        "name": "MediaPipe Vision WASM",
        "source": NODE_MODULES_DIR / "@mediapipe" / "tasks-vision" / "wasm" / "vision_wasm_internal.wasm",
        "dest": VENDOR_DIR / "vision_wasm_internal.wasm",
    },
    {
        "name": "MediaPipe Vision WASM JS",
        "source": NODE_MODULES_DIR / "@mediapipe" / "tasks-vision" / "wasm" / "vision_wasm_internal.js",
        "dest": VENDOR_DIR / "vision_wasm_internal.js",
    },
]

def main() -> int:
    """Main function to find and copy the libraries."""
    print("--- Copying vendor libraries from node_modules ---")

    if not NODE_MODULES_DIR.exists():
        print(f"❌ Error: `node_modules` directory not found. Did you run `npm install`?", file=sys.stderr)
        return 1

    VENDOR_DIR.mkdir(parents=True, exist_ok=True)
    error_count = 0

    for lib in LIBS_TO_COPY:
        print(f"\nProcessing: {lib['name']}")
        source_path: pathlib.Path = lib["source"]
        dest_path: pathlib.Path = lib["dest"]

        if not source_path.exists():
            print(f"  ❌ Source file not found: {source_path}")
            print(f"     Please ensure the required npm packages are installed.")
            # Check if the package directory itself is missing, which is a strong
            # hint that `npm install` was run in the wrong directory.
            package_dir = source_path.parent.parent.parent
            if not package_dir.exists():
                print(f"     The package directory '{package_dir.name}' was not found in `node_modules`.")
                print(f"     Make sure you run `npm install` from the project root: {BASE_DIR}")
            error_count += 1
            continue

        try:
            shutil.copy(source_path, dest_path)
            print(f"  ✔ Copied to: {dest_path}")
        except Exception as e:
            print(f"  ❌ FAILED to copy file: {e}")
            error_count += 1

    print("\n--- Finished copying libraries. ---")
    return 1 if error_count > 0 else 0

if __name__ == "__main__":
    raise SystemExit(main())