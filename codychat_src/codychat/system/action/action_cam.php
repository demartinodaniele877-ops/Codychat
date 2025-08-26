<?php
require('../config_chat.php');

// Key helper for room cams
function cams_key($roomId){
	return 'cams:room:' . (int)$roomId;
}

// Check Redis helpers availability
function cams_has_redis(){
	return function_exists('redisGetObject') && function_exists('redisSetObject');
}

// MySQL fallback helpers (table boom_room_cams)
function cams_db_ensure(){
	global $mysqli;
	$mysqli->query("\n		CREATE TABLE IF NOT EXISTS `boom_room_cams` (\n			`room_id` INT NOT NULL,\n			`user_id` INT NOT NULL,\n			`updated_at` INT NOT NULL,\n			PRIMARY KEY (`room_id`,`user_id`),\n			KEY `updated_at` (`updated_at`)\n		) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4\n	");
}
function cams_db_cleanup(){
	global $mysqli;
	// Remove stale entries older than 2 hours
	$expire = time() - 7200;
	$mysqli->query("DELETE FROM `boom_room_cams` WHERE `updated_at` < {$expire}");
}
function cams_db_get($roomId){
	global $mysqli;
	$roomId = (int)$roomId;
	cams_db_ensure();
	cams_db_cleanup();
	$out = [];
	$res = $mysqli->query('SELECT user_id FROM boom_room_cams WHERE room_id = ' . $roomId);
	if($res && $res->num_rows){
		while($r = $res->fetch_assoc()){
			$out[] = (int)$r['user_id'];
		}
	}
	return array_values(array_unique($out));
}
function cams_db_set($roomId, $userId, $isOn){
	global $mysqli;
	$roomId = (int)$roomId; $userId = (int)$userId; $now = time();
	cams_db_ensure();
	if($isOn){
		$mysqli->query("REPLACE INTO boom_room_cams (room_id, user_id, updated_at) VALUES ({$roomId}, {$userId}, {$now})");
	}
	else {
		$mysqli->query("DELETE FROM boom_room_cams WHERE room_id = {$roomId} AND user_id = {$userId}");
	}
	return cams_db_get($roomId);
}

// Fetch current cams (prefers Redis, falls back to DB)
function get_room_cams($roomId){
	$roomId = (int)$roomId;
	if(cams_has_redis()){
		$cams = redisGetObject(cams_key($roomId));
		if($cams !== false && is_array($cams)){
			return array_values(array_unique(array_map('intval', $cams)));
		}
	}
	return cams_db_get($roomId);
}

// Set cam (prefers Redis, falls back to DB)
function set_room_cam($roomId, $userId, $isOn){
	$roomId = (int)$roomId; $userId = (int)$userId; $isOn = (bool)$isOn;
	if(cams_has_redis()){
		$current = get_room_cams($roomId);
		if($isOn){
			if(!in_array($userId, $current, true)) $current[] = $userId;
		}
		else {
			$current = array_values(array_filter($current, function($u) use ($userId){ return (int)$u !== $userId; }));
		}
		redisSetObject(cams_key($roomId), $current, 3600);
		return $current;
	}
	return cams_db_set($roomId, $userId, $isOn);
}

header('Content-Type: application/json; charset=utf-8');

// Start broadcasting webcam publicly in current room
if(isset($_POST['start_public_cam'])){
	if(empty($data) || empty($data['user_roomid'])){
		echo json_encode(['code' => 0, 'cams' => []]);
		die();
	}
	$cams = set_room_cam($data['user_roomid'], $data['user_id'], true);
	if(function_exists('redisUpdateRoom')){ redisUpdateRoom($data['user_roomid']); }
	if(function_exists('redisUpdateNotify')){ redisUpdateNotify($data['user_id']); }
	echo json_encode(['code' => 1, 'cams' => $cams]);
	die();
}

// Stop broadcasting
if(isset($_POST['stop_public_cam'])){
	if(empty($data) || empty($data['user_roomid'])){
		echo json_encode(['code' => 0, 'cams' => []]);
		die();
	}
	$cams = set_room_cam($data['user_roomid'], $data['user_id'], false);
	if(function_exists('redisUpdateRoom')){ redisUpdateRoom($data['user_roomid']); }
	if(function_exists('redisUpdateNotify')){ redisUpdateNotify($data['user_id']); }
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

echo json_encode(['code' => 0, 'cams' => []]);
?>
