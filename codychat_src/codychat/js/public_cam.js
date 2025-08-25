// Minimal client for public room webcams using external mediasoup SFU page
// Server expected to expose: /system/action/action_cam.php

var publicCam = (function(){
	var cams = new Set();
	var mediasoupWss = 'wss://fasthost4u.pw:4443'; // default fallback

	function syncIcons(newCams){
		var next = new Set(Array.isArray(newCams) ? newCams.map(function(v){return parseInt(v);}) : []);
		// toggle icons
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
			data: { get_public_cams: 1 },
			success: function(resp){
				if(resp && resp.code === 1){
					syncIcons(resp.cams || []);
				}
			}
		});
	}

	function startMyCam(){
		$.ajax({
			url: 'system/action/action_cam.php',
			type: 'post',
			cache: false,
			dataType: 'json',
			data: { start_public_cam: 1 },
			success: function(){
				fetchCams();
			}
		});
	}

	function stopMyCam(){
		$.ajax({
			url: 'system/action/action_cam.php',
			type: 'post',
			cache: false,
			dataType: 'json',
			data: { stop_public_cam: 1 },
			success: function(){
				fetchCams();
			}
		});
	}

	function buildEmbedUrl(targetUserId, mode){
		var base = (window.PUBLIC_CAM_URL && window.PUBLIC_CAM_URL.trim()) || '';
		if(base){
			// Support placeholders {uid} {room} {mode} {wss}
			return base
				.replace(/\{uid\}/g, String(targetUserId))
				.replace(/\{room\}/g, String(typeof user_room !== 'undefined' ? user_room : ''))
				.replace(/\{mode\}/g, String(mode || 'consume'))
				.replace(/\{wss\}/g, String(mediasoupWss));
		}
		// fallback to internal placeholder
		var q = '?uid=' + encodeURIComponent(targetUserId) + '&mode=' + encodeURIComponent(mode || 'consume') + '&wss=' + encodeURIComponent(mediasoupWss);
		return 'system/livekit/public_cam_iframe.php' + q;
	}

	function openViewer(targetUserId, mode){
		// Reuse existing draggable video popup containers
		var url = buildEmbedUrl(targetUserId, mode || 'consume');
		$('#wrap_stream').html('<iframe src="' + url + '" allow="camera; microphone; autoplay;" frameborder="0" style="width:100%;height:100%"></iframe>');
		var $box = $('#container_stream');
		$box.css({ width: 560, height: 315 }); // 16:9 default
		$box.removeClass('streamout').fadeIn(200);
		// make draggable + resizable (requires jQuery UI already loaded in app)
		try{
			$box.draggable({ handle: '.stream_top, #container_stream', containment: 'document' });
			$box.resizable({
				aspectRatio: 16/9,
				minWidth: 320,
				minHeight: 180
			});
		}catch(_){ /* jQuery UI should be present */ }
		vidOn();
	}

	// Listen to iframe messages to update icons instantly
	window.addEventListener('message', function(ev){
		try{
			var data = ev.data || {};
			if(data.type === 'publiccam:started' && data.uid){
				// optimistic update: show cam icon for this uid
				$('.user_item .iccam[data-uid="'+parseInt(data.uid)+'"] .list_cam').removeClass('hidden').closest('.iccam').addClass('cam_on');
			}
			if(data.type === 'publiccam:stopped' && data.uid){
				$('.user_item .iccam[data-uid="'+parseInt(data.uid)+'"] .list_cam').addClass('hidden').closest('.iccam').removeClass('cam_on');
			}
		}catch(_){ }
	}, false);

	function mountUi(){
		// Add top-right main webcam toggle button in chat header if not exists
		if($('#chat_head .head_option.cam_toggle').length === 0){
			var btn = $('<div class="head_option cam_toggle" title="Webcam"><div class="btable notif_zone"><div class="bcell_mid"><i class="fa fa-video"></i></div></div></div>');
			btn.on('click', function(){
				// Simple toggle: start or stop
				if($(this).hasClass('on')){
					$(this).removeClass('on');
					stopMyCam();
				} else {
					$(this).addClass('on');
					startMyCam();
					// Open producer view to actually publish on the external page
					if(typeof user_id !== 'undefined'){
						openViewer(user_id, 'produce');
					}
				}
			});
			$('#chat_head').append(btn);
		}

		// Click on user cam icon to open viewer
		$(document).off('click.publicCam').on('click.publicCam', '.user_item .iccam.cam_on', function(e){
			e.stopPropagation();
			var uid = $(this).attr('data-uid');
			openViewer(uid, 'consume');
		});
	}

	function handlePollPayload(payload){
		if(payload && payload.cams){
			syncIcons(payload.cams);
		}
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
	}
});
