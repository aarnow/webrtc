// ─── Config ────────────────────────────────────────────────────────────────
// En prod : remplace par ton URL Render, ex: 'wss://webrtc-signaling.onrender.com'
const WS_URL = window.location.hostname === 'localhost'
    ? 'ws://localhost:8080'
    : 'wss://webrtc-signaling-8snc.onrender.com';

const ICE_SERVERS = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun.cloudflare.com:3478' },
    ]
};

// ─── État ──────────────────────────────────────────────────────────────────
let ws          = null;
let pc          = null;
let localStream = null;
let isInitiator = false;

// ─── Helpers UI ────────────────────────────────────────────────────────────
function log(msg, type = '') {
    const d = document.createElement('div');
    d.textContent = '▶ ' + msg;
    if (type) d.classList.add(type);
    document.getElementById('log').prepend(d);
}

function setStatus(msg) {
    document.getElementById('status').textContent = msg;
}

function showScreen(id) {
    ['screen-home', 'screen-waiting', 'screen-call'].forEach(s => {
        document.getElementById(s).style.display = s === id ? 'block' : 'none';
    });
}

function showNotif(msg, onAccept, onDecline) {
    const notif = document.getElementById('notif');
    document.getElementById('notif-msg').textContent = msg;
    notif.style.display = 'flex';
    document.getElementById('notif-accept').onclick = () => {
        notif.style.display = 'none';
        onAccept();
    };
    document.getElementById('notif-decline').onclick = () => {
        notif.style.display = 'none';
        onDecline();
    };
}

// ─── WebSocket ─────────────────────────────────────────────────────────────
function connectWS(code) {
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
        log('WebSocket connecté', 'ok');
        ws.send(JSON.stringify({ type: 'join', code }));
    };

    ws.onmessage = async e => {
        const msg = JSON.parse(e.data);

        switch (msg.type) {

            case 'waiting':
                setStatus('En attente d\'un autre participant…');
                showScreen('screen-waiting');
                log('Room créée — en attente du pair');
                break;

            case 'joined':
                isInitiator = msg.initiator;
                log(`Pair connecté — rôle : ${isInitiator ? 'initiateur' : 'répondant'}`);

                if (isInitiator) {
                    // A lance automatiquement l'appel
                    setStatus('Pair trouvé — lancement de l\'appel…');
                    showScreen('screen-call');
                    await startCall();
                } else {
                    // B reçoit une notification
                    showNotif(
                        '📹 Un pair souhaite vous appeler',
                        async () => {
                            setStatus('Connexion en cours…');
                            showScreen('screen-call');
                            log('Appel accepté');
                        },
                        () => {
                            ws.close();
                            showScreen('screen-home');
                            log('Appel refusé');
                        }
                    );
                }
                break;

            case 'offer':
                log('Offer reçu');
                await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                const answer = await pc.createAnswer();
                await pc.setLocalDescription(answer);
                send({ type: 'answer', sdp: pc.localDescription });
                log('Answer envoyé', 'ok');
                break;

            case 'answer':
                log('Answer reçu');
                await pc.setRemoteDescription(new RTCSessionDescription(msg.sdp));
                break;

            case 'candidate':
                if (msg.candidate && pc) {
                    await pc.addIceCandidate(new RTCIceCandidate(msg.candidate));
                }
                break;

            case 'room-full':
                log('Room pleine — réessayez avec un autre code', 'err');
                showScreen('screen-home');
                break;

            case 'peer-left':
                log('Le pair a quitté la session', 'err');
                setStatus('Le pair a quitté la session');
                hangup(false);
                break;
        }
    };

    ws.onerror = () => log('Erreur WebSocket', 'err');
    ws.onclose = () => log('WebSocket fermé');
}

function send(msg) {
    if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(msg));
    }
}

// ─── WebRTC ─────────────────────────────────────────────────────────────────
async function startCall() {
    pc = new RTCPeerConnection(ICE_SERVERS);

    localStream.getTracks().forEach(t => pc.addTrack(t, localStream));

    pc.ontrack = e => {
        document.getElementById('remote').srcObject = e.streams[0];
        log('Flux distant reçu', 'ok');
    };

    // Trickle ICE : envoyer chaque candidat dès qu'il est prêt
    pc.onicecandidate = e => {
        if (e.candidate) {
            send({ type: 'candidate', candidate: e.candidate });
        }
    };

    pc.oniceconnectionstatechange = () => {
        const s = pc.iceConnectionState;
        log('ICE state : ' + s, s === 'connected' || s === 'completed' ? 'ok' : '');
        if (s === 'connected' || s === 'completed') setStatus('Connecté ✓');
    };

    if (isInitiator) {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        send({ type: 'offer', sdp: pc.localDescription });
        log('Offer envoyé', 'ok');
    }
}

function hangup(notifyPeer = true) {
    if (pc) { pc.close(); pc = null; }
    if (localStream) { localStream.getTracks().forEach(t => t.stop()); localStream = null; }
    document.getElementById('local').srcObject  = null;
    document.getElementById('remote').srcObject = null;
    if (notifyPeer && ws) ws.close();
    showScreen('screen-home');
    setStatus('');
}

// ─── Boutons ───────────────────────────────────────────────────────────────

// Générer un code à 4 chiffres
document.getElementById('btn-generate').onclick = async () => {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    document.getElementById('room-code-display').textContent = code;
    document.getElementById('join-code').value = code;
    document.getElementById('room-code-area').style.display = 'block';
    log(`Code room : ${code}`);
};

// Rejoindre
document.getElementById('btn-join').onclick = async () => {
    const code = document.getElementById('join-code').value.trim();
    if (!code || code.length < 4) { log('Entrez un code à 4 chiffres', 'err'); return; }

    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('local').srcObject = localStream;
        log('Caméra active', 'ok');
    } catch (e) {
        log('Erreur caméra : ' + e.message, 'err');
        return;
    }

    connectWS(code);
};

// Hang up
document.getElementById('btn-hangup').onclick = () => hangup(true);