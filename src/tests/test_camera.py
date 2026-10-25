import unittest
from video_control.camera import VideoCapture

class TestVideoCapture(unittest.TestCase):
    def test_get_frame(self):
        camera = VideoCapture(0)
        frame = camera.get_frame()
        self.assertIsNotNone(frame)
        camera.release()

if __name__ == "__main__":
    unittest.main()
