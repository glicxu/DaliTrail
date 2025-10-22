"""
Downloads and places the machine learning models required by the DaliTrail app.

This script automates the setup of the TensorFlow Lite models for features
like plant identification.
"""

import pathlib
import urllib.request
import tarfile
import io
import os

# Define the base directory of the project (assuming this script is in tools/)
BASE_DIR = pathlib.Path(__file__).parent.parent.resolve()
MODELS_DIR = BASE_DIR / "assets" / "models"

# --- Model Definitions ---
# Each entry defines a model, its target directory, and the files to download.
MODELS_TO_DOWNLOAD = [
    {
        "name": "Plant Classifier (AIY Vision)",
        "target_dir": MODELS_DIR / "plant_classifier",
        "files": [
            {
                "type": "archive",
                "url": "https://tfhub.dev/google/lite-model/aiy/vision/classifier/plants_V1/3?tf-hub-format=compressed",
                "archive_path": ".tflite",
                "filename": "plants_V1.tflite"
            },
            {
                "url": "https://www.gstatic.com/aihub/tfhub/labelmaps/aiy_plants_V1_labelmap.csv",
                "filename": "plant_labels.csv"
            },
        ],
    },
    # You can add other models here in the future (e.g., for rock classification)
]

def download_file_with_progress(url: str, dest: pathlib.Path):
    """Downloads a file from a URL to a destination path, using a browser-like user-agent."""
    # Create a request with a browser user-agent and referer to avoid 403 Forbidden errors
    headers = {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Referer': 'https://tfhub.dev/'
    }
    req = urllib.request.Request(url, headers=headers)
    print(f"  Downloading {dest.name} from {url}...")
    with urllib.request.urlopen(req) as response, open(dest, 'wb') as out_file:
        try:
            total_size_str = response.getheader('Content-Length')
            total_size = int(total_size_str) if total_size_str else None
            downloaded_size = 0
            chunk_size = 8192

            while True:
                chunk = response.read(chunk_size)
                if not chunk:
                    break
                out_file.write(chunk)
                downloaded_size += len(chunk)
                if total_size:
                    progress = (downloaded_size / total_size) * 100
                    print(f"\r    ... {progress:.1f}%", end="")

            print(f"\n  ✔ Download complete: {dest}")
        except Exception as e:
            print(f"\n  ❌ FAILED to download {dest.name}: {e}")
            # Clean up partial file if download fails
            if dest.exists():
                dest.unlink()

def download_and_extract_archive(file_info: dict, target_dir: pathlib.Path) -> None:
    """Downloads a tar.gz archive and extracts a specific file from it."""
    url = file_info["url"]
    final_filename = file_info["filename"]
    member_suffix = file_info.get("archive_path", final_filename)
    
    print(f"  Downloading archive for {final_filename} from {url}...")
    try:
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
            'Referer': 'https://tfhub.dev/'
        }
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as response:
            content = response.read()

        print(f"  Extracting file ending with '{member_suffix}' from archive...")
        with tarfile.open(fileobj=io.BytesIO(content), mode="r:gz") as tar:
            archive_members = [m.name for m in tar.getmembers()]
            print(f"  Archive contents: {archive_members}")

            # Find the first member that is a file and ends with the desired suffix (e.g., ".tflite")
            member_to_extract = next((m for m in tar.getmembers() if m.name.endswith(member_suffix) and m.isfile()), None)
            
            if not member_to_extract:
                raise FileNotFoundError(f"A file ending with '{member_suffix}' was not found in the archive. Available files: {archive_members}")

            extracted_file = tar.extractfile(member_to_extract)
            if extracted_file:
                (target_dir / final_filename).write_bytes(extracted_file.read())
                print(f"  ✔ Extracted and saved: {final_filename}")
    except Exception as e:
        print(f"\n  ❌ FAILED to process archive for {final_filename}: {e}")

def main():
    """Main function to process and download all defined models."""
    print("--- Starting Model Download Script ---")

    for model_info in MODELS_TO_DOWNLOAD:
        name = model_info["name"]
        target_dir = model_info["target_dir"]
        files = model_info["files"]

        print(f"\nProcessing model: {name}")
        print(f"Target directory: {target_dir}")

        # Create the target directory if it doesn't exist
        target_dir.mkdir(parents=True, exist_ok=True)

        for file_info in files:
            dest_path = target_dir / file_info["filename"]
            if dest_path.exists():
                print(f"  ✔ Skipping {dest_path.name} (already exists).")
            else:
                if file_info.get("type") == "archive":
                    download_and_extract_archive(file_info, target_dir)
                else:
                    download_file_with_progress(file_info["url"], dest_path)

    print("\n--- Model download script finished. ---")

if __name__ == "__main__":
    main()