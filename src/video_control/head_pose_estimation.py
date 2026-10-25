import cv2
import mediapipe as mp
import numpy as np

class HeadPoseEstimator:
    def __init__(self, angle_threshold):
        self.angle_threshold = angle_threshold
        self.face_mesh = mp.solutions.face_mesh.FaceMesh(refine_landmarks=True)
    
    def estimate(self, frame):
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        results = self.face_mesh.process(rgb_frame)
        if not results.multi_face_landmarks:
            return "center"
        
        landmarks = results.multi_face_landmarks[0].landmark
        left_eye = np.array([landmarks[33].x, landmarks[33].y])
        right_eye = np.array([landmarks[263].x, landmarks[263].y])
        nose_tip = np.array([landmarks[1].x, landmarks[1].y])

        eye_line = right_eye - left_eye
        eye_to_nose = nose_tip - (left_eye + right_eye) / 2

        angle = np.arctan2(eye_to_nose[1], eye_to_nose[0]) * 180 / np.pi
        
        if angle > self.angle_threshold:
            return "left"
        elif angle < -self.angle_threshold:
            return "right"
        else:
            return "center"
