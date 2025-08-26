// Minimal client for public room webcams using external mediasoup SFU page
// Server expected to expose: /system/action/action_cam.php

var publicCam = (function(){
	var cams = new Set();
	var mediasoupWss = 'wss://fasthost4u.pw:4443'; // default fallback
	var isCamOn = false;
	var toggleBusy = false;
	var persistedCam = false; // becomes true after server confirms start/stop

	function ensureUserCamIcons(){
		$('.user_item').each(function(){
			var $item = $(this);
			var uid = $item.attr('data-id');
			if(!uid){ return; }
			if($item.find('.iccam').length === 0){
				$item.append('<div class="user_item_icon iccam" data-uid="'+uid+'"><img class="list_cam hidden" src="default_images/actions/cam.svg"/></div>');
			}
		});
	}

	function syncIcons(newCams){
		var next = new Set(Array.isArray(newCams) ? newCams.map(function(v){return parseInt(v);}) : []);
		if (typeof user_id !== 'undefined'){
			if(isCamOn) next.add(parseInt(user_id,10)); else next.delete(parseInt(user_id,10));
		}
		$('.user_item .iccam').each(function(){
			var uid = parseInt($(this).attr('data-uid'));
			if(next.has(uid)){
				$(this).find('.list_cam').removeClass('hidden');
				$(this).addClass('cam_on');
			} else {
				$(this).find('.list_cam').addClass('hidden');
				$(this).removeClass('cam_on');
			}
		});
		cams = next;
	}

	function fetchCams(){
		$.ajax({
			url: 'system/action/action_cam.php',
			type: 'post',
			cache: false,
			dataType: 'json',
			data: { get_public_cams: 1, token: (typeof utk !== 'undefined' ? utk : undefined) },
			success: function(resp){
				if(resp && resp.code === 1){
					ensureUserCamIcons();
					syncIcons(resp.cams || []);
				}
			}
		});
	}

	function startMyCam(){
		if (typeof user_id !== 'undefined'){
			$('.user_item .iccam[data-uid="'+user_id+'"] .list_cam').removeClass('hidden').closest('.iccam').addClass('cam_on');
		}
		isCamOn = true;
		$.ajax({
			url: 'system/action/action_cam.php',
			type: 'post',
			cache: false,
			dataType: 'json',
			data: { start_public_cam: 1, token: (typeof utk !== 'undefined' ? utk : undefined) },
			success: function(){ persistedCam = true; fetchCams(); },
			error: function(){ persistedCam = false; }
		});
	}

	function stopMyCam(){
		if (typeof user_id !== 'undefined'){
			$('.user_item .iccam[data-uid="'+user_id+'"] .list_cam').addClass('hidden').closest('.iccam').removeClass('cam_on');
		}
		isCamOn = false;
		$.ajax({
			url: 'system/action/action_cam.php',
			type: 'post',
			cache: false,
			dataType: 'json',
			data: { stop_public_cam: 1, token: (typeof utk !== 'undefined' ? utk : undefined) },
			success: function(){ persistedCam = false; fetchCams(); }
		});
	}

	function buildEmbedUrl(targetUserId, mode){
		var base = (window.PUBLIC_CAM_URL && window.PUBLIC_CAM_URL.trim()) || '';
		if(base){
			return base
				.replace(/\{uid\}/g, String(targetUserId))
				.replace(/\{room\}/g, String(typeof user_room !== 'undefined' ? user_room : ''))
				.replace(/\{mode\}/g, String(mode || 'consume'))
				.replace(/\{wss\}/g, String(mediasoupWss));
		}
		var q = '?uid=' + encodeURIComponent(targetUserId) + '&mode=' + encodeURIComponent(mode || 'consume') + '&wss=' + encodeURIComponent(mediasoupWss);
		return 'system/livekit/public_cam_iframe.php' + q;
	}

	function openViewer(targetUserId, mode){
		var m = mode || 'consume';
		var already = $('#wrap_stream iframe').attr('src') || '';
		if (already && already.indexOf('uid='+encodeURIComponent(targetUserId)) !== -1 && already.indexOf('mode='+m) !== -1){
			$('#container_stream').removeClass('streamout').fadeIn(200);
			return;
		}
		$('#wrap_stream').empty();
		$('#wrap_stream_audio').empty();
		$('#container_stream_audio').hide().addClass('streamout');
		var url = buildEmbedUrl(targetUserId, m);
		$('#wrap_stream').html('<iframe src="' + url + '" allow="camera; microphone; autoplay;" frameborder="0" style="width:100%;height:100%"></iframe>');
		$('#wrap_stream').children(':not(iframe)').remove();
		try{ var wr = document.getElementById('wrap_stream'); if (wr && !wr.__publicCamObs){ wr.__publicCamObs = new MutationObserver(function(){ $('#wrap_stream').children('video,audio').remove(); }); wr.__publicCamObs.observe(wr, { childList: true }); } }catch(_){ }
		var $box = $('#container_stream');
		$('#wrap_stream').css({ width: 560, height: 315 });
		$box.css({ width: 560, height: 355 }).removeClass('streamout').fadeIn(200);
		try{
			$box.draggable({ handle: '.stream_header, #move_video, #container_stream', containment: 'document' });
			$box.resizable({ aspectRatio: 16/9, minWidth: 320, minHeight: 180 });
		}catch(_){ }
	}

	// Update icons from iframe messages, persist only for self once
	window.addEventListener('message', function(ev){
		try{
			var d = ev.data || {};
			if(d.type === 'publiccam:started' && d.uid){
				var uid = parseInt(d.uid,10);
				$('.user_item .iccam[data-uid="'+uid+'"] .list_cam').removeClass('hidden').closest('.iccam').addClass('cam_on');
				if (typeof user_id !== 'undefined' && uid === parseInt(user_id,10) && !persistedCam){ startMyCam(); }
			}
			else if(d.type === 'publiccam:stopped' && d.uid){
				var uid2 = parseInt(d.uid,10);
				$('.user_item .iccam[data-uid="'+uid2+'"] .list_cam').addClass('hidden').closest('.iccam').removeClass('cam_on');
				if (typeof user_id !== 'undefined' && uid2 === parseInt(user_id,10) && persistedCam){ stopMyCam(); }
			}
		}catch(_){ }
	}, false);

	function mountUi(){
		ensureUserCamIcons();
		if($('#chat_head .head_option.cam_toggle').length === 0){
			var btn = $('<div class="head_option cam_toggle" title="Webcam"><div class="btable notif_zone"><div class="bcell_mid"><i class="fa fa-video"></i></div></div></div>');
			btn.on('click', function(){
				if (toggleBusy) return; toggleBusy = true;
				var $self = $(this);
				if($self.hasClass('on')){
					$self.removeClass('on');
					if (typeof user_id !== 'undefined'){
						$('.user_item .iccam[data-uid="'+user_id+'"] .list_cam').addClass('hidden').closest('.iccam').removeClass('cam_on');
					}
					isCamOn = false;
					stopMyCam();
					$('#wrap_stream').empty();
					$('#container_stream').fadeOut(200).addClass('streamout');
				} else {
					$self.addClass('on');
					if (typeof user_id !== 'undefined'){
						$('.user_item .iccam[data-uid="'+user_id+'"] .list_cam').removeClass('hidden').closest('.iccam').addClass('cam_on');
					}
					isCamOn = true;
					persistedCam = false;
					startMyCam();
					if(typeof user_id !== 'undefined'){
						var cur = $('#wrap_stream iframe').attr('src') || '';
						var want = 'uid='+encodeURIComponent(user_id)+'&mode=produce';
						if (cur && cur.indexOf(want) !== -1){
							$('#container_stream').removeClass('streamout').fadeIn(200);
						} else {
							$('#wrap_stream').empty();
							openViewer(user_id, 'produce');
						}
					}
				}
				setTimeout(function(){ toggleBusy = false; }, 700);
			});
			$('#chat_head').append(btn);
		}

		try{
			var target = document.getElementById('chat_right_data');
			if(target && !target.__publicCamObserved){
				var mo = new MutationObserver(function(){ ensureUserCamIcons(); syncIcons(Array.from(cams)); });
				mo.observe(target, { childList: true, subtree: true });
				target.__publicCamObserved = true;
			}
		}catch(_){ }

		$(document).off('click.publicCamView').on('click.publicCamView', '.user_item .iccam.cam_on', function(e){
			e.stopPropagation();
			var uid = $(this).attr('data-uid');
			openViewer(uid, 'consume');
		});
	}

	function handlePollPayload(payload){
		if(payload && payload.cams){ ensureUserCamIcons(); syncIcons(payload.cams); }
	}

	return {
		mountUi: mountUi,
		fetchCams: fetchCams,
		handlePollPayload: handlePollPayload
	};
})();

// Initialize once DOM is ready inside chat
$(document).ready(function(){
	if(typeof curPage !== 'undefined' && curPage === 'chat'){
		publicCam.mountUi();
		publicCam.fetchCams();
		setInterval(function(){ if(typeof publicCam !== 'undefined' && curPage === 'chat' && !isCamOn){ publicCam.fetchCams(); } }, 5000);
	}
});
