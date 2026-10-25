import cv2

class VideoCapture:
    def __init__(self, device_index):
        self.cap = cv2.VideoCapture(device_index)
    
    def get_frame(self):
        ret, frame = self.cap.read()
        if not ret:
            return None
        return frame
    
    def display_frame(self, frame):
        cv2.imshow("Webcam", frame)
    
    def is_exit_key_pressed(self):
        return cv2.waitKey(1) & 0xFF == ord('q')
    
    def release(self):
        self.cap.release()
        cv2.destroyAllWindows()
