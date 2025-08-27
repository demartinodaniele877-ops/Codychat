initCall = function(data){
	hideAllModal();
	hideCall();
	$('#wrap_call').html(data);
	showCall();
}

startCall = function(id, type){
	hideAllModal();
	$.post('system/action/action_call.php', { 
			init_call: id,
			call_type: type,
		}, function(response) {
			if(response == 0){
				callError(system.callFail);
			}
			else {
				overEmptyModal(response);
			}
	});
}
openCall = function(id){
	hideAllModal();
	$.post('system/box/call_box.php', { 
			target: id,
		}, function(response) {
			if(response != 0){
				overModal(response);
			}
	});
}
cancelCall = function(id){
	$.post('system/action/action_call.php', { 
			cancel_call: id,
		}, function(response) {
			hideOver();
	});
}
acceptCall = function(id){
	$.ajax({
		url: "system/action/action_call.php",
		type: "post",
		cache: false,
		dataType: 'json',
		data: { 
			accept_call: id,
		},
		success: function(response){
			if(response.code == 1){
				initCall(response.data);
			}
			else if(response.code == 99){
				callError(system.callFail);
				hideOver();
			}
		},
	});	
}
declineCall = function(id){
	$.post('system/action/action_call.php', { 
			decline_call: id,
		}, function(response) {
			hideOver();
	});
}

updateCall = function(type){
	if($('#call_pending:visible').length){
		$.ajax({
			url: "system/action/action_call.php",
			type: "post",
			cache: false,
			dataType: 'json',
			data: { 
				update_call: $('#call_pending').attr('data'),
			},
			success: function(response){
				if(response.code == 1){
					initCall(response.data);
				}
				else if(response.code == 99){
					callError(system.callFail);
					hideOver();
				}
			},
		});	
	}
}

updateIncomingCall = function(type){
	if($('#call_incoming:visible').length){
		$.ajax({
			url: "system/action/action_call.php",
			type: "post",
			cache: false,
			dataType: 'json',
			data: { 
				update_incoming_call: $('#call_incoming').attr('data'),
			},
			success: function(response){
				if(response.code == 99){
					hideOver();
				}
			},
		});	
	}
}

checkCall = function(ncall){
	if(ncall > uCall){
		uCall = ncall;
		$.ajax({
			url: "system/action/action_call.php",
			type: "post",
			cache: false,
			dataType: 'json',
			data: { 
				check_call: inCall(),
			},
			success: function(response){
				if(response.code == 1){
					overEmptyModal(response.data);
				}
			},
		});	
	}	
}

inCall = function(){
	if($('#call_pending:visible').length || $('#call_incoming:visible').length || $('#container_call:visible').length){
		return 1;
	}
	else {
		return 0;
	}
}

callOff = function(){
	$('.vcallstream').removeClass('over_stream');
}
callOn = function(){
	if(!insideChat()){
		$('.vidminus').replaceWith("");
	}
	if($('.modal_in:visible').length){
		$('.vidstream').addClass('over_stream');
	}
	else {
		vidOff();
	}
}

hideCall = function(){
	$('#wrap_call').html('');
	$('#container_call').hide();
}
showCall = function(){
	$("#container_call").removeClass('streamout').fadeIn(300);
}

toggleCall = function(type){
	if(type == 1){
		$("#container_call").addClass('streamout');
		$('#mstream_call').removeClass('streamhide');
	}
	if(type == 2){
		$("#container_call").removeClass('streamout');
		$('#mstream_call').addClass('streamhide');
	}
}


$(document).ready(function(){
	callUpdate = setInterval(updateCall, 3000);
	callIncoming = setInterval(updateIncomingCall, 3000);
	updateCall();
	updateIncomingCall();
	
	$(document).on('click', '.opencall', function(){
		var calluser = $(this).attr('data');
		openCall(calluser);
	});
	$(document).on('click', '.startcall', function(){
		var cuser = $(this).attr('data-user');
		var ctype = $(this).attr('data-type');
		startCall(cuser, ctype);
	});
	$(document).on('click', '.hide_call', function(){
		hideCall();
	});
	
	$(window).on('message', function(event) {
		if (event.originalEvent.origin !== window.location.origin) {
			return;
		}
		if (event.originalEvent.data === 'endCall') {
			hideCall();
			callendPlay();
		}
	});
});