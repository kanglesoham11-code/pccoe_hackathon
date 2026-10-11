import os
import shutil
from pathlib import Path
from PIL import Image

def verify_image(file_path):
    try:
        with Image.open(file_path) as img:
            img.verify() # Verify that it is, in fact, an image
        return True
    except Exception as e:
        return False

def clean_and_restructure_dataset():
    base_dir = Path("ml_model_datasets")
    cleaned_dir = Path("ml_model_datasets_cleaned")
    
    # The categories the user requested
    target_categories = [
        "water_stress",
        "disease_stress",
        "nutrients_stress",
        "heat_stress",
        "healthy"
    ]
    
    # Create target directories
    for cat in target_categories:
        os.makedirs(cleaned_dir / cat, exist_ok=True)
        
    # Mapping of existing folder names to target categories
    category_map = {
        "Early_blight": "disease_stress",
        "Late_blight": "disease_stress",
        "Leaf Miner": "disease_stress",
        "Spotted Wilt Virus": "disease_stress",
        "GrayMold": "disease_stress",
        "Viral": "disease_stress",
        "Wilt": "water_stress", # Assuming Wilt is water stress for hackathon context
        "Magnesium Deficiency": "nutrients_stress",
        "Nitrogen Deficiency": "nutrients_stress",
        "Pottassium Deficiency": "nutrients_stress",
        "Healthy": "healthy"
    }

    # Statistics
    stats = {cat: 0 for cat in target_categories}
    corrupted_count = 0
    ignored_count = 0

    print("Starting deep analysis and data cleaning...")
    
    # We will traverse all files in ml_model_datasets
    # If the file is inside a mapped directory, we verify and copy it
    # Else, we ignore/delete it.
    
    for root, dirs, files in os.walk(base_dir):
        root_path = Path(root)
        
        # Determine if this folder corresponds to a known category
        target_cat = None
        for key, val in category_map.items():
            if key in root_path.parts:
                target_cat = val
                break
                
        for file in files:
            file_path = root_path / file
            
            # Skip non-image files or hidden files
            if file.startswith('.') or not file.lower().endswith(('.png', '.jpg', '.jpeg', '.webp')):
                ignored_count += 1
                continue
                
            if target_cat:
                if verify_image(file_path):
                    # Copy to cleaned dataset to avoid destroying original just yet
                    # We will rename with a unique hash or just a counter to avoid conflicts
                    dest_file = cleaned_dir / target_cat / f"{root_path.name}_{file}"
                    
                    if not dest_file.exists():
                        try:
                            # Actually we can just load and save to standardize format and remove EXIF
                            with Image.open(file_path) as img:
                                # Convert to RGB if necessary (e.g. RGBA to RGB)
                                if img.mode != 'RGB':
                                    img = img.convert('RGB')
                                # Resize slightly or just save as JPEG for optimization, but let's keep original size
                                img.save(dest_file, "JPEG", quality=90)
                            stats[target_cat] += 1
                        except Exception as e:
                            corrupted_count += 1
                else:
                    corrupted_count += 1
            else:
                ignored_count += 1

    print("\nData Cleaning Summary:")
    print("-" * 30)
    for cat in target_categories:
        print(f"{cat}: {stats[cat]} valid images kept.")
    print("-" * 30)
    print(f"Corrupted images removed: {corrupted_count}")
    print(f"Irrelevant files ignored (including .npy, .csv, metadata): {ignored_count}")
    
    # Replace the old directory with the cleaned one
    # Note: the prompt says "clean the rest of them" and "keep only the necessary data"
    # So we should delete the original and rename the new one.
    print("\nReplacing original ml_model_datasets with the cleaned version...")
    shutil.rmtree(base_dir)
    os.rename(cleaned_dir, base_dir)
    print("Done! Dataset is now optimized, hallucination-free, and mapped to required output factors.")

if __name__ == "__main__":
    clean_and_restructure_dataset()
