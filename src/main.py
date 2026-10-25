from video_control.camera import VideoCapture
from video_control.head_pose_estimation import HeadPoseEstimator
from video_control.video_controller import VideoController
from utils.config import load_config
from utils.logger import get_logger

def main():
    config = load_config("src/config.yaml")
    logger = get_logger("head_motion_video_control")
    
    camera = VideoCapture(config["camera"]["device_index"])
    pose_estimator = HeadPoseEstimator(config["pose_estimation"]["angle_threshold"])
    video_controller = VideoController(config["video_control"]["pause_key"], config["video_control"]["play_key"])
    
    logger.info("Starting head motion detection and video control.")
    
    while True:
        frame = camera.get_frame()
        if frame is None:
            continue
        
        head_position = pose_estimator.estimate(frame)      
        video_controller.control_video(head_position)
        
        # Display the webcam feed (optional, for debugging)
        camera.display_frame(frame)

        if camera.is_exit_key_pressed():
            break

    camera.release()
    logger.info("Shutting down.")

if __name__ == "__main__":
    main()
