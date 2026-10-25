import yaml
import os

def load_config(file_path="C:\\Users\\Rishi Raj Nachiketa\\Desktop\\head_motion_video_contro\\src\\config.yaml"):
    """
    Loads a YAML configuration file from the specified file path.

    Args:
        file_path (str): The path to the YAML configuration file.

    Returns:
        dict: The loaded configuration as a dictionary.
    """
    try:
        with open(file_path, 'r') as file:
            config = yaml.safe_load(file)
            return config
    except FileNotFoundError:
        print(f"Error: The file '{file_path}' was not found.")
        return None
    except yaml.YAMLError as e:
        print(f"Error: Failed to parse YAML file '{file_path}': {e}")
        return None

# Removed the code that loads config on import to avoid loading from incorrect path

# The config should be loaded explicitly by passing the correct path to load_config function
