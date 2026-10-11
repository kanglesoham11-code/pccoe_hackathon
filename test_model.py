"""
Local CLI tester for the crop stress model.
Usage:  python test_model.py <path_to_image>
"""
import sys
import numpy as np
import tensorflow as tf
from tensorflow.keras.preprocessing import image

def load_and_predict(image_path):
    print("Loading model and classes...")
    model = tf.keras.models.load_model('crop_stress_model.keras')
    
    with open('class_names.txt', 'r') as f:
        class_names = [line.strip() for line in f.readlines()]
        
    print(f"Testing on image: {image_path}")
    
    # Must match training size: 224x224
    img = image.load_img(image_path, target_size=(224, 224))
    img_array = image.img_to_array(img)
    img_array = np.expand_dims(img_array, axis=0)
    # Do NOT preprocess — the model has preprocess_input baked in
    
    predictions = model.predict(img_array, verbose=0)
    probs = predictions[0]  # already softmax
    
    predicted_class = class_names[np.argmax(probs)]
    confidence = float(np.max(probs))
    
    print("\n--- Prediction Results ---")
    print(f"Predicted Factor : {predicted_class}")
    print(f"Confidence       : {confidence*100:.2f}%")
    
    if confidence < 0.35:
        print("!  WARNING: Low confidence — image may not be a recognizable crop leaf.")
    
    print("\nFull Breakdown:")
    ranked = sorted(zip(class_names, probs), key=lambda x: -x[1])
    for name, s in ranked:
        bar = '█' * int(s * 40)
        print(f"  {name:20s} {s*100:6.2f}%  {bar}")

if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python test_model.py <path_to_image>")
        sys.exit(1)
        
    load_and_predict(sys.argv[1])
