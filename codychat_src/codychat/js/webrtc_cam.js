// WebRTC public cam for CodyChat 3.6
// Requires: system/action/action_webrtc.php

(function(){
	var cams = new Set();
	var isCamOn = false;
	var producerPc = null;
	var viewers = new Map(); // key: target uid -> { pc, boxId }
	var myViewerId = String(Math.random()).slice(2, 10);

	function ajax(data, cb){
		$.ajax({ url: 'system/action/action_webrtc.php', type: 'post', dataType: 'json', cache: false, data: data, success: cb });
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
		if(ent){ try{ ent.pc.close(); }catch(_){ } viewers.delete(String(targetUid)); }
		$('#viewer_'+targetUid).fadeOut(120, function(){ $(this).remove(); });
	}

	// Producer
	async function startMyCam(){
		if(isCamOn) return; isCamOn = true; ensureUserCamIcons();
		if(typeof user_id !== 'undefined'){ $('.user_item .iccam[data-uid="'+user_id+'"] .list_cam').removeClass('hidden').closest('.iccam').addClass('cam_on'); }
		ajax({ start_cam: 1 }, function(){ pollCams(); });
		try{
			producerPc = new RTCPeerConnection({ iceServers: [] });
			const stream = await navigator.mediaDevices.getUserMedia({ video:true, audio:true });
			stream.getTracks().forEach(t=>producerPc.addTrack(t, stream));
			producerPc.onicecandidate = function(ev){ if(ev.candidate){ ajax({ post_cand_p2v:1, producer:user_id, viewer: myViewerId, cand: JSON.stringify(ev.candidate) }); } };
			const offer = await producerPc.createOffer();
			await producerPc.setLocalDescription(offer);
			ajax({ post_offer:1, producer:user_id, viewer: myViewerId, sdp: JSON.stringify(offer) });
			// loop fetch answers/cands
			setInterval(function(){ ajax({ fetch_for_producer:1 }, function(r){ if(r&&r.code===1){ (r.items||[]).forEach(async function(it){ try{
				if(it.role==='answer'){ var ans = JSON.parse(it.payload); await producerPc.setRemoteDescription(ans); }
				else if(it.role==='cand_v2p'){ var c = JSON.parse(it.payload); await producerPc.addIceCandidate(c); }
			}catch(_){ } }); } }); }, 1500);
		}catch(_){ }
	}
	function stopMyCam(){ if(!isCamOn) return; isCamOn=false; try{ producerPc && producerPc.close(); }catch(_){ } producerPc=null; ajax({ stop_cam:1 }, function(){ pollCams(); }); }

	// Viewer
	async function viewUser(targetUid){
		var tu = String(targetUid);
		closeViewer(tu);
		var boxId = openBoxViewer(tu);
		var pc = new RTCPeerConnection({ iceServers: [] });
		viewers.set(tu, { pc: pc, boxId: boxId });
		var v = document.createElement('video'); v.playsInline=true; v.autoplay=true; v.muted=true; v.style.width='100%'; v.style.height='100%';
		$('#'+boxId+' .vwrap').empty().append(v);
		pc.ontrack = function(ev){ try{ var s = v.srcObject instanceof MediaStream ? v.srcObject : new MediaStream(); s.addTrack(ev.track); v.srcObject = s; v.play().catch(()=>{}); }catch(_){ } };
		pc.onicecandidate = function(ev){ if(ev.candidate){ ajax({ post_cand_v2p:1, producer: tu, viewer: myViewerId, cand: JSON.stringify(ev.candidate) }); } };
		const offer = await pc.createOffer({ offerToReceiveAudio:true, offerToReceiveVideo:true });
		await pc.setLocalDescription(offer);
		ajax({ post_offer:1, producer: tu, viewer: myViewerId, sdp: JSON.stringify(offer) });
		setInterval(function(){ ajax({ fetch_for_viewer:1, producer: tu, viewer: myViewerId }, async function(r){ if(r&&r.code===1){ for(const it of (r.items||[])){
			try{
				if(it.role==='answer'){ var ans = JSON.parse(it.payload); await pc.setRemoteDescription(ans); }
				else if(it.role==='cand_p2v'){ var c = JSON.parse(it.payload); await pc.addIceCandidate(c); }
			}catch(_){ }
		} } }); }, 1500);
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

