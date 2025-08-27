// WebRTC public cam for CodyChat 3.6
// Requires: system/action/action_webrtc.php

(function(){
	var cams = new Set();
	var isCamOn = false;
	var myViewerId = String(Math.random()).slice(2, 10);

	// Producer state: per-viewer RTCPeerConnections
	var producer = {
		stream: null,
		pcByViewer: new Map(), // key: viewerId -> RTCPeerConnection
		pollTimer: null
	};

	// Viewer state: per target producer user
	var viewers = new Map(); // key: target uid -> { pc, boxId, pollTimer }

	function ajax(data, cb){
		$.ajax({ url: 'system/action/action_webrtc.php', type: 'post', dataType: 'json', cache: false, data: data, success: cb });
	}

	function getIceServers(){
		var ice = [];
		try{
			if(Array.isArray(window.WEBRTC_ICE_SERVERS)) ice = window.WEBRTC_ICE_SERVERS;
			else if(window.TURN_CONFIG && Array.isArray(window.TURN_CONFIG.iceServers)) ice = window.TURN_CONFIG.iceServers;
		}catch(_){ }
		if(!Array.isArray(ice) || !ice.length){
			ice = [{ urls: 'stun:stun.l.google.com:19302' }];
		}
		return ice;
	}

	function ensureUserCamIcons(){
		$('.user_item').each(function(){
			var $it = $(this); var uid = $it.attr('data-id'); if(!uid) return;
			if($it.find('.iccam').length === 0){
				$it.append('<div class="user_item_icon iccam" data-uid="'+uid+'"><img class="list_cam hidden" src="default_images/actions/cam.svg"/></div>');
			}
		});
	}
	function syncIcons(list){
		var next = new Set((list||[]).map(function(v){ return parseInt(v); }));
		if(typeof user_id !== 'undefined'){ if(isCamOn) next.add(parseInt(user_id)); else next.delete(parseInt(user_id)); }
		$('.user_item .iccam').each(function(){
			var uid = parseInt($(this).attr('data-uid'));
			if(next.has(uid)){ $(this).find('.list_cam').removeClass('hidden'); $(this).addClass('cam_on'); }
			else { $(this).find('.list_cam').addClass('hidden'); $(this).removeClass('cam_on'); }
		});
		cams = next;
	}
	function pollCams(){ ajax({ list_cams: 1 }, function(r){ if(r && r.code===1){ ensureUserCamIcons(); syncIcons(r.cams); } }); }

	function openBoxViewer(targetUid){
		var bid = 'viewer_'+targetUid;
		if($('#'+bid).length===0){
			$('body').append('<div id="'+bid+'" class="streamers vidstream background_stream" style="position:fixed;top:100px;left:100px;width:480px;height:310px;z-index:10000;display:none">\
				<div class="btable stream_header"><div class="bcell_mid"></div><div class="bcell_mid vidopt close_view"><i class="fa fa-times"></i></div></div>\
				<div class="vwrap" style="width:100%;height:100%"></div>\
			</div>');
			try{ $('#'+bid).draggable({ handle: '.stream_header', containment: 'document' }).resizable({ aspectRatio: 16/9, minWidth:320, minHeight:180 }); }catch(_){ }
			$(document).off('click.close_'+bid).on('click.close_'+bid, '#'+bid+' .close_view', function(){ closeViewer(targetUid); });
		}
		$('#'+bid).fadeIn(120);
		return bid;
	}
	function closeViewer(targetUid){
		var ent = viewers.get(String(targetUid));
		if(ent){
			try{ ent.pc && ent.pc.close(); }catch(_){ }
			if(ent.pollTimer){ clearInterval(ent.pollTimer); }
			viewers.delete(String(targetUid));
		}
		$('#viewer_'+targetUid).fadeOut(120, function(){ $(this).remove(); });
	}

	function createProducerPcFor(viewerId){
		var pc = new RTCPeerConnection({ iceServers: getIceServers() });
		try{ if(producer.stream){ producer.stream.getTracks().forEach(function(t){ pc.addTrack(t, producer.stream); }); } }catch(_){ }
		pc.onicecandidate = function(ev){ if(ev.candidate){ ajax({ post_cand_p2v:1, producer: user_id, viewer: viewerId, cand: JSON.stringify(ev.candidate) }); } };
		pc.onconnectionstatechange = function(){
			var st = pc.connectionState;
			if(st === 'failed' || st === 'closed'){
				try{ pc.close(); }catch(_){ }
				producer.pcByViewer.delete(String(viewerId));
			}
		};
		producer.pcByViewer.set(String(viewerId), pc);
		return pc;
	}

	// Producer: start camera and answer incoming viewer offers
	async function startMyCam(){
		if(isCamOn) return; isCamOn = true; ensureUserCamIcons();
		if(typeof user_id !== 'undefined'){ $('.user_item .iccam[data-uid="'+user_id+'"] .list_cam').removeClass('hidden').closest('.iccam').addClass('cam_on'); }
		ajax({ start_cam: 1 }, function(){ pollCams(); });
		try{
			producer.stream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
		}catch(_){ }
		if(producer.pollTimer){ clearInterval(producer.pollTimer); }
		producer.pollTimer = setInterval(function(){
			ajax({ fetch_for_producer:1 }, function(r){
				if(r && r.code === 1){
					(r.items||[]).forEach(async function(it){
						try{
							if(it.role === 'offer'){
								var offer = JSON.parse(it.payload);
								var vid = String(it.viewer_id || '');
								if(!vid) return;
								var pc = producer.pcByViewer.get(vid) || createProducerPcFor(vid);
								await pc.setRemoteDescription(offer);
								var answer = await pc.createAnswer();
								await pc.setLocalDescription(answer);
								ajax({ post_answer:1, producer: user_id, viewer: vid, sdp: JSON.stringify(answer) });
							}
							else if(it.role === 'cand_v2p'){
								var c = JSON.parse(it.payload);
								var vid2 = String(it.viewer_id || '');
								var pc2 = producer.pcByViewer.get(vid2);
								if(pc2){ try{ await pc2.addIceCandidate(c); }catch(_){ } }
							}
						}catch(_){ }
					});
				}
			});
		}, 1200);
	}

	function stopMyCam(){
		if(!isCamOn) return; isCamOn=false;
		try{ if(producer.pollTimer){ clearInterval(producer.pollTimer); producer.pollTimer=null; } }catch(_){ }
		try{ if(producer.stream){ producer.stream.getTracks().forEach(function(t){ try{ t.stop(); }catch(_){ } }); } }catch(_){ }
		try{ producer.pcByViewer.forEach(function(pc){ try{ pc.close(); }catch(_){ } }); producer.pcByViewer.clear(); }catch(_){ }
		producer.stream = null;
		ajax({ stop_cam:1 }, function(){ pollCams(); });
	}

	// Viewer: watch a user's public cam
	async function viewUser(targetUid){
		var tu = String(targetUid);
		closeViewer(tu);
		var boxId = openBoxViewer(tu);
		var pc = new RTCPeerConnection({ iceServers: getIceServers() });
		var ent = { pc: pc, boxId: boxId, pollTimer: null };
		viewers.set(tu, ent);
		var v = document.createElement('video'); v.playsInline=true; v.autoplay=true; v.muted=true; v.style.width='100%'; v.style.height='100%';
		$('#'+boxId+' .vwrap').empty().append(v);
		pc.ontrack = function(ev){ try{ var s = v.srcObject instanceof MediaStream ? v.srcObject : new MediaStream(); s.addTrack(ev.track); v.srcObject = s; v.play().catch(function(){}); }catch(_){ } };
		pc.onicecandidate = function(ev){ if(ev.candidate){ ajax({ post_cand_v2p:1, producer: tu, viewer: myViewerId, cand: JSON.stringify(ev.candidate) }); } };
		try{
			var offer = await pc.createOffer({ offerToReceiveAudio:true, offerToReceiveVideo:true });
			await pc.setLocalDescription(offer);
			ajax({ post_offer:1, producer: tu, viewer: myViewerId, sdp: JSON.stringify(offer) });
		}catch(_){ }
		ent.pollTimer = setInterval(function(){ ajax({ fetch_for_viewer:1, producer: tu, viewer: myViewerId }, async function(r){ if(r&&r.code===1){ for(const it of (r.items||[])){
			try{
				if(it.role==='answer'){ var ans = JSON.parse(it.payload); try{ await pc.setRemoteDescription(ans); }catch(_){ } }
				else if(it.role==='cand_p2v'){ var c = JSON.parse(it.payload); try{ await pc.addIceCandidate(c); }catch(_){ } }
			}catch(_){ }
		} } }); }, 1200);
	}

	// UI mount
	function mountUi(){
		ensureUserCamIcons(); pollCams(); setInterval(pollCams, 5000);
		if($('#chat_head .head_option.cam_toggle').length===0){
			var btn = $('<div class="head_option cam_toggle" title="Webcam"><div class="btable notif_zone"><div class="bcell_mid"><i class="fa fa-video"></i></div></div></div>');
			btn.on('click', function(){ if($(this).hasClass('on')){ $(this).removeClass('on'); stopMyCam(); } else { $(this).addClass('on'); startMyCam(); } });
			$('#chat_head').append(btn);
		}
		$(document).off('click.wrtcView').on('click.wrtcView', '.user_item .iccam.cam_on', function(e){ e.stopPropagation(); var uid=$(this).attr('data-uid'); if(String(uid)!==String(user_id)) viewUser(uid); });
	}

	window.WebRTCPublicCam = { mountUi: mountUi };
})();

$(document).ready(function(){ if(typeof curPage!=='undefined' && curPage==='chat'){ WebRTCPublicCam.mountUi(); } });

