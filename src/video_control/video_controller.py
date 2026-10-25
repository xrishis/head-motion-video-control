import pyautogui  # Import the pyautogui library, which allows for programmatic control of the mouse and keyboard.

class VideoController:  # Define a class called VideoController.
    def __init__(self, pause_key, play_key):  # Initialize the VideoController class with two parameters: pause_key and play_key.
        self.pause_key = pause_key  # Set the pause_key attribute to the pause_key parameter.
        self.play_key = play_key  # Set the play_key attribute to the play_key parameter.
        self.is_paused = False  # Initialize a flag to track whether the video is paused or not.

    def control_video(self, head_position):  # Define a method called control_video that takes one parameter: head_position.
        if head_position in ["left", "right"] and not self.is_paused:  # Check if the head position is either "left" or "right" and the video is not paused.
            pyautogui.press(self.pause_key)  # If the condition is true, press the pause key using pyautogui.
            self.is_paused = True  # Set the is_paused flag to True.
        elif head_position == "center" and self.is_paused:  # Check if the head position is "center" and the video is paused.
            pyautogui.press(self.play_key)  # If the condition is true, press the play key using pyautogui.
            self.is_paused = False  # Set the is_paused flag to False.