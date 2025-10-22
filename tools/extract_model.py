"""
Extracts a .tflite model from a downloaded .tar.gz archive and places it
in the correct directory for the DaliTrail app.
"""

import argparse
import pathlib
import sys
import tarfile


def main() -> int:
    """Main function to find, extract, and place the model file."""
    parser = argparse.ArgumentParser(
        description="Extracts a .tflite model from a .tar.gz archive."
    )
    parser.add_argument(
        "--archive-path",
        type=pathlib.Path,
        default=pathlib.Path("assets/download/aiy-tflite-vision-classifier-plants-v1-v3.tar.gz"),
        help="Path to the downloaded .tar.gz model archive. Defaults to assets/download/...",
    )
    parser.add_argument(
        "--output-dir",
        type=pathlib.Path,
        default=pathlib.Path("assets/models"),
        help="Directory to save the extracted model file.",
    )
    parser.add_argument(
        "--output-filename",
        default="plants_V1.tflite",
        help="The final name for the extracted .tflite file.",
    )
    args = parser.parse_args()

    archive_path: pathlib.Path = args.archive_path
    output_dir: pathlib.Path = args.output_dir
    output_filename: str = args.output_filename

    if not archive_path.exists():
        print(f"Error: Archive not found at '{archive_path}'", file=sys.stderr)
        return 1

    print(f"Opening archive: {archive_path}")

    try:
        with tarfile.open(archive_path, "r:gz") as tar:
            # Find the first file in the archive that ends with .tflite
            member_to_extract = next(
                (m for m in tar.getmembers() if m.name.endswith(".tflite") and m.isfile()), None
            )

            if not member_to_extract:
                print(f"Error: Could not find a .tflite file in the archive.", file=sys.stderr)
                print(f"Archive contents: {[m.name for m in tar.getmembers()]}", file=sys.stderr)
                return 1

            print(f"Found model file in archive: '{member_to_extract.name}'")
            output_dir.mkdir(parents=True, exist_ok=True)
            output_path = output_dir / output_filename

            with tar.extractfile(member_to_extract) as source, open(output_path, "wb") as dest:
                dest.write(source.read())

            print(f"Successfully extracted and saved model to: {output_path}")
            return 0
    except (tarfile.ReadError, FileNotFoundError, Exception) as e:
        print(f"An error occurred during extraction: {e}", file=sys.stderr)
        return 1

if __name__ == "__main__":
    raise SystemExit(main())