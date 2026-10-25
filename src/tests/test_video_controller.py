import unittest
from video_control.video_controller import VideoController

class TestVideoController(unittest.TestCase):
    def test_control_video(self):
        controller = VideoController("space", "space")
        controller.control_video("left")
        self.assertTrue(controller.is_paused)
        controller.control_video("center")
        self.assertFalse(controller.is_paused)

if __name__ == "__main__":
    unittest.main()
