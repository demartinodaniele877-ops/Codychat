<?php
// Lightweight host page to embed mediasoup-based broadcaster/viewer
// Here we only pass-through parameters; your existing mediasoup app should handle room/peer based on uid.
// This page can be replaced by a more advanced integration.

// Inputs: uid (int), wss (string)
$uid = isset($_GET['uid']) ? (int) $_GET['uid'] : 0;
$wss = isset($_GET['wss']) ? $_GET['wss'] : '';
?>
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>Public Cam</title>
  <style>
    html, body { margin:0; padding:0; height:100%; background:#000; }
    #app { position:fixed; inset:0; display:flex; align-items:center; justify-content:center; }
    video { max-width:100%; max-height:100%; background:#000; }
    .ctrl { position:fixed; top:8px; right:8px; z-index:10 }
    .btn { background:#111; color:#fff; border:1px solid #444; padding:8px 10px; margin-left:6px; cursor:pointer }
  </style>
</head>
<body>
  <div class="ctrl">
    <button class="btn" onclick="window.parent.postMessage('endCall', window.origin)">Chiudi</button>
  </div>
  <div id="app">
    <video id="v" playsinline autoplay controls></video>
  </div>
  <script>
  (function(){
    const params = new URLSearchParams(location.search);
    const uid = params.get('uid');
    const wss = params.get('wss');
    const video = document.getElementById('v');
    // Placeholder: connect to your mediasoup client app here.
    // For demo we just attach local cam if broadcasting; real impl should signal via wss and consume producer by uid.
    async function init(){
      try{
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        video.srcObject = stream;
      }catch(e){
        console.error(e);
      }
    }
    init();
  })();
  </script>
</body>
<scrip></scrip>
</html>
