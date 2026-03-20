// ─── Variables globales ────────────────────────────────────────────────────
let localStream = null;
let pc          = null;   // RTCPeerConnection

// ─── Helpers ───────────────────────────────────────────────────────────────
function log(msg, type = '') {
    const d = document.createElement('div');
    d.textContent = '▶ ' + msg;
    if (type) d.classList.add(type);
    document.getElementById('log').prepend(d);
}

function enable(...ids) {
    ids.forEach(id => {
        const b = document.getElementById(id);
        b.disabled = false;
    });
}

function disable(...ids) {
    ids.forEach(id => {
        const b = document.getElementById(id);
        b.disabled = true;
    });
}

// ─── 1. GET MEDIA ──────────────────────────────────────────────────────────
document.getElementById('btn-getmedia').onclick = async () => {
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
        document.getElementById('local').srcObject = localStream;
        log('GetMedia OK — caméra + micro actifs', 'ok');
        enable('btn-createpc');
        disable('btn-getmedia');
    } catch (e) {
        log('GetMedia ERREUR : ' + e.message, 'err');
    }
};

// ─── 2. CREATE PEER CONNECTION ─────────────────────────────────────────────
document.getElementById('btn-createpc').onclick = () => {
    pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });

    // Ajouter les pistes locales
    localStream.getTracks().forEach(track => pc.addTrack(track, localStream));

    // Réception du flux distant
    pc.ontrack = e => {
        document.getElementById('remote').srcObject = e.streams[0];
        log('ontrack — flux distant reçu', 'ok');
    };

    pc.oniceconnectionstatechange = () =>
        log('ICE state : ' + pc.iceConnectionState,
            pc.iceConnectionState === 'connected' ? 'ok' : '');

    log('CreatePeerConnection OK', 'ok');
    enable('btn-createoffer', 'btn-setoffer');
    disable('btn-createpc');
};

// ─── 3. CREATE OFFER (rôle initiateur) ────────────────────────────────────
document.getElementById('btn-createoffer').onclick = async () => {
    // 1) Créer l'offre et la poser comme description locale
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // 2) Attendre que le gathering ICE soit terminé (SDP complet avec candidats)
    await waitGatheringComplete();

    // 3) Afficher le SDP final
    document.getElementById('offer-sdp').value = JSON.stringify(pc.localDescription);
    log("CreateOffer OK — copiez l'Offer SDP et envoyez-le au pair", 'ok');
    disable('btn-createoffer', 'btn-setoffer');
    enable('btn-setanswer', 'btn-hangup');
};

// ─── 4. SET OFFER (rôle répondant) ────────────────────────────────────────
document.getElementById('btn-setoffer').onclick = async () => {
    const raw = document.getElementById('offer-sdp').value.trim();
    if (!raw) { log("SetOffer : collez d'abord l'Offer SDP reçu", 'err'); return; }

    const offer = JSON.parse(raw);
    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    log('SetOffer OK — remote description posée', 'ok');
    disable('btn-createoffer', 'btn-setoffer');
    enable('btn-createanswer', 'btn-hangup');
};

// ─── 5. CREATE ANSWER (rôle répondant) ────────────────────────────────────
document.getElementById('btn-createanswer').onclick = async () => {
    // 1) Créer la réponse et la poser comme description locale
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // 2) Attendre la fin du gathering ICE
    await waitGatheringComplete();

    // 3) Afficher le SDP final
    document.getElementById('answer-sdp').value = JSON.stringify(pc.localDescription);
    log("CreateAnswer OK — copiez l'Answer SDP et renvoyez-le à l'initiateur", 'ok');
    disable('btn-createanswer');
};

// ─── 6. SET ANSWER (rôle initiateur) ──────────────────────────────────────
document.getElementById('btn-setanswer').onclick = async () => {
    const raw = document.getElementById('answer-sdp').value.trim();
    if (!raw) { log("SetAnswer : collez d'abord l'Answer SDP reçu", 'err'); return; }

    const answer = JSON.parse(raw);
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
    log('SetAnswer OK — connexion en cours…', 'ok');
    disable('btn-setanswer');
};

// ─── HANG UP ──────────────────────────────────────────────────────────────
document.getElementById('btn-hangup').onclick = () => {
    pc.close(); pc = null;
    localStream.getTracks().forEach(t => t.stop());
    document.getElementById('local').srcObject  = null;
    document.getElementById('remote').srcObject = null;
    document.getElementById('offer-sdp').value  = '';
    document.getElementById('answer-sdp').value = '';
    log('Hang up — connexion fermée');
    disable('btn-createpc', 'btn-createoffer', 'btn-setoffer',
        'btn-createanswer', 'btn-setanswer', 'btn-hangup');
    enable('btn-getmedia');
};

// ─── Attendre la fin du gathering ICE ─────────────────────────────────────
// On attend l'événement icegatheringstatechange === 'complete'
// pour avoir un SDP avec tous les candidats intégrés (trickle ICE désactivé)
function waitGatheringComplete() {
    return new Promise(resolve => {
        if (pc.iceGatheringState === 'complete') {
            resolve();
            return;
        }
        pc.addEventListener('icegatheringstatechange', function handler() {
            if (pc.iceGatheringState === 'complete') {
                pc.removeEventListener('icegatheringstatechange', handler);
                resolve();
            }
        });
        // Timeout de sécurité : 5 secondes
        setTimeout(resolve, 5000);
    });
}