/**
 * BabyKeyPlay — Multiplayer Module
 * WebRTC DataChannel-based P2P with signaling via BroadcastChannel fallback
 * For production: replace signaling with WebSocket server
 */

const Multiplayer = (() => {
  'use strict';

  let active = false;
  let roomCode = '';
  let peerId = '';
  let peers = new Map();
  let onRemoteEvent = null;
  let signalingChannel = null;

  // ── Combo System ──
  let comboCount = 0;
  let lastComboTime = 0;
  const COMBO_WINDOW_MS = 2000;
  let onComboUpdate = null;

  function generateRoomCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 5; i++) {
      code += chars[Math.floor(Math.random() * chars.length)];
    }
    return code;
  }

  function generatePeerId() {
    return 'p_' + Math.random().toString(36).substring(2, 10);
  }

  /**
   * Create a room. Returns room code.
   * In production, this would hit a WebSocket signaling server.
   * For same-device / same-network testing we use BroadcastChannel.
   */
  function createRoom(callbacks) {
    roomCode = generateRoomCode();
    peerId = generatePeerId();
    onRemoteEvent = callbacks.onRemoteEvent || null;
    onComboUpdate = callbacks.onComboUpdate || null;

    initSignaling();
    active = true;

    broadcastSignal({
      type: 'room-created',
      room: roomCode,
      peer: peerId
    });

    return roomCode;
  }

  function joinRoom(code, callbacks) {
    roomCode = code.toUpperCase().trim();
    peerId = generatePeerId();
    onRemoteEvent = callbacks.onRemoteEvent || null;
    onComboUpdate = callbacks.onComboUpdate || null;

    initSignaling();
    active = true;

    broadcastSignal({
      type: 'join-request',
      room: roomCode,
      peer: peerId
    });

    return roomCode;
  }

  function initSignaling() {
    // BroadcastChannel for same-origin multi-tab testing
    // In production: WebSocket to signaling server
    try {
      signalingChannel = new BroadcastChannel('babykeyplay_signaling');
      signalingChannel.onmessage = handleSignalingMessage;
    } catch (e) {
      console.warn('BroadcastChannel not available. Multiplayer limited to same tab.');
    }
  }

  function handleSignalingMessage(event) {
    const data = event.data;
    if (!data || data.room !== roomCode || data.peer === peerId) return;

    switch (data.type) {
      case 'join-request':
        broadcastSignal({
          type: 'peer-welcome',
          room: roomCode,
          peer: peerId,
          targetPeer: data.peer
        });
        addPeer(data.peer);
        break;

      case 'peer-welcome':
        if (data.targetPeer === peerId) {
          addPeer(data.peer);
        }
        break;

      case 'game-event':
        if (onRemoteEvent) {
          onRemoteEvent(data.event);
        }
        incrementCombo();
        break;

      case 'peer-leave':
        removePeer(data.peer);
        break;
    }
  }

  function addPeer(id) {
    if (!peers.has(id)) {
      peers.set(id, { joinedAt: Date.now() });
    }
  }

  function removePeer(id) {
    peers.delete(id);
  }

  function broadcastSignal(data) {
    if (signalingChannel) {
      try {
        signalingChannel.postMessage(data);
      } catch (e) {
        // Channel may be closed
      }
    }
  }

  /**
   * Send a local game event to all peers
   */
  function sendEvent(eventData) {
    if (!active) return;

    broadcastSignal({
      type: 'game-event',
      room: roomCode,
      peer: peerId,
      event: eventData
    });

    incrementCombo();
  }

  function incrementCombo() {
    const now = performance.now();
    if (now - lastComboTime > COMBO_WINDOW_MS) {
      comboCount = 0;
    }
    comboCount++;
    lastComboTime = now;

    if (onComboUpdate) {
      onComboUpdate(comboCount);
    }
  }

  function updateCombo() {
    const now = performance.now();
    if (comboCount > 0 && now - lastComboTime > COMBO_WINDOW_MS) {
      comboCount = 0;
      if (onComboUpdate) {
        onComboUpdate(0);
      }
    }
  }

  function getPlayerCount() {
    return peers.size + (active ? 1 : 0);
  }

  function getComboCount() {
    return comboCount;
  }

  function getRoomCode() {
    return roomCode;
  }

  function isActive() {
    return active;
  }

  function leave() {
    if (!active) return;

    broadcastSignal({
      type: 'peer-leave',
      room: roomCode,
      peer: peerId
    });

    active = false;
    peers.clear();
    comboCount = 0;

    if (signalingChannel) {
      signalingChannel.close();
      signalingChannel = null;
    }
  }

  return {
    createRoom,
    joinRoom,
    sendEvent,
    updateCombo,
    getPlayerCount,
    getComboCount,
    getRoomCode,
    isActive,
    leave
  };
})();
