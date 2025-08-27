<?php
require('../config_chat.php');

// Simple WebRTC signaling + public cam state for CodyChat
// Storage strategy: Redis preferred, DB fallback (tables created on demand)

header('Content-Type: application/json; charset=utf-8');

function cams_key($roomId){ return 'cams:room:' . (int)$roomId; }
function has_redis(){ return function_exists('redisGetObject') && function_exists('redisSetObject'); }

// DB helpers
function db_ensure_tables(){
    global $mysqli;
    // public cams fallback
    $mysqli->query("CREATE TABLE IF NOT EXISTS `boom_room_cams` (
        `room_id` INT NOT NULL,
        `user_id` INT NOT NULL,
        `updated_at` INT NOT NULL,
        PRIMARY KEY (`room_id`,`user_id`),
        KEY `updated_at` (`updated_at`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
    // signaling
    $mysqli->query("CREATE TABLE IF NOT EXISTS `boom_webrtc_signals` (
        `id` BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        `room_id` INT NOT NULL,
        `producer_id` INT NOT NULL,
        `viewer_id` VARCHAR(64) NOT NULL,
        `role` ENUM('offer','answer','cand_v2p','cand_p2v') NOT NULL,
        `payload` MEDIUMTEXT NOT NULL,
        `created_at` INT NOT NULL,
        PRIMARY KEY(`id`),
        KEY `rp` (`room_id`,`producer_id`),
        KEY `vid` (`viewer_id`),
        KEY `role` (`role`),
        KEY `created_at` (`created_at`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4");
}

function cams_db_get($roomId){
    global $mysqli;
    db_ensure_tables();
    $out = [];
    $res = $mysqli->query('SELECT user_id FROM boom_room_cams WHERE room_id='.(int)$roomId);
    if($res && $res->num_rows){ while($r=$res->fetch_assoc()){ $out[]=(int)$r['user_id']; } }
    return array_values(array_unique($out));
}
function cams_db_set($roomId,$userId,$on){
    global $mysqli;
    db_ensure_tables();
    $roomId=(int)$roomId; $userId=(int)$userId; $now=time();
    if($on){ $mysqli->query("REPLACE INTO boom_room_cams(room_id,user_id,updated_at) VALUES($roomId,$userId,$now)"); }
    else { $mysqli->query("DELETE FROM boom_room_cams WHERE room_id=$roomId AND user_id=$userId"); }
    return cams_db_get($roomId);
}

function cams_get($roomId){
    if(has_redis()){
        $cams = redisGetObject(cams_key($roomId));
        if($cams !== false && is_array($cams)) return array_values(array_unique(array_map('intval',$cams)));
    }
    return cams_db_get($roomId);
}
function cams_set($roomId,$userId,$on){
    if(has_redis()){
        $cur = cams_get($roomId);
        $userId=(int)$userId;
        if($on){ if(!in_array($userId,$cur,true)) $cur[]=$userId; }
        else { $cur = array_values(array_filter($cur,function($u) use($userId){ return (int)$u!==$userId; })); }
        redisSetObject(cams_key($roomId), $cur, 3600);
        return $cur;
    }
    return cams_db_set($roomId,$userId,$on);
}

// signaling helpers
function sig_add($roomId,$producerId,$viewerId,$role,$payload){
    global $mysqli;
    db_ensure_tables();
    $roomId=(int)$roomId; $producerId=(int)$producerId; $viewerId=$mysqli->real_escape_string(substr($viewerId,0,64));
    $role=$mysqli->real_escape_string($role);
    $payload=$mysqli->real_escape_string($payload);
    $now=time();
    $mysqli->query("INSERT INTO boom_webrtc_signals(room_id,producer_id,viewer_id,role,payload,created_at) VALUES($roomId,$producerId,'$viewerId','$role','$payload',$now)");
}
function sig_fetch_for_producer($roomId,$producerId){
    global $mysqli;
    db_ensure_tables();
    $roomId=(int)$roomId; $producerId=(int)$producerId;
    $out=[];
    $q=$mysqli->query("SELECT id,viewer_id,role,payload FROM boom_webrtc_signals WHERE room_id=$roomId AND producer_id=$producerId AND role IN('offer','cand_v2p') ORDER BY id ASC LIMIT 100");
    if($q){ while($r=$q->fetch_assoc()){ $out[]=$r; } }
    // consume fetched
    if(!empty($out)){
        $ids = implode(',', array_map('intval', array_map(function($x){return $x['id'];}, $out)));
        $mysqli->query("DELETE FROM boom_webrtc_signals WHERE id IN($ids)");
    }
    return $out;
}
function sig_fetch_for_viewer($roomId,$producerId,$viewerId){
    global $mysqli;
    db_ensure_tables();
    $roomId=(int)$roomId; $producerId=(int)$producerId; $viewerId=$mysqli->real_escape_string(substr($viewerId,0,64));
    $out=[];
    $q=$mysqli->query("SELECT id,role,payload FROM boom_webrtc_signals WHERE room_id=$roomId AND producer_id=$producerId AND viewer_id='$viewerId' AND role IN('answer','cand_p2v') ORDER BY id ASC LIMIT 100");
    if($q){ while($r=$q->fetch_assoc()){ $out[]=$r; } }
    if(!empty($out)){
        $ids = implode(',', array_map('intval', array_map(function($x){return $x['id'];}, $out)));
        $mysqli->query("DELETE FROM boom_webrtc_signals WHERE id IN($ids)");
    }
    return $out;
}

// Routes
if(isset($_POST['start_cam'])){
    if(empty($data) || empty($data['user_roomid'])){ echo json_encode(['code'=>0]); exit; }
    $cams = cams_set($data['user_roomid'],$data['user_id'],true);
    echo json_encode(['code'=>1,'cams'=>$cams]); exit;
}
if(isset($_POST['stop_cam'])){
    if(empty($data) || empty($data['user_roomid'])){ echo json_encode(['code'=>0]); exit; }
    $cams = cams_set($data['user_roomid'],$data['user_id'],false);
    echo json_encode(['code'=>1,'cams'=>$cams]); exit;
}
if(isset($_POST['list_cams'])){
    if(empty($data) || empty($data['user_roomid'])){ echo json_encode(['code'=>0,'cams'=>[]]); exit; }
    echo json_encode(['code'=>1,'cams'=>cams_get($data['user_roomid'])]); exit;
}

// signaling endpoints
if(isset($_POST['post_offer'])){
    if(empty($data) || empty($_POST['producer']) || empty($_POST['viewer']) || empty($_POST['sdp'])){ echo json_encode(['code'=>0]); exit; }
    sig_add($data['user_roomid'], (int)$_POST['producer'], $_POST['viewer'], 'offer', $_POST['sdp']);
    echo json_encode(['code'=>1]); exit;
}
if(isset($_POST['post_answer'])){
    if(empty($data) || empty($_POST['producer']) || empty($_POST['viewer']) || empty($_POST['sdp'])){ echo json_encode(['code'=>0]); exit; }
    sig_add($data['user_roomid'], (int)$_POST['producer'], $_POST['viewer'], 'answer', $_POST['sdp']);
    echo json_encode(['code'=>1]); exit;
}
if(isset($_POST['post_cand_v2p'])){
    if(empty($data) || empty($_POST['producer']) || empty($_POST['viewer']) || empty($_POST['cand'])){ echo json_encode(['code'=>0]); exit; }
    sig_add($data['user_roomid'], (int)$_POST['producer'], $_POST['viewer'], 'cand_v2p', $_POST['cand']);
    echo json_encode(['code'=>1]); exit;
}
if(isset($_POST['post_cand_p2v'])){
    if(empty($data) || empty($_POST['producer']) || empty($_POST['viewer']) || empty($_POST['cand'])){ echo json_encode(['code'=>0]); exit; }
    sig_add($data['user_roomid'], (int)$_POST['producer'], $_POST['viewer'], 'cand_p2v', $_POST['cand']);
    echo json_encode(['code'=>1]); exit;
}
if(isset($_POST['fetch_for_producer'])){
    if(empty($data)){ echo json_encode(['code'=>0]); exit; }
    $rows = sig_fetch_for_producer($data['user_roomid'], $data['user_id']);
    echo json_encode(['code'=>1,'items'=>$rows]); exit;
}
if(isset($_POST['fetch_for_viewer'])){
    if(empty($data) || empty($_POST['producer']) || empty($_POST['viewer'])){ echo json_encode(['code'=>0]); exit; }
    $rows = sig_fetch_for_viewer($data['user_roomid'], (int)$_POST['producer'], $_POST['viewer']);
    echo json_encode(['code'=>1,'items'=>$rows]); exit;
}

echo json_encode(['code'=>0]);
?>

