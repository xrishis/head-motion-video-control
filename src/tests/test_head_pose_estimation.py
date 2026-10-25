import unittest
import cv2
from video_control.head_pose_estimation import HeadPoseEstimator

class TestHeadPoseEstimator(unittest.TestCase):
    def test_estimate(self):
        estimator = HeadPoseEstimator(30)
        camera = cv2.VideoCapture(0)
        ret, frame = camera.read()
        head_position = estimator.estimate(frame)
        self.assertIn(head_position, ["left", "right", "center"])
        camera.release()

if __name__ == "__main__":
    unittest.main()
