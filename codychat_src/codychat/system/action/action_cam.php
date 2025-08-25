<?php
require('../config_chat.php');

// Helpers for room cams stored in Redis
function cams_key($roomId){
	return 'cams:room:' . $roomId;
}

function get_room_cams($roomId){
	$cams = redisGetObject(cams_key($roomId));
	if($cams === false || !is_array($cams)){
		return [];
	}
	return array_values(array_unique(array_map('intval', $cams)));
}

function set_room_cam($roomId, $userId, $isOn){
	$cams = get_room_cams($roomId);
	$userId = (int)$userId;
	if($isOn){
		if(!in_array($userId, $cams, true)){
			$cams[] = $userId;
		}
	}
	else {
		$cams = array_values(array_filter($cams, function($u) use ($userId){ return (int)$u !== $userId; }));
	}
	// keep list for 1 hour; refreshed on each toggle
	redisSetObject(cams_key($roomId), $cams, 3600);
	return $cams;
}

header('Content-Type: application/json; charset=utf-8');

// Start broadcasting webcam publicly in current room
if(isset($_POST['start_public_cam'])){
	// minimal guard: must be logged and in a room
	if(empty($data) || empty($data['user_roomid'])){
		echo json_encode(['code' => 0]);
		die();
	}
	$cams = set_room_cam($data['user_roomid'], $data['user_id'], true);
	redisUpdateRoom($data['user_roomid']);
	redisUpdateNotify($data['user_id']);
	echo json_encode(['code' => 1, 'cams' => $cams]);
	die();
}

// Stop broadcasting
if(isset($_POST['stop_public_cam'])){
	if(empty($data) || empty($data['user_roomid'])){
		echo json_encode(['code' => 0]);
		die();
	}
	$cams = set_room_cam($data['user_roomid'], $data['user_id'], false);
	redisUpdateRoom($data['user_roomid']);
	redisUpdateNotify($data['user_id']);
	echo json_encode(['code' => 1, 'cams' => $cams]);
	die();
}

// List current cams for this room
if(isset($_POST['get_public_cams'])){
	if(empty($data) || empty($data['user_roomid'])){
		echo json_encode(['code' => 0, 'cams' => []]);
		die();
	}
	$cams = get_room_cams($data['user_roomid']);
	echo json_encode(['code' => 1, 'cams' => $cams]);
	die();
}

echo json_encode(['code' => 0]);
?>
